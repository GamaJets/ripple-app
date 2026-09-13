// The reviews a member has written, read back to them.
//
// ── What could not be asked ───────────────────────────────────────────────
//
// `my_review_of(p_coach)` (supabase/parts/139) answers "what did I say about
// THIS coach", and every caller has to already hold a coach id. The only two
// places in the client app that hold one are `my_coach_profile()`, which stops
// answering the moment coaching ends, and a row of the directory, which holds
// listed coaches only. Between them they cover the current coach and the
// coaches who opted into a public profile, and nobody else.
//
// So a member who had left a coach owned a rating and a paragraph about a named
// professional that they could not read, could not change, and could not take
// down — while the coach could still read it, and reply to it, from
// app/(trainer)/credentials.tsx. supabase/parts/2790 adds `my_coach_reviews()`,
// which asks the question the member actually has: what have I written?
//
// ── Why the sentences are here and not on the screen ──────────────────────
//
// Every string below is about somebody's own words and about who can see them,
// and both are easy to state more confidently than the record supports:
//
//   · "You haven't written any reviews" over a read that FAILED. That is this
//     codebase's most repeated defect (src/ui/loadStatus.ts) and here it is
//     worse than usual: a member told they have written nothing will write one,
//     and `write_coach_review` UPSERTS on (coach_id, client_id) — so the new
//     one silently replaces the old one and clears the coach's reply with it.
//     There is no second row and no undo.
//
//   · a claim about WHO CAN SEE IT. A withdrawn review is off the coach's
//     profile but still in the table, and a review of a coach who never ticked
//     "list me" was never on a page anybody could browse. Three states, three
//     sentences, and collapsing them tells a member their words are public when
//     they are not, or private when they are not.
//
// Pure — no React, no Supabase, no clock. A formatted date arrives already
// formatted, because a locale belongs to the reader.
import type { LoadStatus } from '../ui/loadStatus';
import { MAX_RATING } from './reviews';

/** One review the caller wrote, as `my_coach_reviews()` returns it. */
export interface MyCoachReview {
  id: string;
  coachId: string;
  /** The coach's full name, or null where their profile carries none. Never a
   *  dash: the sentences below do without a name rather than print a hole. */
  coachName: string | null;
  /** Whether that coach's profile is in the public directory. The one fact
   *  that decides whether "anybody browsing" is a true thing to say. */
  coachListed: boolean;
  rating: number;
  body: string | null;
  createdAt: string;
  edited: boolean;
  /** Set when the member took it down. The row survives; the profile loses it. */
  withdrawnAt: string | null;
  coachReply: string | null;
  coachRepliedAt: string | null;
}

/**
 * Newest first, and stable.
 *
 * The function already orders, so this is not a correction of the server. It is
 * insurance against the shape this list will take next: a screen that shows the
 * current coach's review from `my_review_of` beside this set would concatenate
 * two ordered lists and get one unordered one, and a list whose order moves
 * between reads looks like a list that is changing when nothing has.
 *
 * `Date.parse`, not a string comparison. These are timestamptz instants and not
 * bare `YYYY-MM-DD` days, so there is a real point in time to compare and no
 * timezone to guess at. A stamp that will not parse sorts last rather than
 * poisoning the comparison, and the id breaks the tie so equal stamps cannot
 * swap places between renders.
 */
export function sortMyReviews(rows: MyCoachReview[]): MyCoachReview[] {
  const at = (r: MyCoachReview): number => {
    const ms = Date.parse(r.createdAt);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };
  return [...rows].sort((a, b) => at(b) - at(a) || a.id.localeCompare(b.id));
}

/**
 * The sentence above the list.
 *
 * 'partial' gets its own answer and is never folded into 'ready': the only
 * thing worth saying under 'ready' with nothing in the list is that there is
 * nothing, and over a known prefix that sentence is false.
 *
 * `currentCoachShownAbove` is what keeps the empty sentence honest. The screen
 * this feeds already has a "Your Review" block for the coach the member is with
 * right now, so the list underneath is the OTHER coaches and the current one is
 * filtered out of it. Without this flag a member who has reviewed exactly one
 * person — the coach whose review is on screen six inches higher up — would be
 * told they have never reviewed a coach.
 */
export function myReviewsNote(
  status: LoadStatus, count: number, currentCoachShownAbove: boolean,
): string {
  switch (status) {
    case 'loading':
      return 'Reading what you have written.';
    case 'error':
      return 'We couldn’t read the reviews you have written. This is not us saying you have written none — check again when you have signal, and don’t write a replacement in the meantime, because a new review of the same coach replaces the old one.';
    case 'partial':
      return 'We only got part of the list, so the reviews below are not all of the ones you have written.';
    case 'ready':
      if (count <= 0) {
        return currentCoachShownAbove
          ? 'The coach above is the only one you have reviewed. A review of anybody you trained with before them would be here.'
          : 'You haven’t reviewed a coach yet. A review is the only thing on a coach’s profile that comes from somebody who actually trained with them.';
      }
      if (currentCoachShownAbove) {
        return count === 1
          ? 'One other coach you have reviewed, besides the one above.'
          : `${count} other coaches you have reviewed, besides the one above.`;
      }
      return count === 1
        ? 'One review, in your own words, about somebody you trained with.'
        : `${count} reviews, in your own words, about people you trained with.`;
  }
}

/**
 * What the member said, as a sentence.
 *
 * The name is dropped rather than replaced when the coach's profile carries
 * none: "You rated — 4 out of 5" is the hole scripts/check-prose.mjs exists for,
 * and "You rated your coach" would be a lie about a coach they have left.
 */
export function myReviewRatingLine(r: MyCoachReview): string {
  return r.coachName
    ? `You rated ${r.coachName} ${r.rating} out of ${MAX_RATING}.`
    : `You gave ${r.rating} out of ${MAX_RATING}.`;
}

/**
 * Who can read it.
 *
 * Three states, because they differ in who is looking:
 *
 *   · withdrawn. Off the profile, still in the record, and the member is the
 *     one person `coach_reviews_for` will not show it to — so if this said
 *     nothing, taking a review down would look like losing it.
 *   · live, and the coach is listed. Anybody browsing the directory can read
 *     it, under the member's first name. That is the deal they agreed to and
 *     it should not have to be remembered.
 *   · live, and the coach is not listed. It is not on any page a stranger can
 *     reach. Said plainly rather than left to imply the opposite.
 *
 * The coach reads it in every one of the three, which is why the coach is named
 * separately from whoever else can.
 */
export function myReviewVisibilityLine(r: MyCoachReview): string {
  if (r.withdrawnAt) {
    return 'Withdrawn. It is off their profile and nobody can read it. Writing a new review of them replaces this one rather than adding a second.';
  }
  if (r.coachListed) {
    return 'On their public profile, under your first name. Your coach can read it and reply to it.';
  }
  return 'Your coach can read it and reply to it. They are not in the public directory, so nobody is browsing it.';
}

/** Said only when the record actually holds it. An unedited review gets no
 *  line at all rather than one saying it has not been changed, which is a
 *  sentence about nothing. */
export function myReviewEditedLine(r: MyCoachReview): string | null {
  return r.edited ? 'You have changed this since you first wrote it.' : null;
}
