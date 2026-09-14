// What the two readers ANSWERED, read into the shapes this app's screens use.
//
// The app-side twin of src/lib/modelAnswer.ts. That file is the leaf the two
// edge functions share; this one is the leaf the two client wrappers share, and
// it exists because the distinctions the functions now put on the wire had
// nowhere to land.
//
// ── the four answers that arrived here as one ─────────────────────────────
//
// `supabase/functions/nutrition-parse` returns four different things about one
// member typing "a bowl of soup":
//
//   the reader did not answer      502, why: truncated | empty | unreadable,
//                                  or a 500 from the function itself.
//   the answer did not parse       502, why: no-json | unparseable |
//                                  not-an-object.
//   the reader named no food       200, an EMPTY items list and a note. This is
//                                  a real answer and not a failure: the reader
//                                  read the words and named nothing in them.
//   the answer was the wrong shape 502, why: not-a-list — an answer that used
//                                  to be quietly turned into an empty list, and
//                                  so wore the third one's clothes.
//
// `src/lib/foodAI.ts` collapsed all four into `return null`, and the screen had
// one sentence for the lot: "Could not read that". The member in the third case
// — by far the most common, and the only one they can do anything about — was
// told the app was broken instead of being told to describe the meal
// differently. Every one of those four is now a value, and every one of them
// has its own sentence in FOOD_READ_SAY below.
//
// ── and the confidence nobody produced ────────────────────────────────────
//
// `src/lib/vision.ts` read a meal or a machine out of a photo with
// `confidence: toNum(r.confidence) ?? 0.6`. That is an invented figure in the
// one field whose entire job is to say how far to trust the other figures: a
// reader that offered no confidence is not a reader that was 0.6 sure. The
// prompt asks for it, `vision-analyze` reports whether it was given
// (`confidenceGiven`), and here it is a `number | null` like every other figure
// nobody supplied.
//
// There is deliberately no `confidenceGiven` field on the shapes below.
// `confidence === null` IS that fact, and carrying both would be two answers to
// one question with nothing keeping them in step — the same mistake as the two
// availability flags src/lib/foodAI.ts records in its own header.
//
// Pure: no supabase, no React, no clock. Both wrappers do the I/O and hand the
// body in here, which is what makes every rule below assertable under plain
// node in src/lib/readerAnswer.test.ts.
import { numberOrNull } from './modelAnswer';

/* ── the food half ─────────────────────────────────────────────────────── */

/**
 * Why there is no list of foods to show.
 *
 * Three values, not one, and NOT four: "the reader named no food" is a
 * successful read and lives on the `ok: true` arm with an empty `items`. Filing
 * it here as a failure is exactly the collapse this file undoes.
 */
export type FoodReadFailure = 'no-answer' | 'unreadable-answer' | 'unexpected-shape';

/** The figures the nutrition prompt asks for, in the order it asks for them. */
export const FOOD_FIGURES = ['kcal', 'protein', 'carbs', 'fat'] as const;
export type FoodFigure = typeof FOOD_FIGURES[number];

/** One food the reader named. Every figure is a number or a named absence. */
export interface ReadFood {
  name: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The asked-for figures this item came back WITHOUT. Never filled with 0. */
  notGiven: FoodFigure[];
}

/**
 * What came back from a food ask.
 *
 * `ok: true` with an empty `items` is the reader having read the description
 * and named no food in it. `unreadableItems` counts entries that were in the
 * list and could not be read as a food at all — counted rather than dropped,
 * because a member who described three things and was handed two back was
 * never told the third existed.
 */
export type FoodRead =
  | { ok: true; items: ReadFood[]; unreadableItems: number; note: string | null }
  | { ok: false; why: FoodReadFailure };

/**
 * A reply from the function, reduced to the two things this file reads.
 *
 * `answered: false` is the call never producing a body at all — no signal, a
 * throw, an error with nothing on it. It is not the same as a body that says
 * something went wrong, and the caller must not flatten the two.
 */
export interface ReaderReply {
  answered: boolean;
  body: unknown;
}

/** The `why` values `readReply` and the function's own catch put on the wire. */
const NO_ANSWER = ['truncated', 'empty', 'unreadable', 'function-failed'];
/** The `why` values `readModelJson` puts on the wire. */
const UNREADABLE_ANSWER = ['no-json', 'unparseable', 'not-an-object'];
/** The `why` value `readNutritionItems` puts on the wire. */
const UNEXPECTED_SHAPE = ['not-a-list'];

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Read a `nutrition-parse` reply.
 *
 * The order of the arms is the order of certainty. A named `why` is the
 * function telling us exactly what happened and is believed first; an `items`
 * array is a read that worked; a body that is neither — an older deploy, a
 * refusal from the door before the reader ever saw the words — is only then
 * classified, and it is classified by whether the body carries a sentence of
 * its own, because a door that refused is a reader that never answered.
 */
export const readFoodReply = (reply: ReaderReply): FoodRead => {
  if (!reply.answered) return { ok: false, why: 'no-answer' };
  const body = asObject(reply.body);
  if (!body) return { ok: false, why: 'no-answer' };

  const why = typeof body.why === 'string' ? body.why : '';
  if (UNREADABLE_ANSWER.indexOf(why) !== -1) return { ok: false, why: 'unreadable-answer' };
  if (UNEXPECTED_SHAPE.indexOf(why) !== -1) return { ok: false, why: 'unexpected-shape' };
  if (NO_ANSWER.indexOf(why) !== -1) return { ok: false, why: 'no-answer' };

  if (!Array.isArray(body.items)) {
    // A body with a sentence on it and no list is the function refusing —
    // not signed in, no provider configured, an unknown mode. Nothing reached
    // a reader, so nothing answered. A body with neither is a shape this app
    // does not know, which is the fourth case and is said as such.
    return { ok: false, why: body.error != null ? 'no-answer' : 'unexpected-shape' };
  }

  const items: ReadFood[] = [];
  let unreadableItems = 0;
  for (const entry of body.items as unknown[]) {
    const r = asObject(entry);
    if (!r) { unreadableItems++; continue; }
    const kcal = numberOrNull(r.kcal);
    const protein = numberOrNull(r.protein);
    const carbs = numberOrNull(r.carbs);
    const fat = numberOrNull(r.fat);
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    // A nameless entry with no figures in it is noise in the list rather than
    // a food the reader named — counted, never shown as a blank food.
    if (!name && kcal === null && protein === null && carbs === null && fat === null) { unreadableItems++; continue; }
    const figures: Record<FoodFigure, number | null> = { kcal, protein, carbs, fat };
    items.push({
      name: name || 'Food',
      kcal, protein, carbs, fat,
      // Derived here rather than taken from the payload's own `notGiven`. The
      // rule is identical — a figure this app could not read IS a figure it was
      // not given — and deriving it means an older deploy, or a field the
      // reader stringified past reading, cannot leave the list disagreeing with
      // the figures beside it.
      notGiven: FOOD_FIGURES.filter((k) => figures[k] === null),
    });
  }
  return {
    ok: true,
    items,
    unreadableItems,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
  };
};

/* ── what the member is told ───────────────────────────────────────────── */

/** A title and a body, because these are said in an Alert. */
export interface ReaderSay { title: string; body: string }

/**
 * One sentence per outcome, and the third is the one that matters.
 *
 * 'none-named' is NOT worded as a failure and carries none of the vocabulary
 * of one. A member who typed "a bowl of soup" and is shown an error learns the
 * app is broken; one told the reader found no food in that line learns to type
 * differently, which is the only one of these four they can act on. The test
 * asserts both the absence of failure words there and that all four strings
 * differ — two outcomes sharing a sentence is the collapse this file undoes.
 */
export const FOOD_READ_SAY: Record<FoodReadFailure | 'none-named', ReaderSay> = {
  'no-answer': {
    title: 'The reader did not answer',
    body: 'Nothing came back from the food reader, so nothing has been filled in. Try again in a moment, or type the figures in yourself.',
  },
  'unreadable-answer': {
    title: 'The answer could not be read',
    body: 'The reader answered, but this app could not read what it sent back. Nothing has been filled in — try again, or type the figures in yourself.',
  },
  'unexpected-shape': {
    title: 'That was not what this app expected',
    body: 'The reader answered with something this app did not expect, so nothing has been filled in. Try again, or type the figures in yourself.',
  },
  'none-named': {
    title: 'No food named in that',
    body: 'The reader read your description and did not name any food in it. Try describing it another way, such as "2 eggs, toast and a coffee", or type the figures in yourself.',
  },
};

/**
 * Which of the four a finished read is. Kept here so no screen re-derives it.
 *
 * The one subtlety: a list whose every entry was unreadable is NOT the reader
 * naming no food. It put things in the list and this app could not read any of
 * them, which is the fourth outcome wearing the third's clothes again — the
 * exact substitution `readNutritionItems` was written to stop one layer up.
 */
export const foodReadSay = (read: FoodRead): ReaderSay =>
  read.ok
    ? (read.items.length === 0 && read.unreadableItems > 0
      ? FOOD_READ_SAY['unexpected-shape']
      : FOOD_READ_SAY['none-named'])
    : FOOD_READ_SAY[read.why];

/** What each asked-for figure is called in a sentence to a member. */
const FIGURE_WORD: Record<FoodFigure, string> = {
  kcal: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat',
};

/**
 * The figures the reader did not give, named.
 *
 * "Some of the figures did not come back" tells a member to hunt for the blank
 * boxes; "the reader did not give protein or fat" tells them what they are
 * about to be asked for. '' when it gave everything, so a caller can leave the
 * clause out rather than print an empty list.
 */
export const namedGaps = (notGiven: readonly FoodFigure[]): string => {
  const words = notGiven.map((k) => FIGURE_WORD[k]);
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  return words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];
};

/* ── the photo half ────────────────────────────────────────────────────── */

/**
 * A meal read out of a photograph.
 *
 * `kcal` is the load-bearing figure — `vision-analyze` answers 422 when it has
 * none and there is no meal here without one — so it is a plain number while
 * every other figure is a number or a named absence. Including `confidence`:
 * see the header.
 */
export interface MealVision {
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** Null when the reader gave none. NEVER 0.6, and never 0: a confidence of
   *  zero is a reader saying it is certain of nothing, which is a different
   *  statement from a reader that said nothing. */
  confidence: number | null;
}

/** A gym machine read out of a photograph. */
export interface MachineVision {
  name: string;
  muscleGroup: string;
  isCardio: boolean;
  /** Null when the reader gave none — see `MealVision.confidence`. */
  confidence: number | null;
}

/** Macros come back as whole grams; a null stays null rather than rounding to 0. */
const grams = (v: unknown): number | null => {
  const n = numberOrNull(v);
  return n === null ? null : Math.round(n);
};

/** The `result` of a `vision-analyze` meal read, or null when it holds no meal. */
export const readMealResult = (result: unknown): MealVision | null => {
  const r = asObject(result);
  if (!r) return null;
  const kcal = numberOrNull(r.kcal);
  if (kcal === null) return null;
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Meal',
    kcal: Math.round(kcal),
    protein: grams(r.protein), carbs: grams(r.carbs), fat: grams(r.fat),
    confidence: numberOrNull(r.confidence),
  };
};

/** The `result` of a machine read, or null when it names no machine. */
export const readMachineResult = (result: unknown): MachineVision | null => {
  const r = asObject(result);
  if (!r) return null;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return null;
  return {
    name,
    muscleGroup: typeof r.muscleGroup === 'string' ? r.muscleGroup.trim() : '',
    isCardio: r.isCardio === true,
    confidence: numberOrNull(r.confidence),
  };
};
