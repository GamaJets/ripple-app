// What became of a request to be coached — on the side of the person who made
// it.
//
// ── The silence this closes ───────────────────────────────────────────────
//
// src/lib/notifyCopy.ts states it in as many words, under the notification it
// had to invent to work around it: "the app has no other surface that will ever
// tell them: `coach_requests` is not rendered on the client side once it leaves
// 'pending'." app/(client)/trainers.tsx read that table as
// `.select('trainer_id').eq('status','pending')` and used it for one thing —
// greying out the Request button. Four columns the row carries went unread:
// `status`, `note`, `responded_at` and `source`.
//
// So a member whose coach said no saw exactly what they saw the day before: a
// directory, with that coach's button no longer even marked. The push telling
// them routes to '/(client)/trainers' (COACH_DECLINED_ROUTE), and the screen it
// opened listed nothing about the request it was about. Miss the banner — a
// locked phone, a cleared notification, a handset that was off — and the answer
// was gone for good.
//
// ── What a refusal has to say ─────────────────────────────────────────────
//
// Who, and when. `coach_requests.responded_at` has been stamped by
// src/ui/CoachRequests.tsx since answering was written, and nothing has ever
// read it. "Declined" with no date, weeks after the fact, reads as something
// that just happened and sends somebody to ask again; "Declined by Dayne Foster
// on 3 September" is a fact a person can act on.
//
// Who is the TRAINER and this file does not have to guess: `coach_requests`
// carries one `trainer_id` and `coach_requests_trainer_u` (supabase/parts/23) is
// the only UPDATE policy on the table, so the coach the request was addressed to
// is the only account that can have answered it. The NAME is a separate
// question with its own answer — see `coachRequestAnswerLine`.
//
// ── Nothing here decides whether the read worked ──────────────────────────
//
// `coachRequestsUnreadNote` writes the sentence for a read that did not land,
// and it is a different sentence from the empty one. An empty list rendered as
// "you haven't asked anybody" over a refused read is the failure src/ui/
// loadStatus.ts exists for, and this feature is the one where it costs most: the
// member is deciding whether to go on waiting for somebody.
//
// Pure — no React, no Supabase, no clock. Every sentence takes its time label
// already formatted, because a locale belongs to the reader and `appLocale()`
// is where that is settled.
import { COACHED_MODE_SHORT, readCoachedMode, type CoachedMode } from './types';
// A type only. The vocabulary for "is this all of it" lives in one place and a
// lib that writes a sentence about a read has to speak it — the same import
// src/lib/sessionRequests.ts takes, for the same reason.
import type { LoadStatus } from '../ui/loadStatus';

/* ── what one is ───────────────────────────────────────────────────────── */

/** The four the column's CHECK constraint allows (supabase/parts/23). */
export type CoachRequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

/** How the member reached this coach. Null is honest and is not a fifth value:
 *  supabase/parts/56 added the column and deliberately left every row that
 *  predates it null rather than backfilling a guess. */
export type CoachRequestSource = 'code' | 'directory';

/** One request this member has made, whatever became of it. */
export interface MyCoachRequest {
  id: string;
  /** Who was asked. The only account that can have answered it. */
  trainerId: string;
  mode: CoachedMode;
  status: CoachRequestStatus;
  /** The member's own words, or null. */
  note: string | null;
  source: CoachRequestSource | null;
  createdAt: string;
  /** When it was answered, or null — which is a real state on a row answered
   *  before the stamp was written, and never a reason to invent a date. */
  respondedAt: string | null;
}

/** A row as PostgREST hands it over. Every field optional: this shape crosses
 *  the wire and a build talking to a database without part 56 reads no
 *  `source` at all. */
export interface RawMyCoachRequest {
  id?: unknown;
  trainer_id?: unknown;
  mode?: unknown;
  status?: unknown;
  note?: unknown;
  source?: unknown;
  created_at?: unknown;
  responded_at?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * A stored status this build recognises, or null.
 *
 * Null rather than a default, and `shapeMyCoachRequests` turns null into
 * 'pending' only where a row exists at all. The value that must never be
 * invented is 'accepted': reading an unrecognised string as an acceptance would
 * tell somebody they have a coach on the strength of a word this build has
 * never heard of.
 */
const asStatus = (v: unknown): CoachRequestStatus | null =>
  v === 'pending' || v === 'accepted' || v === 'declined' || v === 'withdrawn' ? v : null;

const asSource = (v: unknown): CoachRequestSource | null =>
  v === 'code' || v === 'directory' ? v : null;

/**
 * Rows in, requests out. A row with no id or no coach on it is dropped: there
 * is no sentence to write about a request that cannot say who it went to, and a
 * row drawn without one would offer a "Ask Them Again" button pointing nowhere.
 */
export function shapeMyCoachRequests(rows: readonly RawMyCoachRequest[] | null | undefined): MyCoachRequest[] {
  if (!rows) return [];
  const out: MyCoachRequest[] = [];
  for (const r of rows) {
    const id = str(r.id);
    const trainerId = str(r.trainer_id);
    if (!id || !trainerId) continue;
    const createdAt = str(r.created_at);
    out.push({
      id,
      trainerId,
      // The column's own default, and the same tolerant read the coach's side
      // of this table takes (src/ui/CoachRequests.tsx).
      mode: readCoachedMode(r.mode),
      // An unrecognised status falls back to 'pending' — the one that claims
      // nothing. It never falls back to 'accepted'.
      status: asStatus(r.status) ?? 'pending',
      note: str(r.note),
      source: asSource(r.source),
      // `created_at` is `not null default now()` so this is belt and braces;
      // the empty string sorts last rather than throwing an order out.
      createdAt: createdAt ?? '',
      respondedAt: str(r.responded_at),
    });
  }
  return out;
}

/**
 * Newest question first, which is the order somebody reads their own history
 * in. Ordered on `createdAt` AND `id`, because two requests made in the same
 * second tie otherwise and a tie is not an order.
 */
export function myCoachRequestsNewestFirst<T extends Pick<MyCoachRequest, 'createdAt' | 'id'>>(
  list: readonly T[],
): T[] {
  return [...list].sort((a, b) => {
    const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (Number.isFinite(d) && d !== 0) return d;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

/** The ones still with the coach. Used for the count at the foot of the list,
 *  and only ever over a whole read — see `isWhole` in src/ui/loadStatus.ts. */
export function openCoachRequests<T extends Pick<MyCoachRequest, 'status'>>(list: readonly T[]): T[] {
  return list.filter((r) => r.status === 'pending');
}

/* ── the four sentences ────────────────────────────────────────────────── */

/**
 * The short label beside a request. Title Case, like every label in this app.
 *
 * None of them is "Rejected". The coach declined a request; they did not pass
 * judgement on the person who made it, and the word a member reads about
 * themselves at that moment is a choice this product gets to make.
 */
export const COACH_REQUEST_LABEL: Record<CoachRequestStatus, string> = {
  pending: 'Waiting on Them',
  accepted: 'They Said Yes',
  declined: 'They Said No',
  withdrawn: 'You Took It Back',
};

/**
 * What the member is told, per status. Four sentences, deliberately not one.
 *
 * `coachName` is null wherever the name could not be read, which is an ordinary
 * state rather than an exception: `profiles_public_directory_r`
 * (supabase/parts/142) shows a client the profile of a LISTED trainer, so a
 * coach who has since left the directory — or who was only ever reached by code
 * — cannot be named here at all. The subject falls back to a description that
 * is true whatever the missing value was, never to a dash: see
 * scripts/check-prose.mjs for the screen that lost the first word of its
 * sentence doing otherwise.
 *
 * The declined sentence carries no reason and must not sound as though it is
 * withholding one. `coach_requests` has no decline note — there is nowhere for
 * a coach to have given a reason — and softening this into "they are not taking
 * new clients right now" would be the app inventing one on their behalf, which
 * is the rule src/lib/notifyCopy.ts spends its own header on.
 */
export function coachRequestLine(
  r: Pick<MyCoachRequest, 'status' | 'mode'>, coachName: string | null,
): string {
  const who = coachName ?? 'The coach you asked';
  switch (r.status) {
    case 'pending':
      return `${who} has not answered yet. Nothing is arranged, they are not coaching you, and you will see the answer here when it comes.`;
    case 'accepted':
      return `${who} said yes, so they are coaching you (${COACHED_MODE_SHORT[r.mode].toLowerCase()}). Your Coach is where the rest of it is.`;
    case 'declined':
      return `${who} said no, so they are not coaching you and nobody is waiting on anything. Asking another coach is the thing left to do.`;
    case 'withdrawn':
      return 'You took this back before it was answered, so it is no longer with them and they were not told anything about it.';
  }
}

/**
 * Who answered it and when — the half a refusal is not allowed to leave out.
 *
 * Null for a request nobody has answered, and null for one where the record
 * holds neither a name nor a date: a line saying "answered by somebody at some
 * point" is noise, and the sentence above it has already said what happened.
 *
 * A missing `respondedAt` is stated rather than hidden. The column is nullable
 * and every row answered before src/ui/CoachRequests.tsx started stamping it
 * carries none, so "the record does not say when" is the true sentence and a
 * quietly dropped date would leave a member guessing whether an answer from
 * March arrived this morning.
 */
export function coachRequestAnswerLine(
  r: Pick<MyCoachRequest, 'status'>, coachName: string | null, whenAnswered: string | null,
): string | null {
  if (r.status !== 'accepted' && r.status !== 'declined') return null;
  const verb = r.status === 'accepted' ? 'Accepted' : 'Declined';
  const who = coachName ?? 'the coach you asked';
  if (!whenAnswered) return `${verb} by ${who}. The record does not say when.`;
  return `${verb} by ${who} on ${whenAnswered}.`;
}

/**
 * How this request was made, where the row says.
 *
 * Null for a row that does not say, and that is the whole reason this is a
 * function rather than a lookup table: `source` is null on every request made
 * before supabase/parts/56, and printing "found in the directory" over one of
 * those would be the app stating as fact something nobody ever recorded.
 */
export function coachRequestSourceNote(source: CoachRequestSource | null): string | null {
  if (source === 'code') return 'You asked them with their coaching code.';
  if (source === 'directory') return 'You found them in the directory.';
  return null;
}

/**
 * What to say about the list itself when it is not a whole, landed read.
 *
 * Four statuses and three sentences, because they are three different
 * situations — one still happening, one finished and failed, one finished and
 * short. A single "we couldn't check" over all of them would tell somebody
 * mid-read that something had gone wrong, and the error wording in particular
 * has to refuse the empty claim outright: "you have not asked anybody" printed
 * over a refused read is what sends a member who is waiting on an answer off to
 * ask a second coach.
 */
export function coachRequestsUnreadNote(status: LoadStatus): string | null {
  switch (status) {
    case 'ready':
      return null;
    case 'loading':
      return 'Reading the coaches you have asked.';
    case 'partial':
      return 'There are more requests on your record than fitted in one read, so these are the most recent of them rather than all of them.';
    case 'error':
      return 'We couldn’t read the coaches you have asked, so this is not a list of your requests, and it is not us saying you have none. Check again when you have signal, and don’t ask a second coach on the strength of this.';
  }
}

/**
 * The count at the foot of the list.
 *
 * Null for nothing outstanding, so a caller can render it unconditionally
 * without drawing a banner about zero — the same shape `coachQueueNote` uses on
 * the other side of this conversation.
 */
export function coachRequestWaitingNote(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 coach has not answered you yet.'
    : `${n} coaches have not answered you yet.`;
}
