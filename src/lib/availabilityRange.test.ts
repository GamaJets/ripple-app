// "Tuesdays 7am to 7pm", said once. See the header of availabilityRange.ts for
// why the availability table was empty before this existed.
import {
  rangeSlotCount, rangeBlocker, expandRange, remainderNote,
  splitAgainstExisting, addButtonLabel, rangeSummary, addOutcome,
  MAX_WEEK_SLOTS, LARGEST_POSSIBLE_WEEK, MAX_DURATION_MIN, type RangeInput,
  type RangeSlot,
  AVAILABILITY_CACHE_PREFIX, LEGACY_AVAILABILITY_KEY, availabilityCacheKey,
  availabilityCache, isAvailabilityCacheKey,
} from './availabilityRange';
import {
  cacheHydrated, mayWriteCache, pushUpDecision, type DeviceCache,
} from './deviceAccountCache';

const errors: string[] = [];
const ok = (c: boolean, msg: string) => { if (!c) errors.push(msg); };
const eq = <T,>(a: T, b: T, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const H = (h: number, m = 0) => h * 60 + m;
const base: RangeInput = { days: [2], fromMin: H(7), toMin: H(19), durationMin: 15 };

/* ── the whole point ────────────────────────────────────────────────────── */

eq(rangeSlotCount(base), 48, 'seven to seven in quarters is forty-eight slots on one day');
{
  const s = expandRange(base);
  eq(s.length, 48, 'and forty-eight is what comes out');
  eq(s[0].hour, 7, 'the first starts at seven');
  eq(s[0].minute, 0, 'on the hour');
  eq(s[47].hour, 18, 'and the last starts at 18:45');
  eq(s[47].minute, 45, 'so it ENDS at 19:00 and not after it');
  ok(s.every((x) => x.dow === 2 && x.dur === 15), 'every slot carries the day and the length asked for');
}

/* ── the last slot must END inside the range ────────────────────────────── */

// The off-by-one that would have a coach available until 09:30 when they said
// 08:00. Counting step boundaries gives 2; counting whole sessions gives 1.
eq(rangeSlotCount({ days: [1], fromMin: H(7), toMin: H(8), durationMin: 45 }), 1,
  'an hour fits one 45-minute session, not two');
eq(remainderNote({ days: [1], fromMin: H(7), toMin: H(8), durationMin: 45 })!.includes('07:45'),
  true, 'and the unused quarter-hour is named rather than left as a puzzle');
eq(remainderNote(base), null, 'a range that divides exactly says nothing');

/* ── several days at once ───────────────────────────────────────────────── */

{
  const wk: RangeInput = { days: [1, 3, 5], fromMin: H(9), toMin: H(12), durationMin: 60 };
  eq(rangeSlotCount(wk), 9, 'three hours on three days at an hour each is nine');
  const s = expandRange(wk);
  eq(s.length, 9, 'and nine come out');
  // Ordered the way a person reads a week, so the confirmation list is scannable.
  ok(s[0].dow === 1 && s[3].dow === 3 && s[6].dow === 5, 'grouped by day, in day order');
  ok(s[0].hour === 9 && s[1].hour === 10 && s[2].hour === 11, 'and in time order inside each day');
}

// A day listed twice is one day. A chip a coach taps twice must not double
// their week.
eq(rangeSlotCount({ ...base, days: [2, 2, 2] }), 48, 'a repeated day is still one day');

/* ── gaps ───────────────────────────────────────────────────────────────── */

{
  const g: RangeInput = { days: [1], fromMin: H(9), toMin: H(12), durationMin: 50, gapMin: 10 };
  eq(rangeSlotCount(g), 3, 'fifty-minute sessions with ten-minute gaps fit three into three hours');
  const s = expandRange(g);
  eq(s[1].hour, 10, 'the second starts an hour after the first');
  eq(s[1].minute, 0, 'on the hour, because 50 + 10 is 60');
}

/* ── the refusals, each naming its number ───────────────────────────────── */

eq(rangeBlocker(base), null, 'an ordinary range is allowed');
ok(rangeBlocker({ ...base, days: [] })!.includes('at least one day'), 'no days is refused');

// Never silently swapped. A coach who typed 19:00→07:00 may have meant an
// overnight; reversing it would hand them twelve hours they did not offer.
{
  const back = rangeBlocker({ ...base, fromMin: H(19), toMin: H(7) })!;
  ok(back.includes('07:00') && back.includes('19:00'), 'a backwards range names both times');
  ok(back.includes('past midnight'), 'and says why it is not simply reversed');
}
eq(expandRange({ ...base, fromMin: H(19), toMin: H(7) }).length, 0,
  'and a refused range expands to nothing rather than to something wrong');

ok(rangeBlocker({ ...base, fromMin: H(7), toMin: H(7, 10), durationMin: 15 })!.includes('10 minutes'),
  'a range shorter than one session names how long it actually is');
ok(rangeBlocker({ ...base, durationMin: 0 })!.includes('how long'), 'a zero-length session is refused');
ok(rangeBlocker({ ...base, durationMin: MAX_DURATION_MIN + 1 })!.includes('end time in the length box'),
  'and an absurd length guesses at the mistake behind it');
ok(rangeBlocker({ ...base, toMin: H(24) + 1 })!.includes('inside one day'), 'past midnight is refused');
ok(rangeBlocker({ ...base, gapMin: -5 })!.includes('cannot be negative'), 'a negative gap is refused');

// The cap, which an earlier version of this file got wrong in the direction
// that matters: it refused seven days of 07:00-19:00 in quarter-hours, which is
// 336 slots and an entirely ordinary thing for a busy coach to offer.
{
  const huge: RangeInput = { days: [0, 1, 2, 3, 4, 5, 6], fromMin: H(7), toMin: H(19), durationMin: 15 };
  eq(rangeSlotCount(huge), 336, 'a full week of 07:00-19:00 quarters is 336 slots');
  eq(rangeBlocker(huge), null, 'and it is ALLOWED — this is a real week, not an abuse');
  eq(expandRange(huge).length, 336, 'and all 336 come out');

  // The true physical maximum, and the invariant that keeps the cap honest: if
  // anybody ever lowers MAX_WEEK_SLOTS below what a week can hold, this goes red
  // rather than a coach discovering it.
  eq(LARGEST_POSSIBLE_WEEK, 672, 'seven days of 24h in quarters is 672 slots');
  ok(LARGEST_POSSIBLE_WEEK < MAX_WEEK_SLOTS,
    'the largest week that can exist fits under the cap, so no legal combination is ever refused');
  const everything: RangeInput = { days: [0, 1, 2, 3, 4, 5, 6], fromMin: 0, toMin: H(24), durationMin: 15 };
  eq(rangeSlotCount(everything), LARGEST_POSSIBLE_WEEK, 'and the widest possible range produces exactly that');
  eq(rangeBlocker(everything), null, 'which is still allowed');

  // The cap is on the WEEK, not on one gesture, so it counts what is held.
  ok(rangeBlocker(huge, 900)!.includes('1236'), 'a range on top of a nearly-full week names the total it would reach');
}

/* ── every combination a person can actually pick ───────────────────────────
 *
 * The bar is "any and every possible combination", so this sweeps the whole
 * control surface rather than sampling it: every day-set size, every quarter-
 * hour start, every quarter-hour end after it, and every session length the
 * sheet offers. Nothing in here may throw, and nothing that is a legal pick may
 * be refused for a reason other than not fitting one session.
 */
{
  const DURS = [15, 30, 45, 60, 90];
  const QUARTERS: number[] = [];
  for (let m = 0; m <= 24 * 60; m += 15) QUARTERS.push(m);

  let checked = 0;
  let refusedForFit = 0;
  const unexpected: string[] = [];

  for (const dayCount of [1, 3, 7]) {
    const days = [0, 1, 2, 3, 4, 5, 6].slice(0, dayCount);
    for (const from of QUARTERS) {
      for (const to of QUARTERS) {
        if (to <= from) continue;
        for (const dur of DURS) {
          checked++;
          const r: RangeInput = { days, fromMin: from, toMin: to, durationMin: dur };
          let b: string | null;
          try { b = rangeBlocker(r); } catch (e) { unexpected.push(`threw on ${HHMM_(from)}-${HHMM_(to)}/${dur}: ${String(e)}`); continue; }
          if (b === null) {
            // A permitted range must produce at least one slot, every slot must
            // end inside the window, and the count must agree with the list.
            const slots = expandRange(r);
            if (slots.length === 0) { unexpected.push(`allowed but produced nothing: ${HHMM_(from)}-${HHMM_(to)}/${dur} x${dayCount}`); continue; }
            if (slots.length !== rangeSlotCount(r)) { unexpected.push(`count disagreed with list: ${HHMM_(from)}-${HHMM_(to)}/${dur}`); continue; }
            for (const sl of slots) {
              const start = sl.hour * 60 + sl.minute;
              if (start < from || start + dur > to) {
                unexpected.push(`slot outside the window: ${HHMM_(from)}-${HHMM_(to)}/${dur} produced ${HHMM_(start)}`);
                break;
              }
            }
          } else if (/not long enough for one/.test(b)) {
            // The only legitimate refusal in this sweep: the window is shorter
            // than one session. Everything else would be a bug.
            refusedForFit++;
            if (to - from >= dur) unexpected.push(`refused for fit but ${to - from} >= ${dur}: ${HHMM_(from)}-${HHMM_(to)}`);
          } else {
            unexpected.push(`refused for an unexpected reason (${HHMM_(from)}-${HHMM_(to)}/${dur} x${dayCount}): ${b}`);
          }
        }
      }
    }
  }

  ok(checked > 60_000, `the sweep is exhaustive — checked ${checked} combinations`);
  ok(refusedForFit > 0, 'and some windows really are too short for one session');
  eq(unexpected.slice(0, 3).join(' | '), '',
    `every day/time/length combination behaves — ${unexpected.length} did not`);
}

function HHMM_(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/* ── re-entering times you already offer ────────────────────────────────── */

{
  // Extending Tuesday from 07:00–12:00 to 07:00–19:00 re-enters the morning by
  // definition. Refusing the range for it would make the obvious gesture fail.
  const existing = expandRange({ days: [2], fromMin: H(7), toMin: H(12), durationMin: 15 });
  const { fresh, duplicates } = splitAgainstExisting(expandRange(base), existing);
  eq(duplicates, 20, 'the morning already offered is counted');
  eq(fresh.length, 28, 'and only the afternoon is added');
  ok(fresh.every((f) => f.hour >= 12), 'nothing before noon is re-added');

  const sum = rangeSummary(base, fresh.length, duplicates)!;
  ok(sum.includes('20 of them you already offer'), 'and the summary says so before the coach presses anything');
  ok(sum.includes('left alone'), 'and that they are not touched');
}

{
  const all = expandRange(base);
  const { fresh, duplicates } = splitAgainstExisting(all, all);
  eq(fresh.length, 0, 'a range entirely already offered adds nothing');
  eq(duplicates, 48, 'and every one is counted as a duplicate');
  eq(addButtonLabel(0, 48), 'You Already Offer All of These', 'the button says so rather than "Add 0 Slots"');
  ok(rangeSummary(base, 0, 48)!.includes('nothing would change'), 'and so does the summary');
}

/* ── the count is on the button ─────────────────────────────────────────── */

eq(addButtonLabel(48, 0), 'Add 48 Slots', 'the number is a decision, not a surprise');
eq(addButtonLabel(1, 0), 'Add 1 Slot', 'and one reads as English');
eq(addButtonLabel(0, 0), 'Nothing to Add', 'and nothing reads as nothing');

/* ── what actually landed ───────────────────────────────────────────────── */

// The assertWrote rule: count what the server confirmed, never what was tried.
ok(addOutcome(48, 48, 0).includes('48 slots added'), 'a whole write says so');
ok(addOutcome(48, 48, 0).includes('Generate Open Slots'), 'and points at the step that makes them bookable');
{
  const partial = addOutcome(12, 48, 0);
  ok(partial.includes('12 slots added'), 'a partial write counts what landed');
  ok(partial.includes('36 could not be saved'), 'and says how many did not');
  ok(!partial.includes('48 slots added'), 'and never reports the number attempted as the number saved');
}
{
  const none = addOutcome(0, 48, 0);
  ok(none.includes('None of those 48'), 'a failed write says nothing was added');
  ok(none.includes('cannot book any of them'), 'and what that costs');
  ok(none.includes('not on this phone either'), 'and that it was not kept locally either');
}
ok(addOutcome(0, 0, 20).includes('nothing was changed'), 'an all-duplicate add is not reported as a failure');
ok(addOutcome(28, 28, 20).includes('20 you already offered'), 'and duplicates are mentioned beside a real add');


/* ── whose week it is, across a sign-in, a sign-out and a sign-in ──────────
 *
 * The defect: `useAvailability` read and wrote the coach's weekly template
 * under one device-wide key, and its "the server has none, this phone has
 * some" branch INSERTED whatever it found with `trainer_id` set to whoever was
 * signed in. On a gym's shared handset that published the previous coach's
 * working week as this coach's, and `run_open_slot_extension` (part 650) turns
 * `trainer_availability` rows into `sessions` rows with status 'available'
 * every night — so a stranger's Tuesday morning became bookable time under the
 * wrong name and clients filled it.
 *
 * What is driven below is the REAL key composition and the REAL push-up
 * decision, against a fake store, over ONE long-lived provider object — because
 * that is what the provider is: it is mounted above the sign-out, so every bug
 * in this class lives in what the SECOND sign-in inherits from the first. The
 * awaits are elided (each step is called in the order the hook calls it); what
 * is modelled faithfully is a read that never lands, which is the case that
 * turns this from showing the wrong week into destroying the right one.
 */

/** The handset's store. `refuse` makes the next read throw, which is the case
 *  that must never arm a write. */
class FakeStore {
  private m = new Map<string, string>();
  refuse = false;
  get(k: string): string | null {
    if (this.refuse) { this.refuse = false; throw new Error('storage refused'); }
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  set(k: string, v: string) { this.m.set(k, v); }
  remove(k: string) { this.m.delete(k); }
  keys(): string[] { return [...this.m.keys()].sort(); }
}

/** The provider, as a value: the store it talks to, the cache record its ref
 *  holds, and the week in memory. */
interface Provider { store: FakeStore; cache: DeviceCache; slots: RangeSlot[] }

/** The head of the effect, run synchronously on every account change —
 *  including a sign-out, which is an account change to nobody. */
const account = (p: Provider, uid: string | null) => {
  p.cache = availabilityCache(uid);
  // The week leaves the screen with the key. A provider mounted at the root
  // outlives a sign-out; without this the departing coach's hours stay in
  // memory, where `addSlot` reads them.
  p.slots = [];
};

/** The cached read. `throws` is a refused store, after which the flag must
 *  stay false. */
const readCache = (p: Provider, o: { throws?: boolean } = {}) => {
  if (!p.cache.key) return;
  p.store.refuse = !!o.throws;
  try {
    const raw = p.store.get(p.cache.key);
    p.slots = raw ? (JSON.parse(raw) as RangeSlot[]) : [];
    p.cache = cacheHydrated(p.cache);
  } catch { /* not hydrated; nothing may be written over bytes nobody read */ }
};

/** `persist`: on screen always, kept only where this device may keep it. */
const persist = (p: Provider, next: RangeSlot[]) => {
  p.slots = next;
  if (mayWriteCache(p.cache)) p.store.set(p.cache.key, JSON.stringify(next));
};

/** The push-up branch's gate. */
const pushUp = (p: Provider, writeUid: string | null, serverHas: boolean | null) =>
  pushUpDecision({ cache: p.cache, writeUid, hasCached: p.slots.length > 0, serverHas });

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const weekA: RangeSlot[] = [{ dow: 2, hour: 7, minute: 0, dur: 60 }];
const weekB: RangeSlot[] = [{ dow: 4, hour: 18, minute: 30, dur: 45 }];

/* ── the key carries the account ─────────────────────────────────────────── */

eq(availabilityCacheKey(A), `${AVAILABILITY_CACHE_PREFIX}${A}`, 'a key is the prefix and the account');
ok(availabilityCacheKey(A) !== availabilityCacheKey(B), 'two coaches on one handset do not share a key');
ok((availabilityCacheKey(A) ?? '').includes(A), 'and the account is IN the key, not merely known about');

eq(availabilityCacheKey(null), null, 'signed out there is no key, and no key means do not persist');
eq(availabilityCacheKey(undefined), null, 'nor before the session has been restored');
eq(availabilityCacheKey(''), null, 'an empty id is not an account');
eq(availabilityCacheKey('   '), null, 'nor is whitespace');
eq(availabilityCacheKey('unknown'), null,
  "'unknown' is the literal clientData settles on before the auth read lands — every signed-out session would otherwise share one key");

ok(!isAvailabilityCacheKey(LEGACY_AVAILABILITY_KEY),
  'the legacy unqualified key is not one of the per-account family');
ok(isAvailabilityCacheKey(availabilityCacheKey(A)!), 'an account key is');
ok(!isAvailabilityCacheKey(AVAILABILITY_CACHE_PREFIX), 'and a bare prefix with no account after it is not');

/* ── one provider, across sign-in → sign-out → sign-in ───────────────────── */

{
  const p: Provider = { store: new FakeStore(), cache: availabilityCache(null), slots: [] };

  // ── coach A signs in and sets their week ──
  account(p, A);
  readCache(p);
  ok(mayWriteCache(p.cache), 'a read that landed on an empty store still arms the write');
  persist(p, weekA);
  eq(p.store.keys().join(','), `${AVAILABILITY_CACHE_PREFIX}${A}`,
    "A's week is stored under A's key and nowhere else");
  ok(!p.store.keys().includes(LEGACY_AVAILABILITY_KEY),
    'and nothing is written to the unqualified key this replaces');

  // ── A signs out ──
  account(p, null);
  eq(p.slots.length, 0, "the departing coach's week leaves the screen with their key");
  ok(!mayWriteCache(p.cache), 'and nothing may be written with nobody signed in');
  persist(p, weekA);
  eq(p.store.keys().length, 1, 'so a signed-out write lands nowhere');
  eq(pushUp(p, null, false), 'no-account', 'and there is nobody to publish a week as');

  // ── coach B signs in on the same handset ──
  account(p, B);
  eq(p.slots.length, 0, "B does not open the sheet on A's hours");
  readCache(p);
  eq(p.slots.length, 0, "and B's own store is empty, because A's week is behind A's key");
  eq(pushUp(p, B, false), 'nothing-cached',
    "so the push-up branch has nothing to publish — A's week is never inserted as B's");

  // B sets their own week; A's is untouched.
  persist(p, weekB);
  eq(p.store.keys().length, 2, 'two coaches, two keys');
  eq(JSON.parse(p.store.get(availabilityCacheKey(A)!)!)[0].hour, 7, "A's week survives B's session");
  eq(JSON.parse(p.store.get(availabilityCacheKey(B)!)!)[0].hour, 18, "and B's is their own");

  // ── the sharp one: B signs in again and the store refuses the read ──
  account(p, B);
  readCache(p, { throws: true });
  ok(!mayWriteCache(p.cache), 'a refused read does not arm the write');
  persist(p, []);
  eq(JSON.parse(p.store.get(availabilityCacheKey(B)!)!).length, 1,
    "B's stored week survives a session that could not read it — an unread store is not an empty one");
  eq(pushUp(p, B, false), 'not-hydrated',
    'and a week nobody managed to read is never published to the account');
}

/* ── the flag must not survive the key change ────────────────────────────── */

{
  const p: Provider = { store: new FakeStore(), cache: availabilityCache(null), slots: [] };
  account(p, A);
  readCache(p);
  persist(p, weekA);
  ok(mayWriteCache(p.cache), "A's session is armed");

  // B's store already holds B's week, from an earlier session on this handset.
  account(p, B);
  readCache(p);
  persist(p, weekB);

  // Now the switch itself: the account changes and the read has NOT come back.
  account(p, A);
  ok(!p.cache.hydrated,
    'the arming flag is false the instant the key changes, before any read of the new key');
  ok(!mayWriteCache(p.cache), 'so nothing may be written yet');
  persist(p, []);
  eq(JSON.parse(p.store.get(availabilityCacheKey(A)!)!).length, 1,
    "an account switch whose read never landed does not write an empty week over the new account's stored one");
}

/* ── the write is checked against the account it will be made AS ─────────── */

{
  const p: Provider = { store: new FakeStore(), cache: availabilityCache(null), slots: [] };
  account(p, A);
  readCache(p);
  persist(p, weekA);

  eq(pushUp(p, A, false), 'push', "A's own cached week, read under A's key, may be published as A's");
  eq(pushUp(p, B, false), 'other-account',
    'the same blob may NOT be inserted as B — this is the defect, caught');
  eq(pushUp(p, 'unknown', false), 'no-account', "'unknown' is not an account to write as");
  eq(pushUp(p, '', false), 'no-account', 'nor is an empty id');
  eq(pushUp(p, A, true), 'server-has-rows', 'an account with its own week keeps it; the server wins');
  eq(pushUp(p, A, null), 'server-unknown',
    'and a server nobody read is never treated as an empty one — a failed read is not an empty list');
}

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`availabilityRange: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('availabilityRange: ok — one stretch becomes many slots, the last one ends inside the range, nothing claims a write the server did not confirm, and no coach publishes another coach\u2019s week');
