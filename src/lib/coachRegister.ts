// The numbers a coach's own register produced, given back to the coach.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// A coach ticks people off in app/(trainer)/class-checkin.tsx. Those ticks are
// `class_bookings.attended_at`, and every figure computed from them —
// `class_attendance_summary`, the fill and show rates in src/lib/classRates.ts,
// the per-attendee payroll lines in src/lib/gymPay.ts — surfaces on the OWNER's
// console. The person who took the register could not see a single one of them.
//
// `class_attendance_summary` has always admitted the class's own trainer
// (supabase/parts/25, re-stated in part 460: `gc.trainer_id = auth.uid()` or
// `is_owner_of(gc.tenant_id)`), so no new grant is needed for this. The rows
// were readable by the coach the whole time and nothing asked for them.
//
// ── Pure, and why it has to be ─────────────────────────────────────────────
//
// Same reason src/lib/classRegister.ts and src/lib/classRates.ts are pure:
// classAttendance.ts builds a Supabase client at import time, which drags
// AsyncStorage in with it and cannot be loaded under node. Every rule below is
// the sort that has to be asserted on, so it lives where a test can reach it.
//
// ── The rules ──────────────────────────────────────────────────────────────
//
// 1. A CLASS WITH NOTHING MARKED IS NOT A CLASS NOBODY CAME TO. This is
//    src/lib/attendance.ts's rule 1 arriving from the other end: `attended = 0`
//    over `booked = 12` is a coach who taught twelve people and never pressed
//    the button, or twelve people who did not turn up, and the row cannot tell
//    them apart. So those classes are SPLIT OUT (`splitTaught`) and the show
//    rate is computed over the ones that have a register. Leaving them in reads
//    as a nought-per-cent class and drags a coach's own figure down for
//    paperwork they did not do; dropping them silently hides how much of the
//    term went unregistered. They are counted and named instead.
//
// 2. WALK-INS ARE COUNTED BESIDE THE RATE, NEVER INSIDE IT. classRegister.ts's
//    whole argument: "a rate's numerator must be drawn from its own
//    denominator". `class_attendance_summary` already filters `attended` to
//    booked rows and returns waitlist attendance as its own column, so the
//    honest thing here is to carry that separation upward rather than re-fold
//    it. `showRateOf` divides present by booked and by nothing else.
//
// 3. THE HEADCOUNT A GYM PAYS ON IS `present + walkIns`, AND IT IS NULL WHEN
//    THE WALK-INS ARE UNKNOWN. `ClassSummaryRow.waitlistAttended` is optional:
//    undefined means a database without part 460, where the column genuinely
//    does not exist. `classPayAmount` in src/lib/gymPay.ts already refuses to
//    price a per-attendee class with an unknown headcount, on the grounds that
//    paying it at nought "would say the coach taught to an empty room because
//    the paperwork is missing". The same refusal, on the coach's side of the
//    same figure.
//
// 4. NOTHING HERE IS MONEY. Not a rate, not a currency, not an estimate of what
//    a class earned. Repple is white-label and what a gym pays a coach to teach
//    lives in `gym_trainer_pay` under the gym's own currency (src/lib/gymPay.ts)
//    — a coach's app inventing a figure from a rate nobody told it would be a
//    number their employer never agreed. This module produces HEADCOUNTS, which
//    are what the coach actually generated, and stops there.
import type { ClassSummaryRow } from './classRates';

/** A half-open window, as `class_attendance_summary` takes it (>= from, < to). */
export interface TaughtWindow {
  fromISO: string;
  toISO: string;
  /** For the screen's own heading. Rolling days, said the way a coach says it. */
  label: string;
}

/**
 * The last `days` days, ending now.
 *
 * Rolling rather than calendar, and deliberately: nobody is paid against this
 * window, and "the last 30 days" is what a coach means when they ask how their
 * classes have been going. `setDate` on a local Date, so the boundary is the
 * coach's own midnight — the same choice app/(owner)/class-analytics.tsx makes
 * for the same reason, and the one that stops an evening class on the last day
 * of a month landing in the next one because Greenwich says so.
 */
export function rollingWindow(now: Date, days: number): TaughtWindow | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const t = now.getTime();
  if (!Number.isFinite(t)) return null;
  const from = new Date(t);
  from.setDate(from.getDate() - days);
  return { fromISO: from.toISOString(), toISO: new Date(t).toISOString(), label: `the last ${days} days` };
}

/**
 * The classes, in the three states a register can leave them in.
 *
 * `registered` is the only group any rate may be computed over. `unregistered`
 * is rule 1: bookings on the class and nothing marked against anybody, which is
 * a missing register and not an empty room. `noBookings` is a class nobody
 * booked and nobody was marked at — there was no register to take, so it is
 * neither evidence of a rate nor evidence of missing paperwork.
 *
 * A walk-in counts as the register having been taken, because it can only exist
 * if somebody pressed the button: the tick on a waitlist row IS a coach at the
 * door. That is why `walkIns > 0` moves a class into `registered` even with
 * nobody booked marked present.
 */
export interface TaughtSplit {
  registered: ClassSummaryRow[];
  unregistered: ClassSummaryRow[];
  noBookings: ClassSummaryRow[];
}

export function splitTaught(rows: readonly ClassSummaryRow[]): TaughtSplit {
  const registered: ClassSummaryRow[] = [];
  const unregistered: ClassSummaryRow[] = [];
  const noBookings: ClassSummaryRow[] = [];
  for (const r of rows) {
    const marked = r.attended > 0 || (r.waitlistAttended ?? 0) > 0;
    if (marked) registered.push(r);
    else if (r.booked > 0) unregistered.push(r);
    else noBookings.push(r);
  }
  return { registered, unregistered, noBookings };
}

/**
 * Of the people who booked one class, the proportion who were marked present —
 * or null when nobody booked it.
 *
 * The same rule `registerArc` in src/lib/classRegister.ts states over live
 * register rows, applied to the aggregated row the server returns for a class
 * that has already been taught. Null and not 0 for a class nobody booked: a
 * ring drawn at zero says nobody turned up, and nobody was expected.
 *
 * It cannot exceed 1. `class_attendance_summary` filters its numerator to
 * `status = 'booked'` (part 460), which is the server-side half of the same fix
 * classRegister.ts is the client-side half of.
 */
export function showRateOf(row: Pick<ClassSummaryRow, 'booked' | 'attended'>): number | null {
  if (row.booked <= 0) return null;
  return row.attended / row.booked;
}

/**
 * The headcount a gym pays a per-attendee class on: everybody who was marked
 * present, off the register and off the door.
 *
 * NULL when the walk-ins are unknown, which is a database without part 460's
 * `waitlist_attended` column. Not zero. `classPayBlocker` in src/lib/gymPay.ts
 * makes exactly this refusal on the gym's side and says why in the sentence
 * this comment keeps quoting; a coach's own copy of the figure has no business
 * being more confident than the payroll it is a copy of.
 */
export function paidHeadcount(row: ClassSummaryRow): number | null {
  if (row.waitlistAttended == null) return null;
  return row.attended + row.waitlistAttended;
}

/**
 * The same across a set of classes, or null if a single row cannot answer.
 *
 * All-or-nothing rather than a sum over the rows that can: a partial total
 * looks exactly like a whole one and would understate what a coach delivered,
 * which is the direction this figure must never be wrong in.
 */
export function paidHeadcountTotal(rows: readonly ClassSummaryRow[]): number | null {
  let sum = 0;
  for (const r of rows) {
    const n = paidHeadcount(r);
    if (n == null) return null;
    sum += n;
  }
  return sum;
}

/**
 * The line under one class.
 *
 * Three facts kept as three, in classRegister.ts's shape: how many of the
 * booked were here, how many came off the waitlist, and — where it applies —
 * that nobody marked the class at all. The walk-ins are never added to the
 * first figure and never subtracted from it.
 *
 * No sentence in here says "missed", and none of them says a number about a
 * class whose walk-ins are unknown.
 */
export function classLine(row: ClassSummaryRow): string {
  const walkKnown = row.waitlistAttended != null;
  const walk = row.waitlistAttended ?? 0;
  const walkPart = !walkKnown
    ? ' Walk-ins are not recorded on this gym, so the headcount you were owed for may be higher.'
    : walk > 0
      ? ` ${walk} ${walk === 1 ? 'person' : 'people'} came off the waitlist and ${walk === 1 ? 'is' : 'are'} counted separately.`
      : '';
  if (row.attended === 0 && walk === 0) {
    if (row.booked === 0) return `Nobody booked this one.${walkPart}`;
    return `${row.booked} booked and nothing was marked against anybody — this is a register that was not taken, not a class nobody came to.${walkPart}`;
  }
  if (row.booked === 0) return `Nobody booked this one.${walkPart}`;
  return `${row.attended} of the ${row.booked} booked were marked here.${walkPart}`;
}

/**
 * What is missing from the figures above this, or null when nothing is.
 *
 * One sentence, said once, near the totals rather than on every row. The two
 * gaps are different and are never merged: classes with no register taken are a
 * hole in the RATE, and unknown walk-ins are a hole in the HEADCOUNT.
 */
export function gapNote(split: TaughtSplit, walkInsKnown: boolean): string | null {
  const parts: string[] = [];
  const u = split.unregistered.length;
  if (u > 0) {
    parts.push(
      `${u} ${u === 1 ? 'class had' : 'classes had'} bookings and no register taken. `
      + `${u === 1 ? 'It is' : 'They are'} left out of the rate rather than counted as nobody turning up.`,
    );
  }
  if (!walkInsKnown) {
    parts.push('This gym does not record walk-ins separately, so no headcount is shown — an unknown number of people is not nought of them.');
  }
  return parts.length ? parts.join(' ') : null;
}

/** True when every row can answer for its walk-ins. False means part 460 has
 *  not been applied here and the column is genuinely absent — which is not the
 *  same as a term in which nobody walked in. */
export function walkInsKnown(rows: readonly ClassSummaryRow[]): boolean {
  return rows.every((r) => r.waitlistAttended != null);
}

/**
 * The sentence about what this list is NOT.
 *
 * `class_attendance_summary` admits a class on `gc.trainer_id = auth.uid()`.
 * Part 460 widened the REGISTER to a gym's staff — cover, illness, a swap in
 * the group chat — and did not widen this read, and part 165 records that every
 * class the web console created carries `trainer_id` NULL. So a coach can take
 * a register for a class that will never appear on this screen, and the absence
 * of it here is not evidence they did not teach it. Stated on the page, because
 * a coach counting their own term against this list would otherwise count short.
 */
export const TAUGHT_SCOPE_NOTE =
  'Only classes recorded against your name are here. A class you covered for somebody, or one the '
  + 'front desk set up without naming you, is not on this list — and that is not evidence you did '
  + 'not teach it.';
