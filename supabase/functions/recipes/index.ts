// Supabase Edge Function: recipes
// A real recipe library behind the Meals list: photographed dishes with
// nutrition, ingredients and a method, from Spoonacular. Deploy:
//   supabase functions deploy recipes --project-ref phgfwzpkkwdysftlgkoq
//   supabase secrets set SPOONACULAR_API_KEY=… --project-ref phgfwzpkkwdysftlgkoq
// The app calls it via supabase.functions.invoke('recipes', { body }) from
// src/ui/useRecipeSearch.ts. docs/RECIPES-SPOONACULAR.md is the long version.
//
// Request JSON:
//   { action: 'search', slot, diet, avoid: Allergen[], query?, targetKcal?, number? }
//   { action: 'detail', id }
// Response JSON (read, 200):
//   search → { recipes: RecipeWire[], total: number|null, unreadable: number }
//   detail → { recipe: RecipeWire }
//   `RecipeWire` is src/lib/recipeWire.ts: id, title, image, readyInMinutes,
//   servings, per-serving kcal/protein/carbs/fat (each a number or NULL),
//   ingredients with amount/unit/aisle, steps, sourceUrl and creditsText.
// Response JSON (not read): { error: RecipeErrorCode, retryAfterS? } — one
//   named code per failure, listed in src/lib/recipeWire.ts. An empty `recipes`
//   is a search that WORKED and matched nothing; it is never what a failure
//   looks like.
//
// ── why this is a function at all ─────────────────────────────────────────
//
// The key. A Spoonacular key is a metered account — the Cook plan this plan is
// on allows 1,500 points a day and BILLS the overrun rather than refusing it, and
// on the paid plans every point past the allowance is BILLED — and anything in
// the app bundle is public: `EXPO_PUBLIC_*` is inlined into JavaScript anybody
// can unzip. So the key exists in exactly one place, this function's secrets,
// and scripts/check-inlined-env.mjs fails the build if that ever stops being
// true. The function reads it, spends it, and never echoes it: it travels to
// Spoonacular in the `x-api-key` header rather than the `apiKey` query
// parameter their examples use, because a URL is what ends up in a log line
// and an error report, and their error bodies are never forwarded to the app.
//
// ── signed-in users only ──────────────────────────────────────────────────
//
// For the reason written out at length in supabase/functions/coach-chat:
// `verify_jwt` proves the bearer token was signed by this project, and the
// public anon key is such a token. Without the check below anybody who unpacked
// the app could spend Repple's recipe quota with no account at all.
//
// ── what Spoonacular receives, and what it does not ───────────────────────
//
// A diet, a list of excluded allergens, a meal type, a calorie band and the
// words typed into the search box. NOT the caller's id, name, email or IP —
// the request leaves from this server — and nothing else about them. The user
// id is read here for one purpose, the rate limit, and goes nowhere.
// web/privacy.html says this in the page's own words, and
// scripts/check-site-claims.mjs fails if the host below is ever contacted
// without being named there.
//
// ── nothing is kept ───────────────────────────────────────────────────────
//
// Spoonacular's terms: "You may not … copy or store the information it
// provides, including any derived, hashed, or transformed data. With prior
// written permission from spoonacular, you may cache user-requested data to
// improve performance (for a maximum of 1 hour)." So this writes to no table,
// and the one-hour cache below is OFF unless the owner has that permission and
// says so with `SPOONACULAR_CACHE_PERMITTED=true`. It is in this isolate's
// memory only, so "delete your cache" is what happens to it anyway.
import { createClient } from 'jsr:@supabase/supabase-js@2';
// `getUser()` RESOLVES with a null user when the auth server is unreachable —
// the same shape a signed-out caller produces. src/lib/authReadFate.ts is where
// the repo writes down "refused the credential" versus "could not be asked".
import { authReadFate } from '../../../src/lib/authReadFate.ts';
import {
  readRecipeRequest, searchParams, requestKey, trimRecipe, trimSearch, upstreamRefusal, rateWindow,
  type RecipeErrorCode, type RecipeRequest,
} from '../../../src/lib/recipeWire.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });
const refuse = (code: RecipeErrorCode, status: number, more: Record<string, unknown> = {}) =>
  json({ error: code, ...more }, status, typeof more.retryAfterS === 'number' ? { 'Retry-After': String(more.retryAfterS) } : {});

const API = 'https://api.spoonacular.com';

/**
 * One person's recent requests, by user id.
 *
 * IN THIS ISOLATE'S MEMORY, and that is a real limit on what it promises:
 * Supabase runs several isolates and recycles them, so this is a brake on one
 * person hammering the search box, not a ledger. It is still the right first
 * brake — the failure it exists for is a loop in a screen or a held-down key,
 * which arrives at one warm isolate as a burst. A durable per-user count needs
 * a table and a migration; docs/RECIPES-SPOONACULAR.md says when that becomes
 * worth having. The day's hard ceiling is Spoonacular's own quota either way.
 */
const HITS = new Map<string, number[]>();

/** The permitted cache — see the header. Keyed by the request's own words and
 *  nothing about who sent it, so one member's search can answer another's. */
const CACHE = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 60 * 60 * 1000;          // the terms' maximum, not a preference
const CACHE_MAX = 200;
function cached(key: string, now: number): unknown | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (now - hit.at >= CACHE_MS) { CACHE.delete(key); return null; }
  return hit.body;
}
function remember(key: string, body: unknown, now: number) {
  // Expired entries are deleted, not left to be skipped: "after 1 hour, you
  // must delete your cache" is a sentence about the data, not about reads.
  for (const [k, v] of CACHE) if (now - v.at >= CACHE_MS) CACHE.delete(k);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, { at: now, body });
}

async function ask(key: string, req: RecipeRequest): Promise<Response> {
  const url = new URL(req.action === 'detail' ? `${API}/recipes/${req.id}/information` : `${API}/recipes/complexSearch`);
  const params = req.action === 'detail' ? { includeNutrition: 'true' } : searchParams(req);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // Ten seconds. A search somebody is watching a spinner for is not worth more,
  // and an abandoned fetch still spends the points.
  return await fetch(url, { headers: { 'x-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Before anything else, and a 503 rather than a crash: the function is
  // deployed before the owner sets the secret, and "not switched on yet" is a
  // state the Meals list has words for. It is NOT a 500 — nothing is broken.
  const key = (Deno.env.get('SPOONACULAR_API_KEY') || '').trim();
  if (!key) return refuse('recipes_not_configured', 503);

  // Signed-in users only — this spends a metered quota. See the header.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = '';
  try {
    const { data, error: authErr } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    if (authErr) {
      // A dropped connection to the auth server is not a signed-out person, and
      // telling a signed-in member to sign in is the one remedy that cannot help.
      if (authReadFate(authErr) === 'unreadable') return refuse('auth_unreachable', 503);
    } else {
      userId = data?.user?.id || '';
    }
  } catch { return refuse('auth_unreachable', 503); }
  if (!userId) return refuse('signed_out', 401);

  let body: unknown;
  try { body = await req.json(); } catch { return refuse('bad_request', 400, { detail: 'Invalid JSON body' }); }
  const read = readRecipeRequest(body);
  if (!read.ok) return refuse('bad_request', 400, { detail: read.error });
  const request = read.req;

  const now = Date.now();
  const cacheOn = Deno.env.get('SPOONACULAR_CACHE_PERMITTED') === 'true';
  const cacheKey = requestKey(request);
  // The cache is consulted BEFORE the rate limit: an answer already held costs
  // Spoonacular nothing, so it costs the member none of their allowance either.
  if (cacheOn) {
    const hit = cached(cacheKey, now);
    if (hit) return json(hit);
  }

  const window = rateWindow(HITS.get(userId) ?? [], now);
  HITS.set(userId, window.hits);
  if (!window.allowed) return refuse('recipes_rate_limited', 429, { retryAfterS: window.retryAfterS });

  let res: Response;
  try { res = await ask(key, request); }
  catch { return refuse('recipes_unreachable', 502); }

  if (!res.ok) {
    // Their error body is NOT forwarded. It can quote the request back, and the
    // request is the one thing here that was made with the key.
    const r = upstreamRefusal(res.status);
    return refuse(r.code, r.status, { upstreamStatus: res.status });
  }

  let raw: unknown;
  try { raw = await res.json(); } catch { return refuse('recipes_unreadable', 502); }

  let out: unknown;
  if (request.action === 'detail') {
    const recipe = trimRecipe(raw);
    if (!recipe) return refuse('recipes_unreadable', 502);
    out = { recipe };
  } else {
    // A body with no `results` list is a shape failure and a 502. It is not an
    // empty search — see `trimSearch`.
    const trimmed = trimSearch(raw);
    if (!trimmed.ok) return refuse('recipes_unreadable', 502);
    out = trimmed.value;
  }
  if (cacheOn) remember(cacheKey, out, now);
  // What the day has left, for whoever is watching the function's logs — the
  // dashboard says the same, a day later. A figure, never the key.
  const left = res.headers.get('X-API-Quota-Left');
  if (left != null) console.log(`recipes: ${request.action} spent ${res.headers.get('X-API-Quota-Request') ?? '?'} points, ${left} left today`);
  return json(out);
});
