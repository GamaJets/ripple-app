// Reading one movement across a coach's whole book.
//
// ── Why the read is here and the judgement is in src/lib ──────────────────
//
// src/lib/rosterExercise.ts is pure: it takes rows and returns judgements, and
// it can be run by `npx tsx` with no database, no device and no native module.
// That is not tidiness. `supabase.ts` imports AsyncStorage at module scope, so
// anything importing it cannot be loaded by a test runner at all — and the
// house rule about never importing a throwing native module at module scope is
// the same rule seen from the other end. The moment the threshold that decides
// "stalled" sits in a file a test cannot import, it is a threshold nobody
// checks.
//
// So this file is the round trip and nothing else: it turns a movement name
// into a slug, asks the aggregate, and hands back rows plus the status of the
// read. Every sentence about those rows is written next door.

import { supabase } from '../lib/supabase';
import { exerciseSlug } from '../lib/exerciseId';
import { reportError } from '../lib/reportError';
import { type LoadStatus } from './loadStatus';
import {
  ROSTER_WINDOW_DAYS, ROSTER_SPLIT_DAYS, type RosterExerciseRow,
} from '../lib/rosterExercise';

/* ── the read ─────────────────────────────────────────────────────────────── */

export interface RosterExerciseRead {
  rows: RosterExerciseRow[] | null;
  status: LoadStatus;
}

/**
 * Ask the database for one movement across the coach's whole book.
 *
 * ── Why there is no row cap on this call ──────────────────────────────────
 *
 * Because there cannot be a truncated answer. `coach_exercise_roster` groups by
 * client, so it returns at most one row per client of the coach's own roster —
 * bounded by the size of a book, which is bounded by the roster read that is
 * already capped and already reports its own truncation. A `limit` here would
 * be a ceiling on a set that is smaller than the ceiling, which is a guard that
 * cannot fire and therefore a guard nobody can test.
 *
 * ── Why 'partial' is never returned ───────────────────────────────────────
 *
 * For the same reason. There are exactly three outcomes: the aggregate answered
 * ('ready'), it did not ('error'), or the caller has not asked yet ('loading').
 * A screen that branched on 'partial' here would have a branch nothing could
 * reach, and src/lib/setRows.ts records what a mutation run does to code like
 * that: it deletes it and no assertion notices.
 *
 * `null` rows under 'error', never an empty array. The whole of this codebase
 * turns on that distinction and this read is one of the places where getting it
 * wrong says "none of your clients does this movement" about a failed request.
 */
export async function readRosterExercise(
  exerciseName: string,
  now: Date = new Date(),
): Promise<RosterExerciseRead> {
  const slug = exerciseSlug(exerciseName);
  // An empty slug is a movement with no alphanumerics in its name. It cannot
  // match anything and asking would be a round trip for a guaranteed empty
  // answer — reported as 'error' rather than as an empty 'ready', because an
  // empty 'ready' here is the sentence "none of your clients does this".
  if (!slug) return { rows: null, status: 'error' };

  const from = new Date(now.getTime() - ROSTER_WINDOW_DAYS * 86_400_000).toISOString();
  const split = new Date(now.getTime() - ROSTER_SPLIT_DAYS * 86_400_000).toISOString();

  try {
    const { data, error } = await supabase.rpc('coach_exercise_roster', {
      p_slug: slug, p_from: from, p_split: split,
    });
    if (error) {
      reportError('rosterExercise.read', error, { slug });
      return { rows: null, status: 'error' };
    }
    const rows = ((data ?? []) as any[]).map((r): RosterExerciseRow => ({
      clientId: String(r.client_id),
      lastAt: r.last_at ?? null,
      // `numeric` comes back from PostgREST as a STRING, not a number —
      // JavaScript cannot hold every numeric faithfully so the driver refuses
      // to guess. `Number()` here rather than at the render boundary, because a
      // string that reaches `judgeRosterRow` compares with `>` lexically and
      // '9' is greater than '100'. That comparison is the whole of this
      // feature, and it would have been silently backwards for every load over
      // 99 kg.
      recentOutings: num(r.recent_outings) ?? 0,
      priorOutings: num(r.prior_outings) ?? 0,
      recentTopKg: num(r.recent_top_kg),
      priorTopKg: num(r.prior_top_kg),
      recentE1rmKg: num(r.recent_e1rm_kg),
      priorE1rmKg: num(r.prior_e1rm_kg),
    }));
    return { rows, status: 'ready' };
  } catch (e) {
    reportError('rosterExercise.read', e, { slug });
    return { rows: null, status: 'error' };
  }
}

/** A numeric-or-string from PostgREST as a number, or null. Null for anything
 *  that is not a finite number — including the empty string, which `Number()`
 *  turns into 0 and which would render as a client whose heaviest set was
 *  nothing. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
