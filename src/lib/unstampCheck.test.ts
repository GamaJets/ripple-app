// Taking a payroll run back, and the sessions that did not come loose.
// Compile with tsc, run with node.
//
// The defect: `reverseSettlement` asked PostgREST for `{ count: 'exact' }` on
// the three unstamps and then read only `.error`. Every policy on those tables
// is a USING clause, and a USING clause filters — 204, null error, zero rows —
// so a session the owner's UPDATE could not see stayed stamped against a run
// that was then marked reversed. `settleableSessions` skips anything carrying a
// settlement id, so that session never returns to "Owed now" and the coach is
// never paid for it.
//
//   THE MATCH        every session came loose, and the reversal proceeds
//   THE SHORTFALL    fewer came loose than the run paid for — refuse
//   THE SURPLUS      more came loose than the run says it covered — also refuse
//   NOBODY COUNTED   a missing count is a failure, never a pass
//   THE SENTENCE     it says nothing has changed, because nothing has
import { unstampBlocker } from './unstampCheck';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── THE MATCH ────────────────────────────────────────────────────────────
 * The ordinary reversal, which must not become harder to do.
 */
{
  eq(unstampBlocker(31, 31), null, 'a run of 31 sessions that freed 31 is reversed');
  eq(unstampBlocker(1, 1), null, 'and a run of one');
  eq(unstampBlocker(0, 0), null,
    'a run with no sessions at all — a coach paid only for classes and a reimbursement — reverses cleanly');
}

/* ── THE SHORTFALL ────────────────────────────────────────────────────────
 * The live case. `sessions.tenant_id` is nullable and `sessions_gym_owner_u`
 * requires it to be NOT NULL, so a stamped session can be readable by the owner
 * and invisible to their UPDATE.
 */
{
  const why = unstampBlocker(31, 29);
  ok(why !== null, 'a run that freed fewer sessions than it paid for is refused');
  ok(!!why && why.includes('31'), 'the refusal names what the run says it paid for');
  ok(!!why && why.includes('29'), 'and what actually came loose');
  ok(!!why && why.includes('2 sessions'), 'and the difference, which is the number somebody has to chase');
  ok(!!why && why.includes('Nothing has been changed'),
    'and it says nothing has changed, which is the point of refusing before the settlement is touched');
  ok(!!why && why.includes('owed'),
    'and says what going ahead would cost — the coach’s money, not a database inconsistency');

  const one = unstampBlocker(4, 3);
  ok(!!one && one.includes('1 session did not come loose'), 'a shortfall of one is singular');
  ok(!!one && !one.includes('1 sessions'), 'and never "1 sessions"');
  ok(!!one && one.includes('that session stays'), 'the consequence clause agrees with it');
  ok(!!unstampBlocker(4, 2) && unstampBlocker(4, 2)!.includes('those sessions stay'),
    'and reads as a plural when there is more than one');

  const all = unstampBlocker(12, 0);
  ok(all !== null, 'the worst case — not one session came loose — is refused like any other');
  ok(!!all && all.includes('only 0 of them'),
    'and says so plainly rather than reading as though something worked');
}

/* ── THE SURPLUS ──────────────────────────────────────────────────────────
 * More rows came loose than the settlement says it covered. Two records
 * disagree about what was paid for, and a reversal is not the place to decide
 * which is right.
 */
{
  const why = unstampBlocker(10, 12);
  ok(why !== null, 'a surplus is refused too, not waved through as "at least nothing was stranded"');
  ok(!!why && why.includes('2 sessions more'), 'and it says by how many');
  ok(!!why && why.includes('disagree'), 'and names the actual problem, which is two records disagreeing');
  ok(!!why && why.includes('Nothing has been changed'), 'nothing has changed here either');
}

/* ── NOBODY COUNTED ───────────────────────────────────────────────────────
 * The case this whole family of functions exists for: `count` is null unless
 * the caller asked for it, and treating null as "fine" re-admits every call
 * site that forgot.
 */
{
  const why = unstampBlocker(31, null);
  ok(why !== null, 'a missing count is a refusal, never a pass');
  ok(!!why && why.includes('how many'), 'and it names the omission rather than blaming the data');
  eq(unstampBlocker(31, undefined), why, 'undefined is the same fact as null');
  eq(unstampBlocker(0, null), why, 'even for a run with no sessions — nobody counted is nobody counted');
}

/* ── THE SENTENCE ─────────────────────────────────────────────────────────
 * Every refusal here is read by a gym owner mid-task, and every one of them
 * must end with the fact that acts on: the run is still as it was.
 */
{
  for (const [claimed, got] of [[31, 29], [10, 12], [5, null]] as const) {
    const why = unstampBlocker(claimed, got);
    ok(!!why && /not taken back/.test(why), `the refusal for (${claimed}, ${got}) opens by saying the reversal did not happen`);
    ok(!!why && /[Nn]othing (has been changed|is untouched|has changed)|untouched/.test(why),
      `and for (${claimed}, ${got}) it says the record is untouched`);
    ok(!!why && !/undefined|null|NaN/.test(why), `and for (${claimed}, ${got}) it leaks no values`);
  }
}

if (errors.length) {
  console.error(`unstampCheck: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('unstampCheck: all assertions passed');
