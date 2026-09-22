// The workout that was still running when the app went away.
//
// ── The report ────────────────────────────────────────────────────────────
//
// "If you close the tab or if you lock the phone, that workout that's being
// timed disappears. So it doesn't know how to run it in the background."
//
// The clock itself was never the problem and is worth saying so, because the
// obvious fix would have been the wrong one. `useLiveVitals` reads elapsed off
// the WALL CLOCK — `Date.now() - startedAt - awayMs` — precisely so a locked
// phone that stops delivering intervals cannot under-report a duration that
// gets written to somebody's health record. Lock the phone for ten minutes and
// the arithmetic is still right.
//
// What is lost is the SESSION, not the seconds. `session` and `timed` are
// `useState` in one screen and `startedAtRef` is a `useRef` inside a hook, so
// the moment that tree unmounts — the app killed in the background, a reload,
// a tab that remounts — there is nothing anywhere that remembers a workout was
// in progress. This module is that memory.
//
// ── Why a restore needs a rule, and not just a read ──────────────────────
//
// A workout is a duration, and a duration restored from a record nobody has
// touched in nine hours is a nine-hour workout. `sessionMins` goes into the
// log, the streak, the weekly report and plan-versus-actual, so an abandoned
// session resurrecting itself would put a figure into a health record that
// describes an afternoon at a desk.
//
// So this refuses. Past the cutoff a record is dropped rather than restored,
// and the member starts a new session — losing a workout they had already
// stopped caring about, which is the cheaper of the two mistakes by a wide
// margin. The alternative is the one thing this codebase will not do: put a
// number in front of somebody that nothing measured.

/** What is remembered about a session in flight. */
export interface LiveSession {
  /** Which runner. The guided one has no activity; the timed one does. */
  kind: 'guided' | 'timed';
  /** For the timed runner: 'cardio' | 'hiit' | 'mobility' | 'recovery'. */
  sessionKind?: string;
  /** For the timed runner: the activity's own name, e.g. 'Cycling'. */
  activity?: string;
  /** Wall-clock ms when the session started. The figure the whole restore is
   *  for — everything else here is what to re-open around it. */
  startedAt: number;
  /** Milliseconds already banked as paused, so a restored session does not
   *  count a pause it had already taken. */
  pausedMs?: number;
}

/**
 * How long a session may be out of sight and still be restored.
 *
 * Six hours. Long enough that a phone locked through a long ride, a flat
 * battery, or an app the OS reclaimed while the member showered still comes
 * back to the workout they were doing; short enough that yesterday's forgotten
 * session cannot present itself as today's.
 *
 * It is deliberately NOT a sensible workout length — a cap at ninety minutes
 * would throw away the genuine four-hour hike this is most valuable for. The
 * cutoff is about whether the record is still ABOUT something, not about
 * whether the duration is plausible.
 */
export const RESTORE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Parse whatever came out of storage. Anything that is not a whole, usable
 *  record is nothing — a half-written record restored is a wrong duration. */
export function parseLiveSession(raw: string | null | undefined): LiveSession | null {
  if (!raw) return null;
  let v: any;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const kind = v.kind === 'guided' || v.kind === 'timed' ? v.kind : null;
  if (!kind) return null;
  const startedAt = Number(v.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  const pausedMs = Number(v.pausedMs);
  const out: LiveSession = { kind, startedAt, pausedMs: Number.isFinite(pausedMs) && pausedMs >= 0 ? pausedMs : 0 };
  if (kind === 'timed') {
    // A timed session with no activity cannot be re-opened — the runner is
    // built around which activity it is — so it is not a restorable record.
    if (typeof v.activity !== 'string' || !v.activity.trim()) return null;
    out.activity = v.activity;
    out.sessionKind = typeof v.sessionKind === 'string' && v.sessionKind.trim() ? v.sessionKind : 'cardio';
  }
  return out;
}

/** Whether this record may be re-opened, given the clock now. */
export function mayRestore(s: LiveSession | null, now: number): boolean {
  if (!s) return false;
  const age = now - s.startedAt;
  // A start stamped in the future is a clock that moved, not a session from
  // later. Restoring it would produce a negative elapsed, so it is refused.
  if (age < 0) return false;
  return age <= RESTORE_WINDOW_MS;
}

/**
 * The elapsed seconds a restored session should resume at.
 *
 * The same arithmetic the live hook does, so a session that goes away and
 * comes back reads continuously rather than jumping — wall clock minus the
 * pauses it had already banked.
 */
export function restoredElapsedSec(s: LiveSession, now: number): number {
  const away = s.pausedMs ?? 0;
  return Math.max(0, Math.floor((now - s.startedAt - away) / 1000));
}
