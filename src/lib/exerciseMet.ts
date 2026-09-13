// The MET the catalogue holds for a MOVEMENT, and the calories that follow.
//
// ── what was wrong ────────────────────────────────────────────────────────
//
// `exercises.met` is populated on 601 of the catalogue's 608 rows and was read
// by nothing. `src/ui/exerciseDetail.ts` did not select the column, the list
// read did not select it, and a repo-wide search for a reader found none. The
// only MET figures the app used were the twelve literals in
// src/lib/workoutKind.ts — AMRAP 8.0, Yoga 3.0, Foam Rolling 2.5 — plus the
// eight in Train's own cardio list.
//
// Those literals are not about movements. They are about the SESSION KINDS in
// Train's picker: "a Tabata", "a yoga class", "a foam-rolling session". The
// catalogue's figure is about a named movement — a Barbell Back Squat, a Ring
// Dip — which is a different question with a different answer, and the two must
// never stand in for one another. This module is where the catalogue's answer
// is read; `activityMet` in src/lib/workoutKind.ts is where the picker's is,
// and it refuses every name that is not one of its own.
//
// ── the rule this file is built to keep ───────────────────────────────────
//
// A movement with no MET produces NO CALORIE FIGURE. It does not fall back to
// the picker's nearest-sounding activity, it does not fall back to a generic
// 7, and it does not fall back to zero.
//
// That rule is not new here — it is the one `cardioKcal` in
// app/(client)/workouts.tsx was rewritten to keep, after a fallback of MET 7
// ("roughly rowing") gave a plausible-looking burn to Sauna and to every typo,
// and a fallback of 70 kg gave every member somebody else's body. The header of
// src/lib/hrKcal.ts states the same rule for the heart-rate model and
// src/lib/entryEdit.ts states it again for the edit sheet: "a sauna has no MET
// value, so its burn is genuinely unknown, and the log renders that as a dash".
//
// The reason this file exists at all is that a real per-movement MET is the
// INPUT that was missing when those fallbacks were removed. Removing them was
// right and left seven hundred movements with no figure; reading the column the
// catalogue already carries gives six hundred and one of them an honest one,
// and leaves the remaining seven as dashes, which is what they are.
//
// Pure and dependency-free, like src/lib/hrKcal.ts and for the same reason:
// every branch below is a refusal, and a refusal is only worth anything if it
// can be asserted without mounting a screen or reaching a database.

/**
 * The lowest figure that can be a MET at all.
 *
 * 1.0 is the definition — one MET is sitting quietly — and the Compendium of
 * Physical Activities does list values below it for sleep (0.95). Nothing in an
 * exercise catalogue is below rest, so anything at or under zero is not a low
 * MET, it is a column that did not import: numeric(4,1) will happily hold 0.0,
 * and 0.0 × a body weight × an hour is a confident "0 kcal" printed over an
 * hour of training.
 */
export const MET_FLOOR = 0.5;

/**
 * The highest figure that can be a MET at all.
 *
 * The Compendium tops out around 23 — running at 22.5 km/h — so 30 is clear air
 * above anything a movement can honestly carry while still catching the two
 * ways this column goes wrong: a percentage or a heart rate written into it,
 * and a decimal point lost in an import (7.5 arriving as 75). numeric(4,1)
 * allows up to 999.9, so the column itself refuses nothing.
 *
 * A value outside the range is treated exactly as an absent one. It is NOT
 * clamped: clamping 75 to 30 would keep the calorie figure and throw away the
 * only evidence that it is wrong, which is the invention this file is about.
 */
export const MET_CEILING = 30;

/**
 * The catalogue's MET for one row, or null when it has none we can use.
 *
 * `unknown` in, because this reads a PostgREST row. `met` is `numeric(4,1)`,
 * and a Postgres numeric does not fit a JSON number safely in the general case
 * — PostgREST therefore hands some deployments a STRING. `Number('7.5')` and
 * `Number(7.5)` are both 7.5 and both are accepted; `Number('')` is 0 and
 * `Number(null)` is 0, which is why zero is refused below rather than trusted.
 *
 * Null for: absent, unparseable, and out of range. All three are the same
 * answer to the only question a caller has — "may I put a calorie figure next
 * to this movement?" — and the answer is no.
 */
export function catalogueMet(raw: unknown): number | null {
  if (raw == null) return null;
  // A boolean is Number-able (true is 1, which is inside the range) and is
  // never a MET. Guarded explicitly rather than left to the range test, which
  // would let `true` through as a resting-metabolic movement.
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < MET_FLOOR || n > MET_CEILING) return null;
  return n;
}

/** Why there is no calorie figure. A caller shows the reason; it never shows a
 *  number. The three are kept apart because the member can act on two of them —
 *  a missing weight is a field in Settings — and on the third they cannot. */
export type MetKcalGap =
  /** The catalogue holds no usable MET for this movement. Seven rows of 608. */
  | 'no-met'
  /** We do not know what this member weighs, so the figure would be about
   *  somebody else. See the note on the 70 kg fallback in the header. */
  | 'no-weight'
  /** Nobody recorded how long it went on for. Not the same as zero minutes. */
  | 'no-minutes';

export interface MetKcalInput {
  /** As read by `catalogueMet`. Never a literal from a picker list. */
  readonly met: number | null | undefined;
  /** Kilograms — the unit every mass in this app is stored in. */
  readonly weightKg: number | null | undefined;
  /** How long the movement went on for. */
  readonly minutes: number | null | undefined;
}

/**
 * Which input is missing, or null when none is.
 *
 * Separate from `metKcal` and asked in a fixed order, so a screen that wants to
 * SAY why there is no number says the same thing the number's absence means.
 * Two screens computing "is there a figure?" and "why not?" independently is
 * how they come to disagree in front of the same member.
 *
 * The MET is asked about first because it is the one the member can do nothing
 * about, and because it is the honest headline: a movement the catalogue does
 * not rate has no burn we can derive however complete the rest of the record
 * is.
 */
export function metKcalGap(input: MetKcalInput | null | undefined): MetKcalGap | null {
  const met = input ? Number(input.met) : NaN;
  if (!input || input.met == null || !Number.isFinite(met) || met < MET_FLOOR || met > MET_CEILING) return 'no-met';
  const kg = Number(input.weightKg);
  if (input.weightKg == null || !Number.isFinite(kg) || kg <= 0) return 'no-weight';
  const mins = Number(input.minutes);
  if (input.minutes == null || !Number.isFinite(mins) || mins <= 0) return 'no-minutes';
  return null;
}

/**
 * Kilocalories for one movement, or null.
 *
 * kcal = MET × body weight in kilograms × hours. The standard estimate, the
 * same arithmetic `cardioKcal` performs, and it is a MODEL: it assumes the
 * movement was performed continuously for the minutes given, and a set of five
 * squats inside a twenty-minute block was not. No caller may present the result
 * as a measurement, and where a watch measured the session, the watch's figure
 * is the one to show — src/lib/hrKcal.ts makes the same point about the
 * heart-rate model and for the same reason.
 *
 * Rounded to whole kilocalories, because a tenth of a kilocalorie is precision
 * this model does not have and printing it would claim otherwise.
 *
 * Null whenever `metKcalGap` names a gap. Never zero: zero is a measurement
 * claim — "you burned nothing" — and this function has no way to make it.
 */
export function metKcal(input: MetKcalInput | null | undefined): number | null {
  if (!input || metKcalGap(input) != null) return null;
  const kcal = Number(input.met) * Number(input.weightKg) * (Number(input.minutes) / 60);
  // Defensive rather than decorative: the three inputs are each finite and in
  // range by the time we are here, so this can only fail on a product that
  // overflows, and a non-finite kcal rendered into a string is the word
  // "Infinity" under a movement name.
  if (!Number.isFinite(kcal)) return null;
  const rounded = Math.round(kcal);
  // A positive burn that rounds to nothing is still not nothing. A figure of 0
  // beside a movement reads as "we measured, and it was none"; under a minute
  // of a light movement genuinely produces that, and the truthful answer there
  // is the same dash every other missing figure gets.
  return rounded > 0 ? rounded : null;
}
