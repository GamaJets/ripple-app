// Whether the coach's profile actually saved, said out loud.
//
// ── The question a person asked, that the screen could not answer ─────────
//
// "In the coach profile tab, when you change or update a setting, how do you
// save and know that the information is saved?"
//
// There was no answer. `src/ui/coachProfile.tsx` autosaves 600ms after the last
// edit and the write ended:
//
//     .then(() => {}, () => {})
//
// Both arms empty. Success and failure discarded identically, so the screen
// could not tell a saved bio from a refused one, and neither could the coach.
// A comment above it called this "right for a bio and wrong for [the public
// handle]". It is wrong for a bio too: the failure mode is not a wrong bio, it
// is a coach who typed one, saw nothing, and believes it is on their profile.
//
// ── The third defect, which nobody would guess ───────────────────────────
//
// The debounce cleanup was `clearTimeout(timer)`. React runs that on every
// dependency change AND on unmount — so a coach who changed a setting and left
// the screen within 600ms had the write CANCELLED. Not failed, not queued:
// never attempted, with nothing on screen having suggested there was anything
// in flight. Toggling "List me in Find a Trainer" and immediately going to look
// at the directory is exactly that gesture.
//
// So `saveState` has four values and not three: a pending write is a state a
// person can see and wait for, which is what makes leaving the screen a choice
// rather than an accident.
//
// ── Why not a Save button ────────────────────────────────────────────────
//
// Considered and rejected. Every field on this screen is a toggle, a chip or a
// text box that already commits on change, and half of them are inside sheets
// that dismiss themselves. A Save button would make all of that provisional and
// give the coach a new way to lose work — closing the screen with it unpressed.
// The autosave is the right shape; what it lacked was an answer. So the answer
// is a status line that names the moment of the last successful write, and says
// so when there has not been one.

// The count, not the absence of an error. A write that matched no rows is not
// an error in PostgREST and looked exactly like a saved one here — see
// `profileWriteFailure` at the foot of this file.
import { writeFailure, type WriteResult } from './wroteRows';

/** What is known about the last attempt to write this profile. */
export type SaveState =
  /** Nothing has been changed this session; nothing has been written. */
  | 'idle'
  /** Edited, and the write has not been attempted or answered yet. */
  | 'pending'
  /** The server confirmed it. */
  | 'saved'
  /** The server refused it, or could not be reached. */
  | 'failed';

export interface SaveStatus {
  state: SaveState;
  /** When the last SUCCESSFUL write landed, as ms since epoch. Null when there
   *  has not been one this session — which is not the same as never. */
  savedAt: number | null;
  /** The server's own words, when it gave any. Null for a failure with no
   *  message, which is a different sentence from a refusal that explained
   *  itself. */
  error: string | null;
}

export const IDLE_SAVE: SaveStatus = { state: 'idle', savedAt: null, error: null };

/**
 * The line under the profile fields, or null when there is nothing to say.
 *
 * Null only for 'idle'. A coach who has changed nothing needs no reassurance,
 * and a permanent "Saved" over an untouched screen is the kind of badge people
 * stop reading — which is the whole failure this is fixing, one layer up.
 *
 * `now` is an argument so the sentence is testable without a clock.
 */
export function saveLine(s: SaveStatus, now: number): string | null {
  if (s.state === 'idle') return null;
  if (s.state === 'pending') return 'Saving your changes…';
  if (s.state === 'failed') {
    // Names what is true of the DATA, not of the request. "Request failed" tells
    // a coach nothing about whether their bio is on their profile; "not saved"
    // tells them exactly what they need to know and what to do about it.
    const why = s.error ? ` (${s.error})` : '';
    return `Your last change was NOT saved${why}. It is still on this screen but not on your profile — `
      + 'change something again to retry, or come back when you have a connection.';
  }
  const ago = Math.max(0, now - (s.savedAt ?? now));
  if (ago < 5_000) return 'Saved.';
  if (ago < 60_000) return 'Saved a moment ago.';
  const mins = Math.floor(ago / 60_000);
  if (mins < 60) return `Saved ${mins} minute${mins === 1 ? '' : 's'} ago.`;
  const hrs = Math.floor(mins / 60);
  return `Saved ${hrs} hour${hrs === 1 ? '' : 's'} ago.`;
}

/**
 * Whether leaving now would lose something.
 *
 * The screen uses this to warn on the way out. True for 'failed' as well as
 * 'pending', because a failed write is also unsaved work — the coach can see
 * their text on screen and has no reason to think it is not on the server.
 */
export const hasUnsavedWork = (s: SaveStatus): boolean => s.state === 'pending' || s.state === 'failed';

/** What to say when they try to leave with work outstanding. */
export function leaveWarning(s: SaveStatus): string | null {
  if (s.state === 'pending') {
    return 'Your last change is still being saved. Give it a moment before you close the app, or it may not reach your profile.';
  }
  if (s.state === 'failed') {
    return 'Your last change was not saved and will be lost if you leave. Change something again to retry it.';
  }
  return null;
}

/** Fold a write's outcome into the status. Written as a reducer so the ordering
 *  rules live in one tested place rather than in four call sites. */
export function afterWrite(prev: SaveStatus, ok: boolean, at: number, error?: string | null): SaveStatus {
  if (ok) return { state: 'saved', savedAt: at, error: null };
  // `savedAt` is CARRIED THROUGH a failure rather than cleared. The earlier
  // successful write really did happen, and forgetting it would turn "saved ten
  // minutes ago, and the last change did not land" into "never saved", which is
  // a worse description of the same profile.
  return { state: 'failed', savedAt: prev.savedAt, error: error?.trim() || null };
}

/** An edit was made; a write is coming. Never clears `savedAt`, for the reason
 *  above — what is already on the server stays true while the next one flies. */
export const markPending = (prev: SaveStatus): SaveStatus =>
  ({ state: 'pending', savedAt: prev.savedAt, error: null });

/**
 * Why the coach's profile save cannot be reported as saved, or null when it
 * can.
 *
 * ── The half this module was missing ──────────────────────────────────────
 *
 * Everything above answers "did the request fail?". That was never the whole
 * question. A PostgREST UPDATE that matches ZERO rows is not an error — it
 * returns 204 with `error: null` — so the two statements behind this screen
 * could both come back clean having changed nothing, and `afterWrite(prev,
 * true, …)` printed "Saved." over it. The two ways that actually happens are
 * the two most likely states a coach can be in: no `trainers` row yet, and an
 * RLS policy refusing the write.
 *
 * `session_fee` goes through that second statement, and it is the number every
 * priced figure in Analytics and the Assistant is derived from. So the count is
 * what is checked here, exactly as src/lib/wroteRows.ts sets out — `null`
 * counted as not-confirmed, so a call site that forgets `{ count: 'exact' }`
 * says so rather than passing.
 *
 * BOTH halves are named. `profiles` holds the name and the photo and `trainers`
 * holds the bio, the rate and the directory listing, and a coach told only that
 * "your profile" did not save cannot tell which of the two is still only on
 * this phone.
 */
export function profileWriteFailure(profiles: WriteResult, trainers: WriteResult): string | null {
  const p = writeFailure('Your name and photo', profiles);
  const t = writeFailure('Your bio, rate and listing', trainers);
  if (p && t) return `${p} ${t}`;
  return p ?? t;
}
