// The six this file exists to stop.
//
//   1. TWO CURRENCIES ADDED. A client who paid GBP 90 and JPY 12,000 has two
//      figures. Anything that makes those one number is a claim about exchange
//      rates nobody in this app has ever supplied.
//
//   2. A ZERO-DECIMAL OR THREE-DECIMAL CURRENCY DIVIDED BY A HUNDRED. JPY has
//      no minor unit and KWD has three, so ¥12,000 is twelve thousand yen and
//      KD 45.500 is 45500 fils. `minorMoney` knows; a `/ 100` anywhere in the
//      arithmetic would print ¥120 and KD 455.00.
//
//   3. A BREAKDOWN OVER A TRUNCATED READ. Under 'partial' every row is real and
//      the set is a prefix, which is the one state where a per-client figure
//      looks completely correct and is not. Nothing is returned.
//
//   4. A REFUND SUBTRACTED. `refunded_cents` carries no date, so it is stated
//      beside the gross and taken off nothing — the doctrine
//      app/(trainer)/payments.tsx already applies to the whole-screen figure.
//
//   5. "UNKNOWN" WHERE A NAME COULD NOT BE READ. The payment is real; the
//      failure is ours, and the row says which.
//
//   6. AN UNATTACHED OR UNPRICED CHARGE DROPPED. This is a breakdown of a total
//      that includes them, so money with no client on it and money with no
//      currency on it are counted out loud rather than quietly left out.
//
// Compile with tsc, run with node.
import { payerBook, payerPayments, payerGaveBack, type PayerCharge } from './payerBook';
import { minorMoney } from './coachMoney';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const charge = (over: Partial<PayerCharge> & Pick<PayerCharge, 'client_id'>): PayerCharge => ({
  client_name: null, amount_cents: null, currency: null, kind: 'one-off', ...over,
});

/* ── the set every figure below is computed over ───────────────────────────
 *
 * One coach, three currencies, on purpose: sterling (two decimals), yen (none)
 * and Kuwaiti dinar (three). If any arithmetic in payerBook.ts scaled anything
 * by a hundred, two of these three would be wrong and one would look right. */
const rows: PayerCharge[] = [
  // Ana, sterling, three charges — a pack, a membership and a renewal. One of
  // the three has had GBP 15.00 refunded.
  charge({ client_id: 'ana', client_name: 'Ana', amount_cents: 24000, currency: 'GBP' }),
  charge({ client_id: 'ana', client_name: 'Ana', amount_cents: 9000, currency: 'gbp', refunded_cents: 1500 }),
  charge({ client_id: 'ana', client_name: 'Ana', amount_cents: 6000, currency: 'GBP', kind: 'renewal' }),
  // Kenji, yen. ¥12,000 and ¥8,000 — a zero-decimal currency, where the minor
  // unit IS the yen.
  charge({ client_id: 'kenji', client_name: 'Kenji', amount_cents: 12000, currency: 'JPY' }),
  charge({ client_id: 'kenji', client_name: 'Kenji', amount_cents: 8000, currency: 'JPY', kind: 'renewal' }),
  // Noura, Kuwaiti dinar. 45500 fils is KD 45.500, and 12000 fils is KD 12.000.
  charge({ client_id: 'noura', client_name: 'Noura', amount_cents: 45500, currency: 'KWD' }),
  charge({ client_id: 'noura', client_name: 'Noura', amount_cents: 12000, currency: 'KWD', refunded_cents: '12000' }),
  // Ana again, in yen, on a trip. Two currencies, one person, two figures.
  charge({ client_id: 'ana', client_name: 'Ana', amount_cents: 3000, currency: 'JPY' }),
  // A sale whose name could not be read.
  charge({ client_id: 'ghost', client_name: null, amount_cents: 5000, currency: 'GBP' }),
  // A sale whose package was deleted before part 132: an amount with no unit.
  charge({ client_id: 'ana', client_name: 'Ana', amount_cents: 7700, currency: null }),
  // A sale Stripe never stated an amount for.
  charge({ client_id: 'kenji', client_name: 'Kenji', amount_cents: null, currency: 'JPY' }),
  // Money with nobody on it.
  charge({ client_id: null, amount_cents: 2500, currency: 'GBP' }),
];

/* ── 1. only a whole read is grouped ───────────────────────────────────── */
{
  eq(payerBook(rows, 'loading'), null, 'nothing is grouped while the read is still in flight');
  eq(payerBook(rows, 'error'), null, 'a failed read produces no list, never an empty one');
  eq(payerBook(rows, 'partial'), null,
    'a truncated read produces no per-client breakdown: every row is real and the set is a prefix');
}

const book = payerBook(rows, 'ready');
if (!book) {
  errors.push('a ready read produced no book at all');
} else {
  /* ── 2. the arithmetic, per client, per currency ────────────────────── */
  {
    const ana = book.payers.find((p) => p.clientId === 'ana');
    ok(!!ana, 'Ana is in the book');
    if (ana) {
      // GBP 240.00 + GBP 90.00 + GBP 60.00 = GBP 390.00, i.e. 39000 pence.
      // The lower-case 'gbp' on the second row is the same currency.
      const gbp = ana.taken.pots.find((p) => p.currency === 'GBP');
      eq(gbp?.minorUnits, 39000, 'Ana’s sterling is the three sterling charges added, and case does not fork a pot');
      eq(gbp?.count, 3, 'three sterling payments');
      eq(minorMoney(gbp?.minorUnits ?? null, 'GBP'), 'GBP 390.00', 'and it formats as three hundred and ninety pounds');
      // The yen charge is a SECOND pot. Never added to the sterling one.
      const jpy = ana.taken.pots.find((p) => p.currency === 'JPY');
      eq(jpy?.minorUnits, 3000, 'Ana’s yen is its own pot');
      eq(minorMoney(jpy?.minorUnits ?? null, 'JPY'), 'JPY 3,000',
        'three thousand yen, NOT 30 — a zero-decimal currency is not divided by a hundred');
      eq(ana.taken.pots.length, 2, 'two currencies means two figures and no third');
      eq(ana.taken.unlabelled, 1, 'the sale whose package is gone is counted, not dropped and not summed');
      eq(payerPayments(ana), 4, 'the payment count is over the amounts that are IN the figures');
    }
  }
  {
    const noura = book.payers.find((p) => p.clientId === 'noura');
    ok(!!noura, 'Noura is in the book');
    if (noura) {
      // 45500 + 12000 = 57500 fils = KD 57.500. A three-decimal currency.
      const kwd = noura.taken.pots.find((p) => p.currency === 'KWD');
      eq(kwd?.minorUnits, 57500, 'Noura’s dinar is the two charges added in fils');
      eq(minorMoney(kwd?.minorUnits ?? null, 'KWD'), 'KWD 57.500',
        'fifty-seven and a half dinar — three decimal places, not two');
    }
  }
  {
    const kenji = book.payers.find((p) => p.clientId === 'kenji');
    if (kenji) {
      eq(kenji.taken.pots[0]?.minorUnits, 20000, 'Kenji’s yen is ¥12,000 + ¥8,000');
      eq(minorMoney(kenji.taken.pots[0]?.minorUnits ?? null, 'JPY'), 'JPY 20,000', 'twenty thousand yen');
      eq(kenji.taken.unpriced, 1, 'the charge Stripe stated no amount for is counted, never read as nought');
      eq(payerPayments(kenji), 2, 'and it is not counted as a payment in the figure it is not in');
      eq(kenji.renewals, 1, 'one of Kenji’s two priced charges is a renewal');
    }
  }

  /* ── 3. refunds are beside the figure, never inside it ──────────────── */
  {
    const ana = book.payers.find((p) => p.clientId === 'ana');
    const noura = book.payers.find((p) => p.clientId === 'noura');
    if (ana) {
      eq(ana.taken.pots.find((p) => p.currency === 'GBP')?.minorUnits, 39000,
        'the GBP 15.00 refunded is NOT taken off Ana’s sterling');
      eq(ana.givenBack.pots.find((p) => p.currency === 'GBP')?.minorUnits, 1500,
        'it is stated as its own figure');
      eq(ana.givenBack.pots.length, 1, 'and only in the currency it went back in');
      ok(payerGaveBack(ana), 'Ana has had something back');
    }
    if (noura) {
      // A refund handed back as a string, which is how PostgREST returns a
      // bigint often enough to be the normal case.
      eq(noura.givenBack.pots[0]?.minorUnits, 12000, 'a refund that arrived as a string is still a refund');
      eq(noura.taken.pots[0]?.minorUnits, 57500, 'and the fully refunded charge still stands at its full amount');
    }
    const kenji = book.payers.find((p) => p.clientId === 'kenji');
    if (kenji) ok(!payerGaveBack(kenji), 'a coach who has refunded this client nothing is not made to read a zero');
  }

  /* ── 4. a name that could not be read ───────────────────────────────── */
  {
    const ghost = book.payers.find((p) => p.clientId === 'ghost');
    ok(!!ghost, 'a payment by somebody whose name could not be read is still in the book');
    eq(ghost?.name, null, 'and the name is null rather than the word "Unknown"');
    eq(book.nameless, 1, 'and the book says how many there are');
  }

  /* ── 5. money with nobody on it ─────────────────────────────────────── */
  {
    eq(book.unattached.pots[0]?.currency, 'GBP', 'a charge with no client is kept');
    eq(book.unattached.pots[0]?.minorUnits, 2500, 'at its own amount');
    ok(!book.payers.some((p) => p.clientId === ''), 'and it is attached to nobody');
  }

  /* ── 6. the order, and the currency it is by ────────────────────────── */
  {
    // Across the book: GBP 39000 + 5000 + 2500 = 46500; JPY 20000 + 3000 =
    // 23000; KWD 57500. Those three numbers are NOT comparable as money and the
    // ordering does not pretend they are — it picks the largest and says which
    // it picked, so the screen can print "ordered by KWD alone".
    eq(book.orderedBy, 'KWD', 'the book is ordered within one currency and names it');
    eq(book.currencies.length, 3, 'and reports all three, so the screen can say two more exist');
    eq(book.payers[0]?.clientId, 'noura', 'the largest KWD pot leads');
    // Everybody else has no KWD at all and sorts by name behind them: Ana,
    // Kenji, then the nameless row last.
    eq(book.payers[1]?.name, 'Ana', 'a payer with no pot in that currency sorts by name behind those who have one');
    eq(book.payers[2]?.name, 'Kenji', 'and stably');
    eq(book.payers[3]?.name, null, 'with the unreadable name last rather than first');
    // Ordering NEVER moves money between pots.
    eq(book.payers[1]?.taken.pots.find((p) => p.currency === 'GBP')?.minorUnits, 39000,
      'and ordering by one currency leaves every other figure exactly as it was paid');
  }
}

/* ── 7. an empty book is not a failure and not a hole ──────────────────── */
{
  const empty = payerBook([], 'ready');
  ok(!!empty, 'a coach nobody has paid still gets a book');
  eq(empty?.payers.length, 0, 'with nobody in it');
  eq(empty?.orderedBy, null, 'and no currency to order by — never a default one');
  eq(empty?.currencies.length, 0, 'and no currency claimed at all');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('payerBook: ok');
