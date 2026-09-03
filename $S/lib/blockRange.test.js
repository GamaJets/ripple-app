"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Blocking more than one day. Compile with tsc, run with node.
//
// Two failures are worth the file.
//
// THE FIRST is daylight saving. A range built by adding 86,400,000ms per day
// lands at 23:00 or 01:00 across a clock change, which silently drops one day
// out of a fortnight's holiday and blocks another twice. `npm run test:zones`
// runs this under Los Angeles, Auckland and Dubai — the first two of which
// change their clocks in opposite months — so the assertions below run on both
// sides of a transition without naming one.
//
// THE SECOND is the summary. `block_time` refuses a day with a session booked
// in it, so a fourteen-day range produces a mixture, and the two sentences a
// coach must never see are "blocked" while four days are still bookable and
// "not blocked" while ten were. Both describe a diary that is not the diary.
const blockRange_1 = require("./blockRange");
const locale_1 = require("./locale");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// These assertions read dates in British order — the day first. That is no
// longer what the app writes for everybody: src/lib/format.ts asks
// src/lib/locale.ts, which reads the handset, so the same call produces
// "Sep 2, 2026" on an American one. The locale is stated here for the same
// reason this file states its timezones: a test that reads whatever the runner
// happens to be set to is a test of the machine.
(0, locale_1.setAppLocale)('en-GB');
/* ── the days a plan covers ─────────────────────────────────────────────── */
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: 1, repeatWeeks: 1 }), ['2026-09-01'], 'one day is one day — the behaviour that already existed');
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: 3, repeatWeeks: 1 }), ['2026-09-01', '2026-09-02', '2026-09-03'], 'three consecutive days');
same((0, blockRange_1.blockDates)({ from: '2026-09-06', days: 1, repeatWeeks: 3 }), ['2026-09-06', '2026-09-13', '2026-09-20'], 'every Sunday for three weeks');
// A run longer than a week overlaps its own repeat. Blocking a day twice is
// harmless on the server and makes the tally a coach reads a count of calls
// rather than a count of days.
const overlapping = (0, blockRange_1.blockDates)({ from: '2026-09-01', days: 10, repeatWeeks: 2 });
eq(new Set(overlapping).size, overlapping.length, 'a run that overlaps its own repeat lists each day once');
eq(overlapping.length, 17, 'ten days repeated a week later covers seventeen, not twenty');
same([...overlapping].sort(), overlapping, 'and comes back in order');
// Month and year boundaries, which `setDate` handles and hand-rolled
// arithmetic on a day-of-month does not.
same((0, blockRange_1.blockDates)({ from: '2026-01-30', days: 4, repeatWeeks: 1 }), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'], 'a range crosses a month end');
same((0, blockRange_1.blockDates)({ from: '2026-12-30', days: 4, repeatWeeks: 1 }), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], 'and a year end');
// 2028 is a leap year.
ok((0, blockRange_1.blockDates)({ from: '2028-02-27', days: 4, repeatWeeks: 1 }).includes('2028-02-29'), 'and a leap day is a day like any other');
/* ── daylight saving ────────────────────────────────────────────────────── */
// A fortnight spanning the last Sunday in March and the last in October — both
// clock changes in Europe, and neither on the same date as the American or
// Antipodean ones. Whichever zone this suite runs in, at least one of these
// ranges crosses a transition, and the property asserted is the one that
// breaks: fourteen distinct consecutive calendar days, no gap and no repeat.
for (const from of ['2026-03-23', '2026-10-19', '2026-11-02', '2026-04-01']) {
    const days = (0, blockRange_1.blockDates)({ from, days: 14, repeatWeeks: 1 });
    eq(days.length, 14, `${from}: a fortnight is fourteen days`);
    eq(new Set(days).size, 14, `${from}: and none of them is the same day twice`);
    // Consecutive, checked by parsing each back to a local midnight and asserting
    // each is exactly one calendar day after the last. A millisecond-based range
    // fails this on the transition.
    for (let i = 1; i < days.length; i++) {
        const [y0, m0, d0] = days[i - 1].split('-').map(Number);
        const prev = new Date(y0, m0 - 1, d0);
        prev.setDate(prev.getDate() + 1);
        const wanted = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
        eq(days[i], wanted, `${from}: day ${i} follows day ${i - 1} with no gap`);
    }
}
/* ── the guards refuse rather than clamp ────────────────────────────────── */
// Clamping would block a period the coach never asked for, and the thing being
// blocked is time clients cannot book — invisible until somebody cannot get an
// appointment.
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: 0, repeatWeeks: 1 }), [], 'zero days blocks nothing');
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: -3, repeatWeeks: 1 }), [], 'and neither does a negative');
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: 1.5, repeatWeeks: 1 }), [], 'or half a day');
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: blockRange_1.MAX_BLOCK_DAYS + 1, repeatWeeks: 1 }), [], 'past the cap is refused outright, not silently trimmed to the cap');
eq((0, blockRange_1.blockDates)({ from: '2026-09-01', days: blockRange_1.MAX_BLOCK_DAYS, repeatWeeks: 1 }).length, blockRange_1.MAX_BLOCK_DAYS, 'at the cap it works');
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: 1, repeatWeeks: 0 }), [], 'zero repeats is nothing');
same((0, blockRange_1.blockDates)({ from: '2026-09-01', days: 1, repeatWeeks: blockRange_1.MAX_BLOCK_WEEKS + 1 }), [], 'and so is more than a term');
same((0, blockRange_1.blockDates)({ from: 'not a date', days: 3, repeatWeeks: 1 }), [], 'an unparseable start covers nothing');
same((0, blockRange_1.blockDates)({ from: '', days: 3, repeatWeeks: 1 }), [], 'and so does an empty one');
/* ── the button says what it will do ────────────────────────────────────── */
eq((0, blockRange_1.blockPlanLabel)({ from: '2026-09-01', days: 1, repeatWeeks: 1 }), 'Block This Day', 'one day');
eq((0, blockRange_1.blockPlanLabel)({ from: '2026-09-01', days: 5, repeatWeeks: 1 }), 'Block 5 Days', 'five days');
eq((0, blockRange_1.blockPlanLabel)({ from: '2026-09-06', days: 1, repeatWeeks: 4 }), 'Block 4 Days', 'four Sundays are four days');
eq((0, blockRange_1.blockPlanLabel)({ from: '2026-09-01', days: 0, repeatWeeks: 1 }), null, 'a plan covering nothing has no label, which is the caller’s cue to disable the button');
/* ── the summary, which is the point ────────────────────────────────────── */
const r = (day, outcome, withdrawn = 0) => ({ day, outcome, withdrawn });
const clean = (0, blockRange_1.summariseBlocks)([r('2026-09-01', 'blocked', 2), r('2026-09-02', 'blocked', 1)]);
eq(clean.blocked, 2, 'two blocked');
eq(clean.withdrawn, 3, 'three slots withdrawn between them');
ok(!clean.needsAttention, 'and nothing left for the coach to do');
ok((0, blockRange_1.blockSummaryLine)(clean).startsWith('2 days blocked'), 'the sentence opens with what happened');
ok((0, blockRange_1.blockSummaryLine)(clean).includes('3 open slots were withdrawn'), 'and says what it cost');
const mixed = (0, blockRange_1.summariseBlocks)([
    r('2026-09-01', 'blocked', 1), r('2026-09-02', 'booked'),
    r('2026-09-03', 'already-blocked'), r('2026-09-04', 'failed'),
]);
eq(mixed.blocked, 1, 'one blocked');
same(mixed.booked, ['2026-09-02'], 'one refused for a booking');
eq(mixed.already, 1, 'one already covered');
same(mixed.failed, ['2026-09-04'], 'and one that did not land');
ok(mixed.needsAttention, 'a mixture needs the coach');
const line = (0, blockRange_1.blockSummaryLine)(mixed);
// THE assertion. Every one of these four days is in the sentence, named by what
// happened to it — because "blocked" over three days that were not is the app
// describing a diary that is not the diary.
ok(line.includes('1 day blocked'), 'the blocked one is counted');
ok(/session booked/.test(line), 'the booked one is explained rather than merely counted');
// The date is rendered by `fmtPointDay`, which is `toLocaleDateString('en-GB')`
// — and that is 'Sept' on a modern ICU and 'Sep' on an older one. The assertion
// is that the DAY is named at all, not which abbreviation this runtime happens
// to use; pinning the string would make the suite fail on a Node upgrade for a
// reason that has nothing to do with what is being tested.
ok(/\b2 Sept? 2026\b/.test(line), 'and named, so the coach knows which day to go and cancel');
ok(/already covered/.test(line), 'the already-blocked one is separated from the refusals');
ok(/still bookable/.test(line), 'and the failed one says the day is still open — the only one that means try again');
ok(/\b4 Sept? 2026\b/.test(line), 'named too');
// The two sentences a coach must never be shown.
const allBooked = (0, blockRange_1.summariseBlocks)([r('2026-09-01', 'booked'), r('2026-09-02', 'booked')]);
ok((0, blockRange_1.blockSummaryLine)(allBooked).startsWith('Nothing was blocked'), 'a run where every day was refused never opens with a success');
ok(allBooked.needsAttention, 'and it needs attention');
// Long lists are trimmed rather than printed whole — an alert naming forty
// dates is one nobody reads — but the COUNT is never trimmed.
const manyBooked = (0, blockRange_1.summariseBlocks)(['01', '02', '03', '04', '05', '06'].map((d) => r(`2026-09-${d}`, 'booked')));
const manyLine = (0, blockRange_1.blockSummaryLine)(manyBooked);
ok(manyLine.includes('6 could not be blocked'), 'the count of refusals is complete');
ok(manyLine.includes('and 2 more'), 'while the list of dates is trimmed');
// House voice, over every shape this module can print.
for (const s of [clean, mixed, allBooked, manyBooked, (0, blockRange_1.summariseBlocks)([])]) {
    const l = (0, blockRange_1.blockSummaryLine)(s);
    ok(!l.includes('!'), 'nothing shouts');
    ok(l.length > 10, 'and every state says something');
}
/* ── which sessions are actually in the way ─────────────────────────────── */
// Built with LOCAL constructors, so the day each session falls on is the day a
// coach standing in that zone would call it. Under TZ=Pacific/Kiritimati a 7am
// session is the previous day in UTC, and matching on a UTC slice would offer
// the coach Monday's client as the thing blocking Tuesday.
const at = (y, mIdx, d, h) => new Date(y, mIdx, d, h, 0, 0, 0).toISOString();
const sess = (id, startsAt, status, clientId = 'c1') => ({ id, startsAt, status, clientId });
const DAYS = ['2026-09-08', '2026-09-09'];
const pool = [
    sess('a', at(2026, 8, 8, 7), 'booked'),
    sess('b', at(2026, 8, 8, 18), 'booked'),
    // An OPEN slot in the same period. `block_time` withdraws these itself, and
    // offering to cancel an hour nobody holds would invent a client.
    sess('c', at(2026, 8, 8, 12), 'open', null),
    sess('d', at(2026, 8, 9, 6), 'booked'),
    // Outside the range entirely.
    sess('e', at(2026, 8, 10, 7), 'booked'),
];
const inWay = (0, blockRange_1.sessionsBlocking)(DAYS, pool);
eq(inWay.length, 3, 'only the booked sessions on the blocked days are in the way');
eq(inWay.map((s) => s.id).join(','), 'a,b,d', 'and they come back soonest first');
ok(!inWay.some((s) => s.id === 'c'), 'an open slot is never offered as a cancellation');
ok(!inWay.some((s) => s.id === 'e'), 'nor is a session on a day nobody blocked');
// A timestamp that will not parse is dropped rather than guessed at: it cannot
// be matched to a day, and a cancellation aimed at the wrong day costs somebody
// their appointment.
eq((0, blockRange_1.sessionsBlocking)(DAYS, [sess('x', 'not a date', 'booked')]).length, 0, 'an unreadable start is never matched to a day');
eq((0, blockRange_1.sessionsBlocking)([], pool).length, 0, 'an empty plan blocks nothing and clashes with nothing');
/* ── and what the coach is asked before it happens ──────────────────────── */
const body1 = (0, blockRange_1.cancelAndBlockBody)(1, ['Ana 7:00am']);
ok(body1.includes('Ana 7:00am'), 'the confirm names who is being cancelled');
ok(/tells that client/.test(body1), 'and says the client is told');
ok(/waitlist/.test(body1), 'and that the hour goes to the waitlist');
const body5 = (0, blockRange_1.cancelAndBlockBody)(5, ['A', 'B', 'C', 'D', 'E']);
ok(/and 1 more/.test(body5), 'a long list is trimmed rather than run off the alert');
ok(!/undefined|NaN/.test(body5), 'and never renders a name as a word');
eq((0, blockRange_1.cancelAndBlockLabel)(1), 'Cancel It And Block', 'the button says what it does, in the singular');
eq((0, blockRange_1.cancelAndBlockLabel)(4), 'Cancel 4 And Block', 'and counts when there is more than one');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('blockRange.test.ts — ok');
