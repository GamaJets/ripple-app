// The statement's line items, on the screen that sends them. Compile with tsc,
// run under node.
//
// The whole point of drawing these is that a coach can check a document about
// their own income BEFORE it reaches an accountant. That is only worth anything
// if what they check is what leaves the phone, so the load-bearing test in this
// file is not "does it produce lines" — it is section 2, which builds the CSV
// `statementItemsCsv` actually writes, parses it back, and asserts cell for cell
// that the screen's lines are the file's item rows.
//
// The failures aimed at:
//
//   · a screen that filters the period even slightly differently from the file,
//     so the lines a coach approved are not the lines that were sent;
//   · a count stated over a read that came back short, which is a prefix of an
//     unknown set presented as a total;
//   · an empty list drawn under a heading after a refused read, which tells a
//     self-employed person they issued nothing in a quarter;
//   · a late-cancellation fee — MAJOR units — run through the minor-unit
//     formatter, which is a hundred-fold error in a money column;
//   · a currency-less amount rendered as a nought rather than as a hole;
//   · an instant printed in Greenwich's calendar day while the filter placed it
//     on the coach's own, so a row is dated outside the period that contains it.
import {
  statementLines, NO_CURRENCY_LINE,
  type StatementLinePart,
} from './statementLines';
import {
  statementItemsCsv, coachStatement, calendarYear, customRange,
  PERIOD_UNREADABLE,
  type StatementInput, type StatementInvoice, type StatementCharge,
  type StatementRefund, type StatementDispute, type StatementCost,
} from './coachStatement';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const Y26 = calendarYear(2026);

/** A local instant, built from parts rather than from a UTC string, so a test
 *  running in any zone means the same wall-clock moment the coach would see. */
const at = (y: number, m: number, d: number, h = 12): string => new Date(y, m - 1, d, h, 0, 0).toISOString();

const invoice = (o: Partial<StatementInvoice> = {}): StatementInvoice =>
  ({ seq: 1, billTo: 'Dana Okoro', description: 'Ten sessions, autumn block', amountCents: 45000, currency: 'GBP', kind: 'requested', issuedOn: '2026-03-04', voidedAt: null, ...o });
const fee = (o: Partial<StatementCharge> = {}): StatementCharge =>
  ({ amount: 25, currency: 'GBP', createdAt: at(2026, 5, 9), waivedAt: null, ...o });
const refund = (o: Partial<StatementRefund> = {}): StatementRefund =>
  ({ refundedCents: 12000, currency: 'GBP', refundedAt: at(2026, 7, 2), on: 'sale', ...o });
const dispute = (o: Partial<StatementDispute> = {}): StatementDispute =>
  ({ amountCents: 9000, currency: 'GBP', status: 'needs_response', reason: 'fraudulent', openedAt: at(2026, 9, 14), closedAt: null, ...o });
const cost = (o: Partial<StatementCost> = {}): StatementCost =>
  ({ description: 'Gym floor rent, October', category: 'rent', amountCents: 40000, currency: 'GBP', paidOn: '2026-10-01', ...o });

function input(over: Partial<StatementInput> = {}): StatementInput {
  return {
    period: Y26,
    issuer: { status: 'ready', name: 'Sam Whitfield', brand: 'Ironhaus Strength' },
    sessions: { status: 'ready', rows: [] },
    packs: { status: 'ready', rows: [] },
    subscriptions: { status: 'ready', rows: [] },
    receipts: { status: 'ready', rows: [] },
    invoices: { status: 'ready', rows: [invoice()] },
    lateCancellations: { status: 'ready', rows: [fee()] },
    payouts: { status: 'ready', hasAccount: true, chargesEnabled: true, detailsSubmitted: true },
    payoutsPaid: { status: 'ready', rows: [] },
    refunds: { status: 'ready', rows: [refund()] },
    disputes: { status: 'ready', rows: [dispute()] },
    costs: { status: 'ready', rows: [cost()] },
    generatedAt: '2027-01-04T09:00:00.000Z',
    ...over,
  };
}

const group = (r: ReturnType<typeof statementLines>, part: StatementLinePart) =>
  r.groups.find((g) => g.part === part)!;

/* ── 1. the five parts are all there, once each, in the file's order ─────── */

{
  const r = statementLines(input());
  eq(r.groups.length, 5, 'every row-bearing part of the record has a group');
  eq(r.groups.map((g) => g.part).join(','),
    'invoice,late cancellation,refund,chargeback,cost',
    'and they are in the order the file writes them, so the two read alike');
  eq(r.withheld, null, 'a period that reads withholds nothing');
  eq(r.total, 5, 'five rows across five parts, counted because every read was whole');

  const inv = group(r, 'invoice').lines[0];
  eq(inv.who, 'Dana Okoro', 'an invoice carries the name it was billed to');
  eq(inv.day, '2026-03-04', 'a bare YYYY-MM-DD is carried as it is stored');
  eq(inv.plain, '450.00', 'the amount is the plain decimal the file carries');
  eq(inv.money, 'GBP 450.00', 'and the screen gets the same figure with its currency beside it');
  eq(inv.status, 'stated requested', 'the coach’s own word, hedged, never upgraded to "unpaid"');
  eq(inv.note, null, 'a row with a currency needs no caveat');
}

/* ── 2. THE ONE THAT MATTERS: the screen is the file ─────────────────────── */

/** RFC4180 enough for the file `statementItemsCsv` writes: CRLF rows, quoted
 *  cells, doubled quotes inside them. Written here rather than imported so the
 *  comparison does not run through any of the code it is checking. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else { cell += c; }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** The five parts the file itemises. Its other rows are `about` and `not read`,
 *  which are the covering note and are drawn elsewhere on the screen. */
const ITEM_PARTS = new Set(['invoice', 'late cancellation', 'refund', 'chargeback', 'cost']);

function assertScreenIsFile(over: Partial<StatementInput>, what: string): void {
  const inp = input(over);
  const s = coachStatement(inp);
  const csv = statementItemsCsv(s, {
    invoices: inp.invoices.rows,
    fees: inp.lateCancellations.rows,
    refunds: inp.refunds.rows,
    disputes: inp.disputes.rows,
    costs: inp.costs.rows,
  });
  const fileRows = parseCsv(csv).filter((r) => ITEM_PARTS.has(r[0]));
  const screen = statementLines(inp).groups.flatMap((g) => g.lines);

  eq(screen.length, fileRows.length, `${what}: the screen lists exactly as many lines as the file carries`);
  const n = Math.min(screen.length, fileRows.length);
  for (let i = 0; i < n; i++) {
    const f = fileRows[i];
    const l = screen[i];
    eq(l.part, f[0], `${what}: line ${i} is the same part on both`);
    eq(l.day, f[1], `${what}: line ${i} is dated the same day on both`);
    eq(l.who, f[2], `${what}: line ${i} names the same person on both`);
    eq(l.what, f[3], `${what}: line ${i} describes the same thing on both`);
    eq(l.currency ?? '', f[4], `${what}: line ${i} is in the same currency on both`);
    eq(l.plain ?? '', f[5], `${what}: line ${i} is the same amount on both`);
    eq(l.status, f[6], `${what}: line ${i} carries the same status word on both`);
    eq(l.note ?? '', f[7], `${what}: line ${i} carries the same caveat on both`);
  }
}

assertScreenIsFile({}, 'the ordinary period');

// Rows on both bounds and outside them. If the two filters ever diverge, this
// is where it shows: a row the screen shows and the file drops is a coach
// vouching for a line that was never sent.
assertScreenIsFile({
  invoices: { status: 'ready', rows: [
    invoice({ seq: 1, issuedOn: '2026-01-01' }),
    invoice({ seq: 2, issuedOn: '2026-12-31' }),
    invoice({ seq: 3, issuedOn: '2025-12-31' }),
    invoice({ seq: 4, issuedOn: '2027-01-01' }),
  ] },
  lateCancellations: { status: 'ready', rows: [
    fee({ createdAt: at(2026, 1, 1, 0) }),
    fee({ createdAt: at(2026, 12, 31, 23) }),
    fee({ createdAt: at(2025, 12, 31, 23) }),
  ] },
  costs: { status: 'ready', rows: [cost({ paidOn: '2026-06-30' }), cost({ paidOn: '2027-06-30' })] },
}, 'rows on and outside both bounds');

// Every hole a row can have: no currency, no amount, no status word, no reason.
assertScreenIsFile({
  invoices: { status: 'ready', rows: [invoice({ currency: null }), invoice({ seq: 2, amountCents: null })] },
  lateCancellations: { status: 'ready', rows: [fee({ currency: null }), fee({ amount: null }), fee({ waivedAt: at(2026, 6, 1) })] },
  refunds: { status: 'ready', rows: [refund({ currency: null }), refund({ refundedCents: null, on: 'renewal' })] },
  disputes: { status: 'ready', rows: [dispute({ status: '   ' }), dispute({ reason: null })] },
  costs: { status: 'ready', rows: [cost({ category: '' }), cost({ currency: null })] },
}, 'rows with holes in them');

// A zero-decimal currency and a three-decimal one, side by side. A yen figure
// divided by a hundred, or a dinar rounded to two places, is the same figure
// being wrong in the file and on the screen in different directions.
assertScreenIsFile({
  invoices: { status: 'ready', rows: [
    invoice({ currency: 'JPY', amountCents: 45000 }),
    invoice({ seq: 2, currency: 'KWD', amountCents: 45000 }),
  ] },
  lateCancellations: { status: 'ready', rows: [fee({ currency: 'JPY', amount: 3000 }), fee({ currency: 'BHD', amount: 12.5 })] },
}, 'currencies that are not two-decimal');

/* ── 3. minor units and major units are not the same formatter ───────────── */

{
  // `charges.amount` is MAJOR — 25 means twenty-five pounds. An invoice's
  // `amount_cents` of 45000 is minor and means four hundred and fifty. The two
  // are a hundred apart and the only thing keeping them apart is which
  // converter each is sent through.
  const r = statementLines(input());
  eq(group(r, 'late cancellation').lines[0].plain, '25.00', 'a fee of 25 is twenty-five whole units, not twenty-five pence');
  eq(group(r, 'late cancellation').lines[0].money, 'GBP 25.00', 'and reads as twenty-five on the screen too');

  const yen = statementLines(input({
    lateCancellations: { status: 'ready', rows: [fee({ currency: 'JPY', amount: 3000 })] },
    invoices: { status: 'ready', rows: [invoice({ currency: 'JPY', amountCents: 3000 })] },
  }));
  eq(group(yen, 'late cancellation').lines[0].plain, '3000', 'a zero-decimal fee keeps every digit');
  eq(group(yen, 'invoice').lines[0].plain, '3000', 'and a zero-decimal minor amount is not divided by a hundred');
}

/* ── 4. a hole is not a nought ───────────────────────────────────────────── */

{
  const r = statementLines(input({
    invoices: { status: 'ready', rows: [invoice({ currency: null })] },
    costs: { status: 'ready', rows: [cost({ amountCents: null })] },
  }));
  const inv = group(r, 'invoice').lines[0];
  eq(inv.plain, null, 'an amount with no currency is not stated as a plain figure');
  eq(inv.money, null, 'and never as a bare number with no currency beside it');
  eq(inv.note, NO_CURRENCY_LINE, 'the row says so on its own line, where the empty cell is');
  ok(!/\b0(\.00)?\b/.test(String(inv.money ?? '')), 'and nothing renders it as nothing charged');

  const c = group(r, 'cost').lines[0];
  eq(c.plain, null, 'a cost with no amount recorded states none');
  eq(c.note, null, 'but it HAS a currency, so it carries no missing-currency caveat');
}

/* ── 5. a read that did not land ─────────────────────────────────────────── */

{
  for (const key of ['invoices', 'lateCancellations', 'refunds', 'disputes', 'costs'] as const) {
    const r = statementLines(input({ [key]: { status: 'error', rows: [] } } as Partial<StatementInput>));
    const g = r.groups.find((x) => (
      key === 'invoices' ? x.part === 'invoice'
      : key === 'lateCancellations' ? x.part === 'late cancellation'
      : key === 'refunds' ? x.part === 'refund'
      : key === 'disputes' ? x.part === 'chargeback'
      : x.part === 'cost'
    ))!;
    eq(g.count, null, `${key}: a refused read is counted as unknown, never as zero`);
    ok(!!g.withheld, `${key}: and the group says out loud that it could not be read`);
    eq(r.total, null, `${key}: and no total is stated over a hole`);
  }

  // 'partial' is the subtler one: the rows present are real and are shown, and
  // what may not be said is how many there are.
  const part = statementLines(input({ invoices: { status: 'partial', rows: [invoice(), invoice({ seq: 2 })] } }));
  const g = group(part, 'invoice');
  eq(g.lines.length, 2, 'the rows a short read did return are real and are listed');
  eq(g.count, null, 'but a prefix of an unknown set is not a total');
  ok(!!g.withheld, 'and the sentence saying so is on the group');
  eq(part.total, null, 'nor is it added into one');

  // 'loading' collapses into a withholding for the same reason it does on an
  // invoice: a document is checked and sent in one gesture, so a read still in
  // flight is a read that did not answer.
  const loading = statementLines(input({ costs: { status: 'loading', rows: [] } }));
  eq(group(loading, 'cost').count, null, 'a read still in flight states no count');
  ok(!!group(loading, 'cost').withheld, 'and says why');
}

/* ── 6. no period, no lines, and it says which ───────────────────────────── */

{
  // `customRange` refuses a backwards pair rather than swapping it, so this is
  // a period the screen can hold and nothing can be placed inside.
  const broken = customRange('not-a-date', '2026-12-31');
  eq(broken, null, 'a period built from rubbish is refused rather than invented');

  const r = statementLines(input({ period: { from: '', to: '', label: 'nothing' } }));
  eq(r.groups.length, 0, 'with no period there is no group to draw');
  eq(r.total, null, 'and nothing to count');
  eq(r.withheld, PERIOD_UNREADABLE, 'and the screen says the period is what could not be read, not the record');
}

/* ── 7. an instant is dated in the coach’s own calendar ──────────────────── */

{
  // The filter uses local midnights; printing `iso.slice(0, 10)` would use
  // Greenwich's. Late on the last day of a period, west of Greenwich, those are
  // different days — and an accountant holding a file headed "1–31 March" would
  // read a row dated in April. The screen must land on the same day the filter
  // did, whatever zone this test runs in.
  const late = at(2026, 3, 31, 18);
  const march = customRange('2026-03-01', '2026-03-31')!;
  const r = statementLines(input({
    period: march,
    lateCancellations: { status: 'ready', rows: [fee({ createdAt: late })] },
    invoices: { status: 'ready', rows: [] },
    refunds: { status: 'ready', rows: [] },
    disputes: { status: 'ready', rows: [] },
    costs: { status: 'ready', rows: [] },
  }));
  const lines = group(r, 'late cancellation').lines;
  eq(lines.length, 1, 'a fee taken on the last evening of the period is inside it');
  eq(lines[0].day, '2026-03-31', 'and is dated on the day the coach was standing in, not Greenwich’s');
  ok(lines[0].when !== '—', 'and the spelled-out day is a day rather than a dash');
}

/* ── 8. nothing here is summed ───────────────────────────────────────────── */

{
  // Two currencies in one group. `total` counts ROWS — the one number in this
  // file that is allowed to exist — and no money figure is combined anywhere.
  const r = statementLines(input({
    invoices: { status: 'ready', rows: [invoice({ currency: 'GBP' }), invoice({ seq: 2, currency: 'AED' })] },
  }));
  eq(group(r, 'invoice').count, 2, 'two invoices are two rows');
  const monies = group(r, 'invoice').lines.map((l) => l.money);
  eq(monies[0], 'GBP 450.00', 'each keeps its own currency');
  eq(monies[1], 'AED 450.00', 'and the other keeps its own');
  ok(!('amount' in (r as unknown as Record<string, unknown>)), 'and the result carries no combined money figure at all');
}

if (errors.length) {
  console.error(`statementLines: ${errors.length} failure(s)`);
  for (const e of errors) console.error(' · ' + e);
  process.exit(1);
}
console.log('statementLines: all assertions passed');
