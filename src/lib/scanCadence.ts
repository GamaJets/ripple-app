// How often a body is actually being measured — as opposed to what the last
// measurement said.
//
// ── the gap this closes ────────────────────────────────────────────────────
//
// Every body screen in this tree answers "what is the latest reading" and
// "which way is it going". app/(trainer)/client-body.tsx draws three series
// with a date and an age on each; `clientBody.bodyLine` tells a coach when the
// newest scan was and whether there is an earlier one behind it. Nothing
// anywhere says how OFTEN.
//
// Those are different questions and a coach acts on them differently. "Last
// scanned 14 March" is one fact. "Scanned three times in January, twice in
// February, once in March and not since" is a record that was being kept and
// has stopped — and the trend drawn through it is a trend through a habit that
// ended eight weeks ago. A coach reading a downward body-fat line has no way,
// today, to see that the line stops because the scanning stopped rather than
// because the body did.
//
// It also decides whether any of the rest is worth reading. A change between
// two readings six months apart is not a fortnight's program working; a
// person scanned twice in a year has a before and an after and no trend at all.
//
// ── why this is not a field on clientBody.ts ───────────────────────────────
//
// It answers a question about the RECORD rather than about the body, and it
// fails differently. The three series in clientBody.ts each carry their own
// date because `scans.skeletal_muscle_kg` is nullable and a scan that measured
// no muscle contributes no muscle point — so "when was the muscle figure last
// updated" is a per-metric question. Cadence is not: a scan happened or it did
// not, whatever columns it filled, and folding it into a per-metric series
// would produce three different answers to "how often do you get on the
// machine" for one person who gets on it monthly.
//
// ── the truncation asymmetry, which is why there are two functions ─────────
//
// `scans` is read newest-first and capped at PostgREST's ceiling
// (src/ui/clientData.tsx:693, src/lib/rowCap.ts), so a truncated read is a
// prefix of the RECENT end: the newest day is real and the oldest ones are
// gone. Exactly the shape src/lib/attendanceGaps.ts is built around, and the
// same split falls out of it.
//
//   · `sinceLastScan` measures from the newest day, which survives the cut.
//   · `scanRhythm` counts, medians and buckets the WHOLE set, and the days that
//     are missing are precisely the ones that would change every one of those
//     figures. On a cut record "scanned 4 times, about every 5 weeks" is not a
//     smaller answer, it is a wrong one — so it takes `whole` and returns null
//     without it, rather than reporting a fraction of somebody's history as
//     their history.
//
// ── what this file must not do ─────────────────────────────────────────────
//
// It must not diagnose, for the reasons src/lib/cadence.ts sets out at length
// about attendance. "Nothing since 2 March" is a statement about what the app
// was told. The same shape is produced by a client who scans at a different
// gym, by a machine that broke, by a coach who stopped photographing the sheet,
// and by somebody who has given up. Every sentence below is about the record.
//
// And it must not call a cadence good or bad. There is no correct scanning
// frequency; an InBody every week measures noise and a coach who wants one a
// quarter is not neglecting anybody. The output is the rhythm, in words.
//
// No clock and no React: `today` arrives from the caller as a bare local day,
// so the refusals can be asserted against a particular Tuesday.
import { dateParts } from './localDate';
import { daysBetween } from './bodyFigures';

/**
 * The smallest number of scan days from which a typical gap is a typical gap.
 *
 * Four days is three gaps, and three is the smallest number whose median is a
 * median rather than a coin toss between two values — with two gaps the median
 * is their mean and one holiday moves it by half. The identical constant and
 * the identical reasoning are in src/lib/cadence.ts (MIN_ACTIVE_DAYS); it is
 * restated rather than imported because that file is about attendance events
 * and importing it here would tie a body-record rule to a churn rule that may
 * well want to move on its own.
 */
export const MIN_DAYS_FOR_GAP = 4;

/** How many calendar months the month strip goes back. Thirteen covers a year
 *  plus the month you are standing in, which is the window a coach reads a
 *  scanning habit over; anything older is history rather than rhythm and is
 *  reported as a count instead of as bars. */
export const MONTH_WINDOW = 13;

/** One calendar month of the record. `n` of 0 is a month that really had no
 *  scan in it — these are generated from the span, not from the rows, because a
 *  strip built only from months that have rows draws no gaps at all. */
export interface ScanMonth {
  /** 'YYYY-MM'. A key, compared as a string, never parsed. */
  readonly key: string;
  readonly n: number;
}

/** The shape of somebody's scanning, over the whole of a record that is known
 *  to be whole. */
export interface ScanRhythm {
  /** Distinct calendar days with at least one scan. Two scans on one morning
   *  are one measurement of a body, not two. */
  readonly count: number;
  readonly firstISO: string;
  readonly lastISO: string;
  /** Whole days from the first scan to the last. */
  readonly spanDays: number;
  /** The median gap between consecutive scan days, or null below
   *  MIN_DAYS_FOR_GAP — never a mean, which one two-year break would own. */
  readonly typicalGapDays: number | null;
  /** The longest they have ever gone between two scans, or null with fewer
   *  than two days. Safe here, unlike on a truncated read, precisely because
   *  this whole object refuses to exist without `whole`. */
  readonly longestGapDays: number | null;
  /** The most recent MONTH_WINDOW months of the record, oldest first, every
   *  month in between included at 0. */
  readonly months: readonly ScanMonth[];
  /** Scans that fell before the month strip begins. Reported so the strip is
   *  never read as the whole record. */
  readonly beforeStrip: number;
}

/** How long it has been since the last scan. */
export interface SinceScan {
  readonly days: number;
  readonly sinceISO: string;
}

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * One stored value as a bare local day key, or null when it will not read.
 *
 * Built through `dateParts` rather than by slicing the string. `scans.taken_at`
 * is a Postgres `date` and arrives bare, but this module is also handed values
 * out of `ScanRec` and out of an offline queue, and a `slice(0, 10)` on a
 * timestamp takes the UTC day — which is the day BEFORE for anybody west of
 * Greenwich scanning in the evening. src/lib/localDate.ts is the whole of that
 * bug and the whole of its fix.
 */
function dayKey(iso: string | null | undefined): string | null {
  const p = dateParts(iso);
  return p ? `${p[0]}-${pad(p[1] + 1)}-${pad(p[2])}` : null;
}

/** The readable scan days, deduplicated, oldest first. Bare day keys sort
 *  lexicographically into date order, which is why they are never parsed to
 *  compare them. */
function readableDays(days: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const d of days) {
    const k = dayKey(d);
    if (k) seen.add(k);
  }
  return [...seen].sort();
}

/**
 * How many of the supplied dates could not be read.
 *
 * Exposed rather than swallowed. A row whose date will not parse is a row that
 * silently leaves every figure below, and a screen that does not mention it is
 * quietly reporting a smaller history than the client has.
 */
export function unreadableScanDays(days: readonly (string | null | undefined)[]): number {
  let bad = 0;
  for (const d of days) if (!dayKey(d)) bad++;
  return bad;
}

/**
 * How long since the newest scan — the one figure a truncated read can still
 * answer, because the cut falls at the old end.
 *
 * Null for a record with nothing readable in it: no scans is not a gap of zero
 * days, which would read as "scanned today". Null too for a newest scan dated
 * in the future — the scan sheet lets a date be picked by hand, and "−4 days
 * ago" is not a sentence. Both refusals are the ones src/lib/attendanceGaps.ts
 * already makes about a visit.
 */
export function sinceLastScan(
  days: readonly (string | null | undefined)[],
  todayISO: string,
): SinceScan | null {
  const all = readableDays(days);
  if (!all.length) return null;
  const last = all[all.length - 1];
  const d = daysBetween(last, todayISO);
  if (d == null || d < 0) return null;
  return { days: d, sinceISO: last };
}

/**
 * The whole shape of a scanning record — or null when it cannot honestly be
 * described.
 *
 * `whole` is the caller's `isWhole(status)`. Without it every field here is
 * computed over an unknown fraction of the set; see the header.
 */
export function scanRhythm(
  days: readonly (string | null | undefined)[],
  whole: boolean,
  todayISO: string,
): ScanRhythm | null {
  if (!whole) return null;
  const all = readableDays(days);
  // One scan is a reading, not a rhythm. Reported as null rather than as a
  // cadence of zero, which would be a claim that they have never come back.
  if (all.length < 2) return null;
  const first = all[0];
  const last = all[all.length - 1];
  const span = daysBetween(first, last);
  if (span == null) return null;

  const gaps: number[] = [];
  for (let i = 1; i < all.length; i++) {
    const g = daysBetween(all[i - 1], all[i]);
    // A pair that will not difference drops out rather than contributing a 0,
    // which would claim two scans on the same day and drag the median down.
    if (g != null && g > 0) gaps.push(g);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = all.length >= MIN_DAYS_FOR_GAP && sorted.length
    ? sorted[Math.floor(sorted.length / 2)]
    : null;
  const longest = sorted.length ? sorted[sorted.length - 1] : null;

  // The strip runs to the month the coach is standing in rather than to the
  // last scan, because the empty months AFTER somebody stopped are the whole
  // point of the feature. A strip ending at the last scan would draw a full bar
  // on its right-hand edge for a client who has not been measured since March.
  const end = dayKey(todayISO) ?? last;
  const months = monthStrip(all, end);
  const stripFrom = months.length ? months[0].key : end.slice(0, 7);
  const beforeStrip = all.filter((d) => d.slice(0, 7) < stripFrom).length;

  return {
    count: all.length, firstISO: first, lastISO: last, spanDays: span,
    typicalGapDays: typical, longestGapDays: longest, months, beforeStrip,
  };
}

/** The last MONTH_WINDOW calendar months up to and including `endISO`'s month,
 *  oldest first, each with the number of scan days that fell in it. */
function monthStrip(allDays: readonly string[], endISO: string): ScanMonth[] {
  const p = dateParts(endISO);
  if (!p) return [];
  const counts = new Map<string, number>();
  for (const d of allDays) {
    const k = d.slice(0, 7);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: ScanMonth[] = [];
  // Walked backwards from the end month with Date arithmetic on a local
  // midnight, so December rolls into January without the caller doing modulo
  // by hand — the place an off-by-one lands in a month label nobody notices.
  for (let i = MONTH_WINDOW - 1; i >= 0; i--) {
    const m = new Date(p[0], p[1] - i, 1);
    const key = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
    out.push({ key, n: counts.get(key) ?? 0 });
  }
  return out;
}

/**
 * A gap in the words a person would use for it.
 *
 * Deliberately vague — "about every 5 weeks" — because the median of a handful
 * of gaps is not precise to the day and printing "every 34 days" would claim a
 * regularity nobody has. The word "about" is load-bearing.
 */
export function gapPhrase(days: number): string {
  if (days <= 0) return 'more than once a day';
  if (days === 1) return 'about every day';
  if (days <= 10) return `about every ${days} days`;
  if (days <= 70) {
    const w = Math.round(days / 7);
    return w === 1 ? 'about every week' : `about every ${w} weeks`;
  }
  const m = Math.round(days / 30);
  return m === 1 ? 'about every month' : `about every ${m} months`;
}

/**
 * The cadence, in one sentence, with no subject — so the same string serves a
 * coach reading about a client and a coach reading about themselves.
 *
 * Null when there is no rhythm to describe. The caller says the honest thing
 * about why, because the reasons differ: a read that failed, a read that was
 * truncated, one scan, and none at all are four different sentences and this
 * module can only distinguish some of them.
 */
export function rhythmLine(r: ScanRhythm | null): string | null {
  if (!r) return null;
  const gap = r.typicalGapDays != null ? ` — ${gapPhrase(r.typicalGapDays)}` : '';
  // The span is given in whole days under a fortnight and in weeks above it:
  // "over 3 days" is a fact, "over 27 weeks" is the one a coach can hold.
  const over = r.spanDays < 14 ? `${r.spanDays} days` : `${Math.round(r.spanDays / 7)} weeks`;
  return `Measured on ${r.count} days over ${over}${gap}.`;
}

/**
 * Whether the scanning has stopped, said as a fact about the record.
 *
 * Null while the last scan is within the rhythm — nothing to report — and null
 * whenever there is no rhythm to be outside of, because "it has been 40 days"
 * only means something beside a usual gap. Twice the typical gap is the
 * threshold: one missed scan is a busy month, and this sentence is meant to be
 * rare enough that a coach reads it when it appears.
 *
 * It says the record stopped. It does not say the client stopped, and the
 * wording is chosen so that a coach cannot quote it back to somebody as an
 * accusation — the same discipline src/lib/nudge.ts applies to attendance.
 */
export function stoppedNote(r: ScanRhythm | null, since: SinceScan | null): string | null {
  if (!r || !since || r.typicalGapDays == null) return null;
  if (since.days <= r.typicalGapDays * 2) return null;
  return `Nothing has been recorded for ${since.days} days, against a usual ${r.typicalGapDays}. `
    + 'That is a gap in what this app was told — it does not say where they have or have not been measured.';
}
