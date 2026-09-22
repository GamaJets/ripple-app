// Reading a tape measurement against the scan that was taken beside it.
//
// ── what a member could not do ────────────────────────────────────────────
//
// A waist and a body-fat percentage are two readings of the same thing taken
// with two different instruments, and this app filed them on two screens. The
// tape lives on app/(client)/measurements.tsx and the InBody scans live on
// app/(client)/scans.tsx, so a member who taped a 34 in waist on the Tuesday
// and scanned at 22.4% on the Thursday had to hold one number in their head
// while they navigated to the other. The two questions people actually ask of
// those figures — "is the waist coming down while the body fat holds?", "did
// the scan agree with the tape this month?" — are comparisons, and a
// comparison nobody can see on one screen is a comparison nobody makes.
//
// scans.tsx already reads `useMeasurements`, but only to put the tape columns
// into the data export (its `measureColumns`). Nothing on either screen has
// ever drawn one beside the other.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// A tape entry is paired with the NEAREST scan, and only if that scan is
// inside a window either side of it. The window exists because the pairing is
// a claim: putting a body-fat figure under a waist figure says "these describe
// the same body". Six weeks apart that is false, and it is false in the
// direction that flatters — a waist that fell across two months read against a
// body fat that fell across the same two months looks like one measurement
// agreeing with another rather than like two separate slow changes.
//
// Ten days, not seven. "The same week" is the question, but a calendar week is
// a boundary rather than a distance: a scan on the Friday and a tape on the
// following Monday are three days apart and in different weeks, and there is
// no bodily reason to refuse that pair while accepting a Monday/Sunday pair six
// days apart. Ten days keeps every ordinary "I taped myself around my scan"
// and is comfortably inside `STALE_AFTER_DAYS` (28, in src/lib/bodyFigures.ts),
// which is the point at which this app already stops calling a body reading
// current.
//
// ── what this deliberately does NOT do ────────────────────────────────────
//
// It does not interpolate, average, or carry a scan forward. A tape entry with
// no scan near it gets null and the screen says there was no scan that week —
// which is the true and useful answer, and is also an argument for booking one.
// Nothing here invents a figure, and nothing here computes a body-fat change
// from a waist change or the reverse: they are different instruments and the
// relationship between them is not arithmetic.
import { daysBetween } from './bodyFigures';

/**
 * One scan, as little of it as this module needs.
 *
 * Structurally satisfied by `ScanRec` from src/ui/clientData.tsx, so the screen
 * passes its scans straight in — but declared narrowly here so this stays a
 * pure module with no provider in its imports, and so a column added to
 * `ScanRec` later does not silently become an input to this rule.
 */
export interface ScanPoint {
  /** `scans.taken_at` — a bare `YYYY-MM-DD`. Compared through `daysBetween`,
   *  which reads it as a LOCAL day; `Date.parse` on it is UTC midnight and
   *  dates it a day early for everyone west of Greenwich. */
  at: string;
  bodyFatPct?: number | null;
  weightKg?: number | null;
  skeletalMuscleKg?: number | null;
}

/** The scan that stands beside one tape entry, with the distance between them. */
export interface PairedScan {
  /** The day the SCAN was taken — never the tape's day. The two are printed
   *  separately on purpose: one figure dated with another figure's date is how
   *  a member ends up believing they were measured on a day they were not. */
  at: string;
  /** Signed, scan minus tape: negative is a scan taken BEFORE the tape entry,
   *  positive after, 0 the same day. Signed rather than absolute because "the
   *  scan came first" and "the tape came first" are different readings of the
   *  same pair of numbers, and a screen that wants the magnitude can take it. */
  gapDays: number;
  /** Kept null when the scan carried no such reading — never 0. A 0% body fat
   *  is not a measurement, and `Number(null)` out of the scans read is NaN, so
   *  both are refused here rather than at each call site. */
  bodyFatPct: number | null;
  weightKg: number | null;
  skeletalMuscleKg: number | null;
}

/**
 * How far either side of a tape entry a scan may sit and still be describing
 * the same body. See the header for why this is ten and not seven.
 */
export const PAIR_WINDOW_DAYS = 10;

/** A stored reading, or null where there is nothing to read. Never a zero: on
 *  a body, every one of these figures is positive or it is absent. */
const reading = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/**
 * The scan taken nearest this tape entry, or null when none is near enough.
 *
 * Ties — a scan the same number of days before and after — resolve to the
 * EARLIER one. Neither is the better description of the body and the choice is
 * arbitrary; what is not arbitrary is that it must not depend on the order the
 * scans arrived in, because the same tape entry would then be captioned with a
 * different body fat after a refresh that merely re-sorted the list.
 *
 * Null out means "no scan near this entry", which the screen must say in those
 * words. It does NOT mean the member has no scans — a failed scans read hands
 * this function an empty array, and only the caller can tell those apart.
 */
export function pairScan(
  tapeISO: string | null | undefined,
  scans: ScanPoint[] | null | undefined,
  windowDays: number = PAIR_WINDOW_DAYS,
): PairedScan | null {
  if (!tapeISO || !scans?.length) return null;
  let best: PairedScan | null = null;
  for (const s of scans) {
    if (!s?.at) continue;
    const gap = daysBetween(tapeISO, s.at);
    // Null, not 0, when either date will not parse — a row we cannot date
    // cannot be said to be near anything.
    if (gap == null || Math.abs(gap) > windowDays) continue;
    const bodyFatPct = reading(s.bodyFatPct);
    const weightKg = reading(s.weightKg);
    const skeletalMuscleKg = reading(s.skeletalMuscleKg);
    // A scan with nothing on it is not a pairing. Drawing "scanned 3 days
    // later" over three dashes tells a member their scan is empty, which is a
    // claim about their record rather than about this rule.
    if (bodyFatPct == null && weightKg == null && skeletalMuscleKg == null) continue;
    const cand: PairedScan = { at: s.at, gapDays: gap, bodyFatPct, weightKg, skeletalMuscleKg };
    if (
      best == null ||
      Math.abs(cand.gapDays) < Math.abs(best.gapDays) ||
      // The tie: same distance, so take the one that happened first.
      (Math.abs(cand.gapDays) === Math.abs(best.gapDays) && cand.gapDays < best.gapDays)
    ) best = cand;
  }
  return best;
}

/**
 * When the scan was, relative to the tape — in words, for the line under the
 * figures.
 *
 * "the same day" and not "0 days apart", because the whole reason this line is
 * printed is that a member has to decide whether the two numbers describe one
 * body, and they decide that from the English rather than from an integer.
 * Singular days get their own wording for the same reason.
 */
export function gapNote(gapDays: number): string {
  if (!Number.isFinite(gapDays)) return '';
  const n = Math.abs(Math.round(gapDays));
  if (n === 0) return 'scanned the same day';
  const when = n === 1 ? 'the day' : `${n} days`;
  return gapDays < 0 ? `scanned ${when} before` : `scanned ${when} after`;
}
