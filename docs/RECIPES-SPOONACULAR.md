# Recipes from Spoonacular

A real recipe library behind the Meals list: photographed dishes with nutrition,
ingredients and a method, beside the dishes `src/lib/meals.ts` assembles from
component pools (which have honest macros and no photograph).

Written 19 Sep 2026 against spoonacular.com/food-api/docs, /terms and /pricing.
Re-read those three pages before changing anything that touches quota, caching
or attribution; the comments in the code quote the clauses they depend on.

## How it fits together

```
Meals list / coach's Nutrition Plan
  └─ src/ui/useRecipeSearch.ts        when to ask: debounced, cancellable, no retries
       └─ supabase.functions.invoke('recipes')
            └─ supabase/functions/recipes/index.ts   holds the key; auth; rate limit; trims
                 └─ api.spoonacular.com  (x-api-key header, never a URL parameter)
       └─ src/lib/recipes.ts           what the answer means: rows, portions, allergen re-check
            └─ src/lib/recipeWire.ts   shared by both sides: params, trimmed payload, error codes
```

- **The key never reaches the app.** It exists only as the edge function secret
  `SPOONACULAR_API_KEY`. There is no `EXPO_PUBLIC_*` for this feature and there
  must never be one — `npm run -s check:inlined-env` guards it.
- **Signed-in users only**, checked the way `nutrition-parse` checks it (a
  dropped connection to the auth server is a 503, not "sign in").
- **What Spoonacular receives:** diet, excluded allergens, meal type, an
  optional calorie band, and the words typed in the search box. No user id,
  name, email or IP. `web/privacy.html` says so under "Services we rely on", and
  `npm run -s check:site-claims` fails if the host is contacted without being
  named there.
- **The remote allergen filter is never trusted alone.** Every dish is re-read
  by `mealAllergens` (the matcher the generated dishes go through) and one that
  slipped through arrives with `flagged: Allergen[]` — draw the same "Contains
  …" mark the generated rows carry.

## Turning it on (the owner runs these; nobody else handles the key)

```sh
supabase secrets set SPOONACULAR_API_KEY=… --project-ref phgfwzpkkwdysftlgkoq
supabase functions deploy recipes --project-ref phgfwzpkkwdysftlgkoq
```

Replace `…` with the key from the Spoonacular console (spoonacular.com/food-api/console).
Do not paste it into a file, a chat, a commit or an `.env` the app reads. Order
does not matter: deployed without the secret, the function answers every request
with `503 { "error": "recipes_not_configured" }` and the app draws the generated
dishes alone, saying the library is not switched on yet.

To check it without the app (your own session token, not the anon key):

```sh
curl -s -X POST "https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/recipes" \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"action":"search","slot":"Dinner","diet":"vegetarian","avoid":["nuts"],"query":"curry","number":3}'
```

Optional, and only with Spoonacular's written permission (see Caching):

```sh
supabase secrets set SPOONACULAR_CACHE_PERMITTED=true --project-ref phgfwzpkkwdysftlgkoq
```

## The API

`POST /functions/v1/recipes`

| Body | Answer (200) |
| --- | --- |
| `{ action: 'search', slot, diet, avoid[], query?, targetKcal?, number? }` | `{ recipes: RecipeWire[], total, unreadable }` |
| `{ action: 'detail', id }` | `{ recipe: RecipeWire }` |

`RecipeWire`: `id, title, image, readyInMinutes, servings`, per-serving
`kcal/protein/carbs/fat` (each a number or **null**, never 0 for absent),
`ingredients[{ name, amount, unit, metricAmount, metricUnit, aisle }]` (amounts
for the whole recipe), `steps[]`, `sourceUrl`, `creditsText`.

Mapping: diet `meat` → none, `vegetarian`/`vegan`/`paleo` → same, `keto` →
`ketogenic`. Allergens → `intolerances`: dairy → Dairy, gluten → Gluten, **nuts →
Tree Nut + Peanut**, shellfish → Shellfish, egg → Egg, soy → Soy. Slot → `type`:
Breakfast → breakfast, Snack → snack, Lunch and Dinner → main course. An
unrecognised diet, slot or allergen is a 400, never a silent default.

Refusals are `{ error: <code>, retryAfterS? }`:

| Code | HTTP | Means | The app shows |
| --- | --- | --- | --- |
| `recipes_not_configured` | 503 | secret not set | not-configured |
| `recipes_key_refused` | 503 | Spoonacular 401/403 on the key that is set | not-configured (logs tell the owner which) |
| `recipes_quota_spent` | 503 | Spoonacular 402: the day's points are gone | limited / quota |
| `recipes_rate_limited` | 429 | this person: 12 a minute, 60 a day | limited / you |
| `recipes_busy` | 429 | Spoonacular's per-second limit | limited / busy |
| `recipes_upstream`, `recipes_unreachable`, `auth_unreachable` | 502/503 | | error / unreachable |
| `recipes_unreadable` | 502 | answered in a shape this cannot read | error / unreadable |
| `recipes_not_found` | 404 | `detail` for an id they no longer have | gone |
| `signed_out`, `bad_request` | 401/400 | | error |

An empty `recipes` list is a search that worked and matched nothing. It is never
what a failure looks like, on either side of the wire.

## Quota

Spoonacular charges **points**, not calls; the day resets at midnight UTC.

| Call | Points |
| --- | --- |
| `complexSearch` | 1 + 0.01 per result |
| …with `addRecipeInformation`, `addRecipeInstructions`, `addRecipeNutrition`, `fillIngredients` | + 0.025 per result, each |
| …with any nutrient filter (`minCalories`/`maxCalories`) | + 1 |
| `recipes/{id}/information` with nutrition | 1.1 |

So the function asks for everything in the one search: eight dishes cost
1 + 8 × 0.11 = **1.88 points**, and opening any of them costs nothing more. The
same eight as a bare search plus a detail call each would be 9.9. Sending
`targetKcal` adds a whole point (2.88) — worth it when the slot's calories are
known, skippable when browsing.

Plans, from their pricing page: **Free — 50 points a day, 1 request a second,
backlink required, hard stop (402).** Cook $29/mo — 1,500 a day, then $0.005 a
point. Culinarian $79/mo — 4,500. **Paid plans bill the overrun instead of
refusing it**, so the limits below protect money, not only a quota.

Fifty points is about twenty-five searches a day across every member of every
coach. The free plan is for building and testing this; a launch needs Cook at
least.

What holds spending down:

- the hook asks nothing until a screen opens the recipe search; typing is
  debounced 500 ms; one or two letters are not a search; the same search is not
  repeated; **no automatic retries**; a spent quota is remembered until midnight
  UTC and "not configured" for the session, so neither is asked about again;
- the function limits each person to 12 searches a minute and 60 a day. That
  count is **in the isolate's memory** — a brake on a loop or a held-down key,
  not a ledger, because Supabase runs several isolates and recycles them. If
  usage on a paid plan ever makes a durable per-user count worth having, it is a
  small table (`user_id, day, count`) and an `rpc` increment in the function;
  it was left out because it needs a migration and this lane does not write to
  Supabase;
- each successful call logs `recipes: search spent 1.88 points, 41.2 left today`
  (from the `X-API-Quota-*` headers) — figures only, never the key.

## Caching and storage — what the terms allow

> You may not … copy or store the information it provides, including any derived,
> hashed, or transformed data. With prior written permission from spoonacular, you
> may cache user-requested data to improve performance (for a maximum of 1 hour).
> … You can indefinitely store the recipe id, the recipe title, and the recipe
> image url.

So:

- The function writes to **no table**. Its one-hour in-memory cache is **off**
  unless the owner has that written permission and sets
  `SPOONACULAR_CACHE_PERMITTED=true`.
- The app keeps results in React state only — nothing in AsyncStorage, nothing in
  the database.
- **A recipe somebody plans is persisted as a `RecipeRef` and nothing else**:
  `{ source: 'spoonacular', sourceId, title, image }`, via `recipeRef(meal)` /
  `readRecipeRef(stored)`. Not its macros, not its ingredients. It is read again
  with `useRecipeDetail(sourceId, ctx)` (1.1 points) when opened. The privacy
  page already tells members this is how it works.
- If Repple stops using Spoonacular, or access is suspended, the terms require
  deleting everything obtained from it — which, kept to the above, is the refs.

## Attribution and disclaimer

- **Credit the original publisher, by name with a hyperlink**, "in the same
  manner" Spoonacular does. Every `RecipeMeal` carries
  `credit: { name, url } | null`; render it on the recipe sheet as a link
  ("Recipe from A Test Kitchen").
- **Backlink**: required on the free plan. `RECIPE_ATTRIBUTION` (`text`, `url`)
  is exported from `src/lib/recipes.ts`; render it once under any list of recipe
  results, as a link, on every plan. Words only — the terms forbid using their
  brand or logo to promote the app, so keep it out of store listings and
  marketing.
- **Disclaimer**: the terms make it Repple's job to disclaim allergen and
  nutrition inaccuracies. `RECIPE_DISCLAIMER` goes on the recipe sheet, beside
  the figures.
- If a publisher asks for a recipe to be removed, the terms make it Repple's
  responsibility to tell Spoonacular.

## How the screens consume it

The member's Meals list is wired (below, "As built"); the coach's Nutrition Plan
is not, and what it needs first is at the end of this section. The sketch that
follows is the design both were built to.

**As built — `app/(client)/nutrition.tsx`.**

- *Entry.* "Search Real Recipes" under the slot's search field sets
  `recipeSearchOpen`; the hook gets `null` until then, and again after a change
  of slot or of meals-per-day, so mounting the tab spends nothing. The search
  `targetKcal` is the generated lead's `K` rounded to 50 (so swapping between
  near-equal dishes is not a new search); rows are portioned to the exact `K`.
- *Rows.* One `mealRow` draws both kinds. Rows are told apart by `sameDish` /
  `dishKey` (`sourceId` for a recipe, `idx` otherwise) — never by `idx` alone,
  which is -1 on every recipe. The allergen mark on a recipe is
  `recipeAllergens(m, c.avoid)`: the same re-check `flagged` came from, asked
  again with today's exclusions.
- *Planned recipes.* `src/lib/recipePlan.ts` keeps `{ pos → RecipeRef }` under
  `repple.recipePlan:<uid>` — the ref and nothing else, in both directions.
  `todayPlan` is `plan` with a planned recipe standing in at its position once
  its dish is in hand: either the dish the member just chose out of a search
  (held in state, so choosing costs no second read) or a `PlannedRecipeRead`
  (one `useRecipeDetail` per planned recipe, 1.1 points, once per mount of the
  tab). Until that read is whole the generated row stays and the list says which
  recipe it is waiting for, or could not read, with "Try Again" and "Back to
  Plan's Meal".
- *The door on `-1`.* The sheet branches on `isRecipeMeal` before any button is
  built: a recipe goes to `planRecipe`/`unplanRecipe`, and `choose` and `swap`
  refuse anything that is not a non-negative integer as a second lock.
  Catalogue arithmetic (`slotOptions`' stride and `mealAt`) reads `genSlotMeals`
  — the engine's rows — never `slotMeals`, whose lead may be a recipe.
- *Reach.* A planned recipe replaces TODAY'S row only. This Week, the Grocery
  List and the shared plan document are still composed by `planWeek`/`buildPlan`
  from catalogue indices, and the list says so in one caption whenever a recipe
  is in the plan. Carrying it further means choosing which day of the synthetic
  week holds it, shopping `unmeasured` ingredients, marking `recipeAllergens` in
  `weekAllergens`, and gating the week's figures on every detail read being
  whole.

**Meals list (the design).** The rows under the slot segments come
from `slotOptions` (generated dishes from `searchMeals`/`mealAt`, portioned to
the lead row's servings), filtered by `mealQuery` for the selected `slotSel`.
Feed recipes into that same list:

```tsx
const lead = slotMeals[0];
const recipes = useRecipeSearch(recipeSearchOpen && slotSel && lead
  ? { slot: slotSel, diet, avoid: c.avoid, query: mealQuery, targetKcal: lead.K, number: 8 }
  : null);
const found = recipes.result;
const recipeRows = found && (found.status === 'ready' || found.status === 'partial')
  ? found.meals.map((m) => portionRecipe(m, lead.K, lead.pos))   // PlannedRecipe: a PlannedMeal
  : [];
// rows: [...slotMeals, ...slotOptions, ...recipeRows]   key: isRecipeMeal(m) ? `r${m.sourceId}` : m.idx
// thumbnail: m.image ? <GuardedImage source={{ uri: m.image }} contentFit="cover" cachePolicy="memory" /> over the {m.ico} tile : the {m.ico} tile
//            (memory, not disk: the terms let the image URL be kept, and say nothing that lets the bytes be)
// mark:      isRecipeMeal(m) ? m.flagged : mealAllergens(m, c.avoid)   (same "Contains …" line)
// under the list:
//   found?.status === 'partial'        → `${found.dropped} recipes could not be read and are not listed.`
//   found?.status === 'not-configured' → nothing, or found.message as a caption; generated rows stand alone
//   found?.status === 'limited'|'error'→ <Notice>{found.message}</Notice> + Ghost "Try Again" → recipes.refresh
//   found?.status === 'ready' && !recipeRows.length → "No recipes matched." (the only honest empty)
//   always, when recipeRows.length     → RECIPE_ATTRIBUTION as a link
// recipe sheet (setRecipe(m)): m.steps, m.ing, m.unmeasured, m.credit link, RECIPE_DISCLAIMER
```

Three things the wiring must respect:

1. **`idx` is -1 on a recipe.** `choose(pos, idx)`, `swapIndex`, `mealAt` and the
   `mealOverride` map are catalogue-index machinery and must never be handed
   one. Choosing a recipe for a slot needs its own map — `Record<pos, RecipeRef>`
   beside the account-scoped meal swaps (`src/lib/mealSwaps.ts` is the pattern) —
   and the plan row at that `pos` is then
   `portionRecipe(detail.meal, plan[pos].K, pos)` once `useRecipeDetail` has
   read it, and the generated row until it has (or if it fails: a failed read is
   not an empty slot).
2. **Gate figures with `recipeLoadStatus(result)` and `isWhole`.** A day total
   that includes a planned recipe is only whole when that recipe's detail read is.
3. **`recipeSearchOpen`** should be a deliberate act (a "Recipes" segment or the
   search box gaining focus), not the tab mounting. Every search is ~2 points.

**Coach's Nutrition Plan.** The meal picker modal (`pick = { pos, slot }`, rows
from `searchMeals(profile.diet, pick.slot, query, 30, profile.avoid)`) takes the
same hook with the CLIENT's `profile.diet` and `profile.avoid`, and
`targetKcal` = the `K` of the row being replaced. What the coach saves for the
client must be the `RecipeRef` — the plan column may hold `{ pos → RecipeRef }`
beside `mealOverride`, never the recipe's figures — and the client's screen
rehydrates it as above. That is a schema change and was not made here.

## Verifying

```sh
npx tsc --noEmit -p tsconfig.json
npm run -s check:functions && npm run -s check:inlined-env && npm run -s check:site-claims
npx tsc -p tsconfig.test.json && node .tmp/lib/recipes.test.js
```
