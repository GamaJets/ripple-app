"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Member churn — the rate, and every reason it is withheld instead.
//
// This arithmetic used to live inside studio-web/app/analytics/page.tsx, where
// nothing could run it: not a test, and not the owner's phone, which said so
// out loud on the Growth tab ("member churn ... is not derived anywhere on this
// handset"). It is a module now and this file is the reason that is safe — the
// console and the handset call the same functions, so an assertion here holds
// for both surfaces or for neither.
//
// The defect every assertion below is aimed at is a rate whose top and bottom
// halves are about different people. The denominator can only count somebody it
// has a JOIN date for; the numerator once counted every departure. A gym that
// imported its roster from another system arrives with missing start dates, and
// its churn is then overstated by exactly those members — on the one figure that
// says whether the business is holding on to anybody.
//
// Compile with tsc, run with node. No node:assert anywhere.
const memberChurn_1 = require("./memberChurn");
const gymRetention_1 = require("./gymRetention");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/**
 * Fixed, and LOCAL noon rather than a bare date or a UTC midnight.
 *
 * This repo runs its suites under six timezones, from Kiritimati to Midway.
 * `Date.parse('2026-09-01')` is UTC midnight, which is 31 August west of
 * Greenwich — so a `NOW` written that way would put the running month one month
 * earlier for half the zones and every "still running" assertion below would
 * flip. Noon local is the same calendar day everywhere this suite runs.
 */
const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime(); // 15 September 2026, local
const m = (memberId, startedOn, endsOn, status) => ({ memberId, memberName: memberId, startedOn, endsOn, status });
/* ── isDay: what counts as a date ─────────────────────────────────────────── */
ok((0, memberChurn_1.isDay)('2026-08-01'), 'a plain day is a day');
ok((0, memberChurn_1.isDay)('2026-08-01T09:00:00Z'), 'a stamp that begins with a day is a day');
ok(!(0, memberChurn_1.isDay)(''), 'the empty string is not a day');
ok(!(0, memberChurn_1.isDay)(null), 'null is not a day');
ok(!(0, memberChurn_1.isDay)(undefined), 'undefined is not a day');
ok(!(0, memberChurn_1.isDay)('August 2026'), 'a month name is not a day');
/* ── one person, several memberships ──────────────────────────────────────
 *
 * Somebody who cancelled in March and rejoined in June has TWO rows. Counted
 * per row they are two joiners and the second is filed under June — a gym that
 * recruits well and keeps nobody, assembled entirely out of its own returning
 * members. Their join month is the earliest start they have ever had. */
{
    const spans = (0, memberChurn_1.memberSpans)([
        m('ann', '2026-06-01', null, 'active'),
        m('ann', '2026-01-10', '2026-03-31', 'cancelled'),
    ]);
    eq(spans.length, 1, 'two memberships for one person are one span');
    eq(spans[0].joinedOn, '2026-01-10', 'the join is the earliest start they have ever had');
    ok(spans[0].open, 'a live membership with no end date leaves them on the books');
    ok(spans[0].active, 'and marks them active');
    eq(spans[0].leftOn, null, 'somebody still holding a membership has not left, whatever an older row says');
    eq((0, memberChurn_1.undatedExitCount)(spans), 0, 'a dated cancellation is not an undated exit');
    eq((0, memberChurn_1.onBooksCount)(spans), 1, 'they are on the books');
}
/* ── the leaving day is the LATEST end, and only when every row has one ─── */
{
    const spans = (0, memberChurn_1.memberSpans)([
        m('bob', '2025-02-01', '2026-03-31', 'cancelled'),
        m('bob', '2026-04-01', '2026-07-31', 'expired'),
    ]);
    eq(spans[0].leftOn, '2026-07-31', 'the leaving day is the latest end date they hold');
    ok(!spans[0].open, 'nothing of theirs is still running');
}
{
    const spans = (0, memberChurn_1.memberSpans)([
        m('cat', '2025-02-01', '2026-03-31', 'cancelled'),
        // Cancelled in place with no end date — the shape a gym gets when `status`
        // moved and nobody wrote a day. There is no `cancelled_at` column to fall
        // back on.
        m('cat', '2026-04-01', null, 'cancelled'),
    ]);
    ok(spans[0].undatedExit, 'a cancellation with no end date is an undated exit');
    eq(spans[0].leftOn, null, 'and it suppresses the leaving day entirely — the record does not know when they went, '
        + 'and the older row is not an answer to a question about the newer one');
    eq((0, memberChurn_1.undatedExitCount)(spans), 1, 'counted, so a screen can say how many');
    eq((0, memberChurn_1.onBooksCount)(spans), 0, 'a cancelled member with no end date is not on the books');
}
/* ── a name arrives on whichever row happens to carry one ─────────────────── */
{
    const spans = (0, memberChurn_1.memberSpans)([
        { memberId: 'dee', memberName: null, startedOn: '2026-01-01', endsOn: null, status: 'active' },
        { memberId: 'dee', memberName: 'Dee', startedOn: '2026-02-01', endsOn: null, status: 'active' },
    ]);
    eq(spans[0].name, 'Dee', 'a name on any of their rows names the span');
}
{
    // `memberName` is optional on the input shape. Absent must arrive as null and
    // not as undefined: every reader of a span tests `name == null`, and an
    // `undefined` slipping through is how that check quietly stops matching.
    const spans = (0, memberChurn_1.memberSpans)([{ memberId: 'eve', startedOn: '2026-01-01', endsOn: null, status: 'active' }]);
    eq(spans[0].name, null, 'a span with no name carries null, never undefined');
    ok(!Object.is(spans[0].name, undefined), 'and specifically not undefined');
}
/* ── the rate: one population over another ────────────────────────────────
 *
 * Twenty members joined last year and are still here. In August, two of them
 * leave. August's churn is 2/20 = 10%. */
const twenty = (n, prefix = 'k') => Array.from({ length: n }, (_, i) => m(`${prefix}${i}`, '2025-01-15', null, 'active'));
function august(rows) {
    const spans = (0, memberChurn_1.memberSpans)(rows);
    const months = (0, memberChurn_1.churnMonths)(spans, (0, memberChurn_1.undatedExitCount)(spans), NOW);
    const aug = months.find((x) => x.key === '2026-08');
    if (!aug)
        throw new Error('August 2026 is not among the months drawn');
    return aug;
}
{
    const rows = twenty(20);
    rows[0] = m('k0', '2025-01-15', '2026-08-14', 'cancelled');
    rows[1] = m('k1', '2025-01-15', '2026-08-20', 'cancelled');
    const aug = august(rows);
    eq(aug.opening, 20, 'everybody who joined before the 1st and had not left is in the opening roster');
    eq(aug.left, 2, 'two left in August');
    eq(aug.joined, 0, 'nobody joined in August');
    eq(aug.net, -2, 'the net is joiners minus leavers');
    eq(aug.churn, 0.1, 'two of twenty is ten per cent');
    eq(aug.churnNote, '', 'and there is no reason to withhold it');
    eq((0, memberChurn_1.churnHeadline)(aug).pct, 10, 'the headline rounds it to a whole percentage');
    eq((0, memberChurn_1.churnHeadline)(aug).label, 'August 2026', 'and names the month it is about');
}
/* ── the defect: an undated joiner counted leaving ────────────────────────
 *
 * The same gym, plus one member imported from another system with no start
 * date, who leaves in August. They cannot be in the opening roster — "joined
 * before the 1st" is a question about a date they do not have — so counting
 * their departure would put them in the numerator and nowhere else: 3/20 =
 * 15%, an overstatement of exactly one member, at the gym whose records are
 * least likely to be checked against anything. */
{
    const rows = twenty(20);
    rows[0] = m('k0', '2025-01-15', '2026-08-14', 'cancelled');
    rows[1] = m('k1', '2025-01-15', '2026-08-20', 'cancelled');
    rows.push(m('imported', null, '2026-08-05', 'cancelled'));
    const spans = (0, memberChurn_1.memberSpans)(rows);
    eq((0, memberChurn_1.undatedJoinCount)(spans), 1, 'the member with no start date is counted and named');
    const aug = august(rows);
    eq(aug.left, 3, 'their departure still happened and is still counted — they left');
    eq(aug.undatedLeavers, 1, 'and it is carried separately so the screen can say which');
    eq(aug.opening, 20, 'they are in no opening roster, because there is no date to put them in one');
    eq(aug.churn, null, 'so August has NO rate — not 15%, which counts them once, and not 10%, which quietly drops '
        + 'a real departure and understates churn where the record is worst');
    ok(/no start date recorded/.test(aug.churnNote), `the reason names the problem — got ${JSON.stringify(aug.churnNote)}`);
    eq(aug.net, null, 'and the net is withheld too: it would subtract an arrival it never added');
    eq((0, memberChurn_1.churnHeadline)(aug).pct, null, 'the headline withholds the figure');
    eq((0, memberChurn_1.churnHeadline)(aug).note, aug.churnNote, 'and gives the month’s own reason rather than a generic one');
}
/* ── an undated EXIT anywhere withholds every month ───────────────────────
 *
 * Not just the month they might have left in — nobody knows which month that
 * is. Every month's leaver count is potentially short, in the direction that
 * makes the gym look like it is holding on to people. */
{
    const rows = twenty(20);
    rows[0] = m('k0', '2025-01-15', '2026-08-14', 'cancelled');
    rows[1] = m('k1', '2025-01-15', '2026-08-20', 'cancelled');
    rows.push(m('vanished', '2025-06-01', null, 'cancelled'));
    const spans = (0, memberChurn_1.memberSpans)(rows);
    eq((0, memberChurn_1.undatedExitCount)(spans), 1, 'one membership ended without saying when');
    const months = (0, memberChurn_1.churnMonths)(spans, (0, memberChurn_1.undatedExitCount)(spans), NOW);
    ok(months.every((x) => x.churn == null), 'no month carries a rate while a leaver could belong to any of them');
    ok(months.every((x) => x.net == null), 'and no month carries a net');
    const aug = months.find((x) => x.key === '2026-08');
    ok(/no end date/.test(aug.churnNote), `the reason says so — got ${JSON.stringify(aug.churnNote)}`);
}
/* ── a running month has no rate, ever ────────────────────────────────────
 *
 * September is half over. The leavers it has not had yet have not happened, so
 * a rate over it is a rate over a fraction of a month and always reads as good
 * news. */
{
    const rows = twenty(20);
    rows[0] = m('k0', '2025-01-15', '2026-09-02', 'cancelled');
    const spans = (0, memberChurn_1.memberSpans)(rows);
    const months = (0, memberChurn_1.churnMonths)(spans, 0, NOW);
    const sep = months.find((x) => x.key === '2026-09');
    ok(sep.running, 'September is still running on 15 September');
    eq(sep.left, 1, 'the departure it has had is still counted');
    eq(sep.churn, null, 'and it has no rate');
    ok(/still running/.test(sep.churnNote), `for the stated reason — got ${JSON.stringify(sep.churnNote)}`);
    const last = (0, memberChurn_1.lastClosedMonth)(months);
    eq(last?.key, '2026-08', 'the headline month is the last one that actually finished');
}
/* ── a small gym gets its counts and not a percentage ─────────────────────
 *
 * MIN_COHORT_FOR_RATE is shared with the Retention screen so the two cannot
 * land on different definitions of "too small to say". Nine members means one
 * person moving swings the figure past eleven points. */
{
    const rows = twenty(gymRetention_1.MIN_COHORT_FOR_RATE - 1, 'small');
    rows[0] = m('small0', '2025-01-15', '2026-08-14', 'cancelled');
    const aug = august(rows);
    eq(aug.opening, gymRetention_1.MIN_COHORT_FOR_RATE - 1, 'the roster is one under the floor');
    eq(aug.left, 1, 'and the count is still shown — it is true and useful');
    eq(aug.churn, null, 'but no percentage is drawn over it');
    ok(/would move it/.test(aug.churnNote), `and the reason is stated in the gym’s own terms — got ${JSON.stringify(aug.churnNote)}`);
    eq(aug.net, -1, 'the net survives: it is a count, not a rate');
}
/* ── an empty month ───────────────────────────────────────────────────────── */
{
    const months = (0, memberChurn_1.churnMonths)([], 0, NOW);
    const aug = months.find((x) => x.key === '2026-08');
    eq(aug.opening, 0, 'nobody was on the books');
    eq(aug.churn, null, 'so there is nothing to be a share of');
    ok(/nobody was on the books/.test(aug.churnNote), `and it says so — got ${JSON.stringify(aug.churnNote)}`);
    eq((0, memberChurn_1.churnHeadline)(null).pct, null, 'and with no month at all the headline is a dash');
    ok(/no finished month/.test((0, memberChurn_1.churnHeadline)(null).note), 'never 0%, which is the best figure on the scale offered to somebody who has no figure');
}
/* ── somebody who joined and left inside the same month ───────────────────
 *
 * In neither the opening roster nor the denominator — the standard treatment,
 * and why both counts are shown beside the rate. */
{
    const rows = twenty(20);
    rows.push(m('brief', '2026-08-03', '2026-08-20', 'cancelled'));
    const aug = august(rows);
    eq(aug.joined, 1, 'they joined in August');
    eq(aug.left, 1, 'and left in August');
    eq(aug.opening, 20, 'and are in neither the opening roster');
    eq(aug.churn, 1 / 20, 'nor the denominator the rate is drawn over');
    eq(aug.net, 0, 'the net is zero, which is the truth about the month');
}
/* ── the window ───────────────────────────────────────────────────────────── */
{
    const months = (0, memberChurn_1.churnMonths)([], 0, NOW);
    eq(months.length, memberChurn_1.MONTHS_SHOWN, 'thirteen months, so the same month last year is on screen');
    // Newest first, which is `recentMonths`' own order and what the console
    // table already renders. `lastClosedMonth` depends on it: walking the array
    // from the wrong end finds September 2025 and labels a thirteen-month-old
    // figure as the gym's current churn.
    eq(months[0].key, '2026-09', 'newest first — the running month leads');
    eq(months[months.length - 1].key, '2025-09', 'and the same month last year is the last entry');
    eq((0, memberChurn_1.churnMonths)([], 0, NOW, 3).length, 3, 'and a caller with less room can ask for fewer');
}
/* ── a member who left before the month began is not in its opening roster ─ */
{
    const rows = twenty(20);
    rows[0] = m('k0', '2025-01-15', '2026-07-31', 'cancelled');
    const aug = august(rows);
    eq(aug.opening, 19, 'somebody who left in July is not on the books when August opens');
    eq(aug.left, 0, 'and does not leave again in August');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('memberChurn.test.ts — ok');
