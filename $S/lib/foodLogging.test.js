"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// How much of it you ate, what you eat every morning, and the allergen the
// planner quietly gave up on.
// Compile with tsc, run with node.
//
//   THE PORTION     nobody was asked, so half a packet was logged as one
//   THE GAP         a macro nobody measured is blank, and blocks the log
//   THE MEMORY      recents come from the log; favourites are chosen
//   THE ALLERGEN    an exclusion that cannot be honoured is SAID
const foodPortion_1 = require("./foodPortion");
const foodMemory_1 = require("./foodMemory");
const meals_1 = require("./meals");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const YOGURT = { name: 'Greek Yogurt', kcal: 133, protein: 10, carbs: 6, fat: 7, basis: '100 g' };
/* ── THE PORTION ──────────────────────────────────────────────────────────
 *
 * A search row logged straight through and the barcode sheet logged whatever
 * basis Open Food Facts returned, so a member who ate a whole 500 g pot
 * recorded 100 g of it — and the day's remaining calories, which is the one
 * figure this tab exists to show, were wrong by the amount nobody asked about.
 */
{
    const whole = (0, foodPortion_1.scaleFood)(YOGURT, 5);
    eq(whole.kcal, 665, 'five times the basis is five times the figures');
    eq(whole.protein, 50, 'macros scale with it');
    ok(whole.name.includes('5 × 100 g'), 'and the multiple goes in the name, because a row shows a name and a number and nothing else');
    const half = (0, foodPortion_1.scaleFood)(YOGURT, 0.5);
    eq(half.kcal, 67, 'half of 133 rounds once, at the end — 67, not 66 off a rounded 66.5');
    eq((0, foodPortion_1.scaleFood)(YOGURT, 1).name, 'Greek Yogurt', 'one portion is left alone: "1 ×" in front of every food is noise on the ordinary case');
    eq((0, foodPortion_1.portionName)('Snack', 2, null), 'Snack — 2 portions', 'with no basis the multiple is still said, in portions');
    eq((0, foodPortion_1.basisLabel)('100 g'), 'per 100 g', 'the control says what one portion IS where the source said');
    eq((0, foodPortion_1.basisLabel)(null), null, 'and claims nothing where it did not');
    eq((0, foodPortion_1.basisLabel)('  '), null, 'including when the source handed back a blank');
    ok((0, foodPortion_1.readQuantity)('1.5').ok, 'a decimal portion is a real thing to have eaten');
    const comma = (0, foodPortion_1.readQuantity)('1,5');
    ok(comma.ok && comma.qty === 1.5, 'and a comma is the decimal key on most European keyboards — parseFloat would read 1 and lose a third of the meal');
    ok(!(0, foodPortion_1.readQuantity)('').ok, 'an empty box is refused rather than logged as one portion');
    ok(!(0, foodPortion_1.readQuantity)('0').ok, 'a portion of nothing is not a portion');
    ok(!(0, foodPortion_1.readQuantity)('abc').ok, 'and neither is a word');
    const fumbled = (0, foodPortion_1.readQuantity)(String(foodPortion_1.MAX_QUANTITY + 5));
    ok(!fumbled.ok && /decimal/.test(fumbled.reason), 'a fumbled decimal is refused with the reason, rather than logging fifteen servings');
    ok(foodPortion_1.QUANTITIES.includes(1), 'one portion is on the ladder of taps');
}
/* ── THE GAP ──────────────────────────────────────────────────────────────
 *
 * `foodAI.parseFoodText` and `vision.analyzeMeal` coerced an absent macro to 0,
 * so a model that returned calories and nothing else recorded a zero-protein
 * meal that then fed the day's remaining-macro figures.
 */
{
    const read = { name: 'Chicken salad', kcal: 420, protein: null, carbs: 12, fat: null, basis: null };
    eq((0, foodPortion_1.scaleFood)(read, 1), null, 'a food with a macro nobody measured cannot be logged at all');
    eq((0, foodPortion_1.missingMacros)(read).length, 2, 'and the missing ones are named');
    ok((0, foodPortion_1.missingMacros)(read).includes('protein') && (0, foodPortion_1.missingMacros)(read).includes('fat'), 'by name, both of them');
    const note = (0, foodPortion_1.missingMacroNote)(read);
    ok(/protein and fat/.test(note), 'the sentence names them rather than saying "some macros"');
    ok(/nought/.test(note) || /zero/.test(note), 'and says what the app refused to do, which is invent a zero');
    eq((0, foodPortion_1.missingMacroNote)(YOGURT), null, 'a whole food has no such sentence');
    const filled = { ...read, protein: 35, fat: 22 };
    ok((0, foodPortion_1.scaleFood)(filled, 1) != null, 'once a person has typed the figures, it logs');
    eq((0, foodPortion_1.scaleFood)(filled, 0), null, 'a portion of nothing still logs nothing');
}
/* ── THE MEMORY ───────────────────────────────────────────────────────────── */
{
    const log = [
        { name: 'Greek Yogurt', kcal: 130, protein: 12, carbs: 6, fat: 5, at: '2026-08-30T08:00:00.000Z' },
        { name: 'greek yogurt', kcal: 133, protein: 12, carbs: 6, fat: 6, at: '2026-08-31T08:00:00.000Z' },
        { name: 'Chicken Breast', kcal: 280, protein: 52, carbs: 0, fat: 6, at: '2026-08-31T13:00:00.000Z' },
        { name: 'Flat White', kcal: 120, protein: 7, carbs: 10, fat: 6, at: '2026-08-29T09:00:00.000Z' },
    ];
    const recent = (0, foodMemory_1.recentFoods)(log, 8);
    eq(recent.length, 3, 'two spellings of one food are one food');
    eq(recent[0].name, 'Chicken Breast', 'newest first, because "the same again" is what this list is for');
    const yog = recent.find((f) => f.key === (0, foodMemory_1.foodKey)('Greek Yogurt'));
    eq(yog.count, 2, 'the count is how many times it was logged');
    eq(yog.kcal, 133, 'and the NEWEST logging wins the figures — a correction is not argued with');
    eq(yog.name, 'greek yogurt', 'along with the spelling it was last logged under');
    const often = (0, foodMemory_1.frequentFoods)(log, 8);
    eq(often.length, 1, 'a food logged once is not "frequent" — it is already in recents, and two lists of the same thing is one list twice');
    eq(often[0].count, 2, 'the one logged twice is');
    // The pinned list.
    ok((0, foodMemory_1.favouritesKey)('u1') !== (0, foodMemory_1.favouritesKey)('u2'), 'per account, so a shared gym phone cannot show one member another member\'s food');
    const pinned = (0, foodMemory_1.toggleFavourite)([], yog);
    eq(pinned.length, 1, 'pinning adds it');
    ok((0, foodMemory_1.isFavourite)(pinned, 'GREEK YOGURT'), 'and the match is by food, not by spelling');
    eq((0, foodMemory_1.toggleFavourite)(pinned, yog).length, 0, 'pinning again unpins it, because it is one control');
    const back = (0, foodMemory_1.readFavourites)((0, foodMemory_1.writeFavourites)(pinned));
    ok(back.read, 'what was written can be read');
    eq(back.foods[0].kcal, 133, 'with the figures it was pinned with, because a favourite is a copy and not a pointer');
    ok(!(0, foodMemory_1.readFavourites)('{oops').read, 'bytes nobody can parse are not an empty list');
    ok((0, foodMemory_1.readFavourites)(null).read, 'and nothing pinned yet IS a real answer');
    eq((0, foodMemory_1.readFavourites)(null).foods.length, 0, 'of nothing');
    const junk = (0, foodMemory_1.readFavourites)(JSON.stringify([{ name: 'Half a food' }, { name: 'Real', kcal: 1, protein: 1, carbs: 1, fat: 1 }]));
    eq(junk.foods.length, 1, 'a row missing its figures is dropped and the good one beside it is kept');
    let many = [];
    for (let i = 0; i < foodMemory_1.MAX_FAVOURITES + 5; i++)
        many = (0, foodMemory_1.toggleFavourite)(many, { ...yog, key: `k${i}`, name: `Food ${i}` });
    eq(many.length, foodMemory_1.MAX_FAVOURITES, 'the list is capped, because its value is being short enough to read');
}
/* ── THE ALLERGEN ─────────────────────────────────────────────────────────
 *
 * `poolFilter` returned the UNFILTERED pool whenever an exclusion emptied a
 * required component list, and nothing on screen said so — on the one screen
 * where a quiet failure is least acceptable.
 */
{
    // Soy on a vegan breakfast is the live one: every component of a required
    // pool for that diet carries soy, so the exclusion cannot be honoured and the
    // member has to be told rather than quietly served it.
    const soyGaps = (0, meals_1.poolGaps)('vegan', 'Breakfast', ['soy']);
    ok(soyGaps.length > 0, 'an exclusion that empties a required pool is reported');
    const note = (0, meals_1.allergenGapNote)(soyGaps);
    ok(/still contains soy/.test(note), 'and the sentence says the plan CONTAINS it, in as many words');
    ok(/marked/.test(note), 'and points at the per-dish marking, so somebody can act on it');
    eq((0, meals_1.allergenGapNote)([]), null, 'a filter that was honoured says nothing at all');
    eq((0, meals_1.poolGaps)('meat', 'Lunch', []).length, 0, 'excluding nothing cannot fail');
    eq((0, meals_1.poolGaps)('meat', 'Lunch', ['shellfish']).length, 0, 'and an exclusion the pools can absorb is not reported — there is plenty of meat that is not a prawn');
    eq((0, meals_1.poolGaps)('vegan', 'Lunch', ['soy']).length, 0, 'nor is the same exclusion in a slot that CAN honour it: the report is per slot, not per diet');
    const day = (0, meals_1.planGaps)('vegan', (0, meals_1.slotsFor)(3), ['soy']);
    ok(day.length > 0, 'the day-level check finds what any of its slots could not honour');
    // The per-meal half: which dish, not just which plan.
    let flagged = 0, clean = 0;
    for (let i = 0; i < 40; i++) {
        const m = (0, meals_1.mealAt)('vegan', 'Breakfast', i, ['soy']);
        if ((0, meals_1.mealAllergens)(m, ['soy']).length)
            flagged++;
        else
            clean++;
    }
    ok(flagged > 0, 'meals that contain the excluded allergen are marked one by one');
    ok(flagged + clean === 40, 'and every meal is looked at');
    eq((0, meals_1.mealAllergens)({ n: 'Grilled chicken with rice', ing: [['Chicken breast', 180, 'g', 'Meat & Seafood']] }, ['dairy']).length, 0, 'a dish without it is not marked');
    eq((0, meals_1.allergenLabel)('dairy'), 'dairy', 'and the label reads as prose mid-sentence');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('foodLogging.test.ts ok');
