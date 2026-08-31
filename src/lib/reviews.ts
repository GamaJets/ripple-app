// What a client says about a coach, and every rule about how much it may be
// made to mean.
//
// `app/(client)/trainers.tsx` used to render five invented coaches with
// invented star ratings; the fictional coaches went and the header has said
// ever since that "Ratings and review counts are gone — there is no review
// system to feed them." `supabase/parts/139` builds the real one. This file is
// the arithmetic and the wording, kept out of the screens because both are easy
// to get subtly, permanently wrong about a named person's livelihood.
//
// ── Three things this file refuses to do ──────────────────────────────────
//
// 1. Average two ratings. A single 5 is not "5.0 stars", it is one person's
//    opinion, and a screen that renders it as a figure invites a comparison
//    against a coach with forty. Below MIN_FOR_AVERAGE the count is shown and
//    no average is computed at all — `ratingDisplay` has no branch that can
//    produce one.
//
// 2. Say "no reviews yet" over a failed read. That sentence is a claim about
//    somebody's reputation, and the read that produces it fails for the same
//    reasons every other read in this app fails — no signal in a basement gym.
//    'unknown' and 'none' are separate outcomes here and must stay separate on
//    the screen.
//
// 3. Say "only clients can review" when we could not find out whether the
//    reader is one. `reviewGate` returns 'unknown' for that, because telling
//    somebody they were never a client is a thing to be sure of first.
//
// ── Withdrawal, editing, and the coach's answer ───────────────────────────
//
// A review can be rewritten and it can be withdrawn, and rewriting CLEARS the
// coach's reply — see the part file. The client is told that before they save,
// in WORDS FROM HERE, so the sentence is asserted on rather than typed into a
// screen and forgotten.

import type { LoadStatus } from '../ui/loadStatus';

export const MIN_RATING = 1;
export const MAX_RATING = 5;
/** Below this many reviews, a count is shown and no average is computed. */
export const MIN_FOR_AVERAGE = 3;
export const MAX_BODY = 1500;
export const MAX_REPLY = 1500;

export interface RatingSummary {
  /** Live, non-withdrawn reviews. */
  count: number;
  /** Sum of their ratings — the average is derived here, never in a screen. */
  sum: number;
}

export interface Review {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  edited: boolean;
  /** First name only. Null when the profile has no name on it. */
  reviewerName: string | null;
  /** The gym it was written at, filled only when it differs from the reader's. */
  otherGym: string | null;
  coachReply: string | null;
  coachRepliedAt: string | null;
}

export interface MyReview {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  edited: boolean;
  withdrawnAt: string | null;
  coachReply: string | null;
  coachRepliedAt: string | null;
}

export type RatingDisplay =
  | { kind: 'loading' }
  /** The read failed. Show nothing, and say nothing about the coach. */
  | { kind: 'unknown' }
  | { kind: 'none' }
  /** One or two reviews: a count is honest, an average is not. */
  | { kind: 'few'; count: number }
  | { kind: 'average'; average: number; count: number };

/**
 * `summary` is null when there is no row for this coach, which under a
 * completed read means genuinely no reviews. Under 'error' it means nothing at
 * all, which is why status is a parameter and not an afterthought.
 *
 * 'partial' is treated as 'error' here on purpose: the load-status vocabulary
 * says a count or an average over a truncated set may not be shown, and both of
 * those are the only things this function produces.
 */
export function ratingDisplay(summary: RatingSummary | null, status: LoadStatus): RatingDisplay {
  if (status === 'loading') return { kind: 'loading' };
  if (status !== 'ready') return { kind: 'unknown' };
  if (!summary || summary.count <= 0) return { kind: 'none' };
  if (summary.count < MIN_FOR_AVERAGE) return { kind: 'few', count: summary.count };
  return { kind: 'average', average: summary.sum / summary.count, count: summary.count };
}

/** One decimal, and never rounded up to a number the ratings cannot reach. */
export function formatAverage(avg: number): string {
  const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, avg));
  return (Math.round(clamped * 10) / 10).toFixed(1);
}

/** The short text on a directory row. Null when nothing may honestly be said. */
export function ratingLine(d: RatingDisplay): string | null {
  switch (d.kind) {
    case 'loading':
    case 'unknown':
      return null;
    case 'none':
      return 'No reviews yet';
    case 'few':
      return `${d.count} review${d.count === 1 ? '' : 's'}`;
    case 'average':
      return `${formatAverage(d.average)} from ${d.count} reviews`;
  }
}

export type ReviewGate =
  | 'loading'
  /** We could not establish whether the reader was ever a client. */
  | 'unknown'
  | 'allowed'
  | 'not-a-client'
  | 'self';

/**
 * Whether the reader may write a review, and why not when they may not.
 *
 * `canReview` comes from `can_review_coach()`, which answers "is, or was, this
 * coach's client" — an ACTIVE or ENDED relationship, never a PENDING one. A
 * pending row is what `join_by_code` leaves behind for anybody holding a code a
 * coach handed out, so gating on it would let somebody the coach declined
 * review them.
 */
export function reviewGate(input: {
  status: LoadStatus;
  canReview: boolean | null;
  isSelf: boolean;
}): ReviewGate {
  if (input.isSelf) return 'self';
  if (input.status === 'loading') return 'loading';
  if (input.status === 'error' || input.canReview === null) return 'unknown';
  return input.canReview ? 'allowed' : 'not-a-client';
}

export function reviewGateNote(g: ReviewGate): string | null {
  switch (g) {
    case 'loading':      return null;
    case 'allowed':      return null;
    case 'self':         return 'This is your own profile.';
    case 'not-a-client': return 'Reviews come from people this coach has actually trained, so only their current and former clients can leave one.';
    case 'unknown':      return 'We couldn’t check whether you’ve trained with this coach, so we can’t open the review form. This is our end — try again in a moment.';
  }
}

export type ListState = 'loading' | 'unreadable' | 'none' | 'some';

/**
 * The one place "no reviews yet" is allowed to be decided. Note that 'error'
 * with rows in hand is still 'unreadable': stale rows may be shown as a list,
 * but the SCREEN needs to know they are not the current set.
 */
export function reviewListState(status: LoadStatus, rows: Review[]): ListState {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'unreadable';
  return rows.length > 0 ? 'some' : 'none';
}

/** "Written at Iron Works" — only ever set when the gym is not the reader's. */
export function gymLine(r: Pick<Review, 'otherGym'>): string | null {
  const g = (r.otherGym ?? '').trim();
  return g ? `Trained with them at ${g}` : null;
}

/** The reviewer, as the reader sees them. Never invents a name. */
export function reviewerLabel(r: Pick<Review, 'reviewerName'>): string {
  const n = (r.reviewerName ?? '').trim();
  return n || 'A client';
}

// ── The sentences a client reads before they write one ─────────────────────
//
// In this file rather than in the screen because each is a promise the product
// has to keep, and the test is where that is written down.

/** Reviews are not anonymous in practice, and saying otherwise would be a lie. */
export const IDENTITY_NOTE =
  'Your first name is shown with your review. Your coach can probably work out it was you, so write it the way you would say it to them.';

/** Rewriting clears the coach's answer. Said before saving, not after. */
export const EDIT_NOTE =
  'If you change a review your coach has already replied to, their reply is removed — it answered what you wrote before.';

/** What withdrawing does and does not do. */
export const WITHDRAW_NOTE =
  'Withdrawing hides your review from everyone. You can write a new one later; it will replace this one rather than sit alongside it.';

/** The coach's side, on the screen where they answer. */
export const REPLY_NOTE =
  'Your reply is public, under the review, with your name on it. It is the only thing you can do about a review you disagree with — there is no way to take one down from inside the app.';

export type WriteResult =
  | 'written' | 'not_a_client' | 'invalid_rating' | 'self' | 'signed_out'
  /** The call itself failed. Distinct from every refusal above. */
  | 'failed';

/**
 * The outcome, in words. `saved` is the flag a screen uses to decide whether to
 * change what it is showing, and it is true for exactly one of these — a
 * zero-row write over PostgREST is not an error and never arrives as one, which
 * is why `write_coach_review` returns a word rather than relying on a throw.
 */
export function writeOutcome(r: WriteResult, coachName: string | null): { title: string; body: string; saved: boolean } {
  const who = (coachName ?? '').trim() || 'your coach';
  switch (r) {
    case 'written':
      return { title: 'Review saved', body: `It is on ${who}’s profile now, with your first name. You can change it or withdraw it whenever you like.`, saved: true };
    case 'not_a_client':
      return { title: 'Not saved', body: `Only ${who}’s current and former clients can review them, and we have no record of you training with them.`, saved: false };
    case 'invalid_rating':
      return { title: 'Not saved', body: `Choose a rating between ${MIN_RATING} and ${MAX_RATING} stars.`, saved: false };
    case 'self':
      return { title: 'Not saved', body: 'You cannot review yourself.', saved: false };
    case 'signed_out':
      return { title: 'Not saved', body: 'Sign in to Repple and try again.', saved: false };
    case 'failed':
      return { title: 'Could not save', body: 'We could not reach the server, so nothing was written. Your review is still here — try again in a moment.', saved: false };
  }
}

/** Whatever the RPC returned, narrowed to something with a sentence behind it. */
export function asWriteResult(v: unknown): WriteResult {
  return v === 'written' || v === 'not_a_client' || v === 'invalid_rating'
      || v === 'self' || v === 'signed_out'
    ? v
    : 'failed';
}

export type DraftProblem = 'ok' | 'no-rating' | 'bad-rating' | 'body-too-long';

export function validateReview(d: { rating: number | null; body: string }): DraftProblem {
  if (d.rating === null) return 'no-rating';
  if (!Number.isInteger(d.rating) || d.rating < MIN_RATING || d.rating > MAX_RATING) return 'bad-rating';
  if (d.body.trim().length > MAX_BODY) return 'body-too-long';
  return 'ok';
}

export function draftProblemText(p: DraftProblem): string {
  switch (p) {
    case 'ok':            return '';
    case 'no-rating':     return 'Pick a rating first.';
    case 'bad-rating':    return `A rating is ${MIN_RATING} to ${MAX_RATING} stars.`;
    case 'body-too-long': return `Keep it under ${MAX_BODY} characters.`;
  }
}

export function validateReply(text: string): 'ok' | 'too-long' {
  return text.trim().length > MAX_REPLY ? 'too-long' : 'ok';
}

/**
 * What a coach's own review inbox needs to know: how many are waiting on an
 * answer. Only ever computed from a complete read — an "unanswered" count off a
 * truncated list would tell a coach they were on top of it.
 */
export function unansweredCount(rows: Review[], status: LoadStatus): number | null {
  if (status !== 'ready') return null;
  return rows.filter((r) => !(r.coachReply ?? '').trim()).length;
}
