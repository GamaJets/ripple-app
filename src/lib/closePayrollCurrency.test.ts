// What money a payroll total is in, on the screen that FILES it.
//
// Compile with tsc, run with node.
//
// ── the defect these assertions hold closed ───────────────────────────────
//
// `payrollByTrainer` adds `sessions.rate_cents` up, and those rates have
// carried their own `rate_currency` since supabase/parts/1010. /close summed
// across whatever units it was handed and printed the result labelled with
// `tenants.currency` — the code the gym charges in TODAY — in four places: the
// Payroll tile, the sentence above the payroll table, the Pay column under it,
// and the handoff CSV an accountant reconciles against a bank statement. It
// then wrote that pairing into `gym_month_closes`, where it is permanent and
// where every later drift line reads back through it.
//
// /sessions, /payroll and /coach/earnings all ask src/lib/gymRateCurrency.ts
// this question before printing a total. /close asked nothing. So the answer is
// now computed once, by `payrollOf`, from the very sessions the figure is a sum
// of — the label and the number can no longer come from different rows — and
// these are the assertions that say so.
import { payrollOf } from './monthEnd';
import { payrollByTrainer, payableRate, PAY_DELIVERED_ONLY, type PtSession } from './gymSessions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-02T10:00:00.000Z');

const sess = (o: Partial<PtSession> = {}): PtSession => ({
  id: 's1', trainerId: 't1', trainerName: 'Marcus',
  clientId: 'c1', clientName: 'Elena',
  startsAt: '2026-08-12T09:00:00.000Z', durationMin: 60,
  status: 'booked', outcome: 'completed', outcomeAt: '2026-08-12T10:00:00.000Z',
  rateCents: 4500, rateCurrency: 'GBP',
  settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null,
  ...o,
});

/* ── one money is a total ──────────────────────────────────────────────────── */

{
  const v = payrollOf([sess({ id: 'a' }), sess({ id: 'b' })], PAY_DELIVERED_ONLY, null, NOW);
  eq(v.total.cents, 9000, 'two GBP sessions add up');
  eq(v.currency, 'GBP', 'and the total is labelled with the money they were priced in');
  eq(v.mixedCurrency, false, 'nothing is mixed');
  eq(v.currencyNote, null, 'so there is no sentence to print in place of the figure');
  eq(v.lines[0].currency, 'GBP', 'the trainer line carries it too');
  eq(v.lines[0].mixedCurrency, false, 'and is not mixed either');
}

/* ── two moneys are not a total ────────────────────────────────────────────── */

{
  const v = payrollOf(
    [sess({ id: 'a', rateCurrency: 'GBP' }), sess({ id: 'b', rateCurrency: 'AED' })],
    PAY_DELIVERED_ONLY, null, NOW,
  );
  eq(v.currency, null, 'a month priced in two currencies has no single label');
  eq(v.mixedCurrency, true, 'and says so, which is what makes the figure withholdable');
  ok((v.currencyNote ?? '').includes('more than one currency'),
    'the sentence that goes where the total would have been names the problem');
  ok((v.currencyNote ?? '').includes('GBP') && (v.currencyNote ?? '').includes('AED'),
    'and names both moneys, so an owner can act on it');
  // The sum is still computed — `payrollTotal` adds lines and has no opinion
  // about money. It is the LABEL that refuses, and the screen and the snapshot
  // withhold the figure on the strength of it.
  eq(v.total.cents, 9000, 'the raw sum is unchanged; what changes is that nothing may print it');
}

/* ── a rate with no recorded unit is a third answer, not the gym's ─────────── */

{
  const v = payrollOf(
    [sess({ id: 'a', rateCurrency: null }), sess({ id: 'b', rateCurrency: null })],
    PAY_DELIVERED_ONLY, null, NOW,
  );
  eq(v.total.cents, 9000, 'rates snapshotted before part 1010 are real figures and still add up');
  eq(v.currency, null, 'but they name no money, and the gym’s code is not substituted for one');
  eq(v.mixedCurrency, false,
    'and this is NOT the mixed case: one unknown unit is not two known ones, and the two are filed differently');
  ok((v.currencyNote ?? '').includes('before Repple recorded'),
    'the sentence says the unit is genuinely not on the record');
}

{
  // Half recorded and half not is two answers, which is mixed.
  const v = payrollOf(
    [sess({ id: 'a', rateCurrency: 'GBP' }), sess({ id: 'b', rateCurrency: null })],
    PAY_DELIVERED_ONLY, null, NOW,
  );
  eq(v.currency, null, 'some recorded and some not is still more than one answer');
  eq(v.mixedCurrency, true, 'and it is the mixed one');
}

/* ── only the sessions the figure is a sum of get a vote ───────────────────── */

{
  /*
   * A cancelled session in another currency must not withhold a total it
   * contributes nothing to. This is the mistake the passes tile on /close was
   * repaired for — a currency agreed over a WIDER set than the sum — and it is
   * why `payrollOf` asks about the payable rates rather than about `sessions`.
   */
  const v = payrollOf(
    [sess({ id: 'a', rateCurrency: 'GBP' }), sess({ id: 'b', outcome: 'cancelled', rateCurrency: 'AED' })],
    PAY_DELIVERED_ONLY, null, NOW,
  );
  eq(v.total.cents, 4500, 'a cancelled session is not paid for');
  eq(v.currency, 'GBP', 'and does not withhold the label of a total it is not in');
  eq(v.mixedCurrency, false, 'nothing about this month is mixed');
}

/* ── the gym's standard fee is a number with no unit attached ──────────────── */

{
  /*
   * `fallbackRateCents` arrives as a bare integer. Nothing tells `payrollOf`
   * what money it is in, so a session priced from it counts as unrecorded
   * rather than agreeing with a snapshotted rate whose unit it never shared. A
   * gym whose coaches are on GBP rates and whose standard fee is set in EUR
   * would otherwise have its fee-priced sessions silently added to the GBP pot
   * and the whole month labelled GBP.
   *
   * /close never reaches this: it resolves every rate up front through
   * `withResolvedRates`, which stamps the unit with the number, and passes
   * `fallbackRateCents: null`.
   */
  const v = payrollOf(
    [sess({ id: 'a', rateCurrency: 'GBP' }), sess({ id: 'b', rateCents: null, rateCurrency: null })],
    PAY_DELIVERED_ONLY, 5000, NOW,
  );
  eq(v.total.cents, 9500, 'the fee prices the session that had no rate of its own');
  eq(v.currency, null, 'and the month has no one label, because half of it was priced in nothing');
  eq(v.mixedCurrency, true, 'a snapshotted unit and an unstated one are two answers');

  eq(payableRate(sess({ rateCents: null, rateCurrency: null }), PAY_DELIVERED_ONLY, 5000)?.rateCurrency, null,
    'the rule itself: a fallback-priced session carries no currency');
  eq(payableRate(sess({ rateCents: 4500, rateCurrency: 'GBP' }), PAY_DELIVERED_ONLY, 5000)?.rateCents, 4500,
    'and a session with its own rate is never re-priced by the fallback');
  eq(payableRate(sess({ outcome: 'cancelled' }), PAY_DELIVERED_ONLY, 5000), null,
    'an unpayable session contributes no rate at all');
  eq(payableRate(sess({ rateCents: null }), PAY_DELIVERED_ONLY, null), null,
    'and an unpriced one with no fee behind it is unpriced, not free');
}

/* ── per coach, and per coach's own money ──────────────────────────────────── */

{
  /*
   * The Pay column under the total, and the CSV column beside it. A coach paid
   * in EUR at a gym banking in GBP had their month printed in pounds — three
   * inches under a total that was itself mislabelled, and one screen away from
   * /payroll, which refuses to make that payment at all.
   */
  const lines = payrollByTrainer([
    sess({ id: 'a', trainerId: 't1', trainerName: 'Marcus', rateCurrency: 'GBP' }),
    sess({ id: 'b', trainerId: 't2', trainerName: 'Priya', rateCurrency: 'EUR', rateCents: 5000 }),
    sess({ id: 'c', trainerId: 't2', trainerName: 'Priya', rateCurrency: 'EUR', rateCents: 5000 }),
  ], PAY_DELIVERED_ONLY, null, NOW);

  const marcus = lines.find((l) => l.trainerId === 't1')!;
  const priya = lines.find((l) => l.trainerId === 't2')!;
  eq(marcus.currency, 'GBP', 'each line is denominated by its own coach’s rates');
  eq(priya.currency, 'EUR', 'and the other coach keeps theirs');
  eq(priya.cents, 10000, 'with their own figure');

  // A coach whose OWN month straddles two moneys has a `cents` that is a sum
  // across them, which is not an amount and must not be printed.
  const straddles = payrollByTrainer([
    sess({ id: 'a', trainerId: 't3', rateCurrency: 'GBP' }),
    sess({ id: 'b', trainerId: 't3', rateCurrency: 'EUR' }),
  ], PAY_DELIVERED_ONLY, null, NOW);
  eq(straddles[0].currency, null, 'a coach re-rated mid-month gets no single label');
  eq(straddles[0].mixedCurrency, true, 'and the flag that tells the cell which silence to print');
}

if (errors.length) {
  console.error(`closePayrollCurrency: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('closePayrollCurrency ok');
