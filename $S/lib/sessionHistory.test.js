"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for sessionHistory — what became of a past session, and how far back a
// screen may claim to see.
//
// The assertions are grouped by the thing that would break somebody's record if
// it were wrong:
//
//   · an EMPTY history under a failed read must never read as "nothing
//     happened". This is the rule the whole feature lives or dies by, so it is
//     asserted first and against every status.
//   · an UNMARKED session is its own state. It is not delivered and it is not
//     cancelled, and the words used for it are the ones src/lib/gymSessions.ts
//     already uses to block a payroll settlement.
//   · a CANCELLED or DISPUTED session stays in the list. supabase/parts/195
//     made this argument about classes; deleting the evidence that a session
//     was wanted quietly improves every figure computed over what is left.
//   · the BOUNDARY of a truncated read is a real edge, and a month past it is
//     unknown rather than empty. The part-month at the edge is the case
//     src/lib/historyWindow.ts exists for, arriving here on a calendar rather
//     than a chart.
//   · every month boundary is LOCAL. `npm run test:zones` runs this file in
//     Kiritimati (UTC+14) and Midway (UTC-11), where a month read as UTC is off
//     by a day at both ends — so the fixtures are built with the local Date
//     constructor and the assertions are about local months.
//
// Compile with tsc then run with node, like historyWindow.test.ts.
const sessionHistory_1 = require("./sessionHistory");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ALL_STATUSES = ['loading', 'ready', 'partial', 'error'];
/** A session at a LOCAL instant, so the fixtures do not drift across the zones
 *  `npm run test:zones` runs this in. */
const at = (y, m1to12, d, h = 9) => new Date(y, m1to12 - 1, d, h, 0, 0, 0).toISOString();
const row = (over) => ({
    durationMin: 60, status: 'booked', outcome: null, outcomeAt: null, ...over,
});
const NOW = new Date(2026, 8, 2, 12, 0, 0, 0).getTime(); // 2 Sep 2026, local noon
/* ── 1. an empty history is never "nothing happened" ───────────────────────── */
//
// Four statuses, four different sentences, and only ONE of them is allowed to
// state as a fact that nothing happened. This is the assertion the job is
// graded on.
{
    const ready = (0, sessionHistory_1.emptyHistoryLine)('ready');
    ok(/no sessions have happened yet/i.test(ready), `'ready' may state the record is empty — got ${JSON.stringify(ready)}`);
    for (const s of ALL_STATUSES) {
        if (s === 'ready')
            continue;
        const line = (0, sessionHistory_1.emptyHistoryLine)(s);
        ok(!/^no sessions/i.test(line), `'${s}' must not open by asserting there are none — got ${JSON.stringify(line)}`);
        ok(!/nothing happened\.?$/i.test(line), `'${s}' must not end by asserting nothing happened — got ${JSON.stringify(line)}`);
        ok(line.trim().length > 0, `'${s}' still says something rather than rendering blank`);
    }
    const failed = (0, sessionHistory_1.emptyHistoryLine)('error');
    ok(/could not read/i.test(failed), 'a failed read says the read failed');
    ok(/not a record of nothing happening/i.test(failed), 'and says so in as many words, because that is exactly how a member would otherwise read it');
    const partial = (0, sessionHistory_1.emptyHistoryLine)('partial');
    ok(/only part/i.test(partial), "'partial' says the read was short");
    ok(/may be more/i.test(partial), 'and does not close the question');
    // The noun is the caller's, so a coach's screen does not tell them about
    // "your sessions" when it means their clients' — and every status carries it.
    for (const s of ALL_STATUSES) {
        ok((0, sessionHistory_1.emptyHistoryLine)(s, 'one-to-ones').includes('one-to-ones'), `the subject reaches the '${s}' sentence`);
    }
}
/* ── 2. an unmarked session is its own state ───────────────────────────────── */
{
    const unmarked = (0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: null }));
    eq(unmarked.state, 'unmarked', 'no outcome recorded is unmarked');
    eq(unmarked.at, null, 'and there is no time at which it became anything');
    eq(unmarked.disputed, false, 'and nobody has objected to it');
    eq((0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: 'completed', outcomeAt: at(2026, 8, 11) })).state, 'delivered', "'completed' is delivered");
    eq((0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: 'no_show' })).state, 'missed', "'no_show' is not attended");
    eq((0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: 'cancelled' })).state, 'cancelled', "'cancelled' is cancelled");
    eq((0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: 'late_cancelled' })).state, 'late_cancelled', 'and a late cancellation stays distinct from an in-time one');
    // The two cancellations are paid differently by `isPayable`, so collapsing
    // them here would move money on a screen that only meant to tidy a list.
    ok(sessionHistory_1.PAST_STATE_LABEL.cancelled !== sessionHistory_1.PAST_STATE_LABEL.late_cancelled, 'the two cancellations do not read as the same thing');
    // An outcome value added to the check constraint later must arrive as
    // "somebody needs to look at this", never as work that was delivered.
    eq((0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: 'teleported' })).state, 'unmarked', 'an outcome this build has never heard of is not silently delivered');
    // The wording is gymSessions' own, so the payroll blocker and this screen are
    // plainly about the same thing.
    ok(/still needs an outcome recorded/i.test(sessionHistory_1.PAST_STATE_NOTE.unmarked), 'unmarked borrows the payroll blocker’s words rather than inventing new ones');
    ok(!/delivered|cancelled/i.test(sessionHistory_1.PAST_STATE_LABEL.unmarked), 'and its label does not lean on either of the states it is not');
    // Every state has both a label and a note, so no row can render with a hole
    // where its outcome goes.
    for (const s of sessionHistory_1.PAST_STATES) {
        ok((sessionHistory_1.PAST_STATE_LABEL[s] || '').length > 0, `${s} has a label`);
        ok((sessionHistory_1.PAST_STATE_NOTE[s] || '').length > 0, `${s} has a sentence`);
    }
}
/* ── 3. a dispute sits BESIDE the outcome, it does not replace it ──────────── */
//
// src/lib/sessionDispute.ts is explicit that a dispute writes to
// session_approvals and to nothing else, so that a member cannot decide from a
// phone what a coach is paid. If this module let a dispute overwrite the state,
// a disputed session would vanish from the delivered count and payroll would
// come out short with nothing on screen saying why.
{
    const v = (0, sessionHistory_1.pastVerdict)(row({
        startsAt: at(2026, 8, 10), outcome: 'completed', outcomeAt: at(2026, 8, 10, 11),
        approvalState: 'disputed', disputedAt: at(2026, 8, 12),
    }));
    eq(v.state, 'delivered', 'the record still says what the coach recorded');
    eq(v.disputed, true, 'and the objection is carried alongside it');
    eq(v.disputedAt, at(2026, 8, 12), 'with the time it was made');
    const approved = (0, sessionHistory_1.pastVerdict)(row({
        startsAt: at(2026, 8, 10), outcome: 'completed', approvalState: 'approved',
    }));
    eq(approved.disputed, false, 'an approval is not a dispute');
    // A dispute on a session nobody has marked is both true at once: unmarked,
    // and objected to.
    const both = (0, sessionHistory_1.pastVerdict)(row({ startsAt: at(2026, 8, 10), outcome: null, approvalState: 'disputed' }));
    eq(both.state, 'unmarked', 'an objection does not mark a session');
    eq(both.disputed, true, 'and it is still an objection');
}
/* ── 4. cancelled and disputed sessions stay in the list ───────────────────── */
{
    const rows = [
        row({ startsAt: at(2026, 8, 3), outcome: 'completed' }),
        row({ startsAt: at(2026, 8, 4), outcome: 'cancelled' }),
        row({ startsAt: at(2026, 8, 5), outcome: 'late_cancelled' }),
        row({ startsAt: at(2026, 8, 6), outcome: 'no_show' }),
        row({ startsAt: at(2026, 8, 7), outcome: null }),
        row({ startsAt: at(2026, 8, 8), outcome: null, approvalState: 'disputed' }),
    ];
    const past = (0, sessionHistory_1.pastSessions)(rows, NOW);
    eq(past.length, 6, 'every past session is in the list, cancellations included');
    eq(past[0].startsAt, at(2026, 8, 8), 'newest first');
    eq(past[past.length - 1].startsAt, at(2026, 8, 3), 'oldest last');
    const t = (0, sessionHistory_1.tallyPast)(rows, NOW);
    eq(t.delivered, 1, 'one delivered');
    eq(t.cancelled, 1, 'one cancelled with notice');
    eq(t.late_cancelled, 1, 'one cancelled late');
    eq(t.missed, 1, 'one not attended');
    eq(t.unmarked, 2, 'two still need an outcome');
    eq(t.disputed, 1, 'and one of those is disputed');
    eq(t.total, 6, 'and the total is every one of them');
    eq(t.delivered + t.cancelled + t.late_cancelled + t.missed + t.unmarked, t.total, 'the states partition the list — nothing is counted twice and nothing is lost');
}
/* ── 5. an hour nobody booked is not a session that happened ───────────────── */
//
// Inferring "delivered" from "booked and the clock has passed" is the exact
// mistake 33-session-outcomes.sql was written to end. Counting an OPEN slot as
// history would be that mistake one step further on.
{
    ok(!(0, sessionHistory_1.wasBooked)(row({ startsAt: at(2026, 8, 3), status: 'available' })), 'an open slot nobody took is not a session');
    ok(!(0, sessionHistory_1.wasBooked)(row({ startsAt: at(2026, 8, 3), status: 'blocked' })), 'and neither is time the coach blocked out');
    ok((0, sessionHistory_1.wasBooked)(row({ startsAt: at(2026, 8, 3), status: 'booked' })), 'a booked slot is');
    // A cancellation recorded against a row whose slot went back to available is
    // still somebody stating that this was a real session.
    ok((0, sessionHistory_1.wasBooked)(row({ startsAt: at(2026, 8, 3), status: 'available', outcome: 'cancelled' })), 'and so is any row carrying an outcome, whatever its slot state now says');
    const mixed = [
        row({ startsAt: at(2026, 8, 3), status: 'available' }),
        row({ startsAt: at(2026, 8, 4), status: 'booked' }),
    ];
    eq((0, sessionHistory_1.pastSessions)(mixed, NOW).length, 1, 'and only the booked one reaches the history');
}
/* ── 6. history ends at the END of a session, not its start ────────────────── */
{
    const start = new Date(2026, 8, 2, 11, 30, 0, 0);
    const inProgress = row({ startsAt: start.toISOString(), durationMin: 60 }); // 11:30–12:30, now is 12:00
    ok(!(0, sessionHistory_1.hasEnded)(inProgress, NOW), 'a session being delivered right now is not history');
    ok((0, sessionHistory_1.hasEnded)(row({ startsAt: start.toISOString(), durationMin: 20 }), NOW), 'one that finished is');
    // A duration we cannot read must not be guessed at an hour: the start is the
    // only instant actually known.
    ok((0, sessionHistory_1.hasEnded)(row({ startsAt: start.toISOString(), durationMin: null }), NOW), 'with no readable duration the start is what is judged, not an invented hour');
    ok(!(0, sessionHistory_1.hasEnded)(row({ startsAt: 'not-a-date' }), NOW), 'an unparseable start is never in the past');
    eq((0, sessionHistory_1.pastSessions)([row({ startsAt: 'not-a-date' })], NOW).length, 0, 'and it does not reach a history list as a session with no date');
}
/* ── 7. the boundary of a truncated read ───────────────────────────────────── */
{
    const rows = [
        { startsAt: at(2026, 8, 20) },
        { startsAt: at(2026, 5, 14) },
        { startsAt: at(2026, 7, 1) },
    ];
    const whole = (0, sessionHistory_1.readBoundary)(rows, false);
    eq(whole.bounded, false, 'a read that was not truncated has no boundary to announce');
    eq(whole.oldestISO, at(2026, 5, 14), 'though the oldest row is still named for anyone who wants it');
    const cut = (0, sessionHistory_1.readBoundary)(rows, true);
    eq(cut.bounded, true, 'a truncated read does');
    eq(cut.oldestISO, at(2026, 5, 14), 'and it sits at the oldest row that came back');
    // Truncated with nothing readable in it is not a boundary anybody can name.
    // Putting a date on screen that came from nowhere is its own kind of lie.
    eq((0, sessionHistory_1.readBoundary)([], true).bounded, false, 'a truncated read with no rows names no boundary');
    eq((0, sessionHistory_1.readBoundary)([{ startsAt: 'rubbish' }], true).oldestISO, null, 'and neither does one with no readable date');
}
/* ── 8. a month past the boundary is UNKNOWN, not empty ────────────────────── */
//
// This is the calendar half of the rule src/lib/historyWindow.ts states for a
// chart. There the part-month at the edge is dropped, because a fraction of a
// month drawn at full scale reads as a quiet month. A calendar cannot drop a
// month, so it says which day it is complete from instead.
{
    // Read back to 14 June 2026 and no further. `at` takes a 1-12 month;
    // `monthCoverage` takes the 0-11 index `dateParts` returns, so June is 5.
    const b = (0, sessionHistory_1.readBoundary)([{ startsAt: at(2026, 6, 14) }, { startsAt: at(2026, 8, 20) }], true);
    eq((0, sessionHistory_1.monthCoverage)(2026, 7, b, 'partial'), 'covered', 'August is entirely inside the read');
    eq((0, sessionHistory_1.monthCoverage)(2026, 6, b, 'partial'), 'covered', 'so is July');
    eq((0, sessionHistory_1.monthCoverage)(2026, 5, b, 'partial'), 'edge', 'June is the month the read stops inside');
    eq((0, sessionHistory_1.monthCoverage)(2026, 4, b, 'partial'), 'beyond', 'May was never asked for');
    eq((0, sessionHistory_1.monthCoverage)(2025, 11, b, 'partial'), 'beyond', 'and neither was December of the year before');
    // A read that came back whole covers everything, however old.
    const wholeB = (0, sessionHistory_1.readBoundary)([{ startsAt: at(2026, 6, 14) }], false);
    eq((0, sessionHistory_1.monthCoverage)(1998, 0, wholeB, 'ready'), 'covered', 'a complete read means an empty month really is empty — this must stay a no-op for everybody under the cap');
    // The one that matters most: nothing is "covered" while the read has failed
    // or is still in flight, whatever the boundary says.
    for (const s of ['error', 'loading']) {
        eq((0, sessionHistory_1.monthCoverage)(2026, 7, b, s), 'unknown', `a month under '${s}' is unknown, never covered`);
        eq((0, sessionHistory_1.monthCoverage)(2026, 7, wholeB, s), 'unknown', `even with a whole read behind it, '${s}' knows nothing`);
        eq((0, sessionHistory_1.monthCoverage)(2026, 7, (0, sessionHistory_1.readBoundary)([], false), s), 'unknown', `and an empty read under '${s}' is not an empty month`);
    }
}
/* ── 8b. the edge month, asserted on its own so the label cannot drift ─────── */
{
    // Boundary at 14 June 2026, local.
    const b = (0, sessionHistory_1.readBoundary)([{ startsAt: at(2026, 6, 14) }], true);
    eq((0, sessionHistory_1.monthCoverage)(2026, 5, b, 'partial'), 'edge', 'the month the read stops inside is half-known');
    eq((0, sessionHistory_1.monthCoverage)(2026, 6, b, 'partial'), 'covered', 'the month after it is whole');
    eq((0, sessionHistory_1.monthCoverage)(2026, 4, b, 'partial'), 'beyond', 'the month before it was never read');
    // A boundary that lands exactly on the first instant of a month makes that
    // month whole, not an edge. Off by one here and every member is told their
    // complete month is partial, for ever.
    const onTheFirst = (0, sessionHistory_1.readBoundary)([{ startsAt: new Date(2026, 5, 1, 0, 0, 0, 0).toISOString() }], true);
    eq((0, sessionHistory_1.monthCoverage)(2026, 5, onTheFirst, 'partial'), 'covered', 'a read reaching local midnight on the 1st covers that whole month');
    eq((0, sessionHistory_1.monthCoverage)(2026, 4, onTheFirst, 'partial'), 'beyond', 'and the month before it is still beyond');
}
/* ── 9. the months are LOCAL months ────────────────────────────────────────── */
//
// Run under TZ=Pacific/Kiritimati (UTC+14) and TZ=Pacific/Midway (UTC-11) by
// `npm run test:zones`. A boundary at local midday on the 1st is a different
// UTC day in both, and a UTC month test would put it in the wrong month in one
// of them.
{
    const noonOnTheFirst = new Date(2026, 5, 1, 12, 0, 0, 0); // 1 June 2026, local noon
    const b = (0, sessionHistory_1.readBoundary)([{ startsAt: noonOnTheFirst.toISOString() }], true);
    eq((0, sessionHistory_1.monthCoverage)(2026, 5, b, 'partial'), 'edge', 'a boundary at local noon on the 1st leaves that month an edge month in every zone');
    eq((0, sessionHistory_1.monthCoverage)(2026, 4, b, 'partial'), 'beyond', 'and the previous month beyond, in every zone');
    eq((0, sessionHistory_1.monthCoverage)(2026, 6, b, 'partial'), 'covered', 'and the next one covered, in every zone');
    // The last local instant of a month belongs to that month, not the next.
    const lastMoment = new Date(2026, 5, 30, 23, 59, 59, 999);
    const lb = (0, sessionHistory_1.readBoundary)([{ startsAt: lastMoment.toISOString() }], true);
    eq((0, sessionHistory_1.monthCoverage)(2026, 5, lb, 'partial'), 'edge', '23:59 on the 30th is still June');
    eq((0, sessionHistory_1.monthCoverage)(2026, 6, lb, 'partial'), 'covered', 'and July is untouched by it');
    // December → January is the wrap the year arithmetic gets wrong.
    const newYear = new Date(2026, 0, 3, 9, 0, 0, 0);
    const nb = (0, sessionHistory_1.readBoundary)([{ startsAt: newYear.toISOString() }], true);
    eq((0, sessionHistory_1.monthCoverage)(2026, 0, nb, 'partial'), 'edge', 'January 2026 is the edge month');
    eq((0, sessionHistory_1.monthCoverage)(2025, 11, nb, 'partial'), 'beyond', 'December 2025 is beyond it');
    eq((0, sessionHistory_1.monthCoverage)(2026, 1, nb, 'partial'), 'covered', 'February 2026 is inside it');
}
/* ── 10. an arbitrary run of days, for the week views ──────────────────────── */
{
    const monday = new Date(2026, 7, 24, 0, 0, 0, 0).getTime();
    const nextMonday = new Date(2026, 7, 31, 0, 0, 0, 0).getTime();
    const b = (0, sessionHistory_1.readBoundary)([{ startsAt: at(2026, 8, 26) }], true); // boundary mid-week
    eq((0, sessionHistory_1.rangeCoverage)(monday, nextMonday, b, 'partial'), 'edge', 'the week the read stops inside is half-known');
    eq((0, sessionHistory_1.rangeCoverage)(nextMonday, nextMonday + 7 * 86400000, b, 'partial'), 'covered', 'the week after is whole');
    eq((0, sessionHistory_1.rangeCoverage)(monday - 7 * 86400000, monday, b, 'partial'), 'beyond', 'the week before was never read');
    eq((0, sessionHistory_1.rangeCoverage)(monday, nextMonday, b, 'error'), 'unknown', 'and a failed read knows nothing about any week');
}
/* ── 11. what the screen actually says at the boundary ─────────────────────── */
{
    const label = (iso) => `[${iso.slice(0, 10)}]`;
    const b = (0, sessionHistory_1.readBoundary)([{ startsAt: at(2026, 6, 14) }], true);
    eq((0, sessionHistory_1.monthCoverageNote)('covered', b, label), null, 'a covered month says nothing — a note on every month is a note nobody reads');
    const beyond = (0, sessionHistory_1.monthCoverageNote)('beyond', b, label);
    ok(/missing from this screen rather than absent from your record/i.test(beyond), 'a month beyond the read says the sessions are missing here, not missing from the record');
    ok(beyond.includes('['), 'and names the day the history is loaded back to');
    const edge = (0, sessionHistory_1.monthCoverageNote)('edge', b, label);
    ok(/only part of this month/i.test(edge), 'the edge month says it is only part read');
    ok(edge.includes('['), 'and names the day it starts at');
    // None of the three asserts the month is blank. A calendar draws more than
    // sessions — logged workouts come from a different read — so that claim can
    // be false on the very screen the sentence appears on.
    for (const c of ['beyond', 'edge', 'unknown']) {
        ok(!/is blank/i.test((0, sessionHistory_1.monthCoverageNote)(c, b, label)), `'${c}' does not claim the month is blank`);
    }
    const unknown = (0, sessionHistory_1.monthCoverageNote)('unknown', b, label);
    ok(/not a statement that nothing happened/i.test(unknown), 'and a month under a failed read says outright that blank is not the same as empty');
    // 'unknown' covers a read still in flight AND a read that failed, and a
    // failed read leaves a cached copy on screen. So the sentence must not assert
    // the month is blank — it would be false in the case that matters most.
    ok(!/is blank/i.test(unknown), 'without asserting the month is blank, which it may not be');
    // Not one of the three says the month was empty.
    for (const c of ['beyond', 'edge', 'unknown']) {
        const note = (0, sessionHistory_1.monthCoverageNote)(c, b, label);
        ok(!/^nothing happened/i.test(note), `'${c}' does not open by asserting nothing happened`);
    }
    // A boundary with no readable date still produces a sentence rather than one
    // with a hole in it where the date should be.
    const noDate = (0, sessionHistory_1.readBoundary)([], true);
    for (const c of ['beyond', 'edge']) {
        const note = (0, sessionHistory_1.monthCoverageNote)(c, noDate, label);
        ok(note.length > 0 && !note.includes('undefined') && !note.includes('null'), `'${c}' with no boundary date still reads as a sentence`);
    }
}
/* ── 12. the gap this module cannot close, stated rather than hidden ───────── */
//
// `cancel_my_session` frees the slot and nulls `client_id`, so a booking the
// member cancelled themselves stops being theirs and cannot be read back. No
// screen built on this module may imply otherwise.
{
    ok(/cancelled yourself/i.test(sessionHistory_1.CLIENT_CANCELLED_GAP_NOTE), 'the gap is named as the member’s own cancellations');
    ok(/not listed here/i.test(sessionHistory_1.CLIENT_CANCELLED_GAP_NOTE), 'and stated as an omission rather than left to be inferred');
    ok(!/all|every|complete/i.test(sessionHistory_1.CLIENT_CANCELLED_GAP_NOTE), 'and it never claims the list is complete');
}
if (errors.length) {
    console.error(`sessionHistory.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors.slice(0, 20))
        console.error('  · ' + e);
    if (errors.length > 20)
        console.error(`  … and ${errors.length - 20} more`);
    process.exit(1);
}
console.log('sessionHistory.test.ts — ok');
