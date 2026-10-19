// Which logged session a coach is looking at, and how it compares.
//
// Reported by a coach comparing this app with Hevy: there, tapping a point on
// the chart changed the total but left the list underneath showing another
// day. So there is ONE selection here — a session's `at` — and the chips, the
// chart and the detail list all read it. Nothing about the list is derived from
// a separate index that could disagree.
//
// Everything is the LOGGED record (`workouts` rows grouped by `performed_at`,
// via `sessionsOf`), never the template: a session shows what was done.
import type { LoggedSession } from './clientTraining';
import type { WorkoutEntry } from './mockData';
import { isTimedSet } from './timedSets';

/** The session to show for a selection: the chosen one when it is still in the
 *  list, else the newest. Null only when there are no sessions. */
export function pickSession(sessions: readonly LoggedSession[], at: string | null): LoggedSession | null {
  if (!sessions.length) return null;
  return (at != null ? sessions.find((s) => s.at === at) : undefined) ?? sessions[0];
}

/** One logged set, as a line can print it. `kg` is null when no load was put
 *  in; `secs` is set instead of `reps` for a hold. */
export interface LoggedSet { reps: number | null; secs: number | null; kg: number | null; bw: boolean; feel: 'easy' | 'ok' | 'hard' | null; tempo: string | null; }

export function loggedSets(e: WorkoutEntry): LoggedSet[] {
  return (e.sets ?? []).map(([a, kg], i) => {
    const timed = isTimedSet(e, i);
    const n = typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : null;
    return {
      reps: timed ? null : n,
      secs: timed ? n : null,
      kg: typeof kg === 'number' && Number.isFinite(kg) && kg > 0 ? kg : null,
      bw: e.bw?.[i] === true,
      feel: e.feel?.[i] ?? null,
      tempo: e.tempos?.[i] ?? null,
    };
  });
}

/** Heaviest load in an entry's sets, kg, or null when none carried one. */
export function topKg(e: WorkoutEntry): number | null {
  let best: number | null = null;
  for (const s of loggedSets(e)) if (s.kg != null && s.secs == null && (best == null || s.kg > best)) best = s.kg;
  return best;
}

export type Dir = 'up' | 'down' | 'same' | 'new' | 'unknown';

export interface ExerciseVsLast {
  exercise: string;
  /** Heaviest load this session and in the last earlier session that had the
   *  same movement. Null where none was logged. */
  top: number | null;
  prevTop: number | null;
  /** When that earlier session was (`performed_at`), or null if there was none. */
  prevAt: string | null;
  dir: Dir;
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * Each exercise in `sessions[idx]` against the most recent EARLIER session
 * that contains the same movement — not just the session before, which may
 * have been a different day of the split. `sessions` is newest first.
 */
export function compareToPrevious(sessions: readonly LoggedSession[], idx: number): ExerciseVsLast[] {
  const s = sessions[idx];
  if (!s) return [];
  const seen = new Set<string>();
  const out: ExerciseVsLast[] = [];
  for (const e of s.entries) {
    const k = key(e.exercise);
    if (seen.has(k)) continue;
    seen.add(k);
    const top = maxOf(s.entries.filter((x) => key(x.exercise) === k).map(topKg));
    let prevTop: number | null = null, prevAt: string | null = null, found = false;
    for (let j = idx + 1; j < sessions.length && !found; j++) {
      const same = sessions[j].entries.filter((x) => key(x.exercise) === k);
      if (same.length) { found = true; prevAt = sessions[j].at; prevTop = maxOf(same.map(topKg)); }
    }
    const dir: Dir = !found ? 'new'
      : top == null || prevTop == null ? 'unknown'
      : top > prevTop ? 'up' : top < prevTop ? 'down' : 'same';
    out.push({ exercise: e.exercise, top, prevTop, prevAt, dir });
  }
  return out;
}

function maxOf(xs: (number | null)[]): number | null {
  let m: number | null = null;
  for (const x of xs) if (x != null && (m == null || x > m)) m = x;
  return m;
}

/** Session volume against the previous session, kg. Null when either side has
 *  no priced volume (a bodyweight day is not a day of zero). */
export function volumeVsPrevious(sessions: readonly LoggedSession[], idx: number): number | null {
  const a = sessions[idx]?.volumeKg, b = sessions[idx + 1]?.volumeKg;
  return a == null || b == null ? null : a - b;
}
