"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What a gym's own operation costs it. Compile with tsc, then run under plain
// node.
//
// This is the outgoing half of a gym's books, and the harmful versions of it
// all look reasonable:
//
//   · a profit figure — any subtraction at all — over a takings side that is
//     gross and a costs side that is whatever somebody typed;
//   · a total across currencies, or an amount printed with no currency on it;
//   · a confident "this gym has recorded nothing" over a read that failed, on
//     the screen whose whole point is that a figure was missing;
//   · an amount converted to minor units by multiplying by a hundred, which is
//     wrong in twenty-one currencies;
//   · a 'wages' category, which would count trainer pay twice — it is already
//     settled through Payroll and is already /accounting's whole "money out";
//   · a "reclaimable" tick, which would be tax advice under somebody's name
//     about a document this product does not hold.
const gymCosts_1 = require("./gymCosts");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (!Object.is(a, b))
        errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};
const cost = (o = {}) => ({
    id: 'c1', description: 'September rent', supplier: 'Northgate Estates',
    category: 'rent', amountCents: 450000, currency: 'GBP', paidOn: '2026-09-01',
    note: null, createdAt: null, ...o,
});
const draft = (o = {}) => ({
    description: 'September rent', amountText: '4500', currency: 'GBP',
    category: 'rent', paidOn: '2026-09-01', ...o,
});
/* ── 1. what stops a cost being recorded ──────────────────────────────────
   Every blocker is a sentence an owner can act on, and they arrive together
   rather than one press at a time. */
{
    eq((0, gymCosts_1.gymCostBlockers)(draft()).length, 0, 'a complete draft has nothing wrong with it');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ supplier: null })).length, 0, 'and a supplier is optional — a cash purchase is still a cost');
    const empty = (0, gymCosts_1.gymCostBlockers)({ description: '', amountText: '', currency: null, category: 'rent', paidOn: '' });
    ok(empty.length >= 3, 'an empty draft names every problem at once rather than the first');
    ok(empty.some((b) => b.includes('Say what this was for')), 'a cost with no description is refused');
    ok(empty.some((b) => b.includes('has not set its currency')), 'and so is one with no currency');
    ok(empty.some((b) => b.includes('day the money went out')), 'and one with no date');
    // The currency check comes BEFORE the amount, because without one the amount
    // cannot be interpreted at all — and because a gym that has not set a
    // currency is a different problem with a different fix.
    const noCur = (0, gymCosts_1.gymCostBlockers)(draft({ currency: null }));
    ok(noCur.some((b) => b.includes('white-labelled')), 'a missing currency names who fixes it');
    ok(!noCur.some((b) => b.includes('greater than zero')), 'and does not also complain about an amount it cannot read');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '0' })).length, 1, 'a cost of nothing is refused');
    ok((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '0' }))[0].includes('was free'), 'and says why a nought is a claim rather than a blank');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '-40' })).length, 1, 'and so is a negative one');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ category: 'wages' })).length, 1, 'and a category nobody offers');
    // The column's own ceiling, stated beside the field rather than arriving as a
    // 23514 after the form has closed.
    eq((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '999999999.99' })).length, 0, 'a very large but recordable amount goes through');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '9999999999.99' })).length, 1, 'and one past the column ceiling is refused here rather than by a 23514');
    eq(gymCosts_1.GYM_COST_MAX_MINOR, 100000000000, 'and the ceiling is the one part 700 checks');
}
/* ── 2. the amount, where a hundredfold error would enter ─────────────────
   Through `readMinorAmount`, the reader the whole app uses, rather than a
   second one written for this screen. */
{
    eq((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '4500.50' })).length, 0, 'a two-place amount goes through');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ amountText: '4500,50' })).length, 0, 'and so does a comma decimal — half the world types it');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ currency: 'JPY', amountText: '450000' })).length, 0, 'a yen amount is a whole number');
    eq((0, gymCosts_1.gymCostBlockers)(draft({ currency: 'JPY', amountText: '4500.50' })).length, 1, 'and a decimal in one is refused rather than rounded');
    // The other end of the same mistake. A Kuwaiti dinar has a THOUSAND fils in
    // it, so a rent of 450.000 is 450000 minor units — not 45000.
    eq((0, gymCosts_1.gymCostBlockers)(draft({ currency: 'KWD', amountText: '450.000' })).length, 0, 'a three-place amount is an amount');
    const kw = (0, gymCosts_1.gymCostBlockers)(draft({ currency: 'KWD', amountText: '450.005' }));
    eq(kw.length, 1, 'and thousandths are charged in tens, so the last place must be a nought');
    ok(kw[0].includes('KWD'), 'the refusal names the currency it is talking about');
}
/* ── 3. what they add up to, and what they never add up with ──────────────*/
{
    const t = (0, gymCosts_1.gymCostsTaken)([cost(), cost({ id: 'c2', amountCents: 120000, category: 'utilities' })]);
    eq(t.pots.length, 1, 'one currency, one pot');
    eq(t.pots[0].minorUnits, 570000, 'and the pot is the sum of it');
    // A UK gym insured through a European broker is ordinary. GBP 4,500 plus EUR
    // 900 is not 5,400 of anything, here or anywhere else in this app.
    const mixed = (0, gymCosts_1.gymCostsTaken)([cost(), cost({ id: 'c2', currency: 'EUR', amountCents: 90000 })]);
    eq(mixed.pots.length, 2, 'two currencies stay two pots');
    ok(!mixed.pots.some((p) => p.minorUnits === 540000), 'and are never added into one');
    // An amount with no unit is a hole in the total and the size of it is the
    // thing worth reporting. It is counted, never dropped and never summed.
    const holed = (0, gymCosts_1.gymCostsTaken)([cost(), cost({ id: 'c2', currency: null })]);
    eq(holed.unlabelled, 1, 'a cost with no currency is counted out of the total');
    eq(holed.pots[0].minorUnits, 450000, 'and is not silently added to it');
    eq((0, gymCosts_1.gymCostsTaken)([cost({ amountCents: null })]).unpriced, 1, 'and one with no amount at all is counted too');
}
/* ── 4. where it went, per category AND per currency ──────────────────────*/
{
    const by = (0, gymCosts_1.gymCostsByCategory)([
        cost({ id: 'a', category: 'rent', amountCents: 450000 }),
        cost({ id: 'b', category: 'utilities', amountCents: 120000 }),
        cost({ id: 'c', category: 'rent', amountCents: 450000 }),
    ]);
    eq(by.length, 2, 'two categories used, two rows');
    eq(by[0].category, 'rent', 'and the biggest is first');
    eq(by[0].taken.pots[0].minorUnits, 900000, 'with its own pot summed');
    eq(by[0].label, 'Rent and Rates', 'labelled in the words the owner chose from');
    // A category with nothing in it is ABSENT rather than present at zero. A
    // "Utilities — 0.00" line is a statement that this gym spent nothing on
    // power, and what it would actually mean is that nobody has written any down.
    ok(!by.some((c) => c.category === 'insurance'), 'a category with nothing in it does not appear at zero');
    eq((0, gymCosts_1.gymCostsByCategory)([]).length, 0, 'and an empty ledger has no categories at all');
    // Two currencies inside one category are two lines, not a sum, for the same
    // reason they are two pots in the total.
    const twoCur = (0, gymCosts_1.gymCostsByCategory)([
        cost({ id: 'a', category: 'insurance', currency: 'GBP', amountCents: 10000 }),
        cost({ id: 'b', category: 'insurance', currency: 'EUR', amountCents: 50000 }),
    ]);
    eq(twoCur.length, 1, 'one category');
    eq(twoCur[0].taken.pots.length, 2, 'and two amounts of money inside it');
    // A stored category a newer build wrote is still a real cost with a real
    // amount on it, so it is named as itself rather than blanked or called
    // "unknown".
    eq((0, gymCosts_1.gymCostCategoryLabel)('something_added_later'), 'something_added_later', 'an unrecognised category prints as itself');
    eq((0, gymCosts_1.gymCostCategoryLabel)(null), 'Not stated', 'and a missing one says so rather than being blank');
    eq((0, gymCosts_1.gymCostCategoryLabel)('utilities'), 'Utilities', 'and a known one gets its label');
}
/* ── 5. an empty list is not "this gym spent nothing" ─────────────────────
   The defect this codebase exists to prevent, on a screen an accountant is
   pointed at. */
{
    ok((0, gymCosts_1.gymCostsEmptyLine)('error').includes('could not be read'), 'a failed read says so');
    ok((0, gymCosts_1.gymCostsEmptyLine)('error').includes('not a statement that none have been recorded'), 'and says outright that it is not a claim about the record');
    ok((0, gymCosts_1.gymCostsEmptyLine)('partial').includes('nothing here is a total'), 'a truncated read states no total');
    eq((0, gymCosts_1.gymCostsEmptyLine)('loading'), 'Still reading.', 'and a read in flight says only that');
    ok((0, gymCosts_1.gymCostsEmptyLine)('ready').includes('Nothing has been recorded'), 'a whole read with nothing in it is a real answer');
    ok((0, gymCosts_1.gymCostsEmptyLine)('ready').includes('Rent'), 'and names what belongs here');
}
/* ── 6. NOTHING IS EVER SUBTRACTED ────────────────────────────────────────
   The rule this whole module exists under. /accounting already prints
   "Cash recorded in Repple" — payments less payroll — and the obvious next
   edit is to fold these rows into it and call the answer profit. There is no
   function here that could produce one. */
{
    const mod = require('./gymCosts');
    const named = Object.keys(mod).join(' ').toLowerCase();
    ok(!/\bnet\b|profit|margin|balance|surplus/.test(named), 'this module exports nothing named net, profit, margin, balance or surplus');
    ok(gymCosts_1.GYM_COSTS_ARE_NEVER_NETTED.includes('no profit figure anywhere in this app'), 'and the screen says so out loud, because an absent figure reads as an omission');
    ok(gymCosts_1.GYM_COSTS_ARE_NEVER_NETTED.includes('different currency'), 'naming one of the reasons it could not be computed');
    ok(gymCosts_1.GYM_COSTS_ARE_NEVER_NETTED.includes('card processor'), 'and another, which is the one nothing in this database holds at all');
}
/* ── 7. the two things already counted, and the one that is not ───────────
   The likeliest way this feature produces a wrong figure, and it is a bigger
   trap than the coach's: trainer session pay is already the whole of what
   /accounting calls money out. */
{
    ok(gymCosts_1.GYM_COSTS_NOT_TWICE.includes('Payroll'), 'the double-count warning names payroll');
    ok(gymCosts_1.GYM_COSTS_NOT_TWICE.includes('refund'), 'and refunds, which are recorded against the original payment');
    ok(gymCosts_1.GYM_COSTS_NOT_TWICE.includes('reception'), 'and says which wages DO belong here, because "no wages" would lose a gym its largest line');
    // Compared as strings, not against the union: `c.id === 'wages'` is a type
    // error precisely BECAUSE the union does not contain it, and an assertion
    // that cannot compile once the bug is reintroduced is not an assertion. This
    // one still fails if somebody widens the union.
    const ids = gymCosts_1.GYM_COST_CATEGORIES.map((c) => c.id);
    ok(!ids.includes('wages') && !ids.includes('payroll'), 'and neither is offered as a category in the first place');
    ok(!ids.includes('refunds'), 'nor are refunds');
    ok(ids.includes('staff'), 'while the people payroll does not settle have a category of their own');
    ok(gymCosts_1.GYM_COST_CATEGORIES.find((c) => c.id === 'staff').note.includes('NOT trainer session pay'), 'whose note says which people it does not mean');
    // A gym's Repple bill is the OPPOSITE of the coach's rule: part 252 keeps it
    // off every screen a gym owner can open, so this is the only place it can be
    // recorded at all.
    ok(gymCosts_1.GYM_COST_CATEGORIES.find((c) => c.id === 'software').note.includes('Repple'), 'and the software category says the gym’s own Repple bill belongs in it');
}
/* ── 8. not a tax record ──────────────────────────────────────────────────*/
{
    ok(gymCosts_1.GYM_COSTS_ARE_NOT_TAX_ADVICE.includes('reclaimable'), 'no cost is marked reclaimable');
    ok(gymCosts_1.GYM_COSTS_ARE_NOT_TAX_ADVICE.includes('supplier’s own invoice'), 'and the sentence names the evidence this product does not hold');
    ok(!gymCosts_1.GYM_COST_CATEGORIES.some((c) => /deduct|allowab|\btax\b|vat/i.test(c.id + c.label + c.note)), 'and no category implies a tax treatment');
    ok(gymCosts_1.GYM_COSTS_ARE_YOUR_WORD.includes('has been checked against'), 'a recorded cost is the gym’s own word and says so');
    ok(gymCosts_1.GYM_COSTS_ARE_YOUR_WORD.includes('no receipt or invoice is stored'), 'and says that nothing is held behind it');
}
console.log(errors.length ? 'GYM COSTS FAILURES:\n' + errors.join('\n') : 'gymCosts: ok (nothing is netted, currencies never merge, payroll is not counted twice, and an unread ledger is not a gym with no costs)');
if (errors.length)
    process.exit(1);
