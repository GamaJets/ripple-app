// The coach's own numbers, and the three sentences that go with them.
// Compile with tsc, run with node.
//
// What is defended here is a set of figures that would all look perfectly
// ordinary on a coach's phone while being false about their pay:
//
// 1. A half-typed rate is not a rate of zero. The box saves as the coach types,
//    so "12." exists on its way to "12.50", and a parser that answered 0 for it
//    would replace a stored rate with nothing, silently, mid-keystroke.
//
// 2. An empty box IS an instruction — unset it — and has to be told apart from
//    the half-typed case, because one is saved and the other must not be.
//
// 3. A pay estimate with no check-in count is null, not 0. The screen used to
//    print "25 × 0 checked in = 0" when the roster could not be read: a payout
//    figure for a class it never managed to look at.
//
// 4. An empty goals section says something different when the read FAILED than
//    when there are genuinely no targets. The first version said "No targets
//    set" either way, which invites a coach to type their targets in again over
//    the top of the ones already stored.
//
// Nothing here formats a currency, and nothing here should ever start to. The
// rate is a bare number the coach types about a payment Repple does not make.
import {
  parseRate, rateText, payEstimate, parseGoal, goalText, goalPct,
  goalsEmptyLine, goalSaveLine, rateFieldNote,
  parseCooldown, cooldownText, cooldownNote, MIN_NUDGE_COOLDOWN, MAX_NUDGE_COOLDOWN,
  TRAINER_GOALS_CACHE_PREFIX, LEGACY_TRAINER_GOALS_KEY, trainerGoalsCacheKey,
  trainerGoalsCache, isTrainerGoalsCacheKey,
} from './coachPrefs';
import {
  cacheHydrated, mayWriteCache, pushUpDecision, type DeviceCache,
} from './deviceAccountCache';
import { paceFor, cooldownFloor, MIN_COOLDOWN_DAYS, MAX_COOLDOWN_DAYS, DEFAULT_COOLDOWN_DAYS } from './interventions';
import { mutedDaysFor, DISMISS_FLOOR_DAYS } from './nudge';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The parsed rate, or null for the two answers that are not a number. Written
 *  once rather than inline, because TypeScript will not narrow a union across
 *  two separate calls to the same function. */
const rateValue = (text: string): number | null => {
  const r = parseRate(text);
  return r.kind === 'value' ? r.value : null;
};

/* ── reading a typed rate ─────────────────────────────────────────────────── */

eq(parseRate('25').kind, 'value', 'a whole number is a rate');
eq(rateValue('25'), 25, 'and it is that number');
eq(rateValue('37.5'), 37.5, 'a decimal rate is kept');
eq(rateValue('  40  '), 40, 'surrounding space is trimmed');
eq(rateValue('0'), 0, 'zero is a rate somebody may deliberately set — an unpaid class');

// The comma keyboard. Number('12,5') is NaN, so without this a coach on a
// German keyboard has a rate the app calls invalid every time they type it.
eq(rateValue('12,5'), 12.5, 'one comma is a decimal point');
eq(parseRate('1,234,5').kind, 'invalid',
  'two commas are a thousands separator or a slip, and guessing which would invent a figure');

// The empty box is an instruction and is saved as NULL.
eq(parseRate('').kind, 'empty', 'an empty box means unset my rate');
eq(parseRate('   ').kind, 'empty', 'so does a box of spaces');

// The half-typed and the mistyped are NOT instructions. Every one of these is
// something parseFloat would have turned into a number.
eq(parseRate('12.').kind, 'invalid', 'a rate mid-keystroke is not yet a rate — parseFloat says 12');
eq(parseRate('.').kind, 'invalid', 'a lone decimal point is not a number');
eq(parseRate('12abc').kind, 'invalid', 'a typo is not a rate — parseFloat says 12');
eq(parseRate('abc').kind, 'invalid', 'nor is a word');
eq(parseRate('-5').kind, 'invalid', 'a negative rate is not a rate');
eq(parseRate('1e3').kind, 'invalid', 'exponent notation is a slip on a numeric keypad, not 1000');
eq(parseRate('Infinity').kind, 'invalid', 'Infinity is not a rate');
// All digits, so it passes the shape check — and Number() makes it Infinity.
eq(parseRate('9'.repeat(400)).kind, 'invalid', 'a rate too large to be a number is not a rate');
eq(parseRate('NaN').kind, 'invalid', 'nor is NaN');

/* ── a stored rate back into the box ──────────────────────────────────────── */

eq(rateText(37.5), '37.5', 'a stored rate fills the box');
eq(rateText(37.50), '37.5', 'the trailing zero numeric(12,2) adds back is dropped');
eq(rateText(0), '0', 'a deliberate zero rate is shown as zero');
eq(rateText(null), '', 'no rate set is an EMPTY box — not "0", which would read as a rate of nothing');
eq(rateText(undefined), '', 'and neither is it the word undefined');
eq(rateText(Number.NaN), '', 'a corrupt value shows as empty rather than as "NaN"');
// The round trip a coach performs every time they open the screen.
eq(rateValue(rateText(37.5)), 37.5, 'store → box → store does not drift');

/* ── the pay estimate ─────────────────────────────────────────────────────── */

eq(payEstimate(25, 8), 200, 'rate times heads through the door');
eq(payEstimate(37.5, 3), 113, 'the estimate is rounded to a whole unit');
eq(payEstimate(25, 0), 0, 'a class nobody came to really is zero, and may be said');
// The line the screen used to print over an unread roster.
eq(payEstimate(25, null), null,
  'no check-in count means NO estimate — "25 × 0 = 0" is a payout for a class nobody looked at');
eq(payEstimate(null, 8), null, 'no rate means no estimate either');
eq(payEstimate(null, null), null, 'neither half known is certainly no estimate');
eq(payEstimate(Number.NaN, 8), null, 'a NaN rate produces nothing rather than "NaN"');

/* ── goals ────────────────────────────────────────────────────────────────── */

eq(parseGoal('4000'), 4000, 'a typed target is that number');
eq(parseGoal(''), 0, 'an empty target box is no target');
eq(parseGoal('abc'), 0, 'so is a word');
eq(parseGoal('40.5'), 0, 'a fractional client target is not a target');
eq(parseGoal('-12'), 0, 'a negative target is not a target — parseInt would have said -12');
eq(parseGoal('12abc'), 0, 'a typo is not a target — parseInt would have said 12');
eq(parseGoal('0'), 0, 'zero is how "no target" is stored');
eq(parseGoal('1'), 1, 'a target of one client is a target');
// Twenty digits is past Number.MAX_SAFE_INTEGER: the last digits are gone by
// the time it is a float, so it is not the number that was typed.
eq(parseGoal('99999999999999999999'), 0, 'a target too large to represent exactly is refused, not rounded');

eq(goalText(4000), '4000', 'a set target fills its box');
eq(goalText(1), '1', 'a target of one is set, and shows');
eq(goalText(0), '', 'an unset target is an EMPTY box — String(0) would read as a target of nothing');

eq(goalPct(2000, 4000), 0.5, 'halfway is a half');
eq(goalPct(4000, 4000), 1, 'reaching it is one');
eq(goalPct(9000, 4000), 1, 'beating it is clamped to one — the bar cannot overflow its track');
eq(goalPct(-5, 4000), 0, 'a negative figure is clamped to zero rather than drawn backwards');
eq(goalPct(2000, 0), 0, 'no target is no progress — never a division by zero');
eq(goalPct(1, 1), 1, 'a target of one is a real target and is divided by');

/* ── the two sentences that must not be the same ──────────────────────────── */

// A read that failed and a coach with no targets both arrive as {0, 0}.
const errLine = goalsEmptyLine('error', 0, 0);
const readyLine = goalsEmptyLine('ready', 0, 0);
const loadingLine = goalsEmptyLine('loading', 0, 0);
ok(typeof errLine === 'string' && typeof readyLine === 'string', 'both states say something');
ok(errLine !== readyLine,
  'a failed read must NOT say "No targets set" — that is the app telling a coach something false about themselves');
ok(loadingLine !== readyLine, 'and a read still in flight is a third thing again');
ok(!/no targets set/i.test(String(errLine)),
  'the error sentence does not claim there are no targets');
ok(/could not be read/i.test(String(errLine)),
  'it says the read failed, which is the only thing that is known');
ok(/no targets set/i.test(String(readyLine)),
  'and a genuine empty under ready does say so plainly');
// With a target set there is nothing to explain — the bars speak.
eq(goalsEmptyLine('ready', 4000, 0), null, 'a revenue target set means no empty-state line');
eq(goalsEmptyLine('ready', 0, 12), null, 'a client target set means the same');
eq(goalsEmptyLine('ready', 1, 0), null, 'a revenue target of one is still a target set');
eq(goalsEmptyLine('ready', 0, 1), null, 'and so is a single-client target');
eq(goalsEmptyLine('error', 4000, 0), null,
  'a target that DID come back is drawn, and the empty-state line stays out of its way');

// Same rule for the rate box.
const rateErr = rateFieldNote('error');
eq(rateFieldNote('ready'), null, 'a clean read needs no explanation under the box');
ok(typeof rateErr === 'string' && /could not be read/i.test(rateErr),
  'an empty box after a failed read says why it is empty');
ok(rateFieldNote('loading') !== rateErr, 'still reading is not the same as could not read');
for (const s of ['loading', 'error'] as LoadStatus[]) {
  ok(rateFieldNote(s) !== null, `${s} gets a sentence rather than a bare empty box`);
}



/* ── the coach's own nudge cooldown ─────────────────────────────────────── */

// The same three-way answer the rate box gives, and for the same reason: a
// half-typed "1" on its way to "14" must not be saved as one day, which would
// turn the whole quiet list into a daily prompt for every client the coach has.
eq(parseCooldown('').kind, 'empty', 'an empty box asks for the app’s own pacing back');
eq(parseCooldown('   ').kind, 'empty', 'and so does whitespace');
const fourteen = parseCooldown('14');
eq(fourteen.kind, 'value', 'a whole number of days is a value');
eq(fourteen.kind === 'value' ? fourteen.value : null, 14, 'and it is the number typed');
eq(parseCooldown('0').kind, 'invalid', 'zero days is refused — that is a prompt every morning');
eq(parseCooldown('-3').kind, 'invalid', 'and so is a negative');
eq(parseCooldown('7.5').kind, 'invalid', 'there is no half a day between two phone calls');
eq(parseCooldown('14abc').kind, 'invalid', 'parseInt would have taken the 14 out of this');
eq(parseCooldown('1e3').kind, 'invalid', 'and Number would have made a thousand of this');
eq(parseCooldown(String(MAX_NUDGE_COOLDOWN)).kind, 'value', 'a year is allowed');
eq(parseCooldown(String(MAX_NUDGE_COOLDOWN + 1)).kind, 'invalid', 'more than a year is not');
eq(parseCooldown(String(MIN_NUDGE_COOLDOWN)).kind, 'value', 'and one day is the floor');

eq(cooldownText(null), '', 'no preference is an empty box, never the digit zero');
eq(cooldownText(undefined), '', 'and so is nothing at all');
eq(cooldownText(21), '21', 'a stored window round-trips');
const round = parseCooldown(cooldownText(30));
eq(round.kind === 'value' ? round.value : null, 30, 'and survives the round trip through the box');

// Two different states with the same behaviour, and a coach who cannot tell
// them apart cannot decide whether to change anything.
ok(cooldownNote(null) !== cooldownNote(7), 'unset and set-to-seven read differently');
ok(/never closer than a week/i.test(cooldownNote(null)), 'unset says what the app does instead');
ok(/14 days/.test(cooldownNote(14)), 'and a set one states the number');
ok(/1 day\b/.test(cooldownNote(1)) && !/1 days/.test(cooldownNote(1)), 'one day is singular');

/* ── and what the number actually does ──────────────────────────────────── */

// The refusal. Anything outside the range falls back to the module's own floor
// rather than being clamped — clamping would invent a number the coach never
// chose and then pace their whole book off it.
eq(cooldownFloor(null), MIN_COOLDOWN_DAYS, 'no preference is the module’s own floor');
eq(cooldownFloor({ minCooldownDays: null }), MIN_COOLDOWN_DAYS, 'and so is an explicit null');
eq(cooldownFloor({ minCooldownDays: 0 }), MIN_COOLDOWN_DAYS, 'a zero is refused, not honoured');
eq(cooldownFloor({ minCooldownDays: 100000 }), MIN_COOLDOWN_DAYS, 'and so is three centuries');
eq(cooldownFloor({ minCooldownDays: 21 }), 21, 'a sane number is used as typed');

// THE property worth the whole setting: the per-client pacing survives it. A
// client who trained four times a week and one who trained fortnightly still
// get different windows under the same coach preference — a floor composes with
// the pacing, an override would have deleted it.
const keen = paceFor(4, { minCooldownDays: 10 });
const rare = paceFor(0.5, { minCooldownDays: 10 });
ok(keen.cooldownDays >= 10, 'the keen client is never raised inside the coach’s floor');
ok(rare.cooldownDays > keen.cooldownDays, 'and the fortnightly one is still left longer than the daily one');

// A floor above the module's ceiling raises the ceiling rather than being
// pushed back down to it. A coach who typed 45 means 45.
const strict = paceFor(4, { minCooldownDays: 45 });
eq(strict.cooldownDays, 45, 'a floor past the cap wins — the cap is the app’s opinion, not the coach’s');
ok(45 > MAX_COOLDOWN_DAYS, 'and it really is past it');

// With no pattern to pace against, the coach's convention beats the app's.
eq(paceFor(null).cooldownDays, DEFAULT_COOLDOWN_DAYS, 'no pattern and no preference is the app’s fortnight');
eq(paceFor(null, { minCooldownDays: 30 }).cooldownDays, 30, 'no pattern with a preference is the coach’s number');
eq(paceFor(null, { minCooldownDays: 0 }).cooldownDays, DEFAULT_COOLDOWN_DAYS,
  'and a refused preference falls back rather than being honoured');

// The dismissal floor moves with it. A coach who will not be prompted inside
// forty-five days must not have a set-aside expire in thirty.
const drift = { baselinePerWeek: 4 } as any;
ok(mutedDaysFor('dismissed', drift) >= DISMISS_FLOOR_DAYS, 'a dismissal is at least a month by default');
eq(mutedDaysFor('dismissed', drift, { minCooldownDays: 45 }), 45,
  'and at least the coach’s own floor when that is longer');
eq(mutedDaysFor('sent', drift, { minCooldownDays: 45 }), 45, 'sending honours it too');
// No preference must behave exactly as it did before this existed.
eq(mutedDaysFor('sent', drift), mutedDaysFor('sent', drift, null),
  'an absent preference changes nothing at all');

/* ── a target that never left the phone ─────────────────────────────────── */
//
// Setting a goal was a void call behind a sheet that closed itself, and two
// silent ways of keeping the target on one handset for good sat behind it: the
// account write is skipped for the rest of a session whose prefs read failed,
// and the write itself was un-awaited and unchecked.

eq(goalSaveLine('saved'), null, 'a target that reached the account says nothing — the bars speak for themselves');

{
  const dev = goalSaveLine('device-only') ?? '';
  ok(dev.length > 0, 'a target that was never sent says so');
  ok(/this phone/i.test(dev), 'and names where it actually is');
  ok(!/saved to your account|stored on your account/i.test(dev), 'and never claims the account has it');
}

{
  const bad = goalSaveLine('failed') ?? '';
  ok(/did NOT reach your account|not reach your account/i.test(bad), 'a refused write says the account does not have it');
  ok(/reinstall|another phone/i.test(bad), 'and what that costs the coach');
}

for (const o of ['saved', 'device-only', 'failed'] as const) {
  const line = goalSaveLine(o);
  ok(line === null || (!line.includes('undefined') && !line.includes('null')),
    `${o} is either silent or a real sentence`);
}

/* ── whose targets these are, across sign-in → sign-out → sign-in ─────────
 *
 * The defect: `useTrainerGoals` cached the coach's monthly revenue and client
 * targets under one device-wide key, and its BACKFILL — the branch that
 * publishes targets this device holds to an account that has none — wrote them
 * into `coach_prefs` for whoever was signed in. On a gym's shared handset the
 * previous coach's targets arrived in this coach's account and rendered under
 * "Your goals" with a progress arc, as though this coach had set them.
 *
 * Driven below: the real key composition and the real backfill gate, against a
 * fake store, over ONE long-lived provider object — because the provider is
 * mounted above the sign-out, so the whole bug is in what the second sign-in
 * inherits from the first.
 */

interface Targets { revenue: number; clients: number }
class GoalsStore {
  private m = new Map<string, string>();
  refuse = false;
  get(k: string): string | null {
    if (this.refuse) { this.refuse = false; throw new Error('storage refused'); }
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  set(k: string, v: string) { this.m.set(k, v); }
  keys(): string[] { return [...this.m.keys()].sort(); }
}
interface GoalsProvider { store: GoalsStore; cache: DeviceCache; goals: Targets }

const NO_TARGETS: Targets = { revenue: 0, clients: 0 };

/** The head of the effect, synchronous, on every account change. */
const goalsAccount = (p: GoalsProvider, uid: string | null) => {
  p.cache = trainerGoalsCache(uid);
  // The numbers leave the screen with the key: this provider outlives a
  // sign-out, and an inherited revenue target is drawn as an arc with the new
  // coach's own revenue measured against it.
  p.goals = NO_TARGETS;
};
const goalsRead = (p: GoalsProvider, o: { throws?: boolean } = {}) => {
  if (!p.cache.key) return;
  p.store.refuse = !!o.throws;
  try {
    const raw = p.store.get(p.cache.key);
    p.goals = raw ? (JSON.parse(raw) as Targets) : NO_TARGETS;
    p.cache = cacheHydrated(p.cache);
  } catch { /* not hydrated: nothing is written over bytes nobody read */ }
};
const goalsSave = (p: GoalsProvider, next: Targets) => {
  p.goals = next;
  if (mayWriteCache(p.cache)) p.store.set(p.cache.key, JSON.stringify(next));
};
/** The backfill gate. `serverHas` is whether the ACCOUNT already has targets. */
const goalsBackfill = (p: GoalsProvider, writeUid: string | null, serverHas: boolean | null) =>
  pushUpDecision({
    cache: p.cache,
    writeUid,
    hasCached: p.goals.revenue > 0 || p.goals.clients > 0,
    serverHas,
  });

const COACH_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COACH_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

eq(trainerGoalsCacheKey(COACH_A), `${TRAINER_GOALS_CACHE_PREFIX}${COACH_A}`,
  'a key is the prefix and the account');
ok(trainerGoalsCacheKey(COACH_A) !== trainerGoalsCacheKey(COACH_B),
  'two coaches on one handset do not share a key');
eq(trainerGoalsCacheKey(null), null, 'signed out there is no key, and no key means do not persist');
eq(trainerGoalsCacheKey(''), null, 'an empty id is not an account');
eq(trainerGoalsCacheKey('unknown'), null, "and 'unknown' is not one either");
ok(!isTrainerGoalsCacheKey(LEGACY_TRAINER_GOALS_KEY),
  'the legacy unqualified key is not one of the per-account family');
ok(isTrainerGoalsCacheKey(trainerGoalsCacheKey(COACH_A)!), 'an account key is');

{
  const p: GoalsProvider = { store: new GoalsStore(), cache: trainerGoalsCache(null), goals: NO_TARGETS };

  // Coach A sets a revenue target on the gym's handset.
  goalsAccount(p, COACH_A);
  goalsRead(p);
  goalsSave(p, { revenue: 4000, clients: 12 });
  eq(p.store.keys().join(','), `${TRAINER_GOALS_CACHE_PREFIX}${COACH_A}`,
    "A's targets are stored under A's key and nowhere else");

  // A signs out.
  goalsAccount(p, null);
  eq(p.goals.revenue, 0, "the departing coach's target leaves the Analytics hero with their key");
  goalsSave(p, { revenue: 4000, clients: 12 });
  eq(p.store.keys().length, 1, 'and a signed-out write lands nowhere');

  // B signs in on the same handset, with no targets of their own anywhere.
  goalsAccount(p, COACH_B);
  goalsRead(p);
  eq(p.goals.revenue, 0, "B's section is empty, because A's numbers are behind A's key");
  eq(goalsBackfill(p, COACH_B, false), 'nothing-cached',
    "so the backfill has nothing to publish — A's targets never reach B's coach_prefs row");

  // B's own target, and A's is untouched.
  goalsSave(p, { revenue: 900, clients: 4 });
  eq(goalsBackfill(p, COACH_B, false), 'push', "B's own cached target may be published as B's");
  eq(goalsBackfill(p, COACH_A, false), 'other-account',
    'and the same blob may not be written as A — this is the defect, caught');
  eq(goalsBackfill(p, COACH_B, true), 'server-has-rows',
    'an account that already has targets keeps them; the server wins');
  eq(goalsBackfill(p, COACH_B, null), 'server-unknown',
    'and a prefs read that failed is never treated as an account with none — a failed read is not an empty list');
  eq(JSON.parse(p.store.get(trainerGoalsCacheKey(COACH_A)!)!).revenue, 4000,
    "A's targets survive B's session intact");

  // The flag must not survive the key change: B's stored targets must outlast
  // an account switch back whose read never lands.
  goalsAccount(p, COACH_A);
  ok(!p.cache.hydrated, 'the arming flag is false the instant the key changes');
  goalsSave(p, NO_TARGETS);
  eq(JSON.parse(p.store.get(trainerGoalsCacheKey(COACH_A)!)!).revenue, 4000,
    "and {0,0} is not written over the new account's stored targets before its read comes back");

  // A refused read arms nothing.
  goalsAccount(p, COACH_B);
  goalsRead(p, { throws: true });
  ok(!mayWriteCache(p.cache), 'a refused read does not arm the device write');
  eq(goalsBackfill(p, COACH_B, false), 'not-hydrated',
    'and targets nobody managed to read are never published to the account');
  goalsSave(p, NO_TARGETS);
  eq(JSON.parse(p.store.get(trainerGoalsCacheKey(COACH_B)!)!).revenue, 900,
    "B's stored targets survive a session that could not read them");
}

if (errors.length) {
  console.error(`coachPrefs.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('coachPrefs.test.ts — all assertions passed.');
