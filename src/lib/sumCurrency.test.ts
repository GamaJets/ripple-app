// The four this file exists to stop.
//
//   1. A TOTAL LABELLED WITH THE GYM'S CURRENT CURRENCY. `summarise` reports
//      which currency its contributing rows share and two screens ignored it,
//      printing a sum of two moneys under the newer of the two codes. The gym's
//      setting must never win over what the rows say.
//
//   2. A MIXED TOTAL RENDERED AS A NUMBER. When the rows disagree there is no
//      amount, and the currency has to come back null so the caller withholds
//      the figure rather than picking a side.
//
//   3. "THIS GYM HAS NOT SET ITS CURRENCY" SAID OVER A GYM THAT HAS. The two
//      silences are different facts with different fixes — one is a field in
//      Ops, the other is a ledger with two moneys in it — and folding them
//      together sends an owner to change a setting that is already right.
//
//   4. AN EMPTY TOTAL TREATED AS A DISAGREEMENT. No rows means nothing has
//      contradicted the gym's own currency, so an empty period is denominated
//      in it. Withholding there would put a dash on every tile at every gym
//      that had a quiet month.
//
// Compile with tsc, run with node.
import { totalMoney, emptyTotalMoney, MIXED_CURRENCY_NOTE, type TotalMoney } from './sumCurrency';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const shape = (m: TotalMoney, currency: string | null, gap: string, msg: string) => {
  eq(m.currency, currency, `${msg} (currency)`);
  eq(m.gap, gap, `${msg} (gap)`);
};

/* ── 1. the rows win ───────────────────────────────────────────────────── */
{
  // The London gym whose ledger still holds the dirhams it took before it
  // changed. The rows agree on AED; the gym now says GBP. The figure is in
  // what the rows say, and nothing about the gym's setting changes that.
  shape(totalMoney(430000, 'AED', 'GBP'), 'AED', 'ok',
    'a total is denominated in the currency its own rows share, not the gym setting');

  shape(totalMoney(430000, 'GBP', 'GBP'), 'GBP', 'ok',
    'the ordinary case, where the two agree, is unremarkable');

  // Case and spacing are not a disagreement.
  shape(totalMoney(1, ' gbp ', null), 'GBP', 'ok',
    'a code is normalised before it is compared or printed');
}

/* ── 2. rows that disagree have no total ───────────────────────────────── */
{
  // `sharedCurrency` returns null for a set that states two. The figure exists
  // — it is just not an amount of anything.
  shape(totalMoney(430000, null, 'GBP'), null, 'unstated',
    'a figure whose rows name no one currency is withheld, gym setting or not');

  shape(totalMoney(430000, '', 'GBP'), null, 'unstated',
    'an empty string is not a currency, and must not print as a leading space');

  ok(totalMoney(430000, null, 'GBP').gap !== 'no_gym_currency',
    'a mixed ledger is never reported as an unset gym currency — different fact, different fix');
}

/* ── 3. no figure at all ───────────────────────────────────────────────── */
{
  // Null total: the summariser had nothing to add. The gym's currency comes
  // back so a tile's label does not flicker, and the gap says there is no
  // figure so nothing renders one.
  shape(totalMoney(null, null, 'GBP'), 'GBP', 'no_total',
    'a missing figure keeps the gym label and is marked as missing');
  shape(totalMoney(undefined, 'AED', 'GBP'), 'GBP', 'no_total',
    'undefined is the same silence as null');
  shape(totalMoney(null, null, null), null, 'no_total',
    'no figure and no gym currency is still just a missing figure');
}

/* ── 4. zero is a figure, and an empty period is denominated ───────────── */
{
  // A real zero, from rows that exist and sum to nothing. It is still an
  // amount, and it is still in whatever those rows say.
  shape(totalMoney(0, 'JPY', 'GBP'), 'JPY', 'ok',
    'zero is a measurement, not a missing figure');

  // Zero built from no contributing rows — a gym selling only one-off plans has
  // no recurring rows, so nothing stated a currency and nothing disagreed. The
  // mixed-ledger sentence must not appear at a gym with one price list.
  shape(totalMoney(0, null, 'GBP'), 'GBP', 'ok',
    'a zero with no stated currency falls to the gym own, because zero cannot be two moneys');
  shape(totalMoney(0, null, null), null, 'no_gym_currency',
    'and at a gym with no currency that zero is an unset setting, not a mixed ledger');

  // No rows at all: the caller says so by calling the other door. Nothing has
  // disagreed with the gym, so the gym's currency is the honest label.
  shape(emptyTotalMoney('GBP'), 'GBP', 'ok',
    'an empty period is denominated in the gym own currency');
  shape(emptyTotalMoney(' gbp '), 'GBP', 'ok',
    'the empty door normalises the code too');
  shape(emptyTotalMoney(null), null, 'no_gym_currency',
    'an empty period at a gym with no currency is the one case that IS an unset setting');
  shape(emptyTotalMoney(''), null, 'no_gym_currency',
    'an empty string is an unset currency, not a currency');
}

/* ── 5. the sentence ───────────────────────────────────────────────────── */
{
  ok(!/has not set/i.test(MIXED_CURRENCY_NOTE),
    'the mixed-currency sentence does not accuse the gym of an unset setting');
  ok(!/error|failed|could not be read/i.test(MIXED_CURRENCY_NOTE),
    'a mixed ledger is not a failed read and must not be worded as one');
  ok(MIXED_CURRENCY_NOTE.trim().endsWith('.'), 'it is a sentence');
}

if (errors.length) { for (const e of errors) console.error('FAIL ' + e); process.exit(1); }
console.log('sumCurrency: ok');
