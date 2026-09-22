// What a rota week costs against what the gym took, and the refusals.
//
// Compile with tsc, run with node.
//
// ── the defect these assertions hold closed ───────────────────────────────
//
// app/(owner)/rota.tsx had no money on it at all. Adding some is the easy half;
// the hard half is that a labour-cost SHARE divides two figures that this
// product deliberately keeps in separate currencies. `gym_shifts.currency` is
// the coach's shift rate as it was agreed (part 196, never inherited from
// `tenants.currency`) and `gym_payments.currency` is what the till was actually
// taken in. A gym that has changed currency, or a chain holding sites in two
// countries, has both — and `cost / takings` across them produces a percentage
// that renders perfectly and means nothing.
//
// The three currencies exercised below are chosen to catch the OTHER way this
// could go wrong: somebody "fixing" the division by converting each side to
// whole units first. GBP has two decimal places, JPY has none and KWD has three,
// so a scale factor applied to both sides would still cancel in GBP and would be
// caught by neither a JPY-only nor a GBP-only case. The assertions state the
// share as an exact fraction of minor units in all three.
import {
  labourShare, type RotaCostLike, type TakingsLike,
} from './labourShare';
// The real producer of the left-hand side, so this suite cannot drift from the
// shape `rotaCost` actually returns.
import { rotaCost, type Shift } from './gymRota';
import { MIXED_CURRENCY_NOTE } from './sumCurrency';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const cost = (o: Partial<RotaCostLike> = {}): RotaCostLike => ({
  cents: 45000, currency: 'GBP', mixedCurrency: false, priced: 3, unpriced: 0, ...o,
});
const till = (o: Partial<TakingsLike> = {}): TakingsLike => ({
  cents: 180000, currency: 'GBP', ...o,
});

/* ── one currency, three different minor units ─────────────────────────────
 *
 * The same quarter, three times. Nothing is scaled on either side, so the
 * answer is identical whether the money has three decimal places, two or none
 * — which is the property that makes this division safe.
 */

{
  const gbp = labourShare(cost({ cents: 45000, currency: 'GBP' }), 'ready',
    till({ cents: 180000, currency: 'GBP' }), 'ready');
  eq(gbp.gap, 'ok', 'GBP · a week priced in one money over a till in the same money is a share');
  eq(gbp.share, 0.25, 'GBP · 450.00 of wages over 1,800.00 of takings is a quarter');
  eq(gbp.currency, 'GBP', 'and it is labelled with the money both sides agreed on');
  eq(gbp.atLeast, false, 'every shift is priced, so the figure is the figure');
  eq(gbp.note, null, 'and there is nothing left to explain');

  // Zero-decimal. 45,000 yen IS ¥45,000 — there are no sen — so a division that
  // divided either side by a hundred would still give 0.25 here and would be
  // wrong about both amounts. The share is right for the same reason it is
  // right above: neither side is touched.
  const jpy = labourShare(cost({ cents: 45000, currency: 'JPY' }), 'ready',
    till({ cents: 180000, currency: 'JPY' }), 'ready');
  eq(jpy.gap, 'ok', 'JPY · a zero-decimal currency divides like any other');
  eq(jpy.share, 0.25, 'JPY · ¥45,000 over ¥180,000 is the same quarter');
  eq(jpy.currency, 'JPY', 'and keeps its own code');

  // Three-decimal. 45,000 fils is KWD 45.000.
  const kwd = labourShare(cost({ cents: 45000, currency: 'KWD' }), 'ready',
    till({ cents: 180000, currency: 'KWD' }), 'ready');
  eq(kwd.gap, 'ok', 'KWD · a three-decimal currency divides like any other');
  eq(kwd.share, 0.25, 'KWD · 45.000 dinar over 180.000 dinar is the same quarter');
  eq(kwd.currency, 'KWD', 'and keeps its own code');

  // And an inexact one, stated exactly, so nothing here is passing on a round
  // number that would survive a scale error.
  const odd = labourShare(cost({ cents: 7333 }), 'ready', till({ cents: 21999 }), 'ready');
  eq(odd.share, 7333 / 21999, 'an unrounded share is returned unrounded');
}

/* ── a week that costs more than it took is not clamped ───────────────────── */

{
  const over = labourShare(cost({ cents: 250000 }), 'ready', till({ cents: 180000 }), 'ready');
  eq(over.gap, 'ok', 'a week that overspends is still a stateable share');
  eq(over.share, 250000 / 180000, 'and it is over one, because that is the week an owner needs to see');
}

/* ── two moneys are not a share ────────────────────────────────────────────
 *
 * The whole reason this module exists. Both sides are known, both are stated,
 * and there is no percentage between them.
 */

{
  const v = labourShare(cost({ currency: 'GBP' }), 'ready', till({ currency: 'JPY' }), 'ready');
  eq(v.gap, 'currency_mismatch', 'a GBP rota over a JPY till has no share');
  eq(v.share, null, 'so no figure is returned');
  eq(v.currency, null, 'and nothing is labelled');
  ok(!!v.note && v.note.includes('GBP') && v.note.includes('JPY'),
    'and the sentence names both currencies rather than saying "mixed"');

  // The same refusal in the pair where a careless conversion would be most
  // tempting, because the two numbers look comparable.
  const kd = labourShare(cost({ currency: 'KWD' }), 'ready', till({ currency: 'GBP' }), 'ready');
  eq(kd.gap, 'currency_mismatch', 'KWD wages over GBP takings is refused too');
  eq(kd.share, null, 'with no figure');

  // Case and padding are one currency, not two. A rota read that upper-cases on
  // the way in and a till that does not must still agree.
  const same = labourShare(cost({ currency: ' gbp ' }), 'ready', till({ currency: 'GBP' }), 'ready');
  eq(same.gap, 'ok', '" gbp " and "GBP" are one money');
  eq(same.currency, 'GBP', 'normalised to the code this product compares');
}

/* ── a rota in two moneys has no cost to be a share of ─────────────────────── */

{
  const v = labourShare(
    cost({ cents: null, currency: null, mixedCurrency: true, priced: 4, unpriced: 1 }),
    'ready', till(), 'ready',
  );
  eq(v.gap, 'rota_mixed', 'rated shifts that disagree leave no wage bill');
  eq(v.share, null, 'so no share');
  ok(!!v.note && v.note.includes('4 of 5 shifts'),
    'and the sentence says how much of the rota is costed');
  ok(!!v.note && v.note.includes(MIXED_CURRENCY_NOTE),
    'through the one wording this product has for that, not a second copy of it');

  const t = labourShare(cost(), 'ready', till({ currency: null }), 'ready');
  eq(t.gap, 'takings_mixed', 'and a ledger that disagrees leaves no till');
  eq(t.share, null, 'so no share');
}

/* ── an unpriced shift is unknown, never free ──────────────────────────────
 *
 * The failure this whole module is pointed at: two shifts costed out of nine,
 * reported as a gym that barely spends anything on labour.
 */

{
  const v = labourShare(
    cost({ cents: 45000, priced: 2, unpriced: 7 }), 'ready',
    till({ cents: 180000 }), 'ready',
  );
  eq(v.gap, 'ok', 'a partly costed rota still yields a figure');
  eq(v.share, 0.25, 'computed over the shifts that carry a rate');
  eq(v.atLeast, true, 'and flagged as a FLOOR, because seven shifts cost an unknown amount');
  ok(!!v.note && v.note.includes('2 of 9 shifts'),
    'with a sentence naming how many of the week are priced');
  ok(!!v.note && v.note.includes('this or higher'),
    'and saying which direction the real figure lies in');

  // Nothing priced at all is a different fact again, and it is not a zero.
  const none = labourShare(
    cost({ cents: null, priced: 0, unpriced: 9 }), 'ready', till(), 'ready',
  );
  eq(none.gap, 'no_rota_cost', 'a rota where nothing carries a rate has no cost');
  eq(none.share, null, 'and no share');
  eq(none.atLeast, false, 'there is no floor either — a floor needs a figure');
  ok(!!none.note && none.note.includes('9 shifts') && none.note.includes('free'),
    'and the sentence says rostered-and-unpriced is not rostered-and-free');
}

/* ── nothing to be a share of ──────────────────────────────────────────────
 *
 * Dividing by zero produces Infinity, and `Math.round(Infinity * 100)` is
 * Infinity. A percentage of Infinity renders, which is exactly why this is
 * refused here rather than at the formatter.
 */

{
  const v = labourShare(cost(), 'ready', till({ cents: 0 }), 'ready');
  eq(v.gap, 'no_takings', 'a window with nothing recorded coming in has no denominator');
  eq(v.share, null, 'so nothing is divided');
  ok(!!v.note && v.note.includes('nobody having entered a payment'),
    'and the sentence keeps "took nothing" apart from "recorded nothing"');

  // Reversals can carry a window below zero. A share of a negative is not a
  // smaller share.
  const neg = labourShare(cost(), 'ready', till({ cents: -5000 }), 'ready');
  eq(neg.gap, 'no_takings', 'a window that nets below zero has no denominator either');
  eq(neg.share, null, 'and no share');
  ok(!!neg.note && neg.note.includes('below zero'), 'said as what it is');
}

/* ── a read is not a fact ──────────────────────────────────────────────────
 *
 * Four states on each side, and the four are four. 'loading' must not print a
 * refusal, 'error' must not print an empty week, and 'partial' must not be
 * counted at all.
 */

{
  eq(labourShare(cost(), 'loading', till(), 'ready').gap, 'loading', 'a rota still loading is not a refusal');
  eq(labourShare(cost(), 'loading', till(), 'ready').note, null, 'and says nothing yet');
  eq(labourShare(cost(), 'ready', till(), 'loading').gap, 'loading', 'nor is a till still loading');

  const re = labourShare(cost(), 'error', till(), 'ready');
  eq(re.gap, 'rota_unread', 'a refused rota read is its own state');
  eq(re.share, null, 'with no share');
  ok(!!re.note && re.note.includes('not nothing'), 'and is never drawn as an unstaffed week');

  const te = labourShare(cost(), 'ready', till(), 'error');
  eq(te.gap, 'takings_unread', 'a refused payment read is its own state');
  ok(!!te.note && te.note.includes('not a week in which the gym took nothing'),
    'and is never drawn as a week with no income');

  // 'partial' is the one that used to be counted. The rows are real and the SET
  // is a prefix, so every figure over it is a fraction rendered as a fact.
  const rp = labourShare(cost(), 'partial', till(), 'ready');
  eq(rp.gap, 'rota_partial', 'a truncated rota read is not the week');
  eq(rp.share, null, 'and no share is computed over a prefix of it');
  const tp = labourShare(cost(), 'ready', till(), 'partial');
  eq(tp.gap, 'takings_partial', 'a truncated payment read is not the window');
  eq(tp.share, null, 'and no share is computed over a prefix of it');

  // Loading wins over error, because "not yet" must not be drawn as "broken"
  // while the other half is still in flight.
  eq(labourShare(cost(), 'loading', till(), 'error').gap, 'loading',
    'one side still loading holds the whole answer at loading');

  // A null under a ready state is the unread case, never a zero.
  eq(labourShare(null, 'ready', till(), 'ready').gap, 'rota_unread', 'a missing cost is unread, not free');
  eq(labourShare(cost(), 'ready', null, 'ready').gap, 'takings_unread', 'a missing till is unread, not empty');
  eq(labourShare(cost(), 'ready', till({ cents: null }), 'ready').gap, 'takings_unread',
    'and a till with a null total is the same fact');
}

/* ── a rate with no currency is a number that cannot be written down ───────── */

{
  const v = labourShare(cost({ cents: 45000, currency: null }), 'ready', till(), 'ready');
  eq(v.gap, 'rota_unstated', 'a wage bill in no stated money is withheld');
  eq(v.share, null, 'rather than divided against a till in a currency it never shared');
  ok(!!v.note && !v.note.includes('GBP'), 'and it is not quietly labelled with the till’s code');
}

/* ── against the real `rotaCost`, not a hand-built shape ───────────────────
 *
 * The left-hand side of every case above is a literal. This is the one case
 * that runs the actual producer, so a change to `rotaCost`'s contract fails
 * here rather than silently making this whole suite a test of nothing.
 */

{
  const shift = (o: Partial<Shift> = {}): Shift => ({
    id: 's1', trainerId: 't1', trainerName: 'Marcus',
    startsAt: '2026-09-07T06:00:00.000Z', endsAt: '2026-09-07T14:00:00.000Z',
    role: 'floor', status: 'scheduled', note: null,
    rateCents: 12000, currency: 'GBP', ...o,
  });

  const oneMoney = rotaCost([
    shift({ id: 'a' }),
    shift({ id: 'b', rateCents: 8000 }),
    // Pulled. Not a cost, and `rotaCost` already excludes it — asserted here
    // because the share would otherwise inherit a wrong numerator.
    shift({ id: 'c', rateCents: 99999, status: 'cancelled' }),
    // Rostered and unpriced. Counted, never summed.
    shift({ id: 'd', rateCents: null, currency: null }),
  ]);
  eq(oneMoney.cents, 20000, 'rotaCost sums the live, priced shifts');
  eq(oneMoney.unpriced, 1, 'and keeps the unpriced one as a count');

  const real = labourShare(oneMoney, 'ready', { cents: 80000, currency: 'GBP' }, 'ready');
  eq(real.gap, 'ok', 'and the pair produce a share');
  eq(real.share, 0.25, 'of 200.00 over 800.00');
  eq(real.atLeast, true, 'flagged as a floor, because one live shift is unpriced');

  // Two moneys on one rota, through the real function.
  const twoMoneys = rotaCost([shift({ id: 'a' }), shift({ id: 'b', currency: 'KWD' })]);
  eq(twoMoneys.mixedCurrency, true, 'rotaCost refuses to add GBP to KWD');
  eq(labourShare(twoMoneys, 'ready', { cents: 80000, currency: 'GBP' }, 'ready').gap, 'rota_mixed',
    'and the share is withheld for the reason the cost was');
}

if (errors.length) {
  console.error(`labourShare: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('labourShare ok');
