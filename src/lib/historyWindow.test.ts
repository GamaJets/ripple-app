// Tests for historyWindow — the month a truncated read is not allowed to draw.
//
// The defect: app/(client)/history.tsx read the whole `workouts` table with no
// limit, so PostgREST's silent 1000-row ceiling handed a long-training member a
// prefix of their own history and the page reported it as the whole thing. The
// read is now newest-first and capped, which moves the cut to the far end — and
// leaves exactly one thing wrong: the oldest month on the page stopped part-way
// through, so its bar is a fraction of a month drawn at the same scale as its
// whole neighbours. On this chart a short bar means "you trained less that
// month". It does not mean that.
//
// So the assertions are about the two things that must both be true:
//
//   · on a WHOLE read nothing is dropped. A month lost from every member with
//     under a thousand sessions, to protect the handful above it, is a bigger
//     bug than the one being fixed — so the no-op case is asserted first and
//     hardest.
//   · on a TRUNCATED read the oldest month goes, and the caller is TOLD which
//     one, because a gap the member is not told about is read as a quiet month
//     and that is the same lie in a smaller place.
//
// Compile with tsc then run with node, like plateMath.test.ts.
import { wholeMonths } from './historyWindow';
import { monthKey } from './longView';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A logged session on a given LOCAL date. `monthKey` reads the local calendar
 *  month deliberately (an evening session on 31 January is January to the
 *  person who trained), so these are built local rather than from a Z string —
 *  otherwise the fixtures would drift a month either side of UTC and the test
 *  would pass or fail on the machine's timezone rather than on the code. */
const at = (y: number, m: number, d: number): WorkoutEntry =>
  ({ id: `${y}-${m}-${d}`, t: new Date(y, m - 1, d, 12, 0, 0).toISOString() } as unknown as WorkoutEntry);

const keys = (l: WorkoutEntry[]) => l.map((e) => e.id).join(',');

// ── a whole read is untouched, which is the common case by a mile ─────────
{
  const log = [at(2024, 1, 5), at(2024, 2, 6), at(2024, 3, 7)];
  const r = wholeMonths(log, false);
  eq(r.droppedMonth, null, 'a read that was not truncated has nothing to drop');
  eq(r.log.length, 3, 'and loses no entries');
  eq(r.log, log, 'the same array is handed straight back — every member under the cap keeps their first month');
}

// ── a truncated read loses its oldest month, and only that one ────────────
{
  const log = [at(2024, 1, 20), at(2024, 1, 28), at(2024, 2, 3), at(2024, 3, 9)];
  const r = wholeMonths(log, true);
  eq(r.droppedMonth, '2024-01', 'the month the read stopped inside is named, so the screen can say where the page starts');
  eq(keys(r.log), '2024-2-3,2024-3-9', 'both January entries go — a part-month is dropped whole, not trimmed');
}

// ── order in is not assumed ───────────────────────────────────────────────
//
// The screen reverses a descending read into ascending before calling this, and
// a future caller may not. "Oldest" must be found by comparing months, not by
// taking the first element — taking log[0] on a newest-first array would drop
// THIS month, which is the end every sentence on that page is about.
{
  const log = [at(2024, 3, 9), at(2024, 1, 20), at(2024, 2, 3)];
  const r = wholeMonths(log, true);
  eq(r.droppedMonth, '2024-01', 'the oldest month is found by month, not by position');
  eq(keys(r.log), '2024-3-9,2024-2-3', 'and the remaining entries keep the order they came in');
}

// ── a year boundary is not a string ordering accident ─────────────────────
//
// Keys are 'YYYY-MM' zero-padded precisely so `<` on the string is `<` on the
// month. December 2023 must lose to January 2024, and '2023-12' < '2024-01'
// only holds because the month is padded.
{
  const log = [at(2023, 12, 30), at(2024, 1, 2)];
  const r = wholeMonths(log, true);
  eq(r.droppedMonth, '2023-12', 'December of the previous year is older than January of this one');
  eq(keys(r.log), '2024-1-2', 'and only the newer month survives');
}
{
  const log = [at(2024, 9, 1), at(2024, 10, 1)];
  const r = wholeMonths(log, true);
  eq(r.droppedMonth, '2024-09', 'September loses to October — the pad is what makes 09 < 10 rather than "9" > "1"');
}

// ── the set that is all one month is kept ─────────────────────────────────
//
// Dropping it would leave the screen with nothing and the empty state saying
// "Nothing Logged Yet" to somebody who has just been told they trained too much
// to read in one go. A single clearly-labelled part-month is the lesser wrong,
// and the caller is told nothing was dropped so it does not print a gap that
// is not there.
{
  const log = [at(2024, 5, 1), at(2024, 5, 2), at(2024, 5, 3)];
  const r = wholeMonths(log, true);
  eq(r.log.length, 3, 'a truncated read that is all one month keeps every entry');
  eq(r.droppedMonth, null, 'and reports no drop, because there was none');
}

// ── an empty read ─────────────────────────────────────────────────────────
{
  const r = wholeMonths([], true);
  eq(r.log.length, 0, 'nothing in, nothing out');
  eq(r.droppedMonth, null, 'and nothing to name');
}

// ── a corrupt timestamp is kept, not silently subtracted ──────────────────
//
// `monthKey` returns null for an unparseable date and the rest of longView.ts
// already carries that through as a null figure. Dropping such a row here would
// be a second silent subtraction of exactly the kind this module exists to stop.
{
  const bad = { id: 'bad', t: 'not-a-date' } as unknown as WorkoutEntry;
  const log = [bad, at(2024, 1, 5), at(2024, 2, 5)];
  const r = wholeMonths(log, true);
  eq(r.droppedMonth, '2024-01', 'an unreadable row does not become the oldest month');
  ok(r.log.some((e) => e.id === 'bad'), 'and it is still in the set — it is handled downstream, not deleted here');
}

/* ── the month the SCREEN is allowed to name ───────────────────────────────
 *
 * `wholeMonths` is correct on its own and always was. What was wrong was one
 * line of the composition around it in app/(client)/history.tsx, and no
 * assertion here could see it because the fault was in which of the two return
 * values got printed:
 *
 *     partialBefore: page.truncated ? whole.droppedMonth ?? … : null
 *
 * `droppedMonth` is the month that was REMOVED. The banner it feeds reads
 * "Read back as far as {month}" and "anything before {month} is on record and
 * not counted here" — two sentences that are both one month early, about a
 * month the page does not have. The Hero underneath, drawn off the first month
 * it DOES have, said "Lifted since Apr 2024, at least" while the banner over it
 * said March.
 *
 * So this asserts the invariant the banner needs rather than a value: the month
 * it names must be a month the page is actually holding, and nothing older may
 * be on the page either — that is the whole meaning of "read back as far as".
 * `bannerMonth` is the screen's expression, kept here verbatim so the two
 * cannot drift; src/lib/memberLookup.test.ts tests app/(client)/access.tsx the
 * same way and for the same reason.
 */
const bannerMonth = (log: WorkoutEntry[], truncated: boolean): string | null => {
  const whole = wholeMonths(log, truncated);
  if (!truncated) return null;
  for (const e of whole.log) {
    const k = monthKey(e.t);
    if (k != null) return k;
  }
  return null;
};

/** Every month key on the page, in the order the entries arrive. */
const monthsOf = (log: WorkoutEntry[]): string[] => {
  const out: string[] = [];
  for (const e of log) { const k = monthKey(e.t); if (k != null && !out.includes(k)) out.push(k); }
  return out;
};

// A read cut inside January: the page starts in February, and February is what
// the banner has to say. Naming January claims a month that is not there and
// leaves January itself unaccounted for by the sentence written to account for
// the gap.
{
  const log = [at(2024, 1, 20), at(2024, 1, 28), at(2024, 2, 3), at(2024, 3, 9)];
  const named = bannerMonth(log, true);
  const onPage = monthsOf(wholeMonths(log, true).log);
  eq(named, '2024-02', 'the banner names the oldest month the page still holds, not the one dropped from it');
  ok(named != null && onPage.includes(named), 'a banner may only name a month that is on the page');
  ok(onPage.every((k) => named != null && k >= named), 'and nothing older than it may be on the page — that is what "read back as far as" means');
  ok(named !== wholeMonths(log, true).droppedMonth, 'the dropped month is not the month the page reaches');
}

// The screen's other arm, and the one the old expression was actually written
// for: a truncated page that is all ONE month. `wholeMonths` keeps it whole and
// reports no drop, so the oldest month on the page IS that month and the banner
// says so. The invariant is the same one; only the arm is different.
{
  const log = [at(2024, 5, 1), at(2024, 5, 2), at(2024, 5, 3)];
  const named = bannerMonth(log, true);
  eq(named, '2024-05', 'an all-one-month page reaches back to that month, and the banner names it');
  ok(monthsOf(wholeMonths(log, true).log).every((k) => named != null && k >= named), 'nothing older is on the page');
}

// A year boundary, because '2023-12' vs '2024-01' is where an off-by-one turns
// into an off-by-a-year in the printed label.
{
  const log = [at(2023, 12, 30), at(2024, 1, 2), at(2024, 2, 2)];
  eq(bannerMonth(log, true), '2024-01', 'December was dropped, so the page reaches back to January of the next year');
}

// A whole read names nothing, because there is no banner to draw.
{
  const log = [at(2024, 1, 5), at(2024, 2, 6)];
  eq(bannerMonth(log, false), null, 'a read that came back whole has no truncation notice');
}

// An unreadable timestamp is kept by `wholeMonths` and must not become the
// month the banner names — `monthKey` returns null for it, so the scan walks
// past rather than printing an empty label into the sentence.
{
  const bad = { id: 'bad', t: 'not-a-date' } as unknown as WorkoutEntry;
  const log = [bad, at(2024, 1, 5), at(2024, 2, 5), at(2024, 3, 5)];
  eq(bannerMonth(log, true), '2024-02', 'a row with no month is stepped over rather than named');
}

if (errors.length) {
  console.error(`historyWindow.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('historyWindow.test.ts — ok');
