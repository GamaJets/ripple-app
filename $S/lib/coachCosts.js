"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COSTS_NOT_TWICE = exports.COSTS_ARE_NOT_TAX_ADVICE = exports.COSTS_ARE_NEVER_NETTED = exports.COST_IS_YOUR_WORD = exports.COST_CATEGORIES = void 0;
exports.categoryLabel = categoryLabel;
exports.costBlockers = costBlockers;
exports.costsTaken = costsTaken;
exports.costsByCategory = costsByCategory;
exports.costsEmptyLine = costsEmptyLine;
// One summing function for the whole app: currencies never merge, and an amount
// with no unit is counted rather than dropped.
const coachMoney_1 = require("./coachMoney");
// The typed-amount reader the invoice sheet and the receipt sheet already use,
// rather than a third one. A coach typing "12.500" into two money fields in
// this app must not get two different amounts out, and it is the reader that
// knows a dinar has a thousand fils in it rather than a hundred.
const coachInvoice_1 = require("./coachInvoice");
/**
 * The categories, in the order they are offered.
 *
 * Rent first because it is the largest line in most coaches' years and the one
 * this feature exists for. `note` is the plain-English gloss under the label,
 * so nobody has to guess whether a first-aid course is 'education' or 'other'.
 */
exports.COST_CATEGORIES = [
    { id: 'rent', label: 'Rent or Chair Fee', note: 'Gym rent, a chair fee, a share of a studio' },
    { id: 'insurance', label: 'Insurance', note: 'Public liability, professional indemnity, equipment cover' },
    { id: 'education', label: 'Courses and CPD', note: 'A qualification, a course, a workshop, a book' },
    { id: 'equipment', label: 'Equipment', note: 'Weights, bands, a bench, anything you train people with' },
    { id: 'kit', label: 'Kit', note: 'Clothing you train in, shoes, a bag' },
    { id: 'travel', label: 'Travel', note: 'Getting to clients — fuel, fares, parking' },
    { id: 'professional', label: 'Professional Fees', note: 'An accountant, a solicitor, a registration body' },
    { id: 'other', label: 'Something Else', note: 'Anything the seven above do not cover' },
];
/** The category's label, or the stored id where a newer build wrote one this
 *  one does not know. Never a blank and never "unknown": a cost whose category
 *  cannot be named is still money that left, and the amount beside it still
 *  stands. */
function categoryLabel(id) {
    const found = exports.COST_CATEGORIES.find((c) => c.id === id);
    return found ? found.label : String(id ?? '').trim() || 'Not stated';
}
/**
 * Every reason this cost cannot be recorded, in the coach's own words.
 *
 * A list rather than the first failure, the same discipline `invoiceBlockers`
 * and `receiptBlockers` keep: somebody who has left three fields empty should
 * be told all three at once rather than made to press the button three times.
 * An empty list means it can go.
 */
function costBlockers(d) {
    const out = [];
    if (!String(d.description ?? '').trim()) {
        out.push('Say what this was for. An amount with nothing beside it is a line you will not be able to place in eleven months, which is when you will be looking at it.');
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
        // The reader's own reason rather than a sentence written here, so a coach
        // in Kuwait is told that the last place must be a nought and a coach in
        // Japan is told a yen has no smaller unit.
        const read = (0, coachInvoice_1.draftAmount)(d.amountText, cur);
        if (!read.ok)
            out.push(read.reason);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.paidOn ?? ''))) {
        out.push('The day you paid it could not be read.');
    }
    if (!exports.COST_CATEGORIES.some((c) => c.id === d.category)) {
        out.push('Say what kind of cost this was.');
    }
    return out;
}
/* ── what they add up to ──────────────────────────────────────────────────── */
/**
 * Costs as a `Taken`, so the Money screen adds them the same way it adds
 * everything else.
 *
 * The type name is about the SHAPE, not the direction — one pot per currency,
 * unlabelled and unpriced rows counted rather than dropped — and reusing it is
 * what stops the outgoing side growing a second opinion about how to add money
 * up. It does NOT mean these are takings, and nothing that consumes this may
 * put it in the same total as one.
 *
 * The date passed as `created_at` is `paidOn` — the day the coach says the
 * money went out, never the day the row was written. A quarter of receipts
 * written up in one evening must not all land in that evening's month, and
 * `since()` and `splitByPeriod()` both read this field.
 */
function costsTaken(rows) {
    return (0, coachMoney_1.sumTaken)(rows.map((c) => ({
        amount_cents: c.amountCents,
        currency: c.currency,
        created_at: c.paidOn,
    })));
}
function costsByCategory(rows) {
    const by = new Map();
    for (const c of rows) {
        const key = String(c.category ?? '').trim() || 'other';
        const list = by.get(key);
        if (list)
            list.push(c);
        else
            by.set(key, [c]);
    }
    const out = [];
    for (const [category, list] of by) {
        out.push({ category, label: categoryLabel(category), taken: costsTaken(list) });
    }
    // By the biggest single pot in each category, then by label so the order is
    // stable when two categories have nothing comparable in them. Sorting on a
    // sum ACROSS currencies would be the addition this file exists to refuse, so
    // it is the largest pot that decides and not a total.
    const top = (p) => p.taken.pots.reduce((m, x) => Math.max(m, x.minorUnits), 0);
    return out.sort((a, b) => (top(b) - top(a)) || a.label.localeCompare(b.label));
}
/* ── the sentences that keep the screen honest ────────────────────────────── */
/**
 * What a recorded cost is. Said on the screen, not only here.
 *
 * The coach's own word, in exactly the voice `RECEIPT_IS_YOUR_WORD` uses on the
 * way in. This app was not there, was not shown a receipt, and has not
 * reconciled anything.
 */
exports.COST_IS_YOUR_WORD = 'These are things you have told this app you paid for. Nothing here has been checked against a bank, a card or a supplier, and this app was not involved in any of them. They are your own record of money you say went out.';
/**
 * That nothing is subtracted, and why.
 *
 * The most important sentence this feature carries, and it goes on the screen
 * because the absence of a profit figure reads as an omission unless somebody
 * says it was a decision. A reader who is not told will do the subtraction in
 * their head, and every input to it is incomplete in a way only they can know.
 */
exports.COSTS_ARE_NEVER_NETTED = 'Nothing here is taken off what you were paid, and there is no profit figure anywhere in this app. What comes in is gross of Stripe’s fee and the platform’s, both sides are only as complete as what you have written down, and the two can be in different currencies. A single number over that would be about neither question. Your accountant does this subtraction with your full records; this is one of the things you hand them.';
/**
 * That this is not a tax record.
 *
 * The invoice refuses to state a tax rate for the same reason and says so on
 * its own face. A coach who sees a costs list will reasonably expect a
 * "deductible" tick next to each line, and the honest answer is that whether a
 * cost is allowable is their accountant's judgement about their trade in their
 * country, not a checkbox this app can offer.
 */
exports.COSTS_ARE_NOT_TAX_ADVICE = 'No cost here is marked as allowable or not allowable, and none of them has been treated as a deduction. Whether something can be set against your income depends on your country, your trade and your accountant’s judgement, and this app knows none of the three. This is a list of what you say you paid, for them to work from.';
/**
 * That two things already counted must not be written down again.
 *
 * The most likely way this feature produces a wrong figure. Ad spend already
 * sits against a join code and the coach's own Repple plan is already read from
 * their billing, so both are on the Going Out side before a coach types
 * anything — and a row for either would count the same money twice. It is the
 * same trap `RECEIPT_MAY_DOUBLE_COUNT` names on the way in, and the same
 * answer: nothing can detect it, so the screen says it.
 */
exports.COSTS_NOT_TWICE = 'Leave out your Repple plan and your ad spend. Both are already counted under what is going out — your plan from your own billing, your ad spend from what you record against a join code — and writing either down here would count it twice. Nothing can tell that two rows are the same money.';
/**
 * The sentence under an empty list, which depends entirely on the read.
 *
 * A confident "you have recorded nothing" over a failed read is the same defect
 * this codebase exists to prevent, and here it would tell a coach their rent is
 * not on record when the truth is that the query was refused.
 */
function costsEmptyLine(status) {
    if (status === 'error') {
        return 'Your recorded costs could not be read, so nothing is listed. That is not a statement that you have recorded none, and anything already recorded still stands.';
    }
    if (status === 'partial') {
        return 'There are more recorded costs than could be read in one request, so nothing here is a total.';
    }
    if (status === 'loading')
        return 'Still reading.';
    return 'You have not recorded anything your business costs you. Rent or a chair fee, insurance, courses, equipment, kit, travel and your accountant never reach this app on their own, so until you write them down the outgoing side of your Money screen is your Repple plan and your ad spend and nothing else.';
}
