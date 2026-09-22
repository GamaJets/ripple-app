// Whose workout the handset is holding — asserted across a real sign-out.
//
// The expensive failure this file is for is not a screen showing the wrong
// draft. It is the WRITE at the end of it: a session restored from a key with
// no account in it is finished by whoever is signed in now, and
// src/ui/workoutLog.tsx stamps the row with `uidRef.current` — the uid resolved
// fresh at save time. So member A's sets reach the `workouts` table as member
// B's, with no error anywhere and nothing afterwards able to tell them apart.
//
// Section 3 is the whole point: one long-lived session object carried across
// sign-in → sign-out → sign-in against a fake store, which is the sequence the
// defect lives in.
import {
  LEGACY_GUIDED_DRAFT_KEY, LEGACY_LIVE_SESSION_KEY, LEGACY_SESSION_KEYS,
  LEGACY_WORKOUT_DRAFT_PREFIX, accountScope, gateForKey, gateHydrated,
  guidedDraftKey, isDayKey, isLegacyWorkoutDraftKey, liveSessionKey,
  liveSessionResume, mayPersist, workoutDraftKey,
} from './sessionScope';
import { RESTORE_WINDOW_MS } from './liveSession';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-14T18:00:00.000Z');
const ago = (ms: number) => NOW - ms;

/* ── 1. an account, or nothing ────────────────────────────────────────────── */

eq(accountScope(A), A, 'a real id is an account');
eq(accountScope(null), null, 'null is not an account');
eq(accountScope(undefined), null, 'undefined is not an account');
eq(accountScope(''), null, 'the empty string is not an account');
eq(accountScope('   '), null, 'whitespace is not an account');
// The literal src/ui/clientData.tsx settles on before the auth read lands. If
// this were allowed through, every signed-out session on the handset would
// share one key — which is the defect, respelled.
eq(accountScope('unknown'), null, "'unknown' is not an account");
eq(accountScope('null'), null, "the string 'null' is not an account");
eq(accountScope('undefined'), null, "the string 'undefined' is not an account");
// The separator. An id carrying one could make <uid>:<date> ambiguous.
eq(accountScope('a:b'), null, 'an id containing the separator is refused');

eq(liveSessionKey(null), null, 'no account, no live-session key');
eq(guidedDraftKey('unknown'), null, "no account, no guided-draft key ('unknown')");
eq(workoutDraftKey(null, '2026-09-14'), null, 'no account, no draft key');

/* ── 2. the key carries the account, and two accounts never collide ──────── */

ok(liveSessionKey(A) !== liveSessionKey(B), 'two members do not share a live-session key');
ok(guidedDraftKey(A) !== guidedDraftKey(B), 'two members do not share a guided-draft key');
ok(
  workoutDraftKey(A, '2026-09-14') !== workoutDraftKey(B, '2026-09-14'),
  'two members on one handset on one day do not share a draft',
);
// The same member, twice, is the same key. A key that is not stable is a
// session lost on every benign remount.
eq(liveSessionKey(A), liveSessionKey(A), 'the same member gets the same live-session key');
eq(workoutDraftKey(A, '2026-09-14'), workoutDraftKey(A, '2026-09-14'), 'and the same draft key');
ok(String(liveSessionKey(A)).includes(A), 'the account is IN the live-session key');
ok(String(guidedDraftKey(A)).includes(A), 'the account is IN the guided-draft key');
ok(String(workoutDraftKey(A, '2026-09-14')).includes(A), 'the account is IN the draft key');

// Neither new key can be mistaken for a key the sweep deletes.
ok(!isLegacyWorkoutDraftKey(workoutDraftKey(A, '2026-09-14')), 'a scoped draft key is not swept as legacy');
ok(isLegacyWorkoutDraftKey(`${LEGACY_WORKOUT_DRAFT_PREFIX}2026-09-14`), 'the dated unowned key IS legacy');
ok(!isLegacyWorkoutDraftKey('repple.settings'), 'an unrelated key is not swept');
ok(!isLegacyWorkoutDraftKey(null), 'a non-string is not swept');
eq(LEGACY_SESSION_KEYS.length, 2, 'two flat legacy keys');
ok(LEGACY_SESSION_KEYS.includes(LEGACY_LIVE_SESSION_KEY), 'the live-session key is removed unread');
ok(LEGACY_SESSION_KEYS.includes(LEGACY_GUIDED_DRAFT_KEY), 'the guided-draft key is removed unread');

/* ── 3. one session, across sign-in → sign-out → sign-in ─────────────────── */

// A fake handset. Deliberately a plain map: what is being asserted is that no
// key composed here ever lets one account reach another's bytes.
class FakeStore {
  private readonly m = new Map<string, string>();
  /** Keys whose read should fail, to separate "nothing there" from "no answer". */
  readonly unreadable = new Set<string>();
  reads = 0;
  get(k: string | null): { read: 'ok' | 'failed'; raw: string | null } {
    if (k == null) throw new Error('the screen must not read a null key');
    this.reads += 1;
    if (this.unreadable.has(k)) return { read: 'failed', raw: null };
    return { read: 'ok', raw: this.m.has(k) ? (this.m.get(k) as string) : null };
  }
  set(k: string | null, v: string) { if (k == null) throw new Error('the screen must not write a null key'); this.m.set(k, v); }
  remove(k: string | null) { if (k == null) throw new Error('the screen must not remove a null key'); this.m.delete(k); }
  has(k: string) { return this.m.has(k); }
  raw(k: string) { return this.m.get(k) ?? null; }
  keys() { return [...this.m.keys()]; }
}

// ONE session object, the whole way through. It is member A's hour in a gym.
const aSession = { kind: 'guided' as const, startedAt: ago(25 * 60_000), pausedMs: 0 };

{
  const store = new FakeStore();

  /** What the screen does on a mount: compose, read if there is a key, decide. */
  const mount = (uid: string | null, now: number) => {
    const key = liveSessionKey(uid);
    if (key == null) {
      // No read, no write, no remove. The bytes belong to whoever they belong
      // to and the app does not yet know who is here.
      return { key, decision: liveSessionResume({ uid, read: 'ok', raw: null, now }) };
    }
    const r = store.get(key);
    const decision = liveSessionResume({ uid, read: r.read, raw: r.raw, now });
    if (decision.act === 'forget') store.remove(key);
    return { key, decision };
  };

  // — A signs in and starts training. The session goes to the disk.
  store.set(liveSessionKey(A), JSON.stringify(aSession));
  ok(store.has(`repple.liveSession.v1:${A}`), "A's session is stored under A");

  // — A benign remount mid-session. A gets their own session back. This is the
  //   regression the key change must NOT cause: a live session is real work.
  {
    const { decision } = mount(A, NOW);
    eq(decision.act, 'resume', "A's own session survives a remount");
    if (decision.act === 'resume') eq(decision.session.startedAt, aSession.startedAt, 'at the instant it started');
    ok(store.has(`repple.liveSession.v1:${A}`), 'and is still on the disk');
  }

  // — Sign-out. The uid is gone before the next member's arrives, and for that
  //   stretch the screen must do nothing at all.
  {
    const readsBefore = store.reads;
    const { key, decision } = mount(null, NOW);
    eq(key, null, 'signed out composes no key');
    eq(decision.act, 'wait', 'and decides nothing');
    eq(store.reads, readsBefore, 'no read is issued without an account');
    ok(store.has(`repple.liveSession.v1:${A}`), "and A's session is not destroyed by A leaving");
  }

  // — Member B signs in on the same handset. THE ASSERTION.
  {
    const { key, decision } = mount(B, NOW);
    eq(key, `repple.liveSession.v1:${B}`, "B reads B's key");
    eq(decision.act, 'none', "B does not inherit A's session in flight");
    ok(store.has(`repple.liveSession.v1:${A}`), "and A's session is untouched by B's read");
  }

  // — B trains, finishes, and B's own session is written under B.
  const bSession = { kind: 'timed' as const, activity: 'Rowing', sessionKind: 'cardio', startedAt: ago(5 * 60_000), pausedMs: 0 };
  store.set(liveSessionKey(B), JSON.stringify(bSession));
  {
    const { decision } = mount(B, NOW);
    eq(decision.act, 'resume', "B resumes B's session");
    if (decision.act === 'resume') eq(decision.session.activity, 'Rowing', 'which is the one B started');
  }

  // — A signs back in. A's own session is still A's, and is still A's session.
  {
    const { decision } = mount(A, NOW);
    eq(decision.act, 'resume', "A's session is still there when A comes back");
    if (decision.act === 'resume') eq(decision.session.startedAt, aSession.startedAt, 'and is the same session');
  }

  // — Two members, two records, neither reachable from the other's key.
  eq(store.keys().length, 2, 'two accounts, two records');
}

/* ── 4. the same, for the sets themselves ────────────────────────────────── */

{
  const store = new FakeStore();
  const DAY = '2026-09-14';
  const aSets = JSON.stringify({ 'Back Squat': [{ reps: 5, kg: 100 }] });

  store.set(workoutDraftKey(A, DAY), aSets);
  // B, same handset, same day. The date scoped nothing: only the account does.
  const bKey = workoutDraftKey(B, DAY);
  eq(store.get(bKey).raw, null, "B's draft for today is empty, not A's 100kg squats");
  eq(store.get(workoutDraftKey(A, DAY)).raw, aSets, "and A's are still A's");

  const guided = JSON.stringify({ day: DAY, plan: 'Back Squat|Bench', results: [[{ reps: 5, kg: 100 }], []], idx: 0 });
  store.set(guidedDraftKey(A), guided);
  eq(store.get(guidedDraftKey(B)).raw, null, "B's guided runner starts empty");
}

/* ── 5. the arming flag does not survive a key change ────────────────────── */

{
  const keyA = workoutDraftKey(A, '2026-09-14');
  const keyB = workoutDraftKey(B, '2026-09-14');

  let gate = gateForKey(keyA);
  eq(mayPersist(gate, keyA), false, 'nothing may be written before the read lands');
  gate = gateHydrated(gate, keyA);
  eq(mayPersist(gate, keyA), true, "and may be once A's own bytes have been read");

  // The account switches. The flag is rebuilt for the new key, disarmed —
  // BEFORE the read, so a read that then fails cannot arm anything.
  gate = gateForKey(keyB);
  eq(mayPersist(gate, keyB), false, "B's empty state may not be written before B's read lands");
  eq(mayPersist(gate, keyA), false, "and a gate for B never authorises a write to A's key");

  // A response for the OLD key arriving after the switch answers a different
  // question and must not arm this one.
  gate = gateHydrated(gate, keyA);
  eq(mayPersist(gate, keyB), false, "a late answer about A does not arm B's key");
  gate = gateHydrated(gate, keyB);
  eq(mayPersist(gate, keyB), true, "B's own read arms B's key");

  // No account is never writable, however hydrated anything claims to be.
  eq(mayPersist(gateHydrated(gateForKey(null), null), null), false, 'a null key is never written');
}

/* ── 6. a failed read is not an empty store, and never a delete ──────────── */

{
  const store = new FakeStore();
  store.set(liveSessionKey(A), JSON.stringify(aSession));
  store.unreadable.add(String(liveSessionKey(A)));
  const r = store.get(liveSessionKey(A));
  const d = liveSessionResume({ uid: A, read: r.read, raw: r.raw, now: NOW });
  eq(d.act, 'none', 'a read that did not answer restores nothing');
  ok(d.act !== 'forget', 'and above all does not delete the session it could not read');
}

// Bytes that do not parse are not "stale" either.
eq(liveSessionResume({ uid: A, read: 'ok', raw: '{not json', now: NOW }).act, 'none', 'unreadable bytes are not a stale session');
eq(liveSessionResume({ uid: A, read: 'ok', raw: null, now: NOW }).act, 'none', 'nothing stored is nothing to resume');

// Past the window it IS removed — a session nobody has touched since this
// morning coming back as a nine-hour workout is a figure in a health record
// that describes an afternoon at a desk.
{
  const old = JSON.stringify({ kind: 'guided', startedAt: ago(RESTORE_WINDOW_MS + 60_000) });
  eq(liveSessionResume({ uid: A, read: 'ok', raw: old, now: NOW }).act, 'forget', 'a session past the window is dropped');
  const fresh = JSON.stringify({ kind: 'guided', startedAt: ago(RESTORE_WINDOW_MS - 60_000) });
  eq(liveSessionResume({ uid: A, read: 'ok', raw: fresh, now: NOW }).act, 'resume', 'one inside it is not');
}

// And with no account, an ancient record is still not deleted: the app does not
// yet know whose it is.
{
  const old = JSON.stringify({ kind: 'guided', startedAt: ago(RESTORE_WINDOW_MS + 60_000) });
  eq(liveSessionResume({ uid: null, read: 'ok', raw: old, now: NOW }).act, 'wait', 'no account decides nothing, not even to forget');
}

/* ── 7. the day half of the key is a string, in every timezone ───────────── */
//
// Run under TZ=Pacific/Kiritimati (+14), UTC and Pacific/Midway (-11). A key
// built by parsing '2026-09-14' as a Date and rendering it back locally is a
// different day in two of those three, which would file a member's draft under
// the day before the one they typed it on.

{
  for (const day of ['2026-01-01', '2026-09-14', '2026-12-31', '2027-03-01']) {
    eq(workoutDraftKey(A, day), `repple.workoutDraft:${A}:${day}`, `the key spells ${day} exactly as given`);
  }
  // Midnight and one-minute-to-midnight are the same day either side of the
  // date line only because nothing here consults a clock at all.
  ok(isDayKey('2026-09-14'), 'a bare YYYY-MM-DD is a day key');
  ok(!isDayKey('2026-9-14'), 'an unpadded month is not');
  ok(!isDayKey('2026-09-14T00:00:00.000Z'), 'an instant is not a day key');
  ok(!isDayKey(''), 'the empty string is not a day key');
  ok(!isDayKey(null), 'null is not a day key');
  eq(workoutDraftKey(A, '2026-9-14'), null, 'a malformed day composes no key');
  eq(workoutDraftKey(A, ''), null, 'and neither does an empty one');
  // Two adjacent days are two keys, wherever the machine is.
  ok(workoutDraftKey(A, '2026-09-14') !== workoutDraftKey(A, '2026-09-15'), 'adjacent days are separate drafts');
}

if (errors.length) {
  console.error('sessionScope.test.ts FAILED');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('sessionScope.test.ts — ok');
