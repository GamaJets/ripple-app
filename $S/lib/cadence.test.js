"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// When a client was due, from their own rhythm. Compile with tsc, run with node.
//
// Two failures are worth almost the whole file.
//
// THE FIRST is the mean. A client who trains every three days and takes one
// three-week holiday has a mean gap of six days and a median of three. Paced
// off the mean, the app waits twelve days before calling them late — it has
// been taught by one holiday to expect another, and the whole point of this
// module is to speak on day four rather than day fourteen. The median case
// below is the assertion that pins it.
//
// THE SECOND is an empty record read as punctuality. No events must produce
// 'unknown', never 'inside'. A client the app knows nothing about is the one
// most likely to have already gone, and reporting them as not late is the same
// mistake `atRiskClient`, `trainerHealth` and `assessDrift`'s header each
// describe finding: absence of evidence read as evidence of health.
//
// Every timestamp below is built from a local midnight, matching the local day
// boundary `localDayKey` and `activeDayLog` use. `npm run test:zones` runs this
// suite under Los Angeles, Auckland and Dubai, so a UTC-based day key here
// would fail in two of the three.
const cadence_1 = require("./cadence");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const DAY = 86400000;
/** Local midnight today, so every fixture below is a whole number of local days
 *  away from `now` whatever zone the suite is run in. */
const midnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
/** "Now" is midday, so nothing sits on a boundary that a rounding change could
 *  push either way. */
const NOW = midnight + 12 * 3600000;
/** An event `n` days ago, at that day's local midday. */
const ago = (n, kind = 'workout') => ({ at: new Date(midnight - n * DAY + 12 * 3600000).toISOString(), kind });
/** Events every `gap` days going back `count` visits, the newest `lastAgo` days
 *  ago. The ordinary shape of a client's record. */
const every = (gap, count, lastAgo) => {
    const out = [];
    for (let i = 0; i < count; i++)
        out.push(ago(lastAgo + i * gap));
    return out;
};
/* ── nothing on record is not punctuality ───────────────────────────────── */
const empty = (0, cadence_1.assessCadence)([], NOW);
eq(empty.state, 'unknown', 'an empty record is unknown');
eq(empty.noPattern, 'no-events', 'and says why');
eq(empty.usualGapDays, null, 'with no gap');
eq(empty.sinceLastDays, null, 'and no days-since — which is not zero and not infinity');
eq(empty.overdueDays, null, 'and nothing overdue');
ok(!(0, cadence_1.worthRaising)(empty), 'and it is never raised to a coach');
/* ── too little to speak from ───────────────────────────────────────────── */
// Three active days is two gaps, and a median of two values is their mean.
const thin = (0, cadence_1.assessCadence)(every(7, cadence_1.MIN_ACTIVE_DAYS - 1, 1), NOW);
eq(thin.state, 'unknown', 'three active days is too few for a usual gap');
eq(thin.noPattern, 'too-few', 'and says which refusal it is');
eq(thin.activeDays, cadence_1.MIN_ACTIVE_DAYS - 1, 'while still reporting what it saw');
// Four visits packed into under a fortnight: enough days, not enough record.
const short = (0, cadence_1.assessCadence)(every(2, 5, 1), NOW);
eq(short.spanDays, 8, 'eight days of record');
eq(short.state, 'unknown', 'a record shorter than a fortnight settles nothing');
eq(short.noPattern, 'too-short', 'and says so');
ok(short.spanDays < cadence_1.MIN_SPAN_DAYS, 'which is the constant it is measured against');
// Somebody who comes once a month. Real, and not this module's business. Read
// over a long window on purpose: at the fifty-six days the app actually reads,
// a monthly visitor has two active days and is refused as 'too-few' before the
// cap is ever consulted, which would leave the cap untested.
const spread = (0, cadence_1.assessCadence)(every(30, 5, 2), NOW, 200);
eq(spread.state, 'unknown', 'a monthly visitor has no cadence worth pacing against');
eq(spread.noPattern, 'too-spread', 'and says so rather than calling them steady');
ok(30 > cadence_1.MAX_USUAL_GAP_DAYS, 'a thirty-day gap is past the cap');
/* ── THE MEDIAN. One holiday must not move the usual gap ────────────────── */
// Every three days for a month, with one three-week hole in the middle. Mean
// gap ≈ 6, median 3.
const holiday = [
    ...every(3, 6, 1), // recent month, every three days
    ...every(3, 6, 1 + 15 + 21) // and again, on the far side of a 21-day hole
];
const h = (0, cadence_1.assessCadence)(holiday, NOW, 90);
eq(h.usualGapDays, 3, 'one three-week holiday does not move a three-day rhythm');
ok(h.usualGapDays < 5, 'the mean would have said six — the median says three');
/* ── the ordinary readings ──────────────────────────────────────────────── */
// Every three days, last seen yesterday. Not late by any reading.
const steady = (0, cadence_1.assessCadence)(every(3, 8, 1), NOW);
eq(steady.usualGapDays, 3, 'their usual gap is three days');
eq(steady.sinceLastDays, 1, 'last seen yesterday');
eq(steady.state, 'inside', 'and they are inside their own gap');
eq(steady.overdueDays, null, 'nothing overdue, and never a negative number of days late');
ok(!(0, cadence_1.worthRaising)(steady), 'nothing to raise');
// The same client, four days past a three-day gap. Tolerance is
// max(3, 3 × 0.5) = 3, so four days late clears it.
const late = (0, cadence_1.assessCadence)(every(3, 8, 7), NOW);
eq(late.usualGapDays, 3, 'same rhythm');
eq(late.sinceLastDays, 7, 'seven days of silence');
eq(late.overdueDays, 4, 'four days past when they were due');
eq(late.state, 'overdue', 'and that is overdue');
ok((0, cadence_1.worthRaising)(late), 'this one reaches the coach');
// The whole argument for the module, restated as an assertion: drift needs a
// fourteen-day near window before it can say anything, and this said it at
// seven days of silence.
ok(late.sinceLastDays < 14, 'and it said so before a fortnight had passed');
// Just past the gap and no further. Everybody is here every week, so it must
// not reach a coach.
const due = (0, cadence_1.assessCadence)(every(7, 6, 8), NOW);
eq(due.usualGapDays, 7, 'a weekly client');
eq(due.state, 'due', 'one day past their gap is due, not overdue');
ok(!(0, cadence_1.worthRaising)(due), 'and being due is never surfaced — that is the nagging this avoids');
/* ── the tolerance is proportional AND floored, and both halves matter ──── */
// A daily trainer. A flat proportional rule (1 × 0.5) would call them late
// after a day and a half, which is a Sunday. The floor is what stops it.
const daily = (0, cadence_1.assessCadence)(every(1, 20, 2), NOW);
eq(daily.usualGapDays, 1, 'a daily trainer');
eq(daily.state, 'due', 'two days of silence from a daily trainer is not yet a signal');
ok(cadence_1.MIN_LATE_DAYS === 3, 'because the floor is three days');
const dailyGone = (0, cadence_1.assessCadence)(every(1, 20, 5), NOW);
eq(dailyGone.state, 'overdue', 'five days of silence from a daily trainer is');
// A fortnightly client. A flat three-day rule would call them late constantly;
// the proportion is what stops it.
// 120 days, for the same reason: five fortnightly visits do not fit in 56.
const fortnightly = (0, cadence_1.assessCadence)(every(14, 5, 17), NOW, 120);
eq(fortnightly.usualGapDays, 14, 'a fortnightly client');
eq(fortnightly.state, 'due', 'three days past a fortnight is nothing');
ok(cadence_1.LATE_FRACTION === 0.5, 'because the tolerance is half their gap again');
const fortnightlyGone = (0, cadence_1.assessCadence)(every(14, 5, 23), NOW, 120);
eq(fortnightlyGone.state, 'overdue', 'nine days past a fortnight is something');
/* ── several events in one evening are one visit ────────────────────────── */
// Five exercises logged on one night must not read as five visits with a gap
// of nothing — which would make the client permanently overdue.
const busyEvening = [
    ...every(4, 6, 2),
    ago(2, 'check_in'), ago(2, 'session'), ago(2, 'visit'),
];
const busy = (0, cadence_1.assessCadence)(busyEvening, NOW);
eq(busy.usualGapDays, 4, 'a busy evening is one active day, not four');
eq(busy.activeDays, 6, 'and the count of active days says so');
/* ── the sentence ───────────────────────────────────────────────────────── */
for (const c of [empty, thin, short, spread, steady, late, due, daily, fortnightly]) {
    const line = (0, cadence_1.cadenceLine)(c);
    ok(line.length > 20, 'every state has something to say');
    ok(line.endsWith('.'), 'and punctuates it');
    ok(!line.includes('!'), 'and does not shout');
    // The refusals src/lib/nudge.ts makes mechanical. This module writes coach-
    // facing prose, so it may name what the record does not hold — but it must
    // never assert a state of mind or a cause.
    ok(!/\bmotivat|\bcommit|\blaz(y|iness)\b|\bgiven up\b|\bquit/i.test(line), `"${line}" states no verdict on the person`);
    ok(!/\binjur|\bholiday|\bsick\b|\bpayment/i.test(line), `"${line}" names no cause the record cannot see`);
}
ok((0, cadence_1.cadenceLine)(late).includes('past their own usual gap'), 'the overdue sentence measures against their own gap and not against a target');
ok((0, cadence_1.cadenceLine)(steady).includes('not late'), 'and a client inside their gap is told to be left alone');
/* ── ordering, which is relative to each client’s own gap ───────────────── */
const row = (cadence, id) => ({ id, cadence });
// Eight days late on a fourteen-day gap is a smaller break than six days late
// on a three-day gap, and raw days would have them the other way round.
const bigGapSmallMiss = row((0, cadence_1.assessCadence)(every(14, 5, 22), NOW, 120), 'fortnightly');
const smallGapBigMiss = row((0, cadence_1.assessCadence)(every(3, 8, 9), NOW), 'frequent');
eq(bigGapSmallMiss.cadence.overdueDays, 8, 'the fortnightly client is eight days late');
eq(smallGapBigMiss.cadence.overdueDays, 6, 'the frequent one only six');
eq((0, cadence_1.byLateness)([bigGapSmallMiss, smallGapBigMiss])[0].id, 'frequent', 'but six days off a three-day rhythm outranks eight off a fortnightly one');
/* ── the note above the list ────────────────────────────────────────────── */
eq((0, cadence_1.overdueNote)(null), 'Working out who was due…', 'null in, null out — no count before the read lands');
ok((0, cadence_1.overdueNote)([row(steady, 'a'), row(due, 'b')]).includes('Nobody is past'), 'a settled list with nobody late says so plainly');
ok((0, cadence_1.overdueNote)([row(empty, 'a'), row(thin, 'b')]).includes('settled enough'), 'and a list nobody could be paced from says THAT instead, not "nobody is late"');
ok((0, cadence_1.overdueNote)([row(late, 'a')]).includes('1 client is'), 'one client, singular');
ok((0, cadence_1.overdueNote)([row(late, 'a'), row(dailyGone, 'b')]).includes('2 clients are'), 'two, plural');
ok((0, cadence_1.overdueNote)([row(late, 'a')]).includes('earlier than the quiet list'), 'and it says what this signal is relative to the one next door');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('cadence.test.ts — ok');
