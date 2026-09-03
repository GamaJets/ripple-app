"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREVIEW_UNKNOWN = exports.PREVIEW_FOR_KIND = void 0;
exports.messagePreview = messagePreview;
exports.worthNotifying = worthNotifying;
/** The sentence for a message that is only a file. Exported so the test — and
 *  a reader checking supabase/functions/notify-message against this file — can
 *  see both strings in one place. */
exports.PREVIEW_FOR_KIND = {
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
exports.PREVIEW_UNKNOWN = 'Sent you a message';
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
function messagePreview(body, kind) {
    const b = (body ?? '').trim();
    if (b)
        return b;
    if (kind === 'image' || kind === 'video')
        return exports.PREVIEW_FOR_KIND[kind];
    return exports.PREVIEW_UNKNOWN;
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
function worthNotifying(clientId) {
    return !!(clientId ?? '').trim();
}
