// The real recipes a member put in their own plan — whose they are, and how
// little of each is kept.
//
// ── Why this is not a second column in src/lib/mealSwaps.ts ────────────────
//
// A swap is a CATALOGUE INDEX: `{ pos → idx }`, resolved by `mealAt` through
// pools the member's diet and exclusions have filtered. A recipe has no place
// in that catalogue — `RecipeMeal.idx` is -1 on purpose — and the one thing that
// must never happen is a -1 arriving in `buildPlan`'s `mealOverride`, where
// `idx % size` would turn it into a dinner nobody chose. Two maps, two files,
// two readers that each refuse the other's values: `readMealSwaps` drops
// anything that is not a non-negative integer, and `readRecipePlan` drops
// anything that is not a `RecipeRef`.
//
// ── What is kept, and the clause that decides it ───────────────────────────
//
// Spoonacular's terms: "You may not … copy or store the information it
// provides, including any derived, hashed, or transformed data. … You can
// indefinitely store the recipe id, the recipe title, and the recipe image
// url." web/privacy.html tells members that is how a planned recipe is kept.
//
// So the value at each position is a `RecipeRef` and NOTHING ELSE — not the
// calories it was portioned to, not the servings, not an ingredient. Both
// directions go through `readRecipeRef`, which rebuilds the ref field by field
// rather than passing the stored object along, so a stored blob that carries
// more comes back as three facts and a source tag, and a whole `RecipeMeal`
// handed to `writeRecipePlan` by mistake is not a ref at all and is dropped — a
// choice that is not kept, never a figure that is. The figures are read again through the `recipes` function's
// `detail` action (src/ui/useRecipeSearch.ts, `useRecipeDetail`) and portioned
// to whatever the slot carries THAT day — which is also the right behaviour: a
// portion remembered from a training day would be the wrong portion on a rest
// day.
//
// ── Whose ──────────────────────────────────────────────────────────────────
//
// The account goes in the key, exactly as src/lib/mealSwaps.ts argues and for
// the same reason: a key with no account in it is a key the next member on a
// shared handset inherits, and an account-scoped key is unreadable to them by
// construction — which is why this needs no entry in src/lib/signOutState.ts.
// Not the week as well: a recipe chosen for breakfast is a standing choice, the
// way a swap is.
import { readRecipeRef, recipeRef, type RecipeMeal, type RecipeRef } from './recipes';

/** Every planned-recipe key starts with this. Nothing reads it at runtime; it
 *  is here so the shape can be asserted and recognised. */
export const RECIPE_PLAN_PREFIX = 'repple.recipePlan:';

/** Slot position → the recipe planned there. */
export type RecipePlan = Record<number, RecipeRef>;

/**
 * Where this member's planned recipes live.
 *
 * Null when there is no account to scope them to, and a null means DO NOT
 * PERSIST — the rule `mealSwapsKey` keeps, including for 'unknown', the literal
 * src/ui/clientData.tsx holds before the auth read lands.
 */
export function recipePlanKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id || id === 'unknown') return null;
  return `${RECIPE_PLAN_PREFIX}${id}`;
}

/** Whether a key holds somebody's planned recipes. For the sign-out assertion. */
export const isRecipePlanKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(RECIPE_PLAN_PREFIX);

const isPos = (pos: number) => Number.isInteger(pos) && pos >= 0;

/** A map of anything, reduced to the positions that hold a real ref. Shared by
 *  the reader and the writer so the two cannot drift. */
function refsOf(v: unknown): RecipePlan {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: RecipePlan = {};
  for (const [k, stored] of Object.entries(v as Record<string, unknown>)) {
    const pos = Number(k);
    if (!isPos(pos)) continue;
    // Rebuilt, not passed along: whatever else the stored object carries does
    // not come back with it.
    const ref = readRecipeRef(stored);
    if (ref) out[pos] = ref;
  }
  return out;
}

/**
 * The planned recipes read back off a stored string.
 *
 * Anything unreadable is NO planned recipes, and that is not a failed read
 * being called an empty one: this device is the only copy of the choice, and
 * the honest fallback for "we cannot tell what you chose" is the plan as the
 * engine composes it — what the member saw before they chose anything.
 */
export function readRecipePlan(raw: string | null | undefined): RecipePlan {
  if (!raw) return {};
  try { return refsOf(JSON.parse(raw)); } catch { return {}; }
}

/**
 * The planned recipes as they go to the store: refs, and only refs.
 *
 * The argument is typed as refs and is NOT trusted to be: a `PlannedRecipe` is
 * structurally a `RecipeRef`-and-then-some as far as a spread is concerned, and
 * the spread is how macros end up on a disk nobody remembers the terms apply
 * to. What is written is what `readRecipeRef` would give back — for a whole
 * dish that is nothing, which is why `withRecipeAt` is the way in.
 */
export function writeRecipePlan(plan: RecipePlan): string {
  return JSON.stringify(refsOf(plan ?? {}));
}

/**
 * The plan with this recipe at `pos`. Takes the DISH and keeps the ref —
 * through `recipeRef`, so the caller never builds the stored shape by hand.
 * A position that is not one (a snack idea's -1, a NaN) changes nothing.
 */
export function withRecipeAt(plan: RecipePlan, pos: number, meal: RecipeMeal): RecipePlan {
  if (!isPos(pos)) return plan;
  return { ...plan, [pos]: recipeRef(meal) };
}

/** The plan with nothing chosen at `pos` — the slot goes back to the plan's own
 *  meal. The same object when there was nothing there, so a state setter fed
 *  this does not re-render (or re-write the store) for a no-op. */
export function withoutRecipeAt(plan: RecipePlan, pos: number): RecipePlan {
  if (!(pos in plan)) return plan;
  const next = { ...plan };
  delete next[pos];
  return next;
}
