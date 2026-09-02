// A member paid and the gym has no list to look at.
// Compile with tsc, run with node.
//
// `gym_orders` is written by the checkout function and updated by the Stripe
// webhook, and the only reader in the product was scoped to the BUYER. The gym
// took card money through its own Stripe account and had no order list at all
// — no way to see what sold, nothing to reconcile against the payout, and no
// answer at the desk to "did my payment go through".
//
//   TROUBLE      the rows somebody has to act on, and why each is separate
//   CURRENCY     two currencies never sum, and a row with none is not money
//   COUNTS       every status shows, including one this code never heard of
//   LINE         what one order says it is
import {
  orderLine, orderTrouble, paidPots, countByStatus,
  PENDING_STALE_MS, ORDER_STATUS_LABEL, type GymOrderRow,
} from './gymOrders';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

// Spread over the defaults rather than `over.x ?? default` field by field.
// The `??` form cannot express "this one is deliberately null", and the row
// this suite most needs — a paid order with NO membership behind it — is
// exactly that. Written the other way it silently got a membership back and
// the assertion failed against a lib that was right.
const BASE: Omit<GymOrderRow, 'id'> = {
  memberId: 'm1',
  memberName: 'Ada',
  kind: 'membership',
  intent: 'new',
  status: 'paid',
  amountCents: 5000,
  currency: 'GBP',
  planId: 'p1',
  passTypeId: null,
  termStartsOn: null,
  termEndsOn: null,
  usesTotal: null,
  expiresOn: null,
  membershipId: 'ms1',
  passId: null,
  createdAt: iso(60_000),
  paidAt: null,
};

function order(over: Partial<GymOrderRow> & { id: string }): GymOrderRow {
  return { ...BASE, ...over };
}

/* ── TROUBLE ──────────────────────────────────────────────────────────────
 * Part 281: 'failed' is "Stripe took the money and the entitlement could not
 * be written… a paid member with nothing to show for it". It was recorded and
 * nothing in the product ever looked at it.
 */
{
  const rows: GymOrderRow[] = [
    order({ id: 'ok', status: 'paid' }),
    order({ id: 'bad', status: 'failed', membershipId: null }),
    order({ id: 'quiet', status: 'paid', membershipId: null, passId: null }),
    order({ id: 'fresh', status: 'pending', membershipId: null, createdAt: iso(60 * 60 * 1000) }),
    order({ id: 'stuck', status: 'pending', membershipId: null, createdAt: iso(PENDING_STALE_MS) }),
    order({ id: 'gone', status: 'abandoned', membershipId: null }),
  ];
  const tr = orderTrouble(rows, NOW);

  eq(tr.failed.map((o) => o.id).join(','), 'bad', 'a failed order is money taken with nothing granted');
  eq(tr.paidWithNothing.map((o) => o.id).join(','), 'quiet',
    'and so is a "paid" row with neither a membership nor a pass behind it — the same harm, recorded by a row that does not say so');
  eq(tr.stuck.map((o) => o.id).join(','), 'stuck',
    'a pending order older than a Stripe session can be is a webhook that never arrived');
  ok(!tr.stuck.some((o) => o.id === 'fresh'),
    'an hour-old pending order is a customer deciding, not a fault');
  ok(!tr.failed.some((o) => o.id === 'gone') && !tr.stuck.some((o) => o.id === 'gone'),
    'abandoned is nobody charged and nothing to do');

  eq(orderTrouble(rows, NOW).failed.length + orderTrouble(rows, NOW).stuck.length + orderTrouble(rows, NOW).paidWithNothing.length, 3,
    'three rows need a person, out of six');

  const unparseable = orderTrouble([order({ id: 'x', status: 'pending', membershipId: null, createdAt: 'not a date' })], NOW);
  eq(unparseable.stuck.length, 0,
    'an unreadable timestamp is not evidence of age — it must not become a permanent false alarm');

  eq(ORDER_STATUS_LABEL.failed, 'Paid, not granted',
    'the label says what happened, not "failed", which reads as a declined card');
}

/* ── CURRENCY ─────────────────────────────────────────────────────────────
 * A figure blended across two currencies is not a bigger number.
 */
{
  const pots = paidPots([
    order({ id: 'a', currency: 'GBP', amountCents: 5000 }),
    order({ id: 'b', currency: 'GBP', amountCents: 2500 }),
    order({ id: 'c', currency: 'AED', amountCents: 30000 }),
    order({ id: 'd', currency: 'GBP', amountCents: 9999, status: 'pending' }),
    order({ id: 'e', currency: 'GBP', amountCents: 9999, status: 'failed' }),
    order({ id: 'f', currency: '   ', amountCents: 1000 }),
    order({ id: 'g', currency: 'GBP', amountCents: Number.NaN }),
  ]);

  eq(pots.length, 2, 'two currencies are two pots, never one total');
  eq(pots[0].currency, 'AED', 'ordered by size — AED 300.00 leads GBP 75.00 by minor units, which is what the pot holds');
  eq(pots[0].cents, 30000, 'the dirham pot is its own rows and nobody else’s');
  const gbp = pots.find((p) => p.currency === 'GBP')!;
  eq(gbp.cents, 7500, 'only paid rows count — pending is money nobody has taken');
  eq(gbp.count, 2, 'and the count agrees with the sum it came from');
  ok(!pots.some((p) => p.currency.trim() === ''),
    'a row with no currency is not money that can be added to money');
  ok(gbp.cents === 7500,
    'a NaN amount does not poison the pot it landed in');
}

/* ── COUNTS ───────────────────────────────────────────────────────────────
 * A status this code has never heard of is a row somebody has to look at, not
 * a row to drop out of a total.
 */
{
  const by = countByStatus([
    order({ id: 'a', status: 'paid' }),
    order({ id: 'b', status: 'paid' }),
    order({ id: 'c', status: 'pending' }),
    { ...order({ id: 'd' }), status: 'refunded' as any },
  ]);
  eq(by.length, 3, 'three distinct statuses, including the one that is not in the type');
  eq(by[0][0], 'paid', 'largest first');
  eq(by[0][1], 2, 'and counted');
  ok(by.some(([k]) => k === 'refunded'),
    'an unrecognised status shows up rather than being silently excluded');
  eq(by.reduce((a, [, n]) => a + n, 0), 4, 'and the counts add up to the rows they came from');
}

/* ── LINE ─────────────────────────────────────────────────────────────────── */
{
  eq(orderLine({ kind: 'membership', intent: 'new' }), 'Membership · new', 'a first membership');
  eq(orderLine({ kind: 'membership', intent: 'renew' }), 'Membership · renewal', 'an extension of the plan they are on');
  eq(orderLine({ kind: 'membership', intent: 'upgrade' }), 'Membership · upgrade', 'a move to a different plan');
  eq(orderLine({ kind: 'pass', intent: 'new' }), 'Pass',
    'a pass supersedes nothing, so its intent is never worth printing');
}

if (errors.length) {
  console.error(`gymOrders: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('gymOrders: all assertions passed');
