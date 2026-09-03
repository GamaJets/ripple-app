"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The exclusions, on the food surfaces the planner does not own.
// Compile with tsc, run with node.
//
// Two things must hold and the second is the one an allergic member depends on:
// a dish whose name says shellfish is marked, and NOTHING here ever claims a
// dish is clear. This app has not seen the kitchen.
const foodAllergens_1 = require("./foodAllergens");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ALL = ['dairy', 'gluten', 'nuts', 'shellfish', 'egg', 'soy'];
/* ── the dish name is read ─────────────────────────────────────────────── */
ok((0, foodAllergens_1.dishAllergens)('Prawn pad thai', ALL).includes('shellfish'), 'the dish this whole item is about is marked');
ok((0, foodAllergens_1.dishAllergens)('Creamy mushroom pasta', ALL).includes('dairy'), 'cream in a name is dairy');
ok((0, foodAllergens_1.dishAllergens)('Creamy mushroom pasta', ALL).includes('gluten'), 'and pasta is gluten');
ok((0, foodAllergens_1.dishAllergens)('Chicken satay', ALL, ['Peanut sauce']).includes('nuts'), 'ingredients are read when a row carries them');
eq((0, foodAllergens_1.dishAllergens)('Prawn pad thai', ['dairy']).length, 0, 'and only what the member actually excluded is reported');
eq((0, foodAllergens_1.dishAllergens)('Prawn pad thai', []).length, 0, 'nobody excluding anything gets no marks');
eq((0, foodAllergens_1.dishAllergens)('', ALL).length, 0, 'an empty name is not a dish');
eq((0, foodAllergens_1.dishAllergens)('   ', ALL).length, 0, 'and neither is whitespace');
/* ── the caveat, which is the point ────────────────────────────────────── */
eq((0, foodAllergens_1.dishAllergenMark)([]), null, 'a dish the name says nothing about carries no mark');
ok((0, foodAllergens_1.dishAllergenMark)(['shellfish']).startsWith('Named as containing'), 'the mark says it is a reading of the NAME, not a fact about the kitchen');
ok(!/safe|free from|contains no/i.test((0, foodAllergens_1.dishAllergenMark)(['shellfish'])), 'and never speaks about what a dish does not contain');
for (const c of [foodAllergens_1.DISH_MARK_CAVEAT, foodAllergens_1.SEARCH_MARK_CAVEAT]) {
    ok(/unmarked/.test(c), 'the caveat is explicitly about the rows with no mark on them');
    ok(/not been checked/.test(c), 'and says they have not been checked');
    ok(!/safe|allergen-free|free from/i.test(c), 'nothing here ever clears a dish');
}
/* ── and whether the exclusions were read at all ─────────────────────────── */
// The marks and the caveat used to vanish together the moment the profile read
// was slow, and their joint absence is the same picture as a checked, clear
// list. Four reads, four sentences.
{
    const loading = (0, foodAllergens_1.dishMarkNotice)('loading', 0);
    eq(loading.state, 'checking', 'a read in flight is not an empty exclusion list');
    eq(loading.marked, false, 'and nothing below it is marked against anything yet');
    eq(loading.text, foodAllergens_1.DISH_MARK_LOADING, 'and it says so in its own sentence');
    for (const s of ['error', 'partial']) {
        const bad = (0, foodAllergens_1.dishMarkNotice)(s, 0);
        eq(bad.state, 'unknown', `A FAILED OR TRUNCATED READ IS NEVER DRAWN AS AN EMPTY ONE (${s})`);
        eq(bad.marked, false, `and an unmarked dish under it has been checked against nothing (${s})`);
        eq(bad.text, foodAllergens_1.DISH_MARK_UNKNOWN, `and the screen says which of the four it is (${s})`);
        // The worst version of this defect: the member DOES have exclusions and the
        // read failed. Nothing may imply they were applied.
        eq((0, foodAllergens_1.dishMarkNotice)(s, 3).marked, false, `three exclusions that could not be read are three exclusions not applied (${s})`);
        eq((0, foodAllergens_1.dishMarkNotice)(s, 3).text, foodAllergens_1.DISH_MARK_UNKNOWN, `and the sentence does not change with them (${s})`);
    }
    const marks = (0, foodAllergens_1.dishMarkNotice)('ready', 1);
    eq(marks.state, 'marks', 'a landed read with an exclusion in it marks the rows');
    eq(marks.marked, true, 'and the marks mean something');
    eq(marks.text, foodAllergens_1.DISH_MARK_CAVEAT, 'under the standing caveat that they are read off the name');
    const none = (0, foodAllergens_1.dishMarkNotice)('ready', 0);
    eq(none.state, 'none', 'a landed read with nothing in it says nothing');
    eq(none.text, null, 'and there is no caveat over a list with nothing to mark against');
    eq(none.marked, true, 'and the absence of marks is a true absence');
    // Three sentences, and no two of them the same.
    const said = [foodAllergens_1.DISH_MARK_LOADING, foodAllergens_1.DISH_MARK_UNKNOWN, foodAllergens_1.DISH_MARK_CAVEAT];
    eq(new Set(said).size, 3, 'loading, failed and empty are three different sentences');
    ok(/could not be read/.test(foodAllergens_1.DISH_MARK_UNKNOWN), 'the failure says the read failed');
    ok(/not been checked/.test(foodAllergens_1.DISH_MARK_UNKNOWN), 'and that an unmarked dish means nothing');
    for (const c of said) {
        ok(!/safe|allergen-free|free from|no shellfish/i.test(c), 'and none of them clears a dish');
    }
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('foodAllergens.test.ts — all assertions passed');
