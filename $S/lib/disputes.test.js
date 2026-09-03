"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A chargeback, and every way the one thing that matters about it could be
// lost.
//
// Compile with tsc, then run under plain node.
//
// The one thing is the DEADLINE. Stripe stops accepting evidence on a fixed
// day, decides on whatever arrived, and nothing is the commonest submission —
// so each assertion below is aimed at a specific way a coach could end up not
// acting in time:
//
//   · a missing deadline rendered as a dash or as today, rather than as its own
//     sentence pointing at the Stripe dashboard;
//   · a status this build has never heard of read as closed, which would hide a
//     live case;
//   · a deadline nineteen hours away rounded down to "0 days", which reads as
//     already lost;
//   · a deadline that has passed clamped to zero, which reads as still winnable;
//   · a dispute with no dispute id written anyway, which would make every
//     redelivery a second row and a second notification;
//   · Stripe's unix SECONDS read as milliseconds, which puts an evidence
//     deadline in January 1970.
//
// Every instant here is an explicit epoch number or an explicit ISO string —
// `npm test` runs under six timezones.
const disputes_1 = require("./disputes");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const inDays = (n) => new Date(NOW + n * 86400000).toISOString();
/* ── 1. open and closed, and the word nobody has seen before ──────────────── */
ok((0, disputes_1.isClosed)('won'), 'won is over');
ok((0, disputes_1.isClosed)('lost'), 'lost is over');
ok((0, disputes_1.isClosed)('warning_closed'), 'and so is a closed early warning');
ok(!(0, disputes_1.isClosed)('needs_response'), 'a case waiting on the coach is not over');
ok(!(0, disputes_1.isClosed)('under_review'), 'and neither is one waiting on the bank');
// THE assertion about Stripe adding vocabulary. A word this build does not know
// must fall on the LIVE side: a case wrongly shown as closed is a case nobody
// answers, and Stripe's status list grows.
ok(!(0, disputes_1.isClosed)('some_status_from_2028'), 'a status this build has never seen is live, never assumed closed');
ok(!(0, disputes_1.needsResponse)('some_status_from_2028'), 'and it is not claimed to need a response either — we do not know that');
// `closedAt` is Stripe's own answer where there is one, for a row written
// before the close arrived.
ok((0, disputes_1.isClosed)('needs_response', '2026-09-01T09:00:00.000Z'), 'a closed_at closes it whatever the status says');
ok((0, disputes_1.needsResponse)('needs_response'), 'needs_response needs a response');
ok((0, disputes_1.needsResponse)('warning_needs_response'), 'and so does the early warning');
// Evidence is in and Stripe is waiting on the bank. Telling a coach to act
// would have them submit a second time.
ok(!(0, disputes_1.needsResponse)('under_review'), 'a case with the bank is one to watch, not one to act on');
/* ── 2. the words on the screen ───────────────────────────────────────────── */
eq((0, disputes_1.disputeStatusLabel)('lost'), 'Decided against you', 'a lost case says so plainly');
// Rendered AS ITSELF rather than as "Other": the coach is about to read the
// same word in their Stripe dashboard, and "Other" tells them less than the
// word does.
eq((0, disputes_1.disputeStatusLabel)('some_status_from_2028'), 'some_status_from_2028', 'an unknown status is shown as itself, never as "Other"');
eq((0, disputes_1.disputeStatusLabel)(''), 'Unknown', 'and an empty one says it is unknown rather than rendering nothing');
eq((0, disputes_1.disputeReasonLabel)(null), null, 'no reason is no line, not an empty one');
ok(((0, disputes_1.disputeReasonLabel)('product_not_received') ?? '').length > 5, 'a known reason reads as a sentence');
eq((0, disputes_1.disputeReasonLabel)('some_reason_from_2028'), 'some reason from 2028', 'and an unknown one is shown as itself');
/* ── 3. the days, which is where being wrong costs the money ──────────────── */
eq((0, disputes_1.daysToRespond)({ evidenceDueBy: null, status: 'needs_response' }, NOW), null, 'no deadline is not a deadline of zero days');
eq((0, disputes_1.daysToRespond)({ evidenceDueBy: 'nonsense', status: 'needs_response' }, NOW), null, 'and neither is one that will not parse');
eq((0, disputes_1.daysToRespond)({ evidenceDueBy: inDays(7), status: 'won', closedAt: inDays(-1) }, NOW), null, 'a closed case has no days left to count');
eq((0, disputes_1.daysToRespond)({ evidenceDueBy: inDays(7), status: 'needs_response' }, NOW), 7, 'seven days is seven');
// ROUNDED UP. Nineteen hours is "1 day", not "0". A coach told "0 days" on a
// case with most of a day left may conclude it is already lost and do nothing,
// which is exactly the outcome the whole feature exists to prevent.
eq((0, disputes_1.daysToRespond)({ evidenceDueBy: new Date(NOW + 19 * 3600000).toISOString(), status: 'needs_response' }, NOW), 1, 'nineteen hours left is a day left, not none');
// NOT clamped. "The date was four days ago" and "the date is today" are
// different things to tell somebody and only one of them is worth hurrying for.
eq((0, disputes_1.daysToRespond)({ evidenceDueBy: inDays(-4), status: 'needs_response' }, NOW), -4, 'a deadline that has passed reads as past, never clamped to zero');
/* ── 4. the sentence, including the one for a deadline we do not have ─────── */
eq((0, disputes_1.deadlineLine)({ evidenceDueBy: inDays(3), status: 'won', closedAt: inDays(-1) }, '04 Sep 2026', NOW), null, 'a closed case has no deadline line at all');
// THE assertion about the null. Stripe states no due date on an inquiry and
// none on a case it has already decided; printing today's date there would send
// a coach running at nothing, and a dash would make the row look broken.
const noDate = (0, disputes_1.deadlineLine)({ evidenceDueBy: null, status: 'needs_response' }, null, NOW) ?? '';
ok(noDate.length > 20, 'a missing deadline gets a sentence rather than a dash');
ok(/Stripe dashboard/i.test(noDate), 'and the sentence says where the date actually is');
const week = (0, disputes_1.deadlineLine)({ evidenceDueBy: inDays(7), status: 'needs_response' }, '08 Sep 2026', NOW) ?? '';
ok(week.includes('08 Sep 2026'), 'a deadline line carries the date it was given');
ok(week.includes('7'), 'and how long that is from now');
// An hour left is not "tomorrow", and it is not "1 day from now" either.
// `daysToRespond` rounds up by contract — nineteen hours must read as a day
// left, never as none — so the line reaches for the raw gap for the two nearest
// cases rather than inheriting a rounding that cannot tell an hour from a day.
const today = (0, disputes_1.deadlineLine)({ evidenceDueBy: new Date(NOW + 3600000).toISOString(), status: 'needs_response' }, '01 Sep 2026', NOW) ?? '';
ok(/within the DAY/.test(today), 'an hour left says so in a word a person cannot scroll past');
ok(!/TOMORROW/.test(today), 'and never says tomorrow about a deadline ninety minutes away');
const tomorrow = (0, disputes_1.deadlineLine)({ evidenceDueBy: new Date(NOW + 30 * 3600000).toISOString(), status: 'needs_response' }, '02 Sep 2026', NOW) ?? '';
ok(/TOMORROW/.test(tomorrow), 'thirty hours out is tomorrow');
const past = (0, disputes_1.deadlineLine)({ evidenceDueBy: inDays(-4), status: 'needs_response' }, '28 Aug 2026', NOW) ?? '';
ok(/ago/.test(past), 'a deadline that has gone says it has gone');
ok(!/TODAY|TOMORROW/.test(past), 'and never reads as though there is still time');
/* ── 5. how loud the row is ───────────────────────────────────────────────── */
eq((0, disputes_1.disputeTone)({ evidenceDueBy: inDays(2), status: 'won', closedAt: inDays(-1) }, NOW), null, 'a decided case is not loud');
eq((0, disputes_1.disputeTone)({ evidenceDueBy: inDays(2), status: 'needs_response' }, NOW), 'urgent', 'two days out is urgent');
eq((0, disputes_1.disputeTone)({ evidenceDueBy: inDays(9), status: 'needs_response' }, NOW), 'warn', 'nine days out is a warning');
eq((0, disputes_1.disputeTone)({ evidenceDueBy: inDays(-2), status: 'needs_response' }, NOW), 'urgent', 'and a deadline already past is still urgent, not quietly downgraded');
// A case whose date this app does not know is not a case to relax about.
eq((0, disputes_1.disputeTone)({ evidenceDueBy: null, status: 'needs_response' }, NOW), 'warn', 'a case with no known deadline is never silent');
eq((0, disputes_1.disputeTone)({ evidenceDueBy: null, status: 'under_review' }, NOW), 'warn', 'and neither is one sitting with the bank');
/* ── 6. the row the webhook writes ────────────────────────────────────────── */
const D = (over = {}) => ({
    id: 'dp_1',
    charge: 'ch_1',
    paymentIntent: 'pi_1',
    amount: 48000,
    currency: 'aed',
    reason: 'fraudulent',
    status: 'needs_response',
    evidenceDueBy: 1789000000,
    created: 1788000000,
    ...over,
});
const WHO = { trainerId: 't1', clientId: 'c1', purchaseId: 'p1', renewalId: null, stripeAccountId: 'acct_1' };
const AT = '2026-09-01T09:00:00.000Z';
// The only refusal there is, and it is the primary key: without it a
// redelivery cannot find the row the first delivery wrote, so Stripe's ordinary
// retries would each write a new case and each fire a new notification.
eq((0, disputes_1.disputeRow)(D({ id: '' }), WHO, AT), null, 'a dispute with no id is not written');
const row = (0, disputes_1.disputeRow)(D(), WHO, AT);
eq(row.stripe_dispute_id, 'dp_1', 'the id is the key');
eq(row.amount_cents, 48000, 'the amount is gross, in minor units, as Stripe stated it');
eq(row.currency, 'aed', 'and its unit is Stripe’s own, unmodified');
eq(row.trainer_id, 't1', 'the coach it is about');
eq(row.purchase_id, 'p1', 'and the sale, where one was found');
eq(row.closed_at, null, 'a live case has no closed_at, which is what the notification trigger fires on');
// Stripe sends SECONDS. A factor of a thousand here puts an evidence deadline
// in January 1970, which is a row every screen would then render as long past.
eq(row.evidence_due_by, new Date(1789000000 * 1000).toISOString(), 'unix seconds become a real instant');
eq(row.opened_at, new Date(1788000000 * 1000).toISOString(), 'and so does the created stamp');
// Everything except the id is legitimately absent. A dispute against a payment
// this app never recorded is still a dispute with a deadline on it, and refusing
// to store it would lose exactly the case a coach has least other warning about.
const orphan = (0, disputes_1.disputeRow)(D({ charge: null, paymentIntent: null, amount: null, currency: null, reason: null, evidenceDueBy: null, created: null }), { trainerId: null, clientId: null, purchaseId: null, renewalId: null, stripeAccountId: null }, AT);
ok(orphan !== null, 'a dispute against a payment this app never recorded is still written down');
eq(orphan.trainer_id, null, 'with no coach');
eq(orphan.amount_cents, null, 'no amount');
eq(orphan.currency, null, 'no currency, and never a default one');
eq(orphan.evidence_due_by, null, 'and no invented deadline');
const closed = (0, disputes_1.disputeRow)(D({ status: 'lost' }), WHO, AT);
eq(closed.closed_at, AT, 'a case Stripe reports as decided is stamped closed');
eq(closed.stripe_event_at, AT, 'from the EVENT’s own time, so a redelivery three days late cannot reopen it');
// A status this build has never seen must not be written as closed — that would
// be a case the coach is told the result of while it is still running.
const future = (0, disputes_1.disputeRow)(D({ status: 'some_status_from_2028' }), WHO, AT);
eq(future.closed_at, null, 'an unknown status stays open');
eq(future.status, 'some_status_from_2028', 'and is stored verbatim rather than mapped to something this build understands');
// A status Stripe somehow omits still produces a row, because the deadline on it
// is real whatever the status says.
eq((0, disputes_1.disputeRow)(D({ status: null }), WHO, AT).status, 'unknown', 'a missing status is recorded as unknown, not as empty');
/* ── 7. the three things a coach would otherwise assume ───────────────────── */
ok(/taken back the moment/i.test(disputes_1.DISPUTE_MONEY_IS_ALREADY_GONE), 'the money is gone before the case is decided, and the screen says so');
ok(/Stripe dashboard/i.test(disputes_1.EVIDENCE_GOES_TO_STRIPE), 'evidence goes to Stripe, not here, and nobody waits for a button that is not coming');
ok(/loses by default|empty response/i.test(disputes_1.WHAT_EVIDENCE_LOOKS_LIKE), 'and sending nothing loses, which is the sentence that gets somebody to send something');
if (errors.length) {
    console.error(`disputes.test.ts — ${errors.length} failure(s):`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('disputes.test.ts — ok');
