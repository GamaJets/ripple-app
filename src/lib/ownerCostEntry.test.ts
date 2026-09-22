// Tests for ownerCostEntry — capturing a cost at the counter it was paid at.
//
// What is pinned here:
//
//   · the console's gate is the phone's gate. `gymCostBlockers` runs unedited,
//     so a row the console would refuse cannot be recorded from a phone;
//   · a day inside a CLOSED month is refused before the write, because part
//     182's trigger will refuse it after — but only when the record of closes
//     was actually read. A failed read does not take the feature away;
//   · the day offered is the GYM's day, and when it cannot be it says so rather
//     than passing the phone's calendar off as the gym's;
//   · and a write is not believed. The row is looked for in the list read back,
//     matched on what makes it that claim rather than on an id the insert never
//     returned.
//
// Compile with tsc, run with node.
import {
  costEntryBlockers, defaultPaidOn, findRecordedCost,
} from './ownerCostEntry';
import type { GymCost, GymCostDraft } from './gymCosts';
import type { MonthCloseRow } from './gymClose';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const draft = (over: Partial<GymCostDraft> = {}): GymCostDraft => ({
  description: 'Hygiene supplies',
  supplier: 'Cash and carry',
  amountText: '42.50',
  currency: 'GBP',
  category: 'maintenance',
  paidOn: '2026-09-11',
  ...over,
});

const filed = (over: Partial<MonthCloseRow> = {}): MonthCloseRow => ({
  id: 'c1', monthKey: '2026-08', closedAt: '2026-09-02T09:00:00.000Z',
  closedBy: 'owner', closedByName: 'Dana', note: null,
  takenCents: null, invoicedCents: null, outstandingCents: null, payrollCents: null,
  takenCurrency: null, invoicedCurrency: null, outstandingCurrency: null, payrollCurrency: null,
  currency: null, unmarkedSessions: null, blockersAtClose: null,
  reopenedAt: null, reopenedBy: null, reopenedByName: null, reopenReason: null,
  ...over,
});

const CLOSES = (rows: MonthCloseRow[]) => ({ status: 'ready' as LoadStatus, rows });
const UNREAD = { status: 'error' as LoadStatus, rows: null };

/* ── the console's gate is the phone's gate ───────────────────────────────── */
{
  eq(costEntryBlockers(draft(), CLOSES([])).length, 0, 'a complete cost in an open month may be recorded');

  ok(costEntryBlockers(draft({ description: '   ' }), CLOSES([])).length > 0,
    'an amount with nothing beside it is refused here exactly as it is on the console');
  ok(costEntryBlockers(draft({ currency: null }), CLOSES([])).length > 0,
    'a gym with no currency has nothing to record an amount in, and none is invented');
  ok(costEntryBlockers(draft({ amountText: '0' }), CLOSES([])).length > 0,
    'a cost of nothing is a statement that the supplier was free');
  ok(costEntryBlockers(draft({ paidOn: 'yesterday' }), CLOSES([])).length > 0,
    'a day that is not one cannot be filed into a month');

  const many = costEntryBlockers(draft({ description: '', amountText: 'x' }), CLOSES([]));
  ok(many.length >= 2, 'every reason at once, not the first — three empty fields are one trip back to the form');
}

/* ── a locked month, and the read that could not say ──────────────────────── */
{
  const intoAugust = draft({ paidOn: '2026-08-29' });
  const blocked = costEntryBlockers(intoAugust, CLOSES([filed()]));
  ok(blocked.some((b) => b.includes('closed')),
    'a cost dated into a signed-off month is refused before the write, not after it by a P0001');

  eq(costEntryBlockers(intoAugust, CLOSES([filed({ reopenedAt: '2026-09-06T08:00:00.000Z' })])).length, 0,
    'a month that was reopened takes the cost — that is what reopening it was for');

  eq(costEntryBlockers(intoAugust, UNREAD).length, 0,
    'a record of closes that could not be read does NOT take the feature away: the database is the backstop');
  eq(costEntryBlockers(intoAugust, { status: 'partial', rows: [filed()] }).length, 0,
    'and a prefix of that history is not the history — it is not consulted at all');

  eq(costEntryBlockers(draft({ paidOn: '2026-09-11' }), CLOSES([filed()])).length, 0,
    'a September cost is unaffected by August being filed');
}

/* ── whose day the form opens on ──────────────────────────────────────────── */
{
  // 23:30 in London on the 13th is already the 14th in Dubai, which is the day
  // a Dubai gym's owner is standing in when they pay for something.
  const at = Date.parse('2026-09-13T19:30:00.000Z');
  const dubai = defaultPaidOn('Asia/Dubai', at);
  eq(dubai.day, '2026-09-13', 'the gym’s own calendar day');
  eq(dubai.atGym, true, 'and it says it is the gym’s');

  const late = defaultPaidOn('Asia/Dubai', Date.parse('2026-09-13T20:30:00.000Z'));
  eq(late.day, '2026-09-14', 'past midnight at the gym it is the next day there, whatever the phone says');

  const noZone = defaultPaidOn(null, at);
  eq(noZone.atGym, false, 'with no zone recorded the day is the reader’s, and the flag says so');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(noZone.day), 'and it is still a day');

  const nonsense = defaultPaidOn('Middle/Earth', at);
  eq(nonsense.atGym, false, 'a zone this runtime cannot resolve is not the gym’s clock either');
}

/* ── a write is not believed until the row is found ───────────────────────── */
{
  const row = (over: Partial<GymCost> = {}): GymCost => ({
    id: 'g1', description: 'Hygiene supplies', supplier: 'Cash and carry',
    category: 'maintenance', amountCents: 4250, currency: 'GBP',
    paidOn: '2026-09-11', note: null, createdAt: null, ...over,
  });
  const want = { description: 'Hygiene supplies', amountCents: 4250, currency: 'GBP', paidOn: '2026-09-11' };

  eq(findRecordedCost([row()], want)?.id, 'g1', 'the row that landed is found');
  eq(findRecordedCost([row({ description: '  Hygiene supplies  ' })], want)?.id, 'g1',
    'trimmed the same way the insert trims it, or every write would read as unconfirmed');
  eq(findRecordedCost([row()], { ...want, currency: 'gbp' })?.id, 'g1', 'and the currency is compared folded');

  eq(findRecordedCost([], want), null, 'an empty list is not a confirmation');
  eq(findRecordedCost(null, want), null, 'and neither is a list that could not be read');
  eq(findRecordedCost([row({ amountCents: 4251 })], want), null,
    'a row that differs by a penny is a different claim and does not confirm this one');
  eq(findRecordedCost([row({ paidOn: '2026-09-10' })], want), null,
    'nor does the same amount on another day — which is the month boundary this all turns on');
}

if (errors.length) {
  console.error(`ownerCostEntry: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('ownerCostEntry ok');
