// Tests for priceBook — the list price against what is actually billed, and
// how long a price has sat still.
//
// What is being pinned, in the order it would hurt:
//
//   · TWO CURRENCIES ARE NEVER SUBTRACTED. A membership billed in EUR against a
//     plan priced in GBP is its own state, both codes are named, and `diffCents`
//     is null. A gym that changed its base currency has both in its books.
//   · A MEMBER WHOSE PRICE CANNOT BE READ IS NOT ON THE LIST PRICE. Six
//     silences, each its own state, none of them ever counted as 'on-list'.
//   · A TRUNCATED INVOICE READ PLACES NOBODY. 'partial' is not 'ready', and the
//     bill that would place a member may be one of the rows that did not come.
//   · AN UNDATED PRICE IS NEVER "UNCHANGED FOR A YEAR". The column
//     supabase/parts/2880 adds does not exist until it is applied, and inferring
//     the answer from anything else would flag every plan in every gym.
//
// Compile with tsc, run with node.
import {
  priceRows, summarisePrices, driftLine, otherCurrencyNote,
  priceAges, priceAgeLine, A_YEAR_DAYS,
  PRICE_STATE_LABEL, PRICE_STATE_MEANS, WHY_PRICE_AGE_IS_UNKNOWN,
  type PriceRow, type PriceState, type PricedPlan,
} from './priceBook';
import { sliceReady, sliceFailed, slicePartial, sliceLoading } from './memberView';
import type { Membership } from './gymRecord';
import type { GymInvoiceRow } from './gymInvoices';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-13T10:00:00Z');

const plan = (over: Partial<PricedPlan> = {}): PricedPlan => ({
  id: 'p1', name: 'Gold', priceCents: 6000, currency: 'GBP',
  interval: 'month', active: true, priceChangedAt: null, ...over,
});

const member = (over: Partial<Membership> = {}): Membership => ({
  id: 'm1', memberId: 'u1', memberName: 'Ada', planId: 'p1', planName: 'Gold',
  startedOn: '2026-01-01', endsOn: null, status: 'active',
  frozenFrom: null, frozenTo: null, ...over,
});

const bill = (over: Partial<GymInvoiceRow> = {}): GymInvoiceRow => ({
  id: 'i1', number: 1, memberId: 'u1', memberName: 'Ada', membershipId: 'm1',
  amountCents: 6000, currency: 'GBP', issuedOn: '2026-09-01', dueOn: null,
  status: 'open', note: null, ...over,
});

const rowsFor = (
  ms: Membership[], ps: PricedPlan[], bs: GymInvoiceRow[],
): PriceRow[] => priceRows({
  memberships: sliceReady(ms), plans: sliceReady(ps), invoices: sliceReady(bs),
}) ?? [];

const oneState = (ms: Membership[], ps: PricedPlan[], bs: GymInvoiceRow[]): PriceState | null =>
  rowsFor(ms, ps, bs)[0]?.state ?? null;

/* ── the comparison, where there is one ───────────────────────────────────── */
{
  eq(oneState([member()], [plan()], [bill()]), 'on-list', 'the same figure in the same currency is on the list price');
  eq(oneState([member()], [plan()], [bill({ amountCents: 4500 })]), 'below-list', 'a legacy rate is under it');
  eq(oneState([member()], [plan()], [bill({ amountCents: 7500 })]), 'above-list', 'and a rate the book never caught up with is over it');

  eq(rowsFor([member()], [plan()], [bill({ amountCents: 4500 })])[0].diffCents, -1500,
    'the difference is signed, in minor units of the one currency both sides are in');
  eq(rowsFor([member()], [plan()], [bill()])[0].diffCents, 0,
    'and it is zero rather than null where they genuinely match');
}

/* ── two currencies are named and never subtracted ────────────────────────── */
{
  const rows = rowsFor([member()], [plan({ currency: 'GBP' })], [bill({ currency: 'EUR' })]);
  eq(rows[0].state, 'other-currency', 'a bill in another currency is its own state');
  eq(rows[0].diffCents, null, 'and nothing is subtracted across it');
  const note = otherCurrencyNote(rows[0]) ?? '';
  ok(note.includes('EUR') && note.includes('GBP'), 'the sentence names both currencies');
  ok(note.includes('no exchange rate'), 'and says why neither is converted into the other');
  eq(otherCurrencyNote(rowsFor([member()], [plan()], [bill()])[0]), null,
    'and it is null on a row where it would not be true');

  // Case and padding are not a currency difference. This would otherwise read
  // as drift on every gym whose rows were typed by two different people.
  eq(oneState([member()], [plan({ currency: ' gbp ' })], [bill({ currency: 'GBP' })]), 'on-list',
    'the same currency written two ways is one currency');
  // An empty string is NOT a currency and must not compare equal to another one.
  eq(oneState([member()], [plan({ currency: '' })], [bill({ currency: '' })]), 'amount-unstated',
    'two blanks are not a matching currency');
}

/* ── the six silences, none of them folded into on-list ───────────────────── */
{
  eq(oneState([member()], [plan()], []), 'not-billed',
    'a membership nobody has ever billed says nothing about its price');
  eq(oneState([member()], [plan()], [bill({ amountCents: null })]), 'amount-unstated',
    'a bill with no amount on it cannot be compared to anything');
  eq(oneState([member({ planId: null, planName: null })], [plan()], [bill()]), 'no-plan',
    'a membership carrying no plan has no list price to be on');
  eq(oneState([member({ planId: 'gone' })], [plan()], [bill()]), 'plan-unread',
    'and one pointing at a plan that is not in the book is not on the list price either');

  eq(priceRows({
    memberships: sliceReady([member()]),
    plans: sliceFailed('the price book was refused'),
    invoices: sliceReady([bill()]),
  })?.[0].state, 'plan-unread', 'a failed price book places nobody');

  eq(priceRows({
    memberships: sliceReady([member()]),
    plans: sliceReady([plan()]),
    invoices: sliceFailed('the invoices were refused'),
  })?.[0].state, 'bills-unread', 'and neither does a failed invoice read');

  // The flattering error: a prefix of the invoices would leave a member with no
  // bill, which is 'not-billed', which reads as a gym with nothing to chase.
  eq(priceRows({
    memberships: sliceReady([member()]),
    plans: sliceReady([plan()]),
    invoices: slicePartial([], 1000),
  })?.[0].state, 'bills-unread', 'a truncated invoice read is not an empty one');

  // A draft has been issued to nobody and a void one was withdrawn.
  eq(oneState([member()], [plan()], [bill({ status: 'draft' })]), 'not-billed',
    'a draft is not a bill');
  eq(oneState([member()], [plan()], [bill({ status: 'void' })]), 'not-billed',
    'and neither is one that was voided');
  eq(oneState([member()], [plan()], [bill({ status: 'something-later' })]), 'on-list',
    'a status this build does not know is still a row somebody raised, and is left in');
}

/* ── which membership, and which bill ─────────────────────────────────────── */
{
  const rows = rowsFor(
    [member({ id: 'm1' }), member({ id: 'm2', status: 'cancelled' }), member({ id: 'm3', status: 'frozen' })],
    [plan()],
    [bill({ id: 'i1', membershipId: 'm1' })],
  );
  eq(rows.length, 2, 'cancelled memberships are history; frozen ones are paused and still priced');

  // Latest by day, and the day is a bare YYYY-MM-DD compared as a string.
  const two = rowsFor([member()], [plan()], [
    bill({ id: 'i1', issuedOn: '2026-08-01', amountCents: 4500 }),
    bill({ id: 'i2', issuedOn: '2026-09-01', amountCents: 6000 }),
  ]);
  eq(two[0].state, 'on-list', 'the latest bill is the one this member is being asked for');
  eq(two[0].billedOn, '2026-09-01', 'and the day it was issued is carried as written');

  // A whole book raised in one run ties on the day; the id breaks it, so the
  // answer is at least stable rather than whichever row arrived first.
  const tied = rowsFor([member()], [plan()], [
    bill({ id: 'ia', issuedOn: '2026-09-01', amountCents: 4500 }),
    bill({ id: 'ib', issuedOn: '2026-09-01', amountCents: 6000 }),
  ]);
  eq(tied[0].billedCents, 6000, 'a tie on the day is broken by the id, the same way every time');

  // A bill with no membership on it belongs to no membership here. Attaching it
  // to the member's other contract would compare a pass against a plan.
  eq(oneState([member()], [plan()], [bill({ membershipId: null })]), 'not-billed',
    'an invoice raised against no membership does not price one');
}

/* ── no roster, no table ──────────────────────────────────────────────────── */
{
  eq(priceRows({
    memberships: sliceFailed('refused'), plans: sliceReady([plan()]), invoices: sliceReady([]),
  }), null, 'with no roster there is no row to draw per member');
  eq(priceRows({
    memberships: slicePartial([member()], 1000), plans: sliceReady([plan()]), invoices: sliceReady([]),
  }), null, 'and a prefix of the roster is a drift report with members missing from it');
}

/* ── the summary, and the denominator that has to go with it ──────────────── */
{
  const rows = rowsFor(
    [member({ id: 'm1' }), member({ id: 'm2', memberId: 'u2' }), member({ id: 'm3', memberId: 'u3' })],
    [plan()],
    [
      bill({ id: 'i1', membershipId: 'm1', amountCents: 6000 }),
      bill({ id: 'i2', membershipId: 'm2', amountCents: 4500 }),
    ],
  );
  const d = summarisePrices(rows);
  eq(d.placed, 2, 'two memberships were actually compared');
  eq(d.offList, 1, 'one of them is not on the list price');
  eq(d.unplaced, 1, 'and the third is unplaced rather than compliant');
  eq(d.counts['not-billed'], 1, 'counted under the silence it actually is');

  ok(driftLine(d, rows.length).includes('Of 3 live memberships'),
    'the headline carries the denominator, because the numerator alone gets quoted');
  ok(driftLine(d, rows.length).includes('could not be placed'),
    'and it says how many it could not place');
  ok(driftLine(summarisePrices([]), 0).includes('No live membership'),
    'an empty gym is said plainly rather than reported as fully compliant');

  const noneKnown = summarisePrices(rowsFor([member()], [plan()], []));
  ok(driftLine(noneKnown, 1).includes('nothing here says anybody is on the list price'),
    'a gym that raises no invoices is told that, not that everybody is on the list price');
}

/* ── the labels ───────────────────────────────────────────────────────────── */
{
  const states: PriceState[] = [
    'on-list', 'below-list', 'above-list', 'other-currency', 'not-billed',
    'amount-unstated', 'bills-unread', 'no-plan', 'plan-unread',
  ];
  for (const s of states) {
    ok(PRICE_STATE_LABEL[s].length > 0, `${s} has a label`);
    ok(PRICE_STATE_MEANS[s].length > 20, `${s} says what it means`);
  }
  ok(PRICE_STATE_MEANS['not-billed'].includes('not the list price'),
    'the silence that would most easily be read as compliance says out loud that it is not');
}

/* ── how long a price has sat still ───────────────────────────────────────── */
{
  const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

  // The state of the world until supabase/parts/2880 is applied.
  const noColumn = priceAges(sliceReady([plan()]), 'no-column', NOW) ?? [];
  eq(noColumn[0].state, 'cannot-tell', 'with no column there is no answer');
  eq(noColumn[0].why, 'no-column', 'and the reason is which of the four silences it is');
  ok(WHY_PRICE_AGE_IS_UNKNOWN['no-column'].includes('2880'),
    'the sentence names the part that would answer it');
  ok(!priceAgeLine(noColumn).includes('0 of'),
    'the headline does not report a count of stale prices it did not measure');
  ok(priceAgeLine(noColumn).includes('not saying they have all stayed still'),
    'it says what the silence is not');

  // Applied, and the row predates it.
  const never = priceAges(sliceReady([plan()]), 'recorded', NOW) ?? [];
  eq(never[0].why, 'never-stamped', 'a plan older than the stamp is undated, not unchanged');
  eq(never[0].state, 'cannot-tell', 'which is never the same answer as "not moved in a year"');

  const aged = priceAges(sliceReady([
    plan({ id: 'p1', name: 'Gold', priceChangedAt: iso(A_YEAR_DAYS) }),
    plan({ id: 'p2', name: 'Silver', priceChangedAt: iso(30) }),
    plan({ id: 'p3', name: 'Off Sale', active: false, priceChangedAt: iso(900) }),
    plan({ id: 'p4', name: 'Broken', priceChangedAt: 'not a date' }),
  ]), 'recorded', NOW) ?? [];
  eq(aged.length, 3, 'a retired plan is not a price anybody is being sold');
  eq(aged.find((a) => a.planId === 'p1')?.state, 'stale', 'exactly a year counts as not having moved');
  eq(aged.find((a) => a.planId === 'p1')?.days, A_YEAR_DAYS, 'and the age is stated in days');
  eq(aged.find((a) => a.planId === 'p2')?.state, 'moved', 'a price changed last month has moved');
  eq(aged.find((a) => a.planId === 'p4')?.why, 'bad-stamp',
    'an unreadable stamp is undated rather than a very old date');

  ok(priceAgeLine(aged).includes('1 of the 2 datable'),
    'the headline counts only what it could date, and says so');

  eq(priceAges(sliceFailed('refused'), 'recorded', NOW), null, 'a failed price book has no ages');
  eq(priceAges(slicePartial([plan()], 1000), 'recorded', NOW), null, 'and neither has a prefix of one');
  eq(priceAges(sliceLoading(), null, NOW), null, 'nor one still in flight');
  eq((priceAges(sliceReady([plan()]), null, NOW) ?? [])[0].why, 'unreadable',
    'a price book read that never reported its stamp support is unreadable, not uncolumned');
  ok(priceAgeLine([]).includes('No plan is on sale'), 'and no plans at all is said plainly');
}

if (errors.length) {
  console.error(`priceBook: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('priceBook ok');
