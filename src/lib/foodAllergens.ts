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
// The marks are only worth anything if the exclusions behind them were read —
// see `dishMarkNotice` at the foot of this file.
import { isWhole, type LoadStatus } from '../ui/loadStatus';

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

/* ── whether the exclusions are known at all ─────────────────────────────── */

/**
 * What a screen showing the marks must say, given how the read of the member's
 * exclusions went.
 *
 * ── The defect this exists for ────────────────────────────────────────────
 *
 * `app/(client)/restaurant.tsx` read `cd.avoid` and never `cd.profileStatus`.
 * That list starts `[]` under a 'loading' status and stays `[]` when the read
 * fails, so "this member excludes nothing" and "we have not been told what this
 * member excludes" were the same value — and the screen drew them the same way.
 *
 * Both safeguards came off together. The caveat above the list is rendered on
 * `avoid.length`, so it vanished; and every row rendered with no mark on it.
 * A member who excluded shellfish, opening Eating Out on a fresh install or on
 * bad signal, saw prawn toast and sushi unmarked with no sentence above them —
 * a picture identical to an all-clear, on the one screen in this app where
 * being wrong is a medical event.
 *
 * The module header already states the rule: "an allergic member reads an
 * unmarked row as cleared, and this app has no basis for clearing anything."
 * An unread exclusion list is the case with the least basis of all.
 *
 * The four answers are four different sentences, and the middle two are the
 * ones that did not exist:
 *
 *   'marks'    the read landed and there are exclusions. The rows are marked
 *              and the standing caveat sits above them.
 *   'checking' the read is in flight. Nothing is marked YET, and the screen
 *              says so rather than implying a checked, clear list.
 *   'unknown'  the read failed, or came back truncated. Nothing is marked and
 *              nothing can be, and the absence of marks means nothing at all.
 *   'none'     the read landed and this member excludes nothing. There is
 *              nothing to mark against and nothing to say.
 *
 * 'partial' is 'unknown' and not a softer thing: a truncated profile read may
 * be missing the one exclusion that matters, and half an allergen list is not a
 * basis for drawing the other half as clear.
 */
export type DishMarkState = 'marks' | 'checking' | 'unknown' | 'none';

export interface DishMarkNotice {
  state: DishMarkState;
  /** The sentence to render above the rows, or null when there is none. */
  text: string | null;
  /** Whether the marks on the rows mean anything. False under 'checking' and
   *  'unknown', where an unmarked row is unmarked because nothing was read. */
  marked: boolean;
}

/** The read is in flight. Not "no exclusions" and not "we could not find out". */
export const DISH_MARK_LOADING =
  'Reading your exclusions — nothing below is marked against them yet.';

/** The read failed. The strongest of the four, because this is the one that
 *  used to be drawn as a clear list. */
export const DISH_MARK_UNKNOWN =
  'Your exclusions could not be read, so nothing below is marked against them. An unmarked dish here has not been checked against anything — pull down to try again, and ask the kitchen if it matters.';

export function dishMarkNotice(status: LoadStatus, avoidCount: number): DishMarkNotice {
  if (status === 'loading') return { state: 'checking', text: DISH_MARK_LOADING, marked: false };
  if (!isWhole(status)) return { state: 'unknown', text: DISH_MARK_UNKNOWN, marked: false };
  if (avoidCount > 0) return { state: 'marks', text: DISH_MARK_CAVEAT, marked: true };
  return { state: 'none', text: null, marked: true };
}
