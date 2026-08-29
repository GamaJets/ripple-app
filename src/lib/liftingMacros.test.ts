// Tests for liftingMacros — the lifting-tools macro guidance in grams.
//
// The property under test is the one TF-15's brief insisted on: a client with
// no weight or body fat on record gets nothing, not a default. Every "missing"
// shape has to come back null so the screen cannot render grams for a body
// nobody measured.
//
// Compile with tsc then run with node, like logic.test.ts.
import {
  liftingMacros, rangeLabel,
  PROTEIN_G_PER_KG_LEAN, FAT_G_PER_KG_BODYWEIGHT,
} from './liftingMacros';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// 80 kg at 20% body fat → 64 kg lean.
const m = liftingMacros(80, 20, 4);
ok(m !== null, 'a measured client gets figures');
ok(m!.leanMassKg === 64, 'lean mass is weight less the fat fraction');
ok(m!.protein.low === Math.round(64 * PROTEIN_G_PER_KG_LEAN.low), 'protein floor is off lean mass');
ok(m!.protein.high === Math.round(64 * PROTEIN_G_PER_KG_LEAN.high), 'protein ceiling is off lean mass');
ok(m!.protein.low === 115 && m!.protein.high === 141, '64 kg lean → 115–141 g protein');
// Fat is the one figure taken off TOTAL bodyweight, which is the distinction the
// reference table draws and the one a client doing this by hand gets wrong.
ok(m!.fat.low === Math.round(80 * FAT_G_PER_KG_BODYWEIGHT.low), 'fat floor is off bodyweight, not lean mass');
ok(m!.fat.low === 64 && m!.fat.high === 80, '80 kg → 64–80 g fat');
ok(m!.proteinPerMeal!.low === 29 && m!.proteinPerMeal!.high === 35, 'protein splits across four meals');

// ── nothing on record means nothing shown ──
ok(liftingMacros(null, 20, 4) === null, 'no weight on record yields no figures');
ok(liftingMacros(80, null, 4) === null, 'no body fat on record yields no figures');
ok(liftingMacros(null, null, 4) === null, 'neither figure yields no figures');
ok(liftingMacros(undefined, undefined, 4) === null, 'undefined is as absent as null');

// The specific numbers the placeholder body used to hand out. If a default ever
// creeps back in, this is where it shows up.
ok(liftingMacros(null, null, 3) === null, 'a missing body does not become 70 kg / 20%');

// ── figures that are not figures ──
ok(liftingMacros(0, 20, 3) === null, 'nobody weighs nothing');
ok(liftingMacros(-80, 20, 3) === null, 'a negative weight is not a weight');
ok(liftingMacros(NaN, 20, 3) === null, 'NaN is not a weight');
ok(liftingMacros(Infinity, 20, 3) === null, 'an infinite weight is not a weight');
ok(liftingMacros(500, 20, 3) === null, 'a weight past any real body is a typo, not a client');
ok(liftingMacros(80, 100, 3) === null, '100% body fat would advise 0 g of protein');
ok(liftingMacros(80, 120, 3) === null, 'a body fat over 100% is not a percentage');
ok(liftingMacros(80, -5, 3) === null, 'a negative body fat is not a percentage');
// 0% is not physiologically real but it is arithmetically harmless, and refusing
// it would refuse the honest lower edge of a lean athlete's entry.
ok(liftingMacros(80, 0, 3) !== null, 'zero body fat still computes off full bodyweight');

// ── the meal split is optional, and never guessed ──
const noMeals = liftingMacros(80, 20);
ok(noMeals !== null && noMeals.proteinPerMeal === null, 'an unstated meal count gives no per-meal figure');
ok(liftingMacros(80, 20, 0)!.proteinPerMeal === null, 'zero meals a day gives no per-meal figure');
ok(liftingMacros(80, 20, NaN)!.proteinPerMeal === null, 'an unreadable meal count gives no per-meal figure');
ok(liftingMacros(80, 20, 0)!.protein.low === 115, 'and losing the split does not disturb the daily range');

// ── labels ──
ok(rangeLabel({ low: 115, high: 141 }) === '115–141 g', 'a range reads as a range');
ok(rangeLabel({ low: 40, high: 40 }) === '40 g', 'a range that collapsed to one number reads as one number');
ok(rangeLabel({ low: 1, high: 2 }, 'kg') === '1–2 kg', 'the unit is not hardcoded');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'LIFTINGMACROS FAILURES:\n' + errors.join('\n') : 'ALL LIFTINGMACROS TESTS PASSED');
if (errors.length) process.exit(1);
