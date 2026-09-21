// A shopping-list line is what goes in the basket, with the exact need beside
// it. Compile with tsc, run with node.
import { CUPBOARD_HEAD, isCupboard, needText, packFor, roundNeed } from './groceryPacks';
import { buildPlan, groceryFromWeek, planWeek, type PlanInput } from './meals';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a pack rounds UP, and the need stays visible ──────────────────────── */

// The line a tester read: "Jasmine rice (dry) 810g". Nobody buys 810 g.
eq(packFor('Jasmine rice (dry)', 810, 'g'), '1 kg bag', '810 g of rice is a 1 kg bag');
eq(packFor('Jasmine rice (dry)', 1000, 'g'), '1 kg bag', 'exactly a bag is one bag');
eq(packFor('Jasmine rice (dry)', 1010, 'g'), '2 × 1 kg bags', 'and a gram over is two: a list never leaves you short');
eq(packFor('Garlic', 3, 'clove'), '1 bulb', '"Garlic 3 clove" is a bulb of garlic');
eq(packFor('Eggs', 13, ''), '3 boxes of 6', 'thirteen eggs are three boxes');
eq(packFor('Wholegrain bread', 4, 'slice'), '1 loaf', 'four slices are a loaf');
// A tin is packed by what it yields, drained, not by the weight on the label.
eq(packFor('Chickpeas', 400, 'g'), '2 × 400 g tins', '400 g of drained chickpeas is two tins, not one');
eq(needText(810, 'g'), '810 g', 'and the exact need is kept beside it');
eq(needText(1260, 'g'), '1.26 kg', 'a big need reads in kilograms');
eq(needText(3, 'clove'), '3 cloves', 'and counts are plural where they are');
eq(needText(1, 'clove'), '1 clove', 'and singular where they are not');
eq(roundNeed(806.4, 'g'), 810, 'the need is rounded only as far as anybody weighs');
eq(roundNeed(2.2, ''), 3, 'and a count is rounded up, as it always was');

/* ── no invented packs ─────────────────────────────────────────────────── */

eq(packFor('Mango', 1260, 'g'), null, 'loose produce has no pack: the weight is the line');
eq(packFor('Chicken breast', 1300, 'g'), null, 'nor does meat sold by weight');
eq(packFor('Jasmine rice (dry)', 3, 'cup'), null, 'a pack in another unit is not guessed at');
eq(packFor('Jasmine rice (dry)', 0, 'g'), null, 'and nothing needed is nothing to buy');

/* ── the store cupboard ────────────────────────────────────────────────── */

ok(['Harissa', 'Pesto', 'Salsa', 'Cajun spice'].every(isCupboard), 'flavourings are a cupboard check');
ok(!isCupboard('Jasmine rice (dry)'), 'a staple is not');
eq(CUPBOARD_HEAD, 'Store Cupboard', 'under their own heading');

/* ── through the real list ─────────────────────────────────────────────── */

const c: PlanInput = { id: 'c1', weightKg: 82, bodyFatPct: 20, activity: 1.45, goal: 'tone', diet: 'meat', mealsPerDay: 4 };
const list = groceryFromWeek(planWeek(c));
const rows = Object.values(list.byDept).flat();
ok(rows.every((r) => r!.buy === null || /^\d[^]* (bag|box|boxes|loaf|loaves|tin|carton|bottle|tub|block|jar|bar|punnet|pack|bulb)s?( of 6)?$/.test(r!.buy)), 'every pack reads as a thing to pick up');
ok(rows.some((r) => r!.buy !== null) && rows.some((r) => r!.buy === null), 'a real week has both packed and loose lines');
ok(rows.every((r) => !isCupboard(r!.item)), 'no flavouring is listed among the departments');
ok(list.cupboard.length > 0 && list.cupboard.every((r) => isCupboard(r.item)), 'they are all on the cupboard list instead');
ok([...rows, ...list.cupboard].every((r) => r!.qty > 0), 'and every line keeps a real need');
eq(rows.filter((r) => /^eggs?$/i.test(r!.item)).length <= 1, true, 'eggs are one line, not "Egg" under "Eggs"');

// An empty slot buys nothing: not a line, and not a zero.
const soy: PlanInput = { id: 'v1', weightKg: 64, bodyFatPct: 26, activity: 1.5, goal: 'fatloss', diet: 'vegan', mealsPerDay: 4, avoid: ['soy'] };
// No real plan has one since the soy-free breakfasts (21 Sep 2026), so the
// empty slot is made here, shaped exactly as mealAt serves one.
const emptied = planWeek(soy).map((day) => day.map((m, i) => (i === 0
  ? { ...m, n: 'No breakfast we can make without soy', ing: [], steps: [], k: 0, p: 0, c: 0, f: 0, K: 0, P: 0, C: 0, F: 0, servings: 0, unfillable: ['soy' as const] }
  : m)));
ok(emptied.every((d) => d[0].unfillable), 'the fixture has an empty slot');
const soyList = groceryFromWeek(emptied);
const soyRows = [...Object.values(soyList.byDept).flat(), ...soyList.cupboard];
ok(soyRows.every((r) => r!.qty > 0 && !/^no /i.test(r!.item)), 'an empty slot contributes no line and no zero');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('groceryPacks.test.ts ok');
