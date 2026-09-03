"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What a coach charges, and the three different ways that can be nothing.
// Compile with tsc, run with node.
//
// The assertion that matters most: nothing in here ever turns an absent or
// unreadable rate into zero, because zero is a price and the directory renders
// it as one.
const sessionFee_1 = require("./sessionFee");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── reading the column ────────────────────────────────────────────────── */
eq((0, sessionFee_1.readSessionFee)(45).kind, 'priced', 'a number is a stated rate');
eq((0, sessionFee_1.sessionFeeAmount)((0, sessionFee_1.readSessionFee)(45)), 45, 'and the figure survives the read');
// PostgREST hands a `numeric` back as a string, and `Number('')` is 0 — the
// exact coercion that turned a blank cell into "charges nothing".
eq((0, sessionFee_1.readSessionFee)('45').kind, 'priced', 'the string form of a numeric is read as a number');
eq((0, sessionFee_1.sessionFeeAmount)((0, sessionFee_1.readSessionFee)('45.5')), 45.5, 'including a fractional one');
eq((0, sessionFee_1.readSessionFee)('').kind, 'unstated', 'an empty string is not a rate of zero');
eq((0, sessionFee_1.readSessionFee)('   ').kind, 'unstated', 'and neither is whitespace');
eq((0, sessionFee_1.readSessionFee)(null).kind, 'unstated', 'an empty column is "has not said"');
eq((0, sessionFee_1.readSessionFee)(undefined).kind, 'unstated', 'and so is an absent one');
eq((0, sessionFee_1.readSessionFee)(0).kind, 'free', 'a stated zero is a stated zero');
eq((0, sessionFee_1.readSessionFee)('0').kind, 'free', 'in either form');
ok((0, sessionFee_1.readSessionFee)(0).kind !== (0, sessionFee_1.readSessionFee)(null).kind, 'and it is NOT the same answer as an empty column — the whole point of this file');
eq((0, sessionFee_1.readSessionFee)('forty-five').kind, 'unreadable', 'a value that will not parse is unknown');
eq((0, sessionFee_1.readSessionFee)(Number.NaN).kind, 'unreadable', 'so is NaN');
eq((0, sessionFee_1.readSessionFee)(Number.POSITIVE_INFINITY).kind, 'unreadable', 'so is an infinity');
eq((0, sessionFee_1.readSessionFee)(-10).kind, 'unreadable', 'a negative rate is a bad row, not a discount');
eq((0, sessionFee_1.readSessionFee)(true).kind, 'unreadable', 'and a boolean is not a price, whatever Number() says of it');
// The one that would put the defect back.
for (const raw of [null, undefined, '', 'x', Number.NaN, -1]) {
    eq((0, sessionFee_1.sessionFeeAmount)((0, sessionFee_1.readSessionFee)(raw)), null, `nothing unstated or unreadable produces a figure — ${JSON.stringify(raw)}`);
}
/* ── what the member reads ─────────────────────────────────────────────── */
eq((0, sessionFee_1.sessionFeeShort)((0, sessionFee_1.readSessionFee)(45)), null, 'a priced row prints the money instead of a line');
eq((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)(45), 'Sam'), null, 'and the sheet says nothing extra either');
ok(/no per-session charge/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)(0), 'Sam')), 'a genuine zero says the member owes nothing per session');
ok(/hasn’t stated/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)(null), 'Sam')), 'an empty column says the coach has not said');
ok(/Ask them/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)(null), 'Sam')), 'and tells the member what to do about it');
ok(/couldn’t read/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)('x'), 'Sam')), 'an unreadable value says the read failed');
ok(/not a statement that they charge nothing/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)('x'), 'Sam')), 'and refuses to be read as free — the house rule about an empty read');
ok(/^This coach/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)(null), null)), 'a coach with no name still gets a sentence');
ok(/this coach’s session fee/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)('x'), '')), 'and the possessive stays grammatical without one');
ok(/Sam’s session fee/.test((0, sessionFee_1.sessionFeeNote)((0, sessionFee_1.readSessionFee)('x'), 'Sam')), 'while a named coach is named');
const shorts = [(0, sessionFee_1.readSessionFee)(0), (0, sessionFee_1.readSessionFee)(null), (0, sessionFee_1.readSessionFee)('x')].map(sessionFee_1.sessionFeeShort);
ok(shorts.every((s) => s != null && s.length <= 20), 'every row line is short enough to sit in the slot a figure sat in');
eq(new Set(shorts).size, 3, 'and the three causes read differently from each other');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('sessionFee.test.ts — ok');
