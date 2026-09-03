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
import { mealAllergens, allergenLabel, type Allergen } from './meals';

/**
 * The exclusions a dish's NAME says it contains.
 *
 * Ingredients are passed through when there are any — a search result from a
 * label carries them — and an empty list is the ordinary case, where the name
 * is all there is. `mealAllergens` is the same reader the planner uses, so a
 * word that counts as dairy in a plan counts as dairy here.
 */
export function dishAllergens(
  name: string,
  avoid: Allergen[] = [],
  ingredients: string[] = [],
): Allergen[] {
  if (!avoid.length) return [];
  const n = (name ?? '').trim();
  if (!n) return [];
  return mealAllergens(
    { n, ing: ingredients.map((i) => [i, 1, 'g', 'Pantry & Other'] as [string, number, string, 'Pantry & Other']) },
    avoid,
  );
}

/** The mark on the row, or null when the name says nothing. Sentence-cased for
 *  a caption under a dish name. */
export function dishAllergenMark(found: Allergen[]): string | null {
  if (!found.length) return null;
  return `Named as containing ${found.map(allergenLabel).join(' and ')}`;
}

/**
 * The sentence that must accompany the marks.
 *
 * "Named as containing" and "we have checked this dish" are different claims,
 * and only the first is one this app can make. A screen that shows the marks
 * without this reads the other way round to the person who most needs it.
 */
export const DISH_MARK_CAVEAT =
  'These marks are read off the dish name only. An unmarked dish has not been checked — this app does not know what is in a restaurant kitchen, so ask them if it matters.';

/** The same caveat for a food search, where the rows come from labels and from
 *  other members' own entries rather than from a menu. */
export const SEARCH_MARK_CAVEAT =
  'Marks are read off the name of the food. An unmarked result has not been checked against your exclusions.';
