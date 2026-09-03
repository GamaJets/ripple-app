"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsCounted = exports.VALUE_MAY_DOUBLE_COUNT = exports.VALUE_NEEDS_YOUR_RECORDS = exports.VALUE_IS_PAST = exports.paidOnly = void 0;
exports.clientValue = clientValue;
exports.rankByValue = rankByValue;
exports.currenciesIn = currenciesIn;
exports.unattributedReceipts = unattributedReceipts;
exports.unattributedLine = unattributedLine;
exports.paymentsFloorLine = paymentsFloorLine;
exports.valueEmptyLine = valueEmptyLine;
exports.valueSpanLine = valueSpanLine;
exports.valueStatus = valueStatus;
const loadStatus_1 = require("../ui/loadStatus");
const coachMoney_1 = require("./coachMoney");
const coachLedger_1 = require("./coachLedger");
const format_1 = require("./format");
/**
 * Only the sales that are money.
 *
 * `client_purchases.status` carries Stripe's own word, and a row that is
 * 'pending', 'failed' or 'refunded' is not a payment. The old instinct here is
 * `status !== 'refunded'`, which is a denylist and is wrong the first time
 * Stripe adds a status — the new one would count as income by default. Only
 * 'paid' counts.
 *
 * A null status is NOT counted. Every row the webhook writes carries one, so a
 * null is a row from somewhere else or a row that never completed, and a
 * payment nobody can confirm should not appear in what somebody is worth.
 */
const paidOnly = (rows) => rows.filter((r) => (r.status || '').trim().toLowerCase() === 'paid');
exports.paidOnly = paidOnly;
/** A payment reduced to what a total depends on. `at` is the date the money
 *  moved and never the date the row was written — a webhook retried three days
 *  late, or a coach writing up three weeks of cash on a Sunday, must not shift
 *  when somebody paid. */
const row = (amount_cents, currency, at) => ({ amount_cents, currency, created_at: at });
/**
 * Everything one client has paid, from all three sources.
 *
 * The three statuses are passed separately because they are three separate
 * reads that fail independently, and the whole job of `ledger()` is to refuse a
 * total when any one of them did. Callers that genuinely have no receipts read
 * must pass 'error' rather than 'ready' with an empty array — an absent read is
 * not an empty one, and this is the figure where that difference decides
 * whether a coach undervalues somebody by two thirds.
 */
function clientValue(clientId, purchases, renewals, receipts, status) {
    const mySales = (0, exports.paidOnly)(purchases).filter((p) => p.client_id === clientId);
    const myRenewals = renewals.filter((r) => r.client_id === clientId);
    const myReceipts = receipts.filter((r) => r.clientId === clientId);
    const saleRows = mySales.map((p) => row(p.amount_cents, p.currency, p.created_at));
    // `paid_at` is Stripe's word on when the money moved; `created_at` is when
    // the webhook wrote the row. The fallback is deliberate and is the lesser
    // wrong: without it a renewal Stripe stated no date for would have no date at
    // all, and this figure's `firstAt`/`lastAt` would silently skip it.
    const renewalRows = myRenewals.map((r) => row(r.amount_cents, r.currency, r.paid_at || r.created_at));
    const receiptRows = myReceipts.map((r) => row(r.amountCents, r.currency, r.receivedOn));
    const sales = (0, coachMoney_1.sumTaken)(saleRows);
    const renewalsTaken = (0, coachMoney_1.sumTaken)(renewalRows);
    const recorded = (0, coachMoney_1.sumTaken)(receiptRows);
    const strands = [
        { key: 'sales', label: 'one-off sales', status: status.purchases, taken: sales },
        { key: 'renewals', label: 'renewals', status: status.renewals, taken: renewalsTaken },
        // Named for what a coach calls it rather than for the table. "Receipts" is
        // this app's word; "cash and transfers" is theirs, and the reason sentence
        // this label lands in is one they have to act on.
        { key: 'recorded', label: 'cash and transfers', status: status.receipts, taken: recorded },
    ];
    const times = [...saleRows, ...renewalRows, ...receiptRows]
        .map((r) => Date.parse(r.created_at))
        .filter((n) => Number.isFinite(n));
    return {
        clientId,
        sales,
        renewals: renewalsTaken,
        recorded,
        ledger: (0, coachLedger_1.ledger)(strands),
        payments: saleRows.length + renewalRows.length + receiptRows.length,
        firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
        lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    };
}
/**
 * Every client who has ever paid, biggest first.
 *
 * ── Why the ranking is per currency and not one list ──────────────────────
 *
 * Sorting a mixed-currency book by "amount" would put AED 5,000 above GBP 900
 * because five thousand is more than nine hundred, and the order would be a
 * fact about exchange rates nobody supplied. So the ranking is over ONE
 * currency at a time — `currency` says which — and a coach with two currencies
 * gets two lists rather than one wrong one.
 *
 * Clients whose figure is in a different currency are still returned, at the
 * bottom, with a zero pot for this currency. They are NOT dropped: a client
 * missing from a list headed "what your clients have paid you" reads as a
 * client who has paid nothing.
 */
function rankByValue(rows, currency) {
    const cur = currency.trim().toUpperCase();
    const potOf = (r) => r.value.ledger.total?.pots.find((p) => p.currency === cur)?.minorUnits ?? -1;
    return [...rows].sort((a, b) => {
        const pa = potOf(a);
        const pb = potOf(b);
        if (pa !== pb)
            return pb - pa;
        return (a.name || '').localeCompare(b.name || '');
    });
}
/**
 * Which currencies this book has been paid in at all.
 *
 * Returned so a screen can say "you have been paid in two currencies and they
 * are not added together" rather than silently picking the first. Sorted by
 * total so the coach's main one leads.
 */
function currenciesIn(rows) {
    const by = new Map();
    for (const r of rows) {
        const t = r.value.ledger.total;
        if (!t)
            continue;
        for (const p of t.pots)
            by.set(p.currency, (by.get(p.currency) ?? 0) + p.minorUnits);
    }
    return [...by.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([c]) => c);
}
/* ── receipts nobody can attribute ────────────────────────────────────────── */
/**
 * Recorded payments with no client account behind them.
 *
 * `coach_receipts.client_id` is nullable on purpose — most cash comes from
 * somebody the coach bills by hand, with a name they typed and no Repple
 * account. Those payments are real income and cannot be attributed to any row
 * in this list, so they are COUNTED and reported rather than dropped. A screen
 * that showed only the attributable ones would be a per-client breakdown that
 * silently omits most of the cash, which is the same defect this whole module
 * exists to close, one level down.
 */
function unattributedReceipts(receipts) {
    const orphan = receipts.filter((r) => !r.clientId);
    return {
        count: orphan.length,
        taken: (0, coachMoney_1.sumTaken)(orphan.map((r) => row(r.amountCents, r.currency, r.receivedOn))),
    };
}
/** The sentence for them. Null when there are none — a "0 unattributed" line
 *  under every screen is furniture, and the line that matters would be lost in
 *  it. */
function unattributedLine(count) {
    if (count <= 0)
        return null;
    return `${(0, format_1.num)(count)} recorded ${count === 1 ? 'payment is' : 'payments are'} not attached to anybody's account — cash from somebody you bill by hand has a name you typed and no Repple client behind it. ${count === 1 ? 'It is' : 'They are'} real income and ${count === 1 ? 'it is' : 'they are'} not in any of the per-client figures here.`;
}
/* ── what the figure is, said on the screen ───────────────────────────────── */
/**
 * That this is the past and not a forecast.
 *
 * "Lifetime value" means a projection almost everywhere else it is written, and
 * a coach who reads this as one will make a decision about a client on the
 * strength of a number this app has not calculated and could not.
 */
exports.VALUE_IS_PAST = 'This is money already paid, added up. It is not a forecast of what somebody will be worth, and nothing here has been projected forward — a client who paid you every month for a year and stopped in March shows the year and says nothing about April.';
/**
 * That the cash half depends on the coach having written it down.
 *
 * The figure is only as complete as the coach's own record-keeping, and that is
 * a fact about them rather than about the app — so it is said plainly, next to
 * the way to fix it.
 */
exports.VALUE_NEEDS_YOUR_RECORDS = 'Cash, bank transfers and anything taken on a terminal only count here once you have recorded them. Until you do, every figure on this screen is a floor rather than what somebody has actually paid you.';
/**
 * That two rows can be one payment.
 *
 * Points at the receipts screen's own sentence rather than restating it, so
 * there is one wording of this warning in the app.
 */
exports.VALUE_MAY_DOUBLE_COUNT = 'A payment recorded by hand that Stripe also took is counted twice here. The two rows share nothing this app can read, so nothing can spot it — record only what did not go through Repple.';
/**
 * The number of payments, ONLY when every read behind it was whole.
 *
 * `payments` on the value is a count of the rows that arrived, and it is
 * counted deliberately even where the total is withheld — "we could not total
 * 14 payments" is a better sentence than "we could not total your payments".
 * That is right for a SENTENCE and wrong for a figure in a KPI row, which is
 * where app/(trainer)/client.tsx was printing it: "Payments 4" sat inches from
 * "Worth —", so the dash read as "we cannot price these four" rather than "we
 * do not know there were four". A coach deciding whether to chase somebody for
 * money read four payments as a fact about a paying client, when it was four
 * rows out of an unknown number.
 *
 * Null is the dash. The count survives, in `paymentsFloorLine` below, where it
 * is stated as the floor it is.
 */
const paymentsCounted = (v) => (v.ledger.status === 'ready' ? v.payments : null);
exports.paymentsCounted = paymentsCounted;
/**
 * The count as a floor, for the sentence under a withheld total.
 *
 * Null when the ledger is whole — the KPI has already said it — and null when
 * nothing arrived at all, because "at least 0 payments" is not a sentence.
 */
function paymentsFloorLine(v) {
    if (v.ledger.status === 'ready' || v.payments === 0)
        return null;
    return v.payments === 1
        ? 'At least 1 payment is on record. One of the reads behind this did not come back whole, so that is a floor and not a count.'
        : `At least ${(0, format_1.num)(v.payments)} payments are on record. One of the reads behind this did not come back whole, so that is a floor and not a count.`;
}
/**
 * What to say where a client's total would have gone.
 *
 * Never "they have paid you nothing" over a read that did not complete. On this
 * screen that sentence is not merely wrong, it is the sentence that decides how
 * hard a coach fights to keep somebody.
 */
function valueEmptyLine(v) {
    if (v.ledger.status === 'ready' && v.payments === 0) {
        return 'Nothing has been recorded as paid to you by this person. If they pay you in cash or by transfer, record it and it will show here.';
    }
    return v.ledger.reason
        ?? 'Nothing is stated, and that is not a statement that they have paid you nothing.';
}
/** How long they have been paying, in the coach's words. Null when there is no
 *  first payment to date it from. */
function valueSpanLine(v, now) {
    if (!v.firstAt)
        return null;
    const first = Date.parse(v.firstAt);
    if (!Number.isFinite(first))
        return null;
    const months = Math.max(0, Math.floor((now.getTime() - first) / (30.436875 * 86400000)));
    const what = `${(0, format_1.num)(v.payments)} ${v.payments === 1 ? 'payment' : 'payments'}`;
    if (months < 1)
        return `${what}, the first of them this month.`;
    if (months < 12)
        return `${what} across ${(0, format_1.num)(months)} ${months === 1 ? 'month' : 'months'}.`;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const span = rest === 0
        ? `${(0, format_1.num)(years)} ${years === 1 ? 'year' : 'years'}`
        : `${(0, format_1.num)(years)} ${years === 1 ? 'year' : 'years'} and ${(0, format_1.num)(rest)} ${rest === 1 ? 'month' : 'months'}`;
    return `${what} across ${span}.`;
}
/**
 * The worst of the three reads, for a screen that wants one status.
 *
 * Exported rather than left to each caller's `worstStatus(a, b, c)` because the
 * SET is the thing that must not change: a caller that composed two of the
 * three would produce a status that says the figure is trustworthy while the
 * cash half is unread, which is precisely the failure this module is about.
 */
function valueStatus(s) {
    return (0, loadStatus_1.worstStatus)(s.purchases, s.renewals, s.receipts);
}
