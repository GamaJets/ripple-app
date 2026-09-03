// The bill that was not entered before the month was filed.
//
// ── What goes wrong, and why it is not a small thing ───────────────────────
//
// Closing a month LOCKS it. `gym_refuse_write_into_closed_month`
// (supabase/parts/182) is attached to `gym_payments` and `gym_invoices`, part
// 481 attached it to `payroll_settlements`, and supabase/parts/700 attached it
// to `gym_costs` keyed on `paid_on`. So from the moment an owner presses Close
// on August, nobody at this gym can record an August cost. The database refuses
// it with a P0001 naming the month, and the only way back is a reopen on
// /close — a screen `gym_month_closes`'s own policy makes owner-only, which the
// bookkeeper holding the rent invoice does not have.
//
// The Close screen reads five things: payments, invoices, sessions, memberships
// and passes. `CLOSE_PARTS` in monthEnd.ts is that list and costs are not in it.
// So the screen that permanently locks a gym's cost ledger for a month has
// never shown a single figure from it, and its own confirmation banner says
// out loud that "the database will then refuse a payment, an invoice, a cost or
// a payroll run dated inside {month}" — the screen already knows costs get
// locked, and still tells the owner nothing about whether theirs are in.
//
// The timing is the worst part and it is not bad luck. A cost row is what
// somebody types off a supplier's invoice, and a supplier's invoice for August
// arrives in September. Month-end close happens in the first week of September.
// The one moment an owner is most likely to press this button is the one moment
// August's costs are most likely to be half-entered.
//
// ── What this module does, and the two things it refuses to do ─────────────
//
// It answers one question: of the costs this gym records EVERY month, which are
// not in the month about to be closed. Rent, the electricity, the cleaner, the
// music licence, the accountant — the lines that are there in May, June and
// July and missing in August are the ones somebody has not got to yet.
//
// It does NOT subtract anything from anything. src/lib/gymCosts.ts states that
// rule at length under a heading in capitals, for five separate reasons, and
// this module is downstream of it: there is no `net`, no `profit` and no
// `margin` here and there must never be one. What is on screen is a list of
// names and, beside each, what that supplier last cost — never a total against
// the month's takings.
//
// It does NOT merge currencies. A gym insured through a European broker and
// renting in pounds has two amounts of money, and `usual` below is stated only
// where every sighting of that line agreed on the three letters.
//
// ── Why it is allowed to be an opinion, and how it is kept a narrow one ────
//
// "This looks missing" is a guess, and a guess in front of an owner about to
// sign something has to be a guess that is almost never wrong. Three rules,
// each of which kills a specific false positive that a looser version produced
// against the shape of this table:
//
//   1. Seen in at least `RECURRING_MIN_MONTHS` distinct months of the
//      look-back. Two sightings is a coincidence — a gym buys a treadmill belt
//      twice in a year — and would put a maintenance line in front of somebody
//      every month for the rest of the year.
//
//   2. Seen in the MOST RECENT month on record before this one. This is the
//      rule that handles a gym changing supplier or cancelling a service: an
//      insurer used from January to May and dropped in June is not missing from
//      August, it is gone, and nagging about it every month afterwards is how a
//      warning gets ignored.
//
//   3. Matched on category AND supplier, with the supplier required. A cost
//      with no payee on it cannot be told apart from any other cost in its
//      category, so grouping those by category alone would claim "utilities is
//      missing" at a gym that simply does not write payees down. Those rows are
//      counted — `unnamed` says how many — and never turned into a claim.
//
// The look-back is complete months only and the month being closed is never in
// it. A month cannot be evidence for a judgement about itself.
//
// Pure. No Supabase import, no React, no Date formatting: months are 'YYYY-MM'
// strings and days are 'YYYY-MM-DD' strings, compared and stepped as text and
// integers, so this file behaves identically in Kiritimati and Midway. Asserted
// against under plain `node`.
import { normalise } from './consoleSearch';

/**
 * The month's shape of a cost, and only the fields a judgement is made from.
 *
 * Structurally satisfied by `GymCost` in gymCosts.ts, and deliberately narrower
 * than it: this module has no business with a description, a note or who typed
 * it, and a narrower input is one that cannot grow a second opinion about what
 * a cost is.
 */
export interface CostLine {
  supplier: string | null;
  category: string;
  /** Minor units. Null is money of unknown size and is never treated as zero. */
  amountCents: number | null;
  /** ISO 4217, uppercase. Null prints a dash and is never guessed at. */
  currency: string | null;
  /** 'YYYY-MM-DD', the day the money went out. */
  paidOn: string;
}

/**
 * How many complete months before the one being closed are looked at.
 *
 * Six, which is two quarters. Long enough that a quarterly line is seen twice
 * and therefore stays below the bar — a quarterly bill genuinely is not due
 * every month and must not be reported as missing — and short enough that a
 * supplier dropped last spring has fallen out of the window entirely.
 */
export const COST_LOOKBACK_MONTHS = 6;

/**
 * How many of those months a line must appear in before it is called recurring.
 *
 * Three. Two is a coincidence; three in six months with the most recent one
 * among them is a standing arrangement.
 */
export const RECURRING_MIN_MONTHS = 3;

/* ── months, as text ──────────────────────────────────────────────────────── */

/**
 * The month a cost was paid in, or null when the day is not a day.
 *
 * String slicing rather than `new Date(paidOn)`. `paid_on` is a DATE column and
 * a DATE parsed as an instant is midnight UTC, which in a gym west of Greenwich
 * is the previous evening — so `new Date('2026-08-01').getMonth()` is July for
 * half the world. The month key is already the first seven characters and the
 * only correct way to get it is to take them.
 */
export function costMonthOf(paidOn: string | null | undefined): string | null {
  const v = (paidOn ?? '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) ? v.slice(0, 7) : null;
}

/** Whether a string is a 'YYYY-MM' month key. */
export function isMonthKey(key: string | null | undefined): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test((key ?? '').trim());
}

/**
 * The `count` month keys immediately before `key`, newest first.
 *
 * Arithmetic on the two numbers in the key. `recentMonths` in monthEnd.ts steps
 * a Date and is right for "the last N months from now"; this one steps back
 * from a NAMED month, and going through a Date to do that would put the answer
 * on the reader's clock for a question whose input is already a calendar.
 */
export function monthsBefore(key: string, count: number): string[] {
  if (!isMonthKey(key) || count <= 0) return [];
  let y = Number(key.slice(0, 4));
  let m = Number(key.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/* ── one standing line ────────────────────────────────────────────────────── */

/**
 * The key two costs are the same standing line under.
 *
 * Category and supplier, with the supplier folded through the console's own
 * `normalise` — so "EDF Energy", "edf energy" and "EDF  Energy" are one line,
 * which they are, and a gym that has spelled its landlord three ways is not
 * told about three missing rents.
 *
 * Null for a cost with no supplier on it. That is not a failure: it is the
 * honest answer, and every caller here treats it as "cannot be judged" rather
 * than as a group of its own.
 */
export function costLineKey(row: Pick<CostLine, 'supplier' | 'category'>): string | null {
  const supplier = normalise(row.supplier);
  const category = normalise(row.category);
  if (!supplier) return null;
  return `${category}\u0000${supplier}`;
}

/** A cost line the gym records month after month. */
export interface StandingCost {
  /** `costLineKey` for this line. Stable, and what a caller keys a list on. */
  key: string;
  /** The supplier as it was last spelled, for the screen. Never the folded form. */
  supplier: string;
  /** The stored category code. `gymCostCategoryLabel` turns it into words. */
  category: string;
  /** How many distinct months of the look-back this line appeared in. */
  monthsSeen: number;
  /** How many months were looked at. `monthsSeen` of `lookback` is the claim. */
  lookback: number;
  /** The most recent month of the look-back it appeared in, 'YYYY-MM'. */
  lastSeen: string;
  /**
   * What it last cost, where that can be stated.
   *
   * Null in three cases and each is a refusal rather than a gap: the sightings
   * are in more than one currency, the most recent sighting carries no amount,
   * or it carries no currency. There is deliberately no average here — a mean
   * of a rent that went up in April is a figure no invoice anywhere says, and
   * this number sits beside a name on a screen somebody is about to act on.
   */
  usual: { cents: number; currency: string } | null;
}

/**
 * Every standing line in a set of past costs, biggest commitment first.
 *
 * `months` is the look-back window, newest first, and it is passed rather than
 * derived so that the caller's window and this judgement cannot disagree about
 * which months were read. Rows outside it are ignored; a row in the month being
 * closed must never be in here.
 *
 * "Months on record" is the months of that window in which this gym recorded
 * ANY cost at all, and rule 2 is checked against the newest of those rather
 * than against the newest month of the window. A gym that recorded nothing in
 * July — a holiday, a bookkeeper off sick — should not have every standing line
 * in its ledger silently disqualified by that one gap.
 */
export function standingCosts(
  past: readonly CostLine[],
  months: readonly string[],
  minMonths: number = RECURRING_MIN_MONTHS,
): StandingCost[] {
  const window = new Set(months.filter(isMonthKey));
  if (!window.size) return [];

  interface Acc {
    supplier: string;
    category: string;
    months: Set<string>;
    /** Newest sighting, for `lastSeen` and for `usual`. */
    latestMonth: string;
    latestDay: string;
    latestCents: number | null;
    latestCurrency: string | null;
    currencies: Set<string>;
  }
  const acc = new Map<string, Acc>();
  const monthsOnRecord = new Set<string>();

  for (const row of past) {
    const month = costMonthOf(row.paidOn);
    if (!month || !window.has(month)) continue;
    monthsOnRecord.add(month);

    const key = costLineKey(row);
    // A cost with no payee is counted into `monthsOnRecord` above — the gym did
    // record something that month — and then dropped. It cannot be told apart
    // from any other cost in its category, so it can neither be a standing line
    // nor evidence that one was paid.
    if (!key) continue;

    let at = acc.get(key);
    if (!at) {
      at = {
        supplier: (row.supplier ?? '').trim(),
        category: row.category ?? '',
        months: new Set<string>(),
        latestMonth: month,
        latestDay: row.paidOn,
        latestCents: row.amountCents ?? null,
        latestCurrency: row.currency ?? null,
        currencies: new Set<string>(),
      };
      acc.set(key, at);
      // Newest wins, and the tie-break is the DAY rather than the month, so two
      // rents inside one month resolve to the later one. `>` and not `>=`: the
      // rows arrive newest-first from `fetchGymCosts`, so the first of an equal
      // pair is the one that read already put in front, and flipping to `>=`
      // would silently prefer whichever tied row happened to come last.
    } else if (row.paidOn > at.latestDay) {
      at.latestMonth = month;
      at.latestDay = row.paidOn;
      at.latestCents = row.amountCents ?? null;
      at.latestCurrency = row.currency ?? null;
      at.supplier = (row.supplier ?? '').trim() || at.supplier;
      at.category = row.category ?? at.category;
    }
    at.months.add(month);
    if (row.currency) at.currencies.add(row.currency);
  }

  // Rule 2's anchor: the newest month this gym actually recorded a cost in.
  const newestOnRecord = [...monthsOnRecord].sort().pop() ?? null;
  if (!newestOnRecord) return [];

  const out: StandingCost[] = [];
  for (const [key, at] of acc) {
    if (at.months.size < minMonths) continue;
    if (!at.months.has(newestOnRecord)) continue;
    out.push({
      key,
      supplier: at.supplier,
      category: at.category,
      monthsSeen: at.months.size,
      lookback: window.size,
      lastSeen: at.latestMonth,
      usual:
        at.currencies.size === 1 && at.latestCents != null && at.latestCurrency
          ? { cents: at.latestCents, currency: at.latestCurrency }
          : null,
    });
  }

  // Most-established first, then by the folded key so two lines seen equally
  // often come out in the same order on every render and in every timezone.
  // The key rather than `localeCompare` on the supplier: this is a stable sort
  // of a list, not a name shown in alphabetical order to a reader, and
  // `localeCompare` with no argument answers differently on two machines.
  return out.sort(
    (a, b) => b.monthsSeen - a.monthsSeen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * The standing lines that are not in this month.
 *
 * `month` is the rows dated inside the month being closed. A line is present if
 * it appears at all — one row is enough, because the question is whether
 * somebody has entered it, not whether the amount is right.
 */
export function missingStandingCosts(
  month: readonly CostLine[],
  standing: readonly StandingCost[],
): StandingCost[] {
  const present = new Set<string>();
  for (const row of month) {
    const key = costLineKey(row);
    if (key) present.add(key);
  }
  return standing.filter((s) => !present.has(s.key));
}

/* ── what the screen says ─────────────────────────────────────────────────── */

/**
 * How the two reads came back.
 *
 * The same five answers every read in this codebase has, and they are five
 * different sentences on purpose. 'partial' is not 'ready' — a prefix of a cost
 * ledger would make every line beyond the cap look missing, which is the exact
 * false accusation this module is built to avoid — and 'empty' is not 'failed',
 * because a gym in its first month genuinely has no history.
 */
export type CostReadState = 'loading' | 'failed' | 'partial' | 'ready';

export interface CostVerdictInput {
  /** The month being closed, 'YYYY-MM'. */
  monthKey: string;
  /** The month's label in the reader's own language, for the sentence. */
  monthLabel: string;
  /** How the month's own costs read. */
  monthState: CostReadState;
  /** How the look-back read. */
  pastState: CostReadState;
  /** Rows dated inside the month. Ignored unless `monthState` is 'ready'. */
  monthRows: readonly CostLine[];
  /** Rows dated inside the look-back. Ignored unless `pastState` is 'ready'. */
  pastRows: readonly CostLine[];
  /** Look-back length, in complete months. */
  lookback?: number;
  /** How many sightings make a line standing. */
  minMonths?: number;
}

export type CostVerdictKind =
  /** One or both reads have not come back. Nothing is claimed. */
  | 'unknown'
  /** A read failed. Nothing is claimed, and the reason is carried. */
  | 'unread'
  /** A read was truncated. Nothing is claimed, for a stated reason. */
  | 'truncated'
  /** This gym has no cost history to judge against. */
  | 'no_history'
  /** There is history, and nothing standing is missing. */
  | 'complete'
  /** There is history, and something standing is missing. */
  | 'gaps';

export interface CostVerdict {
  kind: CostVerdictKind;
  /** The standing lines not in this month. Empty for every kind but 'gaps'. */
  missing: StandingCost[];
  /** Standing lines found, whether or not they are missing. */
  standing: StandingCost[];
  /** How many rows the month has. Null wherever the month read is not whole. */
  entered: number | null;
  /** Rows in the month with no supplier on them, so no judgement covers them. */
  unnamed: number | null;
  /** One line, in the owner's words. Never a figure across currencies. */
  text: string;
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * What to say about this month's costs, above a button that files the month.
 *
 * The order is the order a reader should act in: a read that did not come back
 * outranks everything, because a list of missing suppliers computed over half a
 * ledger is worse than no list. Only when both reads are whole does this offer
 * an opinion at all.
 */
export function costVerdict(input: CostVerdictInput): CostVerdict {
  const lookback = input.lookback ?? COST_LOOKBACK_MONTHS;
  const minMonths = input.minMonths ?? RECURRING_MIN_MONTHS;
  const none = { missing: [], standing: [], entered: null, unnamed: null };

  if (input.monthState === 'failed' || input.pastState === 'failed') {
    return {
      ...none,
      kind: 'unread',
      text:
        `This gym’s costs could not be read, so nothing here says whether ${input.monthLabel} ` +
        `is complete. Closing still locks the month against them.`,
    };
  }
  if (input.monthState === 'partial' || input.pastState === 'partial') {
    return {
      ...none,
      kind: 'truncated',
      text:
        `Only the first rows of this gym’s costs were read and there are more, so no line can be ` +
        `called missing without accusing one that was simply past the end of the read.`,
    };
  }
  if (input.monthState === 'loading' || input.pastState === 'loading') {
    return { ...none, kind: 'unknown', text: 'Reading this gym’s costs…' };
  }

  const entered = input.monthRows.length;
  const unnamed = input.monthRows.filter((r) => !costLineKey(r)).length;
  const standing = standingCosts(
    input.pastRows,
    monthsBefore(input.monthKey, lookback),
    minMonths,
  );
  const missing = missingStandingCosts(input.monthRows, standing);

  if (!standing.length) {
    return {
      missing: [], standing: [], entered, unnamed,
      kind: 'no_history',
      // Deliberately not "your costs are complete". With nothing standing to
      // compare against, this screen knows nothing about what is missing, and
      // saying so is the whole difference between a check and a reassurance.
      text:
        entered === 0
          ? `No costs are recorded in ${input.monthLabel}, and there is no run of earlier months ` +
            `to say what usually is. Closing locks the month against every cost dated inside it.`
          : `${entered} cost${s(entered)} recorded in ${input.monthLabel}. There is not enough ` +
            `history yet to say which of this gym’s regular bills are usually here by now.`,
    };
  }

  if (!missing.length) {
    return {
      missing: [], standing, entered, unnamed,
      text:
        `Every one of the ${standing.length} suppliers this gym pays most months is in ` +
        `${input.monthLabel}. That is about who has been entered, not about whether the ` +
        `amounts are right.`,
      kind: 'complete',
    };
  }

  return {
    missing, standing, entered, unnamed,
    kind: 'gaps',
    text:
      `${missing.length} of the ${standing.length} suppliers this gym pays most months ` +
      `${missing.length === 1 ? 'is' : 'are'} not in ${input.monthLabel} yet. Closing refuses ` +
      `every cost dated inside the month until somebody reopens it with a reason.`,
  };
}

/**
 * The one line stored on the close beside the blockers, or null.
 *
 * `blockers_at_close` (supabase/parts/182) is what makes a month signed off over
 * a known problem read later as a decision rather than as a clean month. A rent
 * that was not entered is exactly that kind of problem, and an owner who closed
 * anyway should have it on the record they filed.
 *
 * Null for every verdict that is not a live claim: a read that failed, a gym
 * with no history and a month with nothing missing all have nothing to record,
 * and writing "the costs could not be read" onto a permanent row would put this
 * console's network on somebody's audit trail.
 */
export function costNoteForClose(v: CostVerdict): string | null {
  if (v.kind !== 'gaps') return null;
  const names = v.missing.map((m) => m.supplier).join(', ');
  return `Closed with ${v.missing.length} regular supplier${s(v.missing.length)} not yet recorded as a cost for this month: ${names}.`;
}

/**
 * Two blocker texts joined for `blockers_at_close`, or null when both are empty.
 *
 * Newline-separated, matching `snapshotOf` in gymClose.ts, which is the only
 * other writer of that column. A separate helper rather than a `[a, b].join()`
 * at the call site because either side can be null and `['x', null].join('\n')`
 * silently stores a trailing blank line into a permanent record.
 */
export function joinCloseBlockers(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((p) => (p ?? '').trim()).filter((p) => p.length > 0);
  return kept.length ? kept.join('\n') : null;
}
