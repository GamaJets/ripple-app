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
  PERIOD_IS_YOURS, SESSIONS_NOT_MONEY, INVOICES_NOT_ADDED, LATE_FEES_NOT_TAKINGS,
  type StatementInput, type StatementInvoice, type StatementCharge,
} from './coachStatement';
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

function input(over: Partial<StatementInput> = {}): StatementInput {
  return {
    period: Y26,
    issuer: { status: 'ready', name: 'Sam Whitfield', brand: 'Ironhaus Strength' },
    sessions: { status: 'ready', rows: [{ startsAt: at(2026, 6, 10), outcome: 'completed' }] },
    packs: { status: 'ready', rows: [packRow()] },
    subscriptions: { status: 'ready', rows: [packRow({ amount_cents: 60000, created_at: at(2026, 4, 1) })] },
    invoices: { status: 'ready', rows: [invoice()] },
    lateCancellations: { status: 'ready', rows: [fee()] },
    payouts: { status: 'ready', hasAccount: true, chargesEnabled: true, detailsSubmitted: true },
    generatedAt: '2027-01-04T09:00:00.000Z',
    ...over,
  };
}

const sec = (s: ReturnType<typeof coachStatement>, key: string) => s.sections.find((x) => x.key === key)!;

/* ── 1. the periods this app is willing to name ───────────────────────────
   A calendar period, never a fiscal or a tax one: this app does not know which
   jurisdiction the reader is in, and offering "2025/26" would pick one. */

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
}

{
  const b = periodBoundsIso(Y26)!;
  eq(b.fromIso, new Date(new Date(2026, 0, 1, 0, 0, 0, 0).getTime()).toISOString(), 'the server bound is the same local midnight, as an instant');
  eq(b.toIso, new Date(new Date(2027, 0, 1, 0, 0, 0, 0).getTime()).toISOString(), 'and the closing bound is exclusive — the day after the last');
  eq(periodBoundsIso({ from: 'x', to: 'y', label: 'x' }), null, 'and there are no bounds for a period that cannot be read');
}

eq(dayLabel('2026-08-01'), '1 Aug 2026', 'a date-only value reads as its own day, west of Greenwich included');
eq(dayLabel('not a date'), '—', 'and an unreadable one is a dash');
eq(periodSentence(Y26), '1 Jan 2026 to 31 Dec 2026 inclusive', 'the period is spelled out at both ends and says inclusive');

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
  const prose = scannable(d.html + '\n' + d.text + '\n' + statementCsv(s) + '\n' + statementItemsCsv(s, shape.invoices.rows, shape.lateCancellations.rows));
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
  ok(statementItemsCsv(s, [invoice()], [fee()]).includes(STATEMENT_NOT), 'and so does the line-item file');
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
  const csv = statementItemsCsv(coachStatement(input()), [invoice({ currency: null, amountCents: 48000 })], []);
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
  eq(sec(s, 'sessions').lines.length, 0, 'and a session carries no amount on this statement');
  ok(sec(s, 'sessions').notes.some((n) => n === SESSIONS_NOT_MONEY), 'the reason is printed rather than left to a comment');
  ok(sec(s, 'sessions').notes.some((n) => n.includes('no outcome recorded')), 'an unmarked session is named, not folded into a category');
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
  ok(all.includes('never told about a payout'), 'the screen says outright that this app is not told about payouts');
  ok(!/\bnext payout\b|\barriv(es|ing) on\b|\bevery (monday|week|month)\b|\bin \d+ days\b/.test(all),
    'and no date, cadence or arrival is stated anywhere');
  ok(!/\d+\.\d{2}/.test(all), 'and no amount is stated either');
  ok(!/https?:\/\//.test(all), 'no URL is invented for an account this app holds no link to');

  ok(payoutFacts({ status: 'ready', hasAccount: false, chargesEnabled: false, detailsSubmitted: false })
    .lines[0].includes('not connected a payout account'), 'a coach with no account is told that plainly');
  ok(payoutFacts({ status: 'error', hasAccount: false, chargesEnabled: false, detailsSubmitted: false })
    .lines[0].includes('could not be read'), 'and a failed read is never rendered as "no account"');
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
  const csv = statementItemsCsv(coachStatement(input()), [invoice({ billTo: 'Smith, Jr.', description: 'paid cash; owes 20' })], []);
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
}

/* ── 17. the filename, which outlives every covering note ─────────────────*/

{
  const s = coachStatement(input());
  eq(statementFileStem(s), 'statement-of-record-ironhaus-strength-2026-01-01-to-2026-12-31',
    'the filename carries the brand and both ends of the period');
  ok(!statementFileStem(s).includes('INCOMPLETE'), 'and says nothing about incompleteness when there is none');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH STATEMENT FAILURES:\n' + errors.join('\n') : 'ALL COACH STATEMENT TESTS PASSED');
if (errors.length) process.exit(1);
