"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GYM_COSTS_NOT_TWICE = exports.GYM_COSTS_ARE_NOT_TAX_ADVICE = exports.GYM_COSTS_ARE_NEVER_NETTED = exports.GYM_COSTS_ARE_YOUR_WORD = exports.GYM_COST_MAX_MINOR = exports.GYM_COST_CATEGORIES = void 0;
exports.gymCostCategoryLabel = gymCostCategoryLabel;
exports.gymCostBlockers = gymCostBlockers;
exports.gymCostsTaken = gymCostsTaken;
exports.gymCostsByCategory = gymCostsByCategory;
exports.gymCostsEmptyLine = gymCostsEmptyLine;
exports.fetchGymCosts = fetchGymCosts;
exports.recordGymCost = recordGymCost;
exports.deleteGymCost = deleteGymCost;
// One summing function for the whole app: currencies never merge, and an amount
// with no unit is counted rather than dropped.
const coachMoney_1 = require("./coachMoney");
const rowCap_1 = require("./rowCap");
const wroteRows_1 = require("./wroteRows");
/**
 * The categories, in the order they are offered.
 *
 * Rent first because it is the largest line in most gyms' years and utilities
 * second because it is usually the next one. `note` is the plain-English gloss
 * under the label, and two of them are doing real work rather than explaining
 * an obvious word: 'staff' has to say which people it means, and 'software' has
 * to say that this gym's Repple bill belongs in it.
 */
exports.GYM_COST_CATEGORIES = [
    { id: 'rent', label: 'Rent and Rates', note: 'Premises rent, the service charge, business rates' },
    { id: 'utilities', label: 'Utilities', note: 'Electricity, gas, water, waste' },
    { id: 'staff', label: 'Staff Not on Payroll', note: 'Reception, cleaning, a manager, employer taxes — NOT trainer session pay, which is already settled on Payroll' },
    { id: 'maintenance', label: 'Maintenance and Cleaning', note: 'Servicing, repairs, an engineer, hygiene supplies' },
    { id: 'equipment', label: 'Equipment', note: 'A machine, plates, a rack, anything the floor is made of' },
    { id: 'insurance', label: 'Insurance', note: 'Public liability, employer’s liability, buildings and contents' },
    { id: 'licensing', label: 'Licences', note: 'A music licence, a local-authority licence, a certification' },
    { id: 'marketing', label: 'Marketing', note: 'Ads, print, a photographer, the website' },
    { id: 'software', label: 'Software', note: 'Booking, till, music, accounting — and this gym’s own Repple bill, which is on no screen you can open' },
    { id: 'stock', label: 'Stock', note: 'Drinks, supplements, anything the gym sells on' },
    { id: 'professional', label: 'Professional Fees', note: 'An accountant, a solicitor, a payroll bureau' },
    { id: 'finance', label: 'Bank and Finance', note: 'Bank charges, card processing fees, interest on a loan' },
    { id: 'other', label: 'Something Else', note: 'Anything the twelve above do not cover' },
];
/** The category's label, or the stored id where a newer build wrote one this
 *  one does not know. Never a blank and never "unknown": a cost whose category
 *  cannot be named is still money that left, and the amount beside it still
 *  stands. */
function gymCostCategoryLabel(id) {
    const found = exports.GYM_COST_CATEGORIES.find((c) => c.id === id);
    return found ? found.label : String(id ?? '').trim() || 'Not stated';
}
/**
 * The largest amount part 700's CHECK will accept, in minor units.
 *
 * Stated here as well as in the column so the refusal arrives beside the field
 * rather than as a 23514 after the form has closed — the same reason
 * `parseAmount` in gymInvoices.ts names the integer ceiling it is working to.
 */
exports.GYM_COST_MAX_MINOR = 100000000000;
/**
 * Every reason this cost cannot be recorded, in the owner's own words.
 *
 * A list rather than the first failure, the same discipline `invoiceBlockers`
 * and `costBlockers` keep: somebody who has left three fields empty should be
 * told all three at once rather than made to press the button three times. An
 * empty list means it can go.
 */
function gymCostBlockers(d) {
    const out = [];
    if (!String(d.description ?? '').trim()) {
        out.push('Say what this was for. An amount with nothing beside it is a line nobody can place against a bank statement in eleven months, which is when somebody will be trying to.');
    }
    // Currency before amount, because without one the amount cannot be
    // interpreted at all and "this gym has not set a currency" is a different
    // problem with a different fix — an owner sets one, and nobody can fix an
    // unreadable figure except the person who typed it.
    const cur = (d.currency || '').trim();
    if (!cur) {
        out.push('This gym has not set its currency, so there is nothing to record this in. Repple is white-labelled and there is no default that is right for every gym — set one on the Gym screen.');
    }
    else if (!/^[A-Za-z]{3}$/.test(cur)) {
        out.push('The currency on record is not a three-letter code, so no amount can be recorded in it.');
    }
    else {
        // The reader's own reason rather than a sentence written here, so a gym in
        // Kuwait is told that the last place must be a nought and a gym in Japan is
        // told a yen has no smaller unit.
        const read = (0, coachMoney_1.readMinorAmount)(d.amountText, cur);
        if (!read.ok)
            out.push(read.reason);
        else if (read.minorUnits <= 0) {
            out.push('Enter an amount greater than zero. A cost of nothing is not a cost, and a nought here would be a statement that this supplier was free.');
        }
        else if (read.minorUnits >= exports.GYM_COST_MAX_MINOR) {
            out.push('That is more than Repple will record on one cost line — check the zeros.');
        }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.paidOn ?? ''))) {
        out.push('The day the money went out could not be read.');
    }
    if (!exports.GYM_COST_CATEGORIES.some((c) => c.id === d.category)) {
        out.push('Say what kind of cost this was.');
    }
    return out;
}
/* ── what they add up to ──────────────────────────────────────────────────── */
/**
 * Costs as a `Taken`, so the money screens add them the same way they add
 * everything else.
 *
 * The type name is about the SHAPE — one pot per currency, unlabelled and
 * unpriced rows counted rather than dropped — and reusing it is what stops the
 * outgoing side growing a second opinion about how to add money up. It does NOT
 * mean these are takings, and nothing that consumes this may put it in the same
 * total as one.
 *
 * The date passed as `created_at` is `paidOn` — the day the money went out,
 * never the day the row was written. A quarter of receipts entered in one
 * evening must not all land in that evening's month.
 */
function gymCostsTaken(rows) {
    return (0, coachMoney_1.sumTaken)(rows.map((c) => ({
        amount_cents: c.amountCents,
        currency: c.currency,
        created_at: c.paidOn,
    })));
}
function gymCostsByCategory(rows) {
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
        out.push({ category, label: gymCostCategoryLabel(category), taken: gymCostsTaken(list) });
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
 * In the same voice `COST_IS_YOUR_WORD` uses on the coach's side, with one
 * clause added that matters more for a gym: no document is held. An owner who
 * has typed forty rows will reasonably assume the app has something behind
 * them, and every one of those rows is worth exactly what the typing was.
 */
exports.GYM_COSTS_ARE_YOUR_WORD = 'These are things somebody at this gym has told Repple it paid for. Nothing here has been checked against a bank, a card or a supplier, no receipt or invoice is stored behind any of it, and Repple was not involved in any of them. They are the gym’s own record of money it says went out.';
/**
 * That nothing is subtracted, and why.
 *
 * The most important sentence this feature carries, and it goes on the screen
 * because the absence of a profit figure reads as an omission unless somebody
 * says it was a decision. A reader who is not told will do the subtraction in
 * their head, and every input to it is incomplete in a way only they can know.
 */
exports.GYM_COSTS_ARE_NEVER_NETTED = 'Nothing here is taken off what the gym took, and there is no profit figure anywhere in this app. What comes in is gross of the card processor’s fee, what comes in is only what somebody recorded at the desk, this side is only what somebody has typed, trainer pay sits in a different table again, and any of it can be in a different currency. A single number over that would be about none of those questions. Your accountant does this subtraction with the full records; this is one of the things you hand them.';
/**
 * That this is not a tax record.
 *
 * The invoice refuses to state a calculated tax for the same reason and part
 * 451 says so at length. An owner looking at a costs list will reasonably
 * expect a "reclaimable" tick beside each line, and the honest answer is that
 * it is their accountant's judgement — and that the evidence for it is the
 * supplier's own invoice, which this product does not hold.
 */
exports.GYM_COSTS_ARE_NOT_TAX_ADVICE = 'No cost here is marked allowable or reclaimable, and none of them has been treated as a deduction. Whether something can be set against the gym’s income, and whether any tax on it can be reclaimed, depends on the country, the trade and your accountant’s judgement — and the evidence for either is the supplier’s own invoice, which Repple does not hold. This is a list of what the gym says it paid, for them to work from.';
/**
 * The two things already counted, which must not be written down again.
 *
 * The likeliest way this feature produces a wrong figure, and it is a bigger
 * trap than the coach's: trainer session pay is settled through Payroll and is
 * already /accounting's whole "Money out", so a gym owner totalling the month's
 * wages and typing one figure counts most of it twice. Nothing can detect it,
 * so the screen says it.
 */
exports.GYM_COSTS_NOT_TWICE = 'Leave out what you pay trainers for sessions and anything you have refunded a member. Trainer session pay is settled on Payroll and is already the whole of what /accounting calls money out; a refund is recorded against the original payment, which is what keeps your takings right. Writing either down here counts it twice, and nothing can tell that two rows are the same money. Wages for people you do not settle through Payroll — reception, cleaning, a manager — do belong here.';
/**
 * The sentence under an empty list, which depends entirely on the read.
 *
 * A confident "this gym has recorded nothing" over a failed read is the defect
 * this codebase exists to prevent, and here it would tell an owner their rent
 * is not on record when the truth is that the query was refused.
 */
function gymCostsEmptyLine(status) {
    if (status === 'error') {
        return 'The recorded costs could not be read, so nothing is listed. That is not a statement that none have been recorded, and anything already recorded still stands.';
    }
    if (status === 'partial') {
        return 'There are more recorded costs than could be read in one request, so nothing here is a total.';
    }
    if (status === 'loading')
        return 'Still reading.';
    return 'Nothing has been recorded as going out. Rent, power, water, the cleaner, the engineer, the music licence, insurance, stock and the accountant never reach this app on their own, so until somebody writes them down the only outgoing this gym has on record is what it settles with its trainers.';
}
/* ── reads ────────────────────────────────────────────────────────────────── */
/**
 * The costs paid inside a window.
 *
 * Bounded at both ends by the caller, which is why this refuses a truncated
 * read rather than paging one: the sets are a month or a quarter of one gym's
 * purchase ledger, `assertWhole` reports the refusal in words a person can act
 * on, and a prefix of somebody's costs presented as the whole is the one thing
 * this module exists to prevent. The order is `paid_on desc, id desc` — a total
 * order, because two costs paid on the same day would otherwise tie.
 */
async function fetchGymCosts(sb, tenantId, fromDay, toDay) {
    const { data, error } = await sb
        .from('gym_costs')
        .select('id, description, supplier, category, amount_cents, currency, paid_on, note, created_at')
        .eq('tenant_id', tenantId)
        .gte('paid_on', fromDay)
        .lte('paid_on', toDay)
        .order('paid_on', { ascending: false })
        .order('id', { ascending: false })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    const rows = (0, rowCap_1.assertWhole)(data, 'the costs recorded in this period');
    return rows.map((r) => ({
        id: r.id,
        description: r.description ?? '',
        supplier: r.supplier ?? null,
        category: r.category ?? '',
        // Not `?? 0`. A cost with no amount is money of unknown size, and every
        // total refuses rather than absorbing it.
        amountCents: r.amount_cents ?? null,
        // Not a fallback code. The column is NOT NULL, so this branch does not fire
        // against a healthy database — and "in practice" is what every currency bug
        // in this repo was made of, so it is written anyway: null reaches money(),
        // which withholds.
        currency: r.currency ?? null,
        paidOn: r.paid_on,
        note: r.note ?? null,
        createdAt: r.created_at ?? null,
    }));
}
/* ── writes ───────────────────────────────────────────────────────────────── */
/**
 * Record a cost.
 *
 * `amountCents` and `currency` arrive already read — the caller has run
 * `gymCostBlockers` and cannot get here without them — rather than this
 * function reading the typed string a second time. Two readers over one box is
 * how an amount comes to be shown as one figure and stored as another.
 *
 * `recorded_by` is passed rather than defaulted in the column, so a row can
 * never claim an author the caller did not name.
 */
async function recordGymCost(sb, tenantId, cost) {
    const { error } = await sb.from('gym_costs').insert({
        tenant_id: tenantId,
        recorded_by: cost.recordedBy,
        description: cost.description.trim(),
        supplier: (cost.supplier ?? '').trim() || null,
        category: cost.category,
        amount_cents: cost.amountCents,
        currency: cost.currency.trim().toUpperCase(),
        paid_on: cost.paidOn,
        note: (cost.note ?? '').trim() || null,
    });
    if (error)
        throw error;
}
/**
 * Remove a cost.
 *
 * The COUNT is checked, not `error` alone. `gym_costs_owner_delete` is
 * `is_owner_of(tenant_id)`, so a delete run by anybody else matches ZERO ROWS
 * and returns `error: null` — and the screen would say the line was removed
 * while it is still in the ledger and still in the accountant's file. See
 * src/lib/wroteRows.ts.
 *
 * There is no update to pair with this, on purpose: part 700 grants none.
 * Correcting a cost is removing the wrong line and writing the right one, and
 * the deletion is logged to `gym_events` so the correction is not invisible.
 */
async function deleteGymCost(sb, costId) {
    const r = await sb.from('gym_costs').delete({ count: 'exact' }).eq('id', costId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That cost', r);
}
