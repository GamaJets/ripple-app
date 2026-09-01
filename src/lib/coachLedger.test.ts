// A subtotal of somebody's income is not a smaller total. Compile with tsc,
// run with node.
//
// Four things are asserted here and each one is a sentence the money screen
// would otherwise get to say wrongly:
//
//   · "You took AED 600 this month" over a read where the renewals half
//     failed. `ledger()` must withhold, and must say WHICH half is missing.
//   · "AED 0.40" for a recorded AED 40 late-cancellation fee, because
//     `charges.amount` is whole units and every other money column in this
//     database is cents.
//   · "You spent GBP 120 on ads" when four of the six codes have no cost
//     recorded at all. No spend recorded is not zero spend.
//   · "Ask your gym owner to set a currency" when the currency read simply
//     failed. 35 of 54 live tenants genuinely have none set, so the unset
//     branch is the common one — which is exactly why the failed-read branch
//     must not be swallowed into it.
import {
  ledger, joinLabels, sumMajor, sumSpend, denominate, ledgerEmptyLine,
  NO_NET_NOTE, STRIPE_AUTHORITY_NOTE, PERIOD_NOTE,
  type Strand,
} from './coachLedger';
import { sumTaken, type Taken } from './coachMoney';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const EMPTY: Taken = { pots: [], unlabelled: 0, unpriced: 0 };
const taken = (...rows: { amount_cents: number | null; currency: string | null }[]): Taken =>
  sumTaken(rows.map((r) => ({ ...r, created_at: '2026-09-01T00:00:00Z' })));

const strand = (key: string, label: string, status: LoadStatus, t: Taken = EMPTY): Strand =>
  ({ key, label, status, taken: t });

/* ── 1. a total exists only when every read was whole ─────────────────────── */

{
  const sales = taken({ amount_cents: 60000, currency: 'AED' });
  const renewals = taken({ amount_cents: 30000, currency: 'AED' });

  const whole = ledger([
    strand('p', 'one-off sales', 'ready', sales),
    strand('s', 'renewals', 'ready', renewals),
  ]);
  eq(whole.status, 'ready', 'two whole reads make a whole ledger');
  eq(whole.reason, null, 'and it needs no explanation');
  eq(whole.total?.pots.length, 1, 'the two halves land in one pot');
  eq(whole.total?.pots[0].minorUnits, 90000, 'and the pot is their sum');
  eq(whole.missing.length, 0, 'nothing is missing');

  // The defect this whole file exists for: half the money read, the other half
  // refused, and a confident figure printed over it.
  const half = ledger([
    strand('p', 'one-off sales', 'ready', sales),
    strand('s', 'renewals', 'error', EMPTY),
  ]);
  eq(half.status, 'error', 'the ledger is as trustworthy as its worst read');
  eq(half.total, null, 'and states NO total — not the half that landed');
  ok(half.missing.includes('renewals'), 'it names the half that did not land');
  ok(!half.missing.includes('one-off sales'), 'and does not blame the half that did');
  ok(/renewals/.test(half.reason ?? ''), 'the reason names it too, so the coach knows which money is unaccounted for');
  ok(/not a statement that you were paid nothing/.test(half.reason ?? ''),
    'and says out loud that an empty figure is not a statement of having been paid nothing');

  // Truncation is not failure and does not read as one, but it still withholds:
  // a sum over a page of a longer list is a wrong number, not a small one.
  const capped = ledger([
    strand('p', 'one-off sales', 'partial', sales),
    strand('s', 'renewals', 'ready', renewals),
  ]);
  eq(capped.status, 'partial', 'truncation carries through');
  eq(capped.total, null, 'and withholds the total just as firmly');
  ok(/one request/.test(capped.reason ?? ''), 'with the reason a truncated read gets, not the failed-read one');

  // 'loading' outranks 'partial' (src/ui/loadStatus.ts), so a ledger still in
  // flight says so rather than reporting a truncation that may not survive.
  const flight = ledger([
    strand('p', 'one-off sales', 'loading', EMPTY),
    strand('s', 'renewals', 'partial', renewals),
  ]);
  eq(flight.status, 'loading', 'a read still in flight outranks a truncated one');
  eq(flight.total, null, 'and nothing is stated while it lands');

  // No strands at all is an honest empty, not a failure a screen must explain.
  const none = ledger([]);
  eq(none.status, 'ready', 'an empty ledger is whole');
  eq(none.total?.pots.length, 0, 'and holds nothing');
  eq(none.reason, null, 'with nothing to explain');
}

/* ── 2. currencies still never merge, through the composition ─────────────── */

{
  const l = ledger([
    strand('p', 'one-off sales', 'ready', taken({ amount_cents: 60000, currency: 'AED' })),
    strand('s', 'renewals', 'ready', taken({ amount_cents: 9000, currency: 'GBP' })),
  ]);
  eq(l.total?.pots.length, 2, 'dirhams and pounds stay two pots');
  const codes = (l.total?.pots ?? []).map((p) => p.currency).sort();
  eq(codes.join(','), 'AED,GBP', 'and both are named');
  ok(!(l.total?.pots ?? []).some((p) => p.minorUnits === 69000), 'nothing anywhere added them');
}

// An amount with no unit is a hole in the total and the hole is counted, on
// both sides of the composition — not taken from whichever strand had more.
{
  const l = ledger([
    strand('p', 'one-off sales', 'ready', taken({ amount_cents: 60000, currency: null })),
    strand('s', 'renewals', 'ready', taken({ amount_cents: null, currency: 'AED' })),
  ]);
  eq(l.total?.unlabelled, 1, 'the amount with no currency is counted, not dropped');
  eq(l.total?.unpriced, 1, 'and so is the row Stripe stated no amount for');
  eq(l.total?.pots.length, 0, 'neither of them is in a pot');
}

/* ── 3. joinLabels, which builds those sentences ──────────────────────────── */

eq(joinLabels([]), 'nothing', 'no labels is the word nothing, never an empty string mid-sentence');
eq(joinLabels(['renewals']), 'renewals', 'one label stands alone');
eq(joinLabels(['sales', 'renewals']), 'sales and renewals', 'two are joined with and');
eq(joinLabels(['sales', 'renewals', 'fees']), 'sales, renewals and fees', 'three take commas then and');

/* ── 4. whole units are not cents ─────────────────────────────────────────── */

{
  // The bug: a recorded late-cancellation fee of forty dirhams. `charges.amount`
  // is numeric and holds 40. Through a minor-unit path it prints AED 0.40.
  const s = sumMajor([{ amount: 40, currency: 'AED' }, { amount: 25, currency: 'AED' }]);
  eq(s.pots.length, 1, 'two fees in one currency make one pot');
  eq(s.pots[0].units, 65, 'and the pot holds whole units — 65, never 6500 and never 0.65');
  eq(s.pots[0].count, 2, 'counting both rows');

  const mixed = sumMajor([{ amount: 40, currency: 'AED' }, { amount: 25, currency: 'GBP' }]);
  eq(mixed.pots.length, 2, 'a fee in sterling does not join the dirham pot');
  eq(mixed.pots[0].currency, 'AED', 'the bigger pot sorts first');

  // Two pots of the same size must still come out in the same order every
  // render, or a coach watching the screen reload sees their fees swap places
  // and doubts both. The currency code is the tie-break.
  const tied = sumMajor([{ amount: 30, currency: 'GBP' }, { amount: 30, currency: 'AED' }]);
  eq(tied.pots.map((p) => p.currency).join(','), 'AED,GBP', 'equal pots sort by currency code, not by arrival');
  eq(sumMajor([{ amount: 30, currency: 'AED' }, { amount: 30, currency: 'GBP' }]).pots.map((p) => p.currency).join(','),
    'AED,GBP', 'and reversing the input does not reverse the answer');

  // Case and whitespace are not a second currency. 'aed' and 'AED' are the same
  // money, and two pots for one currency is a total split in half.
  eq(sumMajor([{ amount: 10, currency: 'aed' }, { amount: 5, currency: ' AED ' }]).pots.length, 1,
    'case and padding do not fork a currency into two pots');

  const holes = sumMajor([
    { amount: 40, currency: null },
    { amount: null, currency: 'AED' },
    { amount: Number.NaN, currency: 'AED' },
  ]);
  eq(holes.pots.length, 0, 'nothing summable');
  eq(holes.unlabelled, 1, 'the fee with no currency is counted');
  eq(holes.unpriced, 2, 'and so are the two with no readable amount');
  eq(sumMajor([]).pots.length, 0, 'no fees is no pots');

  // A waived fee is the caller's to filter — this function does not know what
  // a charge means. What it must not do is invent a sign.
  ok(sumMajor([{ amount: 0, currency: 'AED' }]).pots[0].units === 0,
    'a recorded fee of zero is a pot of zero, not an unpriced row');
}

/* ── 5. no spend recorded is not zero spend ───────────────────────────────── */

{
  const s = sumSpend([
    { spend: { cents: 12000, currency: 'GBP' } },
    { spend: { cents: 8000, currency: 'GBP' } },
    { spend: null },
    { spend: null },
  ]);
  eq(s.pots.length, 1, 'the two recorded costs make one pot');
  eq(s.pots[0].minorUnits, 20000, 'and the pot is their sum');
  eq(s.pots[0].count, 2, 'and it says how many codes are behind that figure');
  eq(s.unrecorded, 2, 'the two codes nobody costed are counted, never summed as zero');

  // The distinction that matters most: a coach who cleared a wrong figure has
  // recorded zero, and that is a fact. A coach who never typed one has not.
  const zero = sumSpend([{ spend: { cents: 0, currency: 'GBP' } }]);
  eq(zero.unrecorded, 0, 'a recorded zero is recorded');
  eq(zero.pots.length, 1, 'and it is in the total');
  eq(zero.pots[0].minorUnits, 0, 'as zero');
  eq(zero.pots[0].count, 1, 'counted as one code, so "1 code in GBP" beside a zero is true');

  const noCode = sumSpend([{ spend: { cents: 500, currency: '' } }]);
  eq(noCode.unrecorded, 1, 'an amount with no currency on it is not a figure this can total');
  eq(noCode.pots.length, 0, 'so it is in no pot');

  eq(sumSpend([]).unrecorded, 0, 'no codes is no unrecorded codes');

  // Two currencies of ad spend is two currencies of ad spend.
  const two = sumSpend([
    { spend: { cents: 100, currency: 'GBP' } },
    { spend: { cents: 900, currency: 'AED' } },
  ]);
  eq(two.pots.length, 2, 'ad accounts in two currencies stay apart');
  eq(two.pots[0].currency, 'AED', 'largest first');

  // Same tie-break rule as the fees, for the same reason: a stable order.
  const tied = sumSpend([
    { spend: { cents: 500, currency: 'GBP' } },
    { spend: { cents: 500, currency: 'AED' } },
  ]);
  eq(tied.pots.map((p) => p.currency).join(','), 'AED,GBP', 'equal spend pots sort by currency code');
  eq(sumSpend([
    { spend: { cents: 500, currency: 'AED' } },
    { spend: { cents: 500, currency: 'GBP' } },
  ]).pots.map((p) => p.currency).join(','), 'AED,GBP', 'and the input order does not decide it');
}

/* ── 6. the two silences about currency, which are not the same ───────────── */

{
  const set = denominate('aed', 'ready');
  eq(set.ok, true, 'a currency that was read is a currency');
  eq(set.ok === true ? set.currency : null, 'AED', 'and it is normalised to upper case');

  // The common path: 35 of 54 live tenants. Not an afterthought branch.
  const unset = denominate(null, 'ready');
  eq(unset.ok, false, 'no currency set means no figure may be denominated');
  eq(unset.ok === false ? unset.why : null, 'unset', 'and the reason is that nobody has set one');
  ok(unset.ok === false && /gym owner/.test(unset.note), 'the note names who can fix it');
  ok(unset.ok === false && !/failed/.test(unset.note), 'and does not describe it as a failure, because nothing failed');

  const unread = denominate('AED', 'error');
  eq(unread.ok, false, 'a failed read denominates nothing, even holding a code');
  eq(unread.ok === false ? unread.why : null, 'unread', 'and it is the OTHER silence');
  ok(unread.ok === false && /read failed/.test(unread.note), 'the note says the read failed');
  ok(unread.ok === false && !/gym owner/.test(unread.note),
    'and does NOT send the coach to a settings screen where nothing is wrong');

  eq(denominate('', 'ready').ok, false, 'an empty string is the same silence as a null');
  eq(denominate('  ', 'ready').ok, false, 'and so is whitespace');
  eq(denominate('A', 'ready').ok, false, 'a code too short to be ISO 4217 is not a currency');
  // A read still in flight has not established anything, but it is not a
  // failure either — it falls to unset, and the screen shows it while loading.
  eq(denominate(null, 'loading').ok, false, 'nothing is denominated while the read is in flight');
}

/* ── 7. an empty ledger says different things under different reads ───────── */

{
  const inReady = ledgerEmptyLine('in', 'ready');
  const inError = ledgerEmptyLine('in', 'error');
  ok(inReady !== inError, 'an empty ledger under error is not the same sentence as under ready');
  ok(!/read failed/.test(inReady), 'a genuine empty does not blame a read');
  ok(/read failed/.test(inError), 'and a failed read says so');
  ok(!/\bnobody has paid you\b\.?$/.test(inError), 'a failed read never asserts nobody has paid');
  ok(/not because nobody has paid you/.test(inError),
    'it says the opposite explicitly, because the confident zero is the expensive sentence');

  // Every money table in this database is empty today, so the ready-and-empty
  // sentence is the one most coaches read. It has to be true, and the truth is
  // that Repple does not see cash.
  ok(/cash and transfers do not/.test(inReady),
    'the honest empty says what this figure does not include');

  const outError = ledgerEmptyLine('out', 'error');
  ok(/not because you owe nothing/.test(outError), 'the owing side gets its own refusal to assert a zero');
  ok(outError !== inError, 'the two sides do not share a sentence');
  ok(/Still reading/.test(ledgerEmptyLine('in', 'loading')), 'loading says loading');
  ok(/one request/.test(ledgerEmptyLine('in', 'partial')), 'truncation says truncation');
}

/* ── 8. the standing notes, which are the point of the screen ─────────────── */

{
  // The two halves are never netted. There is no function here that does it,
  // and the note is what tells the reader that was a decision.
  ok(/never subtracted/.test(NO_NET_NOTE), 'the no-net note says the two are never subtracted');
  ok(/net figure/.test(NO_NET_NOTE), 'and names the thing it is refusing to compute');

  // Gross, and said so. Stripe is the authority on money that moved.
  ok(/before Stripe/.test(STRIPE_AUTHORITY_NOTE), 'takings are stated as pre-fee');
  ok(/Stripe dashboard/.test(STRIPE_AUTHORITY_NOTE), 'and the record of what landed is named');
  ok(!/earn(ings|ed)\b/.test(STRIPE_AUTHORITY_NOTE), 'the word earnings is not used for a gross charge');

  // A period figure names what it counts, or two readers read it two ways.
  ok(/date the money was charged/.test(PERIOD_NOTE), 'the period note says which date decides the month');
  ok(/record was written/.test(PERIOD_NOTE), 'and which one does not');

  // Prose is sentence case; these are notes, not labels.
  for (const [name, s] of [['NO_NET_NOTE', NO_NET_NOTE], ['STRIPE_AUTHORITY_NOTE', STRIPE_AUTHORITY_NOTE], ['PERIOD_NOTE', PERIOD_NOTE]] as const) {
    ok(/^[A-Z]/.test(s), `${name} opens with a capital`);
    ok(s.trim().endsWith('.'), `${name} is a sentence and ends with a full stop`);
  }
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH LEDGER FAILURES:\n' + errors.join('\n') : 'ALL COACH LEDGER TESTS PASSED');
if (errors.length) process.exit(1);
