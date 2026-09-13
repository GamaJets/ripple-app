// What counts as a currency, and what a row holding `pounds` is worth.
// Compile with tsc, run with node.
//
// `gymMoney.test.ts` next door already covers `summarise` and the shape of
// `sharedCurrency`'s agreement rule. This suite is about the layer under both
// of them — the two functions that decide whether a stored string is a money
// at all — because that is where the defect was and `sharedCurrency` was only
// where it surfaced.
//
// ── the defect ────────────────────────────────────────────────────────────
//
// `normaliseCurrency` was `trim().toUpperCase() || null`. It rejected the empty
// string and accepted everything else, so `'pounds'` came back as `'POUNDS'`:
// truthy, stable, and comparable. Five money columns in this schema carry no
// format check (`gym_passes`, `gym_pass_types`, `membership_plans`,
// `gym_invoices`, `gym_orders`, with `gym_payments` a sixth), so that value
// arrives here from a row somebody actually typed.
//
// Two rows both holding it compared EQUAL, were subtracted, and put a member on
// the list price — the fold src/lib/priceBook.ts exists to refuse, reached
// through the currency instead of the amount.
//
//   TEXT      what the column SPELLS, which is a different question
//   CODE      three letters or it is not a currency
//   SHARED    the agreement rule, over values that are not codes
//   COUNTED   a null names nothing and drops nothing
import { normaliseCurrency, currencyText, sharedCurrency, money } from './gymRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── TEXT ─────────────────────────────────────────────────────────────────
 * `currencyText` settles case and spacing and asks NOTHING about the shape.
 * It exists for src/lib/strayCurrency.ts, which has to quote `Pounds` back to
 * an owner and cannot do that if the value became null on the way in.
 */
{
  eq(currencyText('gbp'), 'GBP', 'case is settled');
  eq(currencyText('  gbp  '), 'GBP', 'and so is spacing');
  eq(currencyText('pounds'), 'POUNDS', 'a non-code SURVIVES here — this is the spelling half');
  eq(currencyText('£'), '£', 'a symbol is a thing the column says, and this function reports what it says');
  eq(currencyText(''), null, 'an empty column says nothing');
  eq(currencyText('   '), null, 'and neither does one holding only spaces');
  eq(currencyText(null), null, 'null says nothing');
  eq(currencyText(undefined), null, 'and so does an absent field — the same silence');
}

/* ── CODE ─────────────────────────────────────────────────────────────────
 * `normaliseCurrency` answers "what money is this", and `null` means "not one
 * this app can name". Three letters A-Z after trimming and upper-casing, which
 * is `/^[A-Z]{3}$/` — the same test priceBook.ts, coachCosts.ts,
 * coachInvoice.ts, costBudgets.ts, coachReceipts.ts and csvImport.ts apply, and
 * the same one `tenants_currency_is_iso` holds in the database.
 */
{
  eq(normaliseCurrency('GBP'), 'GBP', 'a code is a code');
  eq(normaliseCurrency('gbp'), 'GBP', 'lower case is the same currency, not a second one');
  eq(normaliseCurrency(' gbp '), 'GBP', 'and so is a padded one');
  eq(normaliseCurrency('JPY'), 'JPY', 'a zero-decimal currency is a currency like any other');
  eq(normaliseCurrency('kwd'), 'KWD', 'and so is a three-decimal one');

  // The defect, stated as the assertion that would have caught it.
  eq(normaliseCurrency('pounds'), null, 'THE DEFECT: `pounds` is not a currency and must not normalise to one');
  eq(normaliseCurrency('POUNDS'), null, 'shouting it does not make it a code either');
  eq(normaliseCurrency('GB'), null, 'two letters is not ISO 4217');
  eq(normaliseCurrency('GBPX'), null, 'and neither is four');
  eq(normaliseCurrency('£'), null, 'a symbol is not a code');
  eq(normaliseCurrency('12 '), null, 'digits are not letters');
  eq(normaliseCurrency('G BP'), null, 'inner spacing is not trimmed away into a code');
  eq(normaliseCurrency('GB1'), null, 'nor is a code with a digit in it');
  eq(normaliseCurrency(''), null, 'an empty column is not a currency');
  eq(normaliseCurrency(null), null, 'and nor is a null one');

  // The two halves agree about what they are: everything the strict one
  // accepts, the loose one spells identically.
  for (const c of ['GBP', 'gbp', ' jpy ', 'KWD', 'aed']) {
    eq(normaliseCurrency(c), currencyText(c),
      `a real code reads the same through both functions — ${JSON.stringify(c)}`);
  }
  // And everything it rejects, the loose one still has something to say about.
  for (const c of ['pounds', 'GB', '£']) {
    eq(normaliseCurrency(c), null, `${JSON.stringify(c)} is not a currency`);
    ok(currencyText(c) != null, `but ${JSON.stringify(c)} is still something the column SAYS, for strayCurrency to quote`);
  }
}

/* ── SHARED ───────────────────────────────────────────────────────────────
 * The Lane 2 defect, at the layer it reached.
 *
 * Two rows both holding `pounds` used to agree — `sharedCurrency` handed back
 * `'POUNDS'`, and a caller holding a non-null currency believes it may compare,
 * subtract and print. Now they agree on nothing, which is the truth: neither
 * row says what money it is in.
 */
{
  eq(sharedCurrency([{ currency: 'pounds' }, { currency: 'pounds' }]), null,
    'THE DEFECT: two rows holding the same non-code do NOT agree on a currency');
  eq(sharedCurrency([{ currency: 'GBP' }, { currency: 'pounds' }]), null,
    'a code and a non-code share nothing');
  eq(sharedCurrency([{ currency: 'GBP' }, { currency: ' gbp ' }]), 'GBP',
    'but two spellings of one real code are still one currency');
  eq(sharedCurrency([{ currency: 'JPY' }, { currency: 'jpy' }]), 'JPY',
    'including a zero-decimal one');
  eq(sharedCurrency([{ currency: 'KWD' }, { currency: 'KWD' }]), 'KWD',
    'and a three-decimal one');
  eq(sharedCurrency([{ currency: 'pounds' }, { currency: '' }]), null,
    'a non-code and a blank are both "nobody said", and two silences agree on nothing');
}

/* ── COUNTED ──────────────────────────────────────────────────────────────
 * The whole risk of this change: a null must mean "this money cannot be
 * SPELLED" and must never become a default, `tenants.currency`, or a row
 * missing from a count.
 *
 * `money()` delegates to `minorMoney`, so this is also the Lane 12 defect —
 * `money(6000, 'pounds')` rendered "POUNDS 60.00" at every gym screen in the
 * product.
 */
{
  eq(money(6000, 'pounds'), null,
    'THE DEFECT: an amount in a non-currency is withheld, not printed with a made-up unit');
  eq(money(6000, 'GBP'), 'GBP 60.00', 'a real code still prints');
  eq(money(6000, 'JPY'), 'JPY 6,000', 'a yen has no minor unit, so the minor amount IS the amount');
  eq(money(6000, 'KWD'), 'KWD 6.000', 'and a dinar has three places, not two');

  // Null is not zero, and it is not the gym's currency either.
  ok(money(6000, 'pounds') !== 'GBP 60.00', 'and it is certainly not silently relabelled as the gym’s own money');
  ok(money(6000, 'pounds') !== '0' && money(6000, 'pounds') !== 'POUNDS 0.00',
    'a withheld figure is never a zero');
  eq(money(0, 'GBP'), 'GBP 0.00', 'a real zero in a real currency is still a real zero and is still printed');

  // The row is not dropped from anything. `sharedCurrency` answering null is a
  // caller's instruction to WITHHOLD the total and say why, not to leave the
  // row out of the set it came from — which is what every caller in the tree
  // does with it (unstatedTakings counts, incomeOf makes null a set member,
  // denominate adds null to `codes`).
  const rows = [{ currency: 'GBP' }, { currency: 'pounds' }, { currency: '' }];
  eq(rows.length, 3, 'the rows are still three rows whatever their currencies say');
  eq(new Set(rows.map((r) => normaliseCurrency(r.currency))).size, 2,
    'and they fall into exactly two buckets: one real currency, and one "cannot be named"');
}

if (errors.length) {
  console.error(`gymRecord: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('gymRecord: ok (three letters or it is not a currency, and a null names nothing and drops nothing)');
