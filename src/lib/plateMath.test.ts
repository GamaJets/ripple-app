// Tests for plateMath — the barbell fill, in the unit the gym stocks.
//
// The defect these exist for: app/(client)/tools.tsx hardcoded a kilogram rack
// and a 20 kg bar, so a client who reads in pounds typed 225 and was told to
// load 25 + 20 + 15 + 2.5 kg a side onto a 20 kg bar. Not a mislabel — a
// different bar, different plates, and a total of 495 lb.
//
// So the assertions are about HARDWARE, not about arithmetic. The one that
// matters most is that a pound answer is made of plates a pound gym owns:
// converting the metric answer would pass any test that only checked the total,
// because 11.34 kg really is 25 lb. It is the instruction to go and pick up an
// 11.34 kg plate that is wrong, and only a check on the denominations catches
// it.
//
// Compile with tsc then run with node, like units.test.ts.
import { loadBar, BARS, PLATES } from './plateMath';
import { kgToLb, type WeightUnit } from './units';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const UNITS: WeightUnit[] = ['kg', 'lb'];

// ── the hardware itself ───────────────────────────────────────────────────
//
// Spelled out rather than derived, because a derivation from the metric set is
// exactly the bug: every one of these numbers is a plate somebody can pick up.
eqJson([...PLATES.kg], [25, 20, 15, 10, 5, 2.5, 1.25], 'the metric rack is the IWF/IPF competition set');
eqJson([...PLATES.lb], [45, 35, 25, 10, 5, 2.5, 1.25], 'the imperial rack is the American commercial set');
eqJson([...BARS.kg], [20, 15], "the metric bars are the men's and women's Olympic bars");
eqJson([...BARS.lb], [45, 35], 'the imperial bars are the American 45 and 35 lb bars');

// No number in the imperial hardware may be a converted metric one. 20 kg is
// 44.09 lb and 25 kg is 55.12 lb; both are plausible-looking figures that would
// print an instruction nobody can follow.
for (const unit of UNITS) {
  for (const p of PLATES[unit]) {
    ok(p > 0, `${p} ${unit} is not a plate`);
    ok(Number.isInteger(p * 4), `${p} ${unit} is not a denomination anyone sells — a converted figure`);
  }
}
for (const kgPlate of PLATES.kg) {
  const converted = Math.round(kgToLb(kgPlate) * 100) / 100;
  ok(!PLATES.lb.includes(converted), `${converted} lb is ${kgPlate} kg converted, not a plate on a rack`);
}
ok(!(BARS.lb as readonly number[]).includes(Math.round(kgToLb(20) * 100) / 100),
  'the 45 lb bar is its own bar, not the 20 kg bar converted to 44.09 lb');
for (const unit of UNITS) {
  for (let i = 1; i < PLATES[unit].length; i++) {
    ok(PLATES[unit][i] < PLATES[unit][i - 1], `${unit} plates must run heaviest first for the greedy fill`);
  }
}

// ── the loads people actually put on a bar ────────────────────────────────
//
// Each of these is a number a lifter says out loud. The pound ones are the
// point: 225 is two 45s a side on a 45 lb bar, and nothing else.
{
  const l = loadBar(225, 45, 'lb')!;
  ok(l != null, '225 lb on a 45 lb bar must load');
  eqJson(l.plates, [45, 45], '225 lb is two 45s a side');
  eq(l.perSide, 90, '…which is 90 lb a side');
  eq(l.total, 225, '…and 225 lb on the bar');
  eq(l.exact, true, '225 lb loads exactly');
}
eqJson(loadBar(135, 45, 'lb')!.plates, [45], '135 lb is one 45 a side');
eqJson(loadBar(315, 45, 'lb')!.plates, [45, 45, 45], '315 lb is three 45s a side');
eqJson(loadBar(185, 45, 'lb')!.plates, [45, 25], '185 lb is a 45 and a 25 a side');
eqJson(loadBar(95, 45, 'lb')!.plates, [25], '95 lb is a 25 a side');
eqJson(loadBar(155, 45, 'lb')!.plates, [45, 10], '155 lb is a 45 and a 10 a side');
eqJson(loadBar(65, 35, 'lb')!.plates, [10, 5], '65 lb on the 35 lb bar is a 10 and a 5 a side');

eqJson(loadBar(100, 20, 'kg')!.plates, [25, 15], '100 kg is a 25 and a 15 a side');
eqJson(loadBar(60, 20, 'kg')!.plates, [20], '60 kg is a 20 a side');
eqJson(loadBar(140, 20, 'kg')!.plates, [25, 25, 10], '140 kg is two 25s and a 10 a side');
eqJson(loadBar(60, 15, 'kg')!.plates, [20, 2.5], '60 kg on the 15 kg bar is a 20 and a 2.5 a side');

// The fractional plate, on both racks. A load that lands on a 1.25 pair must be
// reported as landing: the screen prints a "closest loadable" warning whenever
// `exact` is false, and a warning about the number the client asked for and got
// teaches them to distrust the ones that are real.
{
  const l = loadBar(102.5, 20, 'kg')!;
  eqJson(l.plates, [25, 15, 1.25], '102.5 kg is 25 + 15 + 1.25 a side');
  eq(l.exact, true, '102.5 kg loads EXACTLY — not "closest loadable"');
  eq(l.total, 102.5, 'and the total comes back as the number typed');
}
{
  const l = loadBar(47.5, 45, 'lb')!;
  eqJson(l.plates, [1.25], '47.5 lb is a single fractional plate a side');
  eq(l.exact, true, '47.5 lb — an ordinary gym number — loads exactly');
}

// ── nothing is invented ───────────────────────────────────────────────────
eq(loadBar(null, 20, 'kg'), null, 'no target is no answer');
eq(loadBar(undefined, 20, 'kg'), null, 'an absent target is no answer');
eq(loadBar(NaN, 20, 'kg'), null, 'text that did not parse is no answer');
// A target under the bar has no answer, and must not come back as an empty bar
// dressed up as the load that was asked for.
eq(loadBar(15, 20, 'kg'), null, '15 kg on a 20 kg bar cannot be loaded');
eq(loadBar(40, 45, 'lb'), null, '40 lb on a 45 lb bar cannot be loaded');
{
  const bare = loadBar(20, 20, 'kg')!;
  eqJson(bare.plates, [], 'the bar alone carries no plates');
  eq(bare.exact, true, 'and it is exactly what was asked for');
}
eq(loadBar(1e9, 20, 'kg'), null, 'an absurd target is refused rather than filled one plate at a time');
eq(loadBar(100, 0, 'kg'), null, 'there is no bar weighing nothing');

// ── the sweep: every load either lands or is honestly short ───────────────
//
// The properties, over the whole range of both racks:
//   · the answer is built only from plates that rack HAS;
//   · the plates add up to what is claimed for one side, and both sides plus
//     the bar add up to the total;
//   · the total NEVER exceeds the target — a bar loaded heavier than asked is a
//     rep the client did not agree to;
//   · `exact` is the truth about that total, not a guess.
for (const unit of UNITS) {
  const set = new Set(PLATES[unit]);
  for (const bar of BARS[unit]) {
    for (let q = 0; q <= 1600; q++) {
      const target = Math.round((bar + q * 0.25) * 100) / 100;
      const l = loadBar(target, bar, unit);
      ok(l != null, `${target} ${unit} on a ${bar} ${unit} bar must have an answer`);
      if (!l) continue;
      for (const p of l.plates) ok(set.has(p), `${target} ${unit} used a ${p} ${unit} plate, which is not on the ${unit} rack`);
      const sum = Math.round(l.plates.reduce((a, p) => a + p, 0) * 100) / 100;
      ok(sum === l.perSide, `${target} ${unit}: the plates a side sum to ${sum}, not the ${l.perSide} claimed`);
      ok(Math.round((bar + l.perSide * 2) * 100) / 100 === l.total,
        `${target} ${unit}: bar + both sides is not the ${l.total} claimed`);
      ok(l.total <= target + 1e-9, `${target} ${unit} was loaded to ${l.total} — heavier than asked for`);
      ok(l.exact === (l.total === target), `${target} ${unit}: exact said ${l.exact} for a total of ${l.total}`);
    }
  }
}

// Every load the rack CAN build must be built, on both racks. A target that is
// the bar plus a whole number of smallest-plate pairs is loadable by
// construction, and a fill that came up short on one of those has either lost a
// denomination or is filling from the wrong rack.
for (const unit of UNITS) {
  const smallest = PLATES[unit][PLATES[unit].length - 1];
  for (const bar of BARS[unit]) {
    for (let pairs = 0; pairs <= 400; pairs++) {
      const target = Math.round((bar + pairs * smallest * 2) * 100) / 100;
      const l = loadBar(target, bar, unit);
      ok(l != null && l.exact,
        `${target} ${unit} is ${pairs} pairs of ${smallest} ${unit} on a ${bar} ${unit} bar and must load exactly`);
    }
  }
}

// ── the two racks must not agree ──────────────────────────────────────────
//
// The whole defect in one assertion: the same number read as kilograms and as
// pounds is two different bars. If these ever match, the unit is being ignored
// again.
{
  const asKg = loadBar(100, 20, 'kg')!;
  const asLb = loadBar(100, 45, 'lb')!;
  ok(JSON.stringify(asKg.plates) !== JSON.stringify(asLb.plates),
    'a target of 100 must not produce the same plates in both units');
}

if (errors.length) {
  console.error(`plateMath.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('plateMath.test.ts — ok');
