// ── The hook the Meals list and the coach's Nutrition Plan search recipes with ─
//
// `supabase.functions.invoke('recipes', …)` and nothing else: the Spoonacular
// key lives in that function's secrets and this file could not reach
// Spoonacular if it wanted to. What the answer MEANS is decided in
// src/lib/recipes.ts (`readRecipeReply`), which is pure and tested; this file
// is only WHEN to ask, and it is written around one fact —
//
// EVERY REQUEST SPENDS POINTS. A search is about two of them, and this account
// moved to the Cook plan on 20 Sep 2026 — 1,500 a day for every member of every
// coach put together. The ceiling went up thirty-fold and the stakes went up
// with it: the free plan REFUSED a request past the limit, and this one BILLS
// it at $0.005 a point. Nothing below is a quota brake any more; it is all
// spending. So:
//
//  · Nothing is asked until a screen passes params. Mounting the Meals list
//    costs nothing; opening the recipe search does.
//  · Typing is debounced, and one or two letters are not a search — "ch" costs
//    the same two points as "chicken traybake" and answers a question nobody
//    asked.
//  · The same search is not made twice in a row. A re-render, a focus event or
//    a parent that rebuilds its params object every render arrives here as the
//    same key and is ignored.
//  · THERE ARE NO RETRIES. A failed search stays failed until a person taps
//    `refresh`. A retry against a spent quota cannot succeed, one against a
//    per-second limit makes it worse, and one against a flaky connection
//    spends points on answers nobody receives.
//  · A refusal that will not change is remembered for as long as it will not
//    change — see `gate` — so a screen that mounts ten times does not ask ten
//    times whether the key has been set.
//  · A superseded request is aborted. That tidies the client and stops a stale
//    answer landing on a newer query; it does NOT refund the points, which is
//    why the debounce above is the real protection and this is not.
//
// And nothing is kept. Spoonacular's terms forbid storing what it returns (see
// src/lib/recipes.ts), so results live in this hook's state and die with the
// screen. What may be persisted is a `RecipeRef`, and `useRecipeDetail` is how
// one becomes a dish again.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  readRecipeReply, readRecipeDetailReply, searchBody,
  type RecipeContext, type RecipeDetailResult, type RecipeReply, type RecipeSearchParams, type RecipeSearchResult,
} from '../lib/recipes';

/** Long enough that a word typed at an ordinary pace is one search, not five. */
const DEBOUNCE_MS = 500;
/** Below this a non-empty query is somebody still typing. An EMPTY query is a
 *  real search — "show me breakfasts for my diet" — and is allowed. */
const MIN_QUERY_CHARS = 3;

type Failure = Exclude<RecipeSearchResult, { status: 'ready' | 'partial' }>;

/**
 * A refusal that is still true, and until when.
 *
 * Module-level, so it is shared by every screen in the session: 'not-configured'
 * holds until the app restarts or a person taps refresh (the owner setting the
 * secret is the only thing that changes it, and asking costs an invocation
 * every time); a spent quota holds until midnight UTC, which is when
 * Spoonacular's docs say it resets; "you" and "busy" hold for the wait the
 * function named. Nothing about the person is in here, so it needs no clearing
 * on sign-out.
 */
let gate: { until: number; failure: Failure } | null = null;

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function shut(failure: Failure, now: number) {
  if (failure.status === 'not-configured') gate = { until: Infinity, failure };
  else if (failure.status === 'limited') {
    const until = failure.why === 'quota' ? nextUtcMidnight(now)
      : now + Math.max(5, failure.retryAfterS ?? 30) * 1000;
    gate = { until, failure };
  }
}

function gated(now: number): Failure | null {
  if (gate && now >= gate.until) gate = null;
  return gate ? gate.failure : null;
}

/** One call, one reply, no second attempt. */
async function invoke(body: Record<string, unknown>, signal: AbortSignal): Promise<RecipeReply> {
  try {
    const { data, error } = await supabase.functions.invoke('recipes', { body, signal });
    if (error) {
      // A non-2xx arrives as an error whose `context` is the Response. Its body
      // carries the function's named refusal; with no body, nothing answered.
      let refused: unknown = null;
      try { refused = await (error as { context?: { json?: () => Promise<unknown> } })?.context?.json?.(); } catch { /* no body: nothing answered */ }
      return { answered: refused != null, ok: false, body: refused };
    }
    return { answered: data != null, ok: true, body: data };
  } catch {
    return { answered: false, ok: false, body: null };
  }
}

function keyOf(p: RecipeSearchParams): string {
  return JSON.stringify(searchBody(p));
}

export interface RecipeSearch {
  /** Null before the first answer. Never an empty list standing in for a
   *  failure — switch on `result.status`, or gate figures with
   *  `recipeLoadStatus(result)` and `isWhole`. */
  result: RecipeSearchResult | null;
  /** True from the first keystroke of a new search, debounce included, so the
   *  list can dim the old rows instead of flashing them away. */
  loading: boolean;
  /** Ask again, now. For a person's tap — it skips the debounce and the gate,
   *  and is the ONLY way a failed search is ever repeated. */
  refresh: () => void;
}

/**
 * Search the recipe library.
 *
 * Pass `null` while the search is not on screen and nothing is spent. The
 * params may be a fresh object every render; they are compared by value.
 *
 * Called by the member's Meals list (app/(client)/nutrition.tsx), behind its
 * "Search Real Recipes" row. The coach's Nutrition Plan does not call it yet:
 * what a coach saves for a client has to be a `RecipeRef`, and the plan column
 * cannot hold one — see docs/RECIPES-SPOONACULAR.md.
 */
export function useRecipeSearch(params: RecipeSearchParams | null): RecipeSearch {
  const [result, setResult] = useState<RecipeSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const answered = useRef<string | null>(null);   // the key `result` is the answer to
  const forced = useRef(false);

  const key = params ? keyOf(params) : null;
  // By value, so an inline params object does not restart the search each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => params, [key]);

  useEffect(() => {
    // `null` leaves the last answer where it is: closing the search and opening
    // it again on the same words should cost nothing, and `answered` below is
    // what makes that so.
    if (!stable || !key) { setLoading(false); return; }
    const force = forced.current;
    forced.current = false;

    const q = (stable.query ?? '').trim();
    if (q.length > 0 && q.length < MIN_QUERY_CHARS) { setLoading(false); return; }
    if (!force && answered.current === key) { setLoading(false); return; }

    const shutNow = force ? null : gated(Date.now());
    if (shutNow) { answered.current = null; setResult(shutNow); setLoading(false); return; }
    if (force) gate = null;

    setLoading(true);
    const ctx: RecipeContext = { slot: stable.slot, diet: stable.diet, avoid: stable.avoid };
    const ctl = new AbortController();
    let live = true;
    const timer = setTimeout(async () => {
      const reply = await invoke(searchBody(stable), ctl.signal);
      // Superseded or unmounted while it was out. The answer is for a question
      // nobody is asking any more, and an abort reads as "unreachable", which
      // would be a false thing to draw.
      if (!live || ctl.signal.aborted) return;
      const read = readRecipeReply(reply, ctx);
      if (read.status === 'ready' || read.status === 'partial') answered.current = key;
      else { answered.current = null; shut(read, Date.now()); }
      setResult(read);
      setLoading(false);
    }, force ? 0 : DEBOUNCE_MS);

    return () => { live = false; clearTimeout(timer); ctl.abort(); };
  }, [stable, key, tick]);

  const refresh = useCallback(() => { forced.current = true; setTick((n) => n + 1); }, []);
  return { result, loading, refresh };
}

export interface RecipeDetail { result: RecipeDetailResult | null; loading: boolean; refresh: () => void }

/**
 * One recipe, read again from its id — how a stored `RecipeRef` becomes a dish
 * with figures, ingredients and a method, since none of those may be stored.
 *
 * Costs 1.1 points each, against 0.11 for the same dish inside a search. So it
 * is for a recipe somebody OPENS from their plan, one at a time — never for
 * drawing a list of saved recipes, which is what the ref's own title and image
 * are for.
 *
 * Called once per PLANNED recipe by `PlannedRecipeRead` in the Meals list, and
 * only for one whose dish is not already in memory from the search it was
 * chosen out of.
 */
export function useRecipeDetail(sourceId: number | null, ctx: RecipeContext): RecipeDetail {
  // The REPLY is what is held, not the dish. The flags on a dish depend on the
  // member's exclusions, and re-reading a reply already in hand when those
  // change is free where asking again is another 1.1 points.
  const [reply, setReply] = useState<{ id: number; reply: RecipeReply } | null>(null);
  const [shutOut, setShutOut] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const forced = useRef(false);

  useEffect(() => {
    setShutOut(null);
    if (sourceId == null) { setReply(null); setLoading(false); return; }
    const force = forced.current;
    forced.current = false;
    const shutNow = force ? null : gated(Date.now());
    if (shutNow) { setReply(null); setShutOut(shutNow); setLoading(false); return; }
    if (force) gate = null;

    const ctl = new AbortController();
    let live = true;
    setLoading(true);
    (async () => {
      const got = await invoke({ action: 'detail', id: sourceId }, ctl.signal);
      if (!live || ctl.signal.aborted) return;
      setReply({ id: sourceId, reply: got });
      setLoading(false);
    })();
    return () => { live = false; ctl.abort(); };
  }, [sourceId, tick]);

  const avoidKey = [...ctx.avoid].sort().join('+');
  const result = useMemo<RecipeDetailResult | null>(() => {
    if (shutOut) return shutOut;
    if (!reply || reply.id !== sourceId) return null;
    return readRecipeDetailReply(reply.reply, { slot: ctx.slot, diet: ctx.diet, avoid: ctx.avoid, measures: ctx.measures });
    // `ctx.avoid` by value — a fresh array each render is the same exclusions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply, shutOut, sourceId, ctx.slot, ctx.diet, ctx.measures, avoidKey]);

  // A refusal that will hold is remembered for the other screens too.
  useEffect(() => {
    if (result && (result.status === 'not-configured' || result.status === 'limited') && result !== shutOut) shut(result, Date.now());
  }, [result, shutOut]);

  const refresh = useCallback(() => { forced.current = true; setTick((n) => n + 1); }, []);
  return { result, loading, refresh };
}
