"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TWO_FIGURES_NEVER_SUM = exports.TAKINGS_IS_GROSS = exports.DELIVERED_IS_MARKED = exports.UNKNOWN_MONTH = void 0;
exports.monthToDate = monthToDate;
exports.sessionMonth = sessionMonth;
exports.sessionMonthFor = sessionMonthFor;
exports.deliveredValue = deliveredValue;
exports.unmarkedValue = unmarkedValue;
exports.unmarkedLine = unmarkedLine;
exports.sessionsUnknownLine = sessionsUnknownLine;
exports.takingsStrands = takingsStrands;
const loadStatus_1 = require("../ui/loadStatus");
const sessionHistory_1 = require("./sessionHistory");
const coachMoney_1 = require("./coachMoney");
/* ── the month ────────────────────────────────────────────────────────────── */
/** Midnight on the 1st of the month containing `now`, local time, through to
 *  `now` itself. The same boundary `monthStart` in coachMoney.ts uses, so the
 *  sessions half and the money half of a screen describe the same span. */
function monthToDate(now = new Date()) {
    const d = new Date(now.getTime());
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now.getTime() };
}
/** Nothing established, which is what a short read gets. */
exports.UNKNOWN_MONTH = {
    delivered: null, unmarked: null, missed: null,
    cancelled: null, lateCancelled: null, disputed: null,
};
/**
 * Count a window of sessions by outcome.
 *
 * ── The two bounds, and why they are not the same test ────────────────────
 *
 * DELIVERED is bounded by `startsAt` alone, at both ends. A coach may mark a
 * session before its slot has passed — they finished early, or the slot was
 * mis-scheduled — and `deliveredBetween` in src/lib/trainerSessions.ts already
 * allows exactly that. Refusing to count it would tell a coach who has just
 * marked a session that it did not happen.
 *
 * UNMARKED additionally requires the hour to be OVER, and that is the whole
 * difference. Every future booking is unmarked, by construction, and counting
 * next Tuesday as "waiting on an outcome" would put a permanent unclearable
 * badge on a working coach's dashboard. `hasEnded` uses the END of the session,
 * not its start, so the hour somebody is standing in is not history either.
 *
 * A row that was never booked and carries no outcome is not a session at all —
 * an `available` slot that has gone by is an hour nobody took, and treating it
 * as one is the same inference part 33 exists to end. `wasBooked` is the test.
 */
function sessionMonth(rows, status, from, to) {
    if (!(0, loadStatus_1.isWhole)(status))
        return exports.UNKNOWN_MONTH;
    const m = {
        delivered: 0, unmarked: 0, missed: 0, cancelled: 0, lateCancelled: 0, disputed: 0,
    };
    for (const r of rows) {
        if (!(0, sessionHistory_1.wasBooked)(r))
            continue;
        const at = Date.parse(r.startsAt);
        if (!Number.isFinite(at) || at < from || at > to)
            continue;
        const v = (0, sessionHistory_1.pastVerdict)(r);
        if (v.state === 'unmarked' && !(0, sessionHistory_1.hasEnded)(r, to))
            continue;
        if (v.disputed)
            m.disputed = (m.disputed ?? 0) + 1;
        switch (v.state) {
            case 'delivered':
                m.delivered = (m.delivered ?? 0) + 1;
                break;
            case 'missed':
                m.missed = (m.missed ?? 0) + 1;
                break;
            case 'cancelled':
                m.cancelled = (m.cancelled ?? 0) + 1;
                break;
            case 'late_cancelled':
                m.lateCancelled = (m.lateCancelled ?? 0) + 1;
                break;
            case 'unmarked':
                m.unmarked = (m.unmarked ?? 0) + 1;
                break;
        }
    }
    return m;
}
/**
 * The same count, narrowed to a set of clients.
 *
 * Used for the at-risk figure, which is the money a coach is about to lose
 * rather than the money they made. It takes the ids as a set so the caller's
 * roster filter is the roster filter — this module has no opinion about who is
 * at risk, only about what those people's sessions came to.
 *
 * A session with no `clientId` is out. An unattributed hour is not evidence
 * about any particular person leaving.
 */
function sessionMonthFor(rows, clientIds, status, from, to) {
    return sessionMonth(rows.filter((r) => r.clientId != null && clientIds.has(r.clientId)), status, from, to);
}
/* ── what that is worth ───────────────────────────────────────────────────── */
/**
 * Delivered sessions at the coach's own rate, or null.
 *
 * Null — never 0 — when either half is unknown. A rate of 0 is a rate somebody
 * could charge, so it cannot also mean "no rate set", and a count that was
 * never established cannot be multiplied by anything. This is deliberately the
 * coach's own arithmetic about work they did and NOT a payout: Repple processes
 * none of it, which is what the note on the screen says.
 */
function deliveredValue(m, sessionFee) {
    if (m.delivered == null || sessionFee == null || !Number.isFinite(sessionFee))
        return null;
    return m.delivered * sessionFee;
}
/**
 * What the unmarked sessions WOULD be worth if every one of them turned out to
 * have been delivered.
 *
 * Priced apart from the delivered figure and never added to it. This is the
 * size of what the coach has not recorded — the reason to go and record it —
 * and stating it is the opposite of counting it: the old figure swept exactly
 * this money into the total silently.
 */
function unmarkedValue(m, sessionFee) {
    if (m.unmarked == null || sessionFee == null || !Number.isFinite(sessionFee))
        return null;
    return m.unmarked * sessionFee;
}
/**
 * The sentence about the unmarked ones, or null when there is nothing to say.
 *
 * Null both when there are none and when the count is unknown — a screen must
 * not tell a coach "0 sessions need an outcome" off a failed read, which is an
 * all-clear made out of our own failure.
 *
 * Borrows gymSessions' own wording for the state rather than inventing a
 * second, so the marking queue, the payroll blocker and this line are visibly
 * about one thing.
 */
function unmarkedLine(m) {
    if (m.unmarked == null || m.unmarked === 0)
        return null;
    return m.unmarked === 1
        ? 'One session this month still needs an outcome recorded, so it is counted neither as delivered nor as missed.'
        : `${m.unmarked} sessions this month still need an outcome recorded, so they are counted neither as delivered nor as missed.`;
}
/** Said under the delivered figure, because the change is worth stating once:
 *  it used to be the clock and it is now the record. */
exports.DELIVERED_IS_MARKED = 'Counted from the outcomes you marked, not from the clock. A booking whose time has passed is not a session that happened.';
/**
 * How a session count reads when it could not be established.
 *
 * The three reasons are not interchangeable and only one of them is "you had a
 * quiet month". None of them is zero.
 */
function sessionsUnknownLine(status) {
    if (status === 'loading')
        return 'Still reading your sessions.';
    if (status === 'partial')
        return 'Your sessions came back short, so they cannot be counted. A subtotal printed here would be read as a month.';
    return 'Your sessions could not be read, so this is not a count of zero.';
}
/**
 * A coach's income, as strands `ledger()` can add up or refuse to.
 *
 * Lifted out of app/(trainer)/money.tsx rather than copied: two screens now
 * state a coach's takings and a second composition would be a second money
 * rule, which is the thing this codebase keeps finding it has. The labels are
 * the Money screen's own words, unchanged, because `Ledger.reason` builds a
 * sentence around them and a coach reads that sentence on both screens.
 *
 * The cash strand is not optional and is not a footnote. `coach_receipts` is
 * the half of the book Stripe never saw, and for most self-employed coaches it
 * is the LARGER half — src/lib/clientValue.ts makes the argument at length.
 * `ledger()` withholds the whole total the moment any one strand is short,
 * which is exactly right: takings with the cash half missing is not a smaller
 * number, it is a different number about a different business.
 */
function takingsStrands(reads, rows) {
    return [
        { key: 'sales', label: 'one-off sales', status: reads.sales, taken: (0, coachMoney_1.sumTaken)(rows.sale) },
        { key: 'renewals', label: 'subscription renewals', status: reads.renewals, taken: (0, coachMoney_1.sumTaken)(rows.renewal) },
        { key: 'receipts', label: 'payments you recorded yourself', status: reads.receipts, taken: (0, coachMoney_1.sumTaken)(rows.receipt) },
    ];
}
/** Said beside the takings figure. Gross, and never a balance — the fee, the
 *  platform's cut and whether the money has landed all live at Stripe and no
 *  webhook in this repo writes them here. */
exports.TAKINGS_IS_GROSS = 'What clients were charged, gross, across packages, subscription renewals and the payments you recorded yourself. Stripe fees and payouts are not subtracted, because this app is never told them.';
/** Said on the sessions figure wherever the takings figure is the headline —
 *  the two are never added, and a coach should be told that rather than left
 *  to wonder why. */
exports.TWO_FIGURES_NEVER_SUM = 'Kept apart from your takings above and never added to it. A package your client paid for and the sessions you delivered out of it are the same money counted twice.';
