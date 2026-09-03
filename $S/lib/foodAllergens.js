"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISH_MARK_UNKNOWN = exports.DISH_MARK_LOADING = exports.SEARCH_MARK_CAVEAT = exports.DISH_MARK_CAVEAT = void 0;
exports.dishAllergens = dishAllergens;
exports.dishAllergenMark = dishAllergenMark;
exports.dishMarkNotice = dishMarkNotice;
// The exclusions a member set, on the food surfaces that are not the planner.
//
// ── What the setting was doing ────────────────────────────────────────────
//
// `clients.avoid` is offered as an app-wide exclusion — six pills on the
// profile — and it was honoured on exactly one of the four surfaces that put
// food in front of somebody. The meal planner filters its pools and flags what
// it could not keep out (src/lib/meals.ts). Eating Out, the Food Log's search
// and the log sheet each render a list of dishes with a plus button beside
// them and never mention it. A member who told the app "no shellfish" on Monday
// was offered "Prawn pad thai" on Tuesday, unmarked, on the screen they open
// four times a day.
//
// ── What can honestly be said about a dish this app did not compose ───────
//
// A planned meal is BUILT from components this app knows the ingredients of, so
// "contains dairy" there is a fact about the recipe. A restaurant dish and a
// search result are a NAME. The same matcher reads that name — it is the one
// that already catches "Prawn pad thai" and "Creamy mushroom pasta" — but what
// it produces is a reading of the words, not knowledge of the kitchen.
//
// So this module produces two things and the second is not optional:
//
//   · `dishAllergens`, the exclusions the NAME says are in it; and
//   · `DISH_MARK_CAVEAT`, the sentence saying an unmarked dish has not been
//     checked, which must be on any screen that shows the marks.
//
// Without the caveat the marks are worse than nothing: an allergic member reads
// an unmarked row as cleared, and this app has no basis for clearing anything.
const meals_1 = require("./meals");
// The marks are only worth anything if the exclusions behind them were read —
// see `dishMarkNotice` at the foot of this file.
const loadStatus_1 = require("../ui/loadStatus");
/**
 * The exclusions a dish's NAME says it contains.
 *
 * Ingredients are passed through when there are any — a search result from a
 * label carries them — and an empty list is the ordinary case, where the name
 * is all there is. `mealAllergens` is the same reader the planner uses, so a
 * word that counts as dairy in a plan counts as dairy here.
 */
function dishAllergens(name, avoid = [], ingredients = []) {
    if (!avoid.length)
        return [];
    const n = (name ?? '').trim();
    if (!n)
        return [];
    return (0, meals_1.mealAllergens)({ n, ing: ingredients.map((i) => [i, 1, 'g', 'Pantry & Other']) }, avoid);
}
/** The mark on the row, or null when the name says nothing. Sentence-cased for
 *  a caption under a dish name. */
function dishAllergenMark(found) {
    if (!found.length)
        return null;
    return `Named as containing ${found.map(meals_1.allergenLabel).join(' and ')}`;
}
/**
 * The sentence that must accompany the marks.
 *
 * "Named as containing" and "we have checked this dish" are different claims,
 * and only the first is one this app can make. A screen that shows the marks
 * without this reads the other way round to the person who most needs it.
 */
exports.DISH_MARK_CAVEAT = 'These marks are read off the dish name only. An unmarked dish has not been checked — this app does not know what is in a restaurant kitchen, so ask them if it matters.';
/** The same caveat for a food search, where the rows come from labels and from
 *  other members' own entries rather than from a menu. */
exports.SEARCH_MARK_CAVEAT = 'Marks are read off the name of the food. An unmarked result has not been checked against your exclusions.';
/** The read is in flight. Not "no exclusions" and not "we could not find out". */
exports.DISH_MARK_LOADING = 'Reading your exclusions — nothing below is marked against them yet.';
/** The read failed. The strongest of the four, because this is the one that
 *  used to be drawn as a clear list. */
exports.DISH_MARK_UNKNOWN = 'Your exclusions could not be read, so nothing below is marked against them. An unmarked dish here has not been checked against anything — pull down to try again, and ask the kitchen if it matters.';
function dishMarkNotice(status, avoidCount) {
    if (status === 'loading')
        return { state: 'checking', text: exports.DISH_MARK_LOADING, marked: false };
    if (!(0, loadStatus_1.isWhole)(status))
        return { state: 'unknown', text: exports.DISH_MARK_UNKNOWN, marked: false };
    if (avoidCount > 0)
        return { state: 'marks', text: exports.DISH_MARK_CAVEAT, marked: true };
    return { state: 'none', text: null, marked: true };
}
