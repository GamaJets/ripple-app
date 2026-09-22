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
  orderLine, orderTrouble, paidPots, unspellablePaid, countByStatus,
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

/* ── CURRENCY · one money is one pot ──────────────────────────────────────
 *
 * `paidPots` keyed on `(o.currency ?? '').trim()` — trimmed, and never
 * upper-cased. `gym_orders.currency` is `not null` with NO format check of any
 * kind, so a gym whose rows were imported or hand-written holds both 'gbp' and
 * 'GBP', and they became TWO POTS AND TWO TILES for one money: the same money
 * shown twice, each figure short of the truth, on the screen the front desk
 * answers "did my payment go through" from.
 */
{
  const pots = paidPots([
    order({ id: 'a', currency: 'GBP', amountCents: 5000 }),
    order({ id: 'b', currency: 'gbp', amountCents: 2500 }),
    order({ id: 'c', currency: ' GBP ', amountCents: 1000 }),
  ]);
  eq(pots.length, 1, 'THE DEFECT: case and spacing are one currency, not three');
  eq(pots[0].currency, 'GBP', 'and the pot is labelled with the code, upper-cased');
  eq(pots[0].cents, 8500, 'with every row in it');
  eq(pots[0].count, 3, 'and a count that agrees with the sum');
}

/* ── CURRENCY · a non-code is not a currency ──────────────────────────────
 *
 * `'pounds'` satisfies `not null` and passed the old `trim()` untouched, so it
 * became a pot labelled "pounds" with real money in it. Now it reaches no pot —
 * and `unspellablePaid` is what stops that being a silent shortfall.
 */
{
  const rows = [
    order({ id: 'a', currency: 'GBP', amountCents: 5000 }),
    order({ id: 'b', currency: 'pounds', amountCents: 2500 }),
    order({ id: 'c', currency: 'GB', amountCents: 1500 }),
    order({ id: 'd', currency: '', amountCents: 1000 }),
    order({ id: 'e', currency: '   ', amountCents: 700 }),
    order({ id: 'f', currency: 'GBP', amountCents: Number.NaN }),
    order({ id: 'g', currency: 'pounds', amountCents: 9999, status: 'pending' }),
  ];
  const pots = paidPots(rows);
  eq(pots.length, 1, 'THE DEFECT: `pounds` is not a currency and gets no pot of its own');
  eq(pots[0].currency, 'GBP', 'the one real money is the one pot');
  eq(pots[0].cents, 5000, 'holding only the row that states a currency and a finite amount');

  const missed = unspellablePaid(rows);
  eq(missed.notACode, 2, 'both `pounds` and `GB` are counted as columns holding a non-code');
  eq(missed.unstated, 2, 'and the blank and the all-spaces rows as columns holding nothing');
  eq(missed.notAnAmount, 1, 'and the NaN row as an amount rather than a currency fault');
  eq(missed.orders, 5, 'five paid orders reached no pot, and the screen can say so');
  ok(missed.orders + pots.reduce((a, p) => a + p.count, 0)
     === rows.filter((r) => r.status === 'paid').length,
    'THE RULE: every paid order is either in a pot or in the count — none is silently dropped');
}

/* ── CURRENCY · a zero-decimal and a three-decimal money ──────────────────
 *
 * The pot holds MINOR units and never divides, so nothing here depends on a
 * hundred. JPY 6,000 is 6000 minor units and KWD 12.340 is 12340 of them — the
 * ordering below is by minor units, which is why the dinar leads.
 */
{
  const pots = paidPots([
    order({ id: 'a', currency: 'JPY', amountCents: 6000 }),
    order({ id: 'b', currency: 'jpy', amountCents: 4000 }),
    order({ id: 'c', currency: 'KWD', amountCents: 12340 }),
  ]);
  eq(pots.length, 2, 'two real currencies, two pots');
  eq(pots[0].currency, 'KWD', 'ordered by the minor units the pot actually holds');
  eq(pots[0].cents, 12340, 'a dinar pot is fils and is not divided by anything here');
  const jpy = pots.find((p) => p.currency === 'JPY')!;
  eq(jpy.cents, 10000, 'and a yen pot folds its two spellings into one');
  eq(jpy.count, 2, 'with both rows counted');
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
