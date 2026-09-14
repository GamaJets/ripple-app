// Client wrapper for the nutrition-parse edge function (natural-language food).
//
// ── The zero that was not measured ─────────────────────────────────────────
//
// This coerced an absent protein, carb or fat figure to 0 with `?? 0`. A model
// that returned calories and nothing else therefore recorded a ZERO-PROTEIN
// meal — which then fed the remaining-macro figures a member eats the rest of
// their day against. A zero is a measurement; "we were not told" is not one,
// and this app does not let one stand in for the other anywhere else.
//
// The three macros are nullable now, and src/lib/foodPortion.ts refuses to
// build a loggable food out of a gap. What fills it is the member, in a box,
// which makes the figure testimony rather than an assumption by the app.
//
// ── And the flag that made the whole feature dark ──────────────────────────
//
// Availability used to be `EXPO_PUBLIC_ENABLE_VISION === '1'` alone, while the
// photo reader next door in ./vision.ts is on whenever the backend is on. Both
// call an edge function through the same client, on the same project, with the
// same failure path — so they were two answers to one question, and this was
// the pessimistic one. Worse, it is a BUILD-TIME constant: `process.env` is
// inlined by the bundler, so an OTA cannot turn it on, and "describe what you
// ate" was dark on every binary built without it while the photo reader beside
// it worked.
//
// It now agrees with `visionAvailable`, which is the only honest reading: if
// the function is reachable the feature is on, and if it is not, the call
// returns null and the screen already says so.
//
// ── And the four answers that left here as one ─────────────────────────────
//
// `parseFoodText` was `if (error || !data || (data as any).error) return null`
// followed by `if (!Array.isArray(items)) return null` and a `catch` returning
// the same. Four different facts — the reader did not answer, the answer did
// not parse, the answer was the wrong shape, and the reader read the words and
// NAMED NO FOOD IN THEM — arrived at four different lines and left by one, and
// app/(client)/foodlog.tsx then said "Could not read that" to all of them.
//
// The third of those is not a failure. It is the commonest outcome and the
// only one the member can act on: somebody who typed "a bowl of soup" and is
// shown an error learns the app is broken, while somebody told the reader
// found no food in that line learns to type differently.
//
// `nutrition-parse` has kept the four apart on the wire since Lane 129 (an
// empty `items` with a note for the read that named nothing; a `why` on each
// of the three failures). `readFoodText` below is where they land, and
// src/lib/readerAnswer.ts holds the reading of them and the four sentences.
//
// The same file also holds the kcal rule this one used to get wrong: an absent
// calorie figure became a 0 and the food was then FILTERED OUT for being worth
// nothing, so a member who described three things and got two back was never
// told the third had been read at all. Calories are nullable like the macros
// and nothing is dropped for having a gap in it.
import { supabase } from './supabase';
import { visionAvailable } from './vision';
import { readFoodReply, type FoodRead, type ReadFood } from './readerAnswer';

/**
 * One food the reader named.
 *
 * The shape itself now lives in src/lib/readerAnswer.ts, beside the rules that
 * build it, because this file imports `./supabase` and so cannot be exercised
 * under plain node. The name is kept because every screen imports it by it,
 * and it gained one field: `notGiven`, naming which of the four figures the
 * reader did not give — the list `nutrition-parse` started sending and that
 * nothing on this side could see.
 */
export type ParsedFood = ReadFood;
export type { FoodRead } from './readerAnswer';

/** AI food parsing is on exactly when the reader next door is. */
export function foodAIAvailable(): boolean {
  return visionAvailable();
}

/**
 * Ask the reader to read a description, and report WHICH of four things
 * happened.
 *
 * This is the whole of the repair. `parseFoodText` below returned `null` for
 * every one of them, so a member who typed "a bowl of soup" and a member whose
 * request never left the building read the same sentence — and the commonest
 * case by far, the reader reading the words and naming no food in them, is not
 * a failure at all. src/lib/readerAnswer.ts carries the four outcomes and the
 * four sentences; this function only does the I/O.
 *
 * `null` is the fifth thing and is deliberately not one of the four: the
 * feature is off, or the box is empty, and neither is a reader doing anything.
 * The screen already has its own words for that.
 */
export async function readFoodText(text: string): Promise<FoodRead | null> {
  if (!foodAIAvailable() || !text.trim()) return null;
  try {
    const { data, error } = await supabase.functions.invoke('nutrition-parse', { body: { text } });
    if (error) {
      // supabase-js puts the function's JSON error body on error.context (a
      // Response), which is where the `why` is. Without reading it every
      // non-2xx would be indistinguishable from no reply at all — which is
      // three of the four outcomes collapsing again, one layer lower.
      let body: unknown = null;
      try { body = await (error as any)?.context?.json?.(); } catch { /* no body: nothing answered */ }
      return readFoodReply({ answered: body != null, body });
    }
    return readFoodReply({ answered: data != null, body: data });
  } catch {
    return readFoodReply({ answered: false, body: null });
  }
}

/**
 * The foods alone, for callers that have no words for the four outcomes yet.
 *
 * An empty array is now returned where this used to return `null`: the reader
 * read the description and named no food in it, which is a read that worked.
 * Callers that test the array's length behave exactly as they did; the one
 * that wants to tell a member WHICH thing happened calls `readFoodText`.
 */
export async function parseFoodText(text: string): Promise<ParsedFood[] | null> {
  const read = await readFoodText(text);
  return read && read.ok ? read.items : null;
}
