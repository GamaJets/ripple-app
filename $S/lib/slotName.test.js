"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Who is in an hour on the coach's calendar. Compile with tsc, run with node.
//
// The bug this guards is one expression:
//
//     roster.find((c) => c.id === id)?.name ?? 'Open slot'
//
// A booked hour whose client the roster read did not return was presented as
// free — in the day sheet, in the cancel confirmation, in the move sheet and in
// the late-fee list. A coach reads that and gives the hour to somebody else.
const slotName_1 = require("./slotName");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const BOOK = [
    { id: 'c1', name: 'Priya' },
    { id: 'c2', name: '  Sam  ' },
    { id: 'c3', name: '' },
];
/* ── the four things that can be true about a slot ──────────────────────── */
eq((0, slotName_1.slotWho)(null, BOOK), 'open', 'no client id is an open slot');
eq((0, slotName_1.slotWho)(undefined, BOOK), 'open', 'and so is an absent one');
eq((0, slotName_1.slotWho)('c1', BOOK), 'named', 'a client on the book is named');
eq((0, slotName_1.slotWho)('c3', BOOK), 'unnamed', 'a client on the book with no name is not the same as one who is missing');
eq((0, slotName_1.slotWho)('c9', BOOK), 'unread', 'a client the roster did not return is unread, never open');
// The one that mattered. An empty roster is what a failed read hands back, and
// the whole calendar used to read every booked hour in it as free.
eq((0, slotName_1.slotWho)('c1', []), 'unread', 'an empty roster does not turn a booking into an open slot');
/* ── the label on a row ─────────────────────────────────────────────────── */
eq((0, slotName_1.slotLabel)(null, BOOK, 'ready'), 'Open slot', 'an open slot says so');
eq((0, slotName_1.slotLabel)('c1', BOOK, 'ready'), 'Priya', 'a named client is their name');
eq((0, slotName_1.slotLabel)('c2', BOOK, 'ready'), 'Sam', 'and it is trimmed, because it goes in a row beside a time');
// THE assertion. Every status, and not one of them may produce the words that
// tell a coach the hour is free.
for (const status of ['loading', 'ready', 'partial', 'error']) {
    const label = (0, slotName_1.slotLabel)('c9', BOOK, status);
    ok(!/open/i.test(label), `a booked hour is never labelled open under '${status}'`);
    ok(/booked/i.test(label), `and it says it is booked under '${status}'`);
}
// A whole read and a short one say different things, because they are different
// facts: one is a client who has left the book, the other is a list that did
// not come back.
ok(/book any more/.test((0, slotName_1.slotLabel)('c9', BOOK, 'ready')), 'under a whole read, a missing id is somebody who has left the book');
ok(/could not be read/.test((0, slotName_1.slotLabel)('c9', BOOK, 'error')), 'under a failed read, it is the read that is named and not the client');
ok(/could not be read/.test((0, slotName_1.slotLabel)('c9', BOOK, 'partial')), 'a truncated roster is not a whole one either');
ok(/could not be read/.test((0, slotName_1.slotLabel)('c9', BOOK, 'loading')), 'nor is one that has not arrived');
/* ── the same person in a sentence ──────────────────────────────────────── */
// The label cannot go in prose: "6pm with Booked · not on your book any more
// was cancelled" is a sentence that has come apart.
eq((0, slotName_1.slotWhoName)('c1', BOOK, 'ready'), 'Priya', 'a name stands where a name goes');
for (const status of ['loading', 'ready', 'partial', 'error']) {
    const who = (0, slotName_1.slotWhoName)('c9', BOOK, status);
    ok(!/·/.test(who), `the prose form carries no row punctuation under '${status}'`);
    ok(/^a client|^the client/.test(who), `and reads as a noun phrase under '${status}'`);
}
eq((0, slotName_1.slotWhoName)(null, BOOK, 'ready'), 'nobody', 'an empty slot is with nobody');
/* ── and the sentence under the row ─────────────────────────────────────── */
eq((0, slotName_1.unnamedSlotNote)(null, BOOK, 'ready'), null, 'an open slot needs no explanation');
eq((0, slotName_1.unnamedSlotNote)('c1', BOOK, 'ready'), null, 'nor does a client with a name');
const unread = (0, slotName_1.unnamedSlotNote)('c9', BOOK, 'error') ?? '';
ok(/not an open slot/.test(unread), 'the note says outright that the hour is not free');
ok(/anybody else/.test(unread), 'and what not to do with it');
const gone = (0, slotName_1.unnamedSlotNote)('c9', BOOK, 'ready') ?? '';
ok(/not an open slot/.test(gone), 'a client off the book still holds the hour');
ok(!/could not be read/.test(gone), 'and a whole read is not reported as a failed one');
const blank = (0, slotName_1.unnamedSlotNote)('c3', BOOK, 'ready') ?? '';
ok(/booked/i.test(blank), 'a nameless record is still a booking');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('slotName: ok');
