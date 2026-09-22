// The bill that was not entered before the month was filed.
//
// ── The five this file exists to stop ─────────────────────────────────────
//
//   1. A DATE READ AS AN INSTANT. `paid_on` is a DATE column. `new Date(
//      '2026-08-01').getMonth()` is JULY west of Greenwich, so a rent paid on
//      the first of the month would be judged into the wrong month for half the
//      world — and this module's entire output is "which month is this in". The
//      assertion is that a first-of-the-month and a last-of-the-month cost land
//      in their own month, and `npm run test:zones` runs it in six zones.
//
//   2. A SUPPLIER THE GYM STOPPED USING, REPORTED MISSING FOREVER. An insurer
//      paid January to May and dropped in June is not late in August. A version
//      without rule 2 named it every month for the rest of the year, which is
//      how a warning stops being read.
//
//   3. A COINCIDENCE CALLED A COMMITMENT. Two treadmill repairs in six months
//      is not a standing arrangement.
//
//   4. TWO CURRENCIES IN ONE FIGURE. A landlord paid in pounds and once in
//      euros has no single "usual" amount, and `usual` must withhold rather
//      than print the last one as though the other did not happen.
//
//   5. A CLAIM MADE OVER A READ THAT DID NOT COME BACK WHOLE. A truncated cost
//      ledger makes every line past the cap look missing. That is a false
//      accusation on the screen that permanently files the month, and 'partial'
//      must therefore say nothing at all rather than say something smaller.
//
// Compile with tsc, run with node.
import {
  COST_LOOKBACK_MONTHS, RECURRING_MIN_MONTHS,
  costMonthOf, isMonthKey, monthsBefore, costLineKey,
  standingCosts, missingStandingCosts, costVerdict, costNoteForClose, joinCloseBlockers,
  type CostLine,
} from './closeCosts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const cost = (over: Partial<CostLine> & { paidOn: string }): CostLine => ({
  supplier: 'Ruoni Property Ltd', category: 'rent',
  amountCents: 250_000, currency: 'GBP',
  ...over,
});

/* ── 1. a DATE is not an instant ────────────────────────────────────────── */
{
  eq(costMonthOf('2026-08-01'), '2026-08', 'the first of the month is that month, in every zone');
  eq(costMonthOf('2026-08-31'), '2026-08', 'and so is the last day of it');
  eq(costMonthOf('2026-01-01'), '2026-01', 'including the one that would fall into last year');
  eq(costMonthOf('2026-12-31'), '2026-12', 'and the one that would fall into next');
  eq(costMonthOf(''), null, 'a blank day is not a month');
  eq(costMonthOf('2026-08'), null, 'a month key is not a day and is refused rather than padded');
  eq(costMonthOf('2026-13-01'), null, 'there is no thirteenth month');
  eq(costMonthOf('2026-08-32'), null, 'and no thirty-second day');
  eq(costMonthOf(null), null, 'a missing day is answered rather than thrown at');

  ok(isMonthKey('2026-08'), 'a month key is a month key');
  ok(!isMonthKey('2026-8'), 'an unpadded month is not one — it would sort wrong');
  ok(!isMonthKey('2026-00'), 'and neither is a zeroth month');
}

/* ── the window, stepped as arithmetic ──────────────────────────────────── */
{
  eq(JSON.stringify(monthsBefore('2026-08', 3)), JSON.stringify(['2026-07', '2026-06', '2026-05']),
    'the three months before August are July, June and May, newest first');
  eq(JSON.stringify(monthsBefore('2026-01', 2)), JSON.stringify(['2025-12', '2025-11']),
    'and January steps back over the year boundary');
  eq(monthsBefore('2026-08', 0).length, 0, 'a window of nothing is nothing');
  eq(monthsBefore('nonsense', 3).length, 0, 'and a key that is not one asks for nothing');
  ok(!monthsBefore('2026-08', COST_LOOKBACK_MONTHS).includes('2026-08'),
    'THE month being closed is never evidence about itself');
}

/* ── the key two costs are the same line under ──────────────────────────── */
{
  eq(costLineKey({ supplier: 'EDF Energy', category: 'utilities' }),
    costLineKey({ supplier: 'edf  ENERGY', category: 'utilities' }),
    'one landlord spelled two ways is one line');
  eq(costLineKey({ supplier: 'Gonçalves Cleaning', category: 'staff' }),
    costLineKey({ supplier: 'Goncalves Cleaning', category: 'staff' }),
    'and an accent typed on an English keyboard does not make a second one');
  ok(costLineKey({ supplier: 'EDF', category: 'utilities' })
    !== costLineKey({ supplier: 'EDF', category: 'rent' }),
    'the same payee for two different things is two lines');
  eq(costLineKey({ supplier: null, category: 'stock' }), null,
    'a cost with no payee cannot be told from any other in its category');
  eq(costLineKey({ supplier: '   ', category: 'stock' }), null, 'and a blank payee is no payee');
}

/* ── a run of months, and what counts as standing ───────────────────────── */
const WINDOW = monthsBefore('2026-08', COST_LOOKBACK_MONTHS); // Jul .. Feb 2026
const rent = (month: string, over: Partial<CostLine> = {}) =>
  cost({ paidOn: `${month}-01`, ...over });
const power = (month: string, over: Partial<CostLine> = {}) =>
  cost({ supplier: 'EDF Energy', category: 'utilities', amountCents: 41_000, paidOn: `${month}-14`, ...over });

{
  const past = [
    rent('2026-07'), rent('2026-06'), rent('2026-05'), rent('2026-04'),
    power('2026-07'), power('2026-06'), power('2026-05'),
  ];
  const st = standingCosts(past, WINDOW);
  eq(st.length, 2, 'two suppliers are paid most months');
  eq(st[0]?.supplier, 'Ruoni Property Ltd', 'the one seen most often comes first');
  eq(st[0]?.monthsSeen, 4, 'and it says how many months it was seen in');
  eq(st[0]?.lookback, COST_LOOKBACK_MONTHS, 'out of how many were looked at');
  eq(st[0]?.lastSeen, '2026-07', 'and when it was last paid');
  eq(st[0]?.usual?.cents, 250_000, 'with what it last cost');
  eq(st[0]?.usual?.currency, 'GBP', 'in the currency it was actually paid in');
}

/* ── 3. a coincidence is not a commitment ───────────────────────────────── */
{
  const past = [
    rent('2026-07'), rent('2026-06'), rent('2026-05'),
    cost({ supplier: 'Bickford Engineering', category: 'maintenance', paidOn: '2026-06-09', amountCents: 18_000 }),
    cost({ supplier: 'Bickford Engineering', category: 'maintenance', paidOn: '2026-03-22', amountCents: 22_500 }),
  ];
  const st = standingCosts(past, WINDOW);
  eq(st.length, 1, 'the engineer called twice in six months is not a monthly bill');
  eq(st[0]?.category, 'rent', 'and the rent still is');
  eq(RECURRING_MIN_MONTHS, 3, 'three sightings is the bar, and it is stated once');
}

/* ── 2. a supplier the gym stopped using ────────────────────────────────── */
{
  const past = [
    rent('2026-07'), rent('2026-06'), rent('2026-05'),
    // An insurer paid Feb, Mar, Apr and then dropped. Three sightings, so it
    // clears rule 1 — and it is gone, not late.
    cost({ supplier: 'Hanbury Broking', category: 'insurance', paidOn: '2026-04-02', amountCents: 9_000 }),
    cost({ supplier: 'Hanbury Broking', category: 'insurance', paidOn: '2026-03-02', amountCents: 9_000 }),
    cost({ supplier: 'Hanbury Broking', category: 'insurance', paidOn: '2026-02-02', amountCents: 9_000 }),
  ];
  const st = standingCosts(past, WINDOW);
  eq(st.length, 1, 'a supplier not paid in the most recent month on record is gone, not missing');
  eq(st[0]?.category, 'rent', 'and the one still being paid is still standing');
}

/* ── a gap month must not disqualify everything ─────────────────────────── */
{
  // Nothing at all was written up in July. The newest month ON RECORD is June,
  // and a bookkeeper's fortnight off must not empty this list.
  const past = [rent('2026-06'), rent('2026-05'), rent('2026-04')];
  const st = standingCosts(past, WINDOW);
  eq(st.length, 1, 'a month where nothing was recorded is not evidence that a supplier was dropped');
  eq(st[0]?.lastSeen, '2026-06', 'and the last sighting is stated as what it is');
}

/* ── the amount beside the name is the LAST one, not the first read ─────── */
{
  // Rows are handed over in whatever order a read returned them, and the rent
  // went up in June. A version that kept whichever sighting it saw first put
  // last spring's rent beside the landlord's name on the screen an owner is
  // about to act on.
  const past = [
    rent('2026-05', { amountCents: 250_000 }),
    rent('2026-06', { amountCents: 275_000 }),
    rent('2026-07', { amountCents: 275_000 }),
  ];
  const st = standingCosts(past, WINDOW);
  eq(st[0]?.usual?.cents, 275_000, 'what it last cost, not what it first cost');
  eq(st[0]?.lastSeen, '2026-07', 'and the month of that sighting');

  // Two in one month: the later DAY wins, not the later row.
  const twice = standingCosts(
    [rent('2026-07', { amountCents: 250_000 }),
     cost({ paidOn: '2026-07-28', amountCents: 300_000 }),
     rent('2026-06'), rent('2026-05')],
    WINDOW,
  );
  eq(twice[0]?.usual?.cents, 300_000, 'and inside one month it is the later day');
}

/* ── 4. two currencies, no usual figure ─────────────────────────────────── */
{
  const past = [
    rent('2026-07'), rent('2026-06'),
    rent('2026-05', { currency: 'EUR', amountCents: 290_000 }),
  ];
  const st = standingCosts(past, WINDOW);
  eq(st.length, 1, 'it is still the same standing line');
  eq(st[0]?.usual, null, 'but there is no single amount it usually costs, so none is offered');

  const unpriced = standingCosts(
    [rent('2026-07', { amountCents: null }), rent('2026-06'), rent('2026-05')],
    WINDOW,
  );
  eq(unpriced[0]?.usual, null, 'and a last sighting with no amount on it prints no amount');

  const uncurrencied = standingCosts(
    [rent('2026-07', { currency: null }), rent('2026-06'), rent('2026-05')],
    WINDOW,
  );
  eq(uncurrencied[0]?.usual, null, 'nor does one with no currency — there is no default currency');
}

/* ── rows outside the window, and rows with no payee ────────────────────── */
{
  const past = [
    rent('2026-07'), rent('2026-06'), rent('2026-05'),
    // Older than the look-back. Present in the array because a caller may hand
    // over a wider read; it must not be counted.
    rent('2025-12'), rent('2025-11'),
    cost({ supplier: null, category: 'stock', paidOn: '2026-07-08', amountCents: 4_400 }),
  ];
  const st = standingCosts(past, WINDOW);
  eq(st.length, 1, 'only the rent is standing');
  eq(st[0]?.monthsSeen, 3, 'and months outside the window are not counted into it');
}

/* ── what is missing from the month being closed ────────────────────────── */
const PAST = [
  rent('2026-07'), rent('2026-06'), rent('2026-05'), rent('2026-04'),
  power('2026-07'), power('2026-06'), power('2026-05'),
];
{
  const st = standingCosts(PAST, WINDOW);
  const august = [power('2026-08')];
  const gone = missingStandingCosts(august, st);
  eq(gone.length, 1, 'the electricity is in and the rent is not');
  eq(gone[0]?.supplier, 'Ruoni Property Ltd', 'and it is named');

  eq(missingStandingCosts([rent('2026-08'), power('2026-08')], st).length, 0,
    'both entered is nothing missing');
  eq(missingStandingCosts([], st).length, 2, 'and an empty month is missing both');
  eq(missingStandingCosts([rent('2026-08', { amountCents: 1 })], st).length, 1,
    'presence is about whether somebody entered it, not about whether the amount looks right');
}

/* ── the verdict, and 5: nothing claimed over a read that is not whole ──── */
const V = {
  monthKey: '2026-08', monthLabel: 'August 2026',
  monthState: 'ready', pastState: 'ready',
  monthRows: [] as CostLine[], pastRows: PAST,
} as const;

{
  const failed = costVerdict({ ...V, monthState: 'failed' });
  eq(failed.kind, 'unread', 'a failed read claims nothing');
  eq(failed.missing.length, 0, 'and names nobody');
  eq(failed.entered, null, 'and counts nothing');
  ok(/locks the month/.test(failed.text), 'while still saying what closing does');

  const cut = costVerdict({ ...V, pastState: 'partial' });
  eq(cut.kind, 'truncated', 'a truncated read is its own answer, not a failed one');
  eq(cut.missing.length, 0, 'and accuses nobody of being missing past the end of a read');
  ok(cut.text !== failed.text, 'and says a different sentence, because it is a different fact');

  const loading = costVerdict({ ...V, monthState: 'loading' });
  eq(loading.kind, 'unknown', 'still reading is not "nothing is missing"');
  ok(loading.text !== cut.text && loading.text !== failed.text,
    'five states, five sentences');

  // The precedence: a failure outranks a truncation outranks a spinner.
  eq(costVerdict({ ...V, monthState: 'loading', pastState: 'failed' }).kind, 'unread',
    'a read that failed is what a reader should act on first');
  eq(costVerdict({ ...V, monthState: 'loading', pastState: 'partial' }).kind, 'truncated',
    'and a prefix outranks a spinner');
}

{
  const gaps = costVerdict({ ...V, monthRows: [power('2026-08')] });
  eq(gaps.kind, 'gaps', 'the rent is not in August');
  eq(gaps.missing.length, 1, 'one supplier');
  eq(gaps.entered, 1, 'one cost is entered');
  eq(gaps.unnamed, 0, 'and none of them is unattributable');
  ok(/August 2026/.test(gaps.text), 'the month is named in the reader’s own words');

  const whole = costVerdict({ ...V, monthRows: [rent('2026-08'), power('2026-08')] });
  eq(whole.kind, 'complete', 'both in is complete');
  eq(whole.missing.length, 0, 'with nobody named');
  ok(/amounts are right/.test(whole.text),
    'and it says what it did NOT check, because "complete" over a list of names is not a reconciliation');

  const fresh = costVerdict({ ...V, pastRows: [] });
  eq(fresh.kind, 'no_history', 'a gym with no run of months is told that, not reassured');
  eq(fresh.missing.length, 0, 'and nothing is claimed missing');
  ok(!/complete/.test(fresh.text), 'no_history must never read as a clean bill');

  const unnamed = costVerdict({
    ...V,
    monthRows: [cost({ supplier: null, category: 'stock', paidOn: '2026-08-04' }), power('2026-08')],
  });
  eq(unnamed.unnamed, 1, 'a cost with no payee is counted so the screen can say it was not judged');
  eq(unnamed.kind, 'gaps', 'and it does not stand in for the rent');
}

/* ── what gets written onto the permanent close row ─────────────────────── */
{
  const gaps = costVerdict({ ...V, monthRows: [power('2026-08')] });
  const note = costNoteForClose(gaps);
  ok(!!note && /Ruoni Property Ltd/.test(note), 'a month closed over a gap records which supplier');
  ok(!/could not be read/.test(String(note)), 'and never puts this console’s network on an audit trail');

  eq(costNoteForClose(costVerdict({ ...V, monthRows: [rent('2026-08'), power('2026-08')] })), null,
    'nothing missing is nothing to record');
  eq(costNoteForClose(costVerdict({ ...V, monthState: 'failed' })), null,
    'and a read that failed records nothing at all');
  eq(costNoteForClose(costVerdict({ ...V, pastRows: [] })), null,
    'nor does a gym with no history');

  eq(joinCloseBlockers(null, null), null, 'two nothings join to nothing, not to a blank line');
  eq(joinCloseBlockers('a', null), 'a', 'and one side alone carries no trailing newline');
  eq(joinCloseBlockers('a', '  '), 'a', 'nor does a side that is only whitespace');
  eq(joinCloseBlockers('a', 'b'), 'a\nb', 'two are newline separated, matching snapshotOf');
}

/* ── the singular and the plural, because this is read by a person ──────── */
{
  const one = costVerdict({ ...V, monthRows: [power('2026-08')] });
  ok(/1 of the 2 suppliers .* is not in/.test(one.text), 'one supplier reads as one');
  const both = costVerdict({ ...V, monthRows: [] });
  ok(/2 of the 2 suppliers .* are not in/.test(both.text), 'two read as two');
  ok(/supplier not yet recorded/.test(String(costNoteForClose(one))), 'and the stored note agrees');
  ok(/suppliers not yet recorded/.test(String(costNoteForClose(both))), 'in both directions');
}

if (errors.length) {
  console.error(`closeCosts: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('closeCosts: ok');
