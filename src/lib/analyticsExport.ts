// The analytics screen, out of the app.
//
// app/(trainer)/statement.tsx already does this for the money — a PDF, a
// summary CSV and a line-item CSV — and the coach has the habit. Analytics had
// no share action at all, so the one screen a coach would show an accountant,
// a landlord or a prospective gym partner was the one screen they could only
// photograph.
//
// ── What makes this different from the roster export ──────────────────────
//
// `rosterExport` is a list. This is a set of FIGURES, and a figure has a
// property a list does not: it can be wrong without being visibly short. A
// roster CSV missing two hundred people is at least the right shape; an
// analytics CSV whose "Clients" cell holds a number computed from a truncated
// read is a spreadsheet cell containing a lie, and it is a cell somebody will
// paste into an email.
//
// So every figure here is `number | null`, `csvCell` writes null as an EMPTY
// cell, and the file carries a line saying which of them are empty and why.
// That is the same discipline `fig()` keeps on screen — a dash, never a zero —
// carried into a format where a zero would be indistinguishable from a
// measurement.
//
// ── And why there is no PDF here ──────────────────────────────────────────
//
// The statement produces one because a statement is a DOCUMENT: it has a
// period, a heading, an issuer and a reader who is not the coach. Analytics is
// a working screen and its figures move every day. A PDF of it would look like
// a statement of record and would be nothing of the kind — dated, printable,
// and superseded by the time it was opened — so what leaves is a CSV a coach
// can put in a spreadsheet beside their own workings.
//
// Pure. It formats rows a screen has already loaded.
import type { LoadStatus } from '../ui/loadStatus';
import { num } from './format';
import { toCsv, type Cell } from './gymExport';
import { MONTH_LABELS } from './monthlyHistory';

/**
 * Everything the analytics screen can say about itself.
 *
 * Every figure is nullable and null MEANS UNKNOWN. There is no field here whose
 * absence may be written as zero, and that is enforced by the type rather than
 * by remembering — the screen already computes each of these as `number | null`
 * for exactly this reason, so it hands them straight over.
 */
export interface AnalyticsSnapshot {
  /** The gym's ISO code, or null when nobody has set one. Every amount in the
   *  file is denominated by this and NONE of them is written without it — a
   *  bare figure in a spreadsheet is read in whatever currency the reader is
   *  thinking in. */
  currency: string | null;
  sessionsThisMonth: number | null;
  /**
   * Sessions that happened this month with no outcome recorded against them.
   *
   * Optional so that a caller which has not established it writes no row rather
   * than a zero — and it is exported at all because the figure above is
   * meaningless beside it. "12 delivered" out of a month with nine sessions
   * nobody marked is not a quiet month, and a spreadsheet is precisely where
   * that distinction is lost: a reader adds up a column and nothing on the
   * page says what is missing from it. Null is an empty cell, never a nought.
   */
  sessionsUnmarked?: number | null;
  /** Sessions delivered × the coach's own session rate. Not takings, not
   *  earnings, and the file says so on its own face. */
  revenueAtOwnRate: number | null;
  clients: number | null;
  avgAdherencePct: number | null;
  onTrack: number | null;
  watch: number | null;
  atRisk: number | null;
  /** The recorded revenue history, oldest first, aligned with `months`. Nulls
   *  are months with no snapshot and stay empty cells: a month nobody recorded
   *  is not a month of nothing. */
  history: (number | null)[];
  /** 'YYYY-MM' per point in `history`. */
  months: string[];
}

/** How far the figures can be trusted, and which read let them down. Passed
 *  separately from the figures so the file can name the cause rather than only
 *  showing holes. */
export interface AnalyticsReads {
  roster: LoadStatus;
  sessions: LoadStatus;
  history: LoadStatus;
}

/** The month label a person reads — 'Aug 2026' — from a 'YYYY-MM' key. Written
 *  here rather than with `toLocaleDateString` because `new Date('2026-08')` is
 *  UTC and dates the column a month early for nobody but is one more place a
 *  timezone can bite. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!m) return key;
  return `${MONTH_LABELS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The sentence at the top of the file, or null when every read was whole.
 *
 * Names the reads by what they are to the coach ("your roster", "your
 * sessions") rather than by table, because the person opening this in a
 * spreadsheet next March will not remember which screen it came from.
 */
export function analyticsGapWarning(reads: AnalyticsReads): string | null {
  const bad: string[] = [];
  const say = (s: LoadStatus, what: string) => {
    if (s === 'error') bad.push(`${what} could not be read`);
    else if (s === 'partial') bad.push(`${what} came back at its row limit, so it is not all of them`);
    else if (s === 'loading') bad.push(`${what} had not finished loading`);
  };
  say(reads.roster, 'your roster');
  say(reads.sessions, 'your sessions');
  say(reads.history, 'your recorded months');
  if (!bad.length) return null;
  const list = bad.length === 1 ? bad[0] : `${bad.slice(0, -1).join(', ')} and ${bad[bad.length - 1]}`;
  return `INCOMPLETE. When this was exported ${list}. Empty cells below mean the figure is UNKNOWN — they do not mean zero, and a total or an average built over them would be wrong rather than small.`;
}

/** What the figures are, said in the file. A coach mails this on, and by then
 *  the screen's own caveats are not in the room. */
export const EXPORT_BASIS =
  'Sessions are the ones whose outcome you RECORDED as delivered in this calendar month. A booking whose time has passed is not one of them, and a session nobody has marked is counted neither as delivered nor as missed — it is on its own row. The revenue figure is the delivered count multiplied by the session rate on your own profile — it is not what anybody has paid you, it is not net of any fee, and nothing here has been reconciled against Stripe or a bank. Cash and transfers you have recorded are not in it, and neither are packages or subscription renewals: those are on the Money screen.';

export interface AnalyticsExport {
  csv: string;
  filename: string;
  /** True only when every read behind the figures was whole. */
  complete: boolean;
  /** The sentence to put in front of the coach before they share. Null when
   *  complete. */
  warning: string | null;
}

/**
 * Build the file.
 *
 * `on` is the coach's own calendar day, ISO, passed in rather than read from
 * the clock — `new Date().toISOString()` is UTC and dates the file the day
 * before for anybody west of Greenwich.
 *
 * Two sections in one file rather than two files, because a phone share sheet
 * takes ONE file: the figures as label/value rows, then the recorded months as
 * their own table underneath. A companion file would be honest in this
 * repository and absent from the coach's email.
 */
export function buildAnalyticsExport(
  snap: AnalyticsSnapshot,
  reads: AnalyticsReads,
  on: string,
): AnalyticsExport {
  const warning = analyticsGapWarning(reads);
  const complete = warning === null;
  // The currency is a COLUMN rather than being pasted onto each amount, so the
  // amounts stay numeric and a spreadsheet can add them up. An amount with no
  // currency is still written — it is the coach's own arithmetic on their own
  // rate — and the column says so, which is the honest version of a figure
  // whose unit nobody has set.
  const cur = snap.currency ?? '';

  const rows: Cell[][] = [
    ['Exported', on, ''],
    ['Currency', cur || 'not set — amounts below have no unit', ''],
    ['', '', ''],
    ['Sessions delivered this month', snap.sessionsThisMonth, ''],
    ['Sessions this month still to be marked', snap.sessionsUnmarked ?? null, ''],
    ['Revenue at your own session rate', snap.revenueAtOwnRate, cur],
    ['Clients', snap.clients, ''],
    ['Average adherence %', snap.avgAdherencePct, ''],
    ['On track', snap.onTrack, ''],
    ['Watch', snap.watch, ''],
    ['At risk', snap.atRisk, ''],
    ['', '', ''],
    ['Recorded month', 'Revenue at your own session rate', 'Currency'],
    ...snap.months.map((m, i): Cell[] => [monthLabel(m), snap.history[i] ?? null, snap.history[i] == null ? '' : cur]),
  ];

  const header = ['Figure', 'Value', 'Currency'];
  const csv = complete
    ? toCsv(header, [...rows, ['', '', ''], [EXPORT_BASIS, '', '']])
    // The banner is a one-cell row ABOVE the header so a reader meets it before
    // the data. Same shape as the roster export, and the empty cells keep the
    // sheet rectangular.
    : toCsv([warning as string, '', ''], [header, ...rows, ['', '', ''], [EXPORT_BASIS, '', '']]);

  return {
    csv,
    filename: complete ? `repple-analytics-${on}.csv` : `repple-analytics-INCOMPLETE-${on}.csv`,
    complete,
    warning,
  };
}

/**
 * Why there is nothing worth exporting, or null when there is.
 *
 * Stricter than the roster export, and the difference is the point made in the
 * header: a partial ROSTER is a thousand real people and a useful file, but a
 * partial read behind a FIGURE produces a cell that is simply wrong. Under
 * anything but a whole read the figures it fed are already null, so the file is
 * still produced — it is the ones with nothing in them at all that are refused,
 * because a spreadsheet of empty cells is not an export, it is a screenshot of
 * a failure.
 */
export function analyticsExportBlocker(reads: AnalyticsReads): string | null {
  if (reads.roster === 'loading' && reads.sessions === 'loading') {
    return 'Still reading your figures. Exporting now would write a file of empty cells.';
  }
  if (reads.roster === 'error' && reads.sessions === 'error') {
    return 'Neither your roster nor your sessions came back, so there is no figure to export. That is unknown rather than zero — try again once you have signal.';
  }
  return null;
}

/** The sentence beside a file that is not the whole picture. Said to the coach
 *  before they share it, because after that it is somebody else's copy. */
export function analyticsShareNote(exp: AnalyticsExport, months: number): string {
  const base = `${num(months)} recorded ${months === 1 ? 'month' : 'months'} of history ${months === 1 ? 'is' : 'are'} in the file.`;
  return exp.complete ? base : `${exp.warning as string}\n\n${base}`;
}
