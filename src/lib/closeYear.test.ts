// The five this file exists to stop.
//
//   1. A YEAR NOBODY READ DRAWN AS A YEAR NOBODY CLOSED. Twelve empty cells
//      over a failed read is a complete, confident falsehood about the one
//      record an owner hands to an accountant. A null list produces no months
//      and no counts at all.
//
//   2. A MONTH THAT HAS NOT HAPPENED COUNTED AS OUTSTANDING. December is not
//      overdue in March, and a view that says so reports a gym nine months
//      behind on its books every January.
//
//   3. A REOPEN THAT DISAPPEARS. `gym_month_closes` stores who reopened a
//      month, when, and the reason `reopenBlocker` forces them to write. A
//      month reopened and then closed again reads as 'closed', and the reopen
//      is still the most interesting thing on the row.
//
//   4. A CLOSE OVER A KNOWN PROBLEM RENDERED AS A CLEAN ONE. `blockers_at_close`
//      is written verbatim when somebody signs a month off anyway, and the
//      whole argument for allowing that is that it is RECORDED.
//
//   5. AN EMPTY CAVEAT. `blockers_at_close` can hold an empty string, and a
//      warning about nothing printed on a document somebody signs teaches the
//      reader to skip the ones that mean something.
//
// Compile with tsc, run with node.
import {
  closeYear, closeYears, closeYearNote, CLOSE_YEAR_UNREAD_NOTE,
} from './closeYear';
import type { MonthCloseRow } from './gymClose';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (r: Partial<MonthCloseRow> & { id: string; monthKey: string }): MonthCloseRow => ({
  closedAt: `${r.monthKey}-05T09:00:00.000Z`, closedBy: null, closedByName: null, note: null,
  takenCents: null, invoicedCents: null, outstandingCents: null, payrollCents: null,
  takenCurrency: null, invoicedCurrency: null, outstandingCurrency: null, payrollCurrency: null,
  currency: null, unmarkedSessions: null, blockersAtClose: null,
  reopenedAt: null, reopenedBy: null, reopenedByName: null, reopenReason: null,
  ...r,
});

/** Mid-September 2026, which is the clock every case below is read against. */
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const state = (y: ReturnType<typeof closeYear>, key: string) =>
  y.months.find((m) => m.key === key)?.state;

/* ── 1. a read that failed is not a year ───────────────────────────────── */
{
  const y = closeYear(2026, null, NOW);
  eq(y.read, false, 'a null history is reported as unread');
  eq(y.months.length, 0, 'and draws no months, so there is no cell to misread');
  eq(y.closed, null, 'nothing was closed is not the answer — nothing is known');
  eq(y.outstanding, null, 'and neither is nothing outstanding');
  eq(y.reopened, null, 'nor nothing reopened');
  eq(y.running, null, 'nor a count of months still running');
  eq(closeYearNote(y), null, 'and there is no sentence to print over it');

  const empty = closeYear(2026, [], NOW);
  eq(empty.read, true, 'an empty history IS a real answer about a gym that has closed nothing');
  eq(empty.months.length, 12, 'and it gets its twelve months');
  eq(empty.closed, 0, 'none of them closed');
}

/* ── 2. the four states ────────────────────────────────────────────────── */
{
  const y = closeYear(2026, [
    row({ id: 'a', monthKey: '2026-01' }),
    // Closed in March, then reopened and not closed again.
    row({ id: 'b', monthKey: '2026-03', reopenedAt: '2026-04-02T10:00:00.000Z', reopenReason: 'A refund landed late.' }),
  ], NOW);

  eq(state(y, '2026-01'), 'closed', 'a close with no reopen on it is the close in force');
  eq(state(y, '2026-02'), 'open', 'a month that ended and was never closed is open');
  eq(state(y, '2026-03'), 'reopened', 'a month whose only close was lifted is reopened, not merely open');
  eq(state(y, '2026-09'), 'running', 'the month in progress has not ended and is not outstanding');
  eq(state(y, '2026-12'), 'running', 'and neither has December');

  eq(y.closed, 1, 'one month is closed');
  eq(y.running, 4, 'September to December have not ended');
  eq(y.outstanding, 7, 'the rest of the ended months are waiting, reopened ones included');
  eq(y.closed! + y.outstanding! + y.running!, 12, 'and every month is in exactly one of the three');

  // The reason is carried through, because it is the thing the column exists
  // for and the thing no comparative view could show.
  const march = y.months.find((m) => m.key === '2026-03')!;
  eq(march.reopens.length, 1, 'the lifted close is kept');
  eq(march.reopens[0].reopenReason, 'A refund landed late.', 'and so is the reason somebody had to write');
  eq(march.live, null, 'and there is no close in force over it');
}

/* ── 3. a reopen survives the month being closed again ─────────────────── */
{
  const y = closeYear(2026, [
    row({ id: 'b2', monthKey: '2026-05' }),
    row({ id: 'b1', monthKey: '2026-05', reopenedAt: '2026-06-01T10:00:00.000Z', reopenReason: 'Two sessions were marked after the close.' }),
  ], NOW);

  eq(state(y, '2026-05'), 'closed', 'a month closed again reads as closed, because it is');
  eq(y.reopened, 1, 'and the year still counts it as a month that was reopened');
  const may = y.months.find((m) => m.key === '2026-05')!;
  eq(may.history.length, 2, 'both rows are the record and both are kept');
  eq(may.live!.id, 'b2', 'the close in force is the one with no reopen on it');
  eq(may.reopens.length, 1, 'and the lifted one is still readable beside it');
}

/* ── 4. a close made over a known problem says so ──────────────────────── */
{
  const y = closeYear(2026, [
    row({ id: 'c', monthKey: '2026-02', blockersAtClose: '3 sessions finished in February with no outcome recorded.' }),
    // The empty-string case. A caveat about nothing is worse than none.
    row({ id: 'd', monthKey: '2026-01', blockersAtClose: '   ' }),
  ], NOW);

  eq(y.overBlockers, 1, 'only the month with something actually recorded counts');
  eq(y.months.find((m) => m.key === '2026-01')!.blockersAtClose, null,
    'a blank blockers column is not a caveat');
  ok(/no outcome recorded/.test(y.months.find((m) => m.key === '2026-02')!.blockersAtClose ?? ''),
    'and a real one is carried verbatim');

  // Read off the LIVE close, not off the history: a problem recorded on a close
  // that was later lifted and re-closed cleanly is not a caveat on today's
  // figures.
  const clean = closeYear(2026, [
    row({ id: 'e2', monthKey: '2026-04' }),
    row({ id: 'e1', monthKey: '2026-04', blockersAtClose: 'Payroll could not be read.', reopenedAt: '2026-05-01T10:00:00.000Z', reopenReason: 'Re-closing it properly.' }),
  ], NOW);
  eq(clean.months.find((m) => m.key === '2026-04')!.blockersAtClose, null,
    'a blocker on a close that was lifted is not a caveat on the one that replaced it');
  eq(clean.overBlockers, 0, 'and it does not count against the year');
  eq(clean.reopened, 1, 'while the reopen itself is still counted');
}

/* ── 5. the years on offer ─────────────────────────────────────────────── */
{
  eq(closeYears([row({ id: 'a', monthKey: '2024-11' }), row({ id: 'b', monthKey: '2026-01' })], NOW).join(','),
    '2026,2024', 'the years with a record, newest first, with this one always in');
  eq(closeYears([], NOW).join(','), '2026', 'a gym with no history is still offered the year it is in');
  eq(closeYears(null, NOW).join(','), '2026',
    'and a failed read fabricates no years — `read` is what says the record is unknown');
  eq(closeYears([row({ id: 'x', monthKey: 'not-a-month' })], NOW).join(','), '2026',
    'a month key that is not one does not become NaN in a picker');
}

/* ── 6. the sentence ───────────────────────────────────────────────────── */
{
  const note = closeYearNote(closeYear(2026, [
    row({ id: 'a', monthKey: '2026-01' }),
    row({ id: 'b', monthKey: '2026-02', blockersAtClose: '1 session unmarked.' }),
    row({ id: 'c', monthKey: '2026-03', reopenedAt: '2026-04-02T10:00:00.000Z', reopenReason: 'why' }),
  ], NOW))!;

  ok(note.includes('2 of the 12 months in 2026 are closed.'), 'it opens with the count that matters');
  ok(/still open/.test(note), 'it names the months that have ended and have not been closed');
  ok(/not finished yet/.test(note), 'and separates the ones that have not happened');
  ok(/reopened/.test(note), 'a reopen is on the statement');
  ok(/in the way/.test(note), 'and so is a month signed off over a known problem');
  ok(!/\s{2}/.test(note), 'with no hole in the sentence');
  ok(note.trim().endsWith('.'), 'and it is a sentence');

  // A clean year says the clean thing and nothing else.
  const tidy = closeYearNote(closeYear(2025, Array.from({ length: 12 }, (_, i) =>
    row({ id: `t${i}`, monthKey: `2025-${String(i + 1).padStart(2, '0')}` })), NOW))!;
  eq(tidy, '12 of the 12 months in 2025 are closed.', 'a year with nothing to report reports nothing');

  ok(!/nothing was closed|no months/i.test(CLOSE_YEAR_UNREAD_NOTE.replace('not a year in which nothing was closed', '')),
    'the unread note never states the year as empty');
  ok(/could not be read/.test(CLOSE_YEAR_UNREAD_NOTE), 'it says the read failed');
  ok(CLOSE_YEAR_UNREAD_NOTE.trim().endsWith('.'), 'and it is a sentence');
}

if (errors.length) { for (const e of errors) console.error('FAIL ' + e); process.exit(1); }
console.log('closeYear: ok');
