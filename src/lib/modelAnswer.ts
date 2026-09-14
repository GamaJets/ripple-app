// What a model ANSWERED, and the named reason there is nothing usable in it.
//
// ── the distinction this exists to keep ───────────────────────────────────
//
// src/lib/llmGateway.ts already separates the three ways a model can fail to
// REPLY — truncated, empty, unreadable — and its header says why: the three
// callers "used to collapse every failure into one fallback", so a member acting
// on half a training instruction read it as the model having nothing to say.
//
// This file is the same argument one layer in. A reply that arrived is not yet
// an answer, and the two edge functions that put a member's own words and a
// member's own photograph in front of a model each had a single `extractJson`
// that threw, one `catch`, and one sentence:
//
//     } catch (e) {
//       return json({ error: 'Parse failed', detail: String(e) }, 500);
//     }
//
// Three different facts arrived at that line and left it as one:
//
//   1. THE MODEL ANSWERED, AND THE ANSWER IS THAT THERE IS NOTHING TO READ.
//      "I can't see any food in this image." A true, useful answer, and the
//      only one of the three the member can act on. It contains no `{`, so
//      `extractJson` threw and it was filed as a parse failure.
//   2. THE MODEL DID NOT ANSWER. Handled upstream by `readReply`, and kept
//      separate here so that a caller cannot reintroduce the collapse.
//   3. THE ANSWER DID NOT PARSE. Half an object, a trailing comma, a JSON
//      fragment inside prose. Nothing was read and nothing may be shown.
//
// A member told "parse failed" about (1) retakes a photograph of a plate the
// reader was right about. A member told nothing at all about (3) is handed a
// blank sheet and fills it in believing the reader simply found nothing —
// which is the shape that ends with an invented figure in a food log and in
// the macros a coach reads.
//
// ── and the zero that is not a figure ─────────────────────────────────────
//
// `numberOrNull` is here rather than in each function because both had the
// same latent `?? 0`. src/lib/foodAI.ts records what that cost on the app
// side: "a model that returned calories and nothing else therefore recorded a
// ZERO-PROTEIN meal — which then fed the remaining-macro figures a member eats
// the rest of their day against." A zero is a measurement. An absence is not,
// and the two are not interchangeable at either end of this wire.
//
// So a figure the model did not give comes back null AND is NAMED in
// `notGiven`, because a null the caller silently skips is only a quieter
// version of the same collapse.
//
// ── this is a LEAF, deliberately ──────────────────────────────────────────
//
// Two edge functions import it, so it may have NO relative imports of its own:
// Deno resolves a specifier literally and an extensionless one throws on the
// function's first request. scripts/check-functions.mjs walks out of the
// functions into here and enforces exactly that. It also does no I/O, so every
// rule below is asserted by src/lib/modelAnswer.test.ts under plain node.

/** Why there is no readable object in an answer that did arrive. */
export type UnreadableAnswer = 'no-json' | 'unparseable' | 'not-an-object';

/**
 * An object the model returned, or the named reason there isn't one.
 *
 * Deliberately not `any | null`, and deliberately not a throw. A throw is what
 * both functions had, and a throw has one landing place however many different
 * things jumped off it.
 */
export type ModelJson =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; why: UnreadableAnswer };

/**
 * Read the JSON object out of a model's answer.
 *
 * Same first-brace-to-last-brace span both functions used — that part was
 * right, and `stripThinking` upstream is what makes it safe — but the three
 * ways it can come to nothing are now three values rather than one exception.
 *
 * `no-json` is the one that carries information: the model answered in prose,
 * and for a vision or a food-description ask the prose is usually the answer
 * ("there is no food in this image"). The caller is expected to say so.
 */
export const readModelJson = (text: unknown): ModelJson => {
  const s = typeof text === 'string' ? text : '';
  const a = s.indexOf('{');
  // No brace anywhere: the model answered in words. That is the case worth
  // keeping separate from the other two — see the header.
  if (a === -1) return { ok: false, why: 'no-json' };
  const b = s.lastIndexOf('}');
  // An object was BEGUN and never closed. Upstream `readReply` names a reply
  // the provider flagged as cut off; this is the same damage arriving without
  // the flag, and it is malformed rather than prose.
  if (b < a) return { ok: false, why: 'unparseable' };
  let parsed: unknown;
  try { parsed = JSON.parse(s.slice(a, b + 1)); }
  catch { return { ok: false, why: 'unparseable' }; }
  // `JSON.parse('{"a":1}')` is an object; `JSON.parse` of a span that happens
  // to be `{}` inside a longer array is not the shape any caller here asked
  // for. An array is typeof 'object' and is not a field bag.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, why: 'not-an-object' };
  return { ok: true, value: parsed as Record<string, unknown> };
};

/**
 * What a caller says out loud for each named reason.
 *
 * One sentence each, in the app's voice, on the model `replyProblem` sets in
 * src/lib/llmGateway.ts. Distinct strings are the whole point: two reasons
 * sharing a sentence is the collapse this file exists to undo, and the test
 * asserts they differ rather than trusting the reading.
 */
export const answerProblem = (why: UnreadableAnswer): string =>
  why === 'no-json'
    ? 'The reader answered in words rather than with figures, so there is nothing to fill in. Type it in instead.'
    : why === 'unparseable'
      ? 'The reader’s answer was malformed and none of it could be read. Nothing has been filled in — try again, or type it in.'
      : 'The reader answered with something that is not a set of figures. Nothing has been filled in — try again, or type it in.';

/**
 * A number, or null. Never a zero standing in for an absence.
 *
 * Numeric strings are accepted for the reason src/lib/vision.ts gives — models
 * stringify JSON numbers, and "76.2 kg" and "28%" both arrive — and everything
 * else is null rather than being rounded down to a figure nobody measured.
 * A non-finite number is null too: `NaN` compares false against every bound a
 * screen might check it with, and then prints.
 */
export const numberOrNull = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.\-]/g, '');
    if (!cleaned || !/[0-9]/.test(cleaned)) return null;
    const p = parseFloat(cleaned);
    return Number.isFinite(p) ? p : null;
  }
  return null;
};

/**
 * Which of the figures a prompt ASKED FOR the model did not give.
 *
 * The prompt is the list of what was requested, so a field absent from the
 * answer is a gap in a known set rather than an unknowable one — and naming it
 * is what lets the caller say "the reader did not give a protein figure"
 * instead of handing on a silent null or, worse, a zero.
 */
export const notGivenAmong = (
  value: Record<string, unknown>,
  keys: readonly string[],
): string[] => keys.filter((k) => numberOrNull(value[k]) === null);

/** Every asked-for figure, read as a number or null, keyed as it was asked. */
export const figuresAmong = (
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, number | null> => {
  const out: Record<string, number | null> = {};
  for (const k of keys) out[k] = numberOrNull(value[k]);
  return out;
};

/* ── the food half ─────────────────────────────────────────────────────── */

/** One food the reader named, with the figures it gave and the ones it did not. */
export interface NutritionItem {
  name: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The asked-for figures this item came back without. Never filled with 0. */
  notGiven: string[];
}

/**
 * What came back from a food ask.
 *
 * `ok: true` with an EMPTY `items` is a real answer and not a failure: the
 * reader read the description and named no food in it. That is the case the
 * old `Array.isArray(out.items) ? out.items : []` destroyed — a wrong SHAPE
 * came out of it looking exactly like a description with no food in it, and
 * the app cannot tell a member which of those happened.
 *
 * `unreadableItems` counts entries that were in the list and could not be read
 * as a food at all. They are counted rather than dropped, for the reason
 * src/lib/foodAI.ts gives about the items its filter used to delete: "a member
 * who described three things and was handed two of them back was never told
 * the third existed".
 */
export type NutritionRead =
  | { ok: true; items: NutritionItem[]; unreadableItems: number }
  | { ok: false; why: 'not-a-list' };

/** The figures the nutrition prompt asks for, in the order it asks for them. */
export const NUTRITION_FIGURES = ['kcal', 'protein', 'carbs', 'fat'] as const;

export const readNutritionItems = (value: Record<string, unknown>): NutritionRead => {
  const raw = value.items;
  if (!Array.isArray(raw)) return { ok: false, why: 'not-a-list' };
  const items: NutritionItem[] = [];
  let unreadable = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { unreadable++; continue; }
    const r = entry as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const figures = figuresAmong(r, NUTRITION_FIGURES);
    // A nameless entry with no figures in it is not a food the reader named,
    // it is noise in the list — counted, never shown as a blank food.
    if (!name && NUTRITION_FIGURES.every((k) => figures[k] === null)) { unreadable++; continue; }
    items.push({
      name: name || 'Food',
      kcal: figures.kcal, protein: figures.protein, carbs: figures.carbs, fat: figures.fat,
      notGiven: notGivenAmong(r, NUTRITION_FIGURES),
    });
  }
  return { ok: true, items, unreadableItems: unreadable };
};
