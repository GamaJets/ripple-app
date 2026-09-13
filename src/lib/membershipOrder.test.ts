// The order behind a member's own membership. Compile with tsc, run with node.
//
// THE ASSERTION THIS FILE EXISTS FOR is the matching rule. `orderForMembership`
// matches on `membership_id` and nothing else, and the tempting fallback —
// "…or the newest membership order" — is the bug: a member who renewed in March
// and upgraded in June would read June's price under March's membership, and a
// member whose membership was typed in at the desk would be shown a stranger's
// Stripe charge as the thing that bought it. Two of the blocks below are that
// one mistake, refused.
//
// THE SECOND is currency. `gym_orders.currency` is NOT NULL in the schema and
// is still handled as nullable here, because this product is white-label and
// there is no house currency for a blank to become. Nothing in this module sums
// two orders.
//
// THE THIRD is a failed read. An unread list of orders is not a membership
// nobody paid for, and `orderAbsence(false)` must not borrow the sentence
// written for a membership recorded at the desk.
import {
  fetchMyOrders, orderForMembership, intentLabel, orderAmount,
  orderStatusLine, orderAbsence, type MemberOrder,
} from './membershipOrder';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const order = (over: Partial<MemberOrder> = {}): MemberOrder => ({
  id: 'o1',
  kind: 'membership',
  intent: 'new',
  status: 'paid',
  amountCents: 4500,
  currency: 'GBP',
  termStartsOn: '2026-01-01',
  termEndsOn: '2026-12-31',
  membershipId: 'm1',
  paidAt: '2026-01-01T09:00:00.000Z',
  createdAt: '2026-01-01T08:59:00.000Z',
  ...over,
});

/* ── 1 · the matching rule, and the fallback that must not exist ─────────── */

const march = order({ id: 'march', membershipId: 'm-march', amountCents: 4500, createdAt: '2026-03-01T00:00:00.000Z' });
const june = order({ id: 'june', membershipId: 'm-june', intent: 'upgrade', amountCents: 9900, createdAt: '2026-06-01T00:00:00.000Z' });
const book = [june, march];

eq(orderForMembership(book, 'm-march')?.id, 'march', 'a membership gets the order that produced it');
eq(orderForMembership(book, 'm-june')?.id, 'june', 'and so does the other one');
eq(orderForMembership(book, 'm-desk'), null,
  'a membership no order produced gets NO order — never the newest one, which is somebody else’s price under its dates');
eq(orderForMembership(book, null), null, 'and a membership with no id matches nothing');
eq(orderForMembership([], 'm-march'), null, 'an empty book matches nothing');

// A pass order carrying a membership_id is a row the schema's own constraints
// should make impossible. If one ever appears it is refused rather than drawn.
eq(orderForMembership([order({ kind: 'pass', membershipId: 'm1' })], 'm1'), null,
  'a pass order is never the thing that bought a membership');

/* ── 2 · money, in the currency recorded and no other ────────────────────── */

ok(orderAmount(order({ amountCents: 4500, currency: 'GBP' })).includes('45'),
  'a recorded currency prints as money');
{
  const noCurrency = orderAmount(order({ currency: null }));
  ok(/not recorded/.test(noCurrency),
    'an order with no currency says so rather than being drawn in a currency nobody chose');
  ok(!/[£$€]/.test(noCurrency), 'and no symbol is invented for it');
}
eq(orderAmount(order({ amountCents: 0, currency: 'AED' })).length > 0, true,
  'a zero-priced order is still an amount — free is a price somebody agreed');

/* ── 3 · four statuses, four sentences, and no engineer-facing prose ─────── */

{
  const lines = (['paid', 'pending', 'abandoned', 'failed'] as const).map((s) => orderStatusLine({ status: s }));
  eq(new Set(lines).size, 4, 'the four states read as four different sentences');
  ok(/not completed|nobody was charged/.test(lines[2]), 'an abandoned checkout says nobody was charged');
  ok(/reception/.test(lines[3]), 'a failed one sends the member to a person');
  ok(!/webhook|entitlement|Stripe session|null/i.test(lines.join(' ')),
    'and none of them leaks the schema’s own vocabulary at the member');
  ok(!/failed/i.test(lines[1]),
    'a pending checkout is not reported as a failure — that is a claim about somebody’s money');
}

/* ── 4 · the three intents are three different things ────────────────────── */

eq(intentLabel({ intent: 'new' }), 'New membership', 'a first purchase');
eq(intentLabel({ intent: 'renew' }), 'Renewal', 'an extension of the one they hold');
eq(intentLabel({ intent: 'upgrade' }), 'Upgrade', 'and a move that supersedes it');

/* ── 5 · no order is not the same fact as no read ────────────────────────── */

ok(/desk/.test(orderAbsence(true)),
  'a membership with no order is one the gym recorded at the desk, which is ordinary');
ok(/read that failed/.test(orderAbsence(false)),
  'and an unread list says the read failed');
ok(orderAbsence(true) !== orderAbsence(false),
  'the two are never the same sentence — this is the whole of src/ui/loadStatus.ts in one line');

/* ── 6 · the read: a refusal is never an empty list ──────────────────────── */

const sbErr = {
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: async () => ({ data: null, error: { message: 'permission denied for table gym_orders' } }),
        }),
      }),
    }),
  }),
};
const sbOk = (rows: any[]) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({ limit: async () => ({ data: rows, error: null }) }),
      }),
    }),
  }),
});

void (async () => {
  const refused = await fetchMyOrders(sbErr as any, 'me');
  eq(refused.ok, false, 'a refused read is not ok');
  ok(!refused.ok && /permission denied/.test(refused.reason), 'and carries why');

  const none = await fetchMyOrders(sbOk([]) as any, 'me');
  eq(none.ok, true, 'a read that landed with nothing is ok');
  ok(none.ok && none.value.length === 0, 'with an empty list, which means genuinely none');

  const signedOut = await fetchMyOrders(sbOk([]) as any, '');
  eq(signedOut.ok, false, 'no uid is a failure, not an empty purchase history');

  const one = await fetchMyOrders(sbOk([{
    id: 'x', kind: 'membership', intent: 'renew', status: 'paid',
    amount_cents: '9900', currency: ' aed ', term_starts_on: '2026-02-01',
    term_ends_on: null, membership_id: 'm9', paid_at: null,
    created_at: '2026-02-01T00:00:00.000Z',
  }]) as any, 'me');
  ok(one.ok, 'a row comes back');
  if (one.ok) {
    const r = one.value[0];
    eq(r.amountCents, 9900, 'the amount is a number even when PostgREST hands back a string');
    // …and an ABSENT amount stays absent. `Number(null)` is 0, and a 0 here is
    // drawn on the member's own Membership screen as a purchase of "AED 0.00".
    ok(orderAmount({ amountCents: r.amountCents, currency: 'AED' }).includes('99'),
      'a real amount still prints');
    eq(r.currency, ' aed ', 'the currency is carried as recorded, not normalised into a guess');
    eq(r.termEndsOn, null, 'an open-ended term is null and not today');
    eq(r.paidAt, null, 'and an unpaid order has no paid-at rather than a falsy date');
    eq(r.intent, 'renew', 'the intent is read');
  }

  // A status the app has never heard of must not become 'paid'.
  const odd = await fetchMyOrders(sbOk([{
    id: 'y', kind: 'membership', intent: 'sideways', status: 'chargeback',
    amount_cents: 1, currency: 'GBP', membership_id: 'm1', created_at: '2026-01-01T00:00:00.000Z',
  }]) as any, 'me');
  if (odd.ok) {
    eq(odd.value[0].status, 'pending', 'an unknown status falls back to the state that claims nothing');
    eq(odd.value[0].intent, 'new', 'and an unknown intent to the one that supersedes nothing');
  }

  /* ── an amount that did not come back is not an amount of nothing ───────── */
  {
    const blank = await fetchMyOrders(sbOk([{
      id: 'z', kind: 'membership', intent: 'new', status: 'paid',
      amount_cents: null, currency: 'AED', membership_id: 'm2',
      created_at: '2026-04-01T00:00:00.000Z',
    }]) as any, 'me');
    if (blank.ok) {
      const r = blank.value[0];
      eq(r.amountCents, null, 'Number(null) is 0 and 0 is a price somebody could have paid');
      ok(!/0\.00/.test(orderAmount(r)),
        'so the member is never shown a purchase of AED 0.00 for a figure nobody recorded');
      eq(orderAmount(r), '—', 'a dash is the only honest thing to put where the figure goes');
    } else {
      errors.push('a row with no amount should still be a row that came back');
    }
  }

  if (errors.length) {
    console.error(`membershipOrder: ${errors.length} failure(s)`);
    for (const e of errors) console.error(' · ' + e);
    process.exit(1);
  }
  console.log('membershipOrder: ok');
})();
