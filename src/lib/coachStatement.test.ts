// The statement of record. Compile with tsc, then run under plain node.
//
// This is a money document, and most of what follows asserts what it must NOT
// do. Every version of it that would do harm looks fine on a screen:
//
//   · a tax figure of any kind, including a zero one, on a document this app
//     knows nothing about the tax treatment of;
//   · a confident zero over a read that failed, printed to a self-employed
//     person as the year they had;
//   · a total across two currencies, or a figure with no currency on it;
//   · a subtotal over a truncated read, printed as a total;
//   · a yen amount divided by a hundred on its way into a spreadsheet;
//   · a payout schedule assembled out of four boolean columns.
//
// Runs under three timezones (`npm run test:zones`), so every assertion about a
// period boundary is written against locally-built midnights rather than
// against a hard-coded instant.
import {
  calendarYear, calendarQuarter, calendarMonth,
  periodRange, periodBoundsIso, periodSentence, dayLabel,
  splitByPeriod, splitByDay, minorToPlain, majorToPlain, sumCharges,
  coachStatement, statementDoc, statementCsv, statementItemsCsv,
  statementFileStem, statementShareBlurb, statementCaveats, payoutFacts, withheldReason,
  STATEMENT_NOT, STATEMENT_IS, STATEMENT_NOT_THE_WHOLE_BOOK, STATEMENT_STRIPE_IS_THE_RECORD,
  PERIOD_IS_YOURS, SESSIONS_NOT_MONEY, INVOICES_NOT_ADDED, LATE_FEES_NOT_TAKINGS, LATE_FEES_ONLY_CURRENT_CLIENTS,
  PAYOUTS_ARE_NOT_NETTED, PAYOUTS_ONLY_ARRIVED,
  REFUNDS_ARE_NOT_NETTED, REFUNDS_ARE_A_RUNNING_TOTAL, DISPUTES_ARE_NOT_NETTED, PERIOD_UNREADABLE, periodReads,
  type StatementInput, type StatementInvoice, type StatementCharge, type StatementPayout,
  type StatementRefund, type StatementDispute, type StatementCost, type StatementPeriod,
} from './coachStatement';
import { fmtPointDay } from './format';
import { COSTS_ARE_NEVER_NETTED, COSTS_ARE_NOT_TAX_ADVICE } from './coachCosts';
import { escapeHtml } from './coachInvoice';
import type { TakenRow } from './coachMoney';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

/* ── fixtures ─────────────────────────────────────────────────────────────
   Every timestamp is built from local parts and turned into an instant, so a
   row that is meant to be inside 2026 is inside 2026 in Los Angeles, Dubai and
   Auckland alike. A hard-coded 'Z' string would put the first and last day of
   the period on the wrong side of the boundary in two of the three zones. */

const at = (y: number, m: number, d: number, h = 12): string =>
  new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

const Y26 = calendarYear(2026);

const packRow = (o: Partial<TakenRow> = {}): TakenRow =>
  ({ amount_cents: 48000, currency: 'GBP', created_at: at(2026, 3, 4), ...o });

const invoice = (o: Partial<StatementInvoice> = {}): StatementInvoice => ({
  seq: 1, billTo: 'Dana Okafor', description: '8 sessions',
  amountCents: 48000, currency: 'GBP', kind: 'received',
  issuedOn: '2026-05-02', voidedAt: null, ...o,
});

const fee = (o: Partial<StatementCharge> = {}): StatementCharge =>
  ({ amount: 25, currency: 'GBP', createdAt: at(2026, 6, 11), waivedAt: null, ...o });

/** One payout Stripe told this app about. `arrivalOn` is a calendar day, so it
 *  is a bare `YYYY-MM-DD` and never an instant — the day a bank statement
 *  carries, not the day a webhook fired. */
const payout = (o: Partial<StatementPayout> = {}): StatementPayout =>
  ({ amountCents: 42810, currency: 'GBP', status: 'paid', arrivalOn: '2026-07-09', ...o });

/** Money given back on one charge. `refundedCents` is a running total across
 *  every refund on it, dated on the last of them — Stripe's shape, not a
 *  choice made here, and the reason the section says so on its face. */
const refund = (o: Partial<StatementRefund> = {}): StatementRefund =>
  ({ refundedCents: 12000, currency: 'GBP', refundedAt: at(2026, 8, 3), on: 'sale', ...o });

/** One chargeback, counted on the day the issuer raised it — the day the money
 *  left, whatever was decided afterwards. */
const dispute = (o: Partial<StatementDispute> = {}): StatementDispute =>
  ({ amountCents: 9000, currency: 'GBP', status: 'needs_response', reason: 'fraudulent', openedAt: at(2026, 9, 14), closedAt: null, ...o });

/** One cost the coach wrote down. `paidOn` is a calendar day, so it is a bare
 *  `YYYY-MM-DD` — rent was paid on a day, where the coach was standing. */
const cost = (o: Partial<StatementCost> = {}): StatementCost =>
  ({ description: 'Gym floor rent, October', category: 'rent', amountCents: 40000, currency: 'GBP', paidOn: '2026-10-01', ...o });

function input(over: Partial<StatementInput> = {}): StatementInput {
  return {
    period: Y26,
    issuer: { status: 'ready', name: 'Sam Whitfield', brand: 'Ironhaus Strength' },
    sessions: { status: 'ready', rows: [{ startsAt: at(2026, 6, 10), outcome: 'completed' }] },
    packs: { status: 'ready', rows: [packRow()] },
    subscriptions: { status: 'ready', rows: [packRow({ amount_cents: 60000, created_at: at(2026, 4, 1) })] },
    // Part 170: the cash and transfers the coach wrote down themselves. A
    // required field on StatementInput rather than an optional one, because an
    // optional default would put "you recorded nothing outside this app" on a
    // statement built by a caller that forgot to pass it — and for most
    // self-employed coaches that is the larger half of their income reported
    // confidently as zero.
    receipts: { status: 'ready', rows: [packRow({ amount_cents: 20000, created_at: '2026-05-20' })] },
    invoices: { status: 'ready', rows: [invoice()] },
    lateCancellations: { status: 'ready', rows: [fee()] },
    payouts: { status: 'ready', hasAccount: true, chargesEnabled: true, detailsSubmitted: true },
    // Part 194: what Stripe says actually reached the bank. Required for the
    // same reason `receipts` is — an optional default would print "no payout
    // reached your bank in this period" on a document handed to an accountant,
    // built by a caller that simply forgot to pass it.
    payoutsPaid: { status: 'ready', rows: [payout()] },
    // The three that money goes OUT through. Required for exactly the reason
    // the two above are: an optional default would print "you gave nothing
    // back, nothing was charged back to you and you recorded no costs" on a
    // document built by a caller that forgot to pass them — three sentences
    // about somebody's return, from an argument nobody wrote.
    refunds: { status: 'ready', rows: [refund()] },
    disputes: { status: 'ready', rows: [dispute()] },
    costs: { status: 'ready', rows: [cost()] },
    generatedAt: '2027-01-04T09:00:00.000Z',
    ...over,
  };
}

const sec = (s: ReturnType<typeof coachStatement>, key: string) => s.sections.find((x) => x.key === key)!;

/** The five row-bearing parts the line-item file carries. Empty by default so
 *  an assertion about one of them says which one it is about, rather than
 *  passing on a row some other fixture happened to leave in. */
const items = (o: Partial<Parameters<typeof statementItemsCsv>[1]> = {}): Parameters<typeof statementItemsCsv>[1] =>
  ({ invoices: [], fees: [], refunds: [], disputes: [], costs: [], ...o });

/* ── 1. the periods this app is willing to name ───────────────────────────
   A calendar period, or one the COACH names. This app still does not know
   which jurisdiction the reader is in and still infers nothing from a locale,
   a currency or a timezone — but a year start the coach types is not this app
   picking one, and `fiscalYear`/`customRange` (asserted in
   src/lib/statementPeriod.test.ts) are what they type it into. */

eq(calendarYear(2026).from, '2026-01-01', 'a year opens on 1 January');
eq(calendarYear(2026).to, '2026-12-31', 'and closes on 31 December');
eq(calendarYear(2026).label, '2026', 'and is labelled with the year alone');
eq(calendarQuarter(2026, 1).from, '2026-01-01', 'Q1 opens the year');
eq(calendarQuarter(2026, 1).to, '2026-03-31', 'and ends on the last day of March');
eq(calendarQuarter(2026, 4).to, '2026-12-31', 'Q4 ends on the last day of December');
eq(calendarQuarter(2026, 2).label, 'Q2 2026', 'a quarter is labelled by its number and year');
eq(calendarMonth(2026, 2).to, '2026-02-28', 'February in a common year ends on the 28th');
eq(calendarMonth(2024, 2).to, '2024-02-29', 'and on the 29th in a leap year');
eq(calendarMonth(2026, 11).to, '2026-11-30', 'a thirty-day month ends on the 30th');
eq(calendarMonth(2026, 1).label, 'Jan 2026', 'a month is labelled by its short name and year');
eq(calendarMonth(2026, 3).from, '2026-03-01', 'a month opens on its first day, never on a day zero');
eq(calendarQuarter(2026, 0).from, '2026-01-01', 'a quarter number below one is clamped to Q1 rather than building a negative month');
eq(calendarQuarter(2026, 9).to, '2026-12-31', 'and one above four is clamped to Q4');
eq(calendarMonth(2026, 0).from, '2026-01-01', 'a month number below one is clamped to January');
eq(calendarMonth(2026, 13).to, '2026-12-31', 'and one above twelve to December');

// No label anywhere in this module offers a split year. A "2025/26" would be a
// jurisdiction chosen on the coach's behalf.
for (const p of [calendarYear(2026), calendarQuarter(2026, 3), calendarMonth(2026, 7)]) {
  ok(!/\d{4}\s*[/–-]\s*\d{2,4}/.test(p.label), `no period label implies a split year — got "${p.label}"`);
}

/* ── 2. a period is the coach's own calendar days ─────────────────────────
   `Date.parse('2026-01-01')` is UTC midnight, which is 31 December in Los
   Angeles. A statement built that way opens with the previous year's last
   evening in it and closes before the busiest day of the period it names. */

{
  const r = periodRange(Y26)!;
  eq(r.fromMs, new Date(2026, 0, 1, 0, 0, 0, 0).getTime(), 'a period opens at LOCAL midnight on its first day');
  eq(r.toMs, new Date(2027, 0, 1, 0, 0, 0, 0).getTime(), 'and closes at local midnight on the day AFTER its last');
  ok(r.toMs > r.fromMs, 'and the range is not empty');

  // Half-open, and that is what keeps the last day of the period in it.
  const lastEvening = new Date(2026, 11, 31, 23, 30, 0, 0).getTime();
  ok(lastEvening >= r.fromMs && lastEvening < r.toMs, 'a sale at half past eleven on 31 December is IN the year');
  const firstMorning = new Date(2026, 0, 1, 0, 1, 0, 0).getTime();
  ok(firstMorning >= r.fromMs, 'and one a minute after midnight on 1 January is too');
  const eveningBefore = new Date(2025, 11, 31, 23, 30, 0, 0).getTime();
  ok(eveningBefore < r.fromMs, 'while the evening before the year starts is out of it');

  eq(periodRange({ from: 'not a date', to: '2026-12-31', label: 'x' }), null, 'an unreadable start is no range at all');
  eq(periodRange({ from: '2026-12-31', to: '2026-01-01', label: 'x' }), null, 'and a period that ends before it starts is refused rather than inverted');
  // `to` is the day AFTER the last day, so a period whose last day is the day
  // before its first collapses to nothing. A zero-length range would render as
  // a period with a name and no rows in it, which reads as a quiet year.
  eq(periodRange({ from: '2026-01-01', to: '2025-12-31', label: 'x' }), null, 'and one that collapses to no length at all is refused too');

  // The boundary INSTANTS, not merely times near them. `>=` at the open end and
  // `<` at the close are what put a sale made at midnight on the first day in
  // the period and keep one made at midnight on the next new year out of it.
  const rows = [
    { created_at: new Date(r.fromMs).toISOString() },
    { created_at: new Date(r.toMs - 1).toISOString() },
    { created_at: new Date(r.toMs).toISOString() },
  ];
  const split = splitByPeriod(rows, (x) => x.created_at, r);
  eq(split.inside.length, 2, 'the opening instant is in the period and the closing instant is not');
  ok(split.inside[0].created_at === rows[0].created_at, 'the sale made at the very start of the period is in it');
  ok(!split.inside.some((x) => x.created_at === rows[2].created_at), 'and the one made at the very start of the next is not');
}

{
  const b = periodBoundsIso(Y26)!;
  eq(b.fromIso, new Date(new Date(2026, 0, 1, 0, 0, 0, 0).getTime()).toISOString(), 'the server bound is the same local midnight, as an instant');
  eq(b.toIso, new Date(new Date(2027, 0, 1, 0, 0, 0, 0).getTime()).toISOString(), 'and the closing bound is exclusive — the day after the last');
  eq(periodBoundsIso({ from: 'x', to: 'y', label: 'x' }), null, 'and there are no bounds for a period that cannot be read');
}

// Derived, not pinned — this renders in the reader's own language now. The
// claim in the message is about the ZONE, not the wording: a bare '2026-08-01'
// must read as the 1st everywhere, and the three dash cases below are what
// stop an unreadable value becoming an undefined month name.
eq(dayLabel('2026-08-01'), fmtPointDay(2026, 7, 1), 'a date-only value reads as its own day, west of Greenwich included');
eq(dayLabel('not a date'), '—', 'and an unreadable one is a dash');
eq(dayLabel('2026-13-01'), '—', 'a month number past December is a dash, not an undefined month name');
eq(dayLabel('2026-00-01'), '—', 'and so is a month number below January');
eq(periodSentence(Y26), `${fmtPointDay(2026, 0, 1)} to ${fmtPointDay(2026, 11, 31)} inclusive`,
  'the period is spelled out at both ends and says inclusive');

/* ── 3. an undated row is in NO period, and is counted ────────────────────
   Sweeping it into the current one would put money in a year it may not belong
   to; dropping it silently would make the total short by an amount nobody can
   see. */

{
  const s = splitByPeriod(
    [packRow(), packRow({ created_at: 'nonsense' }), packRow({ created_at: at(2025, 6, 1) })],
    (r) => r.created_at,
    periodRange(Y26),
  );
  eq(s.inside.length, 1, 'only the row inside the period is inside it');
  eq(s.undated, 1, 'the unparseable row is counted');
  ok(!s.inside.some((r) => r.created_at === 'nonsense'), 'and is not in the period');
}

eq(splitByPeriod([packRow()], (r) => r.created_at, null).inside.length, 0,
  'with no readable period nothing is inside it — never everything');

/* ── 3b. a DATE column is a calendar day, not an instant ──────────────────
   `Date.parse('2026-01-01')` is UTC midnight, which is eight hours BEFORE
   local midnight in Los Angeles. An invoice issued on the first day of the
   period would fall outside the period that names it — for every coach in the
   Americas, and for nobody in the zone this app was written in. */

{
  const s = splitByDay(
    [invoice({ issuedOn: '2026-01-01' }), invoice({ issuedOn: '2026-12-31' }),
      invoice({ issuedOn: '2025-12-31' }), invoice({ issuedOn: '2027-01-01' }),
      invoice({ issuedOn: 'not a date' })],
    (r) => r.issuedOn,
    Y26,
  );
  eq(s.inside.length, 2, 'both ends of the period are in it, in every timezone');
  ok(s.inside.some((i) => i.issuedOn === '2026-01-01'), 'including the first day');
  ok(s.inside.some((i) => i.issuedOn === '2026-12-31'), 'and the last');
  eq(s.undated, 1, 'and an unreadable date is counted rather than swept in');
}

{
  // And at the CALL SITE, not only on the helper. Swapping `splitByDay` back
  // for `splitByPeriod` inside `coachStatement` left every assertion above
  // green, because the two agree everywhere east of Greenwich — which is the
  // whole shape of this bug and the reason `npm run test:zones` runs the suite
  // under America/Los_Angeles as well as Dubai and Auckland. Both ends of the
  // period, and both days just outside it, are asserted here.
  //
  // The four amounts are deliberately all different. With four equal ones the
  // count and the total come out identical whichever pair is picked — which is
  // exactly how a test can watch the right line and assert nothing at all.
  const s = coachStatement(input({
    invoices: {
      status: 'ready',
      rows: [
        invoice({ seq: 1, issuedOn: '2026-01-01', amountCents: 10000 }),
        invoice({ seq: 2, issuedOn: '2026-12-31', amountCents: 20000 }),
        invoice({ seq: 3, issuedOn: '2025-12-31', amountCents: 40000 }),
        invoice({ seq: 4, issuedOn: '2027-01-01', amountCents: 80000 }),
      ],
    },
  }));
  eq(sec(s, 'invoices').count, 2, 'an invoice on either boundary day is in the period and neither neighbour is');
  eq(sec(s, 'invoices').lines[0].amount, 'GBP 300.00', 'and the figure is those two and only those two');
}

/* ── 4. minor units into a spreadsheet, currency-aware ────────────────────
   gymExport's minorToDecimal always divides by a hundred. There are no sen in
   a yen: ¥50,000 written as 500.00 understates a coach's year by a factor of a
   hundred, in an accountant's file, in sixteen currencies. */

eq(minorToPlain(48000, 'GBP'), '480.00', 'a two-decimal currency is divided by a hundred, exactly');
eq(minorToPlain(5, 'GBP'), '0.05', 'and a sub-unit amount keeps its leading zero');
eq(minorToPlain(0, 'GBP'), '0.00', 'a genuine zero is a zero');
eq(minorToPlain(50000, 'JPY'), '50000', 'a zero-decimal currency is NOT divided');
eq(minorToPlain(50000, 'jpy'), '50000', 'whatever case the code arrives in');
eq(minorToPlain(-2500, 'GBP'), '-25.00', 'a negative keeps its sign');
eq(minorToPlain(48000, null), null, 'an amount with no currency is not an amount of money');
eq(minorToPlain(48000, '  '), null, 'nor is one whose currency is blank');
eq(minorToPlain(null, 'GBP'), null, 'and a missing amount is null, never "0.00"');
eq(minorToPlain(1.5, 'GBP'), null, 'a fractional minor unit is not a stored amount and is refused');

eq(majorToPlain(25, 'GBP'), '25.00', 'a whole-unit fee is not divided by anything');
eq(majorToPlain(25.5, 'GBP'), '25.50', 'and keeps its own decimals');
eq(majorToPlain(5000, 'JPY'), '5000', 'a zero-decimal fee has no decimals at all');
eq(majorToPlain(25, null), null, 'a fee with no currency states no amount');
eq(majorToPlain(null, 'GBP'), null, 'and a missing fee amount is null, never zero');

/* ── 5. fees: waived rows out of the figure, and said out loud ────────────*/

{
  const t = sumCharges([fee(), fee({ amount: 40 }), fee({ waivedAt: '2026-06-12T00:00:00Z' }), fee({ currency: null }), fee({ amount: null })]);
  eq(t.pots.length, 1, 'one currency, one pot');
  eq(t.pots[0].wholeUnits, 65, 'and the pot is the sum of the fees that stand');
  eq(t.pots[0].count, 2, 'counting only those');
  eq(t.waived, 1, 'a waived fee is excluded and counted');
  eq(t.unlabelled, 1, 'a fee with no currency is excluded and counted');
  eq(t.unpriced, 1, 'and so is one with no amount');
}

{
  const t = sumCharges([fee(), fee({ currency: 'AED', amount: 100 })]);
  eq(t.pots.length, 2, 'two currencies stay two pots');
  ok(!t.pots.some((p) => p.wholeUnits === 125), 'and 25 sterling plus 100 dirhams is never 125 of anything');
}

{
  // Biggest first, then by code. The tie-break is what stops two pots of the
  // same size swapping places between one build of the document and the next,
  // which on a statement somebody is comparing against last year's reads as a
  // change that did not happen.
  const t = sumCharges([fee({ currency: 'GBP', amount: 25 }), fee({ currency: 'AED', amount: 25 }), fee({ currency: 'USD', amount: 100 })]);
  eq(t.pots.map((p) => p.currency).join(','), 'USD,AED,GBP', 'pots come out biggest first, and equal ones in code order');
}

{
  // The warning is said when there are two currencies to confuse and NOT when
  // there is one. A note that always appears is a note nobody reads, and one
  // that never appears leaves a coach adding two lines together themselves.
  const two = coachStatement(input({ lateCancellations: { status: 'ready', rows: [fee(), fee({ currency: 'AED', amount: 100 })] } }));
  ok(sec(two, 'lateCancellations').notes.some((n) => n.includes('deliberately not added together')),
    'two currencies of fees carry the warning');
  const one = coachStatement(input({ lateCancellations: { status: 'ready', rows: [fee(), fee({ amount: 40 })] } }));
  ok(!sec(one, 'lateCancellations').notes.some((n) => n.includes('deliberately not added together')),
    'and one currency does not, so the warning still means something when it appears');
}

/* ── 6. THE FORBIDDEN VOCABULARY ──────────────────────────────────────────
   The document a coach hands an accountant is the artefact somebody would be
   most tempted to "finish" with a tax line. Nothing in this app knows a coach's
   country, their registration status, where their client is, or what tax the
   thing sold attracts — so any tax figure it printed would be invented, under
   somebody's name, on a document about their own income. */

const STATED = [
  STATEMENT_NOT, STATEMENT_IS, STATEMENT_NOT_THE_WHOLE_BOOK,
  STATEMENT_STRIPE_IS_THE_RECORD, PERIOD_IS_YOURS,
  SESSIONS_NOT_MONEY, INVOICES_NOT_ADDED, LATE_FEES_NOT_TAKINGS,
  // The three sections money goes OUT through carry the same shape of denial
  // and are cut for the same reason: `COSTS_ARE_NOT_TAX_ADVICE` says no cost is
  // marked allowable and none has been treated as a deduction, which is the
  // sentence this rule exists to require rather than one it should forbid, and
  // `COSTS_ARE_NEVER_NETTED` says outright that there is no profit figure
  // anywhere in this app. Cutting them keeps the rule looking for an invented
  // figure rather than for the words that refuse to invent one.
  REFUNDS_ARE_NOT_NETTED, REFUNDS_ARE_A_RUNNING_TOTAL, DISPUTES_ARE_NOT_NETTED,
  COSTS_ARE_NEVER_NETTED, COSTS_ARE_NOT_TAX_ADVICE,
];

/** The document with its own disclaimers cut out, so the rule does not fail on
 *  the sentences that exist precisely to deny what it is looking for. */
function scannable(text: string): string {
  let prose = text.toLowerCase();
  for (const stated of STATED) {
    prose = prose.split(stated.toLowerCase()).join(' ').split(escapeHtml(stated).toLowerCase()).join(' ');
  }
  return prose;
}

const FORBIDDEN = [
  'vat', 'gst', 'sales tax', 'tax rate', 'taxable', 'tax year', 'tax return',
  'tax number', 'deductible', 'deduction', 'allowable', 'withholding',
  'net of', 'gross of', 'net income', 'net earnings', 'profit', 'write-off',
  'hmrc', 'irs', '1099', 'self assessment', 'schedule c', 'liability',
  'exempt', 'zero-rated', 'reverse charge', 'subtotal',
];

// Whole words only. A bare `includes` matches "irs" inside "first" and "tin"
// inside "printing", which fails the rule on prose that says nothing about tax
// at all — and a check that cries wolf gets an exemption written for it.
const forbiddenRe = (f: string) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

for (const shape of [
  input(),
  input({ issuer: { status: 'error', name: null, brand: null }, packs: { status: 'error', rows: [] }, invoices: { status: 'partial', rows: [invoice()] } }),
  input({ sessions: { status: 'ready', rows: [] }, packs: { status: 'ready', rows: [] }, subscriptions: { status: 'ready', rows: [] }, invoices: { status: 'ready', rows: [] }, lateCancellations: { status: 'ready', rows: [] } }),
]) {
  const s = coachStatement(shape);
  const d = statementDoc(s);
  const prose = scannable(d.html + '\n' + d.text + '\n' + statementCsv(s) + '\n' + statementItemsCsv(s, { invoices: shape.invoices.rows, fees: shape.lateCancellations.rows, refunds: shape.refunds.rows, disputes: shape.disputes.rows, costs: shape.costs.rows }));
  for (const f of FORBIDDEN) {
    ok(!forbiddenRe(f).test(prose), `the statement calculates and names no tax of any kind — found "${f}"`);
  }
}

/* ── 7. and it says outright what it is not ───────────────────────────────*/

{
  const s = coachStatement(input());
  const d = statementDoc(s);
  ok(d.text.includes(STATEMENT_NOT), 'the text says outright that it is not a tax document');
  ok(d.html.includes(escapeHtml(STATEMENT_NOT).slice(0, 60)), 'and so does the HTML');
  ok(d.text.includes(STATEMENT_NOT_THE_WHOLE_BOOK), 'it says money paid outside this app is not on it');
  ok(d.text.includes(STATEMENT_STRIPE_IS_THE_RECORD), 'and that Stripe holds the record of what moved');
  ok(d.text.includes(PERIOD_IS_YOURS), 'and that the period was the coach’s own choice');
  ok(statementCsv(s).includes(STATEMENT_NOT), 'the CSV carries the same sentence on its own face');
  ok(statementItemsCsv(s, items({ invoices: [invoice()], fees: [fee()] })).includes(STATEMENT_NOT), 'and so does the line-item file');
  ok(d.text.includes(periodSentence(Y26)), 'and the exact period is on it, both ends');
  ok(statementCsv(s).includes(periodSentence(Y26)), 'and on the CSV too');
}

{
  // The emptiest statement this can build — nothing recorded, no name, no brand
  // — is where there is least to say and most temptation to fill the page.
  const s = coachStatement(input({
    issuer: { status: 'error', name: null, brand: null },
    sessions: { status: 'ready', rows: [] }, packs: { status: 'ready', rows: [] },
    subscriptions: { status: 'ready', rows: [] }, invoices: { status: 'ready', rows: [] },
    lateCancellations: { status: 'ready', rows: [] },
    payouts: { status: 'error', hasAccount: false, chargesEnabled: false, detailsSubmitted: false },
  }));
  const d = statementDoc(s);
  ok(d.text.includes(STATEMENT_NOT), 'an empty statement with an unreadable name still carries the whole disclaimer');
  ok(d.text.includes(STATEMENT_NOT_THE_WHOLE_BOOK), 'and still says what is missing from it');
  ok(!d.html.includes('undefined') && !d.html.includes('null'), 'and never prints the word undefined or null');
}

/* ── 8. a failed read is never a zero ─────────────────────────────────────
   The worst version of this app's worst defect: a self-employed person told
   they took nothing, over a read that was refused. */

{
  const s = coachStatement(input({
    packs: { status: 'error', rows: [] },
    subscriptions: { status: 'partial', rows: [packRow()] },
    invoices: { status: 'loading', rows: [] },
  }));
  eq(sec(s, 'packs').count, null, 'a failed read reports no count at all');
  eq(sec(s, 'packs').lines.length, 0, 'and no figure');
  ok((sec(s, 'packs').withheld ?? '').includes('does NOT mean there were none'),
    'and says in words that the empty section is not a statement about the record');
  eq(sec(s, 'subscriptions').count, null, 'a truncated read reports no count either');
  ok((sec(s, 'subscriptions').withheld ?? '').includes('not all of it'),
    'and says the rows shown are real but not all of them');
  ok((sec(s, 'invoices').withheld ?? '').includes('had not finished loading'),
    'a read still in flight is a read that did not answer, and says which');

  const d = statementDoc(s);
  ok(!/\b0 sales\b/.test(d.text), 'no zero is printed anywhere for a section that could not be read');
  ok(d.text.includes('*** PARTS OF THIS COULD NOT BE READ ***'), 'the caveats are on the document itself');
  eq(s.complete, false, 'and the statement knows it is not complete');
  ok(statementFileStem(s).endsWith('-INCOMPLETE'), 'the filename carries the warning to whoever opens it later');
  ok(statementShareBlurb(s).includes('BEFORE YOU SEND IT'), 'and the share sheet says so before it leaves the phone');
}

eq(withheldReason('ready', 'sales'), null, 'a whole read withholds nothing');
ok((withheldReason('error', 'sales') ?? '').includes('could not be read'), 'a failed one says so');
ok((withheldReason('partial', 'sales') ?? '').includes('not all of it'), 'a truncated one says the rows shown are not all of them');
ok((withheldReason('loading', 'sales') ?? '').includes('had not finished loading'), 'and a read still in flight says that, and not that it failed');
ok(!(withheldReason('error', 'sales') ?? '').includes('had not finished loading'), 'the four are four different sentences and are not interchangeable');

/* ── 8b. a section with nothing to admit to says nothing extra ────────────
   Every note here is a warning. One that appears when there is nothing wrong
   is a note nobody reads by the third statement, and by then it is carrying the
   real ones with it. */

{
  const clean = coachStatement(input({ packs: { status: 'ready', rows: [packRow()] } }));
  eq(sec(clean, 'packs').notes.length, 0, 'one currency, nothing missing, nothing said');
}

{
  const one = coachStatement(input({ packs: { status: 'ready', rows: [packRow(), packRow({ amount_cents: null })] } }));
  eq(sec(one, 'packs').notes.length, 1, 'exactly one sale with no amount produces exactly one note');
  ok(sec(one, 'packs').notes[0].includes('no amount recorded at all'), 'and it is the one about the missing amount');
}

/* ── 9. the one combination, and only when both halves are whole ──────────*/

{
  const s = coachStatement(input());
  ok(!!s.salesTotal, 'two whole reads may be added');
  eq(s.salesTotal!.lines.length, 1, 'one currency, one line');
  eq(s.salesTotal!.lines[0].amount, 'GBP 1,080.00', 'and the line is the two sales added, in the currency they were charged in');
  eq(s.salesWithheld, null, 'nothing is withheld');
}

{
  const s = coachStatement(input({ subscriptions: { status: 'partial', rows: [packRow()] } }));
  eq(s.salesTotal, null, 'a truncated half means NO combined figure');
  ok((s.salesWithheld ?? '').includes('wrong rather than small'),
    'and the reason names what a partial sum actually is');
}

{
  // Currencies are never merged, and the sections that use different units are
  // never merged either.
  const s = coachStatement(input({
    packs: { status: 'ready', rows: [packRow(), packRow({ currency: 'AED', amount_cents: 60000 })] },
  }));
  eq(sec(s, 'packs').lines.length, 2, 'two currencies stay two lines');
  ok(sec(s, 'packs').notes.some((n) => n.includes('deliberately not added together')),
    'and the document says they are not added');
  ok(!statementDoc(s).text.includes('1080.00'), 'no bare sum across currencies appears anywhere');
}

/* ── 10. an amount with no currency is a hole, and the size of it is said ──*/

{
  const s = coachStatement(input({ packs: { status: 'ready', rows: [packRow(), packRow({ currency: null })] } }));
  eq(sec(s, 'packs').count, 2, 'the unlabelled sale is still counted');
  eq(sec(s, 'packs').lines.length, 1, 'but it is in no figure');
  ok(sec(s, 'packs').notes.some((n) => n.includes('no currency on it')), 'and the hole is named');
  ok(sec(s, 'packs').notes.some((n) => n.includes('Do not read the shorter total as the whole of it')),
    'with the instruction not to read the short total as the whole');
}

{
  // The empty-cell rule in the file an accountant opens.
  const csv = statementItemsCsv(coachStatement(input()), items({ invoices: [invoice({ currency: null, amountCents: 48000 })] }));
  ok(csv.includes('Do not read the empty cell as nothing charged'), 'an undenominated invoice explains its empty amount cell');
  ok(!/,0\.00,/.test(csv), 'and it is never written as zero');
}

/* ── 11. sessions are counted and never priced ────────────────────────────*/

{
  const s = coachStatement(input({
    sessions: {
      status: 'ready',
      rows: [
        { startsAt: at(2026, 6, 10), outcome: 'completed' },
        { startsAt: at(2026, 6, 11), outcome: 'no_show' },
        { startsAt: at(2026, 6, 12), outcome: null },
        { startsAt: at(2025, 6, 12), outcome: 'completed' },
      ],
    },
  }));
  eq(sec(s, 'sessions').count, 3, 'only the sessions inside the period are counted');
  eq(sec(s, 'sessions').countLabel, 'sessions', 'and more than one is plural');
  eq(sec(s, 'sessions').lines.length, 0, 'and a session carries no amount on this statement');
  ok(sec(s, 'sessions').notes.some((n) => n === SESSIONS_NOT_MONEY), 'the reason is printed rather than left to a comment');
  // The breakdown itself, not merely the total. Each of the four counts is a
  // separate filter, and a wrong one reads as a coach who no-showed a third of
  // their clients.
  ok(sec(s, 'sessions').notes.some((n) => n === 'Marked completed: 1. No-show: 1. Late-cancelled: 0. Cancelled: 0.'),
    'the four outcomes are counted separately and each one is its own number');
  ok(sec(s, 'sessions').notes.some((n) => n.includes('1 session in this period has no outcome recorded')),
    'an unmarked session is named, not folded into a category');
}

{
  const one = coachStatement(input({ sessions: { status: 'ready', rows: [{ startsAt: at(2026, 6, 10), outcome: 'completed' }] } }));
  eq(sec(one, 'sessions').countLabel, 'session', 'exactly one is singular');
  eq(sec(one, 'sessions').notes.length, 2, 'and a fully-marked, fully-dated period says only what it must');
}

{
  // Exactly one undated row must produce the note. A threshold of "more than
  // one" would hide the single lost session, which is the case that actually
  // happens.
  const s = coachStatement(input({
    sessions: { status: 'ready', rows: [{ startsAt: at(2026, 6, 10), outcome: 'completed' }, { startsAt: 'nonsense', outcome: 'completed' }] },
  }));
  ok(sec(s, 'sessions').notes.some((n) => n.includes('1 session could not be dated')), 'one undated session is one named session');
}

/* ── 12. invoices are listed apart and never added to the sales ───────────
   A coach who issues a document for a pack Stripe already took would otherwise
   have the same money counted twice. */

{
  const s = coachStatement(input());
  ok(sec(s, 'invoices').notes.some((n) => n === INVOICES_NOT_ADDED), 'the statement says why invoices stand apart');
  ok(!s.salesTotal!.lines.some((l) => l.amount === 'GBP 1,560.00'), 'and the invoice is not in the combined figure');
  ok(sec(s, 'lateCancellations').notes.some((n) => n === LATE_FEES_NOT_TAKINGS), 'and so do the fees');
}

{
  const s = coachStatement(input({ invoices: { status: 'ready', rows: [invoice(), invoice({ seq: 2, voidedAt: '2026-05-03T00:00:00Z' })] } }));
  eq(sec(s, 'invoices').count, 1, 'a voided invoice is not one that stands');
  ok(sec(s, 'invoices').notes.some((n) => n.includes('voided invoice is left out')), 'and the omission is visible rather than inferred');
  eq(sec(s, 'invoices').lines[0].amount, 'GBP 480.00', 'and it is out of the figure too');
}

/* ── 13. payouts: what is known, and nothing beyond it ────────────────────
   No payout event reaches this app. There is no schedule, no amount, no fee and
   no arrival date to show, and a rendered timetable would be a promise about
   when somebody's rent money lands. */

{
  const p = payoutFacts({ status: 'ready', hasAccount: true, chargesEnabled: true, detailsSubmitted: true });
  const all = p.lines.join(' ').toLowerCase();
  // Part 194 mirrors `payout.paid` and `payout.failed`, so "never told about a
  // payout" stopped being true and this assertion moved with it. What did NOT
  // move is the part that matters: knowing four payouts happened says nothing
  // about when the fifth will, and a rendered schedule would be a promise about
  // when somebody's rent money lands.
  ok(all.includes('what is not here is a schedule'), 'the screen says outright that there is no payout timetable');
  ok(all.includes('not told when the next payout will be sent'), 'and names the thing it is still not told');
  ok(!/\bnext payout will (arrive|be sent) on\b|\barriv(es|ing) on\b|\bevery (monday|week|month)\b|\bin \d+ days\b/.test(all),
    'and no date, cadence or arrival is stated anywhere');
  // The other half of the same discipline, and the reason payouts are a
  // separate section rather than a correction to the takings above: a payout is
  // a balance, so "taken minus landed equals fees" is wrong on all three
  // numbers and the statement must never invite the subtraction.
  ok(all.includes('nothing here subtracts one from the other'),
    'and the statement says it never nets a payout against the charges above it');
  ok(!/\d+\.\d{2}/.test(all), 'and no amount is stated either');
  ok(!/https?:\/\//.test(all), 'no URL is invented for an account this app holds no link to');

  ok(payoutFacts({ status: 'ready', hasAccount: false, chargesEnabled: false, detailsSubmitted: false })
    .lines[0].includes('not connected a payout account'), 'a coach with no account is told that plainly');
  ok(payoutFacts({ status: 'error', hasAccount: false, chargesEnabled: false, detailsSubmitted: false })
    .lines[0].includes('could not be read'), 'and a failed read is never rendered as "no account"');
}

/* ── 13b. the payouts that actually arrived ───────────────────────────────
   The other half of the one reconciliation an accountant does: sales against
   bank receipts. Both halves have been in this database since part 194 and the
   document carried only the first. What must NOT happen is the subtraction. */

{
  const s = coachStatement(input());
  const p = sec(s, 'payoutsPaid');
  eq(p.count, 1, 'a paid payout dated inside the period is counted');
  eq(p.lines[0]?.amount, 'GBP 428.10', 'and printed in the currency Stripe stated');
  ok(p.notes.includes(PAYOUTS_ARE_NOT_NETTED), 'the section says a payout is not the proceeds of a sale');
  ok(p.notes.includes(PAYOUTS_ONLY_ARRIVED), 'and that only arrived payouts are in the figure');

  // The whole reason this is a section and not a column beside the sales. A
  // "fees" line anywhere here would be the difference between two figures about
  // different transactions over different spans.
  const doc = statementDoc(s);
  ok(/Payouts That Reached Your Bank/.test(doc.html), 'the document carries the section');
  ok(doc.text.includes('PAYOUTS THAT REACHED YOUR BANK'), 'and so does the text fallback');
  // The subtraction, named as a number rather than as a word. The fixture sells
  // GBP 480.00 in packs and GBP 600.00 in renewals and receives a GBP 428.10
  // payout, so a document that netted anything would print 651.90 (sales less
  // the payout) or 1,080.00 minus it under some other label. Neither appears,
  // and neither may: they would be differences between figures covering
  // different transactions over different spans.
  ok(!doc.text.includes('651.90') && !doc.html.includes('651.90'),
    'and neither nets the payout against the sales above it');
  ok(doc.text.includes(PAYOUTS_ARE_NOT_NETTED), 'the document says so on its own face');

  // Only 'paid'. In transit is not money in a bank, failed never got there, and
  // a status this app has not seen is not quietly read as arrival.
  const mixed = coachStatement(input({
    payoutsPaid: {
      status: 'ready',
      rows: [
        payout(),
        payout({ status: 'in_transit', amountCents: 90000 }),
        payout({ status: 'failed', amountCents: 90000 }),
        payout({ status: 'something_stripe_added_later', amountCents: 90000 }),
      ],
    },
  }));
  const pm = sec(mixed, 'payoutsPaid');
  eq(pm.count, 1, 'only the arrived one is counted');
  eq(pm.lines[0]?.amount, 'GBP 428.10', 'and the total is the arrived one alone');
  ok(pm.notes.some((n) => n.includes('3 payouts dated in this period have a status other than paid')),
    'the other three are counted and named rather than dropped or added');

  // An undated payout is in no period at all, including this one.
  const undated = coachStatement(input({
    payoutsPaid: { status: 'ready', rows: [payout(), payout({ arrivalOn: null, amountCents: 90000 })] },
  }));
  const pu = sec(undated, 'payoutsPaid');
  eq(pu.count, 1, 'a payout with no arrival date is not swept into the current period');
  ok(pu.notes.some((n) => n.includes('no arrival date')), 'and the statement says how many there were');

  // A failed read is never a bank account with nothing in it.
  const failed = coachStatement(input({ payoutsPaid: { status: 'error', rows: [] } }));
  const pf = sec(failed, 'payoutsPaid');
  eq(pf.count, null, 'a refused read states no count');
  eq(pf.lines.length, 0, 'and no figure');
  ok((pf.withheld ?? '').includes('could not be read'), 'and says which of the two silences it is');
  ok(failed.caveats.some((c) => c.includes('Payouts that reached your bank')),
    'and it reaches the caveat list, so the file names itself INCOMPLETE');
  ok(statementFileStem(failed).includes('INCOMPLETE'), 'which it does');

  // A payout arriving on the first day of the period is INSIDE it. `arrival_on`
  // is a Postgres date, so it goes through splitByDay — through the instant
  // range it would fall outside for every coach west of Greenwich.
  const edge = coachStatement(input({
    payoutsPaid: { status: 'ready', rows: [payout({ arrivalOn: '2026-01-01' })] },
  }));
  eq(sec(edge, 'payoutsPaid').count, 1, 'a payout dated the first day of the period is in the period');
}

/* ── 14. a typed name cannot break the document ───────────────────────────
   Four values here were typed by a person. "Ann & Bob" renders as "Ann Bob"
   without escaping, and a description reading "8 x <PT> sessions" takes the
   rest of the page — and the amounts — with it. */

{
  const s = coachStatement(input({
    issuer: { status: 'ready', name: 'Ann & Bob <script>alert(1)</script>', brand: 'R&D "Fitness"' },
  }));
  const d = statementDoc(s);
  ok(!d.html.includes('<script>'), 'a script tag typed into a name never reaches the markup');
  ok(d.html.includes('Ann &amp; Bob'), 'and an ampersand survives as an ampersand');
  ok(d.html.includes('R&amp;D &quot;Fitness&quot;'), 'the white-label brand is escaped too');
  ok(d.text.includes('Ann & Bob'), 'while the text fallback carries the name as typed');
}

{
  // A comma or a semicolon in a name shifts every column after it, silently and
  // forever, and the amount lands under the wrong heading.
  const csv = statementItemsCsv(coachStatement(input()), items({ invoices: [invoice({ billTo: 'Smith, Jr.', description: 'paid cash; owes 20' })] }));
  ok(csv.includes('"Smith, Jr."'), 'a comma in a name is quoted');
  ok(csv.includes('"paid cash; owes 20"'), 'and so is a semicolon in a description');
  ok(csv.startsWith('﻿'), 'the file opens with a BOM so Excel reads it as UTF-8');
}

/* ── 15. the file never claims a completeness it has not earned ───────────
   "every part was read successfully" is a sentence a TRUNCATING read also
   satisfies. What is written instead is the narrower claim that is true. */

{
  const whole = statementCsv(coachStatement(input()));
  ok(!/read successfully/i.test(whole), 'the file does not say every part was read successfully');
  ok(whole.includes('none of them stopped at a row limit'), 'it makes the narrower claim about the reads');
  ok(whole.includes('not about your whole book'), 'and immediately says what that claim does not cover');

  const short = statementCsv(coachStatement(input({ packs: { status: 'error', rows: [] } })));
  ok(short.includes('not read'), 'a file missing a part carries a "not read" row');
  ok(!short.includes('none of them stopped at a row limit'), 'and drops the claim entirely rather than qualifying it');
}

/* ── 16. caveats name the part and what it cost ───────────────────────────*/

{
  const c = statementCaveats(input({ lateCancellations: { status: 'error', rows: [] } }));
  eq(c.length, 1, 'one failed read, one caveat');
  ok(c[0].includes('Late-cancellation fees'), 'the caveat names the part');
  ok(c[0].includes('MISSING from this statement rather than absent from your record'),
    'and says which of the two an empty section means');
  eq(statementCaveats(input()).length, 0, 'a whole set of reads leaves nothing to say');
  eq(coachStatement(input()).complete, true, 'and the statement is complete');

  // The three failures are three different sentences in the caveat too, not
  // only in the section. "Could not be read" told about a read still in flight
  // sends a coach looking for a fault that is not there.
  ok(statementCaveats(input({ packs: { status: 'partial', rows: [] } }))[0].includes('more rows than one request returns'),
    'a truncated read is named as truncated');
  ok(statementCaveats(input({ packs: { status: 'loading', rows: [] } }))[0].includes('had not finished loading'),
    'a read still in flight is named as that');
  ok(statementCaveats(input({ packs: { status: 'error', rows: [] } }))[0].includes('could not be read'),
    'and a refused one as refused');
}

/* ── 16b. the hole that is a permission, not a gap ────────────────────────
   `charges_trainer_rw` scopes fees through the LIVE client relationship, and
   ending coaching nulls `clients.trainer_id`. Nine of the ten client rows in
   the live database already have a null trainer, so this is the common case
   rather than an edge one. */

{
  const s = coachStatement(input());
  ok(sec(s, 'lateCancellations').notes.some((n) => n === LATE_FEES_ONLY_CURRENT_CLIENTS),
    'the fees section says which fees it cannot see');
  ok(statementDoc(s).text.includes(LATE_FEES_ONLY_CURRENT_CLIENTS), 'and the document carries it');
  ok(statementItemsCsv(s, items()).includes(LATE_FEES_ONLY_CURRENT_CLIENTS), 'and so does the line-item file');
}

/* ── 16c. the line items are filtered here, not by whoever calls it ───────
   A caller that filtered differently would produce a file whose lines do not
   add up to the totals printed beside them, and nobody holding both could tell
   which one was wrong. */

{
  const s = coachStatement(input());
  const csv = statementItemsCsv(s, items({
    invoices: [invoice({ seq: 1, issuedOn: '2026-05-02' }), invoice({ seq: 2, issuedOn: '2024-05-02', description: 'out of period' })],
    fees: [fee(), fee({ createdAt: at(2024, 6, 11), amount: 999 })],
  }));
  ok(!csv.includes('out of period'), 'an invoice outside the period never reaches the file');
  ok(!csv.includes('999.00'), 'nor does a fee outside it');
  ok(csv.includes('2026-05-02'), 'and the ones inside it do');
}

/* ── 16d. the payout account has three states and they are three sentences ─*/

{
  ok(payoutFacts({ status: 'ready', hasAccount: true, chargesEnabled: false, detailsSubmitted: true })
    .lines[0].includes('has not finished verifying'), 'a submitted but unverified account says so');
  ok(payoutFacts({ status: 'ready', hasAccount: true, chargesEnabled: false, detailsSubmitted: false })
    .lines[0].includes('setup was never finished'), 'an abandoned setup says that instead');
  ok(payoutFacts({ status: 'ready', hasAccount: true, chargesEnabled: true, detailsSubmitted: true })
    .lines[0].includes('connected and clients can check out'), 'and a live one says clients can pay');
}

/* ── 17. the filename, which outlives every covering note ─────────────────*/

{
  const s = coachStatement(input());
  eq(statementFileStem(s), 'statement-of-record-ironhaus-strength-2026-01-01-to-2026-12-31',
    'the filename carries the brand and both ends of the period');
  ok(!statementFileStem(s).includes('INCOMPLETE'), 'and says nothing about incompleteness when there is none');
}

/* ── 18. THE THOUSANDTH ───────────────────────────────────────────────────
   `minorToPlain`'s own doc comment says it is currency-aware and exists so a
   yen is not divided by a hundred. It branched on ZERO_DECIMAL and on nothing
   else, so it was right for the yen and a hundred times wrong for a dinar: KWD
   12.340 is 12340 fils, and the accountant's spreadsheet said 123.40.

   The readable document beside it was right the whole time — `minorMoney` goes
   through `currencyDecimals` — so the two artefacts a coach hands over together
   disagreed by a factor of ten and neither said which was which. */

{
  eq(minorToPlain(12340, 'KWD'), '12.340', 'a Kuwaiti dinar has three decimal places, not two');
  eq(minorToPlain(12340, 'kwd'), '12.340', 'and the code is read case-insensitively, as everywhere else');
  eq(minorToPlain(5, 'BHD'), '0.005', 'five fils keeps its leading nought rather than starting with a point');
  eq(minorToPlain(-12340, 'JOD'), '-12.340', 'and a negative one keeps its sign in front of the whole figure');
  eq(minorToPlain(50000, 'JPY'), '50000', 'a yen still has none, which is what this function already got right');
  eq(minorToPlain(48000, 'GBP'), '480.00', 'and two places is still the answer for most of the world');
  eq(minorToPlain(4800, null), null, 'no currency is still no figure, never a bare number');
  // The whole-unit sibling had the same hole pointed the other way: `toFixed(2)`
  // on a dinar rounds the third place away, a fils off every fee in the file.
  eq(majorToPlain(12.345, 'KWD'), '12.345', 'a whole-unit dinar keeps all three of its places');
  eq(majorToPlain(25, 'GBP'), '25.00', 'and a pound still gets two');
  eq(majorToPlain(50000, 'JPY'), '50000', 'and a yen still gets none');

  // And the file itself carries the right digits, which is the thing that
  // actually reaches an accountant.
  const kw = coachStatement(input({ period: Y26 }));
  const csv = statementItemsCsv(kw, items({ invoices: [invoice({ amountCents: 12340, currency: 'KWD' })] }));
  ok(csv.includes('12.340'), 'the line-item file writes a dinar at its own scale');
  ok(!csv.includes('123.40'), 'and never at a hundredth of it');
}

/* ── 19. A PERIOD THAT DOES NOT READ IS NOT A QUIET YEAR ──────────────────
   `splitByPeriod` was `if (range && …)`, so a null range put every dated row
   nowhere: not inside, and not undated either, because the dates were fine.
   Sections then counted an empty `inside` and printed "0 sales" — under a
   'ready' status, with every read having succeeded, so `complete` was true and
   the document said every part of it had been read in full.

   That is the confident nought over a failed read, arriving through the period
   instead of through a read, and it is worse in one way: there is no failed
   read anywhere to raise a caveat. */

{
  const broken: StatementPeriod = { from: 'the first', to: 'the last', label: 'nonsense' };
  eq(periodReads(broken), false, 'a period whose ends are not days does not read');
  eq(periodReads(Y26), true, 'and a real one does');
  eq(periodReads({ from: '2026-12-31', to: '2026-01-01', label: 'backwards' }), false,
    'nor does one that closes before it opens');

  // Nothing vanishes between the two counts.
  const split = splitByPeriod([{ at: at(2026, 3, 4) }, { at: 'not a date' }], (r) => r.at, null);
  eq(split.inside.length, 0, 'with no range nothing is placed inside the period');
  eq(split.undated, 1, 'the row with no readable date is undated, as it always was');
  eq(split.noPeriod, 1, 'and the row with a perfectly good date is counted rather than dropped');

  const day = splitByDay([{ on: '2026-05-02' }], (r) => r.on, broken);
  eq(day.inside.length, 0, 'the date-only split places nothing against an unreadable period');
  eq(day.noPeriod, 1, 'and counts what it could not place');

  const s = coachStatement(input({ period: broken }));
  ok(!s.complete, 'a statement over an unreadable period is not complete');
  ok(s.caveats.some((c) => c.includes(PERIOD_UNREADABLE)), 'and names the period as the thing that failed');
  for (const key of ['sessions', 'packs', 'subscriptions', 'receipts', 'invoices', 'lateCancellations', 'payoutsPaid', 'refunds', 'disputes', 'costs']) {
    eq(sec(s, key).count, null, `no count is stated for ${key} over a period that does not read`);
    eq(sec(s, key).lines.length, 0, `and no figure for ${key} either`);
    eq(sec(s, key).withheld, PERIOD_UNREADABLE, `and ${key} says which of the two went wrong`);
    // The read itself succeeded and the section still says so. Reporting it as
    // a failed read would send a coach to fix a query that is fine.
    eq(sec(s, key).status, 'ready', `the read behind ${key} is still reported as whole, because it was`);
  }
  eq(s.salesTotal, null, 'and the one combined figure is withheld too');
  const doc = statementDoc(s);
  ok(doc.text.includes(PERIOD_UNREADABLE), 'the document carries the reason where it cannot be scrolled past');
  ok(!doc.text.includes('0 sales'), 'and states no nought anywhere');
  // The notes carry figures too, and blanking the counts alone would leave
  // "Marked completed: 0. No-show: 0." on the page — the same confident nought
  // wearing a sentence, over an `inside` that is empty because no row could be
  // placed rather than because nothing happened.
  ok(!doc.text.includes('Marked completed: 0'), 'nor a nought inside a note');
  ok(!/\b0 of 0\b/.test(doc.text), 'nor a count of invoices that could not be placed');
  const csv = statementItemsCsv(s, items({ invoices: [invoice()], costs: [cost()] }));
  ok(csv.includes(PERIOD_UNREADABLE), 'the line-item file says why it lists nothing');
  ok(!csv.includes('Dana Okafor'), 'rather than listing rows it could not place');
}

/* ── 20. THE THREE SECTIONS MONEY GOES OUT THROUGH ────────────────────────
   Every figure on this document was money IN. A coach who refunded four sales,
   lost a chargeback and paid a year of gym rent handed their accountant a
   statement showing the sales at full value and no penny of any of it — and
   this app held rows for all three.

   Adding them subtracts NOTHING. That is the load-bearing part: the three
   standing statements are three phrasings of one rule, and the assertions below
   are as much about the absence of a net figure as about the presence of the
   sections. */

{
  const s = coachStatement(input());
  eq(sec(s, 'refunds').count, 1, 'a refund inside the period is counted');
  eq(sec(s, 'refunds').lines[0]?.amount, 'GBP 120.00', 'and stated in the currency it went back in');
  ok(sec(s, 'refunds').notes.includes(REFUNDS_ARE_NOT_NETTED), 'and says it is not subtracted from the sales');
  ok(sec(s, 'refunds').notes.includes(REFUNDS_ARE_A_RUNNING_TOTAL), 'and that one line is every refund on one charge');

  eq(sec(s, 'disputes').count, 1, 'a chargeback raised inside the period is counted');
  ok(sec(s, 'disputes').notes.includes(DISPUTES_ARE_NOT_NETTED), 'and says it is not subtracted either');
  ok(sec(s, 'disputes').notes.some((n) => n.includes('still open')), 'and that an open one has no outcome yet');

  eq(sec(s, 'costs').count, 1, 'a cost the coach recorded is counted');
  ok(sec(s, 'costs').notes.includes(COSTS_ARE_NEVER_NETTED), 'and carries the standing rule from the costs screen itself');

  // The sales figure is untouched by any of them. This is the assertion that
  // would fail the moment somebody "finished" this document with a net line.
  const packs = sec(s, 'packs');
  eq(packs.lines[0]?.amount, 'GBP 480.00', 'the sales figure is the gross it always was');
  eq(s.salesTotal?.lines[0]?.amount, 'GBP 1,080.00', 'and the one combined figure ignores every refund and cost');

  // A period each of them falls outside of.
  const out = coachStatement(input({
    refunds: { status: 'ready', rows: [refund({ refundedAt: at(2024, 8, 3) })] },
    disputes: { status: 'ready', rows: [dispute({ openedAt: at(2024, 9, 14) })] },
    costs: { status: 'ready', rows: [cost({ paidOn: '2024-10-01' })] },
  }));
  eq(sec(out, 'refunds').count, 0, 'a refund from another year is in this period for nothing');
  eq(sec(out, 'disputes').count, 0, 'nor is a chargeback from one');
  eq(sec(out, 'costs').count, 0, 'nor a cost');

  // And a failed read is never a nought, which is the rule for all ten.
  for (const key of ['refunds', 'disputes', 'costs'] as const) {
    const bad = coachStatement(input({ [key]: { status: 'error', rows: [] } } as Partial<StatementInput>));
    eq(sec(bad, key).count, null, `a failed ${key} read states no count`);
    ok(!!sec(bad, key).withheld, `and says why`);
    ok(!bad.complete, `and the whole statement admits it`);
  }

  // Two currencies of refunds are two amounts of money and never one.
  const two = coachStatement(input({
    refunds: { status: 'ready', rows: [refund(), refund({ currency: 'AED', refundedCents: 30000 })] },
  }));
  eq(sec(two, 'refunds').lines.length, 2, 'two currencies of refunds make two lines');
  ok(sec(two, 'refunds').notes.some((n) => n.includes('deliberately not added together')),
    'and carry the warning that they are not added');
}

/* ── 21. the line-item file carries every part that has rows ──────────────
   It carried invoices and fees and nothing else, so the file an accountant
   works line by line held every document the coach had issued and no refund, no
   chargeback and no cost. Unlike a sale, those three are the rows that make a
   sale on the same document untrue. */

{
  const s = coachStatement(input());
  const csv = statementItemsCsv(s, items({
    invoices: [invoice()], fees: [fee()], refunds: [refund()], disputes: [dispute()], costs: [cost()],
  }));
  ok(csv.includes('invoice,'), 'invoices are in the file');
  ok(csv.includes('late cancellation,'), 'and fees');
  ok(csv.includes('refund,'), 'and refunds');
  ok(csv.includes('chargeback,'), 'and chargebacks');
  ok(csv.includes('cost,'), 'and costs');
  ok(csv.includes('120.00'), 'a refund carries its amount at its own scale');
  ok(csv.includes('Gym floor rent, October'.replace(',', ',')) || csv.includes('"Gym floor rent, October"'),
    'a description with a comma in it is quoted rather than becoming two columns');
  ok(csv.includes('Nothing is netted'), 'and the file says on its own face that no column adds up');
  // No signed amounts anywhere: money in and money out sit on the same lines
  // and the first column is what says which way.
  ok(!/,-\d/.test(csv), 'no amount in the file is written as a negative');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH STATEMENT FAILURES:\n' + errors.join('\n') : 'ALL COACH STATEMENT TESTS PASSED');
if (errors.length) process.exit(1);
