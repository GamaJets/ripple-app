// The two halves of a coach's trust surface, read and written: what they claim
// about themselves (`coach_credentials`) and what their clients said about them
// (`coach_reviews`).
//
// Credentials live in this file rather than in a `credentials.ts` of their own
// because the same three screens need both — the directory, the client's own
// coach page, and the coach's own screen — and a third module would have
// duplicated the read three ways. The arithmetic and every sentence stay in
// `src/lib/coachCredentials.ts` and `src/lib/reviews.ts`, which are pure and
// asserted on; this file is the wire.
//
// ── Why the two halves do not look alike ──────────────────────────────────
//
// `coach_credentials` is a table read directly. RLS admits three readers — the
// coach, anybody browsing a LISTED coach, and a coach's active client — and
// column grants keep the verification columns out of every write. So a plain
// `.select()` is safe and its refusals are honest.
//
// `coach_reviews` has NO grant to `authenticated` at all. RLS selects rows, not
// columns, and any row-wide read would hand a stranger browsing the directory
// the reviewer's `client_id`. So every review call below is an RPC into a
// SECURITY DEFINER function that names its columns and returns a first name.
// A direct `.from('coach_reviews')` anywhere in this repo returns 42501, and
// that is intended: the table is not a thing the app can read.
//
// ── supabase-js RESOLVES on an error ──────────────────────────────────────
//
// Every call reads `.error` first. The failure mode this guards is the one the
// whole product keeps producing — an empty list presented as "no reviews yet",
// which about a coach is a statement about their reputation, and "no insurance
// stated", which is a statement about their professional standing. Both are
// wrong in the same silence.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import {
  type Credential, type CredentialDraft, draftToRow,
} from '../lib/coachCredentials';
import {
  type Review, type MyReview, type RatingSummary, type WriteResult, asWriteResult,
} from '../lib/reviews';

/** A read that says which of the two empties it is. */
export interface Read<T> { rows: T; status: LoadStatus }

const CREDENTIAL_COLUMNS =
  'id, coach_id, kind, title, issuer, reference, issued_on, expires_on, verification, verified_at';

function toCredential(r: any): Credential {
  return {
    id: String(r.id),
    kind: r.kind === 'insurance' ? 'insurance' : 'certification',
    title: typeof r.title === 'string' ? r.title : '',
    issuer: typeof r.issuer === 'string' ? r.issuer : null,
    reference: typeof r.reference === 'string' ? r.reference : null,
    issuedOn: typeof r.issued_on === 'string' ? r.issued_on : null,
    expiresOn: typeof r.expires_on === 'string' ? r.expires_on : null,
    // Anything that is not exactly 'verified' is a claim. The schema admits no
    // third value, and reading it defensively costs nothing next to the cost of
    // rendering an unknown string as a badge.
    verification: r.verification === 'verified' ? 'verified' : 'self_declared',
  };
}

/**
 * Credentials for one or more coaches, in one query.
 *
 * `null` rows under 'error' rather than `[]`, so a caller cannot accidentally
 * treat a refusal as "this coach has declared nothing" — `insuranceClaim(null)`
 * is 'unknown' and `credentialCounts(null)` is null for exactly that reason.
 */
export async function fetchCredentials(coachIds: string[]): Promise<Read<Record<string, Credential[]> | null>> {
  if (!USE_SUPABASE) return { rows: {}, status: 'ready' };
  const ids = coachIds.filter(Boolean);
  if (ids.length === 0) return { rows: {}, status: 'ready' };
  const { data, error } = await supabase
    .from('coach_credentials')
    .select(CREDENTIAL_COLUMNS)
    .in('coach_id', ids);
  if (error) {
    reportError('credentials.fetch', error);
    return { rows: null, status: 'error' };
  }
  const by: Record<string, Credential[]> = {};
  for (const id of ids) by[id] = [];
  for (const r of (data ?? []) as any[]) {
    const key = String(r.coach_id);
    (by[key] ??= []).push(toCredential(r));
  }
  return { rows: by, status: 'ready' };
}

/** One coach's credentials. Same null-under-error contract. */
export async function fetchCoachCredentials(coachId: string): Promise<Read<Credential[] | null>> {
  const r = await fetchCredentials([coachId]);
  if (r.status === 'error' || r.rows === null) return { rows: null, status: 'error' };
  return { rows: r.rows[coachId] ?? [], status: 'ready' };
}

/**
 * The coach's own write. `verification`, `verified_at` and `verified_by` are
 * absent from the row by construction (`draftToRow` builds it) and would be
 * refused anyway — `authenticated` holds no grant on them, and PostgREST
 * rejects the WHOLE row for one column it cannot take.
 */
export async function addCredential(draft: CredentialDraft, coachId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  const { data, error } = await supabase
    .from('coach_credentials')
    .insert(draftToRow(draft, coachId))
    .select('id');
  if (error) {
    reportError('credentials.add', error);
    return { ok: false, reason: error.message };
  }
  // A policy-filtered write is zero rows and no error. Counting is the only way
  // to tell it apart from a success.
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing was written.' };
  return { ok: true };
}

export async function updateCredential(id: string, draft: CredentialDraft, coachId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  const row = draftToRow(draft, coachId);
  const { data, error } = await supabase
    .from('coach_credentials')
    .update({
      kind: row.kind, title: row.title, issuer: row.issuer,
      reference: row.reference, issued_on: row.issued_on, expires_on: row.expires_on,
    })
    .eq('id', id)
    .select('id');
  if (error) {
    reportError('credentials.update', error);
    return { ok: false, reason: error.message };
  }
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing was changed.' };
  return { ok: true };
}

export async function deleteCredential(id: string): Promise<{ ok: boolean; reason?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  const { data, error } = await supabase.from('coach_credentials').delete().eq('id', id).select('id');
  if (error) {
    reportError('credentials.delete', error);
    return { ok: false, reason: error.message };
  }
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing was removed.' };
  return { ok: true };
}

/* ── reviews ──────────────────────────────────────────────────────────────── */

function toReview(r: any): Review {
  return {
    id: String(r.review_id),
    rating: Number(r.rating) || 0,
    body: typeof r.body === 'string' ? r.body : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    edited: r.edited === true,
    reviewerName: typeof r.reviewer_name === 'string' ? r.reviewer_name : null,
    otherGym: typeof r.other_gym === 'string' ? r.other_gym : null,
    coachReply: typeof r.coach_reply === 'string' ? r.coach_reply : null,
    coachRepliedAt: typeof r.coach_replied_at === 'string' ? r.coach_replied_at : null,
  };
}

/**
 * The reviews on a coach's profile. Answers for a listed coach, for the
 * caller's own coach, and for the caller themselves — nobody else, and the
 * function decides that, not this file.
 */
export async function fetchReviews(coachId: string): Promise<Read<Review[]>> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  const { data, error } = await supabase.rpc('coach_reviews_for', { p_coach: coachId });
  if (error) {
    reportError('reviews.fetch', error);
    return { rows: [], status: 'error' };
  }
  return { rows: (Array.isArray(data) ? data : []).map(toReview), status: 'ready' };
}

/** Counts and sums for a page of directory rows, in one call. */
export async function fetchRatingSummaries(coachIds: string[]): Promise<Read<Record<string, RatingSummary>>> {
  if (!USE_SUPABASE) return { rows: {}, status: 'ready' };
  const ids = coachIds.filter(Boolean);
  if (ids.length === 0) return { rows: {}, status: 'ready' };
  const { data, error } = await supabase.rpc('coach_review_summary', { p_coaches: ids });
  if (error) {
    reportError('reviews.summary', error);
    return { rows: {}, status: 'error' };
  }
  const out: Record<string, RatingSummary> = {};
  for (const r of (Array.isArray(data) ? data : []) as any[]) {
    out[String(r.coach_id)] = { count: Number(r.rating_count) || 0, sum: Number(r.rating_sum) || 0 };
  }
  // A coach with no reviews has no row, which is a real "none" under 'ready'.
  return { rows: out, status: 'ready' };
}

/** Whether the caller is, or was, this coach's client. `null` means we failed
 *  to find out, which `reviewGate` turns into 'unknown' rather than a refusal. */
export async function canReview(coachId: string): Promise<boolean | null> {
  if (!USE_SUPABASE) return false;
  const { data, error } = await supabase.rpc('can_review_coach', { p_coach: coachId });
  if (error) {
    reportError('reviews.canReview', error);
    return null;
  }
  return data === true;
}

/** The caller's own review of a coach, withdrawn or not. `undefined` rows means
 *  the read failed; `null` means there is genuinely no review. */
export async function fetchMyReview(coachId: string): Promise<Read<MyReview | null>> {
  if (!USE_SUPABASE) return { rows: null, status: 'ready' };
  const { data, error } = await supabase.rpc('my_review_of', { p_coach: coachId });
  if (error) {
    reportError('reviews.mine', error);
    return { rows: null, status: 'error' };
  }
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return { rows: null, status: 'ready' };
  return {
    rows: {
      id: String(r.review_id),
      rating: Number(r.rating) || 0,
      body: typeof r.body === 'string' ? r.body : null,
      createdAt: typeof r.created_at === 'string' ? r.created_at : '',
      edited: r.edited === true,
      withdrawnAt: typeof r.withdrawn_at === 'string' ? r.withdrawn_at : null,
      coachReply: typeof r.coach_reply === 'string' ? r.coach_reply : null,
      coachRepliedAt: typeof r.coach_replied_at === 'string' ? r.coach_replied_at : null,
    },
    status: 'ready',
  };
}

/**
 * Write or rewrite. The RPC returns a WORD — 'written', 'not_a_client',
 * 'invalid_rating', 'self', 'signed_out' — because a policy-filtered write over
 * PostgREST is zero rows and no error, and "review saved" said over one of
 * those is the sentence this whole design exists to prevent. Anything else,
 * including a transport failure, comes back as 'failed'.
 */
export async function writeReview(coachId: string, rating: number, body: string): Promise<WriteResult> {
  if (!USE_SUPABASE) return 'written';
  const { data, error } = await supabase.rpc('write_coach_review', {
    p_coach: coachId, p_rating: rating, p_body: body,
  });
  if (error) {
    reportError('reviews.write', error);
    return 'failed';
  }
  return asWriteResult(data);
}

export async function withdrawReview(coachId: string): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  const { data, error } = await supabase.rpc('withdraw_coach_review', { p_coach: coachId });
  if (error) {
    reportError('reviews.withdraw', error);
    return false;
  }
  return data === true;
}

/** The coach's answer. An empty string removes it. */
export async function replyToReview(reviewId: string, text: string): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  const { data, error } = await supabase.rpc('reply_to_coach_review', {
    p_review: reviewId, p_reply: text,
  });
  if (error) {
    reportError('reviews.reply', error);
    return false;
  }
  return data === true;
}

/** Today as YYYY-MM-DD in the reader's own timezone — the argument every
 *  expiry rule in src/lib/coachCredentials.ts takes. Kept here so the pure
 *  module never reads a clock and stays testable under three timezones. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
