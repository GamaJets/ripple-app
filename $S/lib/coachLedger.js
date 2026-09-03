"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERIOD_NOTE = exports.STRIPE_AUTHORITY_NOTE = exports.NO_NET_NOTE = void 0;
exports.ledger = ledger;
exports.joinLabels = joinLabels;
exports.sumMajor = sumMajor;
exports.sumSpend = sumSpend;
exports.denominate = denominate;
exports.ledgerEmptyLine = ledgerEmptyLine;
const loadStatus_1 = require("../ui/loadStatus");
const coachMoney_1 = require("./coachMoney");
/**
 * Several reads, added into one ledger — or withheld, with the reason.
 *
 * The rule is all-or-nothing and it is deliberately strict. Two of the three
 * non-ready statuses could arguably be shown partially ('partial' has real rows
 * in it), but a coach reading a money figure is not reading a list: they are
 * deciding whether they can pay rent, and there is no presentation of "some of
 * your takings" that survives being glanced at.
 *
 * Zero strands is a whole ledger of nothing rather than an error, so a screen
 * that has not been given a side yet renders an honest empty rather than a
 * failure it would have to explain.
 */
function ledger(strands) {
    const status = strands.length ? (0, loadStatus_1.worstStatus)(...strands.map((s) => s.status)) : 'ready';
    const missing = strands.filter((s) => s.status !== 'ready').map((s) => s.label);
    if (status === 'ready') {
        return { status, total: (0, coachMoney_1.combineTaken)(...strands.map((s) => s.taken)), reason: null, missing: [] };
    }
    const list = joinLabels(missing);
    const reason = status === 'loading'
        ? `Still reading ${list}, so no figure is stated yet.`
        : status === 'partial'
            ? `There are more ${list} on record than could be read in one request, so no total is stated. What is listed is real; it is not all of it.`
            : `Your ${list} could not be read, so no total is stated. An empty figure here is not a statement that you were paid nothing.`;
    return { status, total: null, reason, missing };
}
/** "sales", "sales and renewals", "sales, renewals and fees". Oxford comma
 *  omitted to match the prose everywhere else in the app. */
function joinLabels(labels) {
    if (labels.length === 0)
        return 'nothing';
    if (labels.length === 1)
        return labels[0];
    return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
/**
 * Add up whole-unit amounts, per currency.
 *
 * The twin of `sumTaken`, for the one family of rows in this database that is
 * NOT in minor units: `charges.amount` is `numeric` and holds 40, not 4000, for
 * a fee of forty. It is a separate function rather than a flag on the existing
 * one because a boolean parameter called `minor` is exactly the kind of thing
 * that gets passed wrong once and then prints somebody's fee as a hundredth of
 * itself forever.
 *
 * Currencies never merge, for the same reason they never merge anywhere else:
 * AED 40 plus GBP 25 is not 65 of anything.
 */
function sumMajor(rows) {
    const by = new Map();
    let unlabelled = 0;
    let unpriced = 0;
    for (const r of rows) {
        if (r.amount == null || !Number.isFinite(r.amount)) {
            unpriced += 1;
            continue;
        }
        const cur = (r.currency || '').trim().toUpperCase();
        if (!cur) {
            unlabelled += 1;
            continue;
        }
        const pot = by.get(cur);
        if (pot) {
            pot.units += r.amount;
            pot.count += 1;
        }
        else
            by.set(cur, { currency: cur, units: r.amount, count: 1 });
    }
    const pots = [...by.values()].sort((a, b) => (b.units - a.units) || a.currency.localeCompare(b.currency));
    return { pots, unlabelled, unpriced };
}
function sumSpend(rows) {
    const by = new Map();
    let unrecorded = 0;
    for (const r of rows) {
        const cents = r.spend?.cents;
        const cur = (r.spend?.currency || '').trim().toUpperCase();
        // A spend of zero IS a recorded figure and belongs in the total; only an
        // absent one is unrecorded. The two used to be the same value and a coach
        // who cleared a wrong number could not tell that they had.
        if (cents == null || !Number.isFinite(cents) || !cur) {
            unrecorded += 1;
            continue;
        }
        const pot = by.get(cur);
        if (pot) {
            pot.minorUnits += cents;
            pot.count += 1;
        }
        else
            by.set(cur, { currency: cur, minorUnits: cents, count: 1 });
    }
    const pots = [...by.values()].sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency));
    return { pots, unrecorded };
}
function denominate(currency, status) {
    if (status === 'error') {
        return {
            ok: false,
            why: 'unread',
            note: 'We couldn’t read what currency you charge in, so amounts that depend on it are withheld rather than printed in one we picked. Nothing is missing from your settings — the read failed. Open this again in a moment.',
        };
    }
    const code = (currency || '').trim().toUpperCase();
    if (code.length < 3) {
        return {
            ok: false,
            why: 'unset',
            note: 'Nobody has set a currency for you yet. Repple is white-labelled, so there is no default that would be right for every gym, and a figure with the wrong three letters on it is a different amount of money. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.',
        };
    }
    return { ok: true, currency: code };
}
/**
 * The sentence under a ledger with nothing in it.
 *
 * A confident zero over a failed read is the most expensive sentence this app
 * can say, and "you have taken nothing" is the most expensive version of it.
 * Every money table in this database is empty today — verified live — so this
 * is not a rare branch: it is the first thing most coaches will read on this
 * screen, and it has to be true.
 */
function ledgerEmptyLine(side, status) {
    if (status === 'error') {
        return side === 'in'
            ? 'Nothing is shown because the read failed, not because nobody has paid you. Anything already recorded still stands.'
            : 'Nothing is shown because the read failed, not because you owe nothing. Anything already charged to you still stands.';
    }
    // Deliberately one sentence for both sides. Truncation says the same thing
    // about money coming in and money going out, and two identical strings behind
    // a branch is a branch nobody can get wrong later by editing one of them.
    if (status === 'partial')
        return 'There is more on record than could be read in one request, so nothing here is a total.';
    if (status === 'loading')
        return 'Still reading.';
    return side === 'in'
        ? 'Nothing has been recorded as paid to you yet. Money taken through Repple lands here; cash and transfers do not, so this is not the whole of what you earn.'
        : 'Nothing has been recorded as going out. Your Repple plan and any ad spend you record show up here.';
}
/* ── the sentences that keep the screen from overclaiming ─────────────────── */
/**
 * Why the two halves are never one number.
 *
 * On the screen rather than only in this comment, because the absence of a net
 * figure reads as an omission unless somebody says it was a decision.
 */
exports.NO_NET_NOTE = 'What comes in and what goes out are kept apart and are never subtracted from each other. They are recorded in different places, in currencies that may differ, and neither is complete on its own — a single net figure would be a number about neither question.';
/**
 * What Stripe knows, and the one piece of it this app is now told.
 *
 * Every takings figure here is still GROSS: what a client was charged. Stripe's
 * processing fee and the platform's application fee are facts that live at
 * Stripe and no webhook in this repo writes either of them.
 *
 * What HAS changed is the last clause. This note used to end "Repple is not
 * told what Stripe paid out or when it cleared", and part 194 mirrors
 * `payout.paid` and `payout.failed` — so the app does now know what reached the
 * bank, in a separate section, from a separate source.
 *
 * The two are never subtracted from each other and the note says so, because
 * the subtraction is the thing a reader would otherwise do in their head and
 * every one of its three numbers would be wrong: a payout is a BALANCE — many
 * charges at once, less fees, less refunds, on Stripe's own schedule — and it
 * does not correspond to the charges listed above it. `PAYOUT_IS_NOT_A_SALE` in
 * src/lib/coachPayouts.ts carries the long form.
 */
exports.STRIPE_AUTHORITY_NOTE = 'These are amounts clients were charged, before Stripe’s fee and the platform fee. What actually reached your bank is a different figure from a different source, shown separately under what landed — a payout is a balance rather than the proceeds of a sale, so the two are never subtracted from each other. Your Stripe dashboard is the record of what moved.';
/** What a period figure counts, said next to the period. A total with no
 *  stated span is read as "all time" by half its readers and "this month" by
 *  the other half. */
exports.PERIOD_NOTE = 'Counted by the date the money was charged, not the date the record was written, so a payment confirmed late still falls in the month the client paid.';
