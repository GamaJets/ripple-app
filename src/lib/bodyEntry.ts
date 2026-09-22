// The two boxes on the profile edit sheet that nothing was checking.
//
// ── What was already right, and why that made the gap worse ───────────────
//
// `readBodyWeight` in src/lib/units.ts exists because a slipped keypress —
// 1800 for 180 — went onto the health record permanently, and there is no
// delete on that series. app/(client)/profile.tsx says so at length above its
// own `save`, and the weight box on that sheet now refuses out loud and
// abandons the whole save rather than letting one bad figure through beside
// three good ones.
//
// The two boxes either side of it had neither half of that.
//
//   · HEIGHT went through `heightToCm`, which converts and rounds and bounds
//     NOTHING. 1750 in the cm box stored a member seventeen and a half metres
//     tall; 10 in the inches box with the feet box empty stored one 25 cm tall.
//     Height is on the record the coach reads and the console prints, and it
//     is the divisor in every BMI-shaped figure computed from that row.
//
//   · BODY FAT was bounded — `if (bf != null && bf > 3 && bf < 70)` — and
//     bounded SILENTLY. A member who typed 85, or 2, or a word, tapped Save,
//     watched the button say "Sending…", watched the sheet close, and was
//     never told that the one field they had opened the sheet to change was
//     the one field that did not go. That is the house's own failure shape:
//     a write that did not happen, reported as one that did.
//
// ── Why the range is quoted in the unit that was typed ────────────────────
//
// The same reasoning `readBodyWeight` gives: telling somebody who typed feet
// that the range is 90 to 250 centimetres is refusing their number in a unit
// they do not use. So the bounds are stated twice, natively, and the figure is
// judged AS TYPED — before any conversion — because the number being judged
// has to be the number on screen. Checking a converted height against a metric
// range would wave 6 through as 6 cm.
//
// ── A blank box is not a refusal ──────────────────────────────────────────
//
// Both readers return `ok` with a null value for an empty box, exactly as
// `readBodyWeight` does. Somebody who opens this sheet to change their name
// has not made a mistake by leaving the stat fields alone, and the caller
// already distinguishes "empty" from "unchanged" from "edited".
//
// Pure: strings and arithmetic. No storage, no react, no supabase — so the
// bounds below are asserted under `npm test` without a device.
import { readNumber, type LengthUnit } from './units';

/** The finest grain `clients.height_cm` and `clients.body_fat_pct` hold. */
const DP = 1;
const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  // The same +EPSILON nudge src/lib/units.ts uses, and for the same reason:
  // 1.005 is really 1.00499…, and every human reading it expects 1.01.
  return Math.round((n + Number.EPSILON) * f) / f;
};

// ── body fat ───────────────────────────────────────────────────────────────

/**
 * The range this app will record as a body fat percentage.
 *
 * The same 3 and 70 app/(client)/profile.tsx has always used inline. Both ends
 * are outside what a living person measures — the leanest competitive
 * bodybuilder on stage is around 4, and a reading over 70 is a scale that has
 * failed — so a figure beyond either is a typo rather than a body, and the one
 * thing that must not happen to it is silence.
 */
export const BODY_FAT_MIN = 3;
export const BODY_FAT_MAX = 70;

export type BodyFatRead =
  | { ok: true; pct: number | null }
  | { ok: false; reason: string };

/**
 * Read a body fat percentage, or the sentence to show whoever typed it.
 *
 * An empty box is `pct: null` — no figure typed is not a refusal.
 */
export function readBodyFat(text: string | number | null | undefined): BodyFatRead {
  if (text == null || String(text).trim() === '') return { ok: true, pct: null };
  // `readNumber`, not parseFloat: this is a decimal pad, and the decimal key is
  // a comma across most of Europe. `parseFloat('22,5')` is 22.
  const n = readNumber(text);
  if (n == null) {
    return { ok: false, reason: 'That body fat is not a number. Leave it empty if you do not know it.' };
  }
  if (n < BODY_FAT_MIN || n > BODY_FAT_MAX) {
    return {
      ok: false,
      reason: `Body fat is recorded between ${BODY_FAT_MIN}% and ${BODY_FAT_MAX}%. Check that figure.`,
    };
  }
  return { ok: true, pct: roundTo(n, DP) };
}

// ── height ─────────────────────────────────────────────────────────────────

/**
 * The range this app will record as a height, stated separately in each unit.
 *
 * 90–250 cm is 2 ft 11 in to 8 ft 2 in: wide enough for a junior member at one
 * end and the tallest adult ever recorded at the other, and narrow enough that
 * a missed decimal point or an extra digit cannot get past it. Quoted natively
 * rather than converted, for the reason `LIFT_MAX` in src/lib/units.ts is.
 */
export const HEIGHT_MIN_CM = 90;
export const HEIGHT_MAX_CM = 250;
/** The same bounds as whole inches, so an imperial refusal names inches. */
export const HEIGHT_MIN_IN = 36;
export const HEIGHT_MAX_IN = 98;

export type HeightRead =
  | { ok: true; cm: number | null }
  | { ok: false; reason: string };

const CM_PER_IN = 2.54;
const IN_PER_FT = 12;

const blank = (x: string | number | null | undefined) => x == null || String(x).trim() === '';

/** "8 ft 2 in", or "3 ft" when the inches are zero. */
function feetLabel(totalInches: number): string {
  const ft = Math.floor(totalInches / IN_PER_FT);
  const inch = Math.round(totalInches - ft * IN_PER_FT);
  return inch === 0 ? `${ft} ft` : `${ft} ft ${inch} in`;
}

/**
 * Read a height from the sheet's one or two boxes, or the sentence to show.
 *
 * In imperial this takes both fields, because a single box asking for a height
 * "in inches" is a box nobody who thinks in feet knows how to fill in. Either
 * field may be blank — 5 ft with the inches box empty is five feet exactly —
 * but both blank is nothing, and returns `cm: null` rather than 0.
 *
 * The imperial total is judged in INCHES rather than per box on purpose. There
 * is no honest bound on feet alone once the inches box can carry any part of
 * the answer: 5 ft 10 in and 0 ft 70 in are the same height typed two ways,
 * and a per-box rule would accept one and refuse the other.
 */
export function readHeight(
  primary: string | number | null | undefined,
  unit: LengthUnit,
  inches?: string | number | null,
): HeightRead {
  if (unit === 'cm') {
    if (blank(primary)) return { ok: true, cm: null };
    const n = readNumber(primary);
    if (n == null) {
      return { ok: false, reason: 'That height is not a number. Leave it empty if you would rather not say.' };
    }
    if (n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) {
      return {
        ok: false,
        reason: `Height is recorded between ${HEIGHT_MIN_CM} cm and ${HEIGHT_MAX_CM} cm. Check that figure.`,
      };
    }
    return { ok: true, cm: roundTo(n, DP) };
  }

  if (blank(primary) && blank(inches)) return { ok: true, cm: null };
  const ft = blank(primary) ? 0 : readNumber(primary);
  const inch = blank(inches) ? 0 : readNumber(inches);
  if (ft == null || inch == null) {
    return { ok: false, reason: 'That height is not a number. Leave it empty if you would rather not say.' };
  }
  const total = ft * IN_PER_FT + inch;
  if (total < HEIGHT_MIN_IN || total > HEIGHT_MAX_IN) {
    return {
      ok: false,
      reason: `Height is recorded between ${feetLabel(HEIGHT_MIN_IN)} and ${feetLabel(HEIGHT_MAX_IN)}. Check that figure.`,
    };
  }
  return { ok: true, cm: roundTo(total * CM_PER_IN, DP) };
}
