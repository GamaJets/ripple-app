"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardOverwrite = guardOverwrite;
const ALLOWED = { allowed: true, reason: null, label: null };
/**
 * May this screen save over `subject`, given how the read of it went?
 *
 * `subject` is a plain-English noun phrase naming the thing that would be
 * replaced — "Priya's current programme", "the programmes these clients are
 * on" — because the sentence this returns is rendered to a coach, and a coach
 * needs to know what they are being stopped from overwriting rather than which
 * provider was unhappy.
 */
function guardOverwrite(status, subject) {
    switch (status) {
        case 'ready':
            return ALLOWED;
        case 'loading':
            return {
                allowed: false,
                label: 'Checking What Is Saved…',
                reason: `Still reading ${subject}. Saving now could replace something this screen has not seen yet — this takes a moment.`,
            };
        case 'partial':
            return {
                allowed: false,
                label: 'Cannot save over an unread plan',
                reason: `Only part of ${subject} came back, so this screen cannot tell whether there is already something there. Saving would replace it with what is on this screen and there is no undo, so the save is held until the whole thing has been read.`,
            };
        case 'error':
            return {
                allowed: false,
                label: 'Cannot save over an unread plan',
                reason: `${subject} could not be read, so this screen does not know what is currently saved. Saving would replace it with what is on this screen and there is no undo — try again once you have signal.`,
            };
    }
}
