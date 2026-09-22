// What became of one piece of app feedback — in a word, and in a sentence.
//
// ── the distinction this file exists to keep ──────────────────────────────
//
// `submitAppFeedback` used to answer `{ ok: false, reason: string }`, and the
// screen above it could not tell a REFUSAL from a DROPPED CONNECTION, because
// both arrived as the same false with a message beside it. Those two are not
// the same event and they do not take the same sentence: a refusal answers the
// same way every time the same bytes are offered, and a dropped connection is
// the one case where "try again in a minute" is honest advice. The screen
// declined to guess by reading the message text, which was right — a sentence
// is not a discriminator — so the fact had to come from here instead.
//
// ── why 'unsent' is not one of the words below ────────────────────────────
//
// src/lib/offlineQueue.ts names three outcomes for a write, and its definition
// of `unsent` is a PROMISE about what happens next: "the row is real, it stays
// on this device, it stays counted, and it goes up on the next launch that
// reaches a server." That promise is kept by an outbox — src/lib/outbox.ts,
// src/ui/recordOutbox.ts, src/lib/threadOutbox.ts — and there is no outbox
// behind app feedback. Nothing queues it, nothing retries it, nothing counts it
// in front of the member.
//
// So `classifyWrite` returning 'unsent' here does not mean what 'unsent' means
// everywhere else in this codebase. It means only "nobody answered", and the
// consequence in this one place is that the feedback is gone. Carrying the word
// through would be borrowing a promise this path cannot keep, and a member who
// has seen "waiting to send from this phone" once will read it as that. Hence
// `undelivered`: a word with no queue in it, in a union that has no 'unsent'
// member for the screen to accidentally handle.
//
// If an outbox is ever put behind this write, 'unsent' becomes reachable and
// this type has to grow a member for it. That is a product change, and this
// paragraph is where it gets argued rather than where the copy quietly becomes
// wrong.
//
// ── why the raw error is not in this file at all ──────────────────────────
//
// `new row violates row-level security policy for table "feedback"` reached the
// alert verbatim, above a paragraph of carefully written plain English. It is
// the right text for `reportError` and it is not a sentence anybody outside
// this repo can act on. The failure branch therefore carries a fate and
// nothing else: there is no `reason` field for a later edit to paste back into
// the alert, and `feedbackNote` takes only the fate, so the raw string has no
// route to a screen that the type checker would not stop.
import { classifyWrite, type WriteError } from './offlineQueue';
import { authGateMessage } from './authedUid';
import type { AuthReadFate } from './authReadFate';

/**
 * Everything that can become of one submission.
 *
 * The two auth fates are `AuthReadFate`'s own, spliced in rather than
 * re-spelled, so the discrimination between "signed out" and "could not ask"
 * stays the single one in src/lib/authReadFate.ts. Five lanes have built and
 * tested that; a sixth copy of it here would be a second thing to keep true.
 */
export type FeedbackFate = 'sent' | 'refused' | 'undelivered' | AuthReadFate;

/**
 * What the write did, from what supabase-js handed back.
 *
 * `rows` is the length of what `.insert(…).select('id')` returned, or null when
 * the call threw and returned nothing to count.
 *
 * On the counting: an RLS-violating INSERT is NOT the zero-row case
 * `classifyWrite` warns about. Postgres raises 42501 for a failed WITH CHECK
 * rather than narrowing the statement to nothing, and `fb_own` lets the author
 * select the row back, so before this change `error === null` did genuinely
 * mean the row had landed — the old code was not claiming success from the
 * absence of an error in the sense the house rule forbids. The count is here
 * because it makes the fate legible in one call rather than because it is
 * repairing a lie, and because the day a policy or a trigger does narrow this
 * insert, the answer moves to 'refused' on its own.
 */
export function feedbackWriteFate(
  error: WriteError | null | undefined, rows: number | null,
): 'sent' | 'refused' | 'undelivered' {
  const out = classifyWrite(error, rows);
  if (out === 'stored') return 'sent';
  if (out === 'refused') return 'refused';
  // 'unsent' — see the header. Nobody answered, and nothing is holding it.
  return 'undelivered';
}

/** Said once, because it is the fact every failure here shares and the one the
 *  member is most likely to assume the opposite of. */
const NOTHING_QUEUED =
  'Nothing was queued. This is not saved anywhere, nobody has seen it, and it will not go later on its own.';

/**
 * THE FOUR SENTENCES, and the contrast is the design.
 *
 *  · refused says the server READ it and said no, and that the same words will
 *    get the same answer. It may assert that, because a refusal is evidence:
 *    a CHECK constraint and an RLS policy answer identically every time.
 *  · undelivered says it never got there, and that trying again on a working
 *    connection is worth doing. It must NOT say "the same answer will come
 *    back", which is the advice the old single sentence gave to both.
 *  · the two auth fates take `authGateMessage`'s wording unchanged. The gate
 *    returns BEFORE the insert, which is the condition its "nothing has been
 *    changed" clause documents for its callers, and this one meets it.
 *
 * Every one of them ends by saying the words are still on screen, because the
 * one thing a member can always do is copy them out.
 */
export function feedbackNote(fate: FeedbackFate): string | null {
  // Nothing to apologise for. Null rather than a sentence, so a caller renders
  // the failure alert or does not, without a second condition — the same shape
  // `unsentNote` uses for a queue with nothing in it.
  if (fate === 'sent') return null;
  if (fate === 'refused') {
    return `${NOTHING_QUEUED}\n\n`
      + 'The server read this and turned it down, so sending the same words again will get the same '
      + 'answer. Your words are still in the box, so you can copy them out, or change them and try again.';
  }
  if (fate === 'undelivered') {
    return `${NOTHING_QUEUED}\n\n`
      + 'It never reached us, so there is nothing wrong with what you wrote. Your words are still in '
      + 'the box. Send again once you are back on a connection.';
  }
  return `${authGateMessage(fate)}\n\n${NOTHING_QUEUED} Your words are still in the box.`;
}
