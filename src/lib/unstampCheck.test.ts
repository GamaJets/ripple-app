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
//   THE SENTENCE     it says where the run stands, and only what is true of it
//
// That last one is a second defect, found after the first was fixed. Both
// refusals used to end "Nothing has been changed" — and this runs AFTER the
// sessions update, so on a shortfall of 29-out-of-31 twenty-nine rows have come
// loose and on a surplus every counted row has. src/lib/reversalState.ts prints
// a dated MEASURED clause beside this one on studio-web/app/payroll/page.tsx
// ("Checked just now: 2 of the 31 sessions it paid for are still stamped
// against it; the other 29 are not"), so the two contradicted each other on one
// screen — and the false one was the reassuring one, over a reversal that can
// never be retried. Zero unstamped is the one count where nothing HAS changed,
// and that is the one count where the sentence still says so.
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
  ok(!!why && why.includes('The settlement is untouched and still reads as paid'),
    'and it says the run was not marked reversed, which is the point of refusing before the fourth write');
  ok(!!why && !/[Nn]othing has been changed/.test(why),
    'and it does NOT say nothing has been changed, because 29 sessions have already come loose by now');
  ok(!!why && why.includes('29 sessions have already come loose'),
    'it names how many did come loose, which is the number the owner has to act on');
  ok(!!why && /pays those hours a second time/.test(why),
    'and says what that costs — the same hours paid twice, which is the live risk after a part-landed unstamp');
  ok(!!why && /will not finish the job/.test(why),
    'and says pressing Reverse again cannot fix it, because the retry would match nothing and be refused');
  ok(!!why && why.includes('owed'),
    'and says what going ahead would cost — the coach’s money, not a database inconsistency');

  const one = unstampBlocker(4, 3);
  ok(!!one && one.includes('1 session did not come loose'), 'a shortfall of one is singular');
  ok(!!one && !one.includes('1 sessions'), 'and never "1 sessions"');
  ok(!!one && one.includes('that session stays'), 'the consequence clause agrees with it');
  ok(!!unstampBlocker(4, 2) && unstampBlocker(4, 2)!.includes('those sessions stay'),
    'and reads as a plural when there is more than one');

  const loose1 = unstampBlocker(4, 1);
  ok(!!loose1 && loose1.includes('1 session has already come loose'),
    'one session having come loose is singular in the loose clause too');
  ok(!!loose1 && !/1 sessions?\s+have/.test(loose1), 'and never "1 session have"');
  ok(!!loose1 && loose1.includes('pays that hour a second time'),
    'and its consequence clause is singular with it');
  ok(!!unstampBlocker(4, 2) && unstampBlocker(4, 2)!.includes('2 sessions have already come loose'),
    'and it is plural above one');

  const all = unstampBlocker(12, 0);
  ok(all !== null, 'the worst case — not one session came loose — is refused like any other');
  ok(!!all && all.includes('only 0 of them'),
    'and says so plainly rather than reading as though something worked');
  ok(!!all && all.includes('Nothing has been changed'),
    'and THIS is the one count where nothing has been changed, so it is the one that says so');
  ok(!!all && !/have already come loose|come loose from it/.test(all),
    'and it never invents a loose session over a run nothing touched — an owner sent looking for a repair that is not needed is the other way to be wrong here');
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
  ok(!!why && why.includes('The settlement is untouched and still reads as paid'),
    'and it says the run was not marked reversed');
  ok(!!why && !/[Nn]othing has been changed/.test(why),
    'and it does NOT say nothing has been changed — a surplus is 12 rows that definitely came loose');
  ok(!!why && why.includes('12 sessions have already come loose'),
    'it names them, because they are payable a second time until the run is put right');
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
 * must end with WHERE THE RUN STANDS. That is the settlement clause — true at
 * every count, because this throws before the fourth write — and it is not the
 * same as "nothing has changed", which is true only at a count of zero.
 */
{
  for (const [claimed, got] of [[31, 29], [10, 12], [5, null], [12, 0]] as const) {
    const why = unstampBlocker(claimed, got);
    ok(!!why && /not taken back/.test(why), `the refusal for (${claimed}, ${got}) opens by saying the reversal did not happen`);
    ok(!!why && /settlement is untouched/.test(why),
      `and for (${claimed}, ${got}) it says the settlement was not touched, which is what the owner acts on`);
    ok(!!why && !/undefined|null|NaN/.test(why), `and for (${claimed}, ${got}) it leaks no values`);
    ok(!!why && !/sorry|apolog/i.test(why), `and for (${claimed}, ${got}) it does not apologise`);
  }

  // The claim itself, isolated: it is made at exactly one count — zero — and
  // refused at every other. A regex that merely ALLOWED it, which is what the
  // old sentence check did, passed the version that printed it over 29 loose
  // sessions.
  for (const claimed of [1, 12, 31] as const) {
    const why = unstampBlocker(claimed, 0);
    ok(!!why && /Nothing has been changed/.test(why),
      `nothing came loose at (${claimed}, 0), so that is the count where the sentence says nothing has been changed`);
  }
  for (const [claimed, got] of [[31, 29], [4, 1], [4, 3], [10, 12], [1, 4]] as const) {
    const why = unstampBlocker(claimed, got);
    ok(!!why && !/[Nn]othing has been changed/.test(why),
      `something DID come loose at (${claimed}, ${got}), so the sentence must not say nothing has been changed`);
  }
}

if (errors.length) {
  console.error(`unstampCheck: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('unstampCheck: all assertions passed');
