// Billing: raising an invoice, correcting a payment, and answering a
// reconciliation exception. Compile with tsc, run with node.
//
// Three modules, one file, because they are one story: what the gym billed,
// what it took, and what to do when the two do not line up. Every assertion
// here is about a rule that decides whether a real amount of somebody's money
// is recorded correctly.
import {
  parseAmount, invoiceBlocker, isoDay, dueAfter,
  SETTABLE_INVOICE_STATUSES, INVOICE_STATUS_LABEL,
} from './gymInvoices';
import { reversalBlocker, reversedAgainst, type GymPayment } from './gymRecord';
import { markBlocker, partitionByMark, markKey, type MarkIndex, type ReconcileMark } from './gymReconcile';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── an amount, as somebody types it ───────────────────────────────────────── */

{
  const cents = (s: string) => {
    const r = parseAmount(s, 'GBP');
    return r.kind === 'amount' ? r.minorUnits : null;
  };

  eq(cents('60'), 6000, 'a whole number is minor units');
  eq(cents('82.50'), 8250, 'two decimal places survive');
  eq(cents('0'), 0, 'a zero-value invoice is a real thing — a fully discounted joining fee');

  eq(cents(' 60 '), 6000, 'surrounding whitespace is not an amount');

  // `1,250.00` used to be stripped to 125000. It is now REFUSED, and that is
  // the improvement: in a two-place currency `1,234` is one thousand two
  // hundred and thirty-four to a British typist and one and a bit to a German
  // one, and neither reading may be picked on their behalf. Being asked costs
  // a keystroke; guessing costs the invoice.
  ok(parseAmount('1,250.00', 'GBP').kind === 'bad',
    'a thousands separator is refused rather than guessed at');
  ok(parseAmount('\u00a360', 'GBP').kind === 'bad',
    'a symbol is refused rather than silently dropped — a box that quietly discards characters accepts a different number from the one on screen');

  ok(parseAmount('', 'GBP').kind === 'bad', 'an empty box is not an invoice for nothing');
  ok(parseAmount('-60', 'GBP').kind === 'bad', 'a negative invoice is refused — a bill taken back is a void');
  ok(parseAmount('10.005', 'GBP').kind === 'bad',
    'a third decimal place is refused rather than rounded: 1000 and 1001 are both wrong and only the person typing knows which');
  ok(parseAmount('sixty', 'GBP').kind === 'bad', 'words are not amounts');
  ok(parseAmount('99999999999', 'GBP').kind === 'bad',
    'past a 32-bit integer the database raises 22003 after the form has closed');

  // ── the whole reason this function gained a currency ─────────────────────
  //
  // It used to end `Math.round(Number(bare) * 100)` whatever the gym billed in.
  const jpy = (s: string) => {
    const r = parseAmount(s, 'JPY');
    return r.kind === 'amount' ? r.minorUnits : null;
  };
  const kwd = (s: string) => {
    const r = parseAmount(s, 'KWD');
    return r.kind === 'amount' ? r.minorUnits : null;
  };

  eq(jpy('5000'), 5000, 'a Tokyo gym billing 5,000 yen files 5,000 minor units, not 500,000');
  ok(parseAmount('5000.50', 'JPY').kind === 'bad', 'the yen has no smaller unit, so there is nothing after the point');
  eq(kwd('82.500'), 82500, 'the dinar is thousandths — 82.500 is 82,500 fils, not 8,250');
  ok(parseAmount('82.50', 'KWD').kind === 'amount', 'a short fraction is padded, not refused');
  eq(kwd('82.50'), 82500, 'and padded to the right place — 82.50 KWD is 82,500 fils');

  ok(parseAmount('60', null).kind === 'bad',
    'with no currency there is no such thing as an amount, and no default is right for half the gyms running Repple');
}

/* ── a date that is actually a date ────────────────────────────────────────── */

ok(isoDay('2026-02-28'), 'a real date passes');
// The one a regex alone waves through. `new Date('2026-02-31')` rolls into
// March and says nothing, so an invoice dated the 31st of February would be
// filed in the wrong month for ever.
ok(!isoDay('2026-02-31'), '31 February is not a date, however well it is spelled');
ok(!isoDay('2026-13-01'), 'there is no thirteenth month');
ok(!isoDay('26-01-01'), 'a two-digit year is not the format the column holds');
ok(!isoDay(''), 'an empty string is not a date');
ok(!isoDay(null), 'and neither is a null');

eq(dueAfter('2026-01-31', 30), '2026-03-02', 'thirty days from the end of January lands in March');
eq(dueAfter('2026-12-20', 30), '2027-01-19', 'and it crosses a year end');
// UTC arithmetic, so a gym in Auckland and a gym in Los Angeles get the same
// answer from the same issue date.
eq(dueAfter('2026-06-15', 0), '2026-06-15', 'zero days is the same day, not the day before');

/* ── why an invoice cannot be raised ───────────────────────────────────────── */

{
  const draft = { memberId: 'm1', amount: '60', issuedOn: '2026-08-01', dueOn: '2026-08-31' };

  eq(invoiceBlocker(draft, 'GBP'), null, 'a complete draft in a gym with a currency is fine');

  ok(invoiceBlocker({ ...draft, memberId: '' }, 'GBP') != null,
    'an invoice with nobody on it cannot be chased, matched or aged');
  ok(invoiceBlocker(draft, null) != null,
    'no currency is no bill — this is the rule the whole product is built on');
  ok(invoiceBlocker({ ...draft, amount: '' }, 'GBP') != null, 'no amount is no bill either');
  ok(invoiceBlocker({ ...draft, issuedOn: '2026-02-31' }, 'GBP') != null, 'an unreal issue date is refused');
  ok(invoiceBlocker({ ...draft, dueOn: '2026-07-01' }, 'GBP') != null,
    'a due date before the issue date would be overdue the moment it was raised');
  eq(invoiceBlocker({ ...draft, dueOn: '' }, 'GBP'), null,
    'no due date is a DECISION — an invoice that is never overdue, which is right for a receipt');
}

// `overdue` is computed from the due date and today, on both money screens. It
// is in the status list because the column's CHECK permits it and hand-written
// rows carry it; it must never be in the picker, or a stored 'overdue' would go
// stale the moment the invoice was paid.
ok(!SETTABLE_INVOICE_STATUSES.includes('overdue'),
  'overdue is derived, not set — a stored one disagrees with the screen that computes it');
ok(SETTABLE_INVOICE_STATUSES.every((s) => INVOICE_STATUS_LABEL[s]),
  'every status a screen can set has words for an owner to read');

/* ── correcting money ──────────────────────────────────────────────────────── */

const pay = (o: Partial<GymPayment> = {}): GymPayment => ({
  id: 'p1', memberId: 'm1', memberName: 'Sara', amountCents: 5000, currency: 'GBP',
  method: 'card', takenAt: '2026-08-01T12:00:00Z', note: null,
  kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: null, ...o,
});

{
  const original = pay();

  eq(reversalBlocker(original, 0, 5000), null, 'a full reversal of an untouched payment is allowed');
  eq(reversalBlocker(original, 0, 2000), null, 'and so is a partial one');

  ok(reversalBlocker(original, 0, 6000) != null,
    'more than the payment was for would take back money the gym never had');
  ok(reversalBlocker(original, 5000, 1) != null, 'a payment already reversed in full cannot be reversed again');
  ok(reversalBlocker(original, 3000, 2500) != null, 'nor beyond what is left of it');
  eq(reversalBlocker(original, 3000, 2000), null, 'exactly what is left is allowed');

  ok(reversalBlocker(original, 0, 0) != null, 'a correction of nothing corrects nothing');
  ok(reversalBlocker(original, 0, -100) != null,
    'the amount is typed POSITIVE and Repple applies the minus — a screen that asked for a negative would one day be handed a positive and file a second payment');
  ok(reversalBlocker(original, 0, NaN) != null, 'an unparseable amount is refused rather than written');

  // Correcting a correction: the amount is already negative, so a second minus
  // would ADD money to the ledger.
  ok(reversalBlocker(pay({ kind: 'refund', amountCents: -5000, reversesPaymentId: 'p1' }), 0, 100) != null,
    'a correction cannot itself be corrected');
}

{
  const all: GymPayment[] = [
    pay({ id: 'p1', amountCents: 5000 }),
    pay({ id: 'r1', amountCents: -1500, kind: 'refund', reversesPaymentId: 'p1' }),
    pay({ id: 'r2', amountCents: -500, kind: 'correction', reversesPaymentId: 'p1' }),
    pay({ id: 'p2', amountCents: 9000 }),
    pay({ id: 'r3', amountCents: -9000, kind: 'refund', reversesPaymentId: 'p2' }),
  ];
  eq(reversedAgainst('p1', all), 2000, 'two part reversals add up, as positives');
  eq(reversedAgainst('p2', all), 9000, 'a full reversal is the whole amount');
  eq(reversedAgainst('p3', all), 0, 'a payment nothing points at has had nothing taken back');

  // The whole reason a correction is a row and not a flag: every existing SUM
  // nets to the right figure with no new predicate anywhere.
  eq(all.reduce((a, p) => a + p.amountCents, 0), 3000,
    'the ledger nets to 5000 − 1500 − 500 + 9000 − 9000 = 3000 without any query learning about corrections');
}

/* ── answering a reconciliation exception ──────────────────────────────────── */

eq(markBlocker('accepted', 'Cash banked in a lump on the 30th'), null, 'an explanation is an answer');
ok(markBlocker('accepted', '') != null,
  'accepting REMOVES a row from an accountant’s page, so the reason is what makes the removal auditable');
ok(markBlocker('accepted', '   ') != null, 'and whitespace is not a reason');
eq(markBlocker('flagged', ''), null,
  'flagging hides nothing, so a bare "this is wrong" is a complete thought — refusing it would only teach people to type a full stop');
ok(markBlocker('flagged', 'x'.repeat(501)) != null, 'a note is one line of a reconciliation, not an essay');

{
  const mark = (state: 'accepted' | 'flagged', subjectId: string): ReconcileMark => ({
    id: `mk-${subjectId}`, subjectKind: 'payment', subjectId, state,
    note: state === 'accepted' ? 'expected' : null,
    markedBy: 'o1', markedByName: 'Owner', markedAt: '2026-08-20T10:00:00Z',
  });

  const marks: MarkIndex = new Map([
    [markKey('payment', 'a'), mark('accepted', 'a')],
    [markKey('payment', 'b'), mark('flagged', 'b')],
  ]);

  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const split = partitionByMark(rows, 'payment', marks);

  eq(split.open.length, 2, 'the unanswered row and the flagged one are both still open questions');
  ok(split.open.some((r) => r.id === 'b'), 'a FLAGGED row stays on the list — it is a bookmark, not an answer');
  ok(!split.open.some((r) => r.id === 'a'), 'an explained row comes off it');
  eq(split.explained.length, 1, 'and is returned under its own heading rather than vanishing');
  eq(split.explained[0].mark.note, 'expected', 'with the reason attached, so the removal can be checked');
  eq(split.flagged.length, 1, 'a flagged row is ALSO reported as flagged, so the next reader knows somebody looked');

  // A mark for the other kind must not hide a payment with the same id. Two
  // tables, two id spaces, and a shared key would let an invoice's answer
  // silently explain away a payment.
  const wrongKind: MarkIndex = new Map([[markKey('invoice', 'a'), mark('accepted', 'a')]]);
  eq(partitionByMark(rows, 'payment', wrongKind).open.length, 3,
    'an invoice’s answer does not explain a payment that happens to share its id');
}

if (errors.length) {
  console.error(`gymBilling: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymBilling ok');
