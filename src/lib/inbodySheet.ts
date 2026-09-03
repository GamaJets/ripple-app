// Reading an InBody printout, including which unit it was printed in.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// The parser lived inside app/(client)/scans.tsx under a comment that said the
// quiet part out loud:
//
//     "The text reader scrapes an InBody sheet, and an InBody sheet is printed
//      in kilograms — so what it hands back is metric no matter what the boxes
//      it is filling are labelled."
//
// The first half of that is not true. An InBody 570 configured for a US site
// prints Weight, SMM and Fat Free Mass in POUNDS, and the sheet says so next to
// each of them. The number it hands over is then 180 rather than 82 — and the
// band the weight matcher accepts is 35 to 250, which contains both a
// kilogram body weight and a pound one, so nothing rejected it. On a phone set
// to pounds the screen ran `fieldFromKg(180)` and filled the box with 397 lb.
// On a phone set to kilograms it filled it with 180 kg. Both were saved as a
// body composition, and the newest scan re-tunes the member's calorie target,
// so the wrong body was inside their meal plan before they left the sheet.
//
// ── What this module does about it ────────────────────────────────────────
//
// It reads the unit off the sheet, the same way a person does: from the words
// printed beside the figure. Three answers, not two — 'kg', 'lb', and NULL for
// a sheet that did not say, because a scan whose unit is unknown is not the
// same thing as a metric one and must not be silently treated as one. The
// screen states the assumption it is making in that third case and asks the
// member to check the figure, which is the one thing that can actually resolve
// it: they are standing in front of the printout.
//
// Percentage body fat is unitless and is read as before. Only the two MASSES —
// weight and skeletal muscle — carry a unit, and they always carry the same
// one: no InBody sheet prints one in pounds and the other in kilograms.
//
// Pure, so scans.test can argue with the rules rather than with an OCR service.
import { lbToKg } from './units';

/** Which unit the sheet's masses are printed in. Null is a real answer: the
 *  sheet did not say, and that is not the same as saying kilograms. */
export type SheetUnit = 'kg' | 'lb';

export interface SheetRead {
  /** Body weight AS PRINTED, in `unit`. Null when no weight line was found. */
  weight: number | null;
  /** Percent body fat. Unitless in every configuration of the machine. */
  bodyFatPct: number | null;
  /** Skeletal muscle mass AS PRINTED, in `unit`. */
  muscle: number | null;
  unit: SheetUnit | null;
  /** True when anything at all was read. */
  ok: boolean;
}

/**
 * The plausible band for a body weight, per unit.
 *
 * Wider than a fitness app's usual range on purpose: this is a typo catch on a
 * machine-printed figure, not a judgement about who may be weighed. The bands
 * OVERLAP — 100 is a plausible weight in either unit — which is exactly why the
 * unit has to be read off the words rather than guessed from the number. A
 * previous version of this reasoning was "35 to 250 must be kilograms", and
 * that assumption is the bug.
 */
const WEIGHT_BAND: Record<SheetUnit, [number, number]> = { kg: [25, 300], lb: [55, 660] };
const MUSCLE_BAND: Record<SheetUnit, [number, number]> = { kg: [10, 80], lb: [22, 176] };
/** The band used when the sheet does not name its unit. Kilograms, because
 *  that is what the machine prints unless it has been configured otherwise —
 *  and it is stated on screen rather than assumed silently. */
const UNKNOWN_UNIT_ASSUMPTION: SheetUnit = 'kg';

/**
 * The words that name a unit on an InBody sheet.
 *
 * `lbs` and `lb` both appear; so does `Ibs`, which is what OCR makes of a
 * lower-case L in several of the fonts these are printed in. Matched with
 * boundaries so "Kg" inside a longer word — and, more to the point, the "lb" in
 * a member's name — cannot decide the unit of their scan.
 */
const LB_WORD = /\b(?:lbs?|Ibs?)\b/i;
const KG_WORD = /\bkgs?\b/i;

/**
 * Which unit these masses are in.
 *
 * The weight line wins, because that is where the machine prints the unit it
 * was configured with and because a sheet can carry the other unit elsewhere —
 * a height in cm, a target weight in a footnote. The whole document is only
 * consulted when the weight line itself is silent, and only when the document
 * names one unit and not the other; a sheet with both words on it and neither
 * beside the weight is genuinely ambiguous and returns null.
 */
export function sheetUnit(text: string, weightLine?: string | null): SheetUnit | null {
  const line = (weightLine ?? '').trim();
  if (line) {
    const lb = LB_WORD.test(line);
    const kg = KG_WORD.test(line);
    // unit-ok: this is the unit READ OFF the printout, not a fallback for one
    // nobody chose. The machine printed the word "lbs" next to the figure and
    // these two lines are what carries that fact out of the OCR text — the
    // same shape as the region→unit table in src/lib/unitPreference.ts, which
    // is marked for the same reason. The absence of an answer IS expressible
    // and is the third return below.
    if (lb && !kg) return 'lb';
    if (kg && !lb) return 'kg';   // unit-ok: as above — the printout's own word for its own unit.
  }
  const all = String(text ?? '');
  const lbAll = LB_WORD.test(all);
  const kgAll = KG_WORD.test(all);
  // unit-ok: as above — the sheet's own word for its own unit, taken from the
  // rest of the document when the weight line has lost it to a smudge. A sheet
  // that names both and neither falls through to null, which is what makes
  // this a reading rather than a guess.
  if (lbAll && !kgAll) return 'lb';
  if (kgAll && !lbAll) return 'kg';   // unit-ok: as above — the printout's own word for its own unit.
  return null;
}

const numbersIn = (s: string): number[] => (s.match(/\d{1,3}(?:\.\d)?/g) || []).map(Number);

/**
 * Everything worth having off the OCR text of an InBody sheet.
 *
 * The line matching is unchanged from the version that lived in the screen —
 * the same keywords, the same "not a target/control/ideal weight" exclusions,
 * the same last-number-on-the-line rule for weight — because that part was
 * working. What is new is that the unit comes back with the figures instead of
 * being assumed by whatever reads them.
 */
export function parseInBodySheet(text: string): SheetRead {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);
  let weight: number | null = null;
  let weightLine: string | null = null;
  let bodyFatPct: number | null = null;
  let muscle: number | null = null;
  let muscleLine: string | null = null;

  for (const ln of lines) {
    const low = ln.toLowerCase();
    if (bodyFatPct == null && (low.includes('pbf') || low.includes('percent body fat'))) {
      const n = numbersIn(ln).find((x) => x >= 3 && x <= 70);
      if (n !== undefined) bodyFatPct = n;
    }
    if (muscle == null && (low.includes('smm') || low.includes('skeletal muscle'))) {
      // The widest of the two bands, because the unit is not known yet. It is
      // re-checked against the resolved unit below.
      const n = numbersIn(ln).find((x) => x >= MUSCLE_BAND.kg[0] && x <= MUSCLE_BAND.lb[1]);
      if (n !== undefined) { muscle = n; muscleLine = ln; }
    }
    if (weight == null && low.includes('weight')
      && !low.includes('target') && !low.includes('control') && !low.includes('ideal')
      && !low.includes('over') && !low.includes('under')) {
      const cand = numbersIn(ln).filter((x) => x >= WEIGHT_BAND.kg[0] && x <= WEIGHT_BAND.lb[1]);
      if (cand.length) { weight = cand[cand.length - 1]; weightLine = ln; }
    }
  }

  if (bodyFatPct == null) { const m = src.match(/PBF[^0-9]{0,12}(\d{1,2}(?:\.\d)?)/i); if (m) bodyFatPct = Number(m[1]); }
  if (muscle == null) { const m = src.match(/SMM[^0-9]{0,12}(\d{1,2}(?:\.\d)?)/i); if (m) muscle = Number(m[1]); }

  // The muscle line is consulted second: on a sheet whose weight line lost its
  // unit to a smudge, "SMM (lbs)" is the same statement about the same machine.
  const unit = sheetUnit(src, weightLine) ?? sheetUnit(src, muscleLine);

  // Now that the unit is known, hold each figure to ITS band rather than to the
  // union of both. A "weight" of 300 on a sheet printed in kilograms is not a
  // person, it is the machine's own serial number or a total impedance reading
  // that happened to land on a line containing the word.
  const band = WEIGHT_BAND[unit ?? UNKNOWN_UNIT_ASSUMPTION];
  if (weight != null && (weight < band[0] || weight > band[1])) weight = null;
  const mband = MUSCLE_BAND[unit ?? UNKNOWN_UNIT_ASSUMPTION];
  if (muscle != null && (muscle < mband[0] || muscle > mband[1])) muscle = null;

  return { weight, bodyFatPct, muscle, unit, ok: weight != null || bodyFatPct != null || muscle != null };
}

/**
 * A mass off the sheet, as the kilograms the record stores.
 *
 * A null unit is read as kilograms — the machine's own default, and what this
 * app has always done — and the caller MUST say so on screen. That is the whole
 * contract of the third answer: it is not there so this function can quietly
 * pick one, it is there so the screen can tell the member which figure to
 * check. `ASSUMED_METRIC_NOTE` is that sentence.
 */
export function sheetMassKg(value: number | null | undefined, unit: SheetUnit | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return unit === 'lb' ? lbToKg(value) : value;
}

/** What the screen says when the printout did not name its unit. */
export const ASSUMED_METRIC_NOTE =
  'Your printout does not say whether it is in kilograms or pounds, so these were read as kilograms. Check the weight against the sheet before you save it.';

/** What the screen says when the printout named pounds, so the member can see
 *  why the figure in the box is not the one on the paper. */
export const CONVERTED_FROM_LB_NOTE =
  'Your printout is in pounds — the figures were converted, so they may not read the same as the paper.';
