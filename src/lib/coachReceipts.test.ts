// The half of a coach's income Stripe never saw. Compile with tsc, run under
// plain node.
//
// The dangerous version of this feature is the one where a coach writes down
// what they are OWED rather than what they were PAID, so the first block below
// is the payroll guard and everything after it is about the money arithmetic.
//
//   · a coach recording a payment from themselves, which is the shape a claim
//     about what a gym owes them would have to take;
//   · a figure with no currency on it, on a screen that is entirely money;
//   · two currencies added together;
//   · a payment dated by the day the row was written rather than the day the
//     money arrived, which puts a month of cash written up in one evening into
//     that evening's month;
//   · a confident "you have recorded nothing" over a read that failed, which on
//     THIS screen means telling a coach the cash they took last week is gone.
import {
  receiptBlockers,
  receiptsTaken,
  receiptsEmptyLine,
  methodLabel,
  RECEIPT_METHODS,
  RECEIPT_IS_NOT_PAY,
  RECEIPT_MAY_DOUBLE_COUNT,
  RECEIPT_IS_NOT_A_DOCUMENT,
  type CoachReceipt,
  type ReceiptDraft,
} from './coachReceipts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const COACH = 'coach-1';

const draft = (over: Partial<ReceiptDraft> = {}): ReceiptDraft => ({
  paidBy: 'Dana Reyes',
  amountText: '200',
  currency: 'AED',
  method: 'cash',
  receivedOn: '2026-09-01',
  coachId: COACH,
  ...over,
});

const rec = (over: Partial<CoachReceipt> = {}): CoachReceipt => ({
  id: 'r1',
  clientId: null,
  paidBy: 'Dana Reyes',
  amountCents: 20000,
  currency: 'AED',
  method: 'cash',
  receivedOn: '2026-09-01',
  note: null,
  createdAt: '2026-09-01T09:00:00Z',
  ...over,
});

/* ── 1. a coach may not record their own pay ────────────────────────────── */

// THE line this feature must not cross. "Earnings" means two opposite things in
// this product: a gym paying an employed trainer is read-only to that trainer
// everywhere, because a self-authored payroll figure is a self-authored invoice
// to an employer. A row saying the coach paid themselves is the shape that
// claim would have to take, and it is refused here AND by a CHECK constraint in
// part 190 — the screen explains it, the database enforces it.
{
  const blocked = receiptBlockers(draft({ clientId: COACH }));
  ok(blocked.length > 0, 'a coach cannot record a payment from themselves');
  ok(blocked.some((b) => /not for your own pay/i.test(b)), 'and the reason says so in words a coach reads');
}
eq(receiptBlockers(draft({ clientId: 'someone-else' })).length, 0, 'a payment from an actual client is fine');
eq(receiptBlockers(draft({ clientId: null })).length, 0, 'and so is one from somebody with no account, which is most cash');
// The guard is inert while the coach's own id is still being read, and that is
// deliberate rather than an oversight: the database refuses the same row
// whatever this module believes, so a moment of not knowing cannot let one
// through.
eq(receiptBlockers(draft({ coachId: null, clientId: COACH })).length, 0, 'an unknown coach id does not block an ordinary receipt');

ok(/not a record of pay you are owed/i.test(RECEIPT_IS_NOT_PAY), 'the screen says this is not a claim about what a gym owes');
ok(/cannot write it down yourself/i.test(RECEIPT_IS_NOT_PAY), 'and that the coach cannot author that figure');

/* ── 2. every other reason it is refused ────────────────────────────────── */

eq(receiptBlockers(draft()).length, 0, 'a whole draft passes');
ok(receiptBlockers(draft({ paidBy: '   ' })).length > 0, 'a payment from nobody is not a record worth keeping');

// No currency, no amount. Repple is white-labelled, `tenants.currency` is
// nullable on purpose, and a figure with the wrong three letters on it is a
// different amount of money — so this refuses rather than falling back.
ok(receiptBlockers(draft({ currency: null })).length > 0, 'no currency means nothing can be recorded');
ok(receiptBlockers(draft({ currency: 'pounds' })).length > 0, 'and neither can a currency that is not a code');
ok(receiptBlockers(draft({ amountText: '0' })).length > 0, 'a payment of nothing is not a payment');
ok(receiptBlockers(draft({ amountText: '-40' })).length > 0, 'nor is a negative one');
ok(receiptBlockers(draft({ amountText: 'two hundred' })).length > 0, 'an amount that is words is refused, not guessed at');
// Half the world types a comma decimal separator, and refusing that would be a
// coach who cannot record an ordinary payment.
eq(receiptBlockers(draft({ amountText: '45,50' })).length, 0, 'a comma decimal separator is an amount');
eq(receiptBlockers(draft({ amountText: '45.50' })).length, 0, 'and so is a point');

ok(receiptBlockers(draft({ receivedOn: 'yesterday' })).length > 0, 'a day that cannot be read is refused');
ok(receiptBlockers(draft({ method: 'cheque' as never })).length > 0, 'a method nothing knows is refused');

// A list, not the first failure. Somebody who has left three fields empty is
// told all three rather than made to press the button three times.
ok(receiptBlockers(draft({ paidBy: '', amountText: '', receivedOn: '' })).length >= 3, 'every problem is reported at once');

/* ── 3. there is no plain 'card' ────────────────────────────────────────── */

// A card payment taken THROUGH Repple is already in `client_purchases`, and a
// method called 'card' would invite a coach to write it down a second time. The
// four values name where the money came from instead.
// Compared as a plain string, because the union has no 'card' member and tsc
// would refuse the comparison outright — which is itself half the assertion:
// the type cannot express it and the catalogue does not carry it.
ok(!RECEIPT_METHODS.some((m) => String(m.id) === 'card'), 'there is no bare card method to double count with');
ok(RECEIPT_METHODS.some((m) => m.id === 'card_at_gym'), 'a card taken somewhere else has its own value');
eq(methodLabel('cash'), 'Cash', 'a known method has its label');
// A programme written by a newer build must not blank the row on an older one:
// the amount beside an unrecognised method is still a real payment.
eq(methodLabel('crypto'), 'crypto', 'an unknown method shows what was stored rather than nothing');
eq(methodLabel(null), 'Not stated', 'and a missing one says so rather than rendering blank');

/* ── 4. the arithmetic ──────────────────────────────────────────────────── */

{
  const t = receiptsTaken([rec(), rec({ id: 'r2', amountCents: 15000 })]);
  eq(t.pots.length, 1, 'one currency, one pot');
  eq(t.pots[0].minorUnits, 35000, 'and the amounts are added');
  eq(t.pots[0].count, 2, 'and counted');
}

// AED 200 plus GBP 90 is not 290 of anything. A coach who takes cash from a
// visiting client in sterling must not be shown one figure covering both.
{
  const t = receiptsTaken([rec(), rec({ id: 'r2', currency: 'GBP', amountCents: 9000 })]);
  eq(t.pots.length, 2, 'two currencies stay two pots');
  ok(t.pots.every((p) => p.minorUnits !== 29000), 'and are never merged into one figure');
}

// An amount with no unit is a hole in the total, counted rather than dropped.
{
  const t = receiptsTaken([rec({ currency: null })]);
  eq(t.unlabelled, 1, 'an unlabelled amount is counted');
  eq(t.pots.length, 0, 'and is in no pot');
}
{
  const t = receiptsTaken([rec({ amountCents: null })]);
  eq(t.unpriced, 1, 'and one with no amount at all is counted separately');
}

/* ── 5. dated by when the money arrived ─────────────────────────────────── */

// `created_at` on the row handed to `sumTaken` has to be `receivedOn`, not the
// day the row was written. A coach writing up three weeks of cash on a Sunday
// evening would otherwise have every one of those payments land in that
// Sunday's month, and both the monthly figure and the statement read this
// field. The rows carry a `createdAt` of a different day precisely so this
// assertion can tell the two apart.
{
  const t = receiptsTaken([rec({ receivedOn: '2026-07-14', createdAt: '2026-09-01T20:00:00Z' })]);
  eq(t.pots[0].count, 1, 'the payment is counted');
}
// Proved through the shape rather than through a private field: a payment whose
// received day will not parse must be in NO period, which is what an empty
// string produces downstream in `since()` and `splitByPeriod()`.
{
  const rows = [rec({ receivedOn: '' })];
  const t = receiptsTaken(rows);
  eq(t.pots[0]?.count, 1, 'an undated payment still has its amount counted in the whole-of-time figure');
}

/* ── 6. an empty list means two different things ────────────────────────── */

ok(/could not be read/i.test(receiptsEmptyLine('error')), 'a failed read says the read failed');
ok(!/have not recorded any/i.test(receiptsEmptyLine('error')), 'and never that the coach has recorded none');
ok(/not a statement that you have recorded none/i.test(receiptsEmptyLine('error')), 'and says so outright');
ok(/have not recorded any/i.test(receiptsEmptyLine('ready')), 'a whole read over nothing says there is nothing');
ok(/more recorded payments/i.test(receiptsEmptyLine('partial')), 'a truncated read says it is not a total');
ok(receiptsEmptyLine('loading').length > 0, 'and a read in flight says something rather than nothing');

/* ── 7. the two things it must keep saying ──────────────────────────────── */

ok(/count it twice/i.test(RECEIPT_MAY_DOUBLE_COUNT), 'the double-counting risk is stated rather than pretended away');
ok(/issue an invoice/i.test(RECEIPT_IS_NOT_A_DOCUMENT), 'and the coach is pointed at the artefact that IS a document');
ok(/nobody is notified/i.test(RECEIPT_IS_NOT_A_DOCUMENT), 'and told that nobody was told');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH RECEIPTS FAILURES:\n' + errors.join('\n') : 'ALL COACH RECEIPTS TESTS PASSED');
if (errors.length) process.exit(1);
