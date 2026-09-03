"use strict";
// Where Stripe is allowed to send somebody when it has finished with them.
//
// Six functions take a URL out of the request body and hand it to Stripe as the
// place to return to:
//
//   stripe-portal      return_url      on a Billing Portal session
//   stripe-checkout    success_url / cancel_url
//   connect-onboard    refresh_url / return_url   on an Account Link
//   gym-onboard        refresh_url / return_url   on an Account Link
//   gym-checkout       success_url / cancel_url
//   connect-checkout   success_url / cancel_url, and return_url on two portals
//
// Every one of them was `String(body.success_url || 'repple://…')` with nothing
// in between.
//
// ── What that is, and — just as importantly — what it is not ──────────────
//
// It is NOT account takeover and it is not a way to reach another person's
// money. In all six the principal who supplies the URL is the same principal
// who is redirected to it: a coach opening their own billing portal, a coach
// onboarding their own Stripe account, a client buying their own package. The
// resulting link is returned to that caller and to nobody else. There is no
// stored link, no link handed to a third party, and no secret in the query
// string — none of these functions uses Stripe's `{CHECKOUT_SESSION_ID}`
// template. So a person can, at most, arrange to be redirected somewhere they
// already chose to go.
//
// What it IS, is two things worth closing anyway:
//
//   · a lure. Anybody who can sign in can mint a REAL `checkout.stripe.com`
//     page on the platform's own Stripe account whose "return to merchant"
//     link points at a site they control. The Stripe page is genuine, which is
//     the whole value of it to somebody building a phishing flow, and the only
//     part that is theirs is the last hop.
//   · a value from a request body reaching a payments API unread. That is the
//     shape `stripe-checkout`'s own header spends thirty lines on for
//     `price_id`, and the answer there was an allow-list. This is the same
//     answer for the same reason.
//
// ── Why the default is not a closed list ──────────────────────────────────
//
// Because the list is not knowable from here. Repple is white-label: the app
// schemes and the web origin come from `BRAND` in src/lib/brands.ts, chosen at
// BUILD time per binary, and a Supabase project may serve more than one of
// them. Hard-coding `repple://` in a shared module would be exactly the
// assumption the brand registry exists to remove — and the failure mode of
// getting it wrong is not a warning, it is a coach who cannot onboard and a
// client whose purchase 400s.
//
// So this is in two halves, and only the first is on by default:
//
//   ALWAYS  a URL must be a URL: an absolute one, with a scheme, no whitespace
//           and no backslash, and its scheme may not be one of the four that
//           are never a redirect target. Nothing brand-shaped is assumed, so
//           this cannot refuse a caller any deployment actually has.
//
//   WHEN CONFIGURED  `REDIRECT_ALLOW`, a comma-separated list of prefixes, is
//           the closed list. Set it and everything else is refused.
//
// For the Repple deployment as it stands the value is:
//
//   repple://,repplecoach://,repplestudio://,https://repplefitness.com,https://www.repplefitness.com
//
// Both hosts, because the two callers disagree: `src/lib/connect.ts` sends
// `${WEB_ORIGIN}/connect-return` — `https://repplefitness.com`, no `www` —
// while the server-side default in connect-onboard and gym-onboard is
// `https://www.repplefitness.com/connect-return`. That disagreement predates
// this file and is reported rather than silently picked between.
//
// ── this is a leaf, deliberately ──────────────────────────────────────────
//
// An edge function imports this, so it may have NO relative imports of its own:
// Deno resolves a specifier literally and an extensionless one throws on the
// function's first request. See scripts/check-functions.mjs. That is also why
// this does not read `brands.ts` for the list, quite apart from the argument
// above — that file imports, even if only a type.
//
// ── why prefix matching and not `new URL` ─────────────────────────────────
//
// `new URL` is used to REJECT, never to match. For a non-special scheme its
// parse is surprising in a way that matters here: `new URL('repple://billing')`
// yields a host of `billing` and an empty path, so the segment the app means as
// a screen name arrives as a hostname. Matching on `origin` would then compare
// two things that are not the same kind of thing. A lowercased prefix with an
// explicit boundary check says what it means, and the boundary is the part that
// matters — without it `https://repplefitness.com` also admits
// `https://repplefitness.com.example.invalid/`, which is the classic way an
// origin allow-list is got round.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRedirect = exports.parseRedirectAllow = exports.schemeOf = exports.HOSTILE_SCHEMES = void 0;
/** Schemes that are never somewhere to send a person, whatever the list says.
 *
 *  `javascript:` and `data:` are script execution in whatever context follows
 *  the redirect; `vbscript:` is the same on the one platform that still has it;
 *  `file:` reads the device. None of these is refused by the shape of the rest
 *  of this module, because each of them is a perfectly well-formed absolute URL
 *  — which is the point of naming them. */
exports.HOSTILE_SCHEMES = ['javascript', 'data', 'vbscript', 'file'];
/** The scheme of an absolute URL, lowercased, or null when there is not one.
 *
 *  Deliberately stricter than a browser: leading whitespace is not stripped
 *  before the scheme is read, because `\njavascript:alert(1)` is a string some
 *  parsers accept and this one should not have to know which. The caller trims
 *  once, up front, and anything left inside is a refusal. */
const schemeOf = (url) => {
    const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(url);
    return m ? m[1].toLowerCase() : null;
};
exports.schemeOf = schemeOf;
/**
 * The configured allow-list, or an empty list when nobody has said.
 *
 * Entries are lowercased and trimmed; empty entries are dropped rather than
 * becoming a prefix that matches everything — `'a,,b'.split(',')` yields an
 * empty string in the middle, and an empty prefix admits every URL there is,
 * which would turn a trailing comma into the whole gate being off.
 */
const parseRedirectAllow = (raw) => {
    if (typeof raw !== 'string')
        return [];
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
};
exports.parseRedirectAllow = parseRedirectAllow;
/** Does `url` sit under `entry`?
 *
 *  Both already lowercased. An entry ending in `/` is a prefix and needs no
 *  boundary — `repple://` is satisfied by anything after it. An entry that does
 *  not, such as `https://repplefitness.com`, must be followed by the end of the
 *  string or by one of the three characters that can end an origin, so that a
 *  longer hostname beginning with the same letters is not admitted. */
const under = (url, entry) => {
    if (!url.startsWith(entry))
        return false;
    if (entry.endsWith('/'))
        return true;
    const next = url.charAt(entry.length);
    return next === '' || next === '/' || next === '?' || next === '#';
};
/**
 * The URL to give Stripe, or the reason there is not one.
 *
 * `offered` is whatever arrived in the body — any type, because a body is not a
 * promise about types and `String({})` is `'[object Object]'`, which every one
 * of these six functions was sending to Stripe unexamined.
 *
 * An ABSENT `offered` — undefined, null, or the empty string — is not a
 * refusal: it is the ordinary case of a caller that named no URL, and the
 * function's own `fallback` constant is returned unchecked. Unchecked because
 * it is the server's own literal and not the caller's: running the fallback
 * through the allow-list would mean a mistyped `REDIRECT_ALLOW` breaking the
 * path that has no caller input in it at all, which is the one path that cannot
 * be at fault.
 *
 * `reason` is written to be shown to a person. It names no internals and it
 * says that nothing was charged, because the only place a caller will ever read
 * it is a screen where they were trying to pay.
 */
const checkRedirect = (offered, fallback, allow) => {
    if (offered === undefined || offered === null || offered === '')
        return { ok: true, url: fallback };
    if (typeof offered !== 'string') {
        return { ok: false, reason: 'That return address was not a web address, so nothing has been charged.' };
    }
    const url = offered.trim();
    if (!url)
        return { ok: true, url: fallback };
    // Whitespace and control characters inside a URL are how one string is read
    // two ways by two parsers. A backslash is the same problem with a sharper
    // edge: `https://good.example\@evil.example/` is one host to a person reading
    // it and another to a browser.
    if (/[\s\u0000-\u001f\u007f\\]/.test(url)) {
        return { ok: false, reason: 'That return address is not a web address this app can use, so nothing has been charged.' };
    }
    const scheme = (0, exports.schemeOf)(url);
    if (!scheme) {
        // No scheme at all. `//evil.example/x` is protocol-relative and is a
        // redirect to another site everywhere it is honoured.
        return { ok: false, reason: 'That return address is not a complete web address, so nothing has been charged.' };
    }
    if (exports.HOSTILE_SCHEMES.includes(scheme)) {
        return { ok: false, reason: 'That return address is not a place this app will send anybody, so nothing has been charged.' };
    }
    // A last parse, for the shapes the checks above do not name. A URL this
    // cannot read is one Stripe and the device would each guess at separately.
    try {
        new URL(url);
    }
    catch {
        return { ok: false, reason: 'That return address could not be read as a web address, so nothing has been charged.' };
    }
    if (!allow.length)
        return { ok: true, url };
    const lower = url.toLowerCase();
    if (allow.some((entry) => under(lower, entry)))
        return { ok: true, url };
    return { ok: false, reason: 'That return address is not one this app returns to, so nothing has been charged.' };
};
exports.checkRedirect = checkRedirect;
