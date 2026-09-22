// A month's figure as it is QUOTED to somebody outside the gym.
//
// ── the defect ────────────────────────────────────────────────────────────
//
// /accounting and /close are the two screens a month-end figure leaves the
// building from: one is headed "the form you hand to whoever files it", the
// other writes its figures permanently into `gym_month_closes`. Both held the
// same rule and both stopped one step short of it.
//
// The rule is the one src/lib/coachMoney.ts states and `sumTaken` implements:
// never add two currencies. Both screens obeyed it. What neither did was say
// what the two currencies ARE. A gym that took AED 6,000 and GBP 400 in August
// read, on the tile at the top of the page:
//
//     Money in     —
//                  AED and GBP in one set — not summed
//
// on /accounting, and
//
//     Taken        —
//                  more than one currency — not summed
//
// on /close. Both sentences are true and neither is the figure. The owner has
// two amounts of money, each of them a real total of like things, and the
// screen quoted neither — on the page whose entire job is to be quoted from.
// The same gym's Costs section three sections down printed "AED 2,100.00 and
// GBP 90.00 — kept apart, because this app holds no rate between them", which
// is the right answer, arrived at once and never generalised.
//
// The second half is the same mistake about a different silence. `sumOf` on
// /accounting refused the WHOLE set when any row carried no amount: three
// unpriced rows out of forty-one took the other thirty-eight off the screen.
// "£4,210" and "£4,210, covering the 38 of 41 payments that carried an amount"
// are different claims, and only the first of those is a lie. A dash is a third
// claim and it is not better than either.
//
// ── the rule, in one sentence ─────────────────────────────────────────────
//
// A figure is quoted per currency, side by side, never added; and it always
// says how many of the rows behind it it could not speak for.
//
// ── what is deliberately NOT here ─────────────────────────────────────────
//
// No formatter. `money()` reaches `appLocale()` in src/lib/locale.ts, a
// module-level latch seeded from the device — which on the console resolves on
// the server during render and again in the browser during hydration, on two
// machines with two locales. studio-web/lib/num.ts states that argument at
// length and it is why every function here takes the caller's own formatter.
//
// No read, no client, no `Date`. Pure, like `sumTaken` underneath it, so the
// assertions in quotedTotal.test.ts are about the arithmetic and the sentence
// rather than about a screen.
//
// No conversion, ever. There is no rate anywhere in this product and a figure
// built from one nobody chose is the worst thing either of these two pages
// could produce.
import { sumTaken, type Pot } from './coachMoney';

/** One row of anything money-shaped: a payment, an invoice, a settlement, a
 *  cost. The two fields a total depends on and nothing else. */
export interface QuotedRow {
  amountCents: number | null;
  currency: string | null;
}

/**
 * A figure, ready to be quoted.
 *
 * `pots` is the answer and there may be more than one of them. `unpriced` and
 * `unlabelled` are the two ways a row can fail to reach one, kept apart because
 * they send somebody to two different places: a row with no amount is a gap in
 * what was recorded, a row with no currency is a gap in what it was recorded
 * in. `rows` is what was handed in, so the sentence below can say "38 of 41"
 * rather than "38".
 */
export interface Quoted {
  /** One per currency, biggest first. Empty when nothing could be stated. */
  pots: Pot[];
  /** Rows that carry an amount and name no currency. Never folded into a pot. */
  unlabelled: number;
  /** Rows that carry no amount at all. Emphatically not rows worth nothing. */
  unpriced: number;
  /** How many rows were handed in, pots and holes together. */
  rows: number;
  /** How many of them are inside a pot. `rows - counted` is the hole. */
  counted: number;
}

/** How many rows this figure could not speak for. */
export function quotedShort(q: Quoted): number {
  return q.unpriced + q.unlabelled;
}

/**
 * Whether this figure is a single amount of a single money with nothing left
 * out — the only shape another figure may be derived FROM.
 *
 * Subtracting a short total from a whole one, or taking a percentage of a total
 * that is missing three rows, produces a number with no stated error and no way
 * for a reader to see one. Every caller that arithmetics on a quoted figure
 * asks this first.
 */
export function quotedWhole(q: Quoted): boolean {
  return q.pots.length === 1 && quotedShort(q) === 0;
}

/** Add up a set of rows, one currency at a time. */
export function quotedOf(rows: readonly QuotedRow[]): Quoted {
  const t = sumTaken(rows.map((r) => ({
    amount_cents: r.amountCents,
    currency: r.currency,
    // `sumTaken` never reads it — it groups and totals and does no date work at
    // all. Passed as the empty string rather than as a real instant so nothing
    // here can start depending on a clock.
    created_at: '',
  })));
  const counted = t.pots.reduce((a, p) => a + p.count, 0);
  return {
    pots: t.pots,
    unlabelled: t.unlabelled,
    unpriced: t.unpriced,
    rows: rows.length,
    counted,
  };
}

/**
 * The same, for a set already grouped per currency.
 *
 * `incomeOf` in src/lib/monthEnd.ts has grouped its lines by method AND
 * currency since the wave that found "Card 4,200" printed over two moneys, so
 * /close is already holding the pots — it just had no way to say them. Adding a
 * second pass over the raw payments to get them back would be a second
 * implementation of the same grouping, and the two would drift.
 *
 * A line whose `currency` is null is an amount nobody stated a money for. It
 * contributes its COUNT to `unlabelled` and its cents to nothing at all.
 */
export function quotedOfLines(
  lines: readonly { currency: string | null; cents: number; count: number }[],
): Quoted {
  const by = new Map<string, Pot>();
  let unlabelled = 0;
  let rows = 0;
  for (const l of lines) {
    rows += l.count;
    const cur = (l.currency || '').trim().toUpperCase();
    if (!cur) { unlabelled += l.count; continue; }
    const pot = by.get(cur);
    if (pot) { pot.minorUnits += l.cents; pot.count += l.count; }
    else by.set(cur, { currency: cur, minorUnits: l.cents, count: l.count });
  }
  const pots = [...by.values()]
    .sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency));
  return {
    pots,
    unlabelled,
    // A grouped line cannot carry a row with no amount: a row with no amount
    // never reached a line. The caller that has that count says so itself.
    unpriced: 0,
    rows,
    counted: rows - unlabelled,
  };
}

/**
 * The figure itself: every pot, side by side, in the caller's own formatter.
 *
 * Null when there is no pot — which is a set with nothing addable in it, and is
 * the one case that renders as a dash. A pot whose formatter returns null is
 * dropped WITH the rest: half of a two-currency figure is worse than none,
 * because nothing on the line says a half is what it is. In practice this
 * cannot fire — a pot only exists because a row named a currency — and it is
 * written because "in practice" is what every currency defect in this tree was
 * made of.
 */
export function quotedText(
  q: Quoted,
  fmt: (minorUnits: number, currency: string) => string | null,
): string | null {
  if (!q.pots.length) return null;
  const parts = q.pots.map((p) => fmt(p.minorUnits, p.currency));
  if (parts.some((p) => p == null)) return null;
  return (parts as string[]).join(' and ');
}

/** What the rows are called in the sentence. Singular and plural, because the
 *  four screens that ask hold payments, invoices, settlements and costs. */
export interface Noun { one: string; many: string }

const count = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.one : noun.many}`;

/**
 * The sentence under the figure — what it covers, and what it does not.
 *
 * `whenEmpty` is the caller's own sentence for a set with no rows in it, and it
 * is a caller's decision rather than this module's: "no payment is recorded in
 * August" is a statement about the record and the screens each word it against
 * their own subject. It is never defaulted to something about zero.
 *
 * Every other arm names a count. That is the whole discipline: a figure that
 * cannot say how many rows are behind it and how many are not is not a figure
 * an accountant can do anything with.
 */
export function quotedNote(q: Quoted, noun: Noun, whenEmpty: string): string {
  const short = quotedShort(q);

  if (!q.pots.length) {
    if (q.rows === 0) return whenEmpty;
    // Rows exist and not one of them could be added. Deliberately not the empty
    // sentence: this gym recorded something, and saying "nothing is recorded"
    // over it is the substitution both screens exist to refuse.
    return `${count(q.rows, noun)} on record, and not one states both an amount and a currency, so there is no figure to quote.`;
  }

  const apart = q.pots.length > 1
    ? ` The ${q.pots.length} are quoted apart and never added: this app holds no rate between them, and a figure built from a rate nobody chose is the one thing this page must not produce.`
    : '';

  if (short === 0) {
    return `${count(q.counted, noun)}.${apart}`;
  }

  // The shape the brief for this module names: a figure, and the size of what
  // it is not speaking for, in the same breath.
  const holes: string[] = [];
  if (q.unpriced) holes.push(`${q.unpriced} carr${q.unpriced === 1 ? 'ies' : 'y'} no amount`);
  if (q.unlabelled) holes.push(`${q.unlabelled} state${q.unlabelled === 1 ? 's' : ''} no currency`);
  return `Covering the ${q.counted} of ${count(q.rows, noun)} that could be totalled: ${holes.join(', ')}, and ${short === 1 ? 'that row is' : 'those rows are'} left out rather than counted as nothing.${apart}`;
}
