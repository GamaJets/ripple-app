// A session's rate and the money it is in. Compile with tsc, run with node.
//
// The assertion this file exists for is the LAST group: a gym that changed
// `tenants.currency` must not be able to record one settlement over sessions
// priced in the old one. Everything above it is the machinery that makes that
// refusal possible — a pot per currency, an unrecorded pot that is NOT the
// gym's money, and a total that is withheld rather than mislabelled.
import {
  ratePots, runCurrency, potNames, settleCurrencyBlocker, runLabel, totalNote,
  type RatedSession,
} from './gymRateCurrency';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const s = (cents: number | null, currency: string | null): RatedSession =>
  ({ rateCents: cents, rateCurrency: currency });

/* ── pots ──────────────────────────────────────────────────────────────── */

eq(ratePots([]).length, 0, 'no sessions is no pots');
eq(ratePots([s(null, null), s(null, 'GBP')]).length, 0,
  'a session with no rate is in no pot — unpriced work is not a zero');

{
  const pots = ratePots([s(5000, 'GBP'), s(2500, 'GBP')]);
  eq(pots.length, 1, 'one currency, one pot');
  eq(pots[0].minorUnits, 7500, 'and the pot is the sum of its rates');
  eq(pots[0].count, 2, 'and counts the sessions it summed');
}

{
  // The whole point: yen has no minor unit, so ¥6,000 is 6000 and £60 is 6000
  // too. Nothing about the integers says they are different money.
  const pots = ratePots([s(6000, 'JPY'), s(6000, 'GBP'), s(6000, null)]);
  eq(pots.length, 3, 'three answers stay three pots — identical integers are not one figure');
  eq(pots[0].currency, 'GBP', 'recorded currencies come first, alphabetically');
  eq(pots[1].currency, 'JPY', 'and stay in one order across screens');
  eq(pots[2].currency, null, 'and the unrecorded pot is last');
}

eq(ratePots([s(100, 'gbp'), s(100, ' GBP ')])[0].count, 2,
  'a code is folded and trimmed, so one currency typed two ways is one pot');

/* ── what a run is in ──────────────────────────────────────────────────── */

eq(runCurrency([]).kind, 'none', 'nothing priced is nothing to name');
eq(runCurrency([s(null, 'GBP')]).kind, 'none', 'and a currency with no rate prices nothing');

{
  const r = runCurrency([s(5000, 'GBP'), s(2500, 'GBP')]);
  eq(r.kind, 'one', 'agreement is one currency');
  ok(r.kind === 'one' && r.currency === 'GBP' && r.minorUnits === 7500, 'and it carries the code and the sum');
}

{
  // Every session delivered before supabase/parts/1010.
  const r = runCurrency([s(5000, null), s(2500, null)]);
  eq(r.kind, 'unrecorded', 'rates with no unit are their own answer, not the gym’s currency');
  ok(r.kind === 'unrecorded' && r.minorUnits === 7500, 'and the figures are still real');
}

eq(runCurrency([s(5000, 'GBP'), s(5000, null)]).kind, 'mixed',
  'some recorded and some not is TWO answers — it does not collapse to the recorded one');
eq(runCurrency([s(5000, 'GBP'), s(600000, 'JPY')]).kind, 'mixed', 'and two codes is mixed');

eq(runLabel([s(5000, 'GBP')]), 'GBP', 'a single-currency run may be labelled');
eq(runLabel([s(5000, null)]), null, 'an unrecorded run may not — the figure prints with the unit withheld');
eq(runLabel([s(1, 'GBP'), s(1, 'JPY')]), null, 'and neither may a mixed one');

/* ── the sentences ─────────────────────────────────────────────────────── */

ok(potNames(ratePots([s(1, 'GBP'), s(1, 'JPY')])).includes('1 session in GBP'),
  'a pot is named with its count and its code');
ok(potNames(ratePots([s(1, null), s(2, null)])).includes('2 sessions in a currency nobody recorded'),
  'and the unrecorded pot is described rather than given a fake code');

eq(totalNote([s(5000, 'GBP')]), null, 'a single-currency total needs no caveat');
eq(totalNote([]), null, 'and neither does an empty one');
ok((totalNote([s(5000, null)]) ?? '').includes('not on the record'),
  'an unrecorded total says the currency is genuinely missing');
ok(!(totalNote([s(5000, null)]) ?? '').includes('added across'),
  'and does not accuse itself of the mixed-currency problem');
ok((totalNote([s(1, 'GBP'), s(1, 'JPY')]) ?? '').includes('never added across currencies'),
  'a mixed total refuses to be one figure');

/* ── the settlement, which is the permanent record ─────────────────────── */

eq(settleCurrencyBlocker([], 'GBP'), null, 'nothing to settle is nothing to refuse');
eq(settleCurrencyBlocker([s(5000, 'GBP')], 'GBP'), null, 'the ordinary run settles');
eq(settleCurrencyBlocker([s(5000, 'GBP')], 'gbp'), null, 'and the comparison is case-folded');

// The defect, in one assertion. A gym that priced its PT in GBP and has since
// switched to AED must not stamp AED on the old work.
{
  const why = settleCurrencyBlocker([s(5000, 'GBP'), s(4000, 'GBP')], 'AED');
  ok(why !== null, 'a gym that changed its currency cannot settle its old sessions in the new one');
  ok((why ?? '').includes('GBP') && (why ?? '').includes('AED'),
    'and the refusal names both, so the owner can see which is which');
  ok((why ?? '').includes('does not convert'),
    'and says Repple will not convert rather than leaving the owner expecting it to');
}

ok((settleCurrencyBlocker([s(5000, 'GBP'), s(600000, 'JPY')], 'GBP') ?? '').includes('not all priced in the same money'),
  'a mixed run is refused even when the gym’s currency matches one of them');

// Pre-part-1010 rows have to remain payable, or no existing gym can pay anybody.
eq(settleCurrencyBlocker([s(5000, null), s(4000, null)], 'GBP'), null,
  'rates filed before the unit was recorded still settle at a gym that has a currency');
ok((settleCurrencyBlocker([s(5000, null)], null) ?? '').includes('has not set one either'),
  'but not when the gym has no currency to record the payment in');
ok((settleCurrencyBlocker([s(5000, 'GBP')], null) ?? '').includes('GBP'),
  'and a gym with no currency is told which one its own sessions were priced in');

if (errors.length) { for (const e of errors) console.error('FAIL', e); process.exit(1); }
console.log('gymRateCurrency: ok');
