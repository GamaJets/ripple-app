// Weight and length in the unit the client reads in (TF-37).
//
// ── What was actually there ────────────────────────────────────────────────
//
// Two separate half-answers, neither of which was a unit preference.
//
// `src/ui/settings.tsx` declared `weightUnit: 'kg' | 'lb'` and the Settings
// screen let you tap it. Nothing else in the app read it. Not one screen — not
// the profile, not the dashboard, not the goal tracker. Tapping "lb" changed
// which of two pills was tinted and nothing else. It was not even the classic
// relabelling bug where "182 lb" is printed over a value of 82; it was inert.
//
// Separately, the edit sheet in app/(client)/profile.tsx had its own kg/lb and
// cm/in toggles, local to that sheet, forgotten the moment it closed. Those DID
// convert — through `round1`, at one decimal place, in both directions. So a
// client who typed 180 lb got 81.6 kg stored, and 81.6 kg shown back as
// 179.9 lb. The number they had just typed came back different. Round-tripping
// through the toggle a few times walked it down further.
//
// ── The rule that fixes that ───────────────────────────────────────────────
//
// Storage stays metric — kilograms and centimetres — because that is what the
// record holds, what the coach's console reads, and what every calculation in
// src/lib expects. Conversion happens only at the two edges: what is printed,
// and what is typed.
//
// For the round trip to be lossless, the DISPLAY grain has to be coarser than
// the STORAGE grain by more than a rounding step. Both are fixed here, in one
// place, so no screen has to reason about it:
//
//   stored              displayed metric   displayed imperial
//   kg, 1 dp            0.1 kg             1 lb
//   cm, 1 dp  (height)  1 cm               1 in  (rendered as ft + in)
//   cm, 1 dp  (tape)    0.1 cm             0.1 in
//
// 0.1 kg is not a choice — `scans.weight_kg` is numeric(5,1), so a tenth of a
// kilogram is the finest thing the record can hold. A tenth of a kilogram is
// 0.22 lb, so displaying tenths of a pound would print a digit the reading
// behind it cannot support: 81.6 kg is anything from 179.9 to 180.1 lb, and
// writing "179.9 lb" claims to know which. Whole pounds is the honest grain,
// and it happens to be the grain that survives the round trip — the worst-case
// storage error is 0.05 kg = 0.11 lb, comfortably inside the half-pound that
// would flip the rounding. The same argument gives whole inches for height
// (0.5 cm of slop = 0.2 in) and tenths of an inch for tape measurements
// (0.05 cm of slop = 0.02 in). units.test.ts sweeps every value in range and
// asserts the trip, rather than trusting the arithmetic above.
//
// ── Nothing is invented ────────────────────────────────────────────────────
//
// Every function that could be handed nothing returns null, and the screens
// pass that through `fig()` to get a dash. A weight of 0 kg is not a light
// client, it is a client nobody has weighed, and this module will not turn an
// empty text field into one.

export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';

/** Exact by international definition since 1959 — not an approximation. */
export const KG_PER_LB = 0.45359237;
/** Likewise exact: the inch is defined as 25.4 mm. */
export const CM_PER_IN = 2.54;
const IN_PER_FT = 12;

// The finest grain the record can hold. `scans.weight_kg`, `clients.height_cm`
// and `progress_photos.weight_kg` are all numeric(_,1); anything finer that
// this app computes is silently truncated by Postgres on the way in, which
// would make a value on screen differ from the value that comes back.
const STORED_DP = 1;

const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  // The +Number.EPSILON nudge is deliberate: 1.005 is really 1.00499…, and
  // Math.round of that gives 1.00 where every human reading it expects 1.01.
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** A number the way a person writes it: 82, not 82.0; 82.4, not 82.40. */
export function plain(n: number): string {
  return String(roundTo(n, 3));
}

/** What the client typed, as a number — or null if they typed nothing usable. */
function parse(text: string | number | null | undefined): number | null {
  if (text == null) return null;
  const n = typeof text === 'number' ? text : parseFloat(String(text).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ── the conversions themselves ─────────────────────────────────────────────
export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;

// ── reading a stored metric value out in the client's unit ─────────────────

/**
 * A stored weight in the client's unit, rounded to the grain that unit can
 * honestly carry. null in, null out — never 0.
 */
export function weightIn(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return unit === 'lb' ? Math.round(kgToLb(kg)) : roundTo(kg, 1);
}

/** The same figure with its unit attached, for a line of prose. */
export function weightLabel(kg: number | null | undefined, unit: WeightUnit): string | null {
  const v = weightIn(kg, unit);
  return v == null ? null : `${plain(v)} ${unit}`;
}

/**
 * A DIFFERENCE between two weights, in the client's unit — the weight twin of
 * `lengthDeltaIn` below, and it exists for the same reason.
 *
 * The span is converted once. Converting the two ENDS and subtracting those is
 * the bug: 0.4 kg is 0.88 lb, so two weigh-ins a genuine 0.4 kg apart that
 * happen to straddle a pound boundary report "1 lb" one week and "0 lb" the
 * next off the back of nothing the client did. Seven screens had each written
 * this line locally — dashboard, cards, report, social, goal, body-trends and
 * scans — and one of them getting it wrong later was only a matter of time.
 *
 * Whole pounds, like `weightIn`, and for the argument in the header: a tenth
 * of a kilogram is 0.22 lb, so a tenth of a pound is a digit the reading
 * underneath cannot support.
 */
export function weightDeltaIn(deltaKg: number | null | undefined, unit: WeightUnit): number | null {
  if (deltaKg == null || !Number.isFinite(deltaKg)) return null;
  return unit === 'lb' ? Math.round(kgToLb(deltaKg)) : roundTo(deltaKg, 1);
}

/**
 * A stored height in the client's unit. In centimetres that is a whole number
 * (nobody's height is recorded to the millimetre); in inches it is the total
 * whole inches, which `heightParts` splits into feet and inches for display.
 */
export function heightIn(cm: number | null | undefined, unit: LengthUnit): number | null {
  if (cm == null || !Number.isFinite(cm)) return null;
  return unit === 'in' ? Math.round(cmToIn(cm)) : Math.round(cm);
}

/** Feet and inches, for the two-field height entry and for "5' 10"". */
export function heightParts(cm: number | null | undefined): { feet: number; inches: number } | null {
  const total = heightIn(cm, 'in');
  if (total == null) return null;
  return { feet: Math.floor(total / IN_PER_FT), inches: total % IN_PER_FT };
}

/** A height ready to print: `178 cm` or `5' 10"`. */
export function heightLabel(cm: number | null | undefined, unit: LengthUnit): string | null {
  if (unit === 'cm') {
    const v = heightIn(cm, 'cm');
    return v == null ? null : `${v} cm`;
  }
  const p = heightParts(cm);
  return p == null ? null : `${p.feet}' ${p.inches}"`;
}

/**
 * A tape measurement in the client's unit. Finer than height on purpose: a
 * waist that moves 0.5 cm in a month is the whole point of logging it, and
 * whole centimetres would hide most of what the client is looking for.
 */
export function lengthIn(cm: number | null | undefined, unit: LengthUnit): number | null {
  if (cm == null || !Number.isFinite(cm)) return null;
  return roundTo(unit === 'in' ? cmToIn(cm) : cm, 1);
}

/** A tape measurement with its unit attached. */
export function lengthLabel(cm: number | null | undefined, unit: LengthUnit): string | null {
  const v = lengthIn(cm, unit);
  return v == null ? null : `${plain(v)} ${unit}`;
}

/**
 * A DIFFERENCE between two tape measurements, in the client's unit. Converted
 * as a span rather than as two points so that "−1.0 cm" cannot become
 * "−0.3 in" one month and "−0.4 in" the next off the back of where the two
 * readings happened to sit inside their rounding.
 */
export function lengthDeltaIn(deltaCm: number | null | undefined, unit: LengthUnit): number | null {
  if (deltaCm == null || !Number.isFinite(deltaCm)) return null;
  return roundTo(unit === 'in' ? cmToIn(deltaCm) : deltaCm, 1);
}

// ── the weight a person LIFTS ──────────────────────────────────────────────
//
// Deliberately left out of TF-37 and asked for since: "Don't have choice of
// units for exercise / weights being used." It was left out because barbell
// plates are metric hardware and app/(client)/tools.tsx does plate maths
// against a metric rack, so converting a lifted load looked like a judgement
// call rather than a sweep. It is a judgement call, and this is it.
//
// ── A lifted weight is not a body weight, and needs a finer grain ──────────
//
// Everything above prints whole pounds, because the reading underneath is a
// scan or a bathroom scale stored to 0.1 kg and a tenth of a kilogram is
// 0.22 lb — a tenth of a pound there would be a digit the measurement cannot
// support. None of that argument survives the move to lifted load:
//
//   · `workouts.sets` is jsonb, not numeric(_,1). There is no database grain
//     imposing a floor, so nothing forces the coarse display the body-weight
//     figures were reasoned into.
//   · The number is not a measurement with slop in it. It is what somebody
//     typed, or what they loaded on a bar, and it is exact.
//   · The hardware does not land on whole pounds in either direction. A pair
//     of 1.25 kg fractional plates is a 2.5 kg jump; a pair of 1.25 lb
//     fractionals is a 2.5 lb jump, and the 47.5 lb and 52.5 lb bars that
//     produces are ordinary gym numbers. Whole pounds would print a 47.5 lb
//     bench as "48 lb" and hand it back changed to the person who typed it —
//     which is TF-37's original complaint, arriving on a different screen.
//
// So:
//
//   stored                  displayed metric   displayed imperial
//   kg, 2 dp  (lifted)      the stored kg      0.5 lb
//   kg, whole (volume)      whole kg           whole lb
//   kg, whole (est. 1RM)    whole kg           whole lb
//
// Two decimal places of storage is what makes the imperial trip lossless: an
// entry rounded to the hundredth of a kilogram is at most 0.005 kg = 0.011 lb
// away from what was typed, and a half-pound rounding needs 0.25 lb of error
// before it moves. Metric is exact by construction — the stored number IS what
// a kilogram reader typed. units.test.ts sweeps both rather than trusting this.
//
// The metric side prints the stored hundredths rather than rounding to a gym
// increment on purpose. A load entered as 225 lb is 102.06 kg and there is no
// honest way to show a kilogram reader "102" — the coach's console reads the
// same row, and the two have to agree.

/** The finest grain a lifted load is stored at. See the header above. */
const LIFT_STORED_DP = 2;

/** Half a pound: the grain imperial fractional plates actually produce. */
const LB_LIFT_STEP = 0.5;

/**
 * Above any lift a human has recorded, stated separately in each unit rather
 * than converted. 600 kg converts to 1,322.77 lb, and a message reading "over
 * 1,322 lb" looks like a bug in the app rather than a bound on the number —
 * so each unit gets a round figure of its own.
 */
const LIFT_MAX: Record<WeightUnit, number> = { kg: 600, lb: 1300 };

const roundToStep = (n: number, step: number) => Math.round((n + Number.EPSILON) / step) * step;

/**
 * A stored lifted load in the client's unit. null in, null out — and a 0 is
 * kept, because a set logged at 0 is a bodyweight set and the screens render
 * that as a dash of their own rather than as "0 kg".
 */
export function liftIn(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return unit === 'lb' ? roundToStep(kgToLb(kg), LB_LIFT_STEP) : roundTo(kg, LIFT_STORED_DP);
}

/** A lifted load with its unit attached: `60 kg`, `137.5 lb`. */
export function liftLabel(kg: number | null | undefined, unit: WeightUnit): string | null {
  const v = liftIn(kg, unit);
  return v == null ? null : `${plain(v)} ${unit}`;
}

/**
 * A DIFFERENCE between two lifted loads — a progression bump, a jump between
 * sessions — converted once, at the grain the loads themselves carry.
 *
 * The half-pound matters more here than anywhere. 2.5 kg is the commonest
 * progression step in the app (see `suggestForExercise`'s default increment)
 * and it is 5.51 lb: at whole pounds it reads "+6 lb", which is further from
 * the truth than the "+5.5 lb" the plates actually justify.
 *
 * The span is converted, not the two ends, for the reason `weightDeltaIn`
 * gives — so a 2.5 kg bump reads the same every week rather than alternating
 * between 5 and 6 depending on where the two loads sat inside their rounding.
 */
export function liftDeltaIn(deltaKg: number | null | undefined, unit: WeightUnit): number | null {
  if (deltaKg == null || !Number.isFinite(deltaKg)) return null;
  return unit === 'lb' ? roundToStep(kgToLb(deltaKg), LB_LIFT_STEP) : roundTo(deltaKg, LIFT_STORED_DP);
}

/**
 * An estimated 1-rep max in the client's unit.
 *
 * Coarser than `liftIn`, and that is the whole point: `est1RM` in
 * src/lib/streaks.ts is Epley's formula wrapped in `Math.round`, so what
 * arrives here is already whole kilograms. Reading that out at the half-pound
 * would print a figure to 0.5 lb off an input that only distinguished one
 * kilogram from the next — 2.2 lb of grain dressed up as 0.5. A derived
 * number does not get more precision than the number it was derived from.
 */
export function est1RMIn(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return Math.round(unit === 'lb' ? kgToLb(kg) : kg);
}

/**
 * A total tonnage in the client's unit.
 *
 * Whole units, in both. A volume is Σ reps × load over a week or a month, so
 * it runs to five and six figures — and it is a sum of many loads, each with
 * its own rounding, which means a tenth of a unit on the total is noise
 * dressed as precision. Nobody compares two training weeks to the pound.
 */
export function volumeIn(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  return Math.round(unit === 'lb' ? kgToLb(kg) : kg);
}

/**
 * The same total where the screen has room for one short figure — a hero, a
 * KPI column — and six digits will not fit.
 *
 * Asymmetric on purpose. A metric reader gets tonnes, which is what
 * `tonnes()` in src/lib/longView.ts already computes and what History's hero
 * has always shown. An imperial reader gets the pounds themselves, because the
 * tonne has no imperial counterpart worth printing: the choices are short
 * tons, which differ from a tonne by 10% and would be read as the same unit,
 * or nothing. app/(client)/report.tsx reached that conclusion first and wrote
 * it down; this is the same decision, made once so the screens share it.
 */
export function volumeHeadline(
  kg: number | null | undefined,
  unit: WeightUnit,
): { figure: number; unit: 't' | 'lb' } | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  // Matches longView.tonnes exactly — one decimal place of a tonne. Written
  // out rather than imported so this module keeps depending on nothing.
  if (unit === 'kg') return { figure: Math.round(kg / 100) / 10, unit: 't' };
  return { figure: Math.round(kgToLb(kg)), unit: 'lb' };
}

// ── taking what the client typed back to metric ────────────────────────────

/**
 * A lifted load the client typed, as kilograms to store.
 *
 * Separate from `weightToKg` because the storage grain is: a body weight is
 * stored to the tenth its column can hold, and a lift to the hundredth that
 * makes 225 lb come back as 225 lb rather than 225.5.
 */
export function liftToKg(text: string | number | null | undefined, unit: WeightUnit): number | null {
  const n = parse(text);
  if (n == null) return null;
  return roundTo(unit === 'lb' ? lbToKg(n) : n, LIFT_STORED_DP);
}

/** Either the load in kilograms, or the sentence to show whoever typed it. */
export type LiftRead = { ok: true; kg: number | null } | { ok: false; reason: string };

/**
 * Read a load out of a set row, with the bounds stated in the unit being
 * typed.
 *
 * A blank box is `kg: null`, not a refusal and not a zero: a set of pull-ups
 * carries no external load, and the log renders that absence as a dash. What
 * is refused is text that is not a number — `parseFloat(x.kg) || 0` is what
 * the set rows shipped with, and a fat-fingered load silently becoming 0 puts
 * a bodyweight set in the record where a 100 kg one belongs, which then drags
 * down the volume, the estimated 1RM and next session's target.
 *
 * The bound is checked and NAMED in the unit on screen. Refusing "1000" typed
 * by somebody in pounds with a sentence about 600 kg would be telling them
 * their own number is wrong in a unit they do not use.
 */
export function readLift(text: string | number | null | undefined, unit: WeightUnit): LiftRead {
  if (text == null || String(text).trim() === '') return { ok: true, kg: null };
  const n = parse(text);
  if (n == null) return { ok: false, reason: 'That load is not a number. Leave it empty for a bodyweight set.' };
  if (n < 0) return { ok: false, reason: 'A load cannot be negative.' };
  if (n > LIFT_MAX[unit]) {
    return { ok: false, reason: `${plain(n)} ${unit} is heavier than anyone has lifted — check that figure.` };
  }
  return { ok: true, kg: roundTo(unit === 'lb' ? lbToKg(n) : n, LIFT_STORED_DP) };
}

/**
 * What the client typed in their own unit, as kilograms to store — or null if
 * the field was empty or unreadable.
 *
 * The null matters more than the arithmetic. `parseFloat(weightVal) || 0` in
 * the profile sheet turned an untouched, empty weight field into a stored
 * 0 kg the moment anybody opened Edit profile to change their NAME, and 0 kg
 * is a figure the macro calculator will happily build a day's food around.
 */
export function weightToKg(text: string | number | null | undefined, unit: WeightUnit): number | null {
  const n = parse(text);
  if (n == null) return null;
  return roundTo(unit === 'lb' ? lbToKg(n) : n, STORED_DP);
}

/** A tape measurement the client typed, as centimetres to store. */
export function lengthToCm(text: string | number | null | undefined, unit: LengthUnit): number | null {
  const n = parse(text);
  if (n == null) return null;
  return roundTo(unit === 'in' ? inToCm(n) : n, STORED_DP);
}

/**
 * A height the client typed, as centimetres to store. In imperial this takes
 * both fields, because a single box asking for a height "in inches" is a box
 * nobody who thinks in feet knows how to fill in. Either field may be blank —
 * 5 ft with the inches box empty is five feet exactly — but both blank is
 * still nothing, and returns null rather than 0 cm.
 */
export function heightToCm(
  primary: string | number | null | undefined,
  unit: LengthUnit,
  inches?: string | number | null,
): number | null {
  if (unit === 'cm') {
    const n = parse(primary);
    return n == null ? null : roundTo(n, STORED_DP);
  }
  const ft = parse(primary);
  const inch = parse(inches);
  if (ft == null && inch == null) return null;
  return roundTo(inToCm((ft ?? 0) * IN_PER_FT + (inch ?? 0)), STORED_DP);
}

// ── the words for it ───────────────────────────────────────────────────────

/** Suffix for a bare figure elsewhere on screen (a <Hero>'s unit, say). */
export const weightUnitLabel = (unit: WeightUnit) => unit;
export const lengthUnitLabel = (unit: LengthUnit) => unit;

/**
 * The line a screen shows when it is displaying imperial figures that were
 * measured in metric. Not decoration: the client's scan sheet says 81.6 kg and
 * their profile says 180 lb, and without this the two look like a discrepancy
 * rather than the same reading said twice.
 */
export function convertedNote(unit: WeightUnit | LengthUnit): string | null {
  if (unit === 'kg' || unit === 'cm') return null;
  return unit === 'lb'
    ? 'Converted from the kilograms on your record — shown to the nearest pound.'
    : 'Converted from the centimetres on your record.';
}
