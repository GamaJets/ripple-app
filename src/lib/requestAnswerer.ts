// Who answered a session request, and when.
//
// ── The half that was stored and never read ───────────────────────────────
//
// `session_requests` has carried `answered_by uuid` since
// supabase/parts/740-a-time-the-coach-had-not-opened.sql, and all three write
// paths in that file stamp it: the coach declining, the coach accepting, and
// the member withdrawing. Nothing has ever read it. The client screen selected
// `decline_note` and `answered_at` and drew "Your Coach Said No" with no name
// and no date on it.
//
// A refusal with neither is a worse answer than it looks. Requests sit in that
// list for as long as the account exists, so a decline from March reads exactly
// like one from this morning — and a member who has changed coach since cannot
// tell which of the two people said it. The column already knows.
//
// ── Why the answerer is not simply "the coach" ────────────────────────────
//
// Three accounts can be in that column and they mean three different things:
//
//   · the MEMBER's own id, on a request they withdrew. `withdraw_session_request`
//     is `where … client_id = v_uid`, so this is the one case that is certainly
//     the person reading the screen.
//   · the coach the request was addressed to.
//   · somebody who is neither, which is not a bug: `clients.trainer_id` moves
//     when a member changes coach, so a request answered last year was answered
//     by the coach they had THEN. Printing their current coach's name over it
//     would attribute a refusal to somebody who never made it.
//
// And null, which is its own state twice over — a row answered before the
// column existed, and a row whose answerer has since deleted their account
// (`on delete set null`). Null is not "the coach"; `answererOf` says so and
// `answeredByLine` declines to write a sentence it cannot support.
//
// Pure — no React, no Supabase, no clock. The time label arrives already
// formatted, because a locale belongs to the reader and `appLocale()` is where
// that is settled.
import type { RequestOutcome } from './sessionRequests';

/** Which of the three accounts answered it, or that the record does not say. */
export type RequestAnswerer = 'you' | 'coach' | 'someone-else' | 'unrecorded';

/**
 * Read `answered_by` against the two ids the row already carries.
 *
 * Identity, not a guess. The member's own id and the coach's are both on the
 * request, so this needs nothing from the outside and cannot be told a
 * different story by a stale profile read.
 */
export function answererOf(r: {
  clientId: string; trainerId: string; answeredBy: string | null;
}): RequestAnswerer {
  if (!r.answeredBy) return 'unrecorded';
  if (r.answeredBy === r.clientId) return 'you';
  if (r.answeredBy === r.trainerId) return 'coach';
  return 'someone-else';
}

/**
 * The line under the outcome saying who settled it and when.
 *
 * Null for a request nobody has answered — 'asked' is a live question and
 * 'expired' was settled by the clock rather than by a person, so neither has an
 * answerer to name. Null too where the record holds neither a name nor a date,
 * because "answered by somebody at some point" tells a reader nothing the
 * outcome label has not already told them.
 *
 * `coachName` is null wherever the coach could not be read, which is the
 * ORDINARY case on the client side: src/lib/threadPeer.ts records that no
 * `profiles` policy runs client → coach for most accounts. The fallback is a
 * description rather than a dash — see scripts/check-prose.mjs for the screen
 * that shipped having lost the first word of its sentence to exactly this.
 */
export function answeredByLine(
  outcome: RequestOutcome,
  who: RequestAnswerer,
  coachName: string | null,
  whenAnswered: string | null,
): string | null {
  if (outcome !== 'accepted' && outcome !== 'declined' && outcome !== 'withdrawn') return null;
  const verb = outcome === 'accepted' ? 'Accepted' : outcome === 'declined' ? 'Declined' : 'Taken back';
  const on = whenAnswered ? ` on ${whenAnswered}` : '';
  switch (who) {
    case 'you':
      return `${verb} by you${on}.`;
    case 'coach':
      return `${verb} by ${coachName ?? 'your coach'}${on}.`;
    case 'someone-else':
      // Said plainly rather than smoothed into "your coach". A member who has
      // changed coach has a history full of answers the person currently
      // coaching them never gave, and naming them would be this screen
      // inventing an attribution out of a foreign key.
      return `${verb}${on} by a coach who is not the one you have now.`;
    case 'unrecorded':
      // The date without the name where there is a date, and nothing at all
      // where there is neither. `answered_at` and `answered_by` are separate
      // columns and one can outlive the other — a coach who deletes their
      // account nulls the second and leaves the first standing.
      return whenAnswered ? `Answered on ${whenAnswered}. The record does not say by whom.` : null;
  }
}
