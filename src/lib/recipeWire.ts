// ── What crosses the wire between Repple and the recipe library ─────────────
//
// The `recipes` edge function (supabase/functions/recipes) asks Spoonacular for
// real dishes — photographed, with nutrition, ingredients and a method — so the
// Meals list has something to show beside the dishes src/lib/meals.ts assembles
// from component pools. This file is the half of that which is pure: how
// Repple's words become Spoonacular's parameters, and how Spoonacular's answer
// is cut down to the few fields a screen draws.
//
// A LEAF MODULE, with no relative imports of its own, for the reason
// src/lib/authReadFate.ts gives: the edge function imports it by path and Deno
// resolves nothing without an extension. So the diet, allergen and slot unions
// are restated here rather than imported from ./types and ./meals —
// src/lib/recipes.ts passes the app's own `Diet`, `Allergen` and `Slot` into
// these signatures, which is what makes tsc fail the day the two drift apart.
//
// ── Four things Spoonacular's terms and docs decide, and where ─────────────
//
// Read on 19 Sep 2026 from spoonacular.com/food-api/docs, /terms and /pricing.
//
//  1. POINTS, NOT CALLS. `recipes/complexSearch` costs 1 point, plus 0.01 per
//     result, plus 0.025 per result for EACH of addRecipeInformation,
//     addRecipeInstructions, addRecipeNutrition and fillIngredients, plus 1
//     whole point when any nutrient filter (minCalories…) is set.
//     `recipes/{id}/information` costs 1, plus 0.1 with nutrition. So one search
//     that brings everything back (0.11 a dish) is far cheaper than a bare
//     search and a detail call per dish opened (1.1 each) — which is why
//     `searchParams` asks for the lot, and why `MAX_RESULTS` is small.
//     The free plan is 50 points a day; paid plans BILL the overrun instead of
//     refusing it, so the limits here protect money as well as a quota.
//  2. NOTHING MAY BE KEPT. "You may not … copy or store the information it
//     provides, including any derived, hashed, or transformed data." Caching
//     for at most one hour is allowed only "with prior written permission".
//     The exemption is the recipe id, the title and the image URL, which may be
//     stored indefinitely. So a recipe somebody plans is remembered as those
//     three (`RecipeRef` in src/lib/recipes.ts) and read again when opened.
//  3. THE SOURCE IS CREDITED. "You must credit the original source in the same
//     manner" — the website's name and a hyperlink to the page. `credit` below
//     carries both, and a dish with no source to credit carries Spoonacular's
//     own page for it rather than nothing.
//  4. NO IDENTITY GOES. The request is a diet, exclusions, a meal type, a
//     calorie band and the words somebody typed. No user id, no name, no email;
//     the key travels in a header, never in a URL a log would keep.

/** Repple's `Diet`, restated. See the header for why it is not imported. */
export type WireDiet = 'meat' | 'vegetarian' | 'vegan' | 'paleo' | 'keto';
/** Repple's `Allergen`, restated. */
export type WireAllergen = 'dairy' | 'gluten' | 'nuts' | 'shellfish' | 'egg' | 'soy';
/** Repple's `Slot`, restated. */
export type WireSlot = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

const DIETS: readonly WireDiet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const ALLERGENS: readonly WireAllergen[] = ['dairy', 'gluten', 'nuts', 'shellfish', 'egg', 'soy'];
const SLOTS: readonly WireSlot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/** The most dishes one search may bring back. Each costs 0.11 points with
 *  everything attached, and a phone shows about eight rows before the fold. */
export const MAX_RESULTS = 12;
export const DEFAULT_RESULTS = 8;
/** Long enough for "high protein chicken traybake", short enough that the
 *  search box cannot be used to post an essay to a third party. */
export const MAX_QUERY_CHARS = 80;

/**
 * Repple's diet as Spoonacular's `diet` parameter.
 *
 * `meat` is the absence of a restriction and sends nothing. `keto` is
 * Spoonacular's "ketogenic", which is a MACRO RATIO test on their side (55–80%
 * fat, under 10% carbohydrate) rather than an ingredient list, so it is the
 * loosest of the four and the one most worth the member's own eye.
 */
export function dietParam(diet: WireDiet): string | null {
  if (diet === 'vegetarian') return 'vegetarian';
  if (diet === 'vegan') return 'vegan';
  if (diet === 'paleo') return 'paleo';
  if (diet === 'keto') return 'ketogenic';
  return null;
}

/**
 * Repple's exclusions as Spoonacular's `intolerances`.
 *
 * Their list is Dairy, Egg, Gluten, Grain, Peanut, Seafood, Sesame, Shellfish,
 * Soy, Sulfite, Tree Nut, Wheat. Repple's one "Nuts" pill is BOTH of theirs:
 * src/lib/meals.ts tests peanut alongside almond and cashew, and a member who
 * ticked Nuts and was served satay because a peanut is botanically a legume has
 * been failed by a technicality.
 *
 * This filter is a request, not a guarantee — their allergen tagging is
 * computed from ingredient text and misses things. src/lib/recipes.ts re-reads
 * every dish that comes back through `mealAllergens` and MARKS what slipped
 * through, exactly as a generated dish is marked.
 */
export function intolerancesParam(avoid: readonly WireAllergen[]): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const a of avoid) {
    if (a === 'dairy') add('Dairy');
    else if (a === 'gluten') add('Gluten');
    else if (a === 'nuts') { add('Tree Nut'); add('Peanut'); }
    else if (a === 'shellfish') add('Shellfish');
    else if (a === 'egg') add('Egg');
    else if (a === 'soy') add('Soy');
  }
  return out;
}

/** A plan slot as Spoonacular's meal `type`. They have no lunch or dinner —
 *  "main course" is both — so the slot a dish is planned into stays Repple's
 *  decision and is carried on the request, not read back off the dish. */
export function typeParam(slot: WireSlot): string {
  if (slot === 'Breakfast') return 'breakfast';
  if (slot === 'Snack') return 'snack';
  return 'main course';
}

export interface RecipeSearchRequest {
  action: 'search';
  slot: WireSlot;
  diet: WireDiet;
  avoid: WireAllergen[];
  query: string;
  /** Calories this slot is meant to carry, or null to leave calories out of it.
   *  Setting it costs a whole extra point a search — see `searchParams`. */
  targetKcal: number | null;
  number: number;
}
export interface RecipeDetailRequest { action: 'detail'; id: number }
export type RecipeRequest = RecipeSearchRequest | RecipeDetailRequest;

/**
 * A request body, read rather than trusted.
 *
 * Every field that reaches a URL sent on Repple's key is one of a closed list
 * or a clamped number, and the one free-text field is cut to length. An
 * unrecognised diet or slot is REFUSED rather than defaulted: `diet: 'vegann'`
 * quietly read as "no restriction" is a vegan shown chicken.
 */
export function readRecipeRequest(body: unknown): { ok: true; req: RecipeRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'a JSON object is required' };
  const b = body as Record<string, unknown>;
  if (b.action === 'detail') {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'detail needs a positive integer id' };
    return { ok: true, req: { action: 'detail', id } };
  }
  if (b.action !== 'search') return { ok: false, error: "action must be 'search' or 'detail'" };
  if (!SLOTS.includes(b.slot as WireSlot)) return { ok: false, error: 'slot is not one Repple plans' };
  if (!DIETS.includes(b.diet as WireDiet)) return { ok: false, error: 'diet is not one Repple knows' };
  const rawAvoid = b.avoid == null ? [] : b.avoid;
  if (!Array.isArray(rawAvoid)) return { ok: false, error: 'avoid must be a list' };
  // An exclusion this function cannot translate is refused, not dropped: a
  // search that silently ignores one of somebody's allergens is the worst
  // thing this endpoint could do.
  for (const a of rawAvoid) if (!ALLERGENS.includes(a as WireAllergen)) return { ok: false, error: 'avoid names an exclusion Repple does not know' };
  const avoid = ALLERGENS.filter((a) => rawAvoid.includes(a));
  const query = typeof b.query === 'string' ? b.query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS) : '';
  const t = Number(b.targetKcal);
  const targetKcal = b.targetKcal != null && Number.isFinite(t) && t >= 50 && t <= 3000 ? Math.round(t) : null;
  const n = Number(b.number);
  const number = b.number != null && Number.isFinite(n) ? Math.min(MAX_RESULTS, Math.max(1, Math.round(n))) : DEFAULT_RESULTS;
  return { ok: true, req: { action: 'search', slot: b.slot as WireSlot, diet: b.diet as WireDiet, avoid, query, targetKcal, number } };
}

/**
 * How far either side of a slot's calories a dish may sit and still be offered.
 *
 * src/lib/meals.ts portions a dish in quarter servings from a half upwards, so
 * a dish at 45% of the slot is served doubled and one at 180% is served as a
 * half and both land near the target. Outside that band the portion is either
 * silly or impossible, and those are the dishes this removes.
 */
export const KCAL_BAND = { low: 0.45, high: 1.8 } as const;

/**
 * The query string for `recipes/complexSearch`, WITHOUT the key.
 *
 * The key goes in the `x-api-key` header (their docs allow either), because a
 * URL is what gets written to logs and error reports and a header is not.
 *
 * Everything is asked for in the one call — see point 1 in the header for the
 * arithmetic. `fillIngredients` is what brings `extendedIngredients` and with
 * it the supermarket aisle the grocery list is grouped by.
 * `instructionsRequired` keeps out the dishes that are a photograph and a link.
 */
export function searchParams(req: RecipeSearchRequest): Record<string, string> {
  const p: Record<string, string> = {
    type: typeParam(req.slot),
    number: String(req.number),
    instructionsRequired: 'true',
    addRecipeInformation: 'true',
    addRecipeInstructions: 'true',
    addRecipeNutrition: 'true',
    fillIngredients: 'true',
  };
  if (req.query) p.query = req.query;
  const diet = dietParam(req.diet);
  if (diet) p.diet = diet;
  const intolerances = intolerancesParam(req.avoid);
  if (intolerances.length) p.intolerances = intolerances.join(',');
  // A nutrient filter adds a WHOLE point to the search, roughly doubling it.
  // It is only set when the caller sent a target, so a screen that would
  // rather spend the point on a second search leaves `targetKcal` off.
  if (req.targetKcal != null) {
    p.minCalories = String(Math.round(req.targetKcal * KCAL_BAND.low));
    p.maxCalories = String(Math.round(req.targetKcal * KCAL_BAND.high));
  }
  return p;
}

/** The same request in the same words, whoever sent it — the cache key, and
 *  deliberately nothing about the caller in it. */
export function requestKey(req: RecipeRequest): string {
  if (req.action === 'detail') return `detail|${req.id}`;
  return ['search', req.slot, req.diet, [...req.avoid].sort().join('+'), req.query.toLowerCase(), req.targetKcal ?? '', req.number].join('|');
}

// ── the trimmed payload ─────────────────────────────────────────────────────

export interface RecipeIngredientWire {
  name: string;
  /** For the WHOLE recipe, not a serving — as Spoonacular gives it. Null when
   *  they gave none ("salt, to taste"); never 0 for an absent amount. */
  amount: number | null;
  unit: string;
  /** The same quantity in metric, when they computed one. */
  metricAmount: number | null;
  metricUnit: string;
  /** Their supermarket aisle, e.g. "Milk, Eggs, Other Dairy". Null when the
   *  ingredient came from the nutrition block, which carries no aisle. */
  aisle: string | null;
}

export interface RecipeWire {
  id: number;
  title: string;
  image: string | null;
  readyInMinutes: number | null;
  servings: number | null;
  /** Per serving. Each one a number or NULL — a dish whose nutrition was not
   *  computed is not a dish with no calories. */
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: RecipeIngredientWire[];
  steps: string[];
  /** The original publisher's page, and failing that Spoonacular's page for the
   *  dish. The hyperlink half of the credit the terms require. */
  sourceUrl: string | null;
  /** The original publisher's name. The other half. */
  creditsText: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const httpsUrl = (v: unknown): string | null => {
  const s = str(v);
  // Their older records carry `http://` links. A source link somebody taps is
  // kept as it is; an IMAGE the app loads is upgraded in `trimRecipe`, because
  // iOS refuses a plain-http image and their image host answers on both.
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
};

function nutrient(raw: Record<string, unknown>, name: string): number | null {
  const list = (raw.nutrition as { nutrients?: unknown } | undefined)?.nutrients;
  if (!Array.isArray(list)) return null;
  for (const n of list) {
    if (n && typeof n === 'object' && str((n as Record<string, unknown>).name).toLowerCase() === name) {
      return num((n as Record<string, unknown>).amount);
    }
  }
  return null;
}

function ingredientsOf(raw: Record<string, unknown>): RecipeIngredientWire[] {
  const ext = raw.extendedIngredients;
  const fromNutrition = (raw.nutrition as { ingredients?: unknown } | undefined)?.ingredients;
  const list = Array.isArray(ext) && ext.length ? ext : Array.isArray(fromNutrition) ? fromNutrition : [];
  const out: RecipeIngredientWire[] = [];
  for (const i of list) {
    if (!i || typeof i !== 'object') continue;
    const r = i as Record<string, unknown>;
    const name = str(r.nameClean) || str(r.name) || str(r.originalName);
    if (!name) continue;
    const metric = (r.measures as { metric?: Record<string, unknown> } | undefined)?.metric;
    out.push({
      name,
      amount: num(r.amount),
      unit: str(r.unit),
      metricAmount: metric ? num(metric.amount) : null,
      metricUnit: metric ? str(metric.unitShort) : '',
      aisle: str(r.aisle) || null,
    });
  }
  return out;
}

function stepsOf(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const analyzed = raw.analyzedInstructions;
  if (Array.isArray(analyzed)) {
    for (const block of analyzed) {
      const steps = (block as { steps?: unknown } | null)?.steps;
      if (!Array.isArray(steps)) continue;
      for (const s of steps) {
        const text = str((s as { step?: unknown } | null)?.step);
        if (text) out.push(text);
      }
    }
  }
  if (out.length) return out;
  // The unanalysed method is one string, often HTML (`<ol><li>…`). Split on the
  // markup and on line breaks; a method that survives as one long paragraph is
  // still a method, and is kept as one step rather than thrown away.
  const flat = str(raw.instructions);
  if (!flat) return [];
  return flat.replace(/<\/(li|p|ol|ul)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .split(/\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * One Spoonacular recipe, cut down to what Repple draws. Null when it is not a
 * recipe at all (no id, or no title) — which the caller COUNTS, never drops
 * silently.
 *
 * Everything else they send — price, wine, scores, their own diet badges, the
 * per-ingredient nutrient tables that make a raw result some 40 KB — stops
 * here. Less on the wire, and less of theirs held in a phone's memory.
 */
export function trimRecipe(raw: unknown): RecipeWire | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = num(r.id);
  const title = str(r.title);
  if (id == null || !Number.isInteger(id) || id <= 0 || !title) return null;
  const image = httpsUrl(r.image);
  const servings = num(r.servings);
  const ready = num(r.readyInMinutes);
  return {
    id,
    title,
    image: image ? image.replace(/^http:/i, 'https:') : null,
    readyInMinutes: ready != null && ready > 0 ? Math.round(ready) : null,
    servings: servings != null && servings > 0 ? servings : null,
    kcal: nutrient(r, 'calories'),
    protein: nutrient(r, 'protein'),
    carbs: nutrient(r, 'carbohydrates'),
    fat: nutrient(r, 'fat'),
    ingredients: ingredientsOf(r),
    steps: stepsOf(r),
    sourceUrl: httpsUrl(r.sourceUrl) ?? httpsUrl(r.spoonacularSourceUrl),
    creditsText: str(r.creditsText) || str(r.sourceName) || null,
  };
}

export interface RecipeSearchWire {
  recipes: RecipeWire[];
  /** How many dishes match in their catalogue, when they said. */
  total: number | null;
  /** Results that came back and were not recipes this could read. Named, so a
   *  screen can say "8 of 10" rather than showing eight as though it were all. */
  unreadable: number;
}

/**
 * A `complexSearch` answer, trimmed — or a refusal to read it.
 *
 * `{ results: [] }` is a search that worked and matched nothing. A body with no
 * `results` list is NOT that: it is an answer of the wrong shape, and turning it
 * into an empty list would tell somebody no recipe exists for what they typed
 * when the truth is that nothing was read.
 */
export function trimSearch(body: unknown): { ok: true; value: RecipeSearchWire } | { ok: false } {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return { ok: false };
  const recipes: RecipeWire[] = [];
  let unreadable = 0;
  for (const r of results) {
    const t = trimRecipe(r);
    if (t) recipes.push(t); else unreadable++;
  }
  return { ok: true, value: { recipes, total: num((body as { totalResults?: unknown }).totalResults), unreadable } };
}

// ── what the function says when it cannot answer ────────────────────────────

/** Every refusal the function makes, by name. The client switches on these
 *  (src/lib/recipes.ts `readRecipeReply`) and never on a sentence. */
export type RecipeErrorCode =
  | 'recipes_not_configured'   // 503 — the owner has not set the secret
  | 'recipes_key_refused'      // 503 — Spoonacular refused the key that is set
  | 'recipes_quota_spent'      // 503 — the day's points are gone (free plan: 402)
  | 'recipes_rate_limited'     // 429 — THIS person has searched too often
  | 'recipes_busy'             // 429 — Spoonacular's per-second limit
  | 'recipes_upstream'         // 502 — they answered with an error
  | 'recipes_unreadable'       // 502 — they answered, not in a shape this reads
  | 'recipes_unreachable'      // 502 — no answer at all
  | 'recipes_not_found'        // 404 — detail for an id they do not have
  | 'auth_unreachable'         // 503 — could not check who is asking
  | 'signed_out'               // 401
  | 'bad_request';             // 400

/**
 * Spoonacular's HTTP status as Repple's refusal.
 *
 * 401 and 403 are a key problem, which is the OWNER's to fix and is said apart
 * from "not configured" so the owner is not sent to set a secret that is
 * already set. 402 is the free plan's "quota used up"; 429 is their per-second
 * limit. None of them is retried here — a retry against a spent quota spends
 * nothing and a retry against a per-second limit makes it worse.
 */
export function upstreamRefusal(status: number): { status: number; code: RecipeErrorCode } {
  if (status === 401 || status === 403) return { status: 503, code: 'recipes_key_refused' };
  if (status === 402) return { status: 503, code: 'recipes_quota_spent' };
  if (status === 429) return { status: 429, code: 'recipes_busy' };
  if (status === 404) return { status: 404, code: 'recipes_not_found' };
  return { status: 502, code: 'recipes_upstream' };
}

// ── one person's share of the quota ─────────────────────────────────────────

/** Searches one person may make in a minute, and in a day. Typing a query is
 *  debounced on the client, so twelve a minute is somebody searching hard, not
 *  somebody typing; sixty a day is more than a week's planning. At 1.9 points a
 *  search, sixty is also more than the free plan's whole day — the daily figure
 *  exists for the paid plans, where the overrun is billed rather than refused. */
export const RATE = { perMinute: 12, perDay: 60 } as const;

/**
 * A sliding window over one person's recent requests.
 *
 * Pure, so it is tested; the function keeps the timestamps. `hits` comes back
 * pruned to the last day whether or not this request was allowed, and a refused
 * request is NOT added — being told to wait does not extend the wait.
 */
export function rateWindow(hits: readonly number[], now: number, limits: { perMinute: number; perDay: number } = RATE):
  { allowed: boolean; hits: number[]; retryAfterS: number } {
  const DAY = 86_400_000, MINUTE = 60_000;
  const kept = hits.filter((t) => now - t < DAY && t <= now);
  const lastMinute = kept.filter((t) => now - t < MINUTE);
  if (kept.length >= limits.perDay) {
    return { allowed: false, hits: kept, retryAfterS: Math.max(1, Math.ceil((kept[0] + DAY - now) / 1000)) };
  }
  if (lastMinute.length >= limits.perMinute) {
    return { allowed: false, hits: kept, retryAfterS: Math.max(1, Math.ceil((lastMinute[0] + MINUTE - now) / 1000)) };
  }
  return { allowed: true, hits: [...kept, now], retryAfterS: 0 };
}
