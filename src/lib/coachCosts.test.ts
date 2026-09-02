// What a coach's own business costs them. Compile with tsc, then run under
// plain node.
//
// This is the outgoing half of a money screen, and the harmful versions of it
// all look reasonable:
//
//   · a profit figure — any subtraction at all — over two sides that are both
//     incomplete and may be in different currencies;
//   · a total across currencies, or an amount printed with no currency on it;
//   · a confident "you have recorded nothing" over a read that failed, on the
//     one screen whose whole point is that a figure was missing;
//   · an amount converted to minor units by multiplying by a hundred, which is
//     wrong in twenty-one currencies;
//   · a "deductible" tick, which would be tax advice under somebody's name.
import {
  costBlockers, costsTaken, costsByCategory, costsEmptyLine, categoryLabel, COST_CATEGORIES,
  COST_IS_YOUR_WORD, COSTS_ARE_NEVER_NETTED, COSTS_ARE_NOT_TAX_ADVICE, COSTS_NOT_TWICE,
  type CoachCost, type CostDraft,
} from './coachCosts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

const cost = (o: Partial<CoachCost> = {}): CoachCost => ({
  id: 'c1', description: 'September rent', category: 'rent',
  amountCents: 45000, currency: 'GBP', paidOn: '2026-09-01',
  note: null, createdAt: null, ...o,
});

const draft = (o: Partial<CostDraft> = {}): CostDraft => ({
  description: 'September rent', amountText: '450', currency: 'GBP',
  category: 'rent', paidOn: '2026-09-01', ...o,
});

/* ── 1. what stops a cost being recorded ──────────────────────────────────
   Every blocker is a sentence the coach can act on, and they arrive together
   rather than one press at a time. */

{
  eq(costBlockers(draft()).length, 0, 'a complete draft has nothing wrong with it');

  const empty = costBlockers({ description: '', amountText: '', currency: null, category: 'rent', paidOn: '' });
  ok(empty.length >= 3, 'an empty draft names every problem at once rather than the first');
  ok(empty.some((b) => b.includes('Say what this was for')), 'a cost with no description is refused');
  ok(empty.some((b) => b.includes('No currency has been set')), 'and so is one with no currency');
  ok(empty.some((b) => b.includes('day you paid it')), 'and one with no date');

  // The currency check comes BEFORE the amount, because without one the amount
  // cannot be interpreted at all and it is a different problem with a different
  // fix — an owner sets a currency, nobody can fix an unreadable figure but the
  // person who typed it.
  const noCur = costBlockers(draft({ currency: null }));
  ok(noCur.some((b) => b.includes('white-labelled')), 'a missing currency names who sets one');
  ok(!noCur.some((b) => b.includes('greater than zero')), 'and does not also complain about an amount it cannot read');

  eq(costBlockers(draft({ amountText: '0' })).length, 1, 'a cost of nothing is refused');
  eq(costBlockers(draft({ amountText: '-40' })).length, 1, 'and so is a negative one');
  eq(costBlockers(draft({ category: 'not-a-category' as never })).length, 1, 'and a category nobody offers');
}

/* ── 2. the amount, where a hundredfold error would enter ─────────────────
   Through the same reader the invoice and receipt sheets use, so a coach
   typing one figure into two money boxes in this app cannot get two different
   amounts out. */

{
  eq(costBlockers(draft({ amountText: '450.50' })).length, 0, 'a two-place amount goes through');
  eq(costBlockers(draft({ amountText: '450,50' })).length, 0, 'and so does a comma decimal — half the world types it');
  eq(costBlockers(draft({ currency: 'JPY', amountText: '45000' })).length, 0, 'a yen amount is a whole number');
  eq(costBlockers(draft({ currency: 'JPY', amountText: '450.50' })).length, 1, 'and a decimal in one is refused rather than rounded');
  // The other end of the same mistake. A Kuwaiti dinar has a THOUSAND fils in
  // it, so a rent of 450.000 is 450000 minor units — not 45000.
  eq(costBlockers(draft({ currency: 'KWD', amountText: '450.000' })).length, 0, 'a three-place amount is an amount');
  const kw = costBlockers(draft({ currency: 'KWD', amountText: '450.005' }));
  eq(kw.length, 1, 'and Stripe charges thousandths in tens, so the last place must be a nought');
  ok(kw[0].includes('KWD'), 'the refusal names the currency it is talking about');
}

/* ── 3. what they add up to, and what they never add up with ──────────────*/

{
  const t = costsTaken([cost(), cost({ id: 'c2', amountCents: 12000, category: 'insurance' })]);
  eq(t.pots.length, 1, 'one currency, one pot');
  eq(t.pots[0].minorUnits, 57000, 'and the pot is the sum of it');

  // A coach paid in dirhams may pay a UK insurer in sterling. AED 600 plus GBP
  // 90 is not 690 of anything, here or anywhere else in this app.
  const mixed = costsTaken([cost(), cost({ id: 'c2', currency: 'AED', amountCents: 60000 })]);
  eq(mixed.pots.length, 2, 'two currencies stay two pots');
  ok(!mixed.pots.some((p) => p.minorUnits === 105000), 'and are never added into one');

  // An amount with no unit is a hole in the total and the size of it is the
  // thing worth reporting. It is counted, never dropped and never summed.
  const holed = costsTaken([cost(), cost({ id: 'c2', currency: null })]);
  eq(holed.unlabelled, 1, 'a cost with no currency is counted out of the total');
  eq(holed.pots[0].minorUnits, 45000, 'and is not silently added to it');
  eq(costsTaken([cost({ amountCents: null })]).unpriced, 1, 'and one with no amount at all is counted too');

  // Dated by the day the coach says the money went out. A quarter of receipts
  // written up in one evening must not all land in that evening's month.
  eq(costsTaken([cost()])?.pots[0].count, 1, 'the count is of rows, not of currencies');
}

/* ── 4. where it went, per category AND per currency ──────────────────────*/

{
  const by = costsByCategory([
    cost({ id: 'a', category: 'rent', amountCents: 45000 }),
    cost({ id: 'b', category: 'insurance', amountCents: 12000 }),
    cost({ id: 'c', category: 'rent', amountCents: 45000 }),
  ]);
  eq(by.length, 2, 'two categories used, two rows');
  eq(by[0].category, 'rent', 'and the biggest is first');
  eq(by[0].taken.pots[0].minorUnits, 90000, 'with its own pot summed');
  eq(by[0].label, 'Rent or Chair Fee', 'labelled in the words the coach chose from');

  // A category with nothing in it is ABSENT rather than present at zero. A
  // "Kit — 0.00" line is a statement that this coach spent nothing on kit, and
  // what it would actually mean is that they have not written any down.
  ok(!by.some((c) => c.category === 'kit'), 'a category with nothing in it does not appear at zero');
  eq(costsByCategory([]).length, 0, 'and an empty book has no categories at all');

  // Two currencies inside one category are two lines, not a sum, for the same
  // reason they are two pots in the total.
  const twoCur = costsByCategory([
    cost({ id: 'a', category: 'travel', currency: 'GBP', amountCents: 1000 }),
    cost({ id: 'b', category: 'travel', currency: 'AED', amountCents: 5000 }),
  ]);
  eq(twoCur.length, 1, 'one category');
  eq(twoCur[0].taken.pots.length, 2, 'and two amounts of money inside it');

  // A stored category a newer build wrote is still a real cost with a real
  // amount on it, so it is named as itself rather than blanked or called
  // "unknown".
  eq(categoryLabel('something_added_later'), 'something_added_later', 'an unrecognised category prints as itself');
  eq(categoryLabel(null), 'Not stated', 'and a missing one says so rather than being blank');
  eq(categoryLabel('rent'), 'Rent or Chair Fee', 'and a known one gets its label');
}

/* ── 5. an empty list is not "you spent nothing" ──────────────────────────
   The defect this codebase exists to prevent, on the screen where the whole
   point is that a figure was missing. */

{
  ok(costsEmptyLine('error').includes('could not be read'), 'a failed read says so');
  ok(costsEmptyLine('error').includes('not a statement that you have recorded none'),
    'and says outright that it is not a claim about the record');
  ok(costsEmptyLine('partial').includes('nothing here is a total'), 'a truncated read states no total');
  eq(costsEmptyLine('loading'), 'Still reading.', 'and a read in flight says only that');
  ok(costsEmptyLine('ready').includes('have not recorded'), 'a whole read with nothing in it is a real answer');
  ok(costsEmptyLine('ready').includes('Rent'), 'and names what belongs here');
}

/* ── 6. NOTHING IS EVER SUBTRACTED ────────────────────────────────────────
   The rule this whole module exists under. The moment money in and money out
   are both readable, somebody computes a profit and puts it in a hero — and
   the figure would be wrong for four independent reasons. There is no
   function here that could produce one. */

{
  const mod: Record<string, unknown> = require('./coachCosts');
  const named = Object.keys(mod).join(' ').toLowerCase();
  ok(!/\bnet\b|profit|margin|balance|surplus/.test(named),
    'this module exports nothing named net, profit, margin, balance or surplus');
  ok(COSTS_ARE_NEVER_NETTED.includes('no profit figure anywhere in this app'),
    'and the screen says so out loud, because an absent figure reads as an omission');
  ok(COSTS_ARE_NEVER_NETTED.includes('different currencies'), 'naming one of the reasons it could not be computed');

  // And no tax claim. Whether a cost is allowable is the coach's accountant's
  // judgement about their trade in their country, and a tick here would be
  // advice printed under somebody's name.
  ok(COSTS_ARE_NOT_TAX_ADVICE.includes('allowable'), 'no cost is marked allowable');
  ok(!COST_CATEGORIES.some((c) => /deduct|allowab|tax|vat/i.test(c.id + c.label + c.note)),
    'and no category implies a tax treatment');

  // The two things already counted, which a coach must not write down twice.
  ok(COSTS_NOT_TWICE.includes('Repple plan') && COSTS_NOT_TWICE.includes('ad spend'),
    'the double-count warning names both of them');
  // Compared as strings, not against the union: `c.id === 'advertising'` is a
  // type error precisely BECAUSE the union does not contain it, and an
  // assertion that cannot compile once the bug is reintroduced is not an
  // assertion. This one still fails if somebody widens the union.
  const ids: string[] = COST_CATEGORIES.map((c) => c.id);
  ok(!ids.includes('advertising') && !ids.includes('platform'),
    'and neither is offered as a category in the first place');

  ok(COST_IS_YOUR_WORD.includes('has been checked against'), 'a recorded cost is the coach’s own word and says so');
}

declare const require: (id: string) => Record<string, unknown>;
declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH COSTS FAILURES:\n' + errors.join('\n') : 'coachCosts: ok (nothing is netted, currencies never merge, and an unread list is not a business with no costs)');
if (errors.length) process.exit(1);
