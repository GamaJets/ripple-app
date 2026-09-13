// What each pass type actually SOLD, as against what the price book says it
// costs.
//
// ── the gap this closes ───────────────────────────────────────────────────
//
// A gym defines a pass type once — a name, a price, a number of visits, an
// expiry — and `gym_pass_types` has carried all four since part 31. The console
// shows that definition on /money (`PassTypes` there is the price book) and
// stops. Nothing anywhere answers the next question, which is the only one that
// decides whether a product stays on the list:
//
//   · how many of this pack has the desk actually sold, and
//   · what did those sales bring in.
//
// /passes already reads every `gym_passes` row for the conversion report, and
// every one of those rows carries `pass_type_id`, `paid_cents` and its own
// `currency`. So the answer was one grouping away from a screen that already
// had the rows in memory. This is that grouping, and nothing else: no database,
// no formatting, so it runs under plain node and the assertions in
// src/lib/passTypeSales.test.ts can hold it to the rules below.
//
// ── the rules, and what each one costs when it is broken ──────────────────
//
// A SALE IS NEVER SUMMED ACROSS CURRENCIES. `gym_passes.currency` is per row
// and a gym that changed currency mid-year has both on its books, so the take
// for one pass type is a LIST of amounts — one per currency the priced sales
// actually stated — and never a single figure. `passRevenueCents` in
// gymPasses.ts makes the same argument for the whole-gym total and answers it
// by withholding; withholding is wrong HERE, because a per-product table whose
// best-selling row is blank is a table nobody can use. Naming both amounts is
// the honest version, and it is the one an owner can act on.
//
// AN UNPRICED PASS IS NOT A FREE ONE. `paid_cents` is nullable and null means
// nobody recorded a price. Counting it as zero would report a pack that sold
// forty times for cash as having brought in nothing, on the screen an owner
// uses to decide whether to keep selling it. So `sold` and `priced` are two
// numbers and the difference between them is printed rather than absorbed.
//
// A TYPE THAT SOLD NOTHING IS THE MOST ACTIONABLE ROW ON THE TABLE, so the
// price book is an input and every type in it gets a row whether or not a
// single one was sold. When the book could not be READ the zero rows cannot
// exist — there is no list of types to have zero against — and that is a
// different table with a different meaning; `BOOK_UNREAD_NOTE` is the sentence
// that says so, and a screen that prints this table without it is claiming
// every product the gym sells is on screen when only the ones that sold are.
//
// A PASS WHOSE TYPE COULD NOT BE READ IS ITS OWN ROW. `pass_type_id` is
// nullable and the join in `fetchPasses` can come back without the type, so
// those sales are grouped under a null id and counted out loud rather than
// dropped — a dropped row is money missing from a revenue table with nothing
// saying it is missing — and never merged into a named product, which would put
// somebody else's takings under a name.
//
// THE LIST PRICE IS NOT A MULTIPLIER. `issuePass` copies the price onto the
// pass at the moment of sale, so a type repriced in June has May's sales at
// May's price, and `listPriceCents × sold` is not what came in. The two are
// shown side by side and `PRICE_MOVED_NOTE` says why they may disagree; nothing
// here ever multiplies them.

import type { GymPass, PassKind, PassType } from './gymPasses';
// The one rule about what two currency codes mean — ' gbp ' and 'GBP' are one
// currency and '' is none. Imported rather than restated: a second copy is how
// a table comes to report two takings for one money.
import { normaliseCurrency } from './gymRecord';

/**
 * The three things the desk can sell, in the words the desk uses.
 *
 * studio-web/app/money/page.tsx holds a private copy of this map for the price
 * book it renders. Not reached into and not deleted from there — that file
 * belongs to another lane — but the words live here from now on, so the screen
 * that lists a product and the screen that reports its sales cannot come to
 * call the same thing two things.
 */
export const PASS_KIND_LABEL: Record<PassKind, string> = {
  drop_in: 'Drop-in',
  guest: 'Guest pass',
  pack: 'Pack',
};

/**
 * An amount of ONE money, and how many sales it is made of.
 *
 * Two of these beside each other is not a problem to be resolved. It is the
 * answer: this pack took AED 4,300 and GBP 240, and no rate exists anywhere in
 * this product that would turn that into one number.
 */
export interface TypeTake {
  /** ISO 4217 as the priced sales stated it, normalised. Null when the rows
   *  that make up `cents` recorded a price and no currency — which is a real
   *  and separate bucket, never folded into the gym's own code. */
  currency: string | null;
  cents: number;
  /** How many priced sales this amount is made of. */
  passes: number;
}

/** One product, what the book says about it, and what it actually did. */
export interface PassTypeSale {
  /** Null for the row holding sales whose type could not be read. */
  typeId: string | null;
  /** The book's name, or the name snapshotted onto the pass when the type is
   *  no longer in the book. Null only on the unreadable-type row. */
  name: string | null;
  kind: PassKind | null;
  /** What the book charges for it TODAY. Null when the type is not in the book
   *  — withdrawn, or the book was not read. Never a stand-in for what a past
   *  sale brought in; see `PRICE_MOVED_NOTE`. */
  listPriceCents: number | null;
  listCurrency: string | null;
  /** Visits or sessions the type is defined with. Null when not in the book. */
  uses: number | null;
  /** Null when not in the book, which is not the same as withdrawn. */
  active: boolean | null;
  /** True when the price book has a row for this type. */
  inBook: boolean;
  /** Passes issued on this type, priced or not. */
  sold: number;
  /** How many of those recorded a price. `sold - priced` bought nothing that
   *  can be reported as money. */
  priced: number;
  /** What the priced sales came to, one entry per currency. Empty when none of
   *  them carried a price. */
  take: TypeTake[];
  /** True when the priced sales span more than one money, so there is no single
   *  amount for this product and `take` must be read as a list. */
  mixedCurrency: boolean;
  /** Credits sold on this type, and credits spent against them. The second is
   *  what tells a gym whether a pack is being used or sat on — an unused pack
   *  is a refund conversation waiting to happen. */
  creditsSold: number;
  creditsSpent: number;
}

/** The table's own bottom line. Every figure here obeys the same rule the rows
 *  do: counts add, money does not cross a currency. */
export interface SalesTotals {
  /** Rows on the table, including the unreadable-type row when there is one. */
  types: number;
  /**
   * Rows that ARE a pass type — every row carrying a `typeId`, whether or not
   * the price book still holds it.
   *
   * Separate from `types` above because the two answer different questions and
   * a screen that says "sold across N types" needs this one. `types` counts
   * ROWS, and one of those rows can be the unattributable bucket: passes whose
   * `pass_type_id` is null, or whose type could not be read. That bucket is not
   * a product. A gym with three types plus a handful of orphaned passes read
   * "sold across 4 types" and has no fourth type — a count of the gym's own
   * product range, off by one, with nothing on the figure to doubt.
   *
   * Both are kept: `types` is what the table is as many rows long as, which is
   * the honest denominator for anything about the TABLE, and this is the count
   * of things the gym actually sells.
   */
  namedTypes: number;
  /** Types in the book that have never been sold. Zero when the book was not
   *  read, because none of them are on the table to be counted. */
  neverSold: number;
  sold: number;
  priced: number;
  take: TypeTake[];
}

/** What a table built without the price book is, and is not. */
export const BOOK_UNREAD_NOTE =
  'The pass price book could not be read, so this table is the types that have actually been SOLD and nothing else. '
  + 'A pass type the gym offers and nobody has bought has no row here — not a row reading zero. That is the row this table '
  + 'exists to show, so read this as an incomplete list rather than as the gym’s product list.';

/** Why some sales have no product name against them. */
export const LOST_TYPE_NOTE =
  'These passes were sold, and the pass type behind them could not be read — either it was deleted or the lookup did not come back. '
  + 'They are kept on their own row rather than dropped, because money missing from a revenue table with nothing saying it is missing '
  + 'is worse than money nobody can name, and they are never added to a named product.';

/** Why the price and the take do not multiply out. */
export const PRICE_MOVED_NOTE =
  'The price is what the book charges today. What each pass actually cost is copied onto it at the moment of sale, so a type that '
  + 'has been repriced has older sales at the older price. Sold multiplied by price is not what came in, and is not shown.';

/**
 * Every product, and what it sold.
 *
 * `types` null means the price book was not read — see `BOOK_UNREAD_NOTE`. It
 * is NOT an empty book: an empty array says the gym has defined no pass types,
 * which is a fact about the gym, and null says nobody could ask.
 *
 * Rows are ordered by how many sold, then by name. Deliberately never by money:
 * ordering a table by `take` would mean comparing an amount of dirhams with an
 * amount of pounds to decide which row goes first, and the comparison has no
 * answer. Count is the one ranking that survives two currencies.
 */
export function passTypeSales(types: PassType[] | null, passes: GymPass[]): PassTypeSale[] {
  const rows = new Map<string | null, PassTypeSale>();

  // The book first, so a type nobody has bought still gets a row and lands at
  // the bottom of the table rather than being invisible.
  for (const t of types ?? []) {
    rows.set(t.id, {
      typeId: t.id,
      name: t.name,
      kind: t.kind,
      listPriceCents: t.priceCents,
      listCurrency: normaliseCurrency(t.currency),
      uses: t.uses,
      active: t.active,
      inBook: true,
      sold: 0, priced: 0, take: [], mixedCurrency: false,
      creditsSold: 0, creditsSpent: 0,
    });
  }

  // Per row, the money kept apart by the currency its own sales stated. A plain
  // running total here is the whole defect this module refuses.
  const takes = new Map<string | null, Map<string | null, { cents: number; passes: number }>>();

  for (const p of passes) {
    // A pass that names no type is one row, not one row each: they are all the
    // same fact — a sale nobody can attribute — and splitting them by pass id
    // would put a table of one-line products on screen.
    const key = p.passTypeId ?? null;
    let row = rows.get(key);
    if (!row) {
      row = {
        typeId: key,
        // The name snapshotted onto the pass, for a type the book no longer
        // carries. Null on the unattributable row, which the screen words.
        name: key ? p.passTypeName ?? null : null,
        kind: p.kind,
        listPriceCents: null,
        listCurrency: null,
        uses: null,
        active: null,
        inBook: false,
        sold: 0, priced: 0, take: [], mixedCurrency: false,
        creditsSold: 0, creditsSpent: 0,
      };
      rows.set(key, row);
    }

    row.sold += 1;
    row.creditsSold += p.usesTotal;
    row.creditsSpent += p.usesSpent;

    // Only a PRICED sale is asked what currency it is in. A pass carrying no
    // price contributes nothing to the take, so a currency it does or does not
    // state cannot make the take a mixed one — the same rule
    // `passRevenueCents` applies to the whole-gym figure, for the same reason.
    if (p.paidCents == null) continue;
    row.priced += 1;
    const ccy = normaliseCurrency(p.currency);
    let byCcy = takes.get(key);
    if (!byCcy) { byCcy = new Map(); takes.set(key, byCcy); }
    const cur = byCcy.get(ccy) ?? { cents: 0, passes: 0 };
    cur.cents += p.paidCents;
    cur.passes += 1;
    byCcy.set(ccy, cur);
  }

  for (const [key, byCcy] of takes) {
    const row = rows.get(key);
    if (!row) continue;
    row.take = sortTake(byCcy);
    row.mixedCurrency = byCcy.size > 1;
  }

  return [...rows.values()].sort((a, b) => {
    if (b.sold !== a.sold) return b.sold - a.sold;
    // A name is what an owner scans for, so the tie-break is alphabetical. The
    // unattributable row has none, and is pushed to the end of its tie rather
    // than compared as an empty string — an empty string sorts FIRST, which
    // would put "sales nobody can name" at the top of the gym's product table.
    if (a.name == null || b.name == null) {
      return a.name == null ? (b.name == null ? 0 : 1) : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * The table's bottom line.
 *
 * Computed from the ROWS rather than from the passes a second time, so the
 * total and the column above it cannot come from two different sets. `take`
 * groups across every row by currency and, again, never adds two of them.
 */
export function salesTotals(rows: PassTypeSale[]): SalesTotals {
  const byCcy = new Map<string | null, { cents: number; passes: number }>();
  let sold = 0;
  let priced = 0;
  let neverSold = 0;
  let namedTypes = 0;
  for (const r of rows) {
    sold += r.sold;
    priced += r.priced;
    // A row is a TYPE when it carries a type id. The unattributable bucket —
    // passes with no `pass_type_id`, or whose type could not be read — is a row
    // and is not a product, and counting it as one overstates the gym's range.
    if (r.typeId != null) namedTypes += 1;
    // Only a row from the book can be said never to have sold. A row that
    // exists BECAUSE a pass was sold on it cannot have a zero, and a book that
    // was not read contributes no rows here at all — which is why this count is
    // zero rather than misleading when `BOOK_UNREAD_NOTE` is on screen.
    if (r.inBook && r.sold === 0) neverSold += 1;
    for (const t of r.take) {
      const cur = byCcy.get(t.currency) ?? { cents: 0, passes: 0 };
      cur.cents += t.cents;
      cur.passes += t.passes;
      byCcy.set(t.currency, cur);
    }
  }
  return { types: rows.length, namedTypes, neverSold, sold, priced, take: sortTake(byCcy) };
}

/**
 * The takings, biggest first — WITHIN one currency, and ordered by code
 * otherwise.
 *
 * Two amounts in two currencies are not comparable, so they are not compared:
 * the codes are sorted alphabetically and the amounts ride along. A sort that
 * put the bigger integer first would be ranking 4,300 fils above 240 pounds.
 * The unstated bucket sorts last, because it is the one an owner acts on by
 * going and finding out, not by reading it beside the others.
 */
function sortTake(byCcy: Map<string | null, { cents: number; passes: number }>): TypeTake[] {
  return [...byCcy.entries()]
    .map(([currency, v]) => ({ currency, cents: v.cents, passes: v.passes }))
    .sort((a, b) => {
      if (a.currency === b.currency) return 0;
      if (a.currency == null) return 1;
      if (b.currency == null) return -1;
      return a.currency.localeCompare(b.currency);
    });
}
