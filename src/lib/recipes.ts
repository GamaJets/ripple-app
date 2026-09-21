// ── Real recipes, as the rows the Meals list already draws ──────────────────
//
// src/lib/meals.ts builds dishes out of component pools, which is why every one
// of them has honest macros and a grocery list and none of them has a
// photograph. The `recipes` edge function (supabase/functions/recipes) brings
// back real, photographed dishes from Spoonacular. This file turns one of those
// into the SAME row a generated dish is — `n`, `slot`, `ico`, `k/p/c/f`, `ing`,
// `steps` — so the screens, the portioning and the grocery list need no second
// code path, plus the four things only a real recipe has: its photograph, where
// it came from, who to credit, and what could not be read.
//
// Pure and UI-free. The network call lives in src/ui/useRecipeSearch.ts; what
// its answer MEANS lives here (`readRecipeReply`), where it can be tested.
//
// ── Three rules this file exists to keep ───────────────────────────────────
//
//  · NULL IS NOT ZERO. A dish whose calories Spoonacular did not compute is not
//    a 0 kcal dish. It cannot be portioned, so it is not offered, and it is
//    COUNTED (`dropped`) so the list says "partial" rather than looking whole.
//  · THE REMOTE FILTER IS NOT TRUSTED ALONE. Spoonacular's `intolerances` is
//    computed from ingredient text and misses things. Every dish is re-read by
//    `mealAllergens`, the matcher the generated dishes go through, and one that
//    slipped through is MARKED (`flagged`) — drawn with the warning on it, the
//    way src/lib/meals.ts draws a generated dish it could not keep clean.
//  · A FAILURE IS NEVER AN EMPTY LIST. "No recipes matched" is a true answer
//    about a search that worked. Not configured, limited and failed are three
//    other things, each with its own words, and none of them carries a `meals`
//    array for a screen to draw as nothing found.
//
// ── And one Spoonacular's terms decide: what may be REMEMBERED ─────────────
//
// "You may not … copy or store the information it provides, including any
// derived, hashed, or transformed data", with one exemption: "You can
// indefinitely store the recipe id, the recipe title, and the recipe image
// url". So a recipe somebody puts in their plan is persisted as a `RecipeRef`
// and NOTHING ELSE — not its macros, not its ingredients — and is read again
// through the function's `detail` action when it is next opened. A `RecipeMeal`
// lives in memory for as long as the screen does.
import type { Diet } from './types';
import { mealAllergens, type Allergen, type Dept, type GeneratedMeal, type PlannedMeal, type Slot } from './meals';
import type { RecipeWire, RecipeIngredientWire, RecipeErrorCode, RecipeSearchRequest } from './recipeWire';
import type { LoadStatus } from '../ui/loadStatus';

// ── attribution and disclaimer: the screens render these ───────────────────

/**
 * The credit line for the library itself, to be drawn wherever recipe results
 * are listed — once, under the list, as a link.
 *
 * Spoonacular's free plan is "Backlink Required" (their pricing page) and their
 * terms require "a backlink to our food API page" of free custom plans; the
 * paid plans do not. It is drawn on every plan regardless: it is true, it costs
 * a line, and a requirement that switches on when a card is declined is one
 * nobody will remember to switch back on.
 *
 * Plain words and a link, deliberately. The same terms forbid using "any
 * spoonacular brands/logos to promote your site/app without prior permission",
 * so no logo, and this goes beside the recipes — never in store listings or
 * marketing.
 */
export const RECIPE_ATTRIBUTION = {
  text: 'Recipes and nutrition data from spoonacular',
  url: 'https://spoonacular.com/food-api',
} as const;

/**
 * What a member is told beside any recipe's figures or allergen marks.
 *
 * Their terms put this on Repple by name: "It is your responsibility to display
 * appropriate disclaimers regarding potential inaccuracies pertaining to
 * allergies, … nutritional information". It would be owed without them. The
 * macros are computed by Spoonacular from ingredient text, and Repple's own
 * allergen check reads ingredient NAMES — neither has seen the packet.
 */
export const RECIPE_DISCLAIMER =
  'Nutrition figures and allergen marks on recipes are computed from the ingredient list and can be wrong. If you have an allergy, read the full recipe and check every packet yourself.';

// ── the row ────────────────────────────────────────────────────────────────

export interface RecipeCredit { name: string; url: string | null }

/**
 * A real recipe in a generated dish's shape.
 *
 * `idx` is -1 and that is load-bearing. A generated dish is addressed by its
 * index into the catalogue (`mealAt(diet, slot, idx)`, the `mealOverride` map);
 * a recipe has no place in that catalogue, and -1 is the value that can never
 * be mistaken for one. Anything that keys or persists rows must use
 * `sourceId` for these — `isRecipeMeal` is the test.
 */
export interface RecipeMeal extends GeneratedMeal {
  idx: -1;
  source: 'spoonacular';
  sourceId: number;
  /** The photograph. Null when they have none — draw `ico`, as for any dish. */
  image: string | null;
  /** The original publisher, whom the terms require crediting by name WITH a
   *  hyperlink. Null only when Spoonacular named nobody. */
  credit: RecipeCredit | null;
  readyInMinutes: number | null;
  /** How many servings the recipe as written makes. `ing` is already divided
   *  by this, so it is for display ("Makes 4") and nothing else. */
  recipeServings: number;
  /** Ingredients with no amount ("salt, to taste"). Named here rather than put
   *  in `ing` with a 0, which the grocery list would print as "0 g salt". */
  unmeasured: string[];
  /** The member's exclusions this dish CONTAINS, by Repple's own reading.
   *  Non-empty means Spoonacular's filter let it through: draw the warning. */
  flagged: Allergen[];
}

/** A `RecipeMeal` portioned into a plan slot — a `PlannedMeal`, and usable
 *  anywhere one is (`groceryFromWeek`, the macro totals, the row). */
export type PlannedRecipe = RecipeMeal & PlannedMeal;

export function isRecipeMeal(m: GeneratedMeal): m is RecipeMeal {
  return (m as Partial<RecipeMeal>).source === 'spoonacular';
}

/** What is drawn where the photograph would be when there is none, or while it
 *  loads, or when it fails. By slot, because a recipe has no component to borrow
 *  an emoji from the way a generated dish does. */
const SLOT_ICO: Record<Slot, string> = { Breakfast: '🍳', Lunch: '🥗', Dinner: '🍽️', Snack: '🍎' };

// ── aisle → department ─────────────────────────────────────────────────────

const FRUIT = /\b(apples?|bananas?|berr(y|ies)|\w+berr(y|ies)|lemons?|limes?|oranges?|grapes?|grapefruit|mango(es)?|pineapple|peach(es)?|pears?|plums?|melon|watermelon|cherr(y|ies)|kiwi|avocados?|dates?|figs?|apricots?|pomegranate|raisins?)\b/;
const NUT_OR_SEED = /\b(nuts?|almonds?|walnuts?|cashews?|pecans?|peanuts?|hazelnuts?|pistachios?|macadamias?|seeds?|tahini)\b|butter\b.*\b(nut|almond|peanut|cashew)|\b(nut|almond|peanut|cashew)\s+butter\b/;

/**
 * Spoonacular's supermarket aisle as one of Repple's eight departments.
 *
 * Their aisles (the docs list 28) are a shop's; Repple's are a shopping LIST's,
 * and the two disagree in three places that matter. "Produce" is fruit and
 * vegetables together, so the ingredient's name decides — avocado and lemon are
 * Fruits here because src/lib/meals.ts files them there and one list must not
 * carry lemons under two headings. "Nut butters, Jams, and Honey" is an aisle
 * where only the first third is Nuts & Seeds. And an aisle may be several,
 * joined by `;` ("Pasta and Rice;Ethnic Foods") — the first that means
 * something wins.
 *
 * Anything unrecognised is 'Pantry & Other', which is what the department is
 * for. A wrong heading costs somebody a walk across a shop; it is not a figure.
 */
export function deptForAisle(aisle: string | null, name: string): Dept {
  const n = name.toLowerCase();
  for (const part of (aisle ?? '').split(';')) {
    const a = part.trim().toLowerCase();
    if (!a) continue;
    if (a === 'meat' || a === 'seafood') return 'Meat & Seafood';
    if (a === 'milk, eggs, other dairy' || a === 'cheese') return 'Dairy & Eggs';
    if (a === 'produce') return FRUIT.test(n) ? 'Fruits' : 'Vegetables';
    if (a === 'dried fruits') return 'Fruits';
    if (a === 'pasta and rice' || a === 'bakery/bread' || a === 'bread' || a === 'cereal') return 'Grains & Bread';
    if (a === 'nuts') return 'Nuts & Seeds';
    if (a === 'nut butters, jams, and honey') return NUT_OR_SEED.test(n) ? 'Nuts & Seeds' : 'Pantry & Other';
    if (a === 'oil, vinegar, salad dressing') return /\b(vinegar|dressing)\b/.test(n) ? 'Pantry & Other' : 'Fats & Oils';
    if (a === 'baking' && /\b(flour|oats?)\b/.test(n)) return 'Grains & Bread';
  }
  return 'Pantry & Other';
}

// ── the allergen re-check ──────────────────────────────────────────────────

/**
 * Which of `avoid` a recipe contains, by Repple's own reading of it.
 *
 * Reads EVERY ingredient name, measured or not. "Butter, for greasing" has no
 * amount and is exactly as much dairy as 50 g of it — and `mealAllergens` on the
 * row alone would miss it, because `unmeasured` is not in `ing`.
 *
 * `flagged` on a `RecipeMeal` is this, as of the exclusions the dish was read
 * under. A dish that outlives that moment — one held on screen, or chosen for a
 * slot, while the member ticks another allergen — is asked again through here
 * with today's list rather than drawn with yesterday's answer.
 */
export function recipeAllergens(
  meal: Pick<RecipeMeal, 'n' | 'ing' | 'unmeasured'>, avoid: readonly Allergen[],
): Allergen[] {
  return mealAllergens(
    { n: meal.n, ing: [...meal.ing, ...meal.unmeasured.map((u): RecipeMeal['ing'][number] => [u, 0, '', 'Pantry & Other'])] },
    [...avoid],
  );
}

// ── one recipe → one row ───────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A quantity somebody can shop to. Grams and millilitres to the unit; anything
 *  else to two places, so a third of a cup does not print as 0.3333333. */
function tidy(qty: number, unit: string): number {
  return unit === 'g' || unit === 'ml' ? Math.round(qty) : Math.round(qty * 100) / 100;
}

function measure(i: RecipeIngredientWire, measures: 'metric' | 'original'): { qty: number; unit: string } | null {
  if (measures === 'metric' && i.metricAmount != null && i.metricAmount > 0) return { qty: i.metricAmount, unit: i.metricUnit };
  if (i.amount != null && i.amount > 0) return { qty: i.amount, unit: i.unit };
  return null;
}

export interface RecipeContext {
  slot: Slot;
  diet: Diet;
  avoid: readonly Allergen[];
  /** Which of Spoonacular's two sets of quantities to shop from. Metric by
   *  default, because the generated dishes are in grams and millilitres and the
   *  grocery list adds the two together. */
  measures?: 'metric' | 'original';
}

/**
 * One trimmed recipe as a Meals row — or null, when it cannot honestly be one.
 *
 * Null when any of the four macros is missing, or the recipe does not say how
 * many it serves. The first is the null-is-not-zero rule: the row's `k/p/c/f`
 * are numbers the plan totals ADD, and a guess in one of them is a wrong day.
 * The second is because Spoonacular's nutrition is per serving and its
 * ingredients are for the whole recipe; without the divisor the grocery list
 * would buy four dinners' worth for one.
 *
 * The caller counts the nulls. See `toRecipeMeals`.
 */
export function toRecipeMeal(r: RecipeWire, ctx: RecipeContext): RecipeMeal | null {
  if (r.kcal == null || r.protein == null || r.carbs == null || r.fat == null) return null;
  if (r.kcal <= 0 || r.servings == null || r.servings <= 0) return null;
  const measures = ctx.measures ?? 'metric';
  const ing: RecipeMeal['ing'] = [];
  const unmeasured: string[] = [];
  for (const i of r.ingredients) {
    const m = measure(i, measures);
    const item = cap(i.name);
    if (!m) { unmeasured.push(item); continue; }
    // Per serving, because that is what `ing` means everywhere else: the
    // grocery list multiplies it by the row's `servings`.
    ing.push([item, tidy(m.qty / r.servings, m.unit), m.unit, deptForAisle(i.aisle, i.name)]);
  }
  const flagged = recipeAllergens({ n: r.title, ing, unmeasured }, ctx.avoid);
  return {
    n: r.title,
    slot: ctx.slot,
    ico: SLOT_ICO[ctx.slot],
    k: Math.round(r.kcal), p: Math.round(r.protein), c: Math.round(r.carbs), f: Math.round(r.fat),
    ing,
    steps: r.steps,
    diet: ctx.diet,
    idx: -1,
    source: 'spoonacular',
    sourceId: r.id,
    image: r.image,
    credit: r.creditsText || r.sourceUrl ? { name: r.creditsText ?? 'Original recipe', url: r.sourceUrl } : null,
    readyInMinutes: r.readyInMinutes,
    recipeServings: r.servings,
    unmeasured,
    flagged,
  };
}

/** Every recipe that could be a row, and how many could not. */
export function toRecipeMeals(recipes: readonly RecipeWire[], ctx: RecipeContext): { meals: RecipeMeal[]; dropped: number } {
  const meals: RecipeMeal[] = [];
  let dropped = 0;
  for (const r of recipes) {
    const m = toRecipeMeal(r, ctx);
    if (m) meals.push(m); else dropped++;
  }
  return { meals, dropped };
}

// ── portioning ─────────────────────────────────────────────────────────────

/**
 * A recipe portioned to the calories a plan slot carries.
 *
 * EXACTLY `buildPlan`'s arithmetic, on purpose: servings in quarters, never
 * under a half, and the capitals rounded from the per-serving figures. A recipe
 * swapped into a slot must land where the generated dish it replaced did, or
 * swapping one changes the day's total by more than the dish.
 *
 * `targetKcal` is the slot's share — for a plan slot, the `K` of the row being
 * replaced; for a snack idea, the day's target times `SNACK_SHARE`. Null means
 * "as written": one serving, which is what a search result shows before
 * anybody has chosen a slot for it.
 */
export function portionRecipe(meal: RecipeMeal, targetKcal: number | null, pos: number): PlannedRecipe {
  const servings = targetKcal != null && targetKcal > 0
    ? Math.max(0.5, Math.round((targetKcal / Math.max(1, meal.k)) * 4) / 4)
    : 1;
  return {
    ...meal,
    pos,
    servings,
    K: Math.round(meal.k * servings), P: Math.round(meal.p * servings),
    C: Math.round(meal.c * servings), F: Math.round(meal.f * servings),
  };
}

// ── what may be remembered ─────────────────────────────────────────────────

/** Everything about a recipe that Spoonacular's terms let Repple keep. See the
 *  header: id, title and image URL, indefinitely; nothing else, at all. */
export interface RecipeRef { source: 'spoonacular'; sourceId: number; title: string; image: string | null }

/** The part of a recipe that may be written to storage or to the database. Go
 *  through this rather than spreading the row: the spread is how macros and an
 *  ingredient list end up in a column nobody remembers the terms apply to. */
export function recipeRef(meal: RecipeMeal): RecipeRef {
  return { source: 'spoonacular', sourceId: meal.sourceId, title: meal.n, image: meal.image };
}

/** A stored ref, read back rather than trusted — storage is edited by versions
 *  of the app that no longer exist. Null for anything that is not one. */
export function readRecipeRef(v: unknown): RecipeRef | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const id = r.sourceId;
  if (r.source !== 'spoonacular' || typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  if (typeof r.title !== 'string' || !r.title.trim()) return null;
  return { source: 'spoonacular', sourceId: id, title: r.title, image: typeof r.image === 'string' && /^https:\/\//.test(r.image) ? r.image : null };
}

// ── the request ────────────────────────────────────────────────────────────

export interface RecipeSearchParams {
  slot: Slot;
  diet: Diet;
  avoid: readonly Allergen[];
  query?: string;
  /** Narrow the search to dishes that can be portioned to this. Costs a whole
   *  extra Spoonacular point per search — see src/lib/recipeWire.ts. */
  targetKcal?: number | null;
  number?: number;
}

/** The body `supabase.functions.invoke('recipes', …)` sends. Typed against the
 *  wire's own request, so a renamed field fails here rather than as a 400. */
export function searchBody(p: RecipeSearchParams): Omit<RecipeSearchRequest, 'number' | 'targetKcal'> & { number?: number; targetKcal?: number } {
  return {
    action: 'search',
    slot: p.slot,
    diet: p.diet,
    avoid: [...p.avoid],
    query: (p.query ?? '').trim(),
    ...(p.targetKcal != null && p.targetKcal > 0 ? { targetKcal: Math.round(p.targetKcal) } : {}),
    ...(p.number != null ? { number: p.number } : {}),
  };
}

// ── the answer ─────────────────────────────────────────────────────────────

/**
 * What a recipe search came to. Five outcomes, and only the first two carry
 * dishes.
 *
 *   ready           the search worked and every dish it returned is a row.
 *                   `meals` may be EMPTY — that is "nothing matched", a true
 *                   answer, and the only empty list there is.
 *   partial         it worked, and some of what came back could not be a row
 *                   (no nutrition, no serving count, not a recipe). `dropped`
 *                   says how many. Draw the rows and say so; do not count them
 *                   as the whole answer.
 *   not-configured  the owner has not set the key (or Spoonacular refuses it).
 *                   Not an error the member can do anything about, and not
 *                   worth a retry: the Meals list simply has no recipe library
 *                   yet and should draw the generated dishes alone.
 *   limited         the member has searched too often, the day's quota is
 *                   spent, or Spoonacular is busy. `retryAfterS` when known.
 *   error           anything else. `why` for the wording; nothing was read.
 */
export type RecipeSearchResult =
  | { status: 'ready'; meals: RecipeMeal[]; total: number | null }
  | { status: 'partial'; meals: RecipeMeal[]; total: number | null; dropped: number }
  | { status: 'not-configured'; message: string }
  | { status: 'limited'; why: 'you' | 'quota' | 'busy'; retryAfterS: number | null; message: string }
  | { status: 'error'; why: 'unreachable' | 'unreadable' | 'signed-out' | 'refused'; message: string };

export type RecipeDetailResult =
  | { status: 'ready'; meal: RecipeMeal }
  | { status: 'gone'; message: string }
  | Exclude<RecipeSearchResult, { status: 'ready' | 'partial' }>;

/** The result as the `LoadStatus` every other read on a screen already is, so
 *  `isWhole` and `worstStatus` gate recipe figures like any others.
 *  'not-configured' is 'error' here on purpose: whatever else it is, it is not
 *  a whole read, and nothing may be counted from it. */
export function recipeLoadStatus(r: RecipeSearchResult | RecipeDetailResult | null): LoadStatus {
  if (!r) return 'loading';
  if (r.status === 'ready') return 'ready';
  if (r.status === 'partial') return 'partial';
  return 'error';
}

const SAY = {
  notConfigured: 'The recipe library is not switched on yet. Your meals below are built from your plan as usual.',
  you: 'That is a lot of searches in a short while. Give it a moment and try again.',
  quota: 'The recipe library has reached its limit for today. It opens again tomorrow; your planned meals are unaffected.',
  busy: 'The recipe library is busy just now. Try again in a moment.',
  unreachable: 'Repple could not reach the recipe library. Nothing was searched. Check your connection and try again.',
  unreadable: 'The recipe library answered, but not in a way Repple could read. Nothing has been listed.',
  signedOut: 'Sign in to Repple to search recipes.',
  refused: 'Repple could not run that search. Nothing has been listed.',
  gone: 'This recipe is no longer in the library.',
} as const;

type Failure = Exclude<RecipeSearchResult, { status: 'ready' | 'partial' }>;

function failureFor(code: string | null, retryAfterS: number | null): Failure {
  switch (code as RecipeErrorCode | null) {
    // A refused key is the owner's to fix and reads to a member exactly as "not
    // switched on" does. The function's logs say which; the member is not asked
    // to care.
    case 'recipes_not_configured':
    case 'recipes_key_refused': return { status: 'not-configured', message: SAY.notConfigured };
    case 'recipes_rate_limited': return { status: 'limited', why: 'you', retryAfterS, message: SAY.you };
    case 'recipes_quota_spent': return { status: 'limited', why: 'quota', retryAfterS, message: SAY.quota };
    case 'recipes_busy': return { status: 'limited', why: 'busy', retryAfterS, message: SAY.busy };
    case 'recipes_unreadable': return { status: 'error', why: 'unreadable', message: SAY.unreadable };
    case 'signed_out': return { status: 'error', why: 'signed-out', message: SAY.signedOut };
    case 'bad_request': return { status: 'error', why: 'refused', message: SAY.refused };
    // 'recipes_upstream', 'recipes_unreachable', 'auth_unreachable', and any
    // code a newer function sends that this build has never heard of.
    default: return { status: 'error', why: 'unreachable', message: SAY.unreachable };
  }
}

/** What came back from `functions.invoke`, reduced to the three facts that
 *  matter. `answered` false is a transport failure: no function replied. */
export interface RecipeReply { answered: boolean; ok: boolean; body: unknown }

function failureOf(reply: RecipeReply): Failure {
  if (!reply.answered) return { status: 'error', why: 'unreachable', message: SAY.unreachable };
  const b = (reply.body ?? {}) as Record<string, unknown>;
  const retry = typeof b.retryAfterS === 'number' && Number.isFinite(b.retryAfterS) ? b.retryAfterS : null;
  return failureFor(typeof b.error === 'string' ? b.error : null, retry);
}

/**
 * A search reply as a result. The one place the five outcomes are decided.
 *
 * A 200 whose body has no `recipes` list is 'unreadable', NOT an empty 'ready':
 * the same rule `trimSearch` keeps on the server, kept again here because this
 * side may be talking to a function older or newer than itself.
 */
export function readRecipeReply(reply: RecipeReply, ctx: RecipeContext): RecipeSearchResult {
  if (!reply.answered || !reply.ok) return failureOf(reply);
  const b = reply.body as { recipes?: unknown; total?: unknown; unreadable?: unknown } | null;
  if (!b || !Array.isArray(b.recipes)) return { status: 'error', why: 'unreadable', message: SAY.unreadable };
  const { meals, dropped } = toRecipeMeals(b.recipes as RecipeWire[], ctx);
  const total = typeof b.total === 'number' && Number.isFinite(b.total) ? b.total : null;
  const lost = dropped + (typeof b.unreadable === 'number' && b.unreadable > 0 ? b.unreadable : 0);
  return lost > 0 ? { status: 'partial', meals, total, dropped: lost } : { status: 'ready', meals, total };
}

/** A `detail` reply as a result. A recipe that comes back without nutrition is
 *  'unreadable' rather than a row of zeros — there is no partial of one dish. */
export function readRecipeDetailReply(reply: RecipeReply, ctx: RecipeContext): RecipeDetailResult {
  if (reply.answered && !reply.ok && (reply.body as { error?: unknown } | null)?.error === 'recipes_not_found') {
    return { status: 'gone', message: SAY.gone };
  }
  if (!reply.answered || !reply.ok) return failureOf(reply);
  const recipe = (reply.body as { recipe?: unknown } | null)?.recipe;
  const meal = recipe && typeof recipe === 'object' ? toRecipeMeal(recipe as RecipeWire, ctx) : null;
  return meal ? { status: 'ready', meal } : { status: 'error', why: 'unreadable', message: SAY.unreadable };
}
