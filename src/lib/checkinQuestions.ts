// A coach's own check-in questions: what may be asked, and what an answer is.
//
// Pure. The schema is supabase/parts/3380 and the rules it enforces are
// repeated here for the reason every module in this directory repeats one: a
// screen that only learns a rule when the database refuses the write is a
// screen that has already told somebody their answer was saved.
//
// ── The six fixed fields are not in here ───────────────────────────────────
//
// Weight, energy, sleep, mood, adherence and the note stay exactly where they
// are, read by src/lib/coachCheckins.ts and four screens. These questions are
// ADDED under them. A configurable form that replaced the fixed one would stop
// being comparable the first time a coach edited it, and would throw away
// columns two other screens draw. Part 3380's header makes the same argument
// at length.
import { num } from './format';

export type QuestionKind = 'rating' | 'number' | 'text';

/** The scale a 'rating' question is on — the same 1-5 the four fixed ratings
 *  use, so a coach's own question reads beside them without a second scale to
 *  learn. src/lib/coachCheckins.ts owns the same constant for those. */
export const QUESTION_RATING_MAX = 5;

export const PROMPT_MAX = 120;
export const UNIT_MAX = 12;
export const ANSWER_TEXT_MAX = 1000;

/**
 * How many a coach may ask at once.
 *
 * Not a database constraint, and deliberately a number rather than "as many as
 * you like": this form is filled in on a phone once a week by somebody who is
 * not being paid to fill it in. Eight questions under the six fixed fields is
 * already a long screen, and the failure mode of a form that is too long is
 * not a complaint — it is a client who stops sending it, which costs the coach
 * the whole signal.
 */
export const MAX_LIVE_QUESTIONS = 8;

export interface Question {
  id: string;
  prompt: string;
  kind: QuestionKind;
  /** What the figure is in, for a 'number'. Null for the other two kinds. */
  unit: string | null;
  position: number;
  /** Null while it is still being asked. */
  retiredAt: string | null;
}

/** One answer, in whichever shape its question has. Exactly one of the three
 *  is set — the same rule `check_in_answers_one_value_chk` enforces. */
/** The three value columns of one answer, exactly one of them set. */
export interface AnswerValue {
  rating: number | null;
  number: number | null;
  text: string | null;
}

export interface Answer {
  questionId: string;
  rating: number | null;
  number: number | null;
  text: string | null;
}

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
};

/** A prompt as it will be stored, or null when there is nothing to store. */
export function promptText(raw: string | null | undefined): string | null {
  return clean(raw, PROMPT_MAX);
}

/** A unit as it will be stored. Only a 'number' question has one: a unit on a
 *  rating is a second scale, and on a sentence it is nothing. */
export function unitText(raw: string | null | undefined, kind: QuestionKind): string | null {
  return kind === 'number' ? clean(raw, UNIT_MAX) : null;
}

/**
 * Why this question cannot be added, or null when it can.
 *
 * `live` is how many the coach is already asking. The cap is stated with the
 * number in it, because "too many" without a figure is a refusal somebody
 * cannot act on.
 */
export function questionRefusal(o: { prompt: string | null | undefined; live: number }): string | null {
  if (!promptText(o.prompt)) {
    return 'Write the question first. A question with no words is one nobody can answer.';
  }
  if (o.live >= MAX_LIVE_QUESTIONS) {
    return `You are already asking ${num(MAX_LIVE_QUESTIONS)} questions, which is as many as this form takes. Retire one you no longer read, and its answers stay.`;
  }
  return null;
}

/** The live ones, in the order they are asked. Retired questions are excluded
 *  here and nowhere else: a client's history still needs them, which is why
 *  the read fetches both and this is a separate step. */
export function liveQuestions(all: readonly Question[] | null | undefined): Question[] {
  return (all ?? [])
    .filter((q) => !q.retiredAt)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * An answer as it will be written, or null when there is nothing to write.
 *
 * Null is a SKIP and is not an error: a question somebody did not answer has
 * no row, which is what makes "they skipped it" and "they answered zero"
 * different facts downstream. A rating outside 1-5, a number that will not
 * read and an empty sentence are all skips rather than refusals — the form is
 * filled in once a week by somebody doing it as a favour, and refusing their
 * whole check-in over one stray character is how a form stops being sent.
 */
export function answerValue(kind: QuestionKind, raw: unknown): AnswerValue | null {
  if (kind === 'rating') {
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
    if (!Number.isInteger(n) || n < 1 || n > QUESTION_RATING_MAX) return null;
    return { rating: n, number: null, text: null };
  }
  if (kind === 'number') {
    // The empty string is checked BEFORE Number(), and this line is the whole
    // reason the module exists: `Number('')` is 0, so an untouched box would
    // have been written as a waist of nought and a step count of nought —
    // skipped and answered-zero are different facts, and the first is the
    // common one.
    const typed = typeof raw === 'number' ? raw : String(raw ?? '').trim().replace(',', '.');
    if (typed === '') return null;
    const n = typeof typed === 'number' ? typed : Number(typed);
    if (!Number.isFinite(n)) return null;
    // Rounded to the two decimals the column stores, here rather than at the
    // far end: a figure that comes back changed from what somebody typed is a
    // figure they will not trust twice.
    return { rating: null, number: Math.round(n * 100) / 100, text: null };
  }
  const s = clean(raw, ANSWER_TEXT_MAX);
  return s ? { rating: null, number: null, text: s } : null;
}

/**
 * What one answer reads as, beside its question.
 *
 * Null when there is no answer, so a screen draws the question as unanswered
 * rather than as a blank — "4/5" and "" are different facts and only one of
 * them is a value.
 */
export function answerLine(q: Question, a: Answer | null | undefined): string | null {
  if (!a) return null;
  if (q.kind === 'rating' && a.rating != null) return `${num(a.rating)}/${num(QUESTION_RATING_MAX)}`;
  if (q.kind === 'number' && a.number != null) {
    const figure = Number.isInteger(a.number) ? num(a.number) : String(a.number);
    return q.unit ? `${figure} ${q.unit}` : figure;
  }
  if (q.kind === 'text' && a.text) return a.text;
  return null;
}

/** The sentence under a coach's list of questions, or null when they ask none.
 *  Says what adding one does, because it changes a form somebody else fills
 *  in and that is worth knowing before the first one. */
export function questionsNote(live: number): string | null {
  if (live <= 0) return null;
  return live === 1
    ? 'Your client answers this under the six questions everybody answers. Retiring it keeps every answer already given.'
    : `Your clients answer these ${num(live)} under the six questions everybody answers. Retiring one keeps every answer already given.`;
}
