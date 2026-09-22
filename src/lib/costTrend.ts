// What a gym's cost ledger says beyond the month on screen: who it pays, and
// whether a category is moving.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// /costs answers three questions exactly: what went out this month, what
// repeats, and how that sits against what was budgeted. Every finance console a
// small business has ever used — Xero, QuickBooks, Sage, and the money half of
// Mindbody and PushPress — answers two more before any of those, on the screen
// it opens on:
//
//   · WHO ARE WE PAYING. A supplier list, ranked by money, is the first thing
//     an owner looks at when the bank balance is wrong. This product had the
//     payee on every cost row since part 700 and nothing anywhere grouped by
//     it: `standingCosts` in src/lib/closeCosts.ts asks "which suppliers do we
//     pay every month", which is a question about REGULARITY and deliberately
//     withholds a figure across two currencies or two amounts. "How much has
//     this gym paid this engineer" was unanswerable without exporting the CSV
//     and pivoting it.
//
//   · IS THIS CATEGORY MOVING. A budget comparison answers "against what we
//     planned", and a gym that has never set a budget — which is most of them
//     for most categories — gets no answer at all. "Power is half again what it
//     has been running at" needs no plan, only the gym's own history, and
//     /costs already reads six complete months of it for `standingCosts`. The
//     rows were on the screen and nothing looked at them this way.
//
// ── The figures this module refuses ───────────────────────────────────────
//
// It never sums two currencies, anywhere. Every line here is keyed on
// (category, currency) or (supplier, currency), so a gym paying a British
// engineer in pounds and a German one in euros gets two lines and never a
// total — the same rule `gymCostsByCategory` keeps, for the same reason.
//
// It never divides by a month the gym has no record of. The denominator of
// every average is the number of complete months IN THE WINDOW that hold any
// cost at all, not the width of the window: a gym four months old, read over a
// six-month look-back, would otherwise have every average it owns cut by a
// third, and every category would read as rising.
//
// It never produces a figure from a read that did not come back whole. Both
// sides are gated on `isWhole` and the answer is null, not an empty list: a
// prefix of a month's ledger is a smaller actual, and a smaller actual beside a
// six-month average is an under-spend that did not happen.
//
// It never states a zero. A category with a history and nothing entered this
// month is `nothing-this-month` and says so in those words, because the
// commonest cause is an invoice nobody has typed yet and "0.00, 100% under"
// is the sentence an owner would relax about.
//
// Pure. No reads, no client, no clock — the month keys come from the caller,
// which is what lets /costs hand it the exact window `standingCosts` judged
// over so the two can never disagree about which months were looked at.
import { gymCostCategoryLabel, type GymCost } from './gymCosts';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/** `YYYY-MM`, tested as a string. Never parsed — a bare month parsed as an
 *  instant is midnight UTC, and therefore the previous month west of
 *  Greenwich. */
const isMonthKey = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** The month a cost was paid in, off the front of its `YYYY-MM-DD` day. A
 *  string slice and not a Date, for the reason above. */
const monthOf = (paidOn: string | null | undefined): string | null => {
  const m = String(paidOn ?? '').slice(0, 7);
  return isMonthKey(m) ? m : null;
};

/** A currency code as it is compared here. Empty means the row states none,
 *  which is never treated as agreeing with anything. */
const codeOf = (c: string | null | undefined): string => String(c ?? '').trim().toUpperCase();

/* ── who this gym pays ────────────────────────────────────────────────────── */

/** One supplier's spend in one currency. Two currencies to one supplier is two
 *  lines, because they are two amounts of money and this app holds no rate. */
export interface SupplierLine {
  /** `SUPPLIER|CCY`, the grouping key and a stable React key. */
  key: string;
  /** The payee as most recently written, not upper-cased — "EDF Energy" is how
   *  it should read back, and the folding is only for matching. */
  supplier: string;
  currency: string;
  minorUnits: number;
  /** How many cost rows that is. */
  count: number;
  /** How many distinct months of the window this supplier appears in. What
   *  separates a landlord from a one-off plumber. */
  months: number;
  /** The day of the most recent payment, so "we have not paid them since
   *  April" is visible without opening four months. */
  lastPaidOn: string;
  /** Every category this supplier has been filed under, labelled and sorted.
   *  More than one is ordinary — an engineer who also sells the parts — and it
   *  is worth seeing, because it is also what a miscategorised row looks like. */
  categories: string[];
}

export interface SupplierSpend {
  lines: SupplierLine[];
  /**
   * Costs carrying no payee at all.
   *
   * Counted and never grouped under an invented name. A payee is optional on
   * purpose — a cash purchase from a shop nobody wrote down is still a real
   * cost — and a "Not stated" row sitting in a supplier league table reads as a
   * supplier called Not Stated. The screen says how many are outside the table.
   */
  unnamed: number;
  /** Rows with a payee but no amount, or no currency: in no figure here, and
   *  not a zero. */
  uncounted: number;
}

/**
 * Every payee in a set of costs, ranked by money.
 *
 * Ranked on the single largest line and never on a sum across currencies —
 * `gymCostsByCategory`'s rule, and for its reason: adding them is the one
 * arithmetic this ledger may not do.
 *
 * Null when the read did not come back whole. An empty list would be the claim
 * "this gym pays nobody", which is the shape a refused query has as well.
 */
export function supplierSpend(
  rows: readonly GymCost[], status: LoadStatus,
): SupplierSpend | null {
  if (!isWhole(status)) return null;

  interface Acc {
    supplier: string;
    currency: string;
    minorUnits: number;
    count: number;
    months: Set<string>;
    lastPaidOn: string;
    categories: Set<string>;
  }
  const acc = new Map<string, Acc>();
  let unnamed = 0;
  let uncounted = 0;

  for (const c of rows) {
    const name = String(c.supplier ?? '').trim();
    if (!name) { unnamed += 1; continue; }
    const cur = codeOf(c.currency);
    if (c.amountCents == null || !Number.isFinite(c.amountCents) || !cur) { uncounted += 1; continue; }
    const key = `${name.toUpperCase()}|${cur}`;
    const day = String(c.paidOn ?? '');
    const found = acc.get(key);
    if (found) {
      found.minorUnits += c.amountCents;
      found.count += 1;
      const m = monthOf(c.paidOn);
      if (m) found.months.add(m);
      // Newest wins for BOTH the day and the spelling: a payee renamed from
      // "EDF" to "EDF Energy" should read back as what the gym calls them now.
      if (day > found.lastPaidOn) { found.lastPaidOn = day; found.supplier = name; }
      found.categories.add(String(c.category ?? '').trim() || 'other');
    } else {
      const months = new Set<string>();
      const m = monthOf(c.paidOn);
      if (m) months.add(m);
      acc.set(key, {
        supplier: name,
        currency: cur,
        minorUnits: c.amountCents,
        count: 1,
        months,
        lastPaidOn: day,
        categories: new Set([String(c.category ?? '').trim() || 'other']),
      });
    }
  }

  const lines = [...acc.entries()].map(([key, a]): SupplierLine => ({
    key,
    supplier: a.supplier,
    currency: a.currency,
    minorUnits: a.minorUnits,
    count: a.count,
    months: a.months.size,
    lastPaidOn: a.lastPaidOn,
    categories: [...a.categories].map(gymCostCategoryLabel).sort((x, y) => x.localeCompare(y)),
  }));

  // Biggest first WITHIN a currency, then by currency code, then by name — so
  // the order is total and the list never flickers, and so no comparison is
  // ever made between two currencies' figures.
  lines.sort((a, b) => a.currency.localeCompare(b.currency)
    || (b.minorUnits - a.minorUnits)
    || a.supplier.localeCompare(b.supplier));

  return { lines, unnamed, uncounted };
}

/* ── whether a category is moving ─────────────────────────────────────────── */

export type TrendLine =
  | {
      /** Both sides are real: a history in the window, and something recorded
       *  this month, in one currency. */
      kind: 'measured';
      category: string; label: string; currency: string;
      /** Minor units recorded in the month on screen. */
      thisMonth: number;
      /** Minor units a month across the window, rounded to the nearest minor
       *  unit. The denominator is `monthsOnRecord`, never the window's width. */
      average: number;
      /** thisMonth − average. Positive is above the run rate. */
      diff: number;
      /** The difference as a whole percentage of the average, or null against
       *  an average of nothing — a proportion of nothing is not a number, and
       *  the money difference beside it says everything it would have. */
      pct: number | null;
    }
  | {
      /** Recorded this month, and nothing like it anywhere in the window. Not
       *  an infinite rise: it is a new line in the gym's books. */
      kind: 'first-time';
      category: string; label: string; currency: string; thisMonth: number;
    }
  | {
      /** A history in the window and nothing recorded this month. NOT a
       *  hundred per cent saving: the commonest cause is an invoice nobody has
       *  entered yet, which is why this is its own arm and not a zero. */
      kind: 'nothing-this-month';
      category: string; label: string; currency: string; average: number;
    }
  | {
      /** Recorded this month, and the window holds no month with any cost in
       *  it at all — a gym in its first months. There is nothing to compare
       *  against and saying so is the whole answer. */
      kind: 'no-baseline';
      category: string; label: string; currency: string; thisMonth: number;
    };

export interface CostTrend {
  lines: TrendLine[];
  /**
   * Complete months in the look-back holding any cost at all — the denominator
   * of every average above.
   *
   * Months ON RECORD and not the window's width. A gym four months old read
   * over six months would otherwise have every average cut by a third, and
   * every category in its books would read as rising.
   */
  monthsOnRecord: number;
  /** How many complete months were looked at, so a screen can say how far back
   *  this reaches without recomputing the window. */
  monthsLookedAt: number;
  /** Rows on either side carrying no amount, or no currency. In no figure here
   *  and never counted as nothing. */
  uncounted: number;
}

/**
 * This month's costs against the run rate of the months before it.
 *
 * `windowMonths` is the caller's own look-back — on /costs it is the list
 * `standingCosts` judges over, out of one `monthsBefore` call, so the read and
 * both judgements made over it cannot disagree about which months were looked
 * at. The month on screen is never in it: a month cannot be evidence about
 * itself.
 *
 * Null when EITHER read is short of whole. A prefix of this month is a smaller
 * actual and reads as a saving; a prefix of the history is a smaller average
 * and reads as an overspend. Neither may be drawn.
 */
export function categoryTrend(
  thisMonth: readonly GymCost[],
  past: readonly GymCost[],
  windowMonths: readonly string[],
  thisStatus: LoadStatus,
  pastStatus: LoadStatus,
): CostTrend | null {
  if (!isWhole(thisStatus) || !isWhole(pastStatus)) return null;

  const window = new Set(windowMonths.filter(isMonthKey));
  let uncounted = 0;

  /** Minor units per `category|currency`, over rows inside a window. */
  const fold = (rows: readonly GymCost[], limitTo: Set<string> | null, onMonth?: (m: string) => void) => {
    const out = new Map<string, { category: string; currency: string; minorUnits: number }>();
    for (const c of rows) {
      const m = monthOf(c.paidOn);
      if (limitTo && (!m || !limitTo.has(m))) continue;
      const cur = codeOf(c.currency);
      if (c.amountCents == null || !Number.isFinite(c.amountCents) || !cur) { uncounted += 1; continue; }
      if (m && onMonth) onMonth(m);
      const category = String(c.category ?? '').trim() || 'other';
      const key = `${category}|${cur}`;
      const found = out.get(key);
      if (found) found.minorUnits += c.amountCents;
      else out.set(key, { category, currency: cur, minorUnits: c.amountCents });
    }
    return out;
  };

  const onRecord = new Set<string>();
  const history = fold(past, window, (m) => onRecord.add(m));
  // This month is not filtered by the window — it is the month on screen, and
  // the caller has already scoped the read to it.
  const now = fold(thisMonth, null);
  const monthsOnRecord = onRecord.size;

  const lines: TrendLine[] = [];
  for (const key of new Set([...now.keys(), ...history.keys()])) {
    const a = now.get(key);
    const b = history.get(key);
    const category = (a ?? b)!.category;
    const currency = (a ?? b)!.currency;
    const label = gymCostCategoryLabel(category);

    if (a && !b) {
      lines.push(monthsOnRecord === 0
        ? { kind: 'no-baseline', category, label, currency, thisMonth: a.minorUnits }
        : { kind: 'first-time', category, label, currency, thisMonth: a.minorUnits });
      continue;
    }
    // `b` without `a`. `monthsOnRecord` is at least one whenever `history` has
    // an entry, because the same fold counted the month it came from.
    const average = Math.round(b!.minorUnits / monthsOnRecord);
    if (!a) {
      lines.push({ kind: 'nothing-this-month', category, label, currency, average });
      continue;
    }
    const diff = a.minorUnits - average;
    lines.push({
      kind: 'measured', category, label, currency,
      thisMonth: a.minorUnits,
      average,
      diff,
      // unit-ok: a ratio of two amounts in the SAME currency is dimensionless —
      // the currencies cancel — so this hundred is a percentage and not a minor
      // unit factor. The key both sides came out of carries the currency, which
      // is the only condition under which the division means anything.
      pct: average > 0 ? Math.round((diff / average) * 100) : null,
    });
  }

  lines.sort((x, y) => bucket(x) - bucket(y) || within(x) - within(y)
    || x.label.localeCompare(y.label) || x.currency.localeCompare(y.currency));

  return { lines, monthsOnRecord, monthsLookedAt: window.size, uncounted };
}

/**
 * Which group of the list a line belongs to. Lower is nearer the top.
 *
 * Above the run rate first, because that is the only thing somebody opened this
 * for. The two that state no comparison come next — they are not good news and
 * they are not a number — and below-the-rate lines last.
 */
function bucket(l: TrendLine): number {
  if (l.kind === 'measured') return l.diff > 0 ? 0 : 3;
  if (l.kind === 'first-time') return 1;
  if (l.kind === 'nothing-this-month') return 1;
  return 2;   // 'no-baseline'
}

/**
 * Where a line sits inside its group.
 *
 * The PERCENTAGE and never the money, which is `costBudgets`' argument
 * unchanged: a percentage is dimensionless, so it can order a list holding a
 * gym's pound rent and its euro insurance, and sorting on minor units would put
 * every yen figure at the top by construction.
 */
function within(l: TrendLine): number {
  if (l.kind !== 'measured') return 0;
  if (l.pct == null) return Number.NEGATIVE_INFINITY;
  return -l.pct;
}

/**
 * The sentence for one line, in the owner's own words.
 *
 * Four wordings and not a figure with a blank beside it, because the difference
 * between "you spent less on this" and "nobody has entered the bill yet" is the
 * difference between a saving and a surprise.
 *
 * `months` is `monthsOnRecord` — named out loud in every sentence that rests on
 * it, so an average over two months is never read as an average over six.
 */
export function trendNote(l: TrendLine, monthLabel: string, months: number): string {
  const per = months === 1 ? 'the one month before it on record' : `the ${months} months before it on record`;
  switch (l.kind) {
    case 'measured': {
      if (l.diff === 0) return `Exactly its run rate over ${per}.`;
      const up = l.diff > 0;
      const share = l.pct == null
        ? ' There is no percentage here, because the run rate is nothing and a proportion of nothing is not a number.'
        : ` That is ${Math.abs(l.pct)}% ${up ? 'above' : 'below'} it.`;
      return `${up ? 'Above' : 'Below'} what this gym has been spending on it across ${per}.${share}`;
    }
    case 'first-time':
      return `Nothing in this category appears anywhere in ${per}, so ${monthLabel} is the first of it on record. That is a new line in the books, not a rise.`;
    case 'nothing-this-month':
      return `This gym has been spending on this across ${per} and nothing is recorded in ${monthLabel}. That is not a saving: it is far more often an invoice nobody has entered yet.`;
    case 'no-baseline':
    default:
      return `No month before ${monthLabel} holds any cost at all, so there is nothing to compare this against. A run rate needs a history.`;
  }
}

/**
 * What to say about the payees that are outside the supplier table.
 *
 * A sentence and never a figure: the rows have no payee, so there is nothing to
 * attribute the money to, and a total of them beside a supplier league table
 * would read as a supplier.
 */
export function unnamedPayeeNote(s: SupplierSpend): string | null {
  const bits: string[] = [];
  if (s.unnamed > 0) {
    bits.push(s.unnamed === 1
      ? 'One cost names no payee, so it is not in this table. A payee is optional, because a cash purchase nobody wrote down is still a real cost.'
      : `${s.unnamed} costs name no payee, so they are not in this table. A payee is optional, because a cash purchase nobody wrote down is still a real cost.`);
  }
  if (s.uncounted > 0) {
    bits.push(s.uncounted === 1
      ? 'One cost carries no amount or states no currency, so it is in no figure here. That is not a nought.'
      : `${s.uncounted} costs carry no amount or state no currency, so they are in no figure here. Those are not noughts.`);
  }
  return bits.length ? bits.join(' ') : null;
}
