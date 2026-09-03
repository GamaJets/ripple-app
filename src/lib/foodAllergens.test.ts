// The exclusions, on the food surfaces the planner does not own.
// Compile with tsc, run with node.
//
// Two things must hold and the second is the one an allergic member depends on:
// a dish whose name says shellfish is marked, and NOTHING here ever claims a
// dish is clear. This app has not seen the kitchen.
import { dishAllergens, dishAllergenMark, DISH_MARK_CAVEAT, SEARCH_MARK_CAVEAT } from './foodAllergens';
import type { Allergen } from './meals';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL: Allergen[] = ['dairy', 'gluten', 'nuts', 'shellfish', 'egg', 'soy'];

/* ── the dish name is read ─────────────────────────────────────────────── */

ok(dishAllergens('Prawn pad thai', ALL).includes('shellfish'),
  'the dish this whole item is about is marked');
ok(dishAllergens('Creamy mushroom pasta', ALL).includes('dairy'), 'cream in a name is dairy');
ok(dishAllergens('Creamy mushroom pasta', ALL).includes('gluten'), 'and pasta is gluten');
ok(dishAllergens('Chicken satay', ALL, ['Peanut sauce']).includes('nuts'),
  'ingredients are read when a row carries them');

eq(dishAllergens('Prawn pad thai', ['dairy']).length, 0,
  'and only what the member actually excluded is reported');
eq(dishAllergens('Prawn pad thai', []).length, 0, 'nobody excluding anything gets no marks');
eq(dishAllergens('', ALL).length, 0, 'an empty name is not a dish');
eq(dishAllergens('   ', ALL).length, 0, 'and neither is whitespace');

/* ── the caveat, which is the point ────────────────────────────────────── */

eq(dishAllergenMark([]), null, 'a dish the name says nothing about carries no mark');
ok(dishAllergenMark(['shellfish'])!.startsWith('Named as containing'),
  'the mark says it is a reading of the NAME, not a fact about the kitchen');
ok(!/safe|free from|contains no/i.test(dishAllergenMark(['shellfish'])!),
  'and never speaks about what a dish does not contain');

for (const c of [DISH_MARK_CAVEAT, SEARCH_MARK_CAVEAT]) {
  ok(/unmarked/.test(c), 'the caveat is explicitly about the rows with no mark on them');
  ok(/not been checked/.test(c), 'and says they have not been checked');
  ok(!/safe|allergen-free|free from/i.test(c), 'nothing here ever clears a dish');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('foodAllergens.test.ts — all assertions passed');
