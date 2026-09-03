"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERRAL_LINK_BASE = void 0;
exports.normaliseReferralCode = normaliseReferralCode;
exports.isPlausibleReferralCode = isPlausibleReferralCode;
exports.referralLink = referralLink;
exports.referralMessage = referralMessage;
// Where a member's referral invitation points, and what it says.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// One string, built inline on app/(client)/referral.tsx:
//
//   "Join me on <app> … Use my code TIM-4K9Z when you sign up."
//
// and nothing else. No link, no way to copy the code without selecting text
// that was not selectable, and no route that could carry the code. The friend
// had to READ SIX-ISH CHARACTERS off a message, find the app in a store, get
// through sign-up, and type them into an optional field near the bottom of the
// form. Every one of those steps loses people, and the ones it does not lose
// often arrive having forgotten the code — so the referral is credited to
// nobody and the member who made it sees "Nobody has used your code yet."
//
// src/ui/pendingJoinCode.ts already made exactly this argument about COACH
// codes and fixed it with a link that carries the code into the app. This is
// the same fix for the other kind of code, and the two are deliberately kept
// apart rather than merged — see below.
//
// ── Why a coach code and a referral code cannot share a parameter ──────────
//
// They look identical (a short alphanumeric string) and they mean opposite
// things. `?c=` is a COACH's join code: it prefills trainer search and ends in
// a coaching request the coach accepts. `?r=` is a MEMBER's referral code: it
// is recorded once at sign-up and creates no relationship with anybody.
//
// If they shared a parameter, a code that failed one lookup would be tried as
// the other — and `record_referral` keeps the FIRST code recorded for an
// account, permanently, with no way to revise it. A coach code mistakenly
// spent as a referral would attribute a new member to a stranger for the life
// of the account. Two parameters, two stores, and neither ever falls back to
// the other.
//
// Pure. No react, no storage, no network — so the shape of the link is
// assertable without a phone, which matters because this string is printed into
// somebody else's message and cannot be corrected after it is sent.
const brands_1 = require("./brands");
/**
 * The origin the invitation points at.
 *
 * The BRAND's, never a literal. A member of a white-label gym handing out
 * repplefitness.com links is advertising their gym's supplier to their gym's
 * friends, and the page they would land on offers a download of an app that is
 * not the one their gym uses — the same argument `JOIN_LINK_BASE` makes for the
 * coach's link one file over.
 */
exports.REFERRAL_LINK_BASE = `${brands_1.BRAND.joinOrigin}/join`;
/**
 * What a referral code may contain, after cleaning.
 *
 * Deliberately GENEROUS and deliberately not `joinCode.ts`'s rule. A referral
 * code is `referral_code_for(uid, full_name)` on the server — a name fragment,
 * a dash, and base-36 characters of a hash — so it is longer than six
 * characters, it contains a dash, and it can contain the letters and digits a
 * coach code excludes. Applying the coach rule here would reject every real
 * referral code.
 *
 * The server is the authority on whether a code exists. This exists only to
 * stop obvious rubbish being pasted into a URL.
 */
const REFERRAL_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,30}$/;
/**
 * What was typed or pasted → what to send.
 *
 * Uppercases, strips whitespace and anything that is not a letter, digit or
 * dash. Nothing is substituted for anything else: a guess that lands on a real
 * code credits a stranger, permanently, and the member who was actually
 * referred never finds out.
 */
function normaliseReferralCode(input) {
    return (input || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 32);
}
/** Whether this is worth sending to the server at all. */
function isPlausibleReferralCode(input) {
    return REFERRAL_CODE_RE.test(normaliseReferralCode(input));
}
/**
 * The bare link, and nothing else.
 *
 * Separate from the message below because the two go to different places. A
 * message is right for WhatsApp; a bare URL is what an Instagram bio, a TikTok
 * link-in-bio or a QR code takes, and those fields reject or mangle prose
 * around a link.
 *
 * Same URL either way, so a friend arriving from a forwarded message and a
 * friend arriving from a bio are attributed to the same code.
 */
function referralLink(code) {
    return `${exports.REFERRAL_LINK_BASE}?r=${encodeURIComponent(normaliseReferralCode(code))}`;
}
/**
 * The invitation a member sends.
 *
 * ── Why the code is in the message as well as in the link ─────────────────
 *
 * The link is the path that works without anybody typing anything, and it is
 * not the only path: a friend who cannot install right now, or who opens the
 * page on a desktop, or whose messaging app strips links, still has to be able
 * to finish. The code in plain text is the fallback that always works, and it
 * costs one line.
 *
 * `appName` is passed in rather than read from BRAND here, because the app name
 * comes from the TENANT at runtime (`useBrand().appName`) while the join origin
 * is fixed at build. Two different sources for two different facts, and reading
 * the wrong one is how a white-label member's invitation ends up naming Repple.
 */
function referralMessage(code, appName) {
    const c = normaliseReferralCode(code);
    return `Join me on ${appName} — I use it to plan my training, track what I lift and stay on top of what I eat.\n\n`
        + `${referralLink(c)}\n\n`
        + `If it asks for a code, mine is ${c}.`;
}
