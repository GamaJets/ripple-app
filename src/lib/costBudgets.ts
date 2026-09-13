// What the gym meant to spend, beside what it did.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// src/lib/gymCosts.ts records what a gym spent and can say that utilities came
// to 4,180 in August. It cannot say that the figure is forty per cent over what
// the gym planned, because nothing anywhere holds what the gym planned — and
// the second sentence is the only one anybody acts on. A total with nothing
// beside it is read and forgotten; the gym finds out in March, from its
// accountant, about a year it can no longer change.
//
// ── A BUDGET AND AN ACTUAL ARE NOT THE SAME KIND OF FACT ───────────────────
//
// This is the whole discipline of this module and every refusal below comes out
// of it.
//
//   A BUDGET is a number somebody TYPED. An intention. Nothing checked it,
//   nothing produced it, and it is worth what the thinking behind it was worth.
//
//   An ACTUAL is a number the REGISTER produced — the sum of `gym_costs` rows
//   entered off supplier invoices, in one month, in one category.
//
// A variance is the difference, and it is a fact only when BOTH sides are. Four
// cases where this module states no variance at all, each of which is a
// confident number about nothing if you let it through:
//
//   1. NO BUDGET FOR THAT CATEGORY. A default of zero turns every unbudgeted
//      category into an infinite over-spend. The absence of a budget is the
//      absence of a line, and the category still shows its actual.
//
//   2. NOTHING RECORDED IN THE CATEGORY. An actual of zero in a month whose
//      invoices are still in a drawer is the single easiest way to tell an
//      owner they are comfortably under budget on the day they are not. `null
//      is not zero` is the house rule and this is the sharpest instance of it:
//      the missing side here is silent, plausible, and flattering.
//
//   3. THE MONTH'S COSTS DID NOT COME BACK WHOLE. A truncated read is a smaller
//      actual and a smaller actual is an under-spend. `isWhole(status)` gates
//      every figure below.
//
//   4. THE TWO SIDES ARE IN DIFFERENT CURRENCIES. A GBP budget against a EUR
//      insurance premium is two amounts of money; this product holds no rate,
//      and nothing in this codebase has ever added or subtracted two of them.
//
// ── And no total across categories ─────────────────────────────────────────
//
// There is no "budgeted 18,400, spent 19,900" figure here and there must never
// be one. Categories can be budgeted in different currencies, some have no
// budget at all, and some have no costs recorded yet — so a pair of totals over
// that set would be two sums across different subsets of the book, presented as
// a comparison. src/lib/gymCosts.ts refuses the same addition under a heading
// in capitals and this is downstream of it.
//
// Pure, framework-free and asserted against under plain `node`. Month keys are
// 'YYYY-MM' strings and days are 'YYYY-MM-DD' strings, sliced and compared as
// text — never parsed, because `new Date('2026-08-01')` is midnight UTC and
// therefore July west of Greenwich, and a budget's effective month is the one
// thing this file cannot afford to get wrong by one.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import { readMinorAmount } from './coachMoney';
import { isMonthKey } from './closeCosts';
import {
  GYM_COST_CATEGORIES, GYM_COST_MAX_MINOR, gymCostCategoryLabel,
  gymCostsByCategory, type GymCost, type GymCostCategory,
} from './gymCosts';
import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

/* ── one plan ─────────────────────────────────────────────────────────────── */

/**
 * What a gym plans to spend in one category, per month, from one month onwards.
 *
 * Effective-dated rather than stored per month, so it is not retyped twelve
 * times a year — and so that a figure revised in June does not silently rewrite
 * what the gym had planned in March. A revision is a NEW row with a later
 * `startsOn`; the old one stays and is what every month before it is measured
 * against.
 */
export interface CostBudget {
  id: string;
  category: string;
  /** Minor units, per month. Zero is a real intention and never a denominator. */
  amountCents: number;
  /** ISO 4217, uppercase. Required by the column: a plan with no currency on it
   *  cannot be compared with anything. */
  currency: string;
  /** 'YYYY-MM-DD'. The first month this figure applies to. */
  startsOn: string;
  /** 'YYYY-MM-DD', or null while it still applies. */
  endsOn: string | null;
  note: string | null;
  createdAt: string | null;
}

/** What somebody typed into the budget form, before it is anything. */
export interface CostBudgetDraft {
  category: GymCostCategory;
  /** MAJOR units as a person types them. Required — unlike a template's usual
   *  amount, a budget with no figure is not a budget. */
  amountText: string;
  /** The gym's currency. A budget cannot be set without one. */
  currency: string | null;
  startsOn: string;
  note?: string;
}

/* ── the sentences that keep the screen honest ────────────────────────────── */

/**
 * What a budget is, said on the screen beside the figures.
 *
 * The distinction this module is built on, in the owner's own words. Without
 * it, a variance column reads like a measurement of the gym rather than a
 * measurement against a guess somebody made in January.
 */
export const BUDGET_IS_TYPED_NOT_MEASURED =
  'A budget is a figure you typed. Nothing produced it and nothing has checked it, so a variance beside it measures this month against what you planned — not against what anything says this should cost. The spending side is the register’s: it is the costs somebody has entered, which in most months is not yet all of them.';

/**
 * Why a category shows an actual and no variance.
 *
 * Said under the table rather than only in the row, because a column with gaps
 * in it reads as a bug unless somebody states that each gap was a decision.
 */
export const NO_VARIANCE_WITHOUT_BOTH_SIDES =
  'A variance is only shown where both sides are real: a budget you set, and at least one cost recorded in that category this month, both in the same currency, over a read that came back whole. A category with nothing entered yet is not a category you spent nothing in — it is the commonest reason a month looks comfortably under budget on the day it is not.';

/**
 * The sentence under an empty budget list, which depends entirely on the read.
 */
export function budgetsEmptyLine(status: LoadStatus): string {
  if (status === 'error') {
    return 'The budgets could not be read, so none are listed and nothing this month is compared against anything. That is not a statement that none have been set.';
  }
  if (status === 'partial') {
    return 'There are more budgets than could be read in one request, so this list is not all of them and no comparison below is complete.';
  }
  if (status === 'loading') return 'Still reading.';
  return 'No budget is set for any category. Set one and this month’s spending is measured against it — rent, power, the cleaner and the music licence are the four most gyms start with, because they are the four that move without anybody deciding they should.';
}

/* ── what a person typed, judged ──────────────────────────────────────────── */

/** Every reason this budget cannot be saved, in the owner's own words. */
export function budgetBlockers(d: CostBudgetDraft): string[] {
  const out: string[] = [];

  if (!GYM_COST_CATEGORIES.some((c) => c.id === d.category)) {
    out.push('Say which kind of cost this budget is for. A budget with no category is compared against nothing.');
  }

  const cur = (d.currency || '').trim();
  if (!cur) {
    out.push('This gym has not set its currency, so a budget cannot be recorded in one. Repple is white-labelled and there is no default that is right for every gym — set one on the Gym screen.');
  } else if (!/^[A-Za-z]{3}$/.test(cur)) {
    out.push('The currency on record is not a three-letter code, so no budget can be recorded in it.');
  } else {
    // The same reader the cost form uses, with the same `chargeable: false`, so
    // a gym in Kuwait may budget 1,250.500 KWD and a gym in Japan is told a yen
    // has no smaller unit. Two readers over one kind of box is how a figure
    // comes to be shown one way and stored another.
    const read = readMinorAmount(d.amountText, cur, false);
    if (!read.ok) out.push(read.reason);
    else if (read.minorUnits < 0) {
      out.push('A budget cannot be negative.');
    } else if (read.minorUnits >= GYM_COST_MAX_MINOR) {
      out.push('That is more than Repple will hold on one budget line — check the zeros.');
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.startsOn ?? ''))) {
    out.push('The month this budget starts from could not be read. It is what stops a figure you set in November being applied to every month back to January.');
  }

  return out;
}

/* ── which budget applies ─────────────────────────────────────────────────── */

/**
 * The budget in force for one category in one month, or null where there is
 * none.
 *
 * Months compared as the first seven characters of the stored DATEs. A budget
 * that starts on the 14th applies to the whole of that month: it is a monthly
 * figure and there is no such thing as half of one, and the alternative —
 * ignoring it until the following month — would leave the month an owner was
 * thinking about when they typed it uncompared.
 *
 * Where more than one applies, the LATEST start wins. That is the revision: a
 * rent budget of 2,400 from January and 2,650 from June measures May against
 * 2,400 and July against 2,650, which is what the gym actually planned. The
 * unique index on (tenant, category, starts_on) makes that a total order, and
 * the tie-break on `id` below is only there so that a database missing the
 * index still answers the same way twice.
 */
export function budgetFor(
  budgets: readonly CostBudget[], category: string, monthKey: string,
): CostBudget | null {
  if (!isMonthKey(monthKey)) return null;
  const want = String(category ?? '').trim();
  let best: CostBudget | null = null;
  for (const b of budgets) {
    if (String(b.category ?? '').trim() !== want) continue;
    const from = String(b.startsOn ?? '').slice(0, 7);
    if (!isMonthKey(from) || from > monthKey) continue;
    const to = b.endsOn ? String(b.endsOn).slice(0, 7) : null;
    if (to && to < monthKey) continue;
    if (!best) { best = b; continue; }
    const bestFrom = String(best.startsOn ?? '').slice(0, 7);
    if (from > bestFrom || (from === bestFrom && b.startsOn > best.startsOn)) best = b;
    else if (from === bestFrom && b.startsOn === best.startsOn && b.id > best.id) best = b;
  }
  return best;
}

/* ── budget against actual ────────────────────────────────────────────────── */

/** A pot of money in one currency, as `Taken` produces them. */
export interface BudgetPot { currency: string; minorUnits: number; count: number }

/**
 * One category's line: the plan, what was recorded, and a variance only where
 * both of those are facts about the same money.
 *
 * `kind` is the discriminator and there are five, not two. Four of them are the
 * refusals this module exists for, and they are separate values rather than a
 * null variance so that a caller cannot render them all as one blank cell.
 */
export type BudgetLine =
  | {
      /** Both sides are real and in the same currency. */
      kind: 'measured';
      category: string; label: string;
      budget: CostBudget;
      /** Minor units recorded in the budget's own currency, that month. */
      actualCents: number;
      /** How many cost rows that was. */
      actualCount: number;
      /** actual − budget. Positive is over, negative is under, both in the
       *  budget's currency. Never a figure spanning two of them. */
      diffCents: number;
      /**
       * The difference as a whole percentage of the budget, or null against a
       * budget of nothing.
       *
       * A zero budget is a real intention and it is not a denominator: "∞% over"
       * is not a figure anybody can act on, and the money difference beside it
       * says everything the percentage would have.
       */
      pct: number | null;
      /** Costs in that category recorded in OTHER currencies, which are no part
       *  of the comparison above and are never folded into it. */
      uncovered: BudgetPot[];
    }
  | {
      /** A budget is set, the read came back whole, and nothing is recorded in
       *  this category in this month. Not an under-spend of the whole budget. */
      kind: 'nothing-recorded';
      category: string; label: string; budget: CostBudget;
    }
  | {
      /** A budget is set and every cost in the category is in a currency it is
       *  not in. Named on both sides, subtracted on neither. */
      kind: 'currency-gap';
      category: string; label: string; budget: CostBudget; uncovered: BudgetPot[];
    }
  | {
      /** Costs are recorded and no budget covers this category this month. */
      kind: 'no-budget';
      category: string; label: string; pots: BudgetPot[];
    }
  | {
      /** The month's costs did not come back whole, so no side of this may be
       *  stated — including the actual, which would be a prefix. */
      kind: 'unknown';
      category: string; label: string; budget: CostBudget | null;
    };

/**
 * Every category that has a budget or has spending, placed against each other.
 *
 * `rows` is the costs dated inside `monthKey` and `status` is how that read came
 * back — taken rather than inferred from the rows being empty, because an empty
 * array is the same shape whether the gym recorded nothing or the query was
 * refused, and those two produce opposite advice.
 *
 * Over-spends first, largest proportion first, because that is the only order
 * in which the first line is the one worth acting on. The ordering key is the
 * PERCENTAGE and not the money: percentages are dimensionless and comparable
 * across currencies, and sorting on minor units would rank a Japanese gym's yen
 * above everything else in the list by construction.
 */
export function budgetReview(
  budgets: readonly CostBudget[],
  rows: readonly GymCost[],
  monthKey: string,
  status: LoadStatus,
): BudgetLine[] {
  const whole = isWhole(status);
  const pots = new Map<string, BudgetPot[]>();
  if (whole) {
    for (const pot of gymCostsByCategory(rows)) {
      pots.set(pot.category, pot.taken.pots.map((p) => ({
        currency: p.currency, minorUnits: p.minorUnits, count: p.count,
      })));
    }
  }

  // Every category that either side knows about. A budget with no spending is a
  // line; spending with no budget is a line; a category neither mentions is
  // absent rather than shown at zero, for the reason `gymCostsByCategory` gives
  // — a "Utilities 0.00" row is a statement that this gym spent nothing on
  // power, when what it means is that nobody has written any down.
  const categories = new Set<string>();
  for (const b of budgets) {
    if (budgetFor(budgets, b.category, monthKey)) categories.add(String(b.category ?? '').trim());
  }
  for (const c of pots.keys()) categories.add(c);

  const out: BudgetLine[] = [];
  for (const category of categories) {
    const label = gymCostCategoryLabel(category);
    const budget = budgetFor(budgets, category, monthKey);

    if (!whole) { out.push({ kind: 'unknown', category, label, budget }); continue; }

    const these = pots.get(category) ?? [];
    if (!budget) {
      // Reached only where there IS spending: a category with neither a budget
      // nor a cost never entered the set above.
      out.push({ kind: 'no-budget', category, label, pots: these });
      continue;
    }
    if (!these.length) {
      out.push({ kind: 'nothing-recorded', category, label, budget });
      continue;
    }

    const cur = budget.currency.trim().toUpperCase();
    const mine = these.find((p) => p.currency.trim().toUpperCase() === cur);
    const uncovered = these.filter((p) => p !== mine);
    if (!mine) {
      out.push({ kind: 'currency-gap', category, label, budget, uncovered });
      continue;
    }

    const diffCents = mine.minorUnits - budget.amountCents;
    out.push({
      kind: 'measured', category, label, budget,
      actualCents: mine.minorUnits,
      actualCount: mine.count,
      diffCents,
      // unit-ok: a ratio of two amounts in the SAME currency is dimensionless —
      // the currencies cancel — so this hundred is a percentage and not a minor
      // unit factor. The two sides are proven equal-currency three lines above,
      // which is the only condition under which this division means anything.
      pct: budget.amountCents > 0 ? Math.round((diffCents / budget.amountCents) * 100) : null,
      uncovered,
    });
  }

  return out.sort((a, b) => bucket(a) - bucket(b) || within(a) - within(b)
    || a.label.localeCompare(b.label));
}

/**
 * Which group of the list a line belongs to. Lower is nearer the top.
 *
 * Over-spends first, because they are the only lines somebody opened this
 * screen to find. The three that state no variance come next — they are not
 * good news and they are not a number — and the lines that are within budget
 * come last, because "nothing to do here" belongs at the bottom of a list, not
 * scattered through it.
 */
function bucket(l: BudgetLine): number {
  if (l.kind === 'measured') return l.diffCents > 0 ? 0 : 4;
  if (l.kind === 'unknown') return 1;
  if (l.kind === 'currency-gap') return 2;
  return 3;   // 'no-budget' and 'nothing-recorded'
}

/**
 * Where a line sits inside its group.
 *
 * The PERCENTAGE and never the money. A percentage is dimensionless — the two
 * currencies in the division cancel — so it can order a list containing a gym's
 * pound rent and its euro insurance. Sorting on minor units would put every yen
 * figure at the top of every list by construction, because a yen is stored as a
 * whole unit and a pound as a hundredth of one.
 *
 * A measured over-spend with NO percentage is a budget of nothing that was
 * broken, and it sorts to the very top of the over-spends: a plan of zero that
 * was not kept is the largest proportional miss there is.
 */
function within(l: BudgetLine): number {
  if (l.kind !== 'measured') return 0;
  if (l.pct == null) return Number.NEGATIVE_INFINITY;
  // One expression for both groups, and it is the right one for both. Sorted
  // ascending, `-pct` puts the LARGEST over-spend first among the over-spends
  // (+40 → −40) and the SMALLEST under-spend first among the under-spends
  // (−5 → 5, before −80 → 80) — which is the order that matters, because a
  // category five per cent under is one an ordinary month tips over and one
  // eighty per cent under is a category nobody has entered much for.
  return -l.pct;
}

/**
 * The sentence for one line, in the owner's own words.
 *
 * One wording in one place, and five of them rather than a figure and a blank,
 * because the difference between "you are under budget" and "nothing has been
 * entered yet" is the difference between a decision and a false comfort.
 */
export function budgetNote(l: BudgetLine, monthLabel: string): string {
  switch (l.kind) {
    case 'measured': {
      if (l.diffCents === 0) return `Exactly on budget in ${monthLabel}.`;
      const over = l.diffCents > 0;
      const share = l.pct == null
        ? over
          ? ' There is no percentage here, because the budget is nothing and a proportion of nothing is not a number.'
          : ''
        : ` That is ${Math.abs(l.pct)}% ${over ? 'over' : 'under'}.`;
      return `${over ? 'Over' : 'Under'} budget in ${monthLabel}.${share}`;
    }
    case 'nothing-recorded':
      return `A budget is set and no cost is recorded against it in ${monthLabel}. That is not an under-spend: it is far more often an invoice nobody has entered yet.`;
    case 'currency-gap':
      return `This budget is in ${l.budget.currency} and everything recorded in this category in ${monthLabel} is in ${l.uncovered.map((p) => p.currency).join(' and ')}. Repple holds no exchange rate, so the two are shown side by side and never subtracted.`;
    case 'no-budget':
      return `No budget covers this category in ${monthLabel}, so what was spent stands on its own.`;
    case 'unknown':
    default:
      return `${monthLabel}’s costs did not come back in full, so what was spent in this category is unknown rather than nothing — and nothing here is compared against the budget.`;
  }
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * Every budget this gym has ever set, newest plan first.
 *
 * All of them, not just the ones in force: `budgetFor` picks the one that
 * applies to the month being looked at, and a query filtered to "current"
 * budgets would answer the wrong question the moment somebody opens a month
 * from before the last revision. A gym has tens of these, not thousands, and
 * `assertWhole` refuses a truncated read in words — a prefix here would make a
 * category with a budget look like a category without one, which is the
 * difference between a variance and no variance.
 */
export async function fetchCostBudgets(sb: Queryable, tenantId: string): Promise<CostBudget[]> {
  const { data, error } = await sb
    .from('gym_cost_budgets')
    .select('id, category, amount_cents, currency, starts_on, ends_on, note, created_at')
    .eq('tenant_id', tenantId)
    .order('starts_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole(data, 'this gym’s cost budgets');
  return rows.map((r: any) => ({
    id: r.id,
    category: r.category ?? '',
    // `Number(...)` because a bigint column arrives from PostgREST as a string
    // in some client versions, and `'250000' - 240000` is a string subtraction
    // away from being a variance nobody can explain.
    amountCents: Number(r.amount_cents),
    currency: r.currency ?? '',
    startsOn: r.starts_on,
    endsOn: r.ends_on ?? null,
    note: r.note ?? null,
    createdAt: r.created_at ?? null,
  }))
    // All three columns are NOT NULL, so this drops nothing against a healthy
    // database. It is here because of what the alternative fallbacks would be:
    // `?? 0` is a budget of NOTHING rather than a missing one, which turns every
    // recorded cost into an infinite over-spend, and a blank currency would be
    // compared against a pot that has one. A row this app cannot read is not
    // returned as a budget at all, so the category shows "no budget covers this"
    // — which is true, and is not a number.
    .filter((b: CostBudget) => Number.isFinite(b.amountCents) && !!b.currency && !!b.startsOn);
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * Set a budget.
 *
 * `amountCents` and `currency` arrive already read — the caller has run
 * `budgetBlockers` and cannot get here without them — rather than this function
 * reading the typed string a second time.
 *
 * There is no update to pair with this. Part 2760's trigger refuses a change to
 * the amount, the category, the currency or the start date: a variance somebody
 * acted on in July was computed against those, and editing them in November
 * rewrites what the gym had planned in the direction that makes the past look
 * better. A revision is a new row with a later `startsOn`, which leaves both
 * figures readable.
 */
export async function createCostBudget(
  sb: Queryable, tenantId: string, createdBy: string | null,
  b: { category: GymCostCategory; amountCents: number; currency: string; startsOn: string; note?: string | null },
): Promise<void> {
  const r = await sb.from('gym_cost_budgets').insert({
    tenant_id: tenantId,
    created_by: createdBy,
    category: b.category,
    amount_cents: b.amountCents,
    currency: b.currency.trim().toUpperCase(),
    starts_on: b.startsOn,
    ends_on: null,
    note: (b.note ?? '').trim() || null,
  }, { count: 'exact' });
  if (r.error) throw r.error;
  // The count, not the absence of an error: an insert that matches no policy
  // returns `error: null`, and a screen reading `error` alone would say the
  // budget was set while the table is empty.
  assertWrote('That budget', r);
}

/**
 * Record that the gym stopped budgeting for this category.
 *
 * Not a delete. A removed budget says the gym never planned this, and every
 * month it was in force loses its comparison; an ended one says the gym planned
 * it until June, which is what the months before June are measured against.
 */
export async function endCostBudget(
  sb: Queryable, budgetId: string, endsOn: string,
): Promise<void> {
  const r = await sb.from('gym_cost_budgets')
    .update({ ends_on: endsOn }, { count: 'exact' })
    .eq('id', budgetId);
  if (r.error) throw r.error;
  assertWrote('That budget', r);
}

/**
 * Remove a budget.
 *
 * For one typed by mistake, and for nothing else — the confirmation on the
 * screen says so. No money figure changes: a budget has never been added into
 * any total in this product, and the costs it was compared against are
 * untouched. What DOES change is that every month this budget was in force
 * loses its comparison, which is why ending it is offered first.
 */
export async function deleteCostBudget(sb: Queryable, budgetId: string): Promise<void> {
  const r = await sb.from('gym_cost_budgets').delete({ count: 'exact' }).eq('id', budgetId);
  if (r.error) throw r.error;
  assertWrote('That budget', r);
}
