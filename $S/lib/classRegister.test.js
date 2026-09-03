"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Counting a class register. Compile with tsc, run with node.
//
// The defect these guard: `present` counted every ticked row and `booked`
// counted only the rows holding a place, so two walk-ins off the waitlist
// pushed the two numbers level while two people who paid were still missing —
// and the hero said "Everyone booked is here." over a room that was not
// complete. The ring beside it could pass a full circle.
const classRegister_1 = require("./classRegister");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const row = (status, attended) => ({ status, attended });
/* ── THE one: walk-ins never complete the room ──────────────────────────── */
const mixed = [
    row('booked', true), row('booked', true),
    // Two people who paid for the class and are not here.
    row('booked', false), row('booked', false),
    // Two off the waitlist, ticked in at the door.
    row('waitlist', true), row('waitlist', true),
];
const c = (0, classRegister_1.countRegister)(mixed);
eq(c.booked, 4, 'the denominator is the people holding a place');
eq(c.present, 2, 'and the numerator comes out of that same set');
eq(c.walkIns, 2, 'the walk-ins are counted');
eq(c.waiting, 2, 'and so is the queue they came from');
eq(c.missing, 2, 'two booked members are still missing');
ok(!(0, classRegister_1.registerLine)(c, true).startsWith('Everyone booked is here'), 'a room with two booked members absent is never called complete');
ok((0, classRegister_1.registerLine)(c, true).includes('2 still to arrive'), 'it says how many are outstanding');
ok((0, classRegister_1.registerLine)(c, true).includes('came off the waitlist'), 'and the walk-ins are still reported');
eq((0, classRegister_1.registerArc)(c), 0.5, 'and the ring is half, not full');
/* ── a ring that cannot exceed itself ───────────────────────────────────── */
// The shape that used to draw more than a full circle: one booked member, three
// walk-ins, everybody ticked.
const over = (0, classRegister_1.countRegister)([
    row('booked', true), row('waitlist', true), row('waitlist', true), row('waitlist', true),
]);
eq(over.present, 1, 'only the booked member counts toward the rate');
eq((0, classRegister_1.registerArc)(over), 1, 'so the ring is exactly full and never more');
eq(over.walkIns, 3, 'and the three at the door are not lost');
/* ── complete means complete ────────────────────────────────────────────── */
const done = (0, classRegister_1.countRegister)([row('booked', true), row('booked', true)]);
eq(done.missing, 0, 'nobody outstanding');
eq((0, classRegister_1.registerLine)(done, true), 'Everyone booked is here.', 'which is the one time that sentence is said');
eq((0, classRegister_1.registerArc)(done), 1, 'and the ring is full');
/* ── an unread roster is not an empty class ─────────────────────────────── */
const none = (0, classRegister_1.countRegister)([]);
eq((0, classRegister_1.registerArc)(none), null, 'a class nobody booked has no rate, rather than a rate of zero');
eq((0, classRegister_1.registerLine)(none, true), 'No bookings on this class yet.', 'and says so plainly');
ok(!/\d/.test((0, classRegister_1.registerLine)(none, false)), 'an unread roster is never described with a number');
ok((0, classRegister_1.registerLine)(none, false).includes('not a count of zero'), 'and says what it is not');
// A class nobody booked that somebody still trained at. The gym owes for those
// two whatever the booking sheet said.
const walkOnly = (0, classRegister_1.countRegister)([row('waitlist', true), row('waitlist', true)]);
eq(walkOnly.booked, 0, 'nobody held a place');
eq(walkOnly.walkIns, 2, 'and two people trained anyway');
ok((0, classRegister_1.registerLine)(walkOnly, true).includes('came off the waitlist'), 'which is said rather than dropped');
eq((0, classRegister_1.registerArc)(walkOnly), null, 'with no rate, because there is no denominator');
// Singular and plural both read as English, and neither renders a count as a
// word.
const one = (0, classRegister_1.countRegister)([row('booked', true), row('booked', false), row('waitlist', true)]);
ok((0, classRegister_1.registerLine)(one, true).includes('1 still to arrive'), 'one outstanding reads in the singular');
ok((0, classRegister_1.registerLine)(one, true).includes('1 person'), 'and so does one walk-in');
ok(!/undefined|NaN/.test((0, classRegister_1.registerLine)(one, true)), 'and nothing renders as a word');
// Any status that is not 'booked' is a queue row. The column is free text with
// a check constraint, and a value nobody anticipated must not silently join the
// denominator a coach is paid against.
const odd = (0, classRegister_1.countRegister)([row('booked', true), row('standby', true)]);
eq(odd.booked, 1, 'an unexpected status is not counted as a place held');
eq(odd.walkIns, 1, 'it is counted as somebody who turned up');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('classRegister: ok');
