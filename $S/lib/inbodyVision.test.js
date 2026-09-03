"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const inbodyVision_1 = require("./inbodyVision");
const inbodySheet_1 = require("./inbodySheet");
const units_1 = require("./units");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the sheet says kilograms ──────────────────────────────────────────── */
{
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 81.8, sheetWeight: 81.8, sheetUnit: 'kg' });
    eq(v.convert, false, 'a metric sheet needs no conversion');
    eq(v.note, null, 'and nothing has to be said about a unit that was read and agreed with');
    eq((0, inbodyVision_1.visionMassKg)(81.8, v), 81.8, 'the figure passes through untouched');
}
/* ── the sheet says pounds and the model transcribed it ────────────────── */
{
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 180.4, sheetWeight: 180.4, sheetUnit: 'lb' });
    eq(v.unit, 'lb', 'the model handed back the printed pounds figure');
    eq(v.convert, true, 'so it is converted');
    eq(v.note, inbodySheet_1.CONVERTED_FROM_LB_NOTE, 'and the member is told why the box does not match the paper');
    const kg = (0, inbodyVision_1.visionMassKg)(180.4, v);
    ok(Math.abs(kg - 81.8) < 0.2, `180.4 lb is about 81.8 kg, got ${kg}`);
    // The muscle figure travels in the same unit as the weight — no InBody prints
    // one in pounds and the other in kilograms.
    const smm = (0, inbodyVision_1.visionMassKg)(75.0, v);
    ok(Math.abs(smm - (0, units_1.lbToKg)(75)) < 0.001, 'and the muscle mass is converted with it');
}
// OCR rarely returns the figure to the decimal. Within tolerance is the same
// reading, or every real photograph would fall through to "unknown".
{
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 180.4, sheetWeight: 181, sheetUnit: 'lb' });
    eq(v.convert, true, 'a rounding difference is still the same printed figure');
}
/* ── the sheet says pounds and the model already converted ─────────────── */
{
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 81.8, sheetWeight: 180.4, sheetUnit: 'lb' });
    eq(v.convert, false, 'a figure the model already converted is NOT converted again');
    eq(v.unit, 'kg', 'it is already kilograms');
    const kg = (0, inbodyVision_1.visionMassKg)(81.8, v);
    ok(kg > 70, `and the member is not filed at ${kg} kg, which is what converting twice gives`);
    eq(v.note, inbodySheet_1.CONVERTED_FROM_LB_NOTE, 'the pounds printout is still worth mentioning — the box will not match the paper');
}
/* ── nothing that can settle it ────────────────────────────────────────── */
{
    // Two numbers that match neither story: something was misread.
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 95, sheetWeight: 180.4, sheetUnit: 'lb' });
    eq(v.convert, false, 'a disagreement is never resolved by converting on a guess');
    eq(v.unit, null, 'the unit is unknown, and says so');
    eq(v.note, inbodySheet_1.ASSUMED_METRIC_NOTE, 'and the member is asked to check the figure against the sheet');
}
{
    // The words say pounds and there is no printed figure to check against.
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 180.4, sheetWeight: null, sheetUnit: 'lb' });
    eq(v.convert, false, 'with nothing to compare, converting could be the second conversion');
    eq(v.note, inbodySheet_1.ASSUMED_METRIC_NOTE, 'so it is stated as an assumption rather than acted on');
}
{
    // No unit word anywhere — a photograph of a sheet whose header did not read.
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 81.8, sheetWeight: null, sheetUnit: null });
    eq(v.convert, false, 'the kilogram reading stands');
    eq(v.note, inbodySheet_1.ASSUMED_METRIC_NOTE, 'and it is stated, which is the whole contract of the third answer');
}
{
    // No vision figure at all.
    const v = (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: null, sheetWeight: 180.4, sheetUnit: 'lb' });
    eq((0, inbodyVision_1.visionMassKg)(null, v), null, 'nothing in, nothing out');
    eq((0, inbodyVision_1.visionMassKg)(undefined, v), null, 'and an absent figure is not a zero');
}
eq((0, inbodyVision_1.visionMassKg)(Number.NaN, (0, inbodyVision_1.reconcileInBodyUnit)({ visionWeight: 1, sheetWeight: 1, sheetUnit: 'kg' })), null, 'a figure that is not a number never reaches the scan row');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('inbodyVision.test.ts — all assertions passed');
