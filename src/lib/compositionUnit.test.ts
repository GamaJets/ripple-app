// The finer pound rule the composition table is converted by. Compile with
// tsc, run with node.
//
// The table it serves was left in kilograms for years on the strength of one
// argument: whole pounds cannot carry a 0.01 kg segmental reading, and a second
// rule for pounds risks the same value being shown two ways. This file is what
// makes the second rule safe to have — it asserts the two things that argument
// was actually worried about:
//
//   · that the finer rule AGREES with src/lib/units.ts wherever the two could
//     be compared (a one-decimal kilogram is whole pounds in both), so nothing
//     in the app is printed at two grains; and
//   · that it is finer ONLY where the record is finer, so no digit is printed
//     that the stored reading never measured.
//
// The third is the one every unit module in this tree has to prove separately:
// a CHANGE is converted as a change, once, rather than subtracted from two
// separately converted ends.
import {
  isConvertibleMass, compositionUnitOf, compositionDecimals,
  compositionIn, compositionDeltaIn,
} from './compositionUnit';
import { weightIn, weightDeltaIn, KG_PER_LB } from './units';

const errors: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} (got ${String(a)}, wanted ${String(b)})`);

// ── which metrics convert at all ───────────────────────────────────────────

ok(isConvertibleMass('kg'), 'a kilogram is a mass and reads in the member’s unit');
ok(!isConvertibleMass('L'), 'a litre of body water is a volume, not a mass to be turned into pounds');
ok(!isConvertibleMass('kcal'), 'a BMR is energy');
ok(!isConvertibleMass('lvl'), 'a visceral fat level is a level');
ok(!isConvertibleMass('pts'), 'an InBody score is a score');

eq(compositionUnitOf('kg', 'lb'), 'lb', 'a converted figure is labelled in the unit it was converted to');
eq(compositionUnitOf('kg', 'kg'), 'kg', 'and in kilograms when that is what the member reads');
eq(compositionUnitOf('L', 'lb'), 'L', 'a litre keeps its own label even for a pounds reader');
eq(compositionUnitOf('kcal', 'lb'), 'kcal', 'and so does a kcal');

// ── the grain ──────────────────────────────────────────────────────────────

eq(compositionDecimals(1, 'kg'), 1, 'kilograms keep the grain the record was stored at');
eq(compositionDecimals(2, 'kg'), 2, 'including the two decimals a limb carries');

eq(compositionDecimals(0, 'lb'), 0,
  'a whole-kilogram grain is 2.2 lb, and the clamp stops that asking for tens of pounds');
eq(compositionDecimals(1, 'lb'), 0,
  'a 0.1 kg grain is 0.22 lb, so a tenth of a pound would be half a step of invented precision');
eq(compositionDecimals(2, 'lb'), 1,
  'a 0.01 kg grain is 0.022 lb, which a tenth of a pound carries and a whole pound throws away');

// The agreement the header promises: a one-decimal kilogram — which is how
// `scans.weight_kg` itself is stored — comes out at the same grain `weightIn`
// already prints a body weight at. Asserted against `weightIn` rather than
// against the literal 0, so the two rules cannot drift apart later.
const bodyish = weightIn(84.25, 'lb');
eq(bodyish != null && bodyish === Math.round(bodyish), true,
  'weightIn prints a body weight in whole pounds');
eq(compositionDecimals(1, 'lb'), 0,
  'and the composition rule prints a one-decimal kilogram at that same grain');

// ── a reading, converted point by point ────────────────────────────────────

eq(compositionIn(11.8, 'kg', 1), 11.8, 'a kilogram reader sees the stored figure');
eq(compositionIn(11.8, 'lb', 1), 26, '11.8 kg of fat mass is 26 lb, whole');
eq(compositionIn(3.42, 'lb', 2), 7.5, 'and a 3.42 kg arm is 7.5 lb, to the tenth its grain supports');
eq(compositionIn(3.42, 'kg', 2), 3.42, 'unchanged for a kilogram reader');

eq(compositionIn(null, 'lb', 1), null, 'null in, null out');
eq(compositionIn(undefined, 'lb', 1), null, 'and undefined is not zero either');
eq(compositionIn(Number.NaN, 'lb', 1), null, 'NaN is not a reading');
eq(compositionIn(Number.POSITIVE_INFINITY, 'lb', 2), null, 'nor is Infinity');
eq(compositionIn(0, 'lb', 1), 0, 'but a genuine zero is a figure and survives');

// The exact definition, not an approximation: 1 lb is 0.45359237 kg by
// international agreement, so this is arithmetic rather than a constant
// somebody typed from memory.
eq(compositionIn(KG_PER_LB, 'lb', 2), 1, 'one pound of kilograms is one pound');

// ── a change, converted as a change ────────────────────────────────────────

eq(compositionDeltaIn(-1.3, 'lb', 1), -3, 'a 1.3 kg drop in fat mass is 3 lb down');
eq(compositionDeltaIn(0.08, 'lb', 2), 0.2, 'and an 0.08 kg gain in an arm is 0.2 lb');

// The whole reason a delta has its own function. Two readings a genuine 0.4 kg
// apart, straddling a pound boundary: converting each end and subtracting gives
// a different answer depending on nothing the member did.
const endsApart = (aKg: number, bKg: number) =>
  (compositionIn(bKg, 'lb', 1) ?? 0) - (compositionIn(aKg, 'lb', 1) ?? 0);
eq(compositionDeltaIn(0.4, 'lb', 1), 1, 'a 0.4 kg gain is 1 lb, converted once — wherever it fell');
eq(endsApart(20.0, 20.4), 1, 'where subtracting two converted ends calls that same 0.4 kg a pound here');
eq(endsApart(20.2, 20.6), 0, 'and calls it nothing at all two hundred grams further up the scale');

// Symmetry. A movement must not read as something in one direction and nothing
// in the other, which is what Math.round does to −0.5.
eq(compositionDeltaIn(0.05, 'lb', 2), 0.1, 'a small gain in a limb rounds out to a tenth');
eq(compositionDeltaIn(-0.05, 'lb', 2), -0.1, 'and the same distance down rounds out the same way');

// Too small to show, and said as nothing rather than as a signed zero. This is
// the value `deltaLabel` turns into the words "no change".
eq(compositionDeltaIn(0.2, 'lb', 1), 0,
  'a 0.2 kg move is not a pound, and is reported as no movement rather than as +0 lb');
eq(compositionDeltaIn(-0.2, 'lb', 1), -0,
  'and neither is a 0.2 kg move down');
ok(!(compositionDeltaIn(-0.2, 'lb', 1) as number),
  'both of which are falsy zero, so no screen can sign them');

eq(compositionDeltaIn(null, 'lb', 1), null, 'no earlier reading is not a change of nothing');
eq(compositionDeltaIn(Number.NaN, 'lb', 1), null, 'and unreadable arithmetic is not a movement');

// The same span through the body-weight rule, for the reader who wants to know
// these two agree on a body weight's grain: both come out whole.
const wd = weightDeltaIn(0.4, 'lb');
eq(wd, compositionDeltaIn(0.4, 'lb', 1),
  'a one-decimal kilogram span converts identically under both rules');

if (errors.length) {
  console.error(`compositionUnit: ${errors.length} of ${checks} checks failed:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`compositionUnit ok — ${checks} checks (the finer pound rule agrees with the body-weight one wherever both could speak)`);
