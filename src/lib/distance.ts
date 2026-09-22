// How far somebody went, in the unit they measure distance in.
//
// ── What was actually there ────────────────────────────────────────────────
//
// Nothing. `src/lib/units.ts` converts a weight, a height and a tape
// measurement and stops there, and the two places in this app that print a
// distance had each decided on kilometres by themselves:
//
//   · app/(client)/workouts.tsx opened every cardio log on 'km'. There is a
//     toggle beside the box — the member can switch it — but a runner in
//     Dallas had to switch it every single time, and a member who did not
//     notice it logged their five miles as five kilometres. The unit travels
//     with that number into the log, so the record then said 5 km.
//   · app/(client)/devices.tsx printed `${m / 1000} km` in the preview of what
//     is about to be written into Apple Health, whatever the member had logged
//     and whatever their phone is set to.
//
// ── Why this is not a fourth setting ───────────────────────────────────────
//
// Settings offers a weight unit and a length unit and there is no third pill
// for distance, and one is deliberately not added here. The four countries that
// give a HEIGHT in feet and inches are the four that give a road distance in
// miles — the United States, Liberia, Myanmar and the United Kingdom — and
// `INCH_REGIONS` in src/lib/unitPreference.ts is already exactly that list. So
// the distance unit is READ OFF the length unit rather than asked for a second
// time, and it inherits everything that decision already carries: a member who
// has chosen centimetres gets kilometres because they chose, one who has chosen
// nothing gets whichever their phone's region suggests, and `lengthSource` says
// which of the two it was.
//
// That split is the one place this could be wrong for somebody: a British
// member reads their height in feet and their body weight in kilograms, which
// is why those are two lists rather than one "imperial?" boolean — and they run
// in miles, so the length side is the right one of the two to follow. A member
// it is wrong for switches the toggle on the log, which is the same escape
// hatch that screen already had.
//
// ── What is stored ────────────────────────────────────────────────────────
//
// Nothing here converts anything on the way IN, and that is not an omission.
// `WorkoutEntry.cardio` stores `{ dist, unit }` — the figure as typed and the
// unit it was typed in — so a five-mile run is stored as 5 mi and is still
// five miles when it is read back on a phone set to kilometres. That is the
// same principle units.ts states for a lifted load ("the unit has to travel
// with the number") arriving at a different answer because the storage is
// different: there is no metric column here to normalise into, and inventing
// one by multiplying by 1.609344 would hand somebody's typed 5 back as 8.05.
//
// So this module converts only for DISPLAY, from a figure that is already
// metric because a machine produced it — HealthKit hands out metres — and
// never in the other direction.
import type { LengthUnit } from './units';

export type DistanceUnit = 'km' | 'mi';

/** Exact by international definition: the mile is 1609.344 metres, because the
 *  inch is 25.4 mm. Not an approximation, and not a different number from
 *  `CM_PER_IN` — it is that number times 63,360. */
export const KM_PER_MI = 1.609344;
export const M_PER_KM = 1000;

export const kmToMi = (km: number) => km / KM_PER_MI;
export const miToKm = (mi: number) => mi * KM_PER_MI;

/**
 * The distance unit that goes with a length unit. See the header for why this
 * is derived rather than asked.
 */
export function distanceUnitFor(length: LengthUnit): DistanceUnit {
  return length === 'in' ? 'mi' : 'km';
}

/**
 * Two decimal places, in both units, and the same two.
 *
 * A hundredth of a kilometre is ten metres and a hundredth of a mile is
 * sixteen; both are finer than any watch's real accuracy over a run and neither
 * prints a digit the reading cannot support. It matters that they match: a
 * 5.00 km run and a 3.11 mi run are the same run, and giving one of them an
 * extra digit would make the pair look like two different measurements.
 */
const DISPLAY_DP = 2;

const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * A measured distance in kilometres, read out in the member's unit. null in,
 * null out — a run nobody recorded is not a run of zero.
 */
export function distanceIn(km: number | null | undefined, unit: DistanceUnit): number | null {
  if (km == null || !Number.isFinite(km)) return null;
  return roundTo(unit === 'mi' ? kmToMi(km) : km, DISPLAY_DP);
}

/** The same figure with its unit attached: `5 km`, `3.11 mi`. Trailing zeroes
 *  are dropped — 5.00 km is a number nobody writes. */
export function distanceLabel(km: number | null | undefined, unit: DistanceUnit): string | null {
  const v = distanceIn(km, unit);
  return v == null ? null : `${String(v)} ${unit}`;
}

/**
 * Metres — which is what HealthKit and every vendor API deal in — read out in
 * the member's unit.
 *
 * Separate from `distanceIn` rather than left to the caller to divide by a
 * thousand, because the caller dividing by a thousand and appending 'km' is
 * precisely the line this module exists to remove from two screens.
 */
export function metresLabel(metres: number | null | undefined, unit: DistanceUnit): string | null {
  if (metres == null || !Number.isFinite(metres)) return null;
  return distanceLabel(metres / M_PER_KM, unit);
}

/** The word for a unit, for a screen-reader label or a sentence. */
export function distanceUnitName(unit: DistanceUnit): string {
  return unit === 'mi' ? 'miles' : 'kilometres';
}
