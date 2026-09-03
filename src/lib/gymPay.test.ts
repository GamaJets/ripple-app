// What a gym pays its own coaches. Compile with tsc, run with node.
//
// The assertion this file exists for is the FIRST one: three functions —
// `payrollByTrainer`, `settleableSessions` and `settlementAmount` — have
// already disagreed once about what "priced" means, and the result was a screen
// saying AED 1,500 owed while the button handed over 900 and stamped the
// sessions so they never came round again. `withResolvedRates` is the shape
// that stops the third version of that, and these are the assertions that keep
// it that shape.
import {
  rateForSession, withResolvedRates, payCurrency, parseRate, payRateBlocker,
  classPayAmount, classPayBlocker, adjustmentSign, adjustmentBlocker,
  runTotal, runCurrencyBlocker, reversalReasonBlocker,
  adjustmentsTotal, runScopeOf, scopedToRun,
  ADJUSTMENT_KINDS,
  type PayIndex, type TrainerPay,
} from './gymPay';
import { payrollByTrainer, settleableSessions, settlementAmount, PAY_DELIVERED_ONLY, type PtSession } from './gymSessions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-08-26T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const sess = (o: Partial<PtSession> = {}): PtSession => ({
  id: 's1', trainerId: 't1', trainerName: 'Ana', clientId: 'c1', clientName: 'Sara',
  startsAt: ago(24), durationMin: 60, status: 'booked', outcome: 'completed',
  outcomeAt: ago(23), rateCents: null, settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null, ...o,
});

const rate = (o: Partial<TrainerPay> = {}): TrainerPay => ({
  trainerId: 't1', sessionRateCents: null, classPayKind: null, classRateCents: null,
  currency: 'GBP', updatedAt: null, ...o,
});

/* ── the three-layer rate, resolved once ───────────────────────────────────── */

{
  const pay: PayIndex = new Map([['t1', rate({ sessionRateCents: 4500 })]]);

  eq(rateForSession(sess({ rateCents: 3000 }), pay, 2500), 3000,
    'a rate snapshotted at delivery WINS — it is what was agreed for that session, and a rise in March must not repay January');
  eq(rateForSession(sess(), pay, 2500), 4500,
    'with no snapshot, what this gym pays THIS coach');
  eq(rateForSession(sess({ trainerId: 't9' }), pay, 2500), 2500,
    'and a coach with no rate of their own falls back to the gym’s standard fee');
  eq(rateForSession(sess({ trainerId: 't9' }), pay, null), null,
    'nothing at any layer is UNPRICED, which is not free');

  // Zero is a decision somebody made — a volunteer, an owner coaching their own
  // clients — and must not fall through to the gym fee.
  const free: PayIndex = new Map([['t1', rate({ sessionRateCents: 0 })]]);
  eq(rateForSession(sess(), free, 2500), 0, 'a rate of zero is a claim the gym made, not an absent rate');
}

{
  // The whole point: after resolving, the three functions read one field and
  // cannot disagree.
  const pay: PayIndex = new Map([
    ['t1', rate({ sessionRateCents: 4500 })],
    ['t2', rate({ trainerId: 't2', sessionRateCents: 9000 })],
  ]);
  const raw = [
    sess({ id: 'a', trainerId: 't1' }),
    sess({ id: 'b', trainerId: 't1', rateCents: 3000 }),
    sess({ id: 'c', trainerId: 't2', trainerName: 'Bo' }),
  ];
  const priced = withResolvedRates(raw, pay, 2500);

  eq(priced.find((s) => s.id === 'a')!.rateCents, 4500, 'the coach’s own rate lands on the row');
  eq(priced.find((s) => s.id === 'b')!.rateCents, 3000, 'the snapshot is left exactly as it was');
  eq(priced.find((s) => s.id === 'c')!.rateCents, 9000, 'a second coach gets a second rate');

  eq(raw.find((s) => s.id === 'a')!.rateCents, null,
    'the caller’s own rows are NOT mutated — a screen showing a rate the record does not hold is the confusion rate_cents exists to prevent');

  const lines = payrollByTrainer(priced, PAY_DELIVERED_ONLY, null, NOW);
  const ana = lines.find((l) => l.trainerId === 't1')!;
  eq(ana.cents, 7500, 'the payroll figure is 4500 + 3000');

  const settleable = settleableSessions(priced.filter((s) => s.trainerId === 't1'), PAY_DELIVERED_ONLY, NOW);
  eq(settleable.length, 2, 'both are settleable — neither is unpriced any more');
  eq(settlementAmount(settleable), 7500,
    'and the amount handed over equals the figure on screen, which is the disagreement this whole shape exists to prevent');

  // A gym with no fee and a coach with no rate: the session stays unpriced,
  // payroll refuses it, and settling does not silently pay it at zero.
  const bare = withResolvedRates([sess({ id: 'z', trainerId: 't9' })], pay, null);
  eq(bare[0].rateCents, null, 'unpriced stays unpriced');
  eq(settleableSessions(bare, PAY_DELIVERED_ONLY, NOW).length, 0, 'and is not settleable');
}

/* ── one currency, or none ─────────────────────────────────────────────────── */

eq(payCurrency([], 'GBP'), 'GBP', 'no stated rates means the gym’s own currency');
eq(payCurrency([rate({ currency: 'GBP' })], 'GBP'), 'GBP', 'rates that agree with the gym state it');
eq(payCurrency([rate({ currency: 'GBP' }), rate({ trainerId: 't2', currency: 'EUR' })], 'GBP'), null,
  'two currencies among the rates is no payroll total at all');
eq(payCurrency([rate({ currency: 'EUR' })], 'GBP'), null,
  'a rate in one currency at a gym priced in another is a real disagreement, not a fallback');
eq(payCurrency([rate({ currency: null })], 'GBP'), 'GBP',
  'a coach with no rate states nothing and does not disagree');

/* ── a rate, as somebody types it ──────────────────────────────────────────── */

{
  const cents = (s: string, c = 'GBP') => { const r = parseRate(s, c); return r.kind === 'rate' ? r.cents : r.kind; };
  eq(cents('45'), 4500, 'whole units in, minor units out');
  eq(cents('52.50'), 5250, 'and the halves survive');
  eq(cents(''), 'clear', 'an empty field CLEARS — this coach is on the gym’s standard fee');
  eq(cents('0'), 0, 'a typed zero is a value: the gym pays this coach nothing per session, deliberately');
  eq(cents('-5'), 'bad', 'a negative rate is refused — a deduction is an adjustment line, not a rate');

  // ── the assertion that pinned the bug ────────────────────────────────────
  //
  // This read `eq(cents('4,500'), 450000, 'a thousands comma is stripped
  // rather than truncating the figure')`, and it was true: the parser stripped
  // every comma before looking at the number.
  //
  // It is right for a British typist and catastrophic for a European one. The
  // same rule turns `52,50` — how most of Europe writes fifty-two fifty — into
  // `5250`, and the hundred then makes it 525,000 minor units. A front desk
  // setting a coach's rate to fifty-two fifty set it to five thousand two
  // hundred and fifty, on the console AND on the owner's phone, silently.
  //
  // Neither reading may be picked on the typist's behalf, so both are refused.
  // Being asked costs a keystroke; guessing costs somebody's wages.
  // `4,500` is refused: three digits after a separator cannot be a two-place
  // fraction, so this is a thousands comma and its reading is genuinely
  // ambiguous — four thousand five hundred here, four and a half in Frankfurt.
  eq(cents('4,500'), 'bad', 'a thousands separator is refused rather than guessed at');
  // `52,50` is NOT ambiguous and is not refused. Two digits after a single
  // comma can only be a decimal comma — nobody writes a thousands separator two
  // digits from the end — so it reads as fifty-two fifty, which is what the
  // person typing it meant. The old parser stripped the comma and made it
  // 525,000; refusing it outright would have been the other overcorrection.
  eq(cents('52,50'), 5250, 'the European decimal comma is read, not stripped and not refused');

  // And the hundred, which was wrong on its own terms for a third of the
  // currencies this product supports.
  eq(cents('5000', 'JPY'), 5000, 'a Tokyo gym paying ¥5,000 an hour records ¥5,000, not ¥500,000');
  eq(cents('5000.50', 'JPY'), 'bad', 'the yen has no smaller unit, so there is nothing after the point');
  eq(cents('52.500', 'KWD'), 52500, 'the dinar is thousandths — 52.500 is 52,500 fils');
  eq(cents('52.50', 'KWD'), 52500, 'and a short fraction is padded to the right place, not read as hundredths');
  eq(cents('45', null as unknown as string), 'bad',
    'and with no currency a rate is just a number — refused, because this is what somebody is paid');
}

eq(payRateBlocker('45', '', '', 'GBP'), null, 'a session rate alone is fine');
eq(payRateBlocker('', '8', 'per_attendee', 'GBP'), null, 'a class rate with a counting method is fine');
ok(payRateBlocker('', '8', '', 'GBP') != null,
  '"80" and "8 a head" are the same digits and different money — a class rate must say which');
ok(payRateBlocker('', '', 'per_class', 'GBP') != null, 'a counting method with no rate pays nothing');
ok(payRateBlocker('45', '', '', null) != null, 'no currency, no rate — what somebody is paid is a permanent record');
eq(payRateBlocker('', '', '', null), null, 'clearing everything needs no currency, because nothing is denominated');

/* ── a class somebody taught ───────────────────────────────────────────────── */

eq(classPayAmount('per_class', 8000, null), 8000, 'a flat class rate ignores the headcount');
eq(classPayAmount('per_class', 8000, 12), 8000, 'even when there is one');
eq(classPayAmount('per_attendee', 800, 12), 9600, 'per head multiplies');
eq(classPayAmount('per_attendee', 800, 0), 0, 'an empty class is a real zero — nobody came');
// The distinction that keeps a coach from being paid nothing because the
// paperwork is missing.
eq(classPayAmount('per_attendee', 800, null), null,
  'a per-head class with no register is UNKNOWN, not free');
eq(classPayAmount('per_class', -1, null), null, 'a negative rate prices nothing');

{
  const paid = rate({ classPayKind: 'per_attendee', classRateCents: 800 });
  eq(classPayBlocker(paid, 12, false), null, 'a priced class with a register can go on payroll');
  ok(classPayBlocker(paid, 12, true) != null, 'and cannot go on it twice');
  ok(classPayBlocker(paid, null, false) != null, 'a per-head class with no register is refused with words');
  ok(classPayBlocker(undefined, 12, false) != null, 'a coach with no class rate has nothing to be paid');
  ok(classPayBlocker(rate({ classPayKind: 'per_class', classRateCents: 8000, currency: null }), null, false) != null,
    'a rate with no currency cannot be written down');
  eq(classPayBlocker(rate({ classPayKind: 'per_class', classRateCents: 8000 }), null, false), null,
    'a flat-rate class needs no register at all');
}

/* ── adjustments ───────────────────────────────────────────────────────────── */

eq(adjustmentSign('bonus'), 1, 'a bonus adds');
eq(adjustmentSign('reimbursement'), 1, 'and so does money the coach spent being paid back');
eq(adjustmentSign('deduction'), -1, 'a deduction subtracts');
eq(adjustmentSign('advance'), -1, 'and so does pay already handed over');
ok(ADJUSTMENT_KINDS.every((k) => Math.abs(adjustmentSign(k)) === 1), 'every kind has a sign and none has none');

eq(adjustmentBlocker('50', 'Covered Saturday', 'GBP'), null, 'an amount and a reason is an adjustment');
ok(adjustmentBlocker('', 'Covered Saturday', 'GBP') != null, 'no amount, no line');
ok(adjustmentBlocker('0', 'Covered Saturday', 'GBP') != null, 'an adjustment of nothing changes nothing');
ok(adjustmentBlocker('50', '', 'GBP') != null,
  'a line with no reason on it is the one a coach queries and nobody can answer');
ok(adjustmentBlocker('50', 'Covered Saturday', null) != null, 'and it has to say what money it is in');
ok(adjustmentBlocker('-50', 'Covered Saturday', 'GBP') != null,
  'the amount is typed POSITIVE — the sign comes from the kind, never from the person typing');

/* ── what a run comes to ───────────────────────────────────────────────────── */

eq(runTotal({ sessionCents: 7500, sessions: 2, classCents: 9600, classes: 1, adjustmentCents: -2000, adjustments: 1 }),
  15100, 'sessions plus classes plus a signed adjustment');
eq(runTotal({ sessionCents: null, sessions: 0, classCents: 9600, classes: 1, adjustmentCents: 0, adjustments: 0 }),
  null, 'a run containing unpriced work is not a smaller run — it is one nobody should hand over');
eq(runTotal({ sessionCents: 0, sessions: 0, classCents: 9600, classes: 1, adjustmentCents: 0, adjustments: 0 }),
  9600, 'a coach who taught classes and delivered no one-to-ones is owed for the classes');

eq(runCurrencyBlocker(['GBP', 'GBP', null]), null, 'one currency, and a silent part, is one currency');
ok(runCurrencyBlocker(['GBP', 'EUR']) != null, 'two currencies on one run is not a total');
eq(runCurrencyBlocker([null, null]), null, 'nothing stated is nothing to disagree about');

ok(reversalReasonBlocker('') != null, 'taking a payroll run back needs a reason');
eq(reversalReasonBlocker('Paid before the transfer cleared'), null, 'and a reason is a reason');

/* ── adjustments are not one figure unless they are one currency ──────────
 *
 * /payroll's Adjustments column reduced `amountCents` across the rows and
 * printed the gym's currency over the answer, so a euro reimbursement plus a
 * sterling bonus read as one sterling figure — on the number the owner reads
 * BEFORE deciding whether to press Settle. `runCurrencyBlocker` does stop the
 * button, but only after the figure has been believed.
 */
{
  const adj = (kind: 'bonus' | 'deduction' | 'reimbursement' | 'advance', amountCents: number, currency: string | null) =>
    ({ kind, amountCents, currency } as const);

  const one = adjustmentsTotal([adj('bonus', 5000, 'GBP'), adj('deduction', -1500, 'GBP')]);
  eq(one.cents, 3500, 'adjustments in one currency add up');
  eq(one.currency, 'GBP', 'and the total states that currency');

  const two = adjustmentsTotal([adj('bonus', 5000, 'GBP'), adj('reimbursement', 4000, 'EUR')]);
  eq(two.cents, null, 'a euro reimbursement and a sterling bonus are not one figure');
  eq(two.currency, null, 'and there is no currency to label a figure that does not exist');
  eq(two.currencies.join(','), 'EUR,GBP', 'the screen is told which two, so it can say so');
  eq(two.count, 2, 'and how many rows it is refusing to add');

  const split = adjustmentsTotal([
    adj('bonus', 5000, 'GBP'), adj('reimbursement', 2000, 'GBP'), adj('advance', -1000, 'GBP'),
  ]);
  eq(split.cents, 6000, 'the run total is still every line');
  eq(split.taxableCents, 4000, 'but pay and a reimbursement are reported apart');
  eq(split.reimbursementCents, 2000, 'because one is taxable and one is money handed back');

  eq(adjustmentsTotal([]).cents, null, 'no adjustments is not an adjustment of nothing');
  eq(adjustmentsTotal([adj('bonus', 100, null)]).cents, null,
    'and an adjustment stating no currency is not silently the gym’s');
  eq(adjustmentsTotal([adj('bonus', 100, ' gbp ')]).currency, 'GBP',
    'spacing and case are one currency, not two — the same normalisation sharedCurrency does');
}

/* ── a run pays for its own period ────────────────────────────────────────
 *
 * `fetchClassPay` is tenant-wide and `applies_on` was never consulted, so every
 * unsettled line in the gym's history joined whichever run was on screen and
 * was stamped with that run's period_from. Opening July paid for September.
 */
{
  const AUG = { fromDate: '2026-08-01', toDate: '2026-08-31' };
  eq(runScopeOf('2026-08-15', AUG), 'on', 'a line dated inside the period is on the run');
  eq(runScopeOf('2026-08-01', AUG), 'on', 'the first day is inside it');
  eq(runScopeOf('2026-08-31', AUG), 'on', 'and so is the last');
  eq(runScopeOf('2026-09-01', AUG), 'later',
    'a bonus deliberately dated 1 September is not August’s cost');
  eq(runScopeOf('2026-07-30', AUG), 'earlier',
    'an unsettled line from before the period has no other run coming, so it joins this one');
  eq(runScopeOf(null, AUG), 'undated', 'a line whose date could not be read is placed in no period');
  eq(runScopeOf('', AUG), 'undated', 'and neither is an empty one');
  eq(runScopeOf('not a date', AUG), 'undated', 'nor a value that is not a date at all');

  const rows = [
    { id: 'a', on: '2026-08-04' },
    { id: 'b', on: '2026-09-02' },
    { id: 'c', on: '2026-06-19' },
    { id: 'd', on: null },
  ];
  eq(scopedToRun(rows, (r) => r.on, AUG).map((r) => r.id).join(','), 'a,c',
    'the run takes the period’s own lines and the stranded earlier ones, and nothing from the future');
}

if (errors.length) {
  console.error(`gymPay: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymPay ok');
