// The recipes a coach has pinned into a client's written week — day → position
// → `RecipeRef`, and the rules for getting one in and out of
// `coach_nutrition.recipe_refs`.
//
// ── Why this is a separate map and not a field on the plan ─────────────────
//
// `CoachMealPlan` is catalogue INDICES: `mealAt(diet, slot, idx, avoid)` and
// nothing else, with the diet and the allergen list that define what those
// indices mean stored beside them. A Spoonacular recipe has no index — it is
// somebody else's dish, fetched by id — and `idx` on one is -1 precisely so it
// can never be mistaken for a catalogue position (src/lib/recipes.ts). So the
// refs travel in their own column, keyed by the same two numbers the plan is
// keyed by, and a plan read back without them is still a whole plan.
//
// ── FOUR KEYS, and why this file is the only way in ───────────────────────
//
// Spoonacular's terms let Repple keep a recipe's id, its title and its image
// address, and nothing else: not the ingredients, not the method, not the
// macros, all of which are fetched again through the `recipes` function each
// time somebody opens the dish. `coach_nutrition_recipe_refs_shape_ck` holds
// the column to those four keys and REJECTS anything else, and that rejection
// is the licence working rather than a bug to route around.
//
// The hazard is a spread. A `PlannedRecipe` is structurally a `RecipeRef` and
// then some — macros, ingredient list, method steps — so `{ ...meal }` type-
// checks perfectly and writes a cache nobody agreed to. Every function here
// therefore REBUILDS the stored value through `readRecipeRef`, in both
// directions, exactly as src/lib/recipePlan.ts does for the member's own
// handset copy. Pass a whole dish to `withCoachRecipeAt` and only the four
// keys come out the other side.
//
// ── The search gate ───────────────────────────────────────────────────────
//
// `coachRecipeSearch` is at the bottom, and it is the reason this file is
// tested. A coach searching recipes for a client is searching against THAT
// client's diet and exclusions; a profile read that did not land is not a
// client with no allergies, and the hook must be handed `null` rather than an
// empty `avoid` list. See its own comment.
import { readRecipeRef, recipeRef, type RecipeMeal, type RecipeRef, type RecipeSearchParams } from './recipes';
import type { Allergen, Slot } from './meals';
import type { Diet } from './types';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/** Day index into `CoachMealPlan.days`, then position within that day. */
export type CoachRecipeRefs = Record<number, Record<number, RecipeRef>>;

const isIndex = (n: number) => Number.isInteger(n) && n >= 0;

/** One day's refs, rebuilt from whatever was handed in. Shared by the reader
 *  and the writer so the two cannot drift apart. */
function dayRefsOf(v: unknown): Record<number, RecipeRef> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<number, RecipeRef> = {};
  for (const [k, stored] of Object.entries(v as Record<string, unknown>)) {
    const pos = Number(k);
    if (!isIndex(pos)) continue;
    const ref = readRecipeRef(stored);
    if (ref) out[pos] = ref;
  }
  return out;
}

/** Everything under a day key, rebuilt. Days holding nothing readable are
 *  dropped rather than left as empty objects, so `hasCoachRecipes` can be the
 *  plain "is there anything here" it looks like. */
function refsOf(v: unknown): CoachRecipeRefs {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: CoachRecipeRefs = {};
  for (const [k, day] of Object.entries(v as Record<string, unknown>)) {
    const d = Number(k);
    if (!isIndex(d)) continue;
    const refs = dayRefsOf(day);
    if (Object.keys(refs).length) out[d] = refs;
  }
  return out;
}

/**
 * The column read back.
 *
 * Unreadable is EMPTY here, and that is not a failed read being called an
 * absent one: the column is `not null default '{}'`, so the row either came
 * back or it did not, and whether it came back at all is what
 * `useCoachNutrition().status` says. This function only decides what a value
 * that did arrive means.
 */
export function readCoachRecipeRefs(v: unknown): CoachRecipeRefs {
  return refsOf(v);
}

/**
 * The refs as they go into the column: string keys, four fields per ref.
 *
 * The argument is typed as refs and is not trusted to be — see the header.
 * What is written is what `readRecipeRef` gives back, which for a whole
 * `PlannedRecipe` is the four keys and none of its figures.
 */
export function coachRecipeRefsJson(refs: CoachRecipeRefs): Record<string, Record<string, RecipeRef>> {
  const clean = refsOf(refs ?? {});
  const out: Record<string, Record<string, RecipeRef>> = {};
  for (const [d, day] of Object.entries(clean)) {
    const slots: Record<string, RecipeRef> = {};
    for (const [pos, ref] of Object.entries(day)) {
      // Spelled out rather than spread: a field added to `RecipeRef` later
      // would otherwise reach the column and be refused by the CHECK, and the
      // refusal would arrive as "the plan did not send" on a coach's screen.
      slots[pos] = { source: ref.source, sourceId: ref.sourceId, title: ref.title, image: ref.image };
    }
    out[d] = slots;
  }
  return out;
}

/** What the coach pinned at this slot, or null for the plan's own meal. */
export function coachRecipeRefAt(refs: CoachRecipeRefs, day: number, pos: number): RecipeRef | null {
  if (!isIndex(day) || !isIndex(pos)) return null;
  return refs[day]?.[pos] ?? null;
}

/** Whether any day of the week holds a pinned recipe. */
export const hasCoachRecipes = (refs: CoachRecipeRefs): boolean => Object.keys(refs).length > 0;

/**
 * The week with this recipe pinned at `day`/`pos`. Takes the DISH and keeps
 * the ref, through `recipeRef`, so no caller ever builds the stored shape by
 * hand. A day or a position that is not one changes nothing.
 */
export function withCoachRecipeAt(refs: CoachRecipeRefs, day: number, pos: number, meal: RecipeMeal): CoachRecipeRefs {
  if (!isIndex(day) || !isIndex(pos)) return refs;
  return { ...refs, [day]: { ...(refs[day] ?? {}), [pos]: recipeRef(meal) } };
}

/**
 * The week with nothing pinned at `day`/`pos` — the slot goes back to the
 * plan's generated meal. The SAME object when there was nothing there, so a
 * state setter fed this does not re-render for a no-op, and choosing a
 * catalogue dish for a slot that never held a recipe costs nothing.
 */
export function withoutCoachRecipeAt(refs: CoachRecipeRefs, day: number, pos: number): CoachRecipeRefs {
  if (!refs[day] || !(pos in refs[day])) return refs;
  const day2 = { ...refs[day] };
  delete day2[pos];
  const next = { ...refs };
  if (Object.keys(day2).length) next[day] = day2; else delete next[day];
  return next;
}

/**
 * Copy one day's pinned recipes onto another — the companion to
 * `copyPlanDay`. Without it "Fill the Week" would copy Monday's meals to
 * Tuesday and silently leave Monday's recipe behind, so Tuesday would show the
 * generated dish the coach had already replaced.
 */
export function copyCoachRecipeDay(refs: CoachRecipeRefs, from: number, to: number): CoachRecipeRefs {
  if (!isIndex(from) || !isIndex(to) || from === to) return refs;
  const src = refs[from];
  const next = { ...refs };
  if (src && Object.keys(src).length) next[to] = { ...src }; else delete next[to];
  return next;
}

/**
 * The params for the coach's recipe search, or `null` for "do not ask".
 *
 * `null` is what `useRecipeSearch` takes to mean nothing is on screen, and
 * nothing is spent. Every refusal below is one of two things:
 *
 *  · THE CLIENT'S RESTRICTIONS, OR NO SEARCH. A recipe search carries the
 *    diet and the exclusions it is filtered by, and on this screen those are
 *    the CLIENT's, never the coach's and never an empty list. `avoid: null`
 *    means the `clients` row did not come back, and a read that did not come
 *    back is not a client with no allergies — it is the same substitution
 *    `guardPlan` refuses the send for, made one step earlier so the coach is
 *    never shown a list of dishes chosen against nothing. `profileStatus`
 *    must be whole for the same reason: 'partial' and 'error' both mean some
 *    part of what filters this search is unknown.
 *
 *  · POINTS ARE MONEY. Since 20 Sep 2026 this account is on Spoonacular's
 *    Cook plan, which BILLS an overrun at $0.005 a point instead of refusing
 *    it, so every avoidable request is a charge rather than a near miss.
 *    `open` is a deliberate act by the coach — a tap on Recipes — so mounting
 *    the screen, opening the meal sheet and switching day all cost nothing.
 *    The 500 ms debounce, the three-character minimum and the no-retry rule
 *    live in `useRecipeSearch` and are not repeated here.
 */
export function coachRecipeSearch(input: {
  /** The coach has asked for recipes on this slot. False until they do. */
  open: boolean;
  /** The status of the CLIENT's profile read — their diet and exclusions. */
  profileStatus: LoadStatus;
  /** The slot being filled, null when no sheet is open. */
  slot: Slot | null;
  diet: Diet | null;
  /** Null means unread. Empty means read, and they avoid nothing. */
  avoid: readonly Allergen[] | null;
  query: string;
  /** The `K` of the row being replaced, so results can be portioned to it. */
  targetKcal: number | null;
  number?: number;
}): RecipeSearchParams | null {
  const { open, profileStatus, slot, diet, avoid, query, targetKcal } = input;
  if (!open || !slot || !diet || avoid == null) return null;
  if (!isWhole(profileStatus)) return null;
  return {
    slot,
    diet,
    avoid,
    query,
    // Rounded to 50, as the member's own Meals list rounds it: swapping
    // between two dishes of near-equal calories is then the same question and
    // is answered out of the hook rather than bought again.
    targetKcal: targetKcal != null && targetKcal > 0 ? Math.round(targetKcal / 50) * 50 : null,
    number: input.number,
  };
}
