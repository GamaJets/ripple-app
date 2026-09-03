"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The return address six payment functions hand to Stripe.
//
// Two things are being asserted, and they are different in kind. The first is
// that the always-on half cannot refuse a caller any real deployment has — a
// gate that breaks onboarding is worse than the shape it was closing, because
// the shape is a lure and the break is a coach who cannot get paid. The second
// is that when a list IS configured, the ways an origin allow-list is usually
// got round do not work: a longer hostname that starts with the right letters,
// a userinfo `@`, a backslash, a protocol-relative URL.
const redirectTarget_1 = require("./redirectTarget");
process.exitCode = 1;
const errors = [];
const ok = (cond, what) => { if (!cond)
    errors.push(what); };
const eq = (a, b, what) => {
    if (a !== b)
        errors.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
/** The URL a verdict allows, or null when it refused. Keeps every assertion
 *  below to one line and one comparison. */
const allowed = (offered, fallback, allow = []) => {
    const v = (0, redirectTarget_1.checkRedirect)(offered, fallback, allow);
    return v.ok ? v.url : null;
};
const FALLBACK = 'repple://billing';
/* ── the list, read from a secret ───────────────────────────────────────── */
eq((0, redirectTarget_1.parseRedirectAllow)(undefined).length, 0, 'an unset secret is an empty list');
eq((0, redirectTarget_1.parseRedirectAllow)(null).length, 0, 'a null secret is an empty list');
eq((0, redirectTarget_1.parseRedirectAllow)('').length, 0, 'an empty secret is an empty list');
eq((0, redirectTarget_1.parseRedirectAllow)('   ').length, 0, 'a whitespace secret is an empty list');
eq((0, redirectTarget_1.parseRedirectAllow)('repple://').join('|'), 'repple://', 'one entry');
eq((0, redirectTarget_1.parseRedirectAllow)(' repple:// , https://A.example ').join('|'), 'repple://|https://a.example', 'entries are trimmed and lowercased');
// The trailing comma. An empty entry is a prefix that matches every string
// there is, so keeping it would turn a typo into the gate being off.
eq((0, redirectTarget_1.parseRedirectAllow)('repple://,,https://a.example,').length, 2, 'empty entries are dropped');
ok(!(0, redirectTarget_1.parseRedirectAllow)('repple://,,').includes(''), 'no empty prefix survives');
/* ── the scheme ─────────────────────────────────────────────────────────── */
eq((0, redirectTarget_1.schemeOf)('https://a.example/x'), 'https', 'https');
eq((0, redirectTarget_1.schemeOf)('HTTPS://a.example/x'), 'https', 'a scheme is lowercased');
eq((0, redirectTarget_1.schemeOf)('repple://billing'), 'repple', 'a custom scheme');
// RFC 3986 allows `+`, `.` and `-` inside a scheme, and Expo's own dev URLs use
// the `exp+<slug>` form. Reading it as a scheme is correct; whether it is an
// ALLOWED one is the list's question, not this function's.
eq((0, redirectTarget_1.schemeOf)('exp+repple://x'), 'exp+repple', 'a scheme may carry a plus');
eq((0, redirectTarget_1.schemeOf)('+bad://x'), null, 'a scheme may not begin with a symbol');
eq((0, redirectTarget_1.schemeOf)('exp://192.0.2.1:8081/--/billing'), 'exp', 'the Expo dev scheme reads');
eq((0, redirectTarget_1.schemeOf)('//a.example/x'), null, 'protocol-relative has no scheme');
eq((0, redirectTarget_1.schemeOf)('/billing'), null, 'a path has no scheme');
eq((0, redirectTarget_1.schemeOf)('a.example/x'), null, 'a bare host has no scheme');
/* ── nothing offered is not a refusal ───────────────────────────────────── */
//
// The ordinary case. A caller that names no URL gets the function's own
// literal, and gets it WITHOUT the allow-list being consulted: a mistyped
// REDIRECT_ALLOW must not break the one path with no caller input in it.
eq(allowed(undefined, FALLBACK), FALLBACK, 'undefined falls back');
eq(allowed(null, FALLBACK), FALLBACK, 'null falls back');
eq(allowed('', FALLBACK), FALLBACK, 'an empty string falls back');
eq(allowed('   ', FALLBACK), FALLBACK, 'whitespace falls back');
eq(allowed(undefined, FALLBACK, ['https://only.example']), FALLBACK, 'the fallback is returned even when the list would not admit it');
/* ── a body is not a string ─────────────────────────────────────────────── */
//
// `String({})` is `'[object Object]'`, and that is the value all six functions
// were sending to Stripe when a caller sent an object.
eq(allowed(0, FALLBACK), null, 'a number is refused');
eq(allowed(true, FALLBACK), null, 'a boolean is refused');
eq(allowed({}, FALLBACK), null, 'an object is refused');
eq(allowed(['https://a.example'], FALLBACK), null, 'an array is refused, even holding a URL');
eq(allowed({ toString: () => 'https://a.example' }, FALLBACK), null, 'an object that stringifies to a URL is refused');
/* ── the always-on half admits what deployments really send ─────────────── */
//
// With NO list configured. Every one of these is a string this repo is known to
// produce: `appLink()` in a dev build, in Expo Go, and `${WEB_ORIGIN}/…`.
for (const real of [
    'repple://billing',
    'repple://purchase/success',
    'repplecoach://billing/success',
    'repplestudio://membership',
    'exp://192.0.2.1:8081/--/billing',
    'https://repplefitness.com/connect-return',
    'https://www.repplefitness.com/connect-refresh',
    'https://example.com/connect-return',
]) {
    eq(allowed(real, FALLBACK), real, `with no list, ${real} is allowed through`);
}
/* ── …and refuses the shapes no deployment sends ────────────────────────── */
eq(allowed('javascript:alert(1)', FALLBACK), null, 'javascript: is refused with no list at all');
eq(allowed('JavaScript:alert(1)', FALLBACK), null, 'the scheme check is case-insensitive');
eq(allowed('data:text/html,<script>x</script>', FALLBACK), null, 'data: is refused');
eq(allowed('vbscript:msgbox', FALLBACK), null, 'vbscript: is refused');
eq(allowed('file:///etc/passwd', FALLBACK), null, 'file: is refused');
for (const s of redirectTarget_1.HOSTILE_SCHEMES)
    eq(allowed(`${s}:whatever`, FALLBACK), null, `${s}: is refused`);
eq(allowed('//evil.example/x', FALLBACK), null, 'a protocol-relative URL is refused');
eq(allowed('/billing', FALLBACK), null, 'a bare path is refused');
eq(allowed('evil.example/x', FALLBACK), null, 'a bare host is refused');
eq(allowed('https://good.example\\@evil.example/', FALLBACK), null, 'a backslash is refused — it is one host to a reader and another to a browser');
eq(allowed('https://good.example/\tx', FALLBACK), null, 'an embedded tab is refused');
eq(allowed('https://good.example/ x', FALLBACK), null, 'an embedded space is refused');
eq(allowed('https://good.example/\nx', FALLBACK), null, 'an embedded newline is refused');
// Leading whitespace is trimmed BEFORE the scheme is read, so this is a
// javascript: URL and is refused as one rather than as bad whitespace.
eq(allowed('   javascript:alert(1)', FALLBACK), null, 'leading whitespace does not hide a hostile scheme');
/* ── the configured list ────────────────────────────────────────────────── */
//
// The value this deployment would set. Both hosts, because the app sends
// `https://repplefitness.com` and the server default says `www.`.
const LIST = (0, redirectTarget_1.parseRedirectAllow)('repple://,repplecoach://,repplestudio://,https://repplefitness.com,https://www.repplefitness.com');
for (const real of [
    'repple://billing',
    'repple://purchase/success',
    'repplecoach://billing/cancel',
    'repplestudio://membership',
    'https://repplefitness.com/connect-return',
    'https://repplefitness.com',
    'https://repplefitness.com?x=1',
    'https://www.repplefitness.com/connect-refresh',
]) {
    eq(allowed(real, FALLBACK, LIST), real, `the list admits ${real}`);
}
for (const bad of [
    'https://evil.example/x',
    'exp://192.0.2.1:8081/--/billing',
    'reppleevil://billing',
    'http://repplefitness.com/connect-return',
]) {
    eq(allowed(bad, FALLBACK, LIST), null, `the list refuses ${bad}`);
}
/* ── the boundary, which is the whole point of the list ─────────────────── */
//
// A prefix test on its own admits every hostname that merely BEGINS with the
// allowed one. That is not a subtle bug — registering `repplefitness.com.<x>`
// is a thing anybody can do this afternoon.
eq(allowed('https://repplefitness.com.evil.example/x', FALLBACK, LIST), null, 'a longer hostname beginning with the allowed one is refused');
eq(allowed('https://repplefitness.commercial.example/', FALLBACK, LIST), null, 'a hostname that merely starts with the allowed one is refused');
eq(allowed('https://repplefitness.com@evil.example/', FALLBACK, LIST), null, 'userinfo before a different host is refused');
eq(allowed('https://repplefitness.com-evil.example/', FALLBACK, LIST), null, 'a hyphenated continuation is refused');
// And the three characters that may legitimately follow an origin do follow it.
eq(allowed('https://repplefitness.com/x', FALLBACK, LIST), 'https://repplefitness.com/x', 'a path follows');
eq(allowed('https://repplefitness.com?a=b', FALLBACK, LIST), 'https://repplefitness.com?a=b', 'a query follows');
eq(allowed('https://repplefitness.com#f', FALLBACK, LIST), 'https://repplefitness.com#f', 'a fragment follows');
/* ── case ───────────────────────────────────────────────────────────────── */
//
// Matched case-insensitively, because a host is case-insensitive and a scheme
// is too — but the URL handed to Stripe is the one the caller wrote, since the
// PATH is not case-insensitive and lowercasing it would send somebody to a
// different page.
eq(allowed('HTTPS://RepplefitnesS.com/Connect-Return', FALLBACK, LIST), 'HTTPS://RepplefitnesS.com/Connect-Return', 'the match ignores case and the URL passed on keeps it');
eq(allowed('REPPLE://Billing', FALLBACK, LIST), 'REPPLE://Billing', 'a custom scheme matches case-insensitively');
/* ── a hostile scheme is refused even if somebody lists it ──────────────── */
//
// The order matters: the hostile-scheme check runs before the list, so a
// mistyped or malicious REDIRECT_ALLOW cannot turn `javascript:` back on.
eq(allowed('javascript:alert(1)', FALLBACK, (0, redirectTarget_1.parseRedirectAllow)('javascript:')), null, 'listing javascript: does not admit it');
eq(allowed('data:text/html,x', FALLBACK, (0, redirectTarget_1.parseRedirectAllow)('data:,')), null, 'listing data: does not admit it');
/* ── refusals say something a person can read ───────────────────────────── */
const refusal = (0, redirectTarget_1.checkRedirect)('https://evil.example', FALLBACK, LIST);
ok(refusal.ok === false, 'the refusal is a refusal');
if (refusal.ok === false) {
    ok(refusal.reason.length > 0, 'a refusal carries a reason');
    ok(/nothing has been charged/.test(refusal.reason), 'a refusal on a payment path says nothing was charged');
    ok(!/evil\.example/.test(refusal.reason), 'a refusal does not echo the URL back');
}
ok(errors.length === 0, 'no errors');
if (errors.length) {
    console.error(`redirectTarget: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error('  ' + e);
    process.exit(1);
}
console.log('redirectTarget — ok');
process.exitCode = 0;
