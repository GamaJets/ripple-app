"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What My Bookings may say about a list built from two reads. Compile with
// tsc, run with node.
//
// The bug this guards: the screen drew a half-read list as a whole one. Classes
// and PT sessions are separate reads, and when the classes read failed while
// sessions succeeded, a member booked into Tuesday's spin class saw "Upcoming"
// listing their PT session alone, with nothing on the page saying a whole half
// was missing. These assertions pin the two things that fixes it: a list with
// rows still gets a banner when either read is short, and the banner names
// WHICH half so the reader knows what to go and check.
const bookingsRead_1 = require("./bookingsRead");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ALL = ['loading', 'ready', 'partial', 'error'];
/* ── the banner over a list that has rows ──────────────────────────────── */
eq((0, bookingsRead_1.bookingsGap)('ready', 'ready'), null, 'two whole reads need no banner — that list is everything there is');
// The reported case, in both directions.
const classesFailed = (0, bookingsRead_1.bookingsGap)('error', 'ready');
ok(classesFailed !== null, 'a failed classes read is announced even though the list has PT rows in it');
ok(!!classesFailed && classesFailed.note.includes('your class bookings'), 'it names the classes as the missing half');
ok(!!classesFailed && !classesFailed.note.includes('PT sessions'), 'it does not cast doubt on the half that read fine');
const ptFailed = (0, bookingsRead_1.bookingsGap)('ready', 'error');
ok(!!ptFailed && ptFailed.note.includes('your PT sessions'), 'a failed sessions read names the sessions');
ok(!!ptFailed && !ptFailed.note.includes('class bookings'), 'and leaves the classes alone');
const bothFailed = (0, bookingsRead_1.bookingsGap)('error', 'error');
ok(!!bothFailed && bothFailed.note.includes('your class bookings and your PT sessions'), 'both failing names both');
// A booking that is missing is not a booking that was cancelled, and this is
// the screen where that difference is charged for.
ok(!!classesFailed && classesFailed.note.includes('not a cancellation'), 'the banner says plainly that nothing was cancelled');
/* ── error outranks loading outranks partial ───────────────────────────── */
// Same order as worstStatus in src/ui/loadStatus.ts, and for the same reason:
// the worst thing true of the list is the thing the reader needs.
eq((0, bookingsRead_1.bookingsGap)('error', 'loading')?.title, 'Some of your bookings could not be read', 'a failure is louder than a read still in flight');
eq((0, bookingsRead_1.bookingsGap)('loading', 'partial')?.title, 'Still reading your bookings', 'an in-flight read outranks a truncated one');
eq((0, bookingsRead_1.bookingsGap)('partial', 'ready')?.title, 'Not all of your bookings could be read', 'truncation gets a banner of its own');
// Every combination either says nothing or says something with both halves of
// a sentence in it. A banner with an empty note is a shape the screen renders
// and the reader cannot use.
for (const cs of ALL) {
    for (const ss of ALL) {
        const g = (0, bookingsRead_1.bookingsGap)(cs, ss);
        if (cs === 'ready' && ss === 'ready') {
            eq(g, null, 'ready/ready is silent');
            continue;
        }
        ok(!!g && g.title.length > 0 && g.note.length > 0, `${cs}/${ss} produces a banner with words in it`);
    }
}
/* ── the empty list ────────────────────────────────────────────────────── */
eq((0, bookingsRead_1.emptyBookingsLine)('ready', 'ready'), 'No upcoming bookings. Book a class or a PT session to get started.', 'two whole reads may state an empty calendar as a fact');
// The literal string this replaces was "Loading." — permanently, on a screen
// where both reads had finished.
ok(!(0, bookingsRead_1.emptyBookingsLine)('partial', 'ready').includes('Loading'), 'a truncated read is not described as loading');
ok((0, bookingsRead_1.emptyBookingsLine)('partial', 'ready').includes('not a statement that you have none'), 'a truncated read says outright that this is not an empty calendar');
ok((0, bookingsRead_1.emptyBookingsLine)('loading', 'ready').includes('Reading'), 'a read still in flight says it is reading');
ok((0, bookingsRead_1.emptyBookingsLine)('error', 'ready').includes('not a statement that you have none'), 'a failed read says outright that this is not an empty calendar');
// Nothing but ready/ready may claim there are no bookings.
for (const cs of ALL) {
    for (const ss of ALL) {
        if (cs === 'ready' && ss === 'ready')
            continue;
        ok(!(0, bookingsRead_1.emptyBookingsLine)(cs, ss).startsWith('No upcoming bookings'), `${cs}/${ss} does not assert an empty calendar`);
    }
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('bookingsRead: ok');
