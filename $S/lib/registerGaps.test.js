"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The registers a coach never took. Compile with tsc, run with node.
//
// What is being pinned here is mostly the shape of a MISTAKE, because the
// mistakes all render as a tidy, plausible list:
//
//   · a class dropped from the list reads as a register the coach took. That is
//     the only outcome in this file that is silently wrong in the dangerous
//     direction, so an unreadable start date keeps its place (rule 3) and is
//     asserted for twice;
//   · a class that has not happened yet reads as paperwork the coach has
//     neglected, and the fix for it — opening its register — is a register for a
//     class that has not been taught;
//   · an order that depends on the input's order reshuffles between two renders
//     of the same screen, and a thumb lands on the wrong row;
//   · a headcount summed over rows that cannot answer understates what the
//     coach delivered, which is `paidHeadcountTotal`'s stated rule arriving
//     here.
const registerGaps_1 = require("./registerGaps");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const NOW = new Date('2026-09-03T18:00:00.000Z');
function row(p) {
    return {
        title: 'Conditioning', kind: 'class', branch: 'Warehouse',
        trainerId: 'coach-1', trainerName: 'Sam', startsAt: '2026-09-01T06:00:00.000Z',
        capacity: 16, booked: 0, attended: 0, waitlistAttended: 0,
        ...p,
    };
}
/* ── 1. what counts as a gap is `splitTaught`'s answer and not a new one ───*/
{
    const gaps = (0, registerGaps_1.missingRegisters)([
        row({ classId: 'marked', booked: 10, attended: 7 }),
        row({ classId: 'walkin-only', booked: 10, attended: 0, waitlistAttended: 1 }),
        row({ classId: 'nobody-booked', booked: 0, attended: 0 }),
        row({ classId: 'gap', booked: 11, attended: 0 }),
    ], NOW);
    eq(gaps.length, 1, 'exactly one of those four is a register that was not taken');
    eq(gaps[0]?.classId, 'gap', 'and it is the one with bookings and nothing marked');
    // Each of the three exclusions is a separate claim, so each is stated.
    ok(!gaps.some((g) => g.classId === 'marked'), 'a class with people marked has a register');
    ok(!gaps.some((g) => g.classId === 'walkin-only'), 'and so does one with a single walk-in ticked — that tick IS a coach at the door');
    ok(!gaps.some((g) => g.classId === 'nobody-booked'), 'a class nobody booked had no register to take, so it is not paperwork anybody owes');
}
/* ── 2. a class that has not started is not a register you failed to take ──*/
{
    const gaps = (0, registerGaps_1.missingRegisters)([
        row({ classId: 'future', booked: 8, startsAt: '2026-09-04T06:00:00.000Z' }),
        row({ classId: 'past', booked: 8, startsAt: '2026-09-02T06:00:00.000Z' }),
    ], NOW);
    eq(gaps.length, 1, 'next week’s class is not a register the coach has neglected');
    eq(gaps[0]?.classId, 'past', 'only the one that has already happened');
    // The boundary itself: a class that started one second ago is registrable,
    // and one starting in a second is not. A class in progress is exactly when a
    // register gets taken.
    eq((0, registerGaps_1.missingRegisters)([row({ classId: 'now', booked: 4, startsAt: NOW.toISOString() })], NOW).length, 1, 'a class starting on this very instant is one you are standing in');
}
/* ── 3. a class whose start cannot be read is still a gap, and sorts last ──*/
{
    const gaps = (0, registerGaps_1.missingRegisters)([
        row({ classId: 'unreadable', booked: 6, startsAt: 'not a date' }),
        row({ classId: 'older', booked: 6, startsAt: '2026-08-20T06:00:00.000Z' }),
    ], NOW);
    eq(gaps.length, 2, 'a class with an unreadable start is NEVER dropped — the bookings on it are real');
    // `?.` deliberately: when rule 3 breaks, the row is ABSENT, and an assertion
    // that throws on the way to reporting that takes the rest of the suite with it.
    eq(gaps[1]?.classId, 'unreadable', 'it sorts last, behind every class whose date the coach can recognise');
    // The dangerous direction, stated as its own assertion: a list that loses it
    // says "you have taken every register", which is a claim, and a false one.
    eq((0, registerGaps_1.missingRegisters)([row({ classId: 'only-unreadable', booked: 3, startsAt: '' })], NOW).length, 1, 'and an empty start does not empty the list');
}
/* ── 4. newest first, with a total order ──────────────────────────────────*/
{
    const gaps = (0, registerGaps_1.missingRegisters)([
        row({ classId: 'b', booked: 1, startsAt: '2026-08-01T06:00:00.000Z' }),
        row({ classId: 'c', booked: 1, startsAt: '2026-09-01T06:00:00.000Z' }),
        row({ classId: 'a', booked: 1, startsAt: '2026-08-15T06:00:00.000Z' }),
    ], NOW);
    eq(gaps.map((g) => g.classId).join(','), 'c,a,b', 'the most recent class a coach can still recall comes first');
    // Two classes at 6am is the ordinary case in a gym, not an edge one. The tie
    // breaks on the id so the same set always renders in the same order.
    const same = '2026-09-01T06:00:00.000Z';
    const tied = [
        row({ classId: 'zeta', booked: 1, startsAt: same }),
        row({ classId: 'alpha', booked: 1, startsAt: same }),
    ];
    eq((0, registerGaps_1.missingRegisters)(tied, NOW).map((g) => g.classId).join(','), 'alpha,zeta', 'ties break on the id');
    eq((0, registerGaps_1.missingRegisters)([...tied].reverse(), NOW).map((g) => g.classId).join(','), 'alpha,zeta', 'and the answer does not depend on the order the server happened to return them in');
}
/* ── 5. the headcount at stake is all-or-nothing ──────────────────────────*/
{
    const gaps = (0, registerGaps_1.missingRegisters)([
        row({ classId: 'x', booked: 11 }),
        row({ classId: 'y', booked: 7 }),
    ], NOW);
    eq((0, registerGaps_1.peopleWaiting)(gaps), 18, 'the people booked across the open registers are summed');
    eq((0, registerGaps_1.peopleWaiting)([]), 0, 'no open registers is nobody waiting, which is a real answer');
    eq((0, registerGaps_1.peopleWaiting)([{ classId: 'z', title: 'T', branch: 'B', startsAt: '', booked: NaN }]), null, 'a row whose booked count is not a number withholds the WHOLE total, never part of it');
    eq((0, registerGaps_1.peopleWaiting)([{ classId: 'z', title: 'T', branch: 'B', startsAt: '', booked: -2 }]), null, 'and so does a negative one, which is not a number of people');
}
/* ── 6. the words ─────────────────────────────────────────────────────────*/
{
    eq((0, registerGaps_1.gapsHeading)([]), null, 'a coach who has taken every register is not congratulated on it every visit');
    eq((0, registerGaps_1.gapsNote)([]), null, 'and there is no note over an empty list');
    const one = (0, registerGaps_1.missingRegisters)([row({ classId: 'x', booked: 1 })], NOW);
    eq((0, registerGaps_1.gapsHeading)(one), '1 register still open', 'one reads as one');
    ok((0, registerGaps_1.gapsNote)(one).includes('The 1 person who booked'), 'and the note counts that one person');
    const many = (0, registerGaps_1.missingRegisters)([row({ classId: 'x', booked: 11 }), row({ classId: 'y', booked: 7 })], NOW);
    eq((0, registerGaps_1.gapsHeading)(many), '2 registers still open', 'and two read as two');
    const note = (0, registerGaps_1.gapsNote)(many);
    ok(note.includes('18 people'), 'the note names the headcount that is missing from the gym’s record');
    ok(note.includes('no closing time'), 'and says the thing that makes the list worth showing: the register can still be taken');
    // The claim this must NOT make. Whether a gym has already run payroll for
    // that period is not a fact this screen has read.
    ok(!/paid|pay|payroll|money/i.test(note), 'nothing here promises the coach will be paid for taking it — that is the gym’s run, not ours');
    const unreadable = { classId: 'z', title: 'T', branch: 'B', startsAt: '', booked: NaN };
    ok((0, registerGaps_1.gapsNote)([unreadable]).startsWith('The people who booked them'), 'an unreadable headcount is said in words rather than printed as a number');
}
/* ── 7. the line under one class ──────────────────────────────────────────*/
{
    eq((0, registerGaps_1.gapLine)({ classId: 'a', title: 'T', branch: 'B', startsAt: '', booked: 1 }), '1 person booked and nobody was marked.', 'one person is not "1 people"');
    eq((0, registerGaps_1.gapLine)({ classId: 'a', title: 'T', branch: 'B', startsAt: '', booked: 12 }), '12 people booked and nobody was marked.', 'and twelve are');
    ok((0, registerGaps_1.gapLine)({ classId: 'a', title: 'T', branch: 'B', startsAt: '', booked: NaN })
        .includes('could not be read'), 'a headcount that cannot be read says so rather than printing a nought');
}
console.log(errors.length ? 'REGISTER GAPS FAILURES:\n' + errors.join('\n') : 'registerGaps: ok — no class the coach taught is dropped, none they have not taught is demanded, and no headcount is guessed');
if (errors.length)
    process.exit(1);
