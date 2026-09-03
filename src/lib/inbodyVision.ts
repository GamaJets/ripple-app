// Which unit the AI reader's InBody figures are in, decided from the sheet's
// own printed words rather than from the name of the field.
//
// ── The defect this closes ────────────────────────────────────────────────
//
// src/lib/inbodySheet.ts was written to stop a US-configured InBody printout —
// weight 180.4, printed "lbs" — being filed as 180 kg. It reads the unit off
// the words beside the figure and converts. All of that works, and on the path
// that runs it never got the chance: app/(client)/scans.tsx asked the vision
// model first and RETURNED on a successful read, so `parseInBodySheet` was
// reached only when the model failed.
//
// The vision model is asked for a field called `weightKg` and hands back a bare
// number. It has no unit in it. supabase/functions/vision-analyze prompts for
// "total body weight kg", so the model either transcribes the printed 180.4 or
// converts it to 81.8, and NOTHING IN THE ANSWER SAYS WHICH. Reading it as
// kilograms was a coin toss that this app had already decided not to take once.
//
// ── How this decides ──────────────────────────────────────────────────────
//
// The OCR text of the same photograph is the evidence. It carries the words
// `kg` or `lbs` — which `sheetUnit` already reads — and usually the printed
// figure as well. So:
//
//   · the sheet says kilograms → nothing to do.
//   · the sheet says pounds, and the model's number MATCHES the printed one →
//     the model transcribed. Convert.
//   · the sheet says pounds, and the model's number matches the CONVERTED one →
//     the model already converted. Do not convert twice; the second conversion
//     would file an 82 kg member at 37 kg.
//   · anything else — no words on the sheet, no printed figure to compare, or
//     two numbers that match neither story — is UNKNOWN. The kilogram reading
//     is kept, because that is the machine's default, and the screen says out
//     loud that it assumed, exactly as the text path already does.
//
// Unknown is a real answer and it is the point of the module. A silent guess is
// what put 180 lb into somebody's calorie target.
import { lbToKg } from './units';
import { ASSUMED_METRIC_NOTE, CONVERTED_FROM_LB_NOTE, type SheetUnit } from './inbodySheet';

/** How far apart two readings of the same printed figure may be and still be
 *  the same figure. OCR drops a decimal point and a model rounds; 2% of 180 is
 *  3.6, which is far below the 2.2× gap between the two unit stories. */
const TOLERANCE = 0.02;

const near = (a: number, b: number): boolean => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return false;
  return Math.abs(a - b) / Math.abs(b) <= TOLERANCE;
};

export interface UnitVerdict {
  /** The unit the model's numbers are in, or null when nothing could tell. */
  unit: SheetUnit | null;
  /** Whether the caller must convert the model's masses to kilograms. */
  convert: boolean;
  /** What the member is told, or null when there is nothing to say — which is
   *  only the case when the sheet named kilograms and the reading agreed. */
  note: string | null;
}

/**
 * What unit the vision reader's masses are in.
 *
 * `visionWeight` is the model's `weightKg` as it arrived. `sheetWeight` and
 * `sheetUnit` are `parseInBodySheet`'s reading of the OCR text of the same
 * image — the figure AS PRINTED and the unit read off the words.
 */
export function reconcileInBodyUnit(args: {
  visionWeight: number | null;
  sheetWeight: number | null;
  sheetUnit: SheetUnit | null;
}): UnitVerdict {
  const { visionWeight, sheetWeight, sheetUnit } = args;

  if (sheetUnit === 'kg') {
    // The sheet named kilograms. Whatever the model did, the printed figure was
    // already the stored unit and there is nothing to convert or to warn about.
    return { unit: 'kg', convert: false, note: null };
  }

  if (sheetUnit === 'lb') {
    if (visionWeight != null && sheetWeight != null) {
      if (near(visionWeight, sheetWeight)) {
        return { unit: 'lb', convert: true, note: CONVERTED_FROM_LB_NOTE };
      }
      if (near(visionWeight, lbToKg(sheetWeight))) {
        // The model did the conversion itself. Doing it again is the mirror of
        // the original defect and is worse, because 82 → 37 kg is a body no
        // adult has and it would still sit inside the app's own band.
        return { unit: 'kg', convert: false, note: CONVERTED_FROM_LB_NOTE };
      }
      // Two numbers that tell neither story. Something was misread and this
      // module will not pick a winner.
      return { unit: null, convert: false, note: ASSUMED_METRIC_NOTE };
    }
    // The words say pounds and there is no printed figure to check the model
    // against. Not convertible on those terms: if the model had already
    // converted, doing it again is the 37 kg case above.
    return { unit: null, convert: false, note: ASSUMED_METRIC_NOTE };
  }

  // No unit word anywhere on the sheet. The kilogram reading stands, and it is
  // stated rather than assumed silently — the member is holding the printout
  // and is the only one who can settle it.
  return { unit: null, convert: false, note: ASSUMED_METRIC_NOTE };
}

/** One of the model's masses as the kilograms the scan row stores. */
export function visionMassKg(value: number | null | undefined, verdict: UnitVerdict): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return verdict.convert ? lbToKg(value) : value;
}
