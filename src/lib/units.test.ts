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
  lengthIn, lengthLabel, lengthToCm, lengthDeltaIn, weightDeltaIn,
  kgToLb, lbToKg, cmToIn, inToCm, convertedNote, plain,
} from './units';
// The documents a client SHARES are the last thing TF-37 reached, and they are
// asserted here rather than in a file of their own because what is being
// checked is the conversion, not the prose: a report and a summary that print
// kilograms to a pounds reader, and a CSV that must not follow them.
import { progressChangeLines, progressSummary, progressCsv, PROGRESS_CSV_HEADER, type ProgressRow } from './progressExport';

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

// ── the weight twin of that, which seven screens each wrote for themselves ──
//
// The bug it prevents is not hypothetical: a change is the difference between
// two readings, and rounding BOTH readings into whole pounds before
// subtracting lets half a pound of rounding at each end move the answer by a
// whole pound in either direction. The sweep below is the statement — for
// every pair of stored weights 0.1 kg apart across a real range, converting
// the span is never worse than a pound out, whereas converting the ends first
// is demonstrably worse than that.
ok(weightDeltaIn(0, 'kg') === 0, 'no change is a change of zero, not an absent reading');
ok(weightDeltaIn(0, 'lb') === 0, 'and that is true in pounds too');
ok(weightDeltaIn(null, 'lb') === null, 'no previous weight means no change to report — never a change of 0');
ok(weightDeltaIn(undefined, 'kg') === null, 'and neither does an undefined one');
ok(weightDeltaIn(NaN, 'lb') === null, 'NaN is not a change');
ok(weightDeltaIn(Infinity, 'lb') === null, 'nor is infinity');
ok(weightDeltaIn(-2.3, 'kg') === -2.3, 'a metric client sees exactly the kilograms they saw before');
ok(weightDeltaIn(-2.3, 'lb') === -5, `−2.3 kg is −5 lb, got ${weightDeltaIn(-2.3, 'lb')}`);
ok(weightDeltaIn(2.3, 'lb') === 5, 'and a gain keeps its sign');
// Whole pounds, like every other weight this module prints — a tenth of a
// pound is a digit the 0.1 kg reading underneath cannot support.
ok(Number.isInteger(weightDeltaIn(-1.7, 'lb') as number), 'a converted change is whole pounds');

{
  // Converting the span vs. converting the ends, over every stored weight from
  // 40.0 to 200.0 kg and every change from −5.0 to +5.0 kg. The span is what
  // the client is entitled to; the ends-first answer is the bug.
  let spanWorst = 0, endsWorst = 0;
  for (let fromT = 400; fromT <= 2000; fromT += 7) {
    for (let dT = -50; dT <= 50; dT++) {
      const fromKg = fromT / 10, deltaKg = Math.round(dT) / 10;
      const toKg = Math.round((fromKg + deltaKg) * 10) / 10;
      const trueLb = kgToLb(toKg) - kgToLb(fromKg);
      const span = weightDeltaIn(deltaKg, 'lb') as number;
      const ends = (weightIn(toKg, 'lb') as number) - (weightIn(fromKg, 'lb') as number);
      spanWorst = Math.max(spanWorst, Math.abs(span - trueLb));
      endsWorst = Math.max(endsWorst, Math.abs(ends - trueLb));
    }
  }
  ok(spanWorst <= 0.5 + 1e-9, `a span converted once is never more than half a pound out, got ${spanWorst}`);
  ok(endsWorst > 0.5 + 1e-9, 'and converting the two ends first IS worse than that — which is why this function exists');
}

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


/* ── the documents a client SHARES (TF-37) ───────────────────────────────── */
//
// The last gap: eleven screens read in the client's unit and then the share
// button sent a coach, a spreadsheet or a story a metric document about the
// client's own body. Two of the three now convert. The third deliberately does
// not, and the assertion for it is that its header still names the unit its
// cells are really in — a file saying `weight_kg` over pounds would be worse
// than either honest answer, because nothing downstream could catch it.

{
  const row = (date: string, w: number | null, bf: number | null, mu: number | null): ProgressRow =>
    ({ date, weightKg: w, bodyFatPct: bf, muscleKg: mu });

  // 81.6 kg → 180 lb and 79.4 kg → 175 lb; the change is −2.2 kg = −4.85 lb,
  // which is −5 lb as a span. Note that 180 − 175 = 5 agrees here; the point
  // of asserting the span is the cases where it would not.
  const two = [row('2026-01-04', 81.6, 24.1, 33.2), row('2026-03-04', 79.4, 22.6, 33.9)];

  const kgLines = progressChangeLines(two);
  ok(kgLines[0] === 'Weight 81.6 kg → 79.4 kg (−2.2 kg)', `metric is untouched, got "${kgLines[0]}"`);

  const lbLines = progressChangeLines(two, 'lb');
  ok(lbLines[0] === 'Weight 180 lb → 175 lb (−5 lb)', `a pounds reader gets pounds, got "${lbLines[0]}"`);
  ok(!lbLines.some((l) => / kg/.test(l)), 'and no line of their report still says kg');
  ok(lbLines[2] === 'Muscle 73 lb → 75 lb (+2 lb)', `skeletal muscle is a mass and converts too, got "${lbLines[2]}"`);
  // The one row that must NOT move. A percentage of a body is the same
  // percentage however that body is weighed; converting it would print 53.1%
  // where the machine said 24.1%, and it would look like a measurement.
  ok(lbLines[1] === 'Body fat 24.1% → 22.6% (−1.5%)', `body fat is a percentage in every unit system, got "${lbLines[1]}"`);
  ok(progressChangeLines(two, 'kg')[1] === lbLines[1], 'body fat reads identically in both unit systems');

  // The change is the converted SPAN, not the difference of the two converted
  // ends. 81.4 kg and 81.6 kg are 179.5 lb and 179.9 lb — they round to
  // different whole pounds, so an ends-first implementation would announce a
  // pound of gain to a coach off two readings 0.44 lb apart. The span says 0,
  // and the two cells are each still correct to the pound.
  const straddle = [row('2026-01-04', 81.4, 24, 30), row('2026-02-04', 81.6, 24, 30)];
  ok(progressChangeLines(straddle, 'lb')[0] === 'Weight 179 lb → 180 lb (0 lb)',
    `a change under half a pound is reported as none, got "${progressChangeLines(straddle, 'lb')[0]}"`);
  // …and a change that IS a pound still reads as one, so the rule above is not
  // simply swallowing everything.
  const real = [row('2026-01-04', 81.9, 24, 30), row('2026-02-04', 81.0, 24, 30)];
  ok(progressChangeLines(real, 'lb')[0] === 'Weight 181 lb → 179 lb (−2 lb)',
    `a real loss is stated and signed, got "${progressChangeLines(real, 'lb')[0]}"`);

  // A lone scan is still never dressed up as a change, in either unit.
  const single = progressSummary('Tim', [row('2026-01-04', 81.6, 22, 33.2)], 'Repple', 'lb');
  ok(!/0\.0/.test(single), 'a lone scan is not summarised as a change of zero in pounds either');
  ok(/180 lb/.test(single), `it states the reading, in the client's unit — got "${single}"`);
  ok(!/ kg/.test(single), 'and does not mention kilograms anywhere');
  ok(/22%/.test(single), 'body fat still reads as the percentage the machine recorded');

  // Absence survives the conversion. This is the rule the whole units module is
  // built on, and a unit preference is not permitted to invent a reading.
  const missing = progressSummary('Tim', [row('2026-01-04', null, 22, null)], 'Repple', 'lb');
  ok(!/0 lb/.test(missing), 'an unweighed scan does not become 0 lb on the way through the converter');
  ok(/22%/.test(missing), 'while the figure that WAS recorded is still stated');

  // ── the CSV, which stays metric on purpose ──
  ok(PROGRESS_CSV_HEADER.join(',') === 'date,weight_kg,body_fat_pct,skeletal_muscle_kg',
    'the interchange header is fixed — a schema that changes with a client setting is not a schema');
  const csv = progressCsv([row('2026-01-04', 81.6, null, 33.2)]);
  const cells = csv.split(/\r?\n/)[1];
  ok(cells.includes('81.6'), 'the cells hold the kilograms the header promises, not converted pounds');
  ok(!cells.includes('180'), 'and specifically NOT pounds under a header that says kg');
  ok(/,,/.test(cells), 'a missing body fat is still an empty cell, never a zero');
}

if (errors.length) {
  console.error(`units.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('units.test.ts — ok');
