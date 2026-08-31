// What a coach is told about their own money.
// Compile with tsc, run with node.
//
// Four things are defended here, and every one of them is a figure that would
// look entirely ordinary on the payments screen while being false about
// somebody's income:
//
// 1. Two currencies are never added together. A coach who takes AED from their
//    regulars and GBP from a visitor has two pots, not a total of 690 of
//    nothing. This is the whole reason `sumTaken` returns a list.
//
// 2. A purchase whose currency is unknown is neither summed nor dropped.
//    `client_purchases` has no currency column, so the unit of a past purchase
//    lives only in the package it was bought from, and a deleted package leaves
//    an amount with no unit forever. Summed, it corrupts the total with a
//    number in the wrong denomination; dropped, it makes the total quietly
//    short. It is counted separately so the screen can say so.
//
// 3. A membership has no credits, so it has no balance — `null`, not `0`.
//    "0 sessions left" beside a membership reads as a client who has used up
//    everything they paid for, and it is the sentence that would have a coach
//    chasing somebody for money they do not owe.
//
// 4. `sumTaken` does not touch the array it is handed. The payments screen
//    passes the same rows to the summary and to the list beside it, and a sort
//    in place would silently reorder a list the coach is reading.
//
// No formatted date is asserted against a literal: `npm test` runs three times
// under three timezones (`test:zones`), and `monthStart` is a LOCAL boundary,
// so the expectations here are computed with the same helper the code uses.
import { sumTaken, sumRecurring, since, monthStart, packLeft, packRunOut, moneyIn, minorMoney, wholeMoney, type TakenRow, type PackRow } from './coachMoney';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const T = (over: Partial<TakenRow>): TakenRow => ({ amount_cents: 60000, currency: 'aed', created_at: '2026-08-10T09:00:00.000Z', ...over });

/* ── money, in the currency it was actually charged in ────────────────────── */

eq(minorMoney(60000, 'aed'), 'AED 600.00', 'minor units divide by a hundred and the code is spelled out');
eq(minorMoney(60000, 'AED'), 'AED 600.00', 'the currency code is case-insensitive coming in');
eq(minorMoney(50000, 'jpy'), 'JPY 50,000', 'a zero-decimal currency is not divided — ¥50,000 is not ¥500');
eq(minorMoney(1234567, 'gbp'), 'GBP 12,345.67', 'four digits and up carry a thousands separator');
eq(wholeMoney(75, 'aed'), 'AED 75.00', 'a rate somebody typed is already in whole units');
eq(wholeMoney(5000, 'jpy'), 'JPY 5,000', 'a whole-unit zero-decimal amount is left alone too');
eq(wholeMoney(75.5, 'gbp'), 'GBP 75.50', 'a typed rate keeps its half');

// The half that matters in a white-label product. There is no currency this
// code could fall back to that is not wrong for one of the gyms running it.
eq(minorMoney(60000, null), null, 'no currency is not dollars — the amount is withheld');
eq(minorMoney(60000, '  '), null, 'a blank currency is no currency');
eq(minorMoney(null, 'aed'), null, 'no amount is not zero');
eq(minorMoney(0, 'aed'), 'AED 0.00', 'a real zero is a real zero and is still printed');
eq(moneyIn(Number.NaN, 'aed', true), null, 'NaN is not a figure');

/* ── adding up a period ───────────────────────────────────────────────────── */

const mixed = sumTaken([
  T({ amount_cents: 60000, currency: 'aed' }),
  T({ amount_cents: 9000, currency: 'gbp' }),
  T({ amount_cents: 40000, currency: 'aed' }),
]);
eq(mixed.pots.length, 2, 'two currencies make two pots, never one total');
eq(mixed.pots[0].currency, 'AED', 'the bigger pot leads');
eq(mixed.pots[0].minorUnits, 100000, 'same-currency amounts add');
eq(mixed.pots[0].count, 2, 'and the pot says how many purchases it is made of');
eq(mixed.pots[1].currency, 'GBP', 'the smaller pot follows');
eq(minorMoney(mixed.pots[0].minorUnits, mixed.pots[0].currency), 'AED 1,000.00', 'a pot prints in its own currency');

// The hole in the total, counted rather than hidden. A package deleted after
// the sale leaves the amount with no unit anywhere in the database.
const holed = sumTaken([
  T({ amount_cents: 60000, currency: 'aed' }),
  T({ amount_cents: 25000, currency: null }),
  T({ amount_cents: null, currency: 'aed' }),
]);
eq(holed.pots.length, 1, 'an amount with no currency joins no pot');
eq(holed.pots[0].minorUnits, 60000, 'and is not added to another currency');
eq(holed.unlabelled, 1, 'it is counted, so the screen can say the total is short');
eq(holed.unpriced, 1, 'an amount Stripe never stated is counted apart again');

const none = sumTaken([]);
eq(none.pots.length, 0, 'nothing sold is no pots');
eq(none.unlabelled, 0, 'and nothing missing');

// Mutation check: the payments screen hands the same array to the summary and
// to the list rendered beside it.
const rows: TakenRow[] = [T({ amount_cents: 100, currency: 'gbp' }), T({ amount_cents: 900, currency: 'aed' })];
const before = rows.map((r) => r.amount_cents).join(',');
sumTaken(rows);
eq(rows.map((r) => r.amount_cents).join(','), before, 'sumTaken leaves the caller’s array in the order it arrived');
eq(rows.length, 2, 'and does not add or remove rows from it');

/* ── what is priced to recur ──────────────────────────────────────────────── */

const rec = sumRecurring([
  { amount_cents: 60000, currency: 'aed', billing_interval: 'month' },
  { amount_cents: 60000, currency: 'aed', billing_interval: 'month' },
  { amount_cents: 500000, currency: 'aed', billing_interval: 'year' },
  { amount_cents: 9000, currency: 'gbp', billing_interval: 'month' },
]);
eq(rec.pots.length, 3, 'a currency at two intervals is two pots — a year is not twelve months divided');
eq(rec.pots[0].interval, 'year', 'the biggest standing price leads');
const aedMo = rec.pots.find((p) => p.currency === 'AED' && p.interval === 'month');
eq(aedMo?.minorUnits, 120000, 'two AED monthlies add');
eq(aedMo?.count, 2, 'and the pot knows how many subscribers it is');

const recHoled = sumRecurring([
  { amount_cents: 60000, currency: 'aed', billing_interval: null },
  { amount_cents: 60000, currency: null, billing_interval: 'month' },
  { amount_cents: null, currency: 'aed', billing_interval: 'month' },
]);
eq(recHoled.pots.length, 0, 'a price with no period, and a price with no unit, are not prices');
eq(recHoled.unlabelled, 2, 'both are counted rather than assumed');
eq(recHoled.unpriced, 1, 'and an amount Stripe never stated is counted apart');

/* ── periods ──────────────────────────────────────────────────────────────── */

const now = new Date('2026-08-31T12:00:00.000Z');
const start = monthStart(now);
ok(start <= now.getTime(), 'the month starts before now');
eq(monthStart(now), monthStart(new Date(start)), 'the boundary is idempotent — the 1st is in its own month');

const dated: TakenRow[] = [
  T({ created_at: new Date(start + 1000).toISOString(), amount_cents: 1 }),
  T({ created_at: new Date(start - 1000).toISOString(), amount_cents: 2 }),
  T({ created_at: 'not a date', amount_cents: 3 }),
];
const thisMonth = since(dated, start);
eq(thisMonth.length, 1, 'only rows on or after the boundary are in the period');
eq(thisMonth[0].amount_cents, 1, 'and it is the right one');
ok(!thisMonth.some((r) => r.amount_cents === 3), 'a purchase we cannot date is not evidence about this month');
eq(dated.length, 3, 'since() does not consume its input');

/* ── session packs ────────────────────────────────────────────────────────── */

const P = (over: Partial<PackRow>): PackRow => ({ sessions_total: 10, sessions_used: 3, status: 'paid', ...over });

eq(packLeft(P({})), 7, 'a pack of ten with three used has seven left');
eq(packLeft(P({ sessions_total: null })), null, 'a membership has no credits, so it has no balance — null, not 0');
eq(packLeft(P({ sessions_used: 10 })), 0, 'a pack fully drawn down really is zero');
eq(packLeft(P({ sessions_used: 12 })), 0, 'a balance never goes negative, whatever a hand-written refund did');

ok(packRunOut(P({ sessions_used: 10 })), 'a paid pack with nothing left is the row the coach has to act on');
ok(!packRunOut(P({})), 'a pack with credits left is not run out');
ok(!packRunOut(P({ sessions_total: null })), 'a membership never runs out of credits it never had');
ok(!packRunOut(P({ sessions_used: 10, status: 'refunded' })), 'an unpaid pack is not a client to chase');

if (errors.length) { console.error(`coachMoney: ${errors.length} failure(s)\n` + errors.map((e) => '  - ' + e).join('\n')); process.exit(1); }
console.log('coachMoney ok — currencies stay apart, unlabelled amounts stay counted, memberships have no balance');
