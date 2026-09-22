// What a notification is allowed to say a message CONTAINED, when the message
// itself has no words in it.
//
// ── The silence this exists to end ─────────────────────────────────────────
//
// `messages.body` is NOT NULL and an attachment-only message carries '' — that
// is stated in supabase/parts/124 and it is the shape src/ui/messaging.ts
// writes: `hasSomethingToSend` lets a send through on the strength of a file
// alone. Two things then read that row and only one of them coped.
//
//   · src/ui/messaging.ts composed `b || 'Sent you a photo'` for its own push,
//     so the push said something true.
//   · supabase/functions/notify-message received `body` from the trigger,
//     found it empty, and returned `{ skipped: 'missing fields' }` — no inbox
//     row, no push, no log. That function is the ONLY writer of the inbox row
//     for a chat message (src/lib/notifyInbox.ts refuses to write a second one
//     precisely because the trigger writes the first).
//
// So a photograph sent with no caption produced no record anywhere, and the
// two filters in that function — a muted 'chat' channel and quiet hours, both
// live on this server — then had a push to suppress and no row behind it. A
// client photographing the machine they are stuck on at eleven at night, to a
// coach with quiet hours set, reached that coach NOWHERE, and their own screen
// said "Sent".
//
// The words are here rather than at either call site because there are now
// three of them — the app's push, the edge function's push, and the edge
// function's inbox row — and three places wording the same sentence is how the
// bell and the banner come to disagree about what arrived.
//
// The edge function runs under Deno and cannot import this module, so it
// repeats these two strings with a comment pointing here. That duplication is
// the same one `SendStage` in src/lib/readReceipt.ts carries and for the same
// reason; `PREVIEW_FOR_KIND` below is exported so the test can state what the
// strings are, and so a reword here is a reword the test notices.
import type { AttachmentKind } from './messageAttachments';

/** The sentence for a message that is only a file. Exported so the test — and
 *  a reader checking supabase/functions/notify-message against this file — can
 *  see both strings in one place. */
export const PREVIEW_FOR_KIND: Readonly<Record<AttachmentKind, string>> = {
  image: 'Sent you a photo',
  video: 'Sent you a video',
};

/**
 * What a message with no words in it still lets a notification say, when we do
 * not know what is on it.
 *
 * Reached two ways, and both are honest: a row written before
 * `attachment_kind` was carried to the notifier, and a row whose kind is
 * something this build does not recognise. It states that a message exists —
 * which the trigger firing proves — and claims nothing about its contents.
 */
export const PREVIEW_UNKNOWN = 'Sent you a message';

/**
 * The line a push and an inbox row may carry for one message.
 *
 * `body` wins whenever there is one: the sender's own words are always a better
 * preview than a description of the envelope, and a caption on a photograph is
 * the thing the other person most wants to see on the lock screen.
 *
 * Returns a non-empty string for EVERY input, and that is the whole contract.
 * The bug this replaces was a notifier treating an empty body as "there is
 * nothing here to tell anybody about" — so there is deliberately no branch that
 * can hand a caller '' back and let it make that decision again.
 */
export function messagePreview(
  body: string | null | undefined,
  kind: string | null | undefined,
): string {
  const b = (body ?? '').trim();
  if (b) return b;
  if (kind === 'image' || kind === 'video') return PREVIEW_FOR_KIND[kind];
  return PREVIEW_UNKNOWN;
}

/**
 * Whether a notifier has anything at all to say about this row.
 *
 * Always true once there is a thread key, and it is a function rather than a
 * missing `if` so the reasoning is written down where the old guard was: the
 * trigger fires AFTER INSERT, so a call reaching the notifier is a message that
 * exists. "The body is empty" is a fact about the words, never about whether
 * the message happened, and reading it as the second is what lost the
 * photographs.
 */
export function worthNotifying(clientId: string | null | undefined): boolean {
  return !!(clientId ?? '').trim();
}
