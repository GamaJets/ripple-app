// Which unit the AI reader's InBody numbers are in.
// Compile with tsc, run with node.
//
// Two failures, opposite directions, both shipped-able:
//   · a pounds sheet read as kilograms — 180 lb filed as 180 kg, which is the
//     defect src/lib/inbodySheet.ts exists to close and which the vision path
//     walked straight past;
//   · a figure the model had ALREADY converted converted a second time — 82 kg
//     filed as 37 kg, which is inside every band this app checks.
// Everything below is one or the other.
import { reconcileInBodyUnit, visionMassKg, visionMetricsKg } from './inbodyVision';
import { ASSUMED_METRIC_NOTE, CONVERTED_FROM_LB_NOTE } from './inbodySheet';
import { lbToKg } from './units';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the sheet says kilograms ──────────────────────────────────────────── */

{
  const v = reconcileInBodyUnit({ visionWeight: 81.8, sheetWeight: 81.8, sheetUnit: 'kg' });
  eq(v.convert, false, 'a metric sheet needs no conversion');
  eq(v.note, null, 'and nothing has to be said about a unit that was read and agreed with');
  eq(visionMassKg(81.8, v), 81.8, 'the figure passes through untouched');
}

/* ── the sheet says pounds and the model transcribed it ────────────────── */

{
  const v = reconcileInBodyUnit({ visionWeight: 180.4, sheetWeight: 180.4, sheetUnit: 'lb' });
  eq(v.unit, 'lb', 'the model handed back the printed pounds figure');
  eq(v.convert, true, 'so it is converted');
  eq(v.note, CONVERTED_FROM_LB_NOTE, 'and the member is told why the box does not match the paper');
  const kg = visionMassKg(180.4, v)!;
  ok(Math.abs(kg - 81.8) < 0.2, `180.4 lb is about 81.8 kg, got ${kg}`);
  // The muscle figure travels in the same unit as the weight — no InBody prints
  // one in pounds and the other in kilograms.
  const smm = visionMassKg(75.0, v)!;
  ok(Math.abs(smm - lbToKg(75)) < 0.001, 'and the muscle mass is converted with it');
}

// OCR rarely returns the figure to the decimal. Within tolerance is the same
// reading, or every real photograph would fall through to "unknown".
{
  const v = reconcileInBodyUnit({ visionWeight: 180.4, sheetWeight: 181, sheetUnit: 'lb' });
  eq(v.convert, true, 'a rounding difference is still the same printed figure');
}

/* ── the sheet says pounds and the model already converted ─────────────── */

{
  const v = reconcileInBodyUnit({ visionWeight: 81.8, sheetWeight: 180.4, sheetUnit: 'lb' });
  eq(v.convert, false, 'a figure the model already converted is NOT converted again');
  eq(v.unit, 'kg', 'it is already kilograms');
  const kg = visionMassKg(81.8, v)!;
  ok(kg > 70, `and the member is not filed at ${kg} kg, which is what converting twice gives`);
  eq(v.note, CONVERTED_FROM_LB_NOTE, 'the pounds printout is still worth mentioning — the box will not match the paper');
}

/* ── nothing that can settle it ────────────────────────────────────────── */

{
  // Two numbers that match neither story: something was misread.
  const v = reconcileInBodyUnit({ visionWeight: 95, sheetWeight: 180.4, sheetUnit: 'lb' });
  eq(v.convert, false, 'a disagreement is never resolved by converting on a guess');
  eq(v.unit, null, 'the unit is unknown, and says so');
  eq(v.note, ASSUMED_METRIC_NOTE, 'and the member is asked to check the figure against the sheet');
}

{
  // The words say pounds and there is no printed figure to check against.
  const v = reconcileInBodyUnit({ visionWeight: 180.4, sheetWeight: null, sheetUnit: 'lb' });
  eq(v.convert, false, 'with nothing to compare, converting could be the second conversion');
  eq(v.note, ASSUMED_METRIC_NOTE, 'so it is stated as an assumption rather than acted on');
}

{
  // No unit word anywhere — a photograph of a sheet whose header did not read.
  const v = reconcileInBodyUnit({ visionWeight: 81.8, sheetWeight: null, sheetUnit: null });
  eq(v.convert, false, 'the kilogram reading stands');
  eq(v.note, ASSUMED_METRIC_NOTE, 'and it is stated, which is the whole contract of the third answer');
}

{
  // No vision figure at all.
  const v = reconcileInBodyUnit({ visionWeight: null, sheetWeight: 180.4, sheetUnit: 'lb' });
  eq(visionMassKg(null, v), null, 'nothing in, nothing out');
  eq(visionMassKg(undefined, v), null, 'and an absent figure is not a zero');
}

eq(visionMassKg(Number.NaN, reconcileInBodyUnit({ visionWeight: 1, sheetWeight: 1, sheetUnit: 'kg' })), null,
  'a figure that is not a number never reaches the scan row');

/* ── the composition breakdown carries the same unit as the weight ──────
 *
 * The whole apparatus above was applied to two figures and the other ten came
 * out of the same model answer, off the same photograph, in the same prompt
 * that asks for every one of them "in kg". A pounds printout therefore had its
 * weight converted and its fat mass, lean mass, body water, protein, minerals
 * and five segmental lean figures filed 2.2x too large — in `scans.metrics`,
 * which is stored and which the coach's roster reads.
 */

{
  const lb = reconcileInBodyUnit({ visionWeight: 180.4, sheetWeight: 180.4, sheetUnit: 'lb' });
  eq(lb.convert, true, 'the sheet is in pounds and the model transcribed it');
  const m = visionMetricsKg({
    visceralFat: 9, inbodyScore: 74, bmr: 1680,
    fatMassKg: 42.9, leanMassKg: 137.5, bodyWaterL: 100.6,
    proteinKg: 27.3, mineralsKg: 9.6,
    leanArmLKg: 7.7, leanArmRKg: 7.9, leanTrunkKg: 60.1,
    leanLegLKg: 22.4, leanLegRKg: 22.8,
  }, lb);
  ok(m != null, 'a breakdown that was read comes back');
  const g = m as Record<string, number | undefined>;
  eq(g.fatMassKg, lbToKg(42.9), 'fat mass off a pounds sheet is stored in kilograms');
  eq(g.leanMassKg, lbToKg(137.5), 'and so is lean mass, which was larger than the whole body before this');
  eq(g.proteinKg, lbToKg(27.3), 'protein too');
  eq(g.mineralsKg, lbToKg(9.6), 'and minerals');
  eq(g.leanArmLKg, lbToKg(7.7), 'every segmental figure is on the same sheet in the same unit');
  eq(g.leanArmRKg, lbToKg(7.9), 'both arms');
  eq(g.leanTrunkKg, lbToKg(60.1), 'the trunk');
  eq(g.leanLegLKg, lbToKg(22.4), 'and both legs');
  eq(g.bodyWaterL, lbToKg(100.6), 'total body water is printed in pounds on the same sheet; a litre of it is a kilogram');
  // The three that carry no mass unit at all. Converting any of them would be
  // the mirror of the defect: a visceral fat LEVEL of 9 filed as 4.1.
  eq(g.visceralFat, 9, 'a visceral fat level is unitless and is never scaled');
  eq(g.inbodyScore, 74, 'the InBody score is points');
  eq(g.bmr, 1680, 'and the BMR is kilocalories');
  const smm = visionMassKg(64.3, lb);
  ok(smm != null && (g.leanMassKg as number) > smm, 'lean mass still exceeds skeletal muscle, as it must');
  ok((g.leanMassKg as number) < 81.9, 'and lean mass is now under the 81.8 kg body it belongs to');
}

{
  // A metric sheet: the figures pass through untouched, and the object is still
  // a fresh one so no caller can come to depend on identity on one path only.
  const kg = reconcileInBodyUnit({ visionWeight: 81.8, sheetWeight: 81.8, sheetUnit: 'kg' });
  const src = { fatMassKg: 19.5, leanMassKg: 62.3, visceralFat: 9 };
  const m = visionMetricsKg(src, kg) as Record<string, number | undefined>;
  eq(m.fatMassKg, 19.5, 'a kilogram sheet is not converted');
  eq(m.leanMassKg, 62.3, 'nor is its lean mass');
  ok(m !== (src as unknown), 'and a copy is returned on both paths, not the caller\u2019s own object');
}

{
  // An unknown unit is not a pounds unit. `convert` is false, so the kilogram
  // reading stands here exactly as it does for the weight, and the screen says
  // it assumed.
  const unknown = reconcileInBodyUnit({ visionWeight: 95, sheetWeight: 180.4, sheetUnit: 'lb' });
  const m = visionMetricsKg({ fatMassKg: 42.9 }, unknown) as Record<string, number | undefined>;
  eq(m.fatMassKg, 42.9, 'an unresolved unit converts nothing, the same answer the weight gets');
}

{
  const lb = reconcileInBodyUnit({ visionWeight: 180.4, sheetWeight: 180.4, sheetUnit: 'lb' });
  eq(visionMetricsKg(null, lb), undefined, 'a sheet with no breakdown read off it stays absent');
  eq(visionMetricsKg(undefined, lb), undefined, 'and an absent breakdown is never an object full of nulls');
  const m = visionMetricsKg({ fatMassKg: Number.NaN, leanMassKg: 137.5 }, lb) as Record<string, number | undefined>;
  ok(Number.isNaN(m.fatMassKg as number), 'a figure that is not a number is not scaled into a different nonsense');
  eq(m.leanMassKg, lbToKg(137.5), 'and the figures beside it are still converted');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('inbodyVision.test.ts — all assertions passed');
