"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECEIPT_IS_NOT_A_DOCUMENT = exports.RECEIPT_MAY_DOUBLE_COUNT = exports.RECEIPT_IS_NOT_PAY = exports.RECEIPT_IS_YOUR_WORD = exports.RECEIPT_METHODS = void 0;
exports.methodLabel = methodLabel;
exports.receiptBlockers = receiptBlockers;
exports.receiptsTaken = receiptsTaken;
exports.receiptTakenRows = receiptTakenRows;
exports.receiptsEmptyLine = receiptsEmptyLine;
// One money formatter for the whole app. It refuses to print an amount whose
// currency it was not told, and it knows which currencies have no minor unit.
const coachMoney_1 = require("./coachMoney");
// The typed-amount reader the invoice sheet already uses, rather than a second
// one. A coach typing "45,50" into two different money fields in this app must
// not get two different amounts out, and getting the zero-decimal rule wrong
// charges somebody a hundred times too much.
const coachInvoice_1 = require("./coachInvoice");
// A date-only column read as the day it says rather than as UTC midnight. See
// `receiptTakenRows` below for what going without it costs a coach in the
// Americas on the first of every month.
const localDate_1 = require("./localDate");
exports.RECEIPT_METHODS = [
    { id: 'cash', label: 'Cash', note: 'Handed to you' },
    { id: 'transfer', label: 'Bank Transfer', note: 'Straight into your account' },
    { id: 'card_at_gym', label: 'Card Elsewhere', note: 'A terminal or a front desk, not through this app' },
    { id: 'other', label: 'Something Else', note: 'Anything the three above do not cover' },
];
/** The method's label, or the stored id where a newer build wrote one this one
 *  does not know. Never a blank and never "unknown": a receipt whose method
 *  cannot be named is still a real payment and the amount beside it still
 *  stands. */
function methodLabel(id) {
    const found = exports.RECEIPT_METHODS.find((m) => m.id === id);
    return found ? found.label : String(id ?? '').trim() || 'Not stated';
}
/**
 * Every reason this receipt cannot be recorded, in the coach's own words.
 *
 * A list rather than the first failure, the same discipline `invoiceBlockers`
 * keeps: somebody who has left three fields empty should be told all three at
 * once rather than made to press the button three times. An empty list means it
 * can go.
 */
function receiptBlockers(d) {
    const out = [];
    if (!String(d.paidBy ?? '').trim()) {
        out.push('Say who paid you. This is your own record of a payment, so it needs a name on it to be worth anything later.');
    }
    // THE guard that keeps this feature on the right side of the line in the
    // header. A coach is not their own client and cannot pay themselves; a row
    // that said so would be the coach authoring a figure about what they are owed
    // rather than recording money a client has already handed them, which is the
    // one thing this app refuses to let a coach do anywhere.
    const me = String(d.coachId ?? '').trim();
    if (me && String(d.clientId ?? '').trim() === me) {
        out.push('You cannot record a payment from yourself. This is for money a client has paid you, not for your own pay — nothing in this app lets you write down what you are owed by anybody.');
    }
    // Currency before amount, because without one the amount cannot be
    // interpreted at all and "your gym has not set a currency" is a different
    // problem with a different fix.
    const cur = (d.currency || '').trim();
    if (!cur) {
        out.push('No currency has been set, so there is nothing to record this in. Repple is white-labelled and there is no default that is right for every gym — an owner sets it in the gym settings, or you set one on a package.');
    }
    else if (!/^[A-Za-z]{3}$/.test(cur)) {
        out.push('The currency on record is not a three-letter code, so no amount can be recorded in it.');
    }
    else {
        // The reader's own reason, not a sentence written here. A coach in Kuwait
        // typing 12.345 is told that the last place must be a nought, and a coach
        // in Japan typing 500.50 is told a yen has no smaller unit — where a single
        // generic line would have sent both of them back to the same box with no
        // idea what was wrong with what they had typed.
        const read = (0, coachInvoice_1.draftAmount)(d.amountText, cur);
        if (!read.ok)
            out.push(read.reason);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.receivedOn ?? ''))) {
        out.push('The day you were paid could not be read.');
    }
    if (!exports.RECEIPT_METHODS.some((m) => m.id === d.method)) {
        out.push('Say how the money reached you.');
    }
    return out;
}
/* ── what they add up to ──────────────────────────────────────────────────── */
/**
 * Receipts as a `Taken`, so the Money screen adds them the same way it adds
 * everything else.
 *
 * Through `sumTaken` rather than a private loop, for its two rules: currencies
 * never merge, and an amount with no unit is counted rather than dropped. A
 * coach who takes cash from a visitor in sterling must not be shown one figure
 * covering both that and their dirham book.
 *
 * The date passed as `created_at` is `receivedOn` — the day the coach says the
 * money arrived, never the day the row was written. A coach catching up on
 * three weeks of cash on a Sunday evening must not have all of it land in that
 * Sunday's month, and `since()` and `splitByPeriod()` both read this field.
 */
function receiptsTaken(rows) {
    return (0, coachMoney_1.sumTaken)(receiptTakenRows(rows));
}
/**
 * Receipts as summable rows, dated at LOCAL midnight on the day the coach says
 * they were paid.
 *
 * ── Why this is a function and not three lines at each call site ──────────
 *
 * `receivedOn` is a Postgres `date` and arrives as a bare `YYYY-MM-DD`. It
 * means a calendar day. Everything downstream that WINDOWS these rows —
 * `since()` in coachMoney.ts, `splitByPeriod()` in coachStatement.ts — reads
 * `created_at` with `Date.parse`, and `Date.parse('2026-09-01')` is UTC
 * midnight while every month bound in this app (`monthStart`, `monthToDate`,
 * `periodRange`) is LOCAL midnight. West of Greenwich the first is EARLIER than
 * the second, so `t >= fromMs` is false and every cash payment a coach recorded
 * as received on the FIRST of the month falls out of the month that names it.
 *
 * It does not fall out loudly. `sumTaken` never sees the row, so it is in no
 * `unlabelled` and no `unpriced` count either — the figure is simply short, and
 * the status beside it still says 'ready'. Invisible in the UTC+4 gym this was
 * written for; present every month for every coach in the Americas.
 *
 * app/(trainer)/money.tsx found this and fixed it in its own memo. Then
 * app/(trainer)/analytics.tsx composed the same three strands through the same
 * `since()` and did not — which is what a rule written at a call site looks
 * like just before it becomes two rules. It lives here now, once, and
 * `receiptsTaken` above goes through it so the all-time figure and the monthly
 * one cannot disagree about which day a payment was on.
 *
 * A day that will not read passes a value that will not parse, which keeps the
 * payment out of every period rather than sweeping it into this one.
 */
function receiptTakenRows(rows) {
    return rows.map((r) => ({
        amount_cents: r.amountCents,
        currency: r.currency,
        created_at: (0, localDate_1.localDate)(r.receivedOn)?.toISOString() ?? 'unknown',
    }));
}
/* ── the sentences that keep the screen honest ────────────────────────────── */
/**
 * What a receipt is. Said on the screen, not only here.
 *
 * The coach's own word, in exactly the voice `kindLine` uses on an invoice.
 * This app was not there, was not told by a bank, and has not reconciled
 * anything.
 */
exports.RECEIPT_IS_YOUR_WORD = 'These are payments you have told this app about. Nothing here has been checked against a bank, a card processor or anybody else, and this app was not involved in any of them. They are your own record of money you say you were handed.';
/**
 * That a receipt is not a payroll claim.
 *
 * On the screen because the word "earnings" means two opposite things in this
 * product, and a coach who has seen the read-only earnings screen on the gym
 * side will reasonably wonder why this one lets them type. The answer is the
 * direction the money moved, and it is worth one sentence.
 */
exports.RECEIPT_IS_NOT_PAY = 'This is for money a client has already paid you. It is not a record of pay you are owed by a gym and nothing here is read by anybody who pays you — where a gym employs you, what they owe you is theirs to state and you cannot write it down yourself.';
/**
 * That a receipt and a Stripe sale can be the same money.
 *
 * The most likely way this feature produces a wrong figure: a coach records the
 * cash deposit for a pack whose balance Stripe also took, and the Money screen
 * counts it twice. Nothing can detect that — the two rows share no key and this
 * app is told nothing about either payment — so the screen says it rather than
 * pretending to.
 */
exports.RECEIPT_MAY_DOUBLE_COUNT = 'Record only what did NOT go through this app. A payment Stripe took is already counted under sales and renewals, and a receipt written for the same money would count it twice — nothing can tell that the two are the same payment, because they share nothing this app can read.';
/**
 * That the client has not been told.
 *
 * A receipt is the coach's own ledger line and there is no client screen for
 * it, deliberately: the artefact for telling somebody you have their money is
 * an INVOICE marked received, which is numbered, printable and already built.
 * A coach who wants the client to have a record is pointed at that.
 */
exports.RECEIPT_IS_NOT_A_DOCUMENT = 'Nobody but you can see these and nobody is notified about one. If the person who paid you needs something for it, issue an invoice marked as received — that is a numbered document you can send them, and it says on its own face what it is.';
/**
 * The sentence under an empty list, which depends entirely on the read.
 *
 * A confident "you have recorded nothing" over a failed read is the same defect
 * this codebase exists to prevent, on the one screen where the whole point is
 * that a figure was too small.
 */
function receiptsEmptyLine(status) {
    if (status === 'error') {
        return 'Your recorded payments could not be read, so nothing is listed. That is not a statement that you have recorded none, and anything already recorded still stands.';
    }
    if (status === 'partial') {
        return 'There are more recorded payments than could be read in one request, so nothing here is a total.';
    }
    if (status === 'loading')
        return 'Still reading.';
    return 'You have not recorded any payments taken outside this app. Cash, bank transfers and anything taken at a gym’s front desk never reach Repple on their own, so until you record them the figures above are a floor rather than what you earn.';
}
