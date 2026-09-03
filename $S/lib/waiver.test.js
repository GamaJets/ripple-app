"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The release of liability a client agrees to before they train, and the one
// rule that decides whether they have. Compile with tsc, run with node.
//
// The assertion that matters most here is the one about an unreadable record.
// A failed read of `liability_waivers` is not evidence that somebody signed,
// and it is not evidence that they didn't — and this gate is on the wrong side
// of a legal record if it ever treats it as either.
const waiver_1 = require("./waiver");
const brands_1 = require("./brands");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// Still reading is its own answer, distinct from both outcomes.
eq((0, waiver_1.waiverState)(null), 'loading', 'a read in flight says so');
// A failed read must not pass for a signed release — nor for an unsigned one.
eq((0, waiver_1.waiverState)({ ok: false, versions: [] }), 'unknown', 'an unreadable record is not an unsigned one');
eq((0, waiver_1.waiverState)({ ok: false, versions: [waiver_1.WAIVER_VERSION] }), 'unknown', 'rows returned alongside an error are not a signed release either');
// A read that completed and came back empty is a real "they have not signed".
eq((0, waiver_1.waiverState)({ ok: true, versions: [] }), 'needed', 'a completed empty read is an unsigned release');
eq((0, waiver_1.waiverState)({ ok: true, versions: [waiver_1.WAIVER_VERSION] }), 'accepted', 'the current wording, agreed');
// Agreeing to older wording is not agreeing to this wording.
eq((0, waiver_1.waiverState)({ ok: true, versions: ['1999-01-01'] }), 'needed', 'superseded wording does not carry over');
eq((0, waiver_1.waiverState)({ ok: true, versions: ['1999-01-01', waiver_1.WAIVER_VERSION] }), 'accepted', 'an older acceptance alongside the current one still counts');
// Both boxes, or it is not a release.
eq((0, waiver_1.bothGiven)({}), false, 'nothing ticked is not agreement');
eq((0, waiver_1.bothGiven)({ physician: true, release: true }), true, 'both ticked is agreement');
// Every clause is genuinely required. Adding a third clause without extending
// the gate fails here rather than shipping a waiver with an optional term.
for (const c of waiver_1.WAIVER_CLAUSES) {
    const all = {};
    for (const o of waiver_1.WAIVER_CLAUSES)
        all[o.key] = true;
    all[c.key] = false;
    eq((0, waiver_1.bothGiven)(all), false, `"${c.key}" is required`);
}
// The two things the client asked for are actually in the wording, on the
// record the client signs — not merely in a heading above it.
ok(waiver_1.WAIVER_CLAUSES.some((c) => /physician|doctor/i.test(c.label + c.detail)), 'the release tells them to consult a physician first');
ok(waiver_1.WAIVER_CLAUSES.some((c) => /release|liabilit/i.test(c.label + c.detail)), 'the release actually releases liability');
// ── and who it releases ─────────────────────────────────────────────────────
//
// This is the one document in the app that decides who pays if somebody is
// hurt. It named "Repple" on every build, including the ones published under a
// gym chain's own name, with their own bundle id, in their own store listing.
{
    const wording = waiver_1.WAIVER_CLAUSES.map((c) => c.label + ' ' + c.detail).join(' ');
    ok(wording.includes(brands_1.BRAND.label), 'THE PARTY BEING RELEASED IS THE BRAND THIS BUNDLE IS PUBLISHED UNDER');
    ok(brands_1.BRAND.id === brands_1.DEFAULT_BRAND_ID || !/Repple/.test(wording), 'and a white-label member is never asked to release a company named nowhere else on their phone');
    // The version identifies the wording, and two brands are two wordings. A
    // stored acceptance that cannot say which one it was is not a record.
    ok(waiver_1.WAIVER_VERSION.startsWith('2026-08-31'), 'the wording date is still the front of the version');
    eq(waiver_1.WAIVER_VERSION === '2026-08-31', brands_1.BRAND.id === brands_1.DEFAULT_BRAND_ID, 'Repple’s own string is unchanged — every acceptance in the wild is Repple’s and must keep matching');
    ok(brands_1.BRAND.id === brands_1.DEFAULT_BRAND_ID || waiver_1.WAIVER_VERSION.includes(brands_1.BRAND.id), 'and another brand’s release is filed under its own version, not over Repple’s');
}
// ── what the gate actually does with each of those ──────────────────────────
eq((0, waiver_1.waiverGate)('loading', false), 'wait', 'a read in flight neither blocks nor passes');
eq((0, waiver_1.waiverGate)('accepted', false), 'pass', 'a signed release is let through');
eq((0, waiver_1.waiverGate)('needed', false), 'block', 'an unsigned release is asked for');
// A confirmed "not signed" is never waved through, however familiar the reader
// looks to this device. This is the assertion that stops the offline allowance
// below from quietly becoming "signed once, never asked again".
eq((0, waiver_1.waiverGate)('needed', true), 'block', 'a confirmed unsigned release is asked for even on a known device');
// An unreadable record is not grounds to lock out somebody this device has
// already watched accept — they are let through and re-checked next launch.
eq((0, waiver_1.waiverGate)('unknown', true), 'pass', 'a known signer is not locked out by a failed read');
// But somebody this device has never seen accept might be signing for the
// first time, so an unreadable record is not a way past the release.
eq((0, waiver_1.waiverGate)('unknown', false), 'block', 'an unknown reader cannot get in on a failed read');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`waiver: ok (${waiver_1.WAIVER_CLAUSES.length} clauses, version ${waiver_1.WAIVER_VERSION})`);
