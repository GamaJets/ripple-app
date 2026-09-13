// The read behind "the reviews you have written".
//
// ── Why this is not a fifth call in src/ui/reviews.ts ─────────────────────
//
// That file is the coach's trust surface read the other way round: given a
// COACH, what is claimed about them and what was said about them. Every call in
// it takes a coach id. This one takes nothing, because the question is about the
// caller, and it is the only read in the app that can answer it — see
// src/lib/myReviews.ts for what `my_review_of(p_coach)` could not reach.
//
// ── The table is not readable, and that is the design ─────────────────────
//
// `coach_reviews` holds no grant to any role (supabase/parts/139). A
// `.from('coach_reviews')` here would return 42501 rather than an empty list,
// which is intended: RLS selects rows and never columns, and a row-wide read
// hands out `client_id`. So this is an RPC into a SECURITY DEFINER function
// that names its columns — `my_coach_reviews()`, supabase/parts/2790.
//
// ── supabase-js RESOLVES on an error ──────────────────────────────────────
//
// `{ data, error }`, never a throw. The confident-empty failure here is the
// expensive one: `write_coach_review` upserts on (coach_id, client_id), so a
// member told they have written nothing writes one, and it replaces the review
// that was already there and clears the coach's reply with it. 'error' carries
// an empty array and the screen says nothing about what the member has written.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { sortMyReviews, type MyCoachReview } from '../lib/myReviews';

/** A read that says which of the two empties it is. */
export interface MyReviewsRead { rows: MyCoachReview[]; status: LoadStatus }

/** One returned row, defensively. Every field is read for its type rather than
 *  cast: a column that arrives as something else renders as the absence of that
 *  fact, which is survivable, where a cast would put whatever it is on screen
 *  inside a sentence about somebody's professional reputation. */
function toMine(r: any): MyCoachReview {
  return {
    id: String(r.review_id),
    coachId: String(r.coach_id),
    coachName: typeof r.coach_name === 'string' ? r.coach_name : null,
    // Anything that is not exactly true is not listed. The sentence this feeds
    // claims a public profile, and claiming one that is not there tells somebody
    // strangers are reading their words when nobody is.
    coachListed: r.coach_listed === true,
    rating: Number(r.rating) || 0,
    body: typeof r.body === 'string' ? r.body : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    edited: r.edited === true,
    withdrawnAt: typeof r.withdrawn_at === 'string' ? r.withdrawn_at : null,
    coachReply: typeof r.coach_reply === 'string' ? r.coach_reply : null,
    coachRepliedAt: typeof r.coach_replied_at === 'string' ? r.coach_replied_at : null,
  };
}

/**
 * Every review this member has written, withdrawn ones included.
 *
 * Withdrawn rows are the point rather than an oversight: `coach_reviews_for`
 * excludes them from everybody, the author included, so this is the only place
 * the author can see that what they took down is down rather than gone.
 *
 * With no backend there is no review system at all, so an empty list is the
 * whole honest answer and the status is 'ready' — there is no absent server to
 * misreport. See src/ui/loadStatus.ts.
 */
export async function fetchMyReviews(): Promise<MyReviewsRead> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase.rpc('my_coach_reviews');
    if (error) {
      reportError('myReviews.fetch', error);
      return { rows: [], status: 'error' };
    }
    return { rows: sortMyReviews((Array.isArray(data) ? data : []).map(toMine)), status: 'ready' };
  } catch (e) {
    // A transport failure reaches here as a throw rather than as `error`, and
    // it means exactly what a refusal means: we do not know.
    reportError('myReviews.fetch', e);
    return { rows: [], status: 'error' };
  }
}
