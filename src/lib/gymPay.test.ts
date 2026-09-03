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
  rateForSession, withResolvedRates, payCurrency, parseRate, payRateBlocker, saveTrainerPay,
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
  outcomeAt: ago(23), rateCents: null, rateCurrency: null, settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null, ...o,
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
// Whitespace is not a currency. Without the trim, a row holding two spaces
// states "  ", which is one distinct stated currency, which disagrees with the
// gym's own — and the payroll total for the whole gym goes blank on the
// strength of a cell somebody tabbed through.
eq(payCurrency([rate({ currency: '   ' })], 'GBP'), 'GBP',
  'a currency of nothing but spaces states nothing and does not blank the gym’s total');
eq(payCurrency([rate({ currency: 'gbp' })], 'GBP'), 'GBP',
  'and a lowercase tag is the same currency as the gym’s, not a second one');

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

  // ── the ceiling, at the boundary rather than near it ─────────────────────
  //
  // `rate_cents` is a plain int4, so 2^31-1 MINOR units is the largest rate the
  // column will hold and anything past it comes back as a 22003 after the form
  // has closed. The number is derived from the column's width rather than
  // copied from the implementation's literal: a test that pastes the same
  // 2_147_483_647 the code contains agrees with the code by construction and
  // would keep agreeing if somebody changed both.
  //
  // Both sides of the boundary, because `>` and `>=` differ by exactly one
  // minor unit and only the boundary can tell them apart. `>=` would refuse a
  // figure the database would have accepted.
  const INT4_MAX = 2 ** 31 - 1;
  const typed = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
  eq(cents(typed(INT4_MAX)), INT4_MAX,
    'the largest rate the column can hold is accepted — the boundary is inclusive');
  eq(cents(typed(INT4_MAX + 1)), 'bad',
    'and one minor unit past it is refused here, rather than by the database after the form has closed');
}

eq(payRateBlocker('45', '', '', 'GBP'), null, 'a session rate alone is fine');
eq(payRateBlocker('', '8', 'per_attendee', 'GBP'), null, 'a class rate with a counting method is fine');
ok(payRateBlocker('', '8', '', 'GBP') != null,
  '"80" and "8 a head" are the same digits and different money — a class rate must say which');
ok(payRateBlocker('', '', 'per_class', 'GBP') != null, 'a counting method with no rate pays nothing');
// ── no currency, and WHICH refusal ─────────────────────────────────────────
//
// This was a bare `!= null`, and a bare `!= null` cannot tell one refusal from
// another. Both of these were in fact refused upstream, by `parseRate`, which
// will not read an amount at all without a currency to denominate it — so the
// assertion passed without ever reaching `payRateBlocker`'s own currency
// clause, and went on passing with that clause inverted.
//
// That much was right, and the conclusion drawn from it was not. What got
// pinned was the sentence the owner happened to be getting: `parseRate`'s
// generic "an amount typed in would not be an amount of any money", with
// "Session rate:" in front of it. Pinning it froze the wrong one. The clause
// below it in `payRateBlocker` was not merely unreachable, it was BETTER — it
// names the gym's currency as the missing setting and says why it cannot be
// skipped — and it stayed dead behind an assertion that said the dead state
// was the contract. `payRateBlocker` now asks about the currency before it
// asks the parser to read money in it, so the sentence written for this case
// is the one that arrives.
//
// The field prefix went with it, deliberately. Neither box is wrong: the owner
// typed a perfectly good number, and the thing that is missing is one setting
// away on another screen. "Session rate: …" points at the wrong screen.
{
  const fromSession = String(payRateBlocker('45', '', '', null));
  ok(payRateBlocker('45', '', '', null) != null,
    'no currency, no rate — what somebody is paid is a permanent record');
  ok(/currency/i.test(fromSession),
    'and the refusal names the missing thing as the currency, not the rate');
  ok(/actually paid/.test(fromSession),
    'and says why that cannot be waved through: a rate is what somebody is actually paid');
  ok(!/^Session rate:/.test(fromSession),
    'not attributed to a box, because neither box is what is wrong');
  ok(!/Nothing can be worked out from it/.test(fromSession),
    'and not the parser\u2019s generic complaint, which describes a difficulty rather than a setting');
  // The other box, because a currency rule reachable only through the session
  // rate is a currency rule with a hole in it: an owner who prices a coach for
  // classes and not for private work goes through this path and no other.
  const fromClass = String(payRateBlocker('', '8', 'per_class', null));
  ok(payRateBlocker('', '8', 'per_class', null) != null,
    'a class rate alone with no currency is refused on the same ground');
  eq(fromClass, fromSession,
    'and reads the same, because it is the same missing setting and the same reason');
}
eq(payRateBlocker('', '', '', null), null, 'clearing everything needs no currency, because nothing is denominated');

/* ── what actually gets written when a rate is saved ───────────────────────
 *
 * `saveTrainerPay` is the write that decides what a coach is paid, and nothing
 * anywhere in this repository exercised it. The clause worth holding is the
 * currency one: `gym_trainer_pay_amount_has_currency` requires a row carrying
 * an amount to carry a currency too and a row carrying neither to carry none,
 * so `&&` and `||` here are the difference between a save that lands and a
 * constraint violation thrown in an owner's face — for the ordinary case of a
 * coach priced for one kind of work and not the other.
 *
 * A gym is white-label and every one of them is in its own currency, so there
 * is no default to fall back on when this goes wrong.
 *
 * The only async assertions in this file, so they are gathered into one
 * function and awaited at the bottom rather than floated — an unhandled
 * rejection would print a warning and exit 0, which is a test that cannot
 * fail. */
async function writeAssertions(): Promise<void> {
{
  const saved = async (p: Partial<Parameters<typeof saveTrainerPay>[2]> = {}) => {
    let sent: Record<string, unknown> | null = null;
    let conflict: string | undefined;
    let counted = false;
    const sb = {
      from: () => ({
        upsert: (row: Record<string, unknown>, o?: { onConflict?: string; count?: string }) => {
          sent = row; conflict = o?.onConflict; counted = o?.count === 'exact';
          return Promise.resolve({ error: null, count: 1 });
        },
      }),
    } as any;
    await saveTrainerPay(sb, 'gym-1', {
      trainerId: 't1', sessionRateCents: 4500, classPayKind: null,
      classRateCents: null, currency: 'GBP', updatedBy: 'owner-1', ...p,
    });
    return { row: sent as unknown as Record<string, unknown>, conflict, counted };
  };

  // A coach priced for private work only. This is the common case — most gyms
  // set a session rate long before they pay anybody to teach — and it is the
  // one an `||` here would send with a null currency against a non-null
  // amount, which the constraint refuses outright.
  const sessionOnly = await saved({ sessionRateCents: 4500, classRateCents: null });
  eq(sessionOnly.row.currency, 'GBP', 'a row priced for sessions alone still says what money that is');
  // And the mirror, because a currency rule that only holds for the session
  // box is a rule with a hole in it.
  const classOnly = await saved({ sessionRateCents: null, classRateCents: 8000, classPayKind: 'per_class' });
  eq(classOnly.row.currency, 'GBP', 'and so does one priced for classes alone');
  const both = await saved({ sessionRateCents: 4500, classRateCents: 8000, classPayKind: 'per_class' });
  eq(both.row.currency, 'GBP', 'and one priced for both');

  // The other half of the same constraint, and the honest state: nothing has
  // been priced, so nothing is denominated — even when the form still had a
  // currency sitting in it.
  const cleared = await saved({ sessionRateCents: null, classRateCents: null, currency: 'GBP' });
  eq(cleared.row.currency, null,
    'clearing both rates clears the currency with them — a row with no amounts on it is denominated in nothing');

  eq(both.row.session_rate_cents, 4500, 'the session rate is written as given');
  eq(both.row.class_rate_cents, 8000, 'and the class rate');
  eq(both.row.tenant_id, 'gym-1', 'against the gym it belongs to');
  eq(both.row.updated_by, 'owner-1', 'and stamped with whoever changed it');
  // Named, because PostgREST defaults an upsert to the primary key, which never
  // collides — an unnamed one writes a second rate row for the same coach every
  // time Save is pressed, and the read then returns whichever it orders first.
  eq(both.conflict, 'tenant_id,trainer_id', 'the conflict target is the unique index, not the primary key');
  ok(both.counted, 'and the write is counted, so a 2xx that changed nothing is not read as a saved rate');
}

{
  // A write the server accepted without touching a row must not report success.
  // `saveTrainerPay` throwing is what stops the screen saying a senior coach's
  // rate is set while payroll goes on paying the standing fee.
  const refuse = (answer: { error: unknown; count: number | null }) => ({
    from: () => ({ upsert: () => Promise.resolve(answer) }),
  }) as any;
  const threw = async (answer: { error: unknown; count: number | null }) => {
    try {
      await saveTrainerPay(refuse(answer), 'gym-1', {
        trainerId: 't1', sessionRateCents: 4500, classPayKind: null,
        classRateCents: null, currency: 'GBP', updatedBy: 'o',
      });
      return false;
    } catch { return true; }
  };
  ok(await threw({ error: null, count: 0 }), 'a write that matched no rows is not a saved rate');
  ok(await threw({ error: null, count: null }), 'and neither is one nobody counted');
  ok(await threw({ error: { message: 'nope' }, count: null }), 'and a refused one is certainly not');
}
}

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
// Zero is a VALUE here, the same way it is in `parseRate` above, and the line
// between them is one character wide: `rateCents < 0` refuses nothing at zero,
// `rateCents <= 0` turns "this gym pays nothing to teach" — a volunteer, an
// owner covering their own class — into "nobody has priced this", which is the
// state that falls back to another rate entirely.
eq(classPayAmount('per_class', 0, null), 0,
  'a deliberate zero class rate pays zero rather than reading as unpriced');
eq(classPayAmount('per_attendee', 0, 12), 0, 'and per head, twelve times nothing is still nothing');

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

writeAssertions().then(() => {
  if (errors.length) {
    console.error(`gymPay: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
  }
  console.log('gymPay ok');
}).catch((e) => { console.error('gymPay — threw:', e); process.exit(1); });
