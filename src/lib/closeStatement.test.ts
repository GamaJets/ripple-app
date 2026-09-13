// The close as an accountant's statement. Compile with tsc, run with node.
//
// The assertions that matter are about the four things a screen dump could not
// say and a statement has to: whether the month is FILED, what was filed as
// against what reads today, that a difference is reported and never corrected,
// and what denomination every amount is in. Two of those are refusals, and a
// refusal that quietly degrades into a number is the failure this file exists
// to catch — an unknown currency printing an amount anyway, or a failed read
// printing a subtotal over whatever came back.
import {
  closeStatementSections, STATEMENT_BASIS,
  type StatementInput, type StatementSection,
} from './closeStatement';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a statement, as /close would hand one in ──────────────────────────────── */

const input = (o: Partial<StatementInput> = {}): StatementInput => ({
  gymName: 'Iron Yard',
  monthKey: '2026-08',
  periodLabel: 'August 2026',
  firstDay: '2026-08-01',
  lastDay: '2026-08-31',
  generatedAt: '13 Sep 2026, 09:14',
  preparedBy: 'Dana Okafor',
  filingRead: true,
  filing: {
    closedAt: '1 Sep 2026, 10:02',
    closedByName: 'Dana Okafor',
    note: null,
    blockersAtClose: null,
  },
  history: [],
  figures: [
    { label: 'Taken', filedCents: 420000, filedCurrency: 'GBP', liveCents: 420000, liveCurrency: 'GBP' },
    { label: 'Payroll', filedCents: 180000, filedCurrency: 'GBP', liveCents: 180000, liveCurrency: 'GBP' },
  ],
  drift: [],
  receipts: [{ currency: 'GBP', count: 14, cents: 420000 }],
  receiptsWhole: true,
  ...o,
});

const find = (s: StatementSection[], title: string): StatementSection => {
  const hit = s.find((x) => x.title === title);
  if (!hit) { errors.push(`no section titled ${title}`); return { title, prose: [], columns: null, rows: [] }; }
  return hit;
};
const said = (s: StatementSection): string => [...s.prose, ...s.rows.map((r) => r.join(' '))].join(' ');

/* ── the order is the argument ─────────────────────────────────────────────── */
{
  const s = closeStatementSections(input());
  eq(s[0].title, 'STATEMENT OF MONTH-END CLOSE', 'the front matter is first');
  eq(s[1].title, 'FILING', 'whether it is filed comes before any figure');
  eq(s[s.length - 1].title, 'BASIS OF PREPARATION', 'the basis is stated, and last');
  eq(s.length, 6, 'six sections, always — a missing part is prose, never an absent heading');
}

/* ── is this month closed? the question the old file answered wrongly ──────── */
{
  const closed = closeStatementSections(input());
  ok(said(find(closed, 'STATEMENT OF MONTH-END CLOSE')).includes('CLOSED'),
    'a filed month says so in the front matter');
  ok(said(find(closed, 'FILING')).includes('Dana Okafor'),
    'and says who filed it');

  const open = closeStatementSections(input({ filing: null, figures: [] }));
  ok(said(find(open, 'STATEMENT OF MONTH-END CLOSE')).includes('NOT CLOSED'),
    'an unfiled month says that instead of a verdict about whether it could be');
  ok(/may still move/i.test(said(find(open, 'FILING'))),
    'and warns that its figures are not final');

  /*
   * The third answer, which is the one that did not exist.
   *
   * A failed read of `gym_month_closes` printed as "not closed" everywhere
   * before that distinction was drawn, and it is the answer that gets a month
   * closed twice — by somebody holding a file that told them it never was.
   */
  const unread = closeStatementSections(input({ filingRead: false }));
  const word = String(find(unread, 'STATEMENT OF MONTH-END CLOSE').rows.find((r) => r[0] === 'Filing status')?.[1] ?? '');
  ok(/UNKNOWN/.test(word), 'an unreadable filing record is UNKNOWN, not NOT CLOSED');
  ok(!/NOT CLOSED/.test(word), 'and never says the month is open');
  ok(/not the same as it being\s+open/i.test(said(find(unread, 'FILING'))),
    'the filing section says outright that unknown is not open');
}

/* ── the filed figures stand, and the movement is REPORTED ─────────────────── */
{
  const moved = closeStatementSections(input({
    figures: [{ label: 'Taken', filedCents: 420000, filedCurrency: 'GBP', liveCents: 405000, liveCurrency: 'GBP' }],
    drift: ['Taken was 4,200.00 at the close and is 4,050.00 now.'],
  }));
  const pos = find(moved, 'FILED POSITION, AND THE SAME FIGURES TODAY');
  eq(pos.rows[0][1], '4200.00', 'the filed amount is the one that was filed');
  eq(pos.rows[0][3], '4050.00', 'and today is beside it rather than instead of it');
  ok(/never recomputed/i.test(said(pos)), 'the statement says the filed figure is not recomputed');

  const mv = find(moved, 'MOVEMENT SINCE THE CLOSE');
  eq(mv.rows.length, 1, 'one drift line in, one row out — the sentences are driftSince’s own');
  ok(/not by itself\s+an error/i.test(said(mv)),
    'and a difference is not called an error: a re-attributed payment legitimately moves a month');
  ok(/filed figure stands/i.test(said(mv)), 'and the filed figure is the one that stands');

  const still = closeStatementSections(input());
  ok(/exactly as it read/i.test(said(find(still, 'MOVEMENT SINCE THE CLOSE'))),
    'a month that has not moved says so rather than leaving the section empty');

  const open = closeStatementSections(input({ filing: null, figures: [], drift: [] }));
  ok(/nothing to compare/i.test(said(find(open, 'FILED POSITION, AND THE SAME FIGURES TODAY'))),
    'an unfiled month has no filed position and does not invent one');
  eq(find(open, 'FILED POSITION, AND THE SAME FIGURES TODAY').columns, null,
    'and offers no table, which is not the same as an empty one');
}

/* ── every amount in whole units of a currency somebody actually chose ─────── */
{
  // The defect the minor-unit column carried: a reader assumes a hundred. It is
  // one in Tokyo and a thousand in Kuwait, and `minorToDecimal` asks.
  const jpy = closeStatementSections(input({
    figures: [{ label: 'Taken', filedCents: 50000, filedCurrency: 'JPY', liveCents: 50000, liveCurrency: 'JPY' }],
    receipts: [{ currency: 'JPY', count: 3, cents: 50000 }],
  }));
  eq(find(jpy, 'RECEIPTS FOR THE PERIOD, BY CURRENCY').rows[0][2], '50000',
    '¥50,000 is 50000 — there is no sen, so the minor unit IS the yen');
  const kwd = closeStatementSections(input({
    receipts: [{ currency: 'KWD', count: 1, cents: 12340 }],
  }));
  eq(find(kwd, 'RECEIPTS FOR THE PERIOD, BY CURRENCY').rows[0][2], '12.340',
    'a dinar has three places, not two');

  // The refusal. An amount with no currency is not written down at all.
  const bare = closeStatementSections(input({
    receipts: [{ currency: null, count: 2, cents: 9900 }],
    figures: [{ label: 'Payroll', filedCents: 180000, filedCurrency: null, liveCents: 180000, liveCurrency: null }],
  }));
  const rec = find(bare, 'RECEIPTS FOR THE PERIOD, BY CURRENCY');
  eq(rec.rows[0][2], null, 'an amount in no currency is a blank cell, never a bare number');
  eq(rec.rows[0][1], 2, 'the COUNT is still sayable — it is not an amount of anything');
  ok(String(rec.rows[0][0]).includes('no currency recorded'),
    'and the line says what it is rather than borrowing a code from another row');
  eq(find(bare, 'FILED POSITION, AND THE SAME FIGURES TODAY').rows[0][1], null,
    'the same refusal in the filed column, where it would be permanent');
}

/* ── never a total across two currencies ───────────────────────────────────── */
{
  const two = closeStatementSections(input({
    receipts: [
      { currency: 'EUR', count: 4, cents: 60000 },
      { currency: 'GBP', count: 10, cents: 360000 },
    ],
  }));
  const rec = find(two, 'RECEIPTS FOR THE PERIOD, BY CURRENCY');
  eq(rec.rows.length, 2, 'two currencies are two lines');
  ok(/no total across these lines/i.test(said(rec)), 'and the file says why there is no total');
  ok(rec.rows.every((r) => r[0] === 'EUR' || r[0] === 'GBP'), 'neither line borrows the other’s code');

  const one = closeStatementSections(input());
  ok(!/no total across/i.test(said(find(one, 'RECEIPTS FOR THE PERIOD, BY CURRENCY'))),
    'a single-currency gym is not lectured about a problem it does not have');
}

/* ── a failed or truncated read is not an empty month ──────────────────────── */
{
  const partial = closeStatementSections(input({ receiptsWhole: false }));
  const rec = find(partial, 'RECEIPTS FOR THE PERIOD, BY CURRENCY');
  eq(rec.columns, null, 'a read that did not come back whole produces no table at all');
  ok(/unknown, not nil/i.test(said(rec)), 'and says outright that this is unknown rather than nothing');

  const empty = closeStatementSections(input({ receipts: [] }));
  ok(/No payments are recorded/i.test(said(find(empty, 'RECEIPTS FOR THE PERIOD, BY CURRENCY'))),
    'a genuinely empty month is allowed to say so — the read came back whole');
}

/* ── what was closed OVER, and what was closed and then reopened ───────────── */
{
  const over = closeStatementSections(input({
    filing: {
      closedAt: '1 Sep 2026, 10:02', closedByName: 'Dana Okafor', note: 'Signed off with Priya.',
      blockersAtClose: '12 sessions still need an outcome',
    },
  }));
  const f = find(over, 'FILING');
  ok(said(f).includes('12 sessions still need an outcome'),
    'a close taken over a blocker carries the blocker verbatim');
  ok(said(f).includes('Signed off with Priya.'), 'and the note, which is a different thing');
  ok(/decision somebody took/i.test(said(f)), 'and reads as a decision rather than as an error');

  const reopened = closeStatementSections(input({
    history: [{
      closedAt: '1 Sep 2026, 10:02', closedByName: 'Dana Okafor',
      reopenedAt: '4 Sep 2026, 16:40', reopenedByName: 'Dana Okafor',
      reopenReason: 'Saturday’s cash was banked late.',
    }],
  }));
  ok(/closed and reopened/i.test(said(find(reopened, 'FILING'))),
    'a month that was reopened says so — it is the most important fact for anybody holding the old file');
}

/* ── a name that could not be read is not an empty field ───────────────────── */
{
  const s = closeStatementSections(input({ gymName: null, preparedBy: null }));
  const head = find(s, 'STATEMENT OF MONTH-END CLOSE');
  ok(String(head.rows.find((r) => r[0] === 'Gym')?.[1]).includes('could not be read'),
    'a statement about nobody says whose name is missing rather than leaving the entity blank');
  ok(String(head.rows.find((r) => r[0] === 'Prepared by')?.[1]).includes('could not be read'),
    'and the same for who produced it');
}

/* ── the basis is stated, and states the things people assume ──────────────── */
{
  const b = find(closeStatementSections(input()), 'BASIS OF PREPARATION');
  eq(b.prose, STATEMENT_BASIS, 'the basis section is the constant, so it cannot drift per caller');
  const all = STATEMENT_BASIS.join(' ');
  ok(/not a profit figure/i.test(all), 'it says the month is not a profit figure');
  ok(/not netted/i.test(all), 'that nothing is netted');
  ok(/not been reconciled against a bank/i.test(all), 'that nothing here has seen a bank');
  ok(/not a record that anybody has been paid/i.test(all), 'and that payroll is not a payment');
}

if (errors.length) {
  console.error(`closeStatement: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('closeStatement ok');
