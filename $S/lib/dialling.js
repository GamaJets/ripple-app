"use strict";
// Turning something a person typed into a number a phone will actually ring.
//
// ── Why this is its own module ─────────────────────────────────────────────
//
// Two screens need it and they are as far apart as two screens in this app get.
//
// `app/(trainer)/leads.tsx` built its own — `tel:${lead.contact.replace(/[^\d+]/g,
// '')}` — behind `contactKind` in src/lib/leads.ts, which is the guard that
// stops a coach dialling an Instagram handle. That is the right shape and it
// was inline, so nothing else could have it.
//
// `app/(trainer)/client-intake.tsx` rendered the EMERGENCY CONTACT number as a
// plain `<Text>`. That number exists for one situation, and in that situation
// the coach is holding a phone, four taps deep in a screen they opened before a
// first session rather than during an incident, and cannot get a string out of
// a Text node. An enquiry from a stranger could be rung with one tap; the
// person to call when a client collapses could not.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// A number is offered as dialable only when it IS one, and `null` is a real
// answer that the screen draws as ordinary text. Offering to dial something
// that cannot be dialled is worse than offering nothing, because the coach
// finds out after they have tapped it — which is the argument src/lib/leads.ts
// already makes about 'unknown', in the same words, one module along.
//
// No React, no Linking, no device: what a URL should be is decided here and
// asserted under `npm test`; opening it is the screen's business.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIAL_UNAVAILABLE_NOTE = exports.isDialable = exports.MAX_DIAL_DIGITS = exports.MIN_DIAL_DIGITS = void 0;
exports.telUrl = telUrl;
/** The shortest real subscriber number, and the longest E.164 permits. The same
 *  bounds `contactKind` in src/lib/leads.ts uses, and for the same reason:
 *  below the first is a room extension, above the second is somebody's account
 *  id typed into the wrong box. */
exports.MIN_DIAL_DIGITS = 7;
exports.MAX_DIAL_DIGITS = 15;
/**
 * The `tel:` URL for what somebody typed, or null when it is not a number.
 *
 * Everything that is not a digit is dropped, and a leading `+` is kept —
 * country codes are the one piece of punctuation that changes which phone
 * rings. A `+` anywhere else is a typo and goes with the brackets, spaces,
 * dashes and dots people separate numbers with.
 *
 * Text after the number goes too: "07700 900123 (mum)" is a number with a note
 * beside it, and dialling the note is not a thing a phone can do.
 */
function telUrl(raw) {
    const s = String(raw ?? '').trim();
    if (!s)
        return null;
    const plus = s.startsWith('+');
    const digits = s.replace(/\D/g, '');
    if (digits.length < exports.MIN_DIAL_DIGITS || digits.length > exports.MAX_DIAL_DIGITS)
        return null;
    // An extension written as "020 7946 0000 x214" would dial the wrong thing
    // with the extension silently welded on, so anything but a number and its
    // separators is refused outright rather than cleaned up into a guess.
    if (!/^\+?[\d\s().\-\u2010-\u2015]+$/.test(s))
        return null;
    return `tel:${plus ? '+' : ''}${digits}`;
}
/** Whether a screen may offer to ring this. */
const isDialable = (raw) => telUrl(raw) != null;
exports.isDialable = isDialable;
/**
 * What to say when the phone would not open the dialler.
 *
 * Never "call failed": nothing was called. It says where the number still is,
 * because the coach reading this is the person who needs it now.
 */
exports.DIAL_UNAVAILABLE_NOTE = 'Your phone would not open its dialler for that. The number is on the screen behind this — read it out or type it in by hand.';
