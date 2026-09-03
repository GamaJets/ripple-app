// Reading an InBody printout, and the unit it was printed in.
//
// Compile with tsc, then run under plain node.
//
// The defect this is written against: the reader assumed every sheet was
// metric, the accepted weight band (35–250) contains both a kilogram body
// weight and a pound one, and so a US-configured machine's 180 lb sheet filled
// the box with 397 lb — or with 180 kg — and was saved as a body composition
// that re-tunes the member's calorie target. Every assertion below is about a
// way that can happen: the unit not being read, the unit being read off the
// wrong line, or an unknown unit being quietly treated as a known one.
import {
  parseInBodySheet, sheetUnit, sheetMassKg, ASSUMED_METRIC_NOTE, CONVERTED_FROM_LB_NOTE,
} from './inbodySheet';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const close = (a: number | null, b: number, msg: string) =>
  ok(a != null && Math.abs(a - b) < 0.05, `${msg} — got ${JSON.stringify(a)}, wanted about ${b}`);

/* ── 1. a metric sheet, which is what always worked ───────────────────────── */

const metric = parseInBodySheet([
  'InBody 570 Body Composition Result Sheet',
  'Weight (kg) 82.4',
  'SMM (kg) 36.1',
  'PBF (%) 18.2',
].join('\n'));
eq(metric.unit, 'kg', 'a sheet that says kg is in kg');
eq(metric.weight, 82.4, 'the weight is the weight');
eq(metric.muscle, 36.1, 'and so is the muscle');
eq(metric.bodyFatPct, 18.2, 'and body fat is a percentage in every configuration');
eq(sheetMassKg(metric.weight, metric.unit), 82.4, 'a metric mass is stored as it was printed');

/* ── 2. THE defect: a US sheet, in pounds ─────────────────────────────────── */

const imperial = parseInBodySheet([
  'InBody 570 Body Composition Result Sheet',
  'Weight (lbs) 180.4',
  'SMM (lbs) 79.6',
  'PBF (%) 18.2',
].join('\n'));
eq(imperial.unit, 'lb', 'a sheet that says lbs is in pounds');
eq(imperial.weight, 180.4, 'the figure read is the figure PRINTED, not a converted one');
close(sheetMassKg(imperial.weight, imperial.unit), 81.83, 'and it is converted once, on the way to the record');
close(sheetMassKg(imperial.muscle, imperial.unit), 36.11, 'the muscle mass carries the same unit as the weight, and converts with it');

// The specific number from the report. 180 lb read as 180 kg and then shown to
// a member whose phone is set to pounds is 397.
const wrong = 180 / 0.45359237;
ok(Math.round(wrong) === 397, 'the arithmetic behind the reported 397 is what it is');
ok(Math.round(sheetMassKg(180, 'lb')! / 0.45359237) === 180, 'and reading the unit gives the member back their own 180');

/* ── 3. the third answer: a sheet that does not say ───────────────────────── */

const silent = parseInBodySheet(['Weight 82.4', 'SMM 36.1', 'PBF 18.2'].join('\n'));
eq(silent.unit, null, 'a sheet with no unit on it returns null — which is not the same as kilograms');
eq(silent.weight, 82.4, 'the figures are still read');
eq(sheetMassKg(silent.weight, silent.unit), 82.4, 'and are assumed metric, because the machine\'s default is');
ok(ASSUMED_METRIC_NOTE.toLowerCase().includes('check'), 'and the screen is given a sentence that asks the member to check it');
ok(CONVERTED_FROM_LB_NOTE.toLowerCase().includes('pounds'), 'and a different one for a sheet that was converted');

// Ambiguity is ambiguity. A sheet naming both units, with neither beside the
// weight, is not resolved by picking the first one seen.
eq(sheetUnit('Height 178 cm\nWeight 82.4\nBasal Metabolic Rate 1720 kcal\nTarget 80 kg\nBone mass 3.2 lbs', ''), null,
  'a document naming both units and neither on the weight line is ambiguous');

/* ── 4. which line the unit is read off ───────────────────────────────────── */

// The weight line wins over the rest of the document: a metric height or a
// footnote in the other unit must not decide the masses.
eq(sheetUnit('Height 5\' 10"\nWeight (kg) 82.4\nsomething about lbs', 'Weight (kg) 82.4'), 'kg',
  'the weight line decides, even where the document mentions the other unit');
// And when the weight line lost its unit, the muscle line is the same
// statement about the same machine.
const smudged = parseInBodySheet(['Weight 180.4', 'SMM (lbs) 79.6', 'PBF (%) 18.2'].join('\n'));
eq(smudged.unit, 'lb', 'a smudged weight line falls back to the muscle line, which says the same thing');

/* ── 5. the lines that are not the member's weight ────────────────────────── */

const withTargets = parseInBodySheet([
  'Weight (kg) 82.4',
  'Target Weight 75.0',
  'Weight Control -7.4',
  'Ideal Weight 75.0',
].join('\n'));
eq(withTargets.weight, 82.4, 'a target, a control and an ideal weight are not what the member weighs');

/* ── 6. figures that are not measurements of a person ─────────────────────── */

// Held to the band of the RESOLVED unit rather than to the union of both, which
// is what let a pound figure through a metric sheet in the first place.
const absurd = parseInBodySheet(['Weight (kg) 500', 'PBF (%) 18.2'].join('\n'));
eq(absurd.weight, null, 'a 500 kg "weight" is not a person and is dropped');
eq(absurd.bodyFatPct, 18.2, 'and dropping it does not take the rest of the sheet with it');
const okInLb = parseInBodySheet(['Weight (lbs) 260', 'PBF (%) 18.2'].join('\n'));
eq(okInLb.weight, 260, 'while 260 IS a person in pounds, and is kept');

/* ── 7. nothing readable ──────────────────────────────────────────────────── */

const nothing = parseInBodySheet('a photograph of the ceiling');
eq(nothing.ok, false, 'an unreadable sheet says so');
eq(nothing.weight, null, 'and hands back nothing rather than a zero');
eq(sheetMassKg(null, 'lb'), null, 'null in, null out');
eq(sheetMassKg(undefined, null), null, 'and so for an absent figure');

// "lb" inside a word — a member's name in a header, an ID — does not decide the
// unit of their scan.
eq(sheetUnit('Albert Halbrook\nWeight 82.4', 'Weight 82.4'), null, 'lb inside a word is not a unit');

if (errors.length) {
  console.error(`inbodySheet.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('inbodySheet.test.ts — ok');
