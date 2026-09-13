// Money Stripe took that the ledger does not hold.
//
// Compile with tsc, run with node.
//
// ── the defect these assertions hold closed ───────────────────────────────
//
// `fetchOnlineOrders` reads `gym_orders` for the two statuses that mean money
// moved, and its only caller in the whole product is
// studio-web/app/accounting/page.tsx — a desktop console. There are no callers
// in app/. So a gym owner holding a phone has no figure anywhere for money
// Stripe took that produced neither an entitlement nor a ledger row.
//
// ── the fact the brief for this work had backwards ────────────────────────
//
// `status = 'failed'` is NOT a declined card and is NOT money that failed to
// arrive. supabase/parts/281 defines it as "Stripe took the money and the
// entitlement could not be written", and the webhook gates the `gym_payments`
// insert on `if (!problem)` — the same condition that writes the mark. So a
// failed order is money that ARRIVED, that the member has nothing to show for,
// and that no takings figure in this product counts.
//
// That inverts what the figure means and therefore what may be done with it.
// Netting it off takings would subtract money nobody has refunded from a total
// it was never in; adding it in would report as received what nobody recorded
// receiving. It is a third figure, in its own sentence, and these assertions
// are what keep it there.
//
// GBP, JPY and KWD appear in one set below, so a two-decimal, a zero-decimal
// and a three-decimal currency are all exercised — and so the mixed case is a
// real one rather than two arbitrary codes.
import { onlineMoneyGap, NOT_TAKINGS_NOTE, type OrderLike } from './onlineMoneyGap';
// The shape the real reader returns, so this suite cannot drift from it.
import { type OnlineOrder } from './gymRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const o = (x: Partial<OrderLike> = {}): OrderLike => ({
  status: 'paid', amountCents: 5000, currency: 'GBP', inLedger: true, ...x,
});

/* ── the two piles, and they are two ───────────────────────────────────────
 *
 * An unfulfilled order needs somebody to give a paying member what they bought.
 * An unledgered one needs somebody to reopen a month and record a payment.
 * A combined figure is a number an owner cannot act on.
 */

{
  const v = onlineMoneyGap([
    o({ status: 'paid', inLedger: true, amountCents: 9900 }),
    o({ status: 'failed', inLedger: false, amountCents: 4500 }),
    o({ status: 'failed', inLedger: false, amountCents: 2500 }),
    o({ status: 'paid', inLedger: false, amountCents: 3000 }),
  ], 'GBP');

  eq(v.unfulfilled.count, 2, 'two orders Stripe charged that produced nothing');
  eq(v.unfulfilled.cents, 7000, 'and their money is summed on its own');
  eq(v.unfulfilled.currency, 'GBP', 'in the currency the rows state');
  eq(v.unfulfilled.gap, 'ok', 'with a figure that can be written down');

  eq(v.unledgered.count, 1, 'one fulfilled order whose money never reached the ledger');
  eq(v.unledgered.cents, 3000, 'counted separately');

  // The one assertion that says these are not one number.
  ok(v.unfulfilled.cents !== v.unledgered.cents,
    'the two sides are not the same figure');
  eq(v.any, true, 'and the screen has something to show');

  // The healthy order contributes to neither.
  ok(!('total' in (v as object)), 'there is no combined total on the result at all');
}

/* ── a gym where nothing went wrong ────────────────────────────────────────
 *
 * Null, not zero — but a zero COUNT, because the count is genuinely zero. The
 * distinction is the whole of `totalMoney`'s 'no_total': nothing is being
 * withheld here, nothing was computed.
 */

{
  const v = onlineMoneyGap([
    o({ status: 'paid', inLedger: true }),
    o({ status: 'paid', inLedger: true, amountCents: 12000 }),
  ], 'GBP');
  eq(v.any, false, 'nothing to show an owner');
  eq(v.unfulfilled.count, 0, 'no unfulfilled orders');
  eq(v.unfulfilled.cents, null, 'and no shortfall figure — null, not a zero shortfall');
  eq(v.unfulfilled.gap, 'no_total', 'which is "nothing was computed", not "it was withheld"');
  eq(v.unfulfilled.currency, 'GBP',
    'labelled with the gym’s own currency, because that is the money a dash would have been in');
  eq(v.unledgered.count, 0, 'and nothing missing from the ledger');
}

/* ── an empty read is only ever an empty WINDOW ────────────────────────────── */

{
  const v = onlineMoneyGap([], 'JPY');
  eq(v.any, false, 'no online sale in the window');
  eq(v.unfulfilled.cents, null, 'nothing summed');
  eq(v.unfulfilled.gap, 'no_total', 'and nothing claimed');
  eq(v.unfulfilled.currency, 'JPY', 'the gym’s own code still labels the dash');
}

/* ── three currencies in one set ───────────────────────────────────────────
 *
 * A zero-decimal and a three-decimal currency alongside a two-decimal one. The
 * amounts are minor units throughout — ¥45,000 is 45000 and KWD 4.500 is 4500 —
 * and nothing here divides by anything, which is why a single-currency total is
 * stateable at all.
 */

{
  const jpy = onlineMoneyGap([
    o({ status: 'failed', inLedger: false, amountCents: 45000, currency: 'JPY' }),
    o({ status: 'failed', inLedger: false, amountCents: 30000, currency: 'JPY' }),
  ], 'JPY');
  eq(jpy.unfulfilled.cents, 75000, 'JPY · two failed orders sum in minor units');
  eq(jpy.unfulfilled.currency, 'JPY', 'and are labelled JPY, a currency with no minor unit at all');

  const kwd = onlineMoneyGap([
    o({ status: 'failed', inLedger: false, amountCents: 4500, currency: 'KWD' }),
    o({ status: 'failed', inLedger: false, amountCents: 1750, currency: 'KWD' }),
  ], 'KWD');
  eq(kwd.unfulfilled.cents, 6250, 'KWD · fils sum as fils');
  eq(kwd.unfulfilled.currency, 'KWD', 'and are labelled KWD, a currency with three places');

  // And the three together, which is not a total.
  const mixed = onlineMoneyGap([
    o({ status: 'failed', inLedger: false, amountCents: 4500, currency: 'GBP' }),
    o({ status: 'failed', inLedger: false, amountCents: 45000, currency: 'JPY' }),
    o({ status: 'failed', inLedger: false, amountCents: 4500, currency: 'KWD' }),
  ], 'GBP');
  eq(mixed.unfulfilled.count, 3, 'three orders went wrong, and that count is stateable');
  eq(mixed.unfulfilled.cents, null, 'their money is not, because 4500 + 45000 + 4500 is 54000 of nothing');
  eq(mixed.unfulfilled.currency, null, 'and there is no code to put in front of it');
  eq(mixed.unfulfilled.gap, 'unstated', 'the state that says a figure exists and cannot be named');
}

/* ── a row whose amount or currency did not read is counted, never summed ──
 *
 * `gym_orders.amount_cents` and `.currency` are both `not null`, so this should
 * be unreachable — but `fetchOnlineOrders` maps an unparseable amount to null
 * rather than throwing, and an order silently dropped from a shortfall figure
 * is the one thing this module must not do.
 */

{
  const v = onlineMoneyGap([
    o({ status: 'failed', inLedger: false, amountCents: 4500, currency: 'GBP' }),
    o({ status: 'failed', inLedger: false, amountCents: null, currency: 'GBP' }),
    o({ status: 'failed', inLedger: false, amountCents: 2000, currency: null }),
    o({ status: 'failed', inLedger: false, amountCents: 2000, currency: '   ' }),
  ], 'GBP');
  eq(v.unfulfilled.count, 4, 'all four are orders that went wrong');
  eq(v.unfulfilled.unstated, 3, 'three of them state no readable amount of any money');
  eq(v.unfulfilled.cents, 4500, 'so the figure is the one that could be read');
  eq(v.unfulfilled.currency, 'GBP', 'in the money it stated');
  ok(v.unfulfilled.count > v.unfulfilled.unstated,
    'and the count is larger than the figure accounts for, which is the point of keeping both');
}

/* ── only the two statuses that mean money moved ───────────────────────────
 *
 * Nobody was charged for an abandoned session, and a pending one has not been
 * answered yet. `fetchOnlineOrders` selects neither today; a widened read
 * tomorrow must not turn either into money the gym is owed.
 */

{
  const v = onlineMoneyGap([
    o({ status: 'abandoned', inLedger: false, amountCents: 9900 }),
    o({ status: 'pending', inLedger: false, amountCents: 9900 }),
  ], 'GBP');
  eq(v.any, false, 'neither is a shortfall');
  eq(v.unfulfilled.count, 0, 'an abandoned checkout charged nobody');
  eq(v.unledgered.count, 0, 'and a pending one has not been answered');
}

/* ── a failed order is not counted twice ───────────────────────────────────
 *
 * It has `inLedger` false by construction — the webhook does not write a
 * payment for it — so a naive `!inLedger` filter would put it on both sides.
 */

{
  const v = onlineMoneyGap([
    o({ status: 'failed', inLedger: false, amountCents: 4500 }),
  ], 'GBP');
  eq(v.unfulfilled.count, 1, 'it is an unfulfilled order');
  eq(v.unledgered.count, 0, 'and it is not ALSO counted as a fulfilled one missing its payment');
  eq(v.unledgered.cents, null, 'so no money is stated twice');
}

/* ── the sentence that keeps this out of the takings figure ────────────────── */

{
  ok(NOT_TAKINGS_NOTE.includes('not part of what your gym was paid'),
    'the note says the figure is not takings');
  ok(NOT_TAKINGS_NOTE.includes('not subtracted from it'),
    'and says it is not netted off them either — both directions, because both are available');
}

/* ── the real reader's row satisfies the structural input ──────────────────
 *
 * Compile-time, not runtime. If `OnlineOrder` ever stops carrying `status`,
 * `amountCents`, `currency` or `inLedger` in these shapes, this file stops
 * compiling — which is the only way a structural input can be held to the
 * producer it was written for.
 */

{
  const real: OnlineOrder = {
    id: 'o1', memberId: 'm1', memberName: 'Elena', kind: 'membership',
    status: 'failed', amountCents: 4500, currency: 'GBP',
    failureNote: 'the membership row could not be written', paidAt: '2026-09-02T10:00:00.000Z',
    inLedger: false, refundedCents: null, refundedCurrency: null, reversedCents: 0, refundNote: null,
  };
  const v = onlineMoneyGap([real], 'GBP');
  eq(v.unfulfilled.count, 1, 'a real OnlineOrder is an OrderLike');
  eq(v.unfulfilled.cents, 4500, 'and is read the same way');
}

if (errors.length) {
  console.error(`onlineMoneyGap: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('onlineMoneyGap ok');
