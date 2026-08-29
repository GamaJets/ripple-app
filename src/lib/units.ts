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

// ── taking what the client typed back to metric ────────────────────────────

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
