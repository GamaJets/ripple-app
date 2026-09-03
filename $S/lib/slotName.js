"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slotWho = slotWho;
exports.slotLabel = slotLabel;
exports.slotWhoName = slotWhoName;
exports.unnamedSlotNote = unnamedSlotNote;
/** Whether the roster in hand is the coach's whole book. Only under 'ready' may
 *  a missing id be read as "not on your book"; under anything else the list is
 *  short for a reason that has nothing to do with the client. */
const whole = (status) => status === 'ready';
/**
 * What is actually known about who is in this slot.
 *
 * Separated from the words so both of the sentences below are built from one
 * decision rather than two that can drift apart, and so a screen can branch on
 * the fact — a booked hour nobody can name is still a booked hour, and may need
 * to be drawn as one.
 */
function slotWho(clientId, roster) {
    if (!clientId)
        return 'open';
    const found = roster.find((c) => c.id === clientId);
    if (!found)
        return 'unread';
    return found.name && found.name.trim() ? 'named' : 'unnamed';
}
/**
 * The label on a row or in a list.
 *
 * Sentence-shaped fragments rather than a name, because there is no name: what
 * a coach needs from this line is whether the hour is spoken for, and every arm
 * but the first says that it is.
 */
function slotLabel(clientId, roster, status) {
    const who = slotWho(clientId, roster);
    if (who === 'open')
        return 'Open slot';
    if (who === 'named')
        return roster.find((c) => c.id === clientId).name.trim();
    if (who === 'unnamed')
        return 'Booked · no name on their record';
    return whole(status)
        ? 'Booked · not on your book any more'
        : 'Booked · your roster could not be read, so they cannot be named';
}
/**
 * The same person inside running prose — "cancel the 6pm with …".
 *
 * A separate function and not the label, because "6pm with Booked · not on your
 * book any more was cancelled" is a sentence that has come apart. Every arm
 * here is a noun phrase that can stand where a name would.
 */
function slotWhoName(clientId, roster, status) {
    const who = slotWho(clientId, roster);
    if (who === 'open')
        return 'nobody';
    if (who === 'named')
        return roster.find((c) => c.id === clientId).name.trim();
    if (who === 'unnamed')
        return 'the client in this slot, who has no name on their record';
    return whole(status)
        ? 'a client who is no longer on your book'
        : 'a client this screen could not name';
}
/**
 * The sentence to put under a booked hour whose client could not be named, or
 * null when there is nothing to add.
 *
 * Said out loud rather than left to be inferred from an odd-looking label,
 * because the coach's next decision is whether to give the hour away.
 */
function unnamedSlotNote(clientId, roster, status) {
    const who = slotWho(clientId, roster);
    if (who === 'open' || who === 'named')
        return null;
    if (who === 'unnamed') {
        return 'This hour is booked. The client record behind it carries no name, so there is nobody to print here — it is not an open slot.';
    }
    return whole(status)
        ? 'This hour is booked by somebody who is not on your book any more, so their name cannot be shown. It is not an open slot — cancelling it frees a session somebody arranged.'
        : 'This hour is booked. Your roster did not come back, so their name is unknown — this is not an open slot, and it must not be given to anybody else until the list loads.';
}
