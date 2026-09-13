// What a gym has settled for a coach. Compile with tsc, run with node.
//
// Three assertions are the reason this file exists, and everything else here is
// support for them:
//
//   1. A coach with NO GYM gets a sentence, never an empty settlement list. All
//      seven live coaches are in that state and every payroll table has zero
//      rows, so this is the branch that actually ships.
//   2. A FAILED OR TRUNCATED read never resolves to "you were paid nothing".
//      'partial' is separated from 'ready' before anything is counted, and it
//      carries no pots at all so a total cannot be printed over a prefix.
//   3. A REVERSED run is listed and marked, and is in no figure.
//
// Plus the two rules the house never bends: a snapshot is never recomputed, and
// two currencies are never added.
import {
  paidView, isReversed, periodLabel, settledEmptyLine, runSplit, splitNote,
  adjustmentsFor, classLinesFor, sessionLinesFor, classLineWorking, lineTally,
  NO_GYM_SETTLEMENTS_NOTE, SETTLEMENTS_UNREAD_NOTE, SPLIT_NOT_STATED_NOTE,
  SNAPSHOT_IS_THE_RECORD, REVERSED_IS_NOT_DELETED, SETTLED_IS_NOT_RECEIVED,
  type Settlement, type CoachAdjustment, type CoachClassLine, type CoachSessionLine,
} from './coachSettlements';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const run = (p: Partial<Settlement> = {}): Settlement => ({
  id: 'r1',
  periodFrom: '2026-08-01',
  periodTo: '2026-08-31',
  amountCents: 140000,
  currency: 'GBP',
  sessionsCount: 14,
  method: 'transfer',
  note: null,
  settledAt: '2026-09-01T09:00:00Z',
  reversedAt: null,
  reverseReason: null,
  reimbursementCents: null,
  ...p,
});

/* ── 1 · the coach with no gym, which is all of them today ────────────────── */

eq(paidView('none', 'ready', []).kind, 'no_gym',
  'no gym is an answer, not an empty settlement list');
eq(paidView('none', 'ready', [run()]).kind, 'no_gym',
  'and it holds even over rows, because there is nobody who could have settled them');
eq(settledEmptyLine(paidView('none', 'ready', [])), NO_GYM_SETTLEMENTS_NOTE,
  'and it is said in words');
ok(NO_GYM_SETTLEMENTS_NOTE.includes('no gym attached to this account'),
  'the sentence names the absence rather than implying it with a blank');
ok(!/paid you nothing|settled nothing for you/.test(NO_GYM_SETTLEMENTS_NOTE),
  'and never reads as a gym that has paid them nothing');
ok(!/ask your gym|contact your gym/i.test(NO_GYM_SETTLEMENTS_NOTE),
  'and never sends a self-employed coach to an owner who does not exist');

/* ── 2 · a read that did not land says nothing at all ─────────────────────── */

for (const s of ['loading', 'error'] as const) {
  eq(paidView('gym', s, []).kind, 'unread', `an unlanded read (${s}) states nothing`);
  eq(paidView('gym', s, [run()]).kind, 'unread',
    `and neither does one holding rows from before it (${s})`);
}
eq(paidView('unknown', 'ready', []).kind, 'unread',
  'a gym we could not establish is not a gym that is absent');
eq(settledEmptyLine(paidView('gym', 'error', [])), SETTLEMENTS_UNREAD_NOTE,
  'a failed read gets the failed-read sentence');
ok(SETTLEMENTS_UNREAD_NOTE.includes('not a statement that you have been paid nothing'),
  'which says in as many words that it is not a claim about their pay');

/* ── the prefix, and why it is not 'ready' ────────────────────────────────── */

{
  const v = paidView('gym', 'partial', [run(), run({ id: 'r2' })]);
  eq(v.kind, 'prefix', 'a truncated read is its own answer — isWhole, not !== error');
  ok(v.kind === 'prefix' && v.rows.length === 2, 'the rows that arrived may be listed');
  // The assertion that matters: there is no field on this kind that could hold
  // a total, so the mistake is unavailable rather than discouraged.
  ok(!('pots' in v), 'and no figure over them exists to be printed');
  eq(settledEmptyLine(v), '', 'a prefix is never described with an empty-state sentence');
}

/* ── only then is an empty list called empty ──────────────────────────────── */

{
  const v = paidView('gym', 'ready', []);
  eq(v.kind, 'none', 'a landed read with a gym and no runs is genuinely none');
  ok(settledEmptyLine(v).includes('not closed a payroll run for you yet'),
    'and says so as a fact about the gym rather than about the coach');
  ok(settledEmptyLine(v).includes('not lost by being unsettled'),
    'and says unsettled work is waiting rather than gone');
}

/* ── 3 · a reversal is a second fact ──────────────────────────────────────── */

const reversed = run({
  id: 'r2', amountCents: 50000, reversedAt: '2026-09-05T10:00:00Z',
  reverseReason: 'Paid twice by mistake',
});

ok(isReversed(reversed), 'a run with a reversal date is reversed');
ok(!isReversed(run({ reversedAt: '   ' })), 'and whitespace is not a reversal');
ok(!isReversed(run()), 'and a live run is not');

{
  const v = paidView('gym', 'ready', [run(), reversed]);
  ok(v.kind === 'paid', 'both runs are in the view');
  if (v.kind === 'paid') {
    eq(v.rows.length, 2, 'the reversed run is LISTED — deleting it would leave neither fact');
    eq(v.reversed, 1, 'and counted as reversed, so its absence from the figure is stated');
    eq(v.pots.length, 1, 'one currency, one pot');
    eq(v.pots[0].minorUnits, 140000, 'and the reversed run is in no total — it is not money that went out');
    eq(v.pots[0].count, 1, 'nor in the count behind it');
  }
}
ok(REVERSED_IS_NOT_DELETED.includes('two things that happened, not none'),
  'and the screen says why it is still there');

/* ── never sum two currencies ─────────────────────────────────────────────── */

{
  const v = paidView('gym', 'ready', [
    run({ id: 'a', amountCents: 100000, currency: 'GBP' }),
    run({ id: 'b', amountCents: 200000, currency: 'EUR' }),
    run({ id: 'c', amountCents: 50000, currency: 'gbp ' }),
  ]);
  ok(v.kind === 'paid', 'three runs, two moneys');
  if (v.kind === 'paid') {
    eq(v.pots.length, 2, 'two pots, and nothing that adds them');
    eq(v.pots[0].currency, 'EUR', 'sorted so the order is stable between renders');
    eq(v.pots[1].currency, 'GBP', 'and a lower-cased code is the same money as an upper-cased one');
    eq(v.pots[1].minorUnits, 150000, 'so the two GBP runs are one pot');
  }
}

/* ── a run that cannot be denominated is counted, never zeroed ────────────── */

{
  const v = paidView('gym', 'ready', [
    run({ id: 'a' }),
    run({ id: 'b', currency: null }),
    run({ id: 'c', amountCents: null }),
  ]);
  ok(v.kind === 'paid', 'three runs');
  if (v.kind === 'paid') {
    eq(v.undenominated, 2, 'an amount with no currency, and a currency with no amount, are both withheld');
    eq(v.pots[0].count, 1, 'and neither is counted into a figure as nought');
  }
}

/* ── the period, and the bare date that is never parsed ───────────────────── */

ok((periodLabel(run()) ?? '').includes(' to '), 'a run states both ends of its period');
eq(periodLabel(run({ periodTo: null })), null,
  'and an unreadable end withholds the phrase rather than putting a dash in a sentence');
eq(periodLabel(run({ periodFrom: 'not a date' })), null, 'the same at the other end');

/* ── 4 · pay and a reimbursement are not the same money ───────────────────── */

eq(runSplit(run()).kind, 'unstated',
  'a NULL reimbursement is the run not saying — it is not a split of zero');
eq(splitNote(runSplit(run())), SPLIT_NOT_STATED_NOTE, 'and the sentence says exactly that');
ok(SPLIT_NOT_STATED_NOTE.includes('not a claim that all of it was pay'),
  'which is the claim a zero here would have made about somebody’s tax');

{
  const v = runSplit(run({ amountCents: 144000, reimbursementCents: 4000 }));
  eq(v.kind, 'stated', 'a run that said, said');
  if (v.kind === 'stated') {
    eq(v.payCents, 140000, 'pay is the rest of the amount');
    eq(v.reimbursementCents, 4000, 'and the reimbursement is what the run recorded');
    eq(v.currency, 'GBP', 'in the money the run itself states');
  }
  ok(splitNote(v).includes('deliberately not one figure'), 'and the two are kept apart on the page');
}

{
  // Part 482 refuses to constrain the reimbursement against the total, because
  // a run whose deductions exceed its session pay is a real run.
  const v = runSplit(run({ amountCents: 1000, reimbursementCents: 4000 }));
  ok(v.kind === 'stated' && v.payCents === -3000,
    'a reimbursement larger than the run is reported, not clamped to zero');
  ok(splitNote(v).includes('deductions came off the pay'),
    'and the screen explains it instead of printing a negative with no account of itself');
}

eq(runSplit(run({ reimbursementCents: 0 })).kind, 'stated',
  'zero is the run SAYING none of it was a reimbursement, which is not the same as NULL');
ok(splitNote(runSplit(run({ reimbursementCents: 0 }))).includes('none of it was a reimbursement'),
  'and that is a different sentence from the one for a run that did not say');
eq(runSplit(run({ reimbursementCents: -1 })).kind, 'unstated',
  'a negative is a value no constraint here can produce, so it is unreadable rather than subtracted');
eq(runSplit(run({ currency: null, reimbursementCents: 4000 })).kind, 'undenominated',
  'and a split with no money to print it in is withheld');

/* ── the lines behind a run ───────────────────────────────────────────────── */

const adj: CoachAdjustment[] = [
  { id: 'a1', kind: 'reimbursement', amountCents: 4000, currency: 'GBP', note: 'Kit', appliesOn: '2026-08-14', settlementId: 'r1' },
  { id: 'a2', kind: 'deduction', amountCents: -1500, currency: 'GBP', note: 'Locker', appliesOn: '2026-08-20', settlementId: 'r1' },
  { id: 'a3', kind: 'bonus', amountCents: 10000, currency: 'GBP', note: 'Cover', appliesOn: '2026-09-02', settlementId: null },
];
const classes: CoachClassLine[] = [
  { id: 'c1', payKind: 'per_attendee', rateCents: 500, attendees: 12, amountCents: 6000, currency: 'GBP', settlementId: 'r1' },
  { id: 'c2', payKind: 'per_class', rateCents: 8000, attendees: null, amountCents: 8000, currency: 'GBP', settlementId: 'r2' },
];
const sessions: CoachSessionLine[] = [
  { id: 's1', startsAt: '2026-08-03T09:00:00Z', status: 'completed', rateCents: 4000, currency: 'GBP', settlementId: 'r1' },
  { id: 's2', startsAt: '2026-08-04T09:00:00Z', status: 'completed', rateCents: null, currency: null, settlementId: 'r1' },
];

eq(adjustmentsFor('r1', adj).length, 2, 'only the adjustments this run picked up');
eq(adjustmentsFor('r1', adj)[0].kind, 'reimbursement', 'kept as recorded, kind and all');
eq(classLinesFor('r2', classes).length, 1, 'and only this run’s class lines');
eq(sessionLinesFor('r1', sessions).length, 2, 'and only this run’s sessions');

eq(classLineWorking(classes[0], '£5.00'), '£5.00 per person',
  'a per-person line names the rate the headcount is multiplied by');
eq(classLineWorking(classes[1], '£80.00'), '£80.00 for the class',
  'and a flat line says so rather than printing a headcount of nought');
eq(classLineWorking({ ...classes[0], attendees: null }, '£5.00'), null,
  'a per-person line with no register has no working to show — nought would say the room was empty');
eq(classLineWorking(classes[0], null), null,
  'and nothing is composed around a rate that could not be printed');

/* ── a tally is a tally, and a floor is never printed as one ──────────────── */

{
  const tally = lineTally(classes);
  eq(tally.cents, 14000, 'lines in one currency add up');
  eq(tally.currency, 'GBP', 'in that currency');
  eq(tally.count, 2, 'over both of them');
}
eq(lineTally([]).cents, null, 'no lines is nothing computed, not nought');
{
  const mixed = lineTally([
    { amountCents: 100, currency: 'GBP' },
    { amountCents: 100, currency: 'EUR' },
  ]);
  eq(mixed.cents, null, 'two moneys do not add');
  eq(mixed.currencies.join(','), 'EUR,GBP', 'and the screen is handed both names to say which');
}
{
  const short = lineTally([
    { amountCents: 100, currency: 'GBP' },
    { amountCents: null, currency: 'GBP' },
  ]);
  eq(short.cents, null, 'a line that could not be priced makes the sum a floor, and a floor is withheld');
  eq(short.unpriced, 1, 'and the unpriced line is counted so the hole is visible');
}

/* ── the snapshot is the payment ──────────────────────────────────────────── */

ok(SNAPSHOT_IS_THE_RECORD.includes('the amount is the payment and the lines are the working'),
  'nothing here recomputes a settlement from its lines');
ok(SETTLED_IS_NOT_RECEIVED.includes('not what arrived in your account'),
  'and the gap between settled and received is stated rather than assumed closed');

if (errors.length) { for (const e of errors) console.error('FAIL', e); process.exit(1); }
console.log('coachSettlements: ok');
