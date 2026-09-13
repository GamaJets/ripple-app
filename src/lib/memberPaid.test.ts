// What a member has paid, when it was paid in four places and one of them did
// not answer.
//
// The sentence this file exists to keep off a phone is "You have paid nothing",
// and its quieter and more expensive cousin: a figure a quarter of the real one,
// printed with nothing about it to doubt, on the screen a member would take to a
// dispute. Receipts totalled `gym_payments` alone while three other tables held
// the rest of their money, so the assertions below are mostly about the reads
// that did NOT land — a total over three of four sources is not a smaller total,
// it is a wrong one.
//
// Compile with tsc, run with node.
import {
  memberPaid, paidReason, paidEmptyLine, refundedLine, unstatedLine,
  type PaidSources, type PaidStatuses,
} from './memberPaid';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const WHOLE: PaidStatuses = { payments: 'ready', passes: 'ready', sales: 'ready', renewals: 'ready' };
const NONE: PaidSources = { payments: [], passes: [], sales: [], renewals: [] };

/** One of each source, all in one currency, so the total is checkable by hand. */
const oneOfEach: PaidSources = {
  payments: [{ amountCents: 5000, currency: 'GBP', takenAt: '2026-01-04T10:00:00Z' }],
  passes: [{ paidCents: 1200, currency: 'GBP', issuedOn: '2026-02-01' }],
  sales: [{ amountCents: 24000, currency: 'GBP', status: 'paid', createdAt: '2026-02-10T09:00:00Z' }],
  renewals: [{ amountCents: 3000, currency: 'GBP', paidAt: '2026-03-01T09:00:00Z', createdAt: '2026-03-01T09:05:00Z' }],
};

/* ── all four sources are in the figure, which was the whole defect ────────── */
{
  const p = memberPaid(oneOfEach, WHOLE);
  eq(p.ledger.total?.pots.length, 1, 'one currency, one pot');
  eq(p.ledger.total?.pots[0].minorUnits, 33200,
    'the gym’s payment, the pass, the coach sale and the renewal are all in the total — the screen used to show 5000 of this');
  eq(p.payments, 4, 'and all four are counted behind it');
  eq(p.ledger.reason, null, 'nothing is withheld when every read landed');
  eq(p.gym.pots[0].minorUnits, 5000, 'each source is still available on its own');
  eq(p.passes.pots[0].minorUnits, 1200, 'including the pass, whose price is the one the gym may not have recorded');
}

/* ── one read short is no total at all ─────────────────────────────────────── */
{
  for (const key of ['payments', 'passes', 'sales', 'renewals'] as const) {
    const p = memberPaid(oneOfEach, { ...WHOLE, [key]: 'error' });
    eq(p.ledger.total, null, `a failed ${key} read withholds the whole figure rather than shrinking it`);
    ok(p.ledger.missing.length === 1, `and names the one source that failed (${key})`);
    ok((p.ledger.reason ?? '').includes('not a statement that you paid nothing'),
      'the sentence refuses the substitution this module exists for');
    eq(p.payments, 4, 'the rows in hand are still counted — "we could not total 4 payments" is the useful sentence');
  }
}

/* ── 'partial' is not 'ready', and it is not 'error' either ────────────────── */
{
  const p = memberPaid(oneOfEach, { ...WHOLE, sales: 'partial' });
  eq(p.ledger.total, null, 'a read that came back at the row ceiling cannot be totalled');
  ok((p.ledger.reason ?? '').includes('more on record'),
    'and says the rows are real rather than reporting a read that worked as a failure');
  ok(!(p.ledger.reason ?? '').includes('couldn’t read'), 'a truncated read is not a refused one');
}

/* ── loading is not an empty ledger ────────────────────────────────────────── */
{
  const p = memberPaid(NONE, { ...WHOLE, renewals: 'loading' });
  eq(p.ledger.total, null, 'nothing is stated while a read is still in flight');
  ok((p.ledger.reason ?? '').startsWith('Still reading'), 'and the reason says so');
  eq(paidEmptyLine('loading'), 'Still reading.', 'the empty line agrees');
  ok(paidEmptyLine('error').includes('not because nothing was paid'),
    'and an empty list under a failed read never claims nothing was paid');
}

/* ── nothing, said only under a whole read ─────────────────────────────────── */
{
  const p = memberPaid(NONE, WHOLE);
  eq(p.ledger.total?.pots.length, 0, 'four whole reads of nothing is a real empty');
  eq(p.ledger.reason, null, 'with nothing withheld');
  ok(paidEmptyLine('ready').includes('has not been entered'),
    'and the sentence tells the member what to do about a payment they know they made');
  eq(p.payments, 0, 'and no rows contributed, which is what makes that sentence true');
}

/* ── no pots is not always no payments ─────────────────────────────────────── */
{
  // The live defect. Four whole reads, three real rows, and not one of them
  // states both an amount and a currency — so there are no pots, and the screen
  // printed "Nothing has been recorded against your account" directly above its
  // own flag saying three payments were missing from the figure.
  const p = memberPaid({
    ...NONE,
    payments: [{ amountCents: 5000, currency: null, takenAt: '2026-01-04T10:00:00Z' }],
    passes: [{ paidCents: null, currency: 'GBP', issuedOn: '2026-02-01' }],
    sales: [{ amountCents: null, currency: 'GBP', status: 'paid', createdAt: '2026-02-10T09:00:00Z' }],
  }, WHOLE);
  eq(p.ledger.total?.pots.length, 0, 'nothing can be added, which is right');
  eq(p.payments, 3, 'and three payments are nonetheless on record');
  const line = paidEmptyLine(p.ledger.status, p.payments);
  ok(!line.includes('Nothing has been recorded'),
    'so the screen never says nothing was recorded about somebody with three rows');
  ok(line.includes('no figure'), 'what is missing is the FIGURE, and the sentence says which');
  ok((unstatedLine(p.ledger.total!) ?? '').includes('3 payments'),
    'and the flag beside it agrees rather than contradicting it');
  // The old call site still answers the same way where there really is nothing.
  eq(paidEmptyLine('ready'), paidEmptyLine('ready', 0),
    'the count defaults to none, so the three read-shaped sentences are unchanged');
  ok(paidEmptyLine('error', 3).includes('a read failed'),
    'and a failed read is still about the read, whatever rows are on screen');
}

/* ── two currencies are never one figure ───────────────────────────────────── */
{
  const p = memberPaid({
    ...NONE,
    payments: [{ amountCents: 20000, currency: 'AED', takenAt: '2026-01-04T10:00:00Z' }],
    sales: [{ amountCents: 9900, currency: 'GBP', status: 'paid', createdAt: '2026-02-10T09:00:00Z' }],
  }, WHOLE);
  eq(p.ledger.total?.pots.length, 2, 'a member who paid a Dubai gym and a London coach has two figures');
  ok(!p.ledger.total?.pots.some((x) => x.minorUnits === 29900),
    '29900 is not a number in any currency that exists, and nothing here may produce it');
}

/* ── a pass nobody priced is not a free pass ───────────────────────────────── */
{
  const p = memberPaid({ ...NONE, passes: [{ paidCents: null, currency: 'GBP', issuedOn: '2026-02-01' }] }, WHOLE);
  eq(p.passes.pots.length, 0, 'an unpriced pass adds nothing to a pot');
  eq(p.passes.unpriced, 1, 'and is counted as a hole rather than as a nought');
  ok((unstatedLine(p.ledger.total!) ?? '').includes('1 payment'),
    'the size of the hole is stated, because the total is genuinely short by an unknown amount');
  eq(unstatedLine({ pots: [], unlabelled: 0, unpriced: 0 }), null, 'and nothing is said where there is no hole');
}

/* ── an amount with no currency joins no total ─────────────────────────────── */
{
  const p = memberPaid({ ...NONE, payments: [{ amountCents: 5000, currency: null, takenAt: '2026-01-04T10:00:00Z' }] }, WHOLE);
  eq(p.ledger.total?.pots.length, 0, 'an amount whose unit nobody stated cannot be added to anything');
  eq(p.ledger.total?.unlabelled, 1, 'and is counted');
}

/* ── refunds come off, and are said out loud ───────────────────────────────── */
{
  const p = memberPaid({
    ...NONE,
    sales: [{ amountCents: 24000, currency: 'GBP', status: 'paid', refundedCents: 24000, createdAt: '2026-02-10T09:00:00Z' }],
    renewals: [{ amountCents: 3000, currency: 'GBP', refundedCents: '1000', paidAt: '2026-03-01T09:00:00Z', createdAt: '2026-03-01T09:05:00Z' }],
  }, WHOLE);
  eq(p.ledger.total?.pots[0].minorUnits, 2000,
    'a fully refunded pack is worth nothing and a partly refunded renewal keeps the rest — and a bigint arriving as a string still subtracts');
  eq(p.payments, 2, 'both still count as payments: the money moved, twice');
  ok((refundedLine(p.refunded) ?? '').includes('GBP 250.00'),
    'and the size of the subtraction is printed, so a smaller figure is not a mystery');
  eq(refundedLine({ pots: [], unlabelled: 0, unpriced: 0 }), null,
    'a member nobody has refunded gets no line at all rather than a refunded nought');
}

/* ── a refund can never make somebody a payer of minus money ───────────────── */
{
  const p = memberPaid({
    ...NONE,
    sales: [{ amountCents: 1000, currency: 'GBP', status: 'paid', refundedCents: 9999, createdAt: '2026-02-10T09:00:00Z' }],
  }, WHOLE);
  eq(p.ledger.total?.pots[0].minorUnits, 0, 'floored at nought; no screen in this app renders a negative pot');
}

/* ── only a sale Stripe calls paid is money ────────────────────────────────── */
{
  const p = memberPaid({
    ...NONE,
    sales: [
      { amountCents: 24000, currency: 'GBP', status: 'pending', createdAt: '2026-02-10T09:00:00Z' },
      { amountCents: 1000, currency: 'GBP', status: null, createdAt: '2026-02-11T09:00:00Z' },
    ],
  }, WHOLE);
  eq(p.ledger.total?.pots.length, 0, 'a checkout that never completed is not money the member paid');
  eq(p.payments, 0, 'and is not counted as a payment either');
}

/* ── the reason is written to the person who PAID ──────────────────────────── */
{
  const r = paidReason('error', ['your passes']) ?? '';
  ok(r.includes('you paid nothing'), 'the member’s voice: they are the one who paid');
  ok(!r.toLowerCase().includes('you were paid'),
    'never the coach-voiced sentence `ledger()` returns, which says the opposite of the truth here');
  eq(paidReason('ready', []), null, 'and nothing is said when there is a figure');
}

if (errors.length) {
  console.error(`memberPaid: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('memberPaid ok');
