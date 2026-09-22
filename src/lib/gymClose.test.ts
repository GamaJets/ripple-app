// Closing a month, and keeping it closed. Compile with tsc, run with node.
//
// The assertions that matter here are about the SNAPSHOT. A close stores four
// figures and a count, and each of them has to be the figure the screen was
// showing when somebody pressed the button — a snapshot that read
// `owed.settledCents` where the tile renders `arrears.outstandingCents` would
// store a plausible number against the wrong label, permanently, and the screen
// it came from would still look right.
import {
  snapshotOf, closeBlocker, reopenBlocker, driftSince, liveCloseFor, closedMonthBlocker,
  fetchCloses, closeMonth,
  type MonthCloseRow, type CloseSnapshot,
} from './gymClose';
// The pass half of the comparison lives in src/lib/ownerClose.ts and is read
// here on purpose. The rule this file is protecting is a JOINT one — what
// `fetchCloses` puts on a row decides whether `passDriftSince`' absent-versus-
// null guard fires — and a test that only ever looked at one side of it would
// pass while the product reported every pre-2970 close as a month that moved.
import { passSnapshotOf, passDriftSince } from './ownerClose';
import type { MonthClose, ClosePasses } from './monthEnd';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a close, as it would arrive from buildClose ───────────────────────────── */

const closeOf = (o: Partial<MonthClose> = {}): MonthClose => ({
  window: {
    key: '2026-08', label: 'August 2026',
    firstDay: '2026-08-01', lastDay: '2026-08-31',
    fromIso: '2026-08-01T00:00:00.000Z', toIso: '2026-09-01T00:00:00.000Z',
  },
  ended: true,
  income: {
    takenCents: 420000, count: 14, byMethod: [], currencies: ['GBP'],
    mixedCurrency: false,
    unattributed: 1, unattributedCents: 2500, unattributedCurrency: 'GBP',
  },
  purpose: [],
  owed: {
    issued: 6, settledCents: 300000, settled: 4,
    outstandingCents: 90000, outstanding: 2,
    overdueCents: 45000, overdue: 1,
    droppedCents: null, dropped: 0, currencies: ['GBP'], mixedCurrency: false,
  },
  arrears: {
    issued: 9, settledCents: 300000, settled: 4,
    outstandingCents: 155000, outstanding: 5,
    overdueCents: 60000, overdue: 2,
    droppedCents: null, dropped: 0, currencies: ['GBP'], mixedCurrency: false,
  },
  check: null,
  payroll: {
    lines: [],
    total: { currency: 'GBP', mixedCurrency: false, cents: 180000, delivered: 40, payable: 40, priced: 40, unmarked: 0, settleable: true },
    blocker: null,
    // What `payrollOf` derived from the sessions the total is a sum of. GBP
    // here and AED in `currency` below would be the whole point of the split.
    currency: 'GBP', mixedCurrency: false, currencyNote: null,
  },
  passes: null,
  blockers: [],
  state: 'closeable',
  warning: null,
  ...o,
});

/* ── the snapshot is the tiles, and only the tiles ─────────────────────────── */

/** The three the screen hands in. The payroll's own comes off the close. */
const GBP = { taken: 'GBP', invoiced: 'GBP', outstanding: 'GBP' };

{
  const s = snapshotOf(closeOf(), GBP);

  eq(s.takenCents, 420000, 'Taken is the income figure the first tile renders');
  // "Billed this month" is settled PLUS outstanding, which is what /close's own
  // sumOrNull produces. Storing `owed.outstandingCents` alone here would be a
  // smaller, entirely plausible number under the same label.
  eq(s.invoicedCents, 390000, 'Billed is settled plus outstanding, exactly as the tile computes it');
  // "Still owed" is ARREARS, not this month's invoices: everything unpaid at
  // the month end, whatever month it was raised in. The two differ by every
  // invoice from an earlier month that is still open, and confusing them is the
  // difference between a gym owed 90,000 and one owed 155,000.
  eq(s.outstandingCents, 155000, 'Still owed is the arrears figure, not the month’s own invoices');
  eq(s.payrollCents, 180000, 'Payroll is the total, in minor units');
  eq(s.unmarkedSessions, 0, 'and the unmarked count travels with it');
  eq(s.takenCurrency, 'GBP', 'each figure is stored with its OWN currency, so it can be read back');
  eq(s.invoicedCurrency, 'GBP', 'the invoices state theirs');
  eq(s.outstandingCurrency, 'GBP', 'and so do the arrears');
  eq(s.payrollCurrency, 'GBP', 'and payroll takes the code its own sessions were priced in');
  eq(s.currency, null, 'the legacy single-code column is never written again');
  eq(s.blockersAtClose, null, 'a clean month records nothing in the way');
}

/* ── four figures, four currencies ─────────────────────────────────────────
 *
 * The defect: ONE code, `currencyOf(rec, gymCcy)`, which is payments-first, was
 * stored beside all four figures. A gym whose August takings happened to be all
 * AED filed its GBP invoices, its GBP arrears and its GBP payroll as dirhams —
 * permanently, in the row every later drift line is measured against and the
 * handoff CSV exports.
 */
{
  const c = closeOf();
  const s = snapshotOf(c, { taken: 'AED', invoiced: 'GBP', outstanding: 'GBP' });
  eq(s.takenCurrency, 'AED', 'the takings wear what the PAYMENTS agreed on');
  eq(s.invoicedCurrency, 'GBP', 'and the invoices are not relabelled by them');
  eq(s.outstandingCurrency, 'GBP', 'nor are the arrears');
  eq(s.payrollCurrency, 'GBP',
    'nor is payroll, which is priced by the sessions it is a sum of and never by a card machine');
}

{
  // A figure whose own rows name no single money stores none. Not the gym's,
  // not a neighbour's — that substitution is the whole defect.
  const s = snapshotOf(closeOf(), { taken: null, invoiced: null, outstanding: null });
  eq(s.takenCurrency, null, 'payments that disagree name no currency');
  eq(s.invoicedCurrency, null, 'and neither do invoices that disagree');
  eq(s.outstandingCurrency, null, 'nor arrears');
  eq(s.takenCents, 420000, 'and the figure is still stored — the currency is what is unknown, not the number');
}

{
  /*
   * A payroll total across two currencies is REFUSED, not filed.
   *
   * `payrollTotal` adds the per-trainer lines and has no opinion about money,
   * so `total.cents` is still a number here. It is a sum of dirhams and pounds
   * and is not an amount of anything, and stored with a null currency it would
   * read as "the currency was not recorded" — which an accountant resolves with
   * the gym's code, the exact substitution this change exists to stop.
   */
  const mixedPay = closeOf({
    payroll: {
      lines: [],
      total: { currency: 'GBP', mixedCurrency: false, cents: 180000, delivered: 40, payable: 40, priced: 40, unmarked: 0, settleable: true },
      blocker: null,
      currency: null, mixedCurrency: true,
      currencyNote: 'This period covers more than one currency — 20 sessions in AED, 20 sessions in GBP — so there is no single total.',
    },
  });
  const s = snapshotOf(mixedPay, GBP);
  eq(s.payrollCents, null, 'a payroll total spanning two currencies is not filed as a figure');
  eq(s.payrollCurrency, null, 'and it is given no code either');
  eq(s.takenCents, 420000, 'the other three figures are unaffected — one bad total does not empty the close');
}

{
  // Rates snapshotted before supabase/parts/1010 are a real sum in an unknown
  // unit, not a sum across two known ones. The figure IS stored; the currency
  // is null and says so.
  const unrecorded = closeOf({
    payroll: {
      lines: [],
      total: { currency: 'GBP', mixedCurrency: false, cents: 180000, delivered: 40, payable: 40, priced: 40, unmarked: 0, settleable: true },
      blocker: null,
      currency: null, mixedCurrency: false,
      currencyNote: 'These 40 sessions were filed before Repple recorded what money a session rate is in.',
    },
  });
  const s = snapshotOf(unrecorded, GBP);
  eq(s.payrollCents, 180000, 'a run of unrecorded rates is a real figure and is filed');
  eq(s.payrollCurrency, null,
    'with no currency, rather than with the gym’s code stamped over a guess about the past');
}

{
  // Every one of these is nullable ON SCREEN, so every one is nullable here. A
  // close that turned an unread month into zeros would store the exact lie the
  // whole screen is built to refuse.
  const s = snapshotOf(closeOf({ income: null, owed: null, arrears: null, payroll: null }),
    { taken: null, invoiced: null, outstanding: null });
  eq(s.takenCents, null, 'an unread payments month stores no figure, not a zero');
  eq(s.invoicedCents, null, 'nor an unread invoice register');
  eq(s.outstandingCents, null, 'nor the arrears');
  eq(s.payrollCents, null, 'nor the payroll');
  eq(s.unmarkedSessions, null, 'nor the unmarked count');
  eq(s.takenCurrency, null, 'and a gym with no currency stores none rather than a guess');
  eq(s.payrollCurrency, null, 'including for the payroll, whose close carries no payroll at all');
}

{
  // A mixed-currency month has no total ON SCREEN, and acquires none by being
  // closed.
  const c = closeOf();
  const mixed = closeOf({ income: { ...c.income!, takenCents: null, currencies: ['GBP', 'AED'] } });
  eq(snapshotOf(mixed, GBP).takenCents, null,
    'a month whose payments are in two currencies is closed with no takings figure, not with one of them');
}

{
  // Closing over a stated blocker is allowed, and the reasons are stored word
  // for word — "closed over 3 blockers" is nothing anybody can act on in March.
  const blocked = closeOf({
    state: 'blocked',
    blockers: [
      { kind: 'unmarked_sessions', text: '12 sessions still need an outcome.' },
      { kind: 'money_gap', text: 'Two invoices marked paid have no payment behind them.' },
    ],
    payroll: {
      lines: [], total: { currency: 'GBP', mixedCurrency: false, cents: 180000, delivered: 40, payable: 52, priced: 40, unmarked: 12, settleable: false },
      blocker: 'unmarked', currency: 'GBP', mixedCurrency: false, currencyNote: null,
    },
  });
  const s = snapshotOf(blocked, GBP);
  ok((s.blockersAtClose ?? '').includes('12 sessions'),
    'the blockers are stored verbatim, so a month signed off over a known problem reads as a decision');
  ok((s.blockersAtClose ?? '').includes('no payment behind them'), 'and all of them, not the first');
  eq(s.unmarkedSessions, 12, 'the unmarked count is what says the payroll figure is a floor rather than a total');
}

/* ── when a month may be closed ────────────────────────────────────────────── */

const row = (o: Partial<MonthCloseRow> = {}): MonthCloseRow => ({
  id: 'c1', monthKey: '2026-08', closedAt: '2026-09-01T09:00:00Z',
  closedBy: 'o1', closedByName: 'Owner', note: null,
  takenCents: 420000, invoicedCents: 390000, outstandingCents: 155000,
  payrollCents: 180000,
  takenCurrency: 'GBP', invoicedCurrency: 'GBP', outstandingCurrency: 'GBP', payrollCurrency: 'GBP',
  // Null on everything written since supabase/parts/2540. The column stays for
  // rows a console tab on the previous bundle could still write.
  currency: null, unmarkedSessions: 0, blockersAtClose: null,
  reopenedAt: null, reopenedBy: null, reopenedByName: null, reopenReason: null, ...o,
});

eq(closeBlocker('2026-08', true, null), null, 'a finished month that is not closed may be closed');
ok(closeBlocker('2026-08', true, row()) != null, 'a month already closed is refused rather than closed twice');
eq(closeBlocker('2026-08', true, row({ reopenedAt: '2026-09-05T00:00:00Z', reopenReason: 'late cash' })), null,
  'a REOPENED month may be closed again — the reopen is what put it back on the table');
// Not advisory. Closing a month that is still running locks the desk out of
// recording payments for the rest of it, through the trigger in
// supabase/parts/182, and the error would name a month that has not ended.
ok(closeBlocker('2026-09', false, null) != null, 'a month still running cannot be closed');

ok(reopenBlocker('') != null, 'a reopen with no reason is refused');
ok(reopenBlocker('   ') != null, 'and whitespace is not a reason');
eq(reopenBlocker('Late cash from the 31st'), null, 'a reason is a reason');

{
  const rows = [
    row({ id: 'a', monthKey: '2026-08', reopenedAt: '2026-09-05T00:00:00Z', reopenReason: 'late cash' }),
    row({ id: 'b', monthKey: '2026-08' }),
    row({ id: 'c', monthKey: '2026-07' }),
  ];
  eq(liveCloseFor('2026-08', rows)?.id, 'b', 'the live close is the one that has not been reopened');
  eq(liveCloseFor('2026-06', rows), null, 'a month with no close row is open');
  eq(liveCloseFor('2026-08', null), null, 'and an unread history offers no close at all');
}

/* ── the record moving after a close ───────────────────────────────────────── */

{
  // The currency comes IN with the figure now, and the formatter prints it —
  // which is what makes a change of money visible as drift at all.
  const fmt = (c: number | null, ccy: string | null) =>
    (c == null ? '—' : `${ccy ?? '(no currency)'} ${(c / 100).toFixed(2)}`);
  const stored = row();

  const same: CloseSnapshot = {
    takenCents: 420000, invoicedCents: 390000, outstandingCents: 155000,
    payrollCents: 180000,
    takenCurrency: 'GBP', invoicedCurrency: 'GBP', outstandingCurrency: 'GBP', payrollCurrency: 'GBP',
    currency: null,
    // The fifth figure rides on the snapshot now. `driftSince` does not read
    // it — `passDriftSince` does, and `filingOf` appends its lines to these —
    // so these four are here to satisfy the type and are asserted about below,
    // where the function that actually compares them lives.
    passCents: 86000, passCurrency: 'GBP', passesSold: 5, passesPriced: 4,
    unmarkedSessions: 0, blockersAtClose: null,
  };
  eq(driftSince(stored, same, fmt).length, 0, 'a month that has not moved reports nothing');

  const moved: CloseSnapshot = { ...same, takenCents: 415000 };
  const d = driftSince(stored, moved, fmt);
  eq(d.length, 1, 'one figure moved, one line');
  ok(d[0].includes('4,200.00') || d[0].includes('4200.00'), 'the line names what it was');
  ok(d[0].includes('4,150.00') || d[0].includes('4150.00'), 'and what it is now');

  // One side unknown is still a difference worth naming, and naming it needs
  // words: "was 4,200.00, is now not known" is a sentence and "4,200.00 → —"
  // is a puzzle.
  const unread: CloseSnapshot = { ...same, payrollCents: null };
  ok(driftSince(stored, unread, fmt)[0].includes('not known'),
    'a figure that has become unreadable is reported in words, not as a dash');

  const unmarkedNow: CloseSnapshot = { ...same, unmarkedSessions: 3 };
  eq(driftSince(stored, unmarkedNow, fmt).length, 1, 'the unmarked count is watched too');

  /*
   * The drift this could not see at all.
   *
   * `was === is` returned early, so a payroll figure of 180,000 filed in GBP
   * and reading 180,000 in EUR today — a gym that changed `tenants.currency`,
   * or a coach re-rated in another money — reported that the month had not
   * moved. The number had not. The money had, and that is a different amount.
   */
  const reDenominated: CloseSnapshot = { ...same, payrollCurrency: 'EUR' };
  const dc = driftSince(stored, reDenominated, fmt);
  eq(dc.length, 1, 'the same number in a different currency is a difference');
  ok(dc[0].startsWith('Payroll'), 'and it is named as the payroll line');
  ok(dc[0].includes('GBP') && dc[0].includes('EUR'), 'with both moneys in it, so the reader can see which way');

  // Each figure is compared in its OWN currency, so a takings-side change
  // cannot report itself as three lines about invoices.
  const takenMoved: CloseSnapshot = { ...same, takenCents: 415000, takenCurrency: 'AED' };
  eq(driftSince(stored, takenMoved, fmt).length, 1, 'one figure, one line, whatever its currency did');

  // A row written before the split: the legacy code speaks for the takings and
  // for nothing else. Nothing on the platform has ever written one — the table
  // was empty when the columns were split — so this is about a console tab left
  // open on the previous bundle.
  const legacy = row({
    takenCurrency: null, invoicedCurrency: null, outstandingCurrency: null, payrollCurrency: null,
    currency: 'GBP',
  });
  eq(driftSince(legacy, same, fmt).length, 3,
    'a legacy row drifts on the three figures whose currency it never recorded, and not on the takings');
}

/* ── a closed month refuses money dated into it ───────────────────────────
 *
 * Part 182 locked payments and invoices and nothing else, and /payroll never
 * read this table at all — so a settlement could land in a month that had been
 * signed off, and /accounting's "Money out" for a filed month moved underneath
 * the accountant. Part 481 makes the database refuse it; this is the rule that
 * refuses it with the run still on screen.
 */
{
  const closed = (monthKey: string, reopenedAt: string | null = null): MonthCloseRow => ({
    id: 'c-' + monthKey, monthKey, closedAt: '2026-09-02T09:00:00.000Z',
    closedBy: null, closedByName: null, note: null,
    takenCents: null, invoicedCents: null, outstandingCents: null, payrollCents: null,
    takenCurrency: null, invoicedCurrency: null, outstandingCurrency: null, payrollCurrency: null,
    currency: null, unmarkedSessions: null, blockersAtClose: null,
    reopenedAt, reopenedBy: null, reopenedByName: null,
    reopenReason: reopenedAt ? 'a late payment' : null,
  });

  ok(closedMonthBlocker('2026-08-01', [closed('2026-08')]) != null,
    'a payroll run dated into a closed August is refused');
  ok((closedMonthBlocker('2026-08-01', [closed('2026-08')]) ?? '').includes('2026-08'),
    'and the refusal names the month, because the way out is reopening that one');
  eq(closedMonthBlocker('2026-09-01', [closed('2026-08')]), null,
    'a run for an open month is not refused by a neighbouring close');
  eq(closedMonthBlocker('2026-08-01', [closed('2026-08', '2026-09-03T10:00:00.000Z')]), null,
    'a month that was reopened is open again — the row stays as history, not as a lock');
  eq(closedMonthBlocker('2026-08-01', []), null, 'a gym that has closed nothing blocks nothing');
  eq(closedMonthBlocker('2026-08-01', null), null,
    'and a close record that could not be READ does not block: part 481 makes the database the backstop');
  eq(closedMonthBlocker('', [closed('2026-08')]), null, 'a date nobody stated cannot be placed in a month');
}

/* ── the fifth figure: what the desk sold over the counter ─────────────────
 *
 * The close filed FOUR money figures and the screen showed five. Pass sales
 * went on moving after a month was signed off, forever, because a figure that
 * was never stored cannot drift — so an August close handed to an accountant in
 * September was silent about a real part of August's takings and there was no
 * later way to recover the number.
 *
 * They are not inside `takenCents` and never were: `gym_passes` and
 * `gym_payments` are two independent registers with no link column, so adding
 * them double-counts and dropping one loses income.
 */

const passesOf = (o: Partial<ClosePasses> = {}): ClosePasses => ({
  cents: 86000, priced: 4, sold: 5, currency: 'GBP', currencies: ['GBP'], mixedCurrency: false, ...o,
});

{
  const s = snapshotOf(closeOf({ passes: passesOf() }), GBP);
  eq(s.passCents, 86000, 'the month’s pass sales are filed, as their own figure');
  eq(s.passCurrency, 'GBP', 'in the money the passes themselves were sold in');
  eq(s.passesSold, 5, 'with what the desk sold');
  eq(s.passesPriced, 4, 'and how many carried a price, which is what says the figure is a sum over four of five');
  eq(s.takenCents, 420000,
    'and the card takings are untouched — two registers with no link column, never added and never substituted');
}

{
  /*
   * Two currencies cannot be added. The FIGURE is withheld and the COUNTS are
   * filed, because "five passes were sold and there is no single amount for
   * them" is the true sentence and a 0 is the false one — false in the
   * direction nobody detects, since a zero reconciles against an absence.
   */
  const s = snapshotOf(closeOf({
    passes: passesOf({ cents: 110000, currency: null, currencies: ['AED', 'GBP'], mixedCurrency: true }),
  }), GBP);
  eq(s.passCents, null, 'a month whose priced passes span two moneys files no pass figure');
  ok(s.passCents !== 0, 'and emphatically not 0, which would claim the gym sold nothing that month');
  eq(s.passCurrency, null,
    'nor a code — the gym’s own currency beside a cross-currency sum is the substitution parts/2540 removed');
  eq(s.passesSold, 5, 'while the count of what was sold survives, so a withheld figure cannot read as an empty counter');
  eq(s.passesPriced, 4, 'and so does the count that says how much of the month it would have been a sum over');
  eq(s.takenCents, 420000, 'and one unsayable figure does not empty the rest of the close');
}

{
  /*
   * Cents with NO currency, and it is legitimate.
   *
   * `passRevenueCents` puts null in its code set for a priced pass that states
   * no currency, so a set whose only member is null is ONE UNKNOWN UNIT — a
   * real sum whose label was never recorded — and not two known ones. The same
   * distinction `payrollCurrency` already draws for rates snapshotted before
   * parts/1010. Nothing may coalesce this pair into agreement.
   */
  const s = snapshotOf(closeOf({ passes: passesOf({ currency: null, currencies: [] }) }), GBP);
  eq(s.passCents, 86000, 'priced passes that all state no money are still one real sum, and it is filed');
  eq(s.passCurrency, null, 'with no code, rather than with the gym’s stamped over a guess');
}

{
  // A month that WAS read and had nothing in it, against a month nobody could
  // read. 0 is the answer to the first and is never the answer to the second.
  const empty = snapshotOf(closeOf({
    passes: passesOf({ cents: null, priced: 0, sold: 0, currency: null, currencies: [] }),
  }), GBP);
  eq(empty.passesSold, 0, 'a month read and found empty files a counted zero');
  eq(empty.passesPriced, 0, 'and a counted zero priced');
  eq(empty.passCents, null, 'with no figure, because there is no priced row to sum — not a 0 amount');

  const unread = snapshotOf(closeOf({ passes: null }), GBP);
  eq(unread.passesSold, null, 'while a passes slice that never landed files NULL, which is not the same fact as 0');
  eq(unread.passesPriced, null, 'nor a priced count');
  eq(unread.passCents, null, 'nor a figure');
  eq(unread.passCurrency, null, 'nor a code');
}

{
  /*
   * The shape supabase/parts/2970 refuses, refused here too.
   *
   * The database checks `pass_cents is null or (passes_priced is not null and
   * passes_priced > 0)` — money over no rows is the one shape of this set that
   * cannot be true. A snapshot that produced it would be rejected with a 23514
   * at the moment an owner pressed Close, which is nothing they could act on.
   * `passRevenueCents` nulls its sum at `priced === 0`, so it cannot happen;
   * this is the assertion that says so rather than leaving it reasoned about.
   */
  const shapes = [
    passesOf(),
    passesOf({ currency: null, currencies: [] }),
    passesOf({ cents: null, priced: 0, sold: 0, currency: null, currencies: [] }),
    passesOf({ cents: 110000, currency: null, currencies: ['AED', 'GBP'], mixedCurrency: true }),
    passesOf({ cents: 4000, priced: 1, sold: 1 }),
  ];
  for (const p of shapes) {
    const s = snapshotOf(closeOf({ passes: p }), GBP);
    ok(s.passCents == null || (s.passesPriced != null && s.passesPriced > 0),
      'a filed pass figure always has priced rows behind it — the one shape of these four columns the database refuses');
    ok(s.passesPriced == null || s.passesSold == null || s.passesPriced <= s.passesSold,
      'and never more passes priced than sold');
    ok((s.passesSold ?? 0) >= 0 && (s.passesPriced ?? 0) >= 0, 'and no negative count, which is not a fact about any month');
  }
}

{
  /*
   * `driftSince` does NOT compare the passes, and that is deliberate.
   *
   * `passDriftSince` compares them — it is the only one holding the
   * absent-versus-null guard a pre-2970 row needs, and it words a null as "not
   * a single amount" rather than "not known" — and `filingOf` appends its lines
   * to these. A pass check added here as well would report every movement in
   * them twice, and the headline counts the lines.
   */
  const fmt = (c: number | null, ccy: string | null) => (c == null ? '—' : `${ccy ?? '(no currency)'} ${c}`);
  const stored = row({ passCents: 86000, passCurrency: 'GBP', passesSold: 5, passesPriced: 4 });
  const wildlyDifferentPasses = snapshotOf(closeOf({ passes: passesOf({ cents: 900000, priced: 40, sold: 41 }) }), GBP);
  eq(driftSince(stored, wildlyDifferentPasses, fmt).length, 0,
    'the four money figures have not moved, so driftSince reports nothing — the passes are passDriftSince’s line to draw, once');
}

/* ── reading the four columns back, and the silence that must survive it ───
 *
 * `passDriftSince` reports nothing for a row carrying NONE of the four keys, so
 * that a read which never asked about passes cannot manufacture movement. The
 * moment `fetchCloses` selects the columns that guard stops firing by itself —
 * so what the read puts on the row is now the only thing standing between a
 * gym and a false movement line on every month it closed before parts/2970.
 */

interface Asked { table: string; select: string | null }

function fakeSb(answer: (table: string) => { data: any[] | null; error: unknown }) {
  const asked: Asked[] = [];
  const from = (table: string) => {
    const q: Asked = { table, select: null };
    asked.push(q);
    const chain: any = {
      select: (cols: string) => { q.select = cols; return chain; },
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      range: () => chain,
      then: (res: (v: unknown) => unknown) => res(answer(table)),
    };
    return chain;
  };
  return { sb: { from } as any, asked };
}

/** A `gym_month_closes` row as PostgREST hands it over. */
const dbRow = (o: Record<string, unknown> = {}) => ({
  id: 'c1', month_key: '2026-08', closed_at: '2026-09-01T09:00:00Z', closed_by: null,
  note: null,
  taken_cents: 420000, invoiced_cents: 390000, outstanding_cents: 155000, payroll_cents: 180000,
  taken_currency: 'GBP', invoiced_currency: 'GBP', outstanding_currency: 'GBP', payroll_currency: 'GBP',
  currency: null,
  pass_cents: null, pass_currency: null, passes_sold: null, passes_priced: null,
  unmarked_sessions: 0, blockers_at_close: null,
  reopened_at: null, reopened_by: null, reopen_reason: null,
  ...o,
});

const readOne = async (over: Record<string, unknown>) => {
  const { sb, asked } = fakeSb((t) => (t === 'gym_month_closes' ? { data: [dbRow(over)], error: null } : { data: [], error: null }));
  const rows = await fetchCloses(sb, 'gym');
  return { r: rows[0], select: asked.find((q) => q.table === 'gym_month_closes')?.select ?? '' };
};

async function main() {
  {
    const { select } = await readOne({});
    for (const col of ['pass_cents', 'pass_currency', 'passes_sold', 'passes_priced']) {
      ok(select.split(/\s*,\s*/).includes(col),
        `the read asks for ${col} — a column nothing selects is a figure that was filed and can never be read back`);
    }
  }

  {
    // The row every gym already has. Written before parts/2970, so all four are
    // NULL — and the part says what that means in as many words: this close did
    // not record the passes. It is not a close that filed nulls, and reporting
    // it as one would put a false movement line on every month every gym has
    // ever signed off.
    const { r } = await readOne({});
    ok(!('passCents' in r), 'a close that recorded nothing about the passes comes back with no pass figure key at all');
    ok(!('passCurrency' in r), 'nor a currency key');
    ok(!('passesSold' in r), 'nor a sold count');
    ok(!('passesPriced' in r), 'nor a priced count');

    const liveNow = passSnapshotOf(closeOf({ passes: passesOf() }));
    eq(passDriftSince(r, liveNow, (c, ccy) => `${ccy ?? '?'} ${c}`).length, 0,
      'so a month closed before the passes were ever filed does not suddenly read as a month that moved');
  }

  {
    // A close that DID speak. Every value travels, and it drifts.
    const { r } = await readOne({ pass_cents: 80000, pass_currency: 'GBP', passes_sold: 5, passes_priced: 4 });
    eq(r.passCents, 80000, 'a filed pass figure is read back');
    eq(r.passCurrency, 'GBP', 'with its own code');
    eq(r.passesSold, 5, 'and the sold count');
    eq(r.passesPriced, 4, 'and the priced count');

    const liveNow = passSnapshotOf(closeOf({ passes: passesOf() }));
    const d = passDriftSince(r, liveNow, (c, ccy) => `${ccy ?? '?'} ${c}`);
    eq(d.length, 1, 'and a pass sale recorded after the close reads as exactly one movement');
  }

  {
    // The counts distinguish a month READ AND EMPTY from a month nobody read,
    // and 0 is not null: these keys must survive the absent rule.
    const { r } = await readOne({ pass_cents: null, pass_currency: null, passes_sold: 0, passes_priced: 0 });
    ok('passesSold' in r, 'a close that counted zero passes SPOKE, and its row keeps its keys');
    eq(r.passesSold, 0, 'the counted zero is read back as 0');
    eq(r.passesPriced, 0, 'and so is the priced zero');
    eq(r.passCents, null, 'with no figure beside it, which is right — there was no priced row to sum');

    const liveNow = passSnapshotOf(closeOf({ passes: passesOf() }));
    const d = passDriftSince(r, liveNow, (c, ccy) => `${ccy ?? '?'} ${c}`);
    ok(d.length > 0,
      'and a month that said "nothing was sold" and now shows five sales HAS moved — suppressing that would be the absent rule eating a real fact');
  }

  {
    // Cents with no code. Read back as filed, both halves, uncoalesced — and a
    // month that reads the same way today has not moved.
    const { r } = await readOne({ pass_cents: 86000, pass_currency: null, passes_sold: 5, passes_priced: 4 });
    ok('passCents' in r, 'a real sum in an unrecorded unit is a close that spoke');
    eq(r.passCents, 86000, 'the figure survives');
    eq(r.passCurrency, null, 'and the missing code is left missing, not filled in from anywhere');

    const unstated = passSnapshotOf(closeOf({ passes: passesOf({ currency: null, currencies: [] }) }));
    eq(passDriftSince(r, unstated, (c, ccy) => `${ccy ?? '?'} ${c}`).length, 0,
      'and a month still reading as one unknown unit reports no movement — a coalesced code here would invent one');
  }

  /* ── and what the insert actually carries ──────────────────────────────── */

  const captureInsert = () => {
    let payload: any = null;
    const sb = {
      from: () => ({
        insert: (p: any) => { payload = p; return Promise.resolve({ error: null }); },
      }),
    } as any;
    return { sb, taken: () => payload };
  };

  {
    const cap = captureInsert();
    await closeMonth(cap.sb, 'gym', '2026-08', snapshotOf(closeOf({ passes: passesOf() }), GBP), 'owner', null);
    const p = cap.taken();
    eq(p.pass_cents, 86000, 'closing a month writes the pass figure — a figure nothing writes can never be read back');
    eq(p.pass_currency, 'GBP', 'in its own money');
    eq(p.passes_sold, 5, 'with the sold count');
    eq(p.passes_priced, 4, 'and the priced count');
    eq(p.taken_cents, 420000, 'beside the card takings, which are a different register and stay one');
  }

  {
    // The write that matters most: a month of two moneys. No figure, no code,
    // and the counts go in anyway.
    const cap = captureInsert();
    const mixed = snapshotOf(closeOf({
      passes: passesOf({ cents: 110000, currency: null, currencies: ['AED', 'GBP'], mixedCurrency: true }),
    }), GBP);
    await closeMonth(cap.sb, 'gym', '2026-08', mixed, 'owner', null);
    const p = cap.taken();
    eq(p.pass_cents, null, 'a cross-currency month writes no pass figure');
    ok(p.pass_cents !== 0, 'and never a 0, which an accountant reconciles against an absence and never questions');
    eq(p.pass_currency, null, 'and no code');
    eq(p.passes_sold, 5, 'while the count is written, because passes WERE sold and the record has to say so');
    eq(p.passes_priced, 4, 'and so is the priced count');
  }

  {
    // A close taken over an unread passes slice files four nulls, which is the
    // honest record of a month nobody could speak for.
    const cap = captureInsert();
    await closeMonth(cap.sb, 'gym', '2026-08', snapshotOf(closeOf({ passes: null }), GBP), 'owner', null);
    const p = cap.taken();
    eq(p.passes_sold, null, 'an unread passes slice files no count, rather than a 0 nobody counted');
    eq(p.pass_cents, null, 'and no figure');
  }
}

main().then(
  () => {
    if (errors.length) {
      console.error(`gymClose: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
      process.exit(1);
    }
    console.log('gymClose ok');
  },
  (e) => {
    // A throw is not a pass. Without this the process would exit 0 on an
    // unhandled rejection under some node versions, which is the "no error
    // means it worked" reading this whole file is written against.
    console.error('gymClose: threw before it could finish\n', e);
    process.exit(1);
  },
);
