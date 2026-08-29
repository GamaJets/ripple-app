// Unit conversion (TF-37). Compile with tsc then run with node.
//
// The assertion this file exists for is the round trip, and it is swept rather
// than sampled. The bug being fixed — type 180 lb, come back to 179.9 lb —
// passes any test that only checks one value, because most values happen to
// survive one decimal place. It is the ones that do not that people report.
//
// The negative assertions matter just as much: an empty field must produce
// null, not 0. `parseFloat('') || 0` stored 0 kg for anybody who opened the
// profile edit sheet to change their name, and 0 kg is a number the macro
// calculator will build a day of food around.
import {
  weightIn, weightLabel, weightToKg,
  heightIn, heightParts, heightLabel, heightToCm,
  lengthIn, lengthLabel, lengthToCm, lengthDeltaIn,
  kgToLb, lbToKg, cmToIn, inToCm, convertedNote, plain,
} from './units';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// ── the exact factors ──
// If these drift the whole module is quietly wrong, and every assertion below
// would still pass against a self-consistent but incorrect constant.
ok(Math.abs(lbToKg(1) - 0.45359237) < 1e-12, '1 lb must be exactly 0.45359237 kg');
ok(Math.abs(inToCm(1) - 2.54) < 1e-12, '1 in must be exactly 2.54 cm');
ok(Math.abs(kgToLb(lbToKg(3.7)) - 3.7) < 1e-9, 'kg→lb must invert lb→kg');
ok(Math.abs(cmToIn(inToCm(9.3)) - 9.3) < 1e-9, 'cm→in must invert in→cm');
// A known reading, checked against arithmetic done outside this module.
ok(weightIn(81.6, 'lb') === 180, `81.6 kg is 180 lb, got ${weightIn(81.6, 'lb')}`);
ok(weightIn(81.6, 'kg') === 81.6, 'a kilogram reading read out in kilograms is itself');

// ── THE round trip: what the client typed is what the client sees ──
//
// Type a weight in pounds → store kilograms → read it back in pounds. Every
// whole pound across a range no adult body weight leaves. This is the sweep
// that fails if the storage grain and the display grain are ever changed to
// within a rounding step of each other.
for (let lb = 60; lb <= 700; lb++) {
  const kg = weightToKg(String(lb), 'lb');
  ok(kg != null, `${lb} lb must parse`);
  const back = weightIn(kg, 'lb');
  ok(back === lb, `${lb} lb stored as ${kg} kg came back as ${back} lb — a client's own number changed under them`);
}
// The named case from the report, spelled out so it cannot be lost in a loop.
ok(weightLabel(weightToKg('180', 'lb'), 'lb') === '180 lb',
  `typing 180 lb must read back as "180 lb", got "${weightLabel(weightToKg('180', 'lb'), 'lb')}"`);

// And the metric client's trip, which must not have been sacrificed for it.
for (let tenths = 300; tenths <= 3000; tenths++) {
  const kg = tenths / 10;
  const stored = weightToKg(String(kg), 'kg');
  ok(weightIn(stored, 'kg') === kg, `${kg} kg came back as ${weightIn(stored, 'kg')} kg`);
}

// Height, both ways. Whole inches in, whole inches out.
for (let feet = 3; feet <= 7; feet++) {
  for (let inch = 0; inch < 12; inch++) {
    const cm = heightToCm(String(feet), 'in', String(inch));
    const p = heightParts(cm);
    ok(p != null && p.feet === feet && p.inches === inch,
      `${feet}' ${inch}" stored as ${cm} cm came back as ${p?.feet}' ${p?.inches}"`);
  }
}
for (let cm = 100; cm <= 230; cm++) {
  ok(heightIn(heightToCm(String(cm), 'cm'), 'cm') === cm, `${cm} cm came back as ${heightIn(heightToCm(String(cm), 'cm'), 'cm')}`);
}
ok(heightLabel(177.8, 'in') === `5' 10"`, `177.8 cm is 5' 10", got ${heightLabel(177.8, 'in')}`);
ok(heightLabel(177.8, 'cm') === '178 cm', `177.8 cm reads as 178 cm, got ${heightLabel(177.8, 'cm')}`);

// Tape measurements, which are finer than height because that is what makes
// them worth logging. Tenths of an inch in, tenths of an inch out.
for (let tenths = 100; tenths <= 700; tenths++) {
  const inches = tenths / 10;
  const cm = lengthToCm(String(inches), 'in');
  ok(lengthIn(cm, 'in') === inches, `${inches} in stored as ${cm} cm came back as ${lengthIn(cm, 'in')} in`);
}
for (let tenths = 200; tenths <= 1600; tenths++) {
  const cm = tenths / 10;
  ok(lengthIn(lengthToCm(String(cm), 'cm'), 'cm') === cm, `${cm} cm came back as ${lengthIn(lengthToCm(String(cm), 'cm'), 'cm')} cm`);
}

// ── nothing in, nothing claimed ──
// Every one of these used to be a 0 somewhere on a real screen.
ok(weightToKg('', 'kg') === null, 'an empty weight field is not 0 kg');
ok(weightToKg('', 'lb') === null, 'an empty weight field is not 0 lb either');
ok(weightToKg('   ', 'kg') === null, 'whitespace is not a weight');
ok(weightToKg('abc', 'kg') === null, 'letters are not a weight');
ok(weightToKg(null, 'kg') === null, 'no weight at all is not 0 kg');
ok(heightToCm('', 'cm') === null, 'an empty height field is not 0 cm');
ok(heightToCm('', 'in', '') === null, 'an empty feet AND inches pair is not 0 cm');
ok(lengthToCm('', 'cm') === null, 'an empty tape field is not 0 cm');
ok(weightIn(null, 'lb') === null, 'a client who has never been weighed has no pounds');
ok(weightIn(undefined, 'kg') === null, 'and no kilograms');
ok(weightLabel(null, 'lb') === null, 'no reading produces no label — the screens turn that into a dash');
ok(heightIn(null, 'in') === null, 'no height produces no inches');
ok(heightParts(null) === null, 'no height produces no feet-and-inches');
ok(heightLabel(null, 'cm') === null, 'no height produces no label');
ok(lengthIn(null, 'in') === null, 'no tape reading produces no inches');
ok(lengthLabel(undefined, 'cm') === null, 'and no label');
ok(weightIn(NaN, 'kg') === null, 'NaN is not a weight');
ok(weightIn(Infinity, 'lb') === null, 'nor is infinity');

// A real zero is a different thing from an absent one, and stays a zero: a
// waist that did not change is "0.0", not a dash.
ok(lengthDeltaIn(0, 'cm') === 0, 'no change is a change of zero, not an absent reading');
ok(lengthDeltaIn(null, 'in') === null, 'but no previous reading means no change to report');
// A span is converted once, not as the difference of two conversions — the
// latter wobbles between 0.3 and 0.4 in depending where the readings sat.
ok(lengthDeltaIn(-1, 'in') === -0.4, `−1.0 cm is −0.4 in, got ${lengthDeltaIn(-1, 'in')}`);

// ── partial imperial height ──
ok(heightToCm('5', 'in', '') === 152.4, `5 ft with no inches is 152.4 cm, got ${heightToCm('5', 'in', '')}`);
ok(heightToCm('', 'in', '4') === 10.2, `4 inches alone is 10.2 cm, got ${heightToCm('', 'in', '4')}`);

// ── typing habits ──
// A comma decimal is what half of this app's users type, and parseFloat throws
// away everything after it: "82,4" silently became 82 kg.
ok(weightToKg('82,4', 'kg') === 82.4, `"82,4" must read as 82.4 kg, got ${weightToKg('82,4', 'kg')}`);
ok(weightToKg(' 82.4 ', 'kg') === 82.4, 'surrounding spaces are not part of the number');

// ── presentation ──
ok(plain(82) === '82', 'a whole number does not grow a ".0"');
ok(plain(82.4) === '82.4', 'and a tenth is kept');
ok(weightLabel(82.0, 'kg') === '82 kg', `82 kg reads as "82 kg", got "${weightLabel(82.0, 'kg')}"`);
// The honesty note, which is the difference between a converted figure and a
// figure presented as a measurement.
ok(convertedNote('kg') === null, 'a client reading their record in its own unit needs no caveat');
ok(convertedNote('cm') === null, 'nor in centimetres');
ok(typeof convertedNote('lb') === 'string', 'pounds are converted, and say so');
ok(typeof convertedNote('in') === 'string', 'so are inches');

if (errors.length) {
  console.error(`units.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('units.test.ts — ok');
