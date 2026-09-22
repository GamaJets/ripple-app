// A gym's year of month-ends, read as one document.
//
// ── what there was ───────────────────────────────────────────────────────
//
// `fetchCloses` reads every close and every reopen this gym has ever recorded,
// newest first, and its own header says why it is not filtered: "a month
// closed, reopened and closed again is three rows and a true history, and the
// history is the half an auditor wants". Everything that then READ that list
// threw the year away. `liveCloseFor` picks ONE month out of the set; /close
// renders that month; the history block under it filters to that month too. So
// the only question the record could answer was "is this month closed", asked
// one month at a time, by somebody who already had to know which month to ask
// about.
//
// The questions nobody could ask:
//
//   · Which months of this year were never closed at all? That is the one an
//     accountant asks in January, and the answer lived in twelve page loads.
//   · Which were reopened, when, by whom, and WHY? `gym_month_closes` stores
//     `reopened_at`, `reopened_by` and `reopen_reason` — a written reason, made
//     mandatory by `reopenBlocker` precisely so that a reopen is a decision
//     with an argument attached — and no comparative view existed to read them
//     side by side. A year with four reopens in it is a different gym from a
//     year with none, and nothing could see the difference.
//   · Which were signed off over a KNOWN problem? `blockers_at_close` is
//     written verbatim when somebody closes a month anyway, which
//     src/lib/gymClose.ts argues for at length. Also never compared.
//
// ── null is not an open month ─────────────────────────────────────────────
//
// This is the whole hazard of the feature. A statement of a year is a grid, and
// a grid has a cell for every month whether or not anything was read; the
// obvious implementation hands `rows ?? []` to a lookup and draws twelve empty
// cells, which reads as "this gym closed nothing all year" — a complete, quiet,
// confident falsehood about the one record an owner hands to an accountant.
//
// So a null list does not produce months. `read` is false, `months` is empty
// and every count is null. There is no cell to misread because there is no
// grid. `fetchCloses` throws rather than truncating (`assertWhole`), so a short
// read cannot arrive here looking whole: a year built from a prefix of the
// history would be missing the OLDEST months, which are exactly the ones this
// view exists to find.
//
// ── a month that has not happened is not a month nobody closed ────────────
//
// December is not outstanding in March. `monthEnded` decides it, against the
// same clock /close uses, and 'running' is its own state rather than an
// absence — a screen that counted it among the unclosed would report a gym nine
// months behind on its books every January.
//
// Pure: rows in, a statement out. No client, no formatting of money, no
// sentence about a screen.
import { monthWindow, monthEnded, type MonthKey } from './monthEnd';
import type { MonthCloseRow } from './gymClose';

/**
 * Where one month of the year stands.
 *
 * 'reopened' is deliberately not folded into 'open'. Both mean the month is not
 * closed today and they are not the same fact: one is a month nobody has got to
 * and the other is a month somebody closed and then deliberately took apart,
 * with a written reason sitting on the row. An owner scanning a year needs to
 * see the second one.
 */
export type MonthCloseState = 'closed' | 'reopened' | 'open' | 'running';

export interface YearMonth {
  key: MonthKey;
  /** 'August 2026', in the reader's own language — from `monthWindow`, so the
   *  year view and the month view cannot drift into two spellings. */
  label: string;
  state: MonthCloseState;
  /** The close in force, or null when the month is not closed. */
  live: MonthCloseRow | null;
  /** Every close row for this month, newest first, exactly as read. A month
   *  closed twice has two, and both belong to the record. */
  history: MonthCloseRow[];
  /** The closes that were lifted, newest first. Each carries who lifted it,
   *  when, and the reason they had to write. */
  reopens: MonthCloseRow[];
  /**
   * What stood in the way when this month was signed off, verbatim, or null.
   *
   * Read off the LIVE close and not off the history: a blocker recorded on a
   * close that was later reopened and re-closed cleanly is not a caveat on
   * today's figures. It is still in `history` for anybody reading the whole
   * row.
   */
  blockersAtClose: string | null;
}

export interface CloseYear {
  year: number;
  /**
   * Whether the record was read at all.
   *
   * False means UNKNOWN, and every field below is empty or null for that
   * reason. It is not a year in which nothing was closed, and a screen that
   * draws an empty grid over it says exactly that to an owner.
   */
  read: boolean;
  /** The twelve months, January first. Empty when `read` is false. */
  months: YearMonth[];
  /** Closed today. Null when nothing was read. */
  closed: number | null;
  /** Ended, and not closed today — 'open' and 'reopened' together, because both
   *  are months an accountant is still waiting on. Null when nothing was read. */
  outstanding: number | null;
  /** Months with at least one reopen anywhere in their history, including ones
   *  that were closed again afterwards. Null when nothing was read. */
  reopened: number | null;
  /** Closed with something recorded in the way. Null when nothing was read. */
  overBlockers: number | null;
  /** Months of this year that have not ended yet. Null when nothing was read. */
  running: number | null;
}

/** A blocker string that is present and says something. `blockers_at_close` is
 *  nullable and a close made with nothing in the way writes an empty string
 *  from some paths, and an empty caveat rendered as a caveat is a warning about
 *  nothing on a document somebody signs. */
const stated = (s: string | null): string | null => (s ?? '').trim() || null;

/**
 * One year of month-ends, as a statement.
 *
 * `rows` is `fetchCloses`' whole history — every month, not this year's — and
 * null when that read failed or has not landed. `now` decides which months have
 * ended; it is a parameter for the reason every other clock in this folder is,
 * so the test does not depend on the day it runs.
 */
export function closeYear(
  year: number,
  rows: MonthCloseRow[] | null,
  now: number = Date.now(),
): CloseYear {
  if (rows == null) {
    return { year, read: false, months: [], closed: null, outstanding: null, reopened: null, overBlockers: null, running: null };
  }

  const months: YearMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const w = monthWindow(key);
    // Unreachable for a four-digit year and a month in 1..12, and it is a
    // `continue` rather than a `!` so that a caller handing in a year this
    // function cannot describe gets eleven honest months instead of a crash on
    // the page an accountant is reading.
    if (!w) continue;
    const history = rows.filter((r) => r.monthKey === key);
    // `liveCloseFor`'s rule, not a second one: a close with no `reopened_at` is
    // the close in force. Applied here rather than imported to keep this module
    // free of the read layer — gymClose.ts holds the Supabase calls, and a test
    // that runs under plain node must not pull them in.
    const live = history.find((r) => !r.reopenedAt) ?? null;
    const reopens = history.filter((r) => r.reopenedAt);
    const state: MonthCloseState = live ? 'closed'
      : !monthEnded(w, now) ? 'running'
      : reopens.length ? 'reopened'
      : 'open';
    months.push({
      key, label: w.label, state, live, history, reopens,
      blockersAtClose: live ? stated(live.blockersAtClose) : null,
    });
  }

  const count = (f: (m: YearMonth) => boolean) => months.filter(f).length;
  return {
    year,
    read: true,
    months,
    closed: count((m) => m.state === 'closed'),
    outstanding: count((m) => m.state === 'open' || m.state === 'reopened'),
    // Every month that has EVER been reopened, not just the ones sitting open
    // today. A month closed in error, reopened, and closed again correctly is
    // the most interesting row on the page and the one a 'reopened' state alone
    // cannot see, because by then its state is 'closed'.
    reopened: count((m) => m.reopens.length > 0),
    overBlockers: count((m) => m.blockersAtClose != null),
    running: count((m) => m.state === 'running'),
  };
}

/**
 * The years this gym has a record in, newest first, with the current one always
 * present.
 *
 * For the picker above the statement. The current year is included even when
 * nothing has been closed in it yet, because that is the year whose gaps somebody
 * is most likely looking for; the rest come from the rows, so a gym cannot be
 * offered a year it has no history in.
 *
 * Null in, empty out — and the caller must not render an empty picker as "this
 * gym has one year of records". `closeYear`'s `read` flag is the one to branch
 * on; this returns `[]` for a null list only so the list itself is never
 * fabricated.
 */
export function closeYears(rows: MonthCloseRow[] | null, now: number = Date.now()): number[] {
  const years = new Set<number>([new Date(now).getFullYear()]);
  for (const r of rows ?? []) {
    const y = Number((r.monthKey ?? '').slice(0, 4));
    // A month key that is not one is dropped rather than becoming NaN in a
    // picker. Nothing writes such a row today; `month_key` is plain text.
    if (Number.isInteger(y) && y > 1900 && y < 9999) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The year in a sentence, for the line under the grid.
 *
 * Returns null when nothing was read, which is the caller's cue to print the
 * sentence about the failed read instead. A summary assembled over a null would
 * say "0 of 12 months are closed", which is the claim this module exists to
 * refuse.
 */
export function closeYearNote(y: CloseYear): string | null {
  if (!y.read || y.closed == null || y.outstanding == null || y.reopened == null || y.running == null) return null;
  const parts = [`${y.closed} of the ${y.months.length} months in ${y.year} are closed.`];
  if (y.outstanding > 0) {
    parts.push(`${y.outstanding} ${y.outstanding === 1 ? 'has' : 'have'} ended and ${y.outstanding === 1 ? 'is' : 'are'} still open.`);
  }
  if (y.running > 0) {
    parts.push(`${y.running} ${y.running === 1 ? 'has' : 'have'} not finished yet, so ${y.running === 1 ? 'it is' : 'they are'} not waiting on anybody.`);
  }
  if (y.reopened > 0) {
    parts.push(`${y.reopened} month${s(y.reopened)} ${y.reopened === 1 ? 'was' : 'were'} reopened after being closed, with the reason recorded against ${y.reopened === 1 ? 'it' : 'each'}.`);
  }
  if (y.overBlockers != null && y.overBlockers > 0) {
    parts.push(`${y.overBlockers} ${y.overBlockers === 1 ? 'was' : 'were'} signed off with something still in the way, which is printed on the row.`);
  }
  return parts.join(' ');
}

/** What the screen says instead of a grid when the record did not read. One
 *  wording in one place, for the reason `MIXED_CURRENCY_NOTE` gives: a year of
 *  month-ends that could not be read must never render as a year with nothing
 *  in it, and the sentence has to say which of the two it is. */
export const CLOSE_YEAR_UNREAD_NOTE =
  'This gym’s record of closed months could not be read, so there is no year to '
  + 'show. That is not a year in which nothing was closed. It is a query that '
  + 'did not come back, and nothing below has been worked out from it.';
