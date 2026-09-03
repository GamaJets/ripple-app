"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A missing currency says which of four things happened. Compile with tsc, run
// with node.
//
// The bug these guard: a refused read and an unset setting both arrive as a
// null currency, and both screens printed "your gym has not set a currency" for
// either — sending a coach to chase their gym owner over a query that failed.
const currencyGap_1 = require("./currencyGap");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── a currency that IS available has no gap ───────────────────────────── */
eq((0, currencyGap_1.currencyGapOf)({ currency: 'AED', error: null, loading: false }), null, 'a read currency has nothing to explain');
eq((0, currencyGap_1.currencyGapOf)({ currency: 'GBP', error: 'something went wrong', loading: false }), null, 'a currency we have is a currency we have, whatever else failed');
eq((0, currencyGap_1.currencyGapOfStatus)({ currency: 'AED', status: 'ready' }), null, 'same from the status-carrying provider');
eq((0, currencyGap_1.currencyGapOfStatus)({ currency: 'AED', status: 'partial' }), null, 'a code from a partial read is still a code');
/* ── the four causes, kept apart ───────────────────────────────────────── */
eq((0, currencyGap_1.currencyGapOf)({ currency: null, error: null, loading: true }), 'reading', 'in flight is not an answer');
eq((0, currencyGap_1.currencyGapOf)({ currency: null, error: null, loading: false }), 'unset', 'read, and nobody has set one');
// THE bug. The gym read returns `{ currency: null, error }` on a refused
// profiles or tenants read, and the caller that looks at the currency first
// cannot tell this from the line above it.
eq((0, currencyGap_1.currencyGapOf)({ currency: null, error: 'permission denied for table profiles', loading: false }), 'unreadable', 'a refused read is unreadable, never unset');
eq((0, currencyGap_1.currencyGapOf)({ currency: null, error: 'Not signed in.', loading: false }), 'unreadable', 'no session is a read we could not make, not a gym with no currency');
eq((0, currencyGap_1.currencyGapOfStatus)({ currency: null, status: 'loading' }), 'reading', 'loading is in flight');
eq((0, currencyGap_1.currencyGapOfStatus)({ currency: null, status: 'error' }), 'unreadable', 'error is unknown');
// The half of the invoices bug that fell through: 'partial' means one of the
// two reads behind the currency failed, so an absent code is not established.
eq((0, currencyGap_1.currencyGapOfStatus)({ currency: null, status: 'partial' }), 'incomplete', 'partial is not "none set"');
eq((0, currencyGap_1.currencyGapOfStatus)({ currency: null, status: 'ready' }), 'unset', 'ready and empty is genuinely unset');
/* ── only one of the four sends the coach to their gym owner ───────────── */
const CONSEQUENCE = 'there is no unit to price these sessions in';
const lines = ['reading', 'unreadable', 'incomplete', 'unset']
    .map((g) => [g, (0, currencyGap_1.currencyGapLine)(g, CONSEQUENCE)]);
for (const [gap, line] of lines) {
    ok(line.includes(CONSEQUENCE), `${gap} states what is lost`);
    ok(line.trim().endsWith('.'), `${gap} is a finished sentence`);
    const blamesOwner = /gym settings/.test(line);
    eq(blamesOwner, gap === 'unset', `${gap} names the gym owner only when it is their setting`);
    const saysRetry = /try again/.test(line);
    eq(saysRetry, gap === 'unreadable' || gap === 'incomplete', `${gap} says to try again only when that would help`);
}
// The four are actually four. A refactor that collapsed two of them back onto
// one wording is the regression this whole file exists to catch.
eq(new Set(lines.map(([, l]) => l)).size, 4, 'the four causes read as four different sentences');
// The one sentence that must not be said about a read that failed.
for (const [gap, line] of lines) {
    eq(/has not set a currency/.test(line), gap === 'unset', `${gap} claims nobody set one only when that is known`);
}
/* ── the fragment is joined cleanly ────────────────────────────────────── */
// Callers write the clause the way it reads in place; a stray full stop from
// one of them must not produce "in.." in the middle of a sentence.
ok(!/\.\./.test((0, currencyGap_1.currencyGapLine)('unset', 'this target cannot be shown as an amount.')), 'a trailing stop on the fragment is absorbed, not doubled');
ok((0, currencyGap_1.currencyGapLine)('unset', '  a new client cannot be priced  ').includes('so a new client cannot be priced.'), 'surrounding whitespace is trimmed');
/* ── the same four causes, about somebody else's money ─────────────────── */
//
// The client's coach directory prints `trainers.session_fee` and needs the
// identical distinction in a voice that is not the coach's. "Your gym has not
// set a currency" is simply false said to a member browsing strangers, and
// "try again" is advice about a read they did not ask for.
const WHO = 'this coach';
const GAPS = ['reading', 'unreadable', 'incomplete', 'unset'];
const aboutLines = GAPS.map((g) => [g, (0, currencyGap_1.currencyGapLineAbout)(g, WHO)]);
for (const [gap, line] of aboutLines) {
    ok(line.trim().endsWith('.'), `about/${gap} is a finished sentence`);
    ok(!/your gym|your currency/i.test(line), `about/${gap} does not address the reader as the gym's customer`);
    ok(!/gym settings/.test(line), `about/${gap} does not send a member to a setting they cannot reach`);
    ok(!/try again/i.test(line), `about/${gap} does not ask a member to retry a read they did not start`);
}
eq(new Set(aboutLines.map(([, l]) => l)).size, 4, 'the four causes read as four different sentences here too');
// The one sentence that must not be said about a read that failed, in this
// voice as well as the other one.
for (const [gap, line] of aboutLines) {
    eq(/has not told us which currency/.test(line), gap === 'unset', `about/${gap} claims nobody stated one only when that is known`);
}
// Only 'unset' points the member at a person, and it points at the right one:
// the coach whose price it is, not an owner the member has never met.
ok(/Ask them before you book/.test((0, currencyGap_1.currencyGapLineAbout)('unset', WHO)), 'an unset currency tells the member what to actually do about it');
ok(/This coach/.test((0, currencyGap_1.currencyGapLineAbout)('unset', 'this coach')), 'and the description is capitalised at the head of a sentence, never left as a dash');
// Every failing branch says what the number IS, because the number is still on
// screen beside it and a member will otherwise read it in their own currency.
for (const gap of ['unreadable', 'incomplete', 'unset']) {
    ok(/number without a (currency|unit)/.test((0, currencyGap_1.currencyGapLineAbout)(gap, WHO)), `about/${gap} says what the figure beside it is`);
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('currencyGap: ok');
