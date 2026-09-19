// Whose rows these are — asserted across a real account change.
//
// The expensive failure is not a screen showing the wrong list. It is the
// INSERT at the end of it: src/ui/workoutLog.tsx sends `entryToRow(owner, e)`
// with `owner` resolved fresh at write time, so a queued entry held over from
// the previous account reaches the `workouts` table under the new account's id,
// with RLS satisfied, a row returned and no error anywhere.
//
// Section 4 is the point: one long-lived "list owner" carried across
// sign-in → sign-out → sign-in, and the same sequence again with an outage
// standing where the sign-out was — which is the case that must move nothing.
import { foreignList, listOwnerAct, mayWriteUnder } from './listOwner';
import type { UidRead } from './authedUid';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const signedIn = (uid: string): UidRead => ({ uid, fate: null });
const signedOut: UidRead = { uid: null, fate: 'signed-out' };
const unreadable: UidRead = { uid: null, fate: 'unreadable' };

/* ── 1. a list held for a different account ───────────────────────────────── */

ok(foreignList(A, B), "A's list is foreign to B");
ok(foreignList(B, A), 'and the other way round');
ok(!foreignList(A, A), 'a list is not foreign to its own account');
// Unclaimed rows are nobody's yet — typed before the auth read landed.
ok(!foreignList(null, B), 'an unclaimed list is not foreign');
ok(!foreignList(undefined, B), 'nor is an undefined one');
ok(!foreignList('', B), 'nor is a blank one');
// Nothing is being claimed, so nothing is foreign. No write can reach the
// server on this path either — see mayWriteUnder below.
ok(!foreignList(A, null), 'with no account claiming it, a held list is not foreign');
ok(!foreignList(A, ''), 'nor with a blank one');
// The literal src/ui/clientData.tsx publishes before the auth read lands. Two
// sessions both reporting it must not read as the same person — and neither
// side of the comparison may be built from it.
ok(!foreignList('unknown', 'unknown'), "'unknown' is not an account on either side");
ok(!foreignList('unknown', B), "'unknown' held is not a real account");
ok(!foreignList(A, 'unknown'), "'unknown' claiming is not a real account");

/* ── 2. which rows may carry which id ─────────────────────────────────────── */

ok(mayWriteUnder(A, A), "A's rows may be written as A");
ok(!mayWriteUnder(A, B), "A's rows may NOT be written as B");
ok(!mayWriteUnder(B, A), 'and not the other way round either');
// The adoption case the provider protects: a set typed while the auth read was
// still in flight has reached no store and belongs to whoever is at the phone.
ok(mayWriteUnder(null, B), 'an unclaimed list may be adopted by the account that answered');
ok(mayWriteUnder(undefined, B), 'and an undefined one');
ok(mayWriteUnder('', B), 'and a blank one');
// An insert is a claim about a person. There is no person here.
ok(!mayWriteUnder(A, null), 'nothing may be written with no account');
ok(!mayWriteUnder(null, null), 'not even an unclaimed list');
ok(!mayWriteUnder(A, ''), 'a blank writer is not an account');
ok(!mayWriteUnder(A, 'unknown'), "and neither is 'unknown'");
ok(!mayWriteUnder('unknown', B), "rows held under 'unknown' are not unclaimed rows");

/* ── 3. what an auth read means for the list ──────────────────────────────── */

eq(listOwnerAct(A, signedIn(A)), 'keep', 'the same account keeps its list');
eq(listOwnerAct(A, signedIn(B)), 'drop', "B must not inherit A's list");
eq(listOwnerAct(null, signedIn(B)), 'keep', 'an unclaimed list is adopted');
eq(listOwnerAct(A, signedOut), 'drop', 'a sign-out lets go of the list');
eq(listOwnerAct(null, signedOut), 'keep', 'there is nothing to let go of');
// The whole point of taking a UidRead rather than a uid. An outage resolves
// with `uid: null` exactly as a sign-out does, and calling it one would clear a
// member's unsent session over a dropped connection.
eq(listOwnerAct(A, unreadable), 'hold', 'an outage moves nothing');
eq(listOwnerAct(null, unreadable), 'hold', 'not even an unclaimed list');
eq(listOwnerAct(B, unreadable), 'hold', 'whoever is held');
// Told apart by `fate`, never by `!uid`: an empty-string uid with a null fate
// is not a member of UidRead that uidFromAuth can produce, and if one were
// forged it must not be treated as an account.
eq(listOwnerAct(A, { uid: '', fate: null } as UidRead), 'keep',
  'a blank uid claims nothing, so nothing is foreign to it');
ok(!mayWriteUnder(A, ''), 'and it may still not be written under');

/* ── 4. sign-in → sign-out → sign-in, on one handset ──────────────────────── */
{
  // The list owner as the provider keeps it: null until an account claims it.
  let held: string | null = null;

  // A signs in. The list is unclaimed, so A adopts it.
  const first = listOwnerAct(held, signedIn(A));
  eq(first, 'keep', 'A adopts an unclaimed list');
  held = A;

  // A logs a session in a basement. The insert is never answered; the entries
  // stay in memory, queued, and on the disk under `queueCacheKey(A)`.
  ok(mayWriteUnder(held, A), "A's own session goes up as A's");

  // A signs out. The rows are let go of — NOT deleted: they are still under
  // A's own account-scoped key and come back whole when A returns.
  const out = listOwnerAct(held, signedOut);
  eq(out, 'drop', 'signing out lets go of the list');
  held = null;

  // B signs in on the same handset.
  const second = listOwnerAct(held, signedIn(B));
  eq(second, 'keep', 'B starts from an empty list');
  held = B;
  ok(mayWriteUnder(held, B), "B's own sets go up as B's");

  // And the counterfactual: had the drop not happened, the merge would have
  // offered A's rows to B's insert. This is the assertion the defect fails.
  ok(!mayWriteUnder(A, B), "A's held rows are refused under B's id");
}

/* ── 5. the same sequence with an outage where the sign-out was ───────────── */
{
  let held: string | null = A;

  // The auth host is unreachable. `getSession()` resolves with `session: null`
  // and a retryable error beside it — the same `uid: null` a sign-out gives.
  const act = listOwnerAct(held, unreadable);
  eq(act, 'hold', 'an outage establishes nothing');
  // So nothing moves. A is still the account the list is held for, and A's
  // unsent session is still on screen and still on the disk.
  if (act !== 'hold') held = null;
  eq(held, A, "A's list survives the outage");
  ok(mayWriteUnder(held, A), 'and still goes up as A when the signal returns');

  // The outage clears and A is confirmed. Nothing was lost and nothing was
  // adopted by anybody.
  eq(listOwnerAct(held, signedIn(A)), 'keep', 'A is still A');
}

/* ── 6. the reconnect edge, which races the hydrate ───────────────────────── */
{
  // `flushQueue` is registered once and reads the account and the list
  // independently. Between an account change and the hydrate landing, those two
  // disagree — and this is the guard that stands there.
  const listOwner = A;   // the hydrate has not re-run yet
  const account = B;     // onAuthStateChange has already fired
  ok(!mayWriteUnder(listOwner, account), 'a flush across an account change is refused');
  eq(listOwnerAct(listOwner, signedIn(account)), 'drop', 'and the hydrate then lets the list go');
}

if (errors.length) {
  console.error('listOwner.test.ts FAILED');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('listOwner.test.ts — ok');
