// Reading and writing a coach's own check-in questions.
//
// The rules are src/lib/checkinQuestions.ts, which is pure and tested. This is
// the part that touches the database: part 3380's two tables, under the
// policies that put a question in front of a coach's clients and the answers
// in front of that coach.
//
// Answers are written AFTER the check-in row, never with it. `check_ins` is
// what the client's whole week hangs off and it already writes offline and
// adopts a server id (src/ui/checkins.tsx); the answers hang off that id, so a
// failure here costs the extra questions and never the check-in itself. That
// order is the whole error design: somebody whose connection drops mid-send
// has still sent their check-in.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit } from '../lib/rowCap';
import { isWhole, type LoadStatus } from './loadStatus';
import {
  answerValue, liveQuestions, promptText, unitText,
  type Answer, type Question, type QuestionKind,
} from '../lib/checkinQuestions';

/** Literals on the line, for scripts/check-schema.mjs. */
const Q_COLS = 'id, coach_id, prompt, kind, unit, position, retired_at';
const A_COLS = 'question_id, rating, number, answer_text';

const shapeQuestion = (r: Record<string, unknown>): Question | null => {
  const id = typeof r.id === 'string' ? r.id : null;
  const prompt = promptText(r.prompt as string);
  const kind = r.kind === 'rating' || r.kind === 'number' || r.kind === 'text' ? (r.kind as QuestionKind) : null;
  if (!id || !prompt || !kind) return null;
  return {
    id,
    prompt,
    kind,
    unit: unitText(r.unit as string, kind),
    position: Number.isFinite(Number(r.position)) ? Number(r.position) : 0,
    retiredAt: typeof r.retired_at === 'string' ? r.retired_at : null,
  };
};

/**
 * Every question a coach asks, live and retired.
 *
 * Retired ones come back deliberately: a client reading their own history, and
 * a coach reading an answer from two months ago, both need the question it was
 * an answer to. `liveQuestions` is what narrows it for the form.
 */
export function useCheckinQuestions(coachId: string | null): {
  questions: Question[]; status: LoadStatus; reload: () => void;
} {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    if (!USE_SUPABASE || !coachId) { setQuestions([]); setStatus(coachId ? 'ready' : 'ready'); return () => { live = false; }; }
    (async () => {
      setStatus('loading');
      const { data, error } = await supabase.from('coach_checkin_questions').select(Q_COLS)
        .eq('coach_id', coachId)
        .order('position').order('created_at')
        .limit(capLimit());
      if (!live) return;
      if (error) {
        // Empty is "they ask none", which is a true and common answer. A
        // failed read must not look like it, or a client sends a check-in
        // missing the questions their coach relies on and nobody is told.
        reportError('checkinQuestions.read', error, { coachId });
        setQuestions([]); setStatus('error');
        return;
      }
      setQuestions(((data ?? []) as Record<string, unknown>[]).map(shapeQuestion).filter((q): q is Question => !!q));
      setStatus('ready');
    })();
    return () => { live = false; };
  }, [coachId, tick]);

  return { questions, status, reload };
}

/** The answers on one check-in, by question id. */
export async function fetchAnswers(checkInId: string): Promise<Record<string, Answer> | null> {
  if (!USE_SUPABASE || !checkInId) return {};
  const { data, error } = await supabase.from('check_in_answers').select(A_COLS)
    .eq('check_in_id', checkInId).limit(capLimit());
  if (error) { reportError('checkinQuestions.answers', error, { checkInId }); return null; }
  const out: Record<string, Answer> = {};
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const qid = typeof r.question_id === 'string' ? r.question_id : null;
    if (!qid) continue;
    out[qid] = {
      questionId: qid,
      rating: Number.isFinite(Number(r.rating)) && r.rating != null ? Number(r.rating) : null,
      number: Number.isFinite(Number(r.number)) && r.number != null ? Number(r.number) : null,
      text: typeof r.answer_text === 'string' && r.answer_text.trim() ? r.answer_text : null,
    };
  }
  return out;
}

/**
 * Write the answers to one check-in.
 *
 * Skips are not written: a question somebody left alone has no row, which is
 * what keeps "they skipped it" and "they answered zero" apart. Everything is
 * upserted on `(check_in_id, question_id)` so a second send replaces rather
 * than stacking — the same shape part 3380's unique constraint expects.
 *
 * Returns whether every answer landed. False is not a failed check-in: the
 * check-in is already stored, and the caller says so rather than implying the
 * whole thing was lost.
 */
export async function saveAnswers(
  checkInId: string,
  questions: readonly Question[],
  typed: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (!USE_SUPABASE || !checkInId) return true;
  const rows = liveQuestions(questions)
    .map((q) => {
      const v = answerValue(q.kind, typed[q.id]);
      return v ? { check_in_id: checkInId, question_id: q.id, rating: v.rating, number: v.number, answer_text: v.text } : null;
    })
    .filter((r): r is NonNullable<typeof r> => !!r);
  if (!rows.length) return true;
  const { error, data } = await supabase.from('check_in_answers')
    .upsert(rows, { onConflict: 'check_in_id,question_id' })
    .select('question_id');
  if (error) { reportError('checkinQuestions.save', error, { checkInId }); return false; }
  // Counted, not assumed: an upsert RLS narrows to zero rows succeeds having
  // done nothing, which is the failure src/ui/checkins.tsx documents on the
  // check-in itself.
  return (data?.length ?? 0) === rows.length;
}

/* ── the coach's own editing ──────────────────────────────────────────────── */

export async function addQuestion(o: { prompt: string; kind: QuestionKind; unit?: string | null; position: number }): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  const prompt = promptText(o.prompt);
  if (!prompt) return false;
  const { error, data } = await supabase.from('coach_checkin_questions')
    .insert({ prompt, kind: o.kind, unit: unitText(o.unit, o.kind), position: o.position })
    .select('id');
  if (error) { reportError('checkinQuestions.add', error); return false; }
  return (data?.length ?? 0) > 0;
}

/** Stop asking it. Never a delete: the answers are a client's own words about
 *  their own body, and part 3380 refuses the delete at the database too. */
export async function retireQuestion(id: string): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  const { error, data } = await supabase.from('coach_checkin_questions')
    .update({ retired_at: new Date().toISOString() })
    .eq('id', id).select('id');
  if (error) { reportError('checkinQuestions.retire', error, { id }); return false; }
  return (data?.length ?? 0) > 0;
}

/** Whether a questions read may be trusted to mean "they ask none". */
export const questionsKnown = (s: LoadStatus): boolean => isWhole(s);
