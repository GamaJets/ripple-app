// Whether an hour of somebody's training may be sent at all.
//
// This is the judgement behind Finish on app/(trainer)/log-session.tsx, held
// here because the screen is the one place it cannot be asserted. Two guards
// on that screen read it — the button's `ready`, and a belt inside the save
// that runs before anything is queued — and until this module existed both
// could be deleted without a single test, type or gate noticing.
//
// ── the one that is not a validation message ───────────────────────────────
//
// 'no-account' is different in kind from the other four. The others are a
// coach being asked to finish typing. This one is a write that the server is
// going to refuse no matter how long it is left: `workouts.user_id references
// profiles(id)` and the insert policy resolves `is_my_client()`, an EXISTS
// over `clients`. A hand-added client is a `coach_clients` row and nothing
// else, so every entry on the sheet is refused, by the foreign key or by RLS.
// Offering the same bytes again gets the same answer for as long as that
// person has no account.
//
// Online that refusal arrives honestly — but after twenty minutes of typing,
// against a name the picker is showing. OFFLINE IT IS STRICTLY WORSE: nobody
// answers, the floor queue keeps the write, the coach is told it is on the
// phone and going up, the sheet is cleared, and the next flush with signal
// meets the refusal and drops it. An hour of somebody's training is gone with
// no screen left to say so.
//
// Neither ending is reachable if the write is refused HERE, before anything is
// sent and while the sheet is still on screen. That is why the same fact is
// asked twice on that screen and why the second ask is not redundant: `ready`
// withholds the button, and the belt is what a press that beat `ready` hits.
//
// ── what is deliberately not in here ───────────────────────────────────────
//
// `USE_SUPABASE`. It belongs in the READ — a build with no backend has nothing
// to ask — but it must not reach the WRITE, where its only effect would be to
// disable Finish for every client in a no-backend build, including the ones
// that screen has always been able to log.
//
// And the sentences. The screen owns its own wording; this owns the decision.
import { clientIsQueryable } from './clientRecord';

/**
 * Why this session cannot be sent, in the order the screen asks.
 *
 * Ordered, not a set, because the button shows one reason and the coach fixes
 * one thing at a time. 'no-client' first because every other question is about
 * a person nobody has chosen yet.
 */
export type SessionSendBlock =
  | 'no-client'
  | 'no-account'
  | 'no-sets'
  | 'unreadable-load'
  | 'unusable-when';

/** Everything the decision is made from. Nothing here is read from a clock. */
export interface SessionSendFacts {
  /** The chosen client, or null when nobody has been picked. */
  clientId: string | null;
  /**
   * What the roster said about this client, three-valued.
   *
   * Required, not optional, on purpose: a call site that stops passing it stops
   * compiling. That is the only mechanical protection there is against the
   * account question quietly leaving the screen again.
   */
  handAdded: boolean | null | undefined;
  /** Whether any set on the sheet carries a rep count. */
  hasSets: boolean;
  /** The first unreadable load on the sheet, or null when every figure reads. */
  loadProblem: string | null;
  /** Why the day and hour on the picker cannot be used, or null. */
  whenProblem: string | null;
}

/**
 * True when there is no record on the other side for this session to go into.
 *
 * The belt's own predicate, asked without reference to the sheet, because the
 * belt runs after the sheet has already been answered for. `clientIsQueryable`
 * is the fact; this is that fact turned into a refusal to write.
 *
 * An unknown `handAdded` does NOT block. It is `undefined` on the first render
 * and on a row from an older build, and withholding a real client's session on
 * a value nobody has supplied yet would lose the same hour for the opposite
 * reason. Only an explicit `true` is knowledge — see `clientIsQueryable`.
 */
export function sessionClientBlocked(f: Pick<SessionSendFacts, 'clientId' | 'handAdded'>): boolean {
  return !clientIsQueryable(f.clientId, f.handAdded);
}

/**
 * The first reason this session may not be sent, or null when it may.
 *
 * `loadProblem` and `whenProblem` are checked for null rather than for
 * truthiness, so an empty sentence is still a problem rather than silently
 * becoming an approval.
 */
export function sessionSendBlock(f: SessionSendFacts): SessionSendBlock | null {
  if (f.clientId == null || f.clientId === '') return 'no-client';
  if (sessionClientBlocked(f)) return 'no-account';
  if (!f.hasSets) return 'no-sets';
  if (f.loadProblem != null) return 'unreadable-load';
  if (f.whenProblem != null) return 'unusable-when';
  return null;
}

/** Whether Finish may be offered at all. The absence of a block, and nothing
 *  else — never the absence of an error. */
export function maySendSession(f: SessionSendFacts): boolean {
  return sessionSendBlock(f) === null;
}
