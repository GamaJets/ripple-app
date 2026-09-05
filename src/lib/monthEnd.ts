// Closing a month.
//
// Not a dashboard. A dashboard answers "how are we doing"; a close answers a
// narrower and much harder question — "is this month finished, and may I act on
// these numbers?" — and its most valuable output is the word *no*.
//
// Framework-free on purpose, and further than the reading modules go: there is
// not a Supabase client anywhere in here. Every function takes rows already
// fetched and returns a conclusion, so the same reasoning runs in the console,
// in the phone app, and in a test under plain node. The reads stay in the
// screen, because the reads are where the failure modes live and only the
// screen can render its own failures.
//
// ── The four rules this module exists to keep ──────────────────────────────
//
// 1. A month is not closed while sessions are unmarked. Payroll is computed
//    from delivered sessions, so a month with 12 unmarked sessions has a
//    payroll figure that is wrong by exactly those 12 — and wrong in the
//    direction that underpays a trainer, which is the direction that produces
//    a dispute. `closeBlockers` refuses the claim and says how many. It is not
//    a footnote under a green tick.
//
// 2. Money taken is reconciled against money the register says arrived, and a
//    gap is NAMED. `reconcile()` in finReconcile.ts already does this with a 2%
//    tolerance and is used here rather than reimplemented — one rule, one
//    tolerance, one place to change it.
//
// 3. Anything that could not be read does not become zero. Every part of the
//    close is a `Slice`, so "not read yet", "read and empty" and "the read
//    failed" stay three different answers all the way to the screen. A month
//    whose payments query failed is not a month with no income, and this module
//    will not let a caller present it as one.
//
// 4. Nothing is estimated, annualised or pro-rated. Note in particular what is
//    NOT here: there is no monthly-equivalent of an annual plan. `summarise` in
//    gymRecord.ts divides a yearly price by 12 to produce an MRR, which is the
//    right thing for a trend line and the wrong thing for a close — it invents
//    a figure for a month in which no such money moved. What the gym expected
//    to be paid comes from invoices it actually issued, or it comes from
//    nowhere and the answer is a dash.

import { isoDay } from './weekStart';
import { monthNames } from './format';
import type { GymPayment, Membership, InvoiceStatus } from './gymRecord';
// The one rule about what a set of rows is denominated in, and the one
// normalisation behind it. Imported rather than restated: this module used to
// group money by method alone and had no opinion about currency at all.
import { sharedCurrency, normaliseCurrency } from './gymRecord';
import type { PtSession, PayrollLine, PayrollTotal, PayPolicy } from './gymSessions';
import { payrollByTrainer, payrollTotal, settlementBlocker } from './gymSessions';
import type { GymPass } from './gymPasses';
import { passRevenueCents } from './gymPasses';
import type { Slice } from './memberView';
import { rowsOf } from './memberView';
import { reconcile, unreadable, type Reconciliation } from './finReconcile';

/* ── the month itself ──────────────────────────────────────────────────────── */

/** 'YYYY-MM'. */
export type MonthKey = string;

/**
 * The twelve months, written out, in the language of whoever is closing.
 *
 * Asked per call rather than held in a module constant: `monthNames()` reads
 * `appLocale()`, which is latched lazily — a constant built at import time
 * would pin every month label in the console to whatever the locale was before
 * the app had resolved one.
 */
const monthWords = () => monthNames();

export interface MonthWindow {
  key: MonthKey;
  /** 'August 2026', in the reader's own language. `key` is the fixed thing —
   *  'YYYY-MM' — and it is what everything is stored, matched and pinned on.
   *  This is the sentence on the screen, and it belongs to whoever reads it. */
  label: string;
  /** First instant of the month. */
  fromIso: string;
  /** First instant of the *next* month. Exclusive — a payment stamped
   *  00:00:00.000 on the 1st belongs to the month that is starting. */
  toIso: string;
  /** 'YYYY-MM-01', for the date-typed columns (invoices are dates, not stamps). */
  firstDay: string;
  /** 'YYYY-MM-31' or whatever the month actually ends on. */
  lastDay: string;
}

/**
 * The window for a month key, or null when the key is not one.
 *
 * Built in local time deliberately, exactly as `gymVisits.visitsPerDay` counts
 * days: a gym's August is its own August. A gym in Dubai closing August must
 * not have the evening of the 31st fall into September because UTC says so.
 */
export function monthWindow(key: MonthKey): MonthWindow | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;

  const from = new Date(y, mo - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, mo, 1, 0, 0, 0, 0);
  // Day 0 of the following month is the last day of this one, leap years
  // included, without a table of month lengths to get wrong.
  const last = new Date(y, mo, 0).getDate();

  return {
    key,
    label: `${monthWords()[mo - 1]} ${y}`,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    firstDay: `${key}-01`,
    lastDay: `${key}-${String(last).padStart(2, '0')}`,
  };
}

/** The month a moment falls in, in local time. */
export function monthKeyOf(at: number | Date = Date.now()): MonthKey {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The last `count` months, newest first, including the one running now. */
export function recentMonths(count: number, now: number = Date.now()): MonthKey[] {
  const d = new Date(now);
  const out: MonthKey[] = [];
  for (let i = 0; i < count; i++) {
    out.push(monthKeyOf(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  }
  return out;
}

/** Whether the month is over. A month still running cannot be closed. */
export function monthEnded(w: MonthWindow, now: number = Date.now()): boolean {
  return now >= Date.parse(w.toIso);
}

/** Whether a timestamp falls inside the window. */
export function inMonth(iso: string | null | undefined, w: MonthWindow): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(w.fromIso) && t < Date.parse(w.toIso);
}

/** Whether a plain 'YYYY-MM-DD' date falls inside the window. */
export function dayInMonth(day: string | null | undefined, w: MonthWindow): boolean {
  return !!day && day.slice(0, 7) === w.key;
}

/**
 * Narrow a slice to one month while keeping all three states.
 *
 * The reason this is a function rather than a `.filter()` at each call site:
 * `rows.filter(...)` on a failed read is a type error the first time and a
 * silently empty month the second, once somebody reaches for `?? []`.
 */
export function sliceMonth<T>(s: Slice<T>, w: MonthWindow, at: (row: T) => string | null): Slice<T> {
  if (s.state !== 'ready') return s;
  return { state: 'ready', rows: s.rows.filter((r) => inMonth(at(r), w)) };
}

/* ── invoices ──────────────────────────────────────────────────────────────── */

/**
 * A row of `gym_invoices`.
 *
 * Declared here rather than in gymRecord.ts because nothing had read this table
 * before — the status enum existed, the rows did not have a reader. The close
 * is the first screen that needs one, since it is the only place that asks what
 * the gym *said* it was owed as opposed to what it banked.
 */
export interface GymInvoice {
  id: string;
  memberId: string;
  memberName: string | null;
  amountCents: number;
  currency: string;
  issuedOn: string;
  /** Null means no due date was set — which is not the same as due today. */
  dueOn: string | null;
  status: InvoiceStatus;
  note: string | null;
}

/**
 * Whether an invoice is past its due date on `today`.
 *
 * An invoice due today is not late today. A missing due date is never overdue:
 * the gym did not say when it wanted the money, so it cannot claim lateness.
 */
export function isOverdue(inv: Pick<GymInvoice, 'status' | 'dueOn'>, today: string): boolean {
  if (inv.status === 'overdue') return true;
  if (inv.status !== 'open') return false;
  return !!inv.dueOn && inv.dueOn < today;
}

/* ── what came in ──────────────────────────────────────────────────────────── */

/**
 * One row of a money breakdown, and a SUM OF LIKE THINGS.
 *
 * `currency` is on the line rather than on the table because that is the whole
 * fix. `incomeOf` used to group by method alone: a gym holding pounds and
 * dirhams got one "Card" line with both added together, and /close rendered it
 * with `money(l.cents, currency)` — one currency printed over a figure that was
 * two. The same blended lines went into the month-end CSV under a front matter
 * stating a single currency, which is the document an accountant works from.
 *
 * So a line is now one method (or one attribution) in ONE currency, and a gym
 * with two currencies gets two lines rather than one wrong one. A gym with one
 * — which is almost all of them — sees exactly the table it saw before.
 */
export interface Line {
  /** Unique in its table: the id below and the currency, joined. Two
   *  currencies are two rows because they are two sums. */
  key: string;
  /** The method or the attribution on its own, without the currency. What a
   *  caller tests when it wants "the cash line" regardless of denomination. */
  id: string;
  label: string;
  /** What every payment in this line is denominated in. Null only when the
   *  rows themselves state nothing, which renders as a dash rather than as the
   *  gym's own currency — nobody said, and that is not the same as agreeing. */
  currency: string | null;
  cents: number;
  count: number;
}

export interface Income {
  /** Total banked in the month. Null when nothing was recorded, or when the
   *  payments carry more than one currency — see `currencies`. */
  takenCents: number | null;
  count: number;
  /** How the money arrived: card, cash, transfer, direct debit, other. */
  byMethod: Line[];
  /** Every distinct currency the rows actually STATE, normalised and sorted.
   *  More than one and no total is offered, because adding dirhams to pounds is
   *  not a sum, it is a fabrication. A row stating nothing is not in here — it
   *  has no code to name — but it still counts as a disagreement; ask
   *  `mixedCurrency`, never `currencies.length`, for that. */
  currencies: string[];
  /** True when these payments are not all in one money.
   *
   *  Not `currencies.length > 1`. `gym_payments.currency` is NOT NULL but has
   *  no ISO check on it, so a row holding '' states no currency at all — and a
   *  set of {GBP, unstated} has one entry in `currencies` while being exactly
   *  as unsummable as {GBP, EUR}. Every gate in this module reads this field so
   *  that the withheld total and the sentence explaining it can never come
   *  apart: a null `takenCents` with nothing saying why is the silent blank
   *  this file exists to refuse. */
  mixedCurrency: boolean;
  /** Payments with nobody's name on them. Reported, never hidden in the total. */
  unattributed: number;
  unattributedCents: number;
  /** What that figure is in, or null when those rows do not agree on one. The
   *  count is always sayable; the amount is not, and a screen holding a null
   *  here must withhold the figure rather than label it with the gym's own
   *  currency. */
  unattributedCurrency: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  card: 'Card',
  cash: 'Cash',
  transfer: 'Bank transfer',
  direct_debit: 'Direct debit',
  other: 'Other',
};

/**
 * What the gym took, and how. Rows must already be narrowed to the month.
 *
 * Grouped by method AND currency. See the note on `Line`: grouping by method
 * alone put dirhams and pounds in one figure, and both this screen and the
 * month-end CSV then printed a single currency over it.
 */
export function incomeOf(payments: GymPayment[]): Income {
  const byMethod = new Map<string, Line>();
  const currencies = new Set<string | null>();
  const unattributedRows: GymPayment[] = [];
  let cents = 0;
  let unattributedCents = 0;

  for (const p of payments) {
    // Normalised, exactly as the `byMethod` key three lines below already was.
    // This compared the RAW column while everything around it normalised, so a
    // single-currency gym holding one row written 'gbp' — nothing in the schema
    // forbids it; `gym_payments.currency` carries no ISO check — read as two
    // currencies, lost its month's total and was handed a mixed-currency
    // blocker over a set of payments that agree. `null` is the code for a row
    // that states none, and it is a member of this set like any other.
    currencies.add(normaliseCurrency(p.currency));
    cents += p.amountCents;
    if (!p.memberId) {
      unattributedRows.push(p);
      unattributedCents += p.amountCents;
    }
    const id = p.method ?? 'other';
    const currency = normaliseCurrency(p.currency);
    const key = `${id}|${currency ?? ''}`;
    const l = byMethod.get(key)
      ?? { key, id, label: METHOD_LABEL[id] ?? id, currency, cents: 0, count: 0 };
    l.cents += p.amountCents;
    l.count += 1;
    byMethod.set(key, l);
  }

  const unattributed = unattributedRows.length;
  const mixed = currencies.size > 1;
  return {
    unattributedCurrency: sharedCurrency(unattributedRows),
    // No payments is not zero income — nobody recorded anything, which is a
    // different claim and renders as a dash.
    takenCents: payments.length === 0 || mixed ? null : cents,
    count: payments.length,
    byMethod: [...byMethod.values()].sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key)),
    // The codes that were actually stated. A row saying nothing has no code to
    // put in a sentence, so it is left out of the list and carried by
    // `mixedCurrency` instead.
    currencies: statedCodes(currencies),
    mixedCurrency: mixed,
    unattributed,
    unattributedCents,
  };
}

export type Purpose = 'membership' | 'no_membership' | 'unattributed';

export const PURPOSE_LABEL: Record<Purpose, string> = {
  membership: 'Against a membership',
  no_membership: 'From a member holding no membership',
  unattributed: 'Not attributed to anybody',
};

/**
 * What the money was for, as far as the record can actually say.
 *
 * Attribution, not categories — the payments table has no category column, so
 * inventing one would be exactly the fabrication this module exists to avoid.
 * What it can say is whether the payer held a membership covering the month.
 *
 * Returns null when the membership list was not read: with no roster, every
 * payment would fall into "holding no membership" and the screen would report a
 * gym whose members all pay for nothing.
 */
export function purposeOf(
  payments: GymPayment[],
  memberships: Membership[] | null,
  w: MonthWindow,
): Line[] | null {
  if (memberships == null) return null;

  const held = new Set<string>();
  for (const m of memberships) {
    // Overlapping the month, not merely current today: a membership that
    // cancelled on the 20th was still a membership for the month being closed.
    if (m.startedOn > w.lastDay) continue;
    if (m.endsOn && m.endsOn < w.firstDay) continue;
    held.add(m.memberId);
  }

  // By attribution AND currency, for the same reason `incomeOf` is. This table
  // sits directly under that one on /close and was rendered with the same
  // single `currency` prop over it, so a gym holding two currencies read one
  // "Against a membership" figure that was two sums added together.
  const lines = new Map<string, Line>();
  const ORDER: Purpose[] = ['membership', 'no_membership', 'unattributed'];

  for (const p of payments) {
    const id: Purpose = !p.memberId ? 'unattributed' : held.has(p.memberId) ? 'membership' : 'no_membership';
    const currency = normaliseCurrency(p.currency);
    const key = `${id}|${currency ?? ''}`;
    const l = lines.get(key)
      ?? { key, id, label: PURPOSE_LABEL[id], currency, cents: 0, count: 0 };
    l.cents += p.amountCents;
    l.count += 1;
    lines.set(key, l);
  }

  // The three attributions keep their fixed order — it is an argument, read top
  // to bottom — and the currencies within one of them sort by size.
  return [...lines.values()].sort((a, b) =>
    ORDER.indexOf(a.id as Purpose) - ORDER.indexOf(b.id as Purpose)
    || b.cents - a.cents
    || a.key.localeCompare(b.key));
}

/* ── what is still owed ────────────────────────────────────────────────────── */

export interface Owed {
  issued: number;
  /** Invoices the register marks paid — the claim that money arrived. Null when
   *  none is marked paid, so it never reconciles against a derived zero. */
  settledCents: number | null;
  settled: number;
  /** Still open, including the overdue ones. */
  outstandingCents: number | null;
  outstanding: number;
  overdueCents: number | null;
  overdue: number;
  /** Void and written off, held apart from every figure above. Money the gym
   *  has decided it will not collect is not money it is owed, and it is not
   *  money it took either — it belongs on its own line or it distorts both. */
  droppedCents: number | null;
  dropped: number;
  /** Every distinct currency the invoices actually STATE. See `Income` for why
   *  this is not the field a gate reads. */
  currencies: string[];
  /** True when these invoices are not all in one money, including the case
   *  where one of them states no currency at all. Every figure above is null
   *  when this is true. */
  mixedCurrency: boolean;
}

/** The receivables picture for a month. Rows must already be narrowed to it. */
export function owedOf(invoices: GymInvoice[], today: string): Owed {
  const currencies = new Set<string | null>();
  let settled = 0, settledCents = 0;
  let outstanding = 0, outstandingCents = 0;
  let overdue = 0, overdueCents = 0;
  let dropped = 0, droppedCents = 0;

  for (const inv of invoices) {
    // Normalised, for the reason `incomeOf` is: this side is compared against
    // that one below, and two sets built by different rules cannot be compared
    // at all. `gym_invoices.currency` carries no ISO check either.
    currencies.add(normaliseCurrency(inv.currency));
    if (inv.status === 'paid') {
      settled += 1; settledCents += inv.amountCents;
    } else if (inv.status === 'void' || inv.status === 'written_off') {
      dropped += 1; droppedCents += inv.amountCents;
    } else if (inv.status === 'open' || inv.status === 'overdue') {
      outstanding += 1; outstandingCents += inv.amountCents;
      if (isOverdue(inv, today)) { overdue += 1; overdueCents += inv.amountCents; }
    }
    // 'draft' is deliberately in none of them: an invoice nobody sent is not
    // owed by anybody.
  }

  const mixed = currencies.size > 1;
  const total = (n: number, c: number) => (n === 0 || mixed ? null : c);
  return {
    issued: invoices.length,
    settledCents: total(settled, settledCents), settled,
    outstandingCents: total(outstanding, outstandingCents), outstanding,
    overdueCents: total(overdue, overdueCents), overdue,
    droppedCents: total(dropped, droppedCents), dropped,
    currencies: statedCodes(currencies),
    mixedCurrency: mixed,
  };
}

/**
 * The currency codes a set of rows actually STATED, sorted, with the "nobody
 * said" member dropped.
 *
 * Null is a real answer about a row and it belongs in the set that decides
 * whether a total may be summed. It is not a word, so it cannot go into
 * "recorded in X and Y" — a sentence assembled from a null renders "recorded in
 * and GBP", which is what scripts/check-prose.mjs exists to catch. The two
 * questions are therefore answered by two fields, and every caller in this file
 * asks `mixedCurrency` for the gate and this for the words.
 */
function statedCodes(codes: Set<string | null>): string[] {
  return [...codes].filter((c): c is string => c != null).sort();
}

/* ── what does not reconcile ───────────────────────────────────────────────── */

export interface MoneyCheck {
  /** From `reconcile()` in finReconcile.ts — the 2% tolerance, unchanged. */
  r: Reconciliation;
  /** The unexplained amount in minor units, or null when there is nothing to
   *  compare. Signed: positive means the register expected more than arrived. */
  gapCents: number | null;
  /** A sentence naming the gap, or null when the two sides agree. */
  note: string | null;
  /**
   * Why the two sides could not be COMPARED at all, or null when they could.
   *
   * A different fact from `note`'s ordinary content, and the reason this field
   * exists rather than a fourth `Agreement`: a gap is a finding about the gym's
   * records, and this is the reconciliation declining to run because the two
   * numbers are not numbers of the same thing. `r.state` is 'unreadable' in
   * every one of these cases, so nothing downstream reads a comparison out of
   * a comparison that never happened.
   */
  uncomparable: Uncomparable | null;
}

/** The three ways a month's two money records cannot be held against each
 *  other. All three are about DENOMINATION, never about a failed read — that is
 *  `Slice`'s job and it is handled before this function is reached. */
export type Uncomparable =
  /** The payments are not all in one currency, so there is no taken figure. */
  | 'taken_mixed'
  /** The invoices are not all in one currency, so there is no settled figure. */
  | 'owed_mixed'
  /** Each side agrees with itself and the two disagree with each other. */
  | 'sides_differ';

/**
 * Money taken against money the invoice register says arrived.
 *
 * Returns null when either side could not be read. That is not a hedge — a
 * reconciliation computed against a failed read is worse than no
 * reconciliation, because it looks like a finding.
 *
 * `reconcile()` is called, not reimplemented. Its 2% tolerance is the gym's one
 * tolerance and this screen has no business holding a second one.
 */
export function moneyCheck(
  income: Income | null,
  owed: Owed | null,
  fmt: (cents: number) => string = String,
): MoneyCheck | null {
  if (!income || !owed) return null;

  const derived = owed.settledCents;
  const taken = income.takenCents;

  // ── A NULL SIDE IS NOT A ZERO SIDE, AND IT HAS TWO CAUSES ───────────────
  //
  // `income.takenCents` is null for two reasons and `owed.settledCents` is too:
  // nobody recorded anything, or the rows are in more than one currency. Every
  // line below used to fold both into `taken ?? 0` and then report the result
  // as if only the first had happened. A gym with thirty GBP payments and one
  // EUR walk-in raised `money_gap`, reading "Invoices mark 12,400.00 as paid
  // this month, and not one payment was recorded against them" — beside a
  // mixed-currency blocker saying thirty-one payments were recorded, on the one
  // screen an owner signs a month off on. The register side had the identical
  // fault from the other direction: mixed invoices null the settled figure, so
  // a month whose invoices genuinely were marked paid was told "no invoice in
  // this month is marked paid, so there is nothing to check it against".
  //
  // So the currency question is asked FIRST, and where the answer stops a
  // comparison the comparison does not happen. `unreadable()` is the state for
  // that — every derived field null, nothing asserted about either record —
  // and the sentence says which of the three it was.
  if (income.mixedCurrency || owed.mixedCurrency) {
    const which: Uncomparable = income.mixedCurrency ? 'taken_mixed' : 'owed_mixed';
    return {
      r: unreadable(0),
      gapCents: null,
      note: uncomparableNote(which, income, owed),
      uncomparable: which,
    };
  }

  // Both sides silent: no invoices marked paid and no payments recorded. There
  // is nothing to reconcile and nothing wrong; say so rather than manufacturing
  // a zero-against-zero agreement.
  if (derived == null && taken == null) return null;

  // ── AND THE TWO SIDES MUST BE IN THE SAME MONEY AS EACH OTHER ───────────
  //
  // Latent, not live: this was checked against the operating record and no
  // tenant is currently taking payments in one currency while invoicing in
  // another. It is a missing guard rather than a wrong figure on anybody's
  // screen today, and it is here because each side only ever guarded its own
  // internal uniformity — `incomeOf` asks whether the payments agree,
  // `owedOf` asks whether the invoices agree, and NOTHING asked whether the
  // two answers were the same word. A gym that invoices in EUR and banks in
  // GBP would have had 12,400 held against 12,400 and been told its month
  // reconciles, which is the one outcome worse than a named gap: a green tick
  // over two unrelated numbers.
  const takenCcy = income.currencies.length === 1 ? income.currencies[0] : null;
  const owedCcy = owed.currencies.length === 1 ? owed.currencies[0] : null;
  if (takenCcy && owedCcy && takenCcy !== owedCcy) {
    return {
      r: unreadable(0),
      gapCents: null,
      note: uncomparableNote('sides_differ', income, owed),
      uncomparable: 'sides_differ',
    };
  }

  const r = reconcile(taken ?? 0, derived);
  const gapCents = r.delta;

  return { r, gapCents, note: gapNote(r, taken, fmt), uncomparable: null };
}

/**
 * The sentence for a reconciliation that could not be run.
 *
 * It names the currencies rather than the tables, because "the payments are
 * mixed" is a fact about a query and "your August takings are in GBP and EUR"
 * is a fact about the gym. No amount appears in any of the three: every figure
 * these sentences could quote is precisely the one that has been withheld.
 */
function uncomparableNote(which: Uncomparable, income: Income, owed: Owed): string {
  const list = (codes: string[]): string =>
    codes.length > 1
      ? `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`
      : codes.length === 1
        ? `${codes[0]}, and at least one states no currency at all`
        : 'currencies none of them states';
  switch (which) {
    case 'taken_mixed':
      return `The payments recorded this month are in ${list(income.currencies)}, so there is no single figure for what came in and nothing to hold the invoice register against. This is not a month with no payments in it — ${income.count} ${income.count === 1 ? 'was' : 'were'} recorded.`;
    case 'owed_mixed':
      return `The invoices issued this month are in ${list(owed.currencies)}, so there is no single figure for what the register says arrived and nothing to hold the payments against. This is not a month with nothing marked paid — ${owed.settled} invoice${owed.settled === 1 ? ' is' : 's are'}.`;
    case 'sides_differ':
    default:
      return `Payments this month are in ${income.currencies[0]} and the invoices are issued in ${owed.currencies[0]}. The two records agree with themselves and not with each other, so they cannot be reconciled: the difference between them would not be an amount of either money. Nothing here has been converted, because the rate would be one nobody chose.`;
  }
}

function gapNote(
  r: Reconciliation,
  taken: number | null,
  fmt: (cents: number) => string,
): string | null {
  switch (r.state) {
    case 'no_record':
      return `${fmt(r.typed)} was taken, but no invoice in this month is marked paid, so there is nothing to check it against.`;
    case 'not_entered':
      // reconcile() reaches this when the taken side is zero or absent.
      return taken == null
        ? `Invoices mark ${fmt(r.derived as number)} as paid this month, and not one payment was recorded against them.`
        : `Invoices mark ${fmt(r.derived as number)} as paid this month, and the payments recorded come to nothing.`;
    case 'differs': {
      const d = r.delta as number;
      return `${fmt(r.typed)} was taken; invoices mark ${fmt(r.derived as number)} as paid. ${fmt(Math.abs(d))} ${
        d > 0 ? 'that the register expected has not arrived' : 'arrived that no invoice accounts for'
      }. Name it before the month closes.`;
    }
    case 'agrees':
    default:
      return null;
  }
}

/* ── what is unmarked, and therefore blocking payroll ──────────────────────── */

export interface PayrollView {
  lines: PayrollLine[];
  total: PayrollTotal;
  /** From `settlementBlocker` — why this figure is not safe to settle on. */
  blocker: string | null;
}

/** Payroll for the month's sessions, and whether it may be acted on. */
export function payrollOf(
  sessions: PtSession[],
  policy: PayPolicy,
  fallbackRateCents: number | null,
  now: number = Date.now(),
): PayrollView {
  const lines = payrollByTrainer(sessions, policy, fallbackRateCents, now);
  const total = payrollTotal(lines);
  return { lines, total, blocker: settlementBlocker(total) };
}

/* ── the parts, and their three states ─────────────────────────────────────── */

export interface CloseRecord {
  payments: Slice<GymPayment>;
  invoices: Slice<GymInvoice>;
  sessions: Slice<PtSession>;
  memberships: Slice<Membership>;
  passes: Slice<GymPass>;
}

export type ClosePart = keyof CloseRecord;

export const CLOSE_PARTS: ClosePart[] = ['payments', 'invoices', 'sessions', 'memberships', 'passes'];

export const CLOSE_LABEL: Record<ClosePart, string> = {
  payments: 'the payments taken',
  invoices: 'the invoice register',
  sessions: 'the one-to-ones',
  memberships: 'the membership roster',
  passes: 'passes sold',
};

/** What the close loses when a part cannot be read — named as the missing
 *  *answer*, not the missing table. "payments failed" tells an owner nothing;
 *  "this month's income is unknown, not zero" tells them everything. */
export const CLOSE_COST: Record<ClosePart, string> = {
  payments: 'what came in is unknown, not zero',
  invoices: 'what was billed and what is still owed are unknown',
  sessions: 'payroll cannot be computed and no month can be closed over it',
  memberships: 'what the money was for cannot be attributed',
  passes: 'pass sales are missing from the picture',
};

export interface BrokenPart {
  part: ClosePart;
  label: string;
  cost: string;
  reason: string;
}

export function brokenCloseParts(rec: CloseRecord): BrokenPart[] {
  return CLOSE_PARTS
    .filter((p) => rec[p].state === 'failed')
    .map((p) => ({
      part: p,
      label: CLOSE_LABEL[p],
      cost: CLOSE_COST[p],
      reason: (rec[p] as { state: 'failed'; reason: string }).reason,
    }));
}

export function loadingCloseParts(rec: CloseRecord): ClosePart[] {
  return CLOSE_PARTS.filter((p) => rec[p].state === 'loading');
}

/** The parts that came back, and came back short. */
export function truncatedCloseParts(rec: CloseRecord): ClosePart[] {
  return CLOSE_PARTS.filter((p) => rec[p].state === 'partial');
}

/**
 * The sentence above a half-loaded close, or null when every part is in.
 *
 * Same rule as `memberView.partialWarning`: name the half that failed AND what
 * the reader is therefore not seeing. A close is the one screen where a partial
 * picture presented as a whole one gets somebody paid the wrong amount.
 */
export function closeWarning(rec: CloseRecord): string | null {
  const broken = brokenCloseParts(rec);
  if (!broken.length) return null;
  const names = broken.map((b) => b.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Could not read ${list}. This is a partial close, not a quiet one — ${broken.map((b) => b.cost).join('; ')}.`;
}

/* ── the refusal ───────────────────────────────────────────────────────────── */

export type BlockerKind =
  | 'month_running'
  | 'read_failed'
  | 'read_truncated'
  | 'still_loading'
  | 'unmarked_sessions'
  | 'unpriced_sessions'
  | 'money_gap'
  | 'mixed_currency';

export interface Blocker {
  kind: BlockerKind;
  /** One line a gym owner can act on. */
  text: string;
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * Why this month may not be presented as closed. Empty means it may.
 *
 * Order is deliberate — a reader acts on the first line, so the first line is
 * the one that most invalidates the rest. A failed read outranks everything
 * because a figure computed over it is not a figure at all.
 */
export function closeBlockers(
  rec: CloseRecord,
  w: MonthWindow,
  payroll: PayrollView | null,
  check: MoneyCheck | null,
  income: Income | null,
  owed: Owed | null,
  /** The month's pass sales, or null when the passes were not read. Added
   *  because this function could not see them at all: `passRevenueCents` summed
   *  across currencies with nothing to flag it and nothing downstream to
   *  refuse. */
  passes: ClosePasses | null,
  now: number = Date.now(),
): Blocker[] {
  const out: Blocker[] = [];

  for (const b of brokenCloseParts(rec)) {
    out.push({
      kind: 'read_failed',
      text: `Could not read ${b.label} — ${b.cost}. Nothing can be closed over a read that failed.`,
    });
  }

  // A read that SUCCEEDED and came back short. Its own blocker, and not folded
  // into `read_failed`, because it is the one that would otherwise get through:
  // every gate on this screen is written `state === 'ready'`, which withholds
  // the FIGURES, and none of them stops the month being signed off. A month
  // closed over a prefix of its payments is a smaller month, signed, with
  // nothing on the document saying so.
  const cut = truncatedCloseParts(rec);
  for (const p of cut) {
    out.push({
      kind: 'read_truncated',
      text:
        `Only the first rows of ${CLOSE_LABEL[p]} were read, and there are more — ${CLOSE_COST[p]}. ` +
        `A month cannot be closed over part of a set: the figure would be a subtotal with a ` +
        `signature under it.`,
    });
  }

  const loading = loadingCloseParts(rec);
  if (loading.length) {
    out.push({
      kind: 'still_loading',
      text: `Still reading ${loading.map((p) => CLOSE_LABEL[p]).join(', ')}.`,
    });
  }

  if (!monthEnded(w, now)) {
    out.push({
      kind: 'month_running',
      text: `${w.label} is still running. A month in progress has takings and sessions still to come.`,
    });
  }

  // THE rule. Payroll is computed from delivered sessions, so an unmarked
  // session is not a rounding difference — it is a session somebody worked that
  // this figure does not pay for. Note that `payrollTotal.settleable` is NOT
  // used as the test: it is also false when a gym simply has no PT sessions at
  // all, and a gym that does no personal training has nothing blocking its
  // month. The two conditions below are the ones that mean the number is wrong.
  if (payroll) {
    const t = payroll.total;
    if (t.unmarked > 0) {
      out.push({
        kind: 'unmarked_sessions',
        text: `${t.unmarked} session${s(t.unmarked)} finished in ${w.label} with no outcome recorded. Payroll counts delivered sessions, so this month's figure is wrong by exactly ${
          t.unmarked === 1 ? 'that one' : `those ${t.unmarked}`
        } until somebody marks ${t.unmarked === 1 ? 'it' : 'them'}.`,
      });
    }
    if (t.payable > t.priced) {
      const missing = t.payable - t.priced;
      out.push({
        kind: 'unpriced_sessions',
        text: `${missing} payable session${s(missing)} carr${missing === 1 ? 'ies' : 'y'} no rate, so ${
          missing === 1 ? 'it is' : 'they are'
        } missing from the payroll total rather than costing nothing. Set a session fee.`,
      });
    }
  }

  // A named gap blocks; the absence of a second source does not.
  //
  // 'differs' is a real contradiction between two records and 'not_entered' is
  // the register claiming money arrived that no payment row shows — both are
  // gaps and both stop the month. 'no_record' is a gym that does not invoice
  // through Repple at all: there is nothing contradicting anything, so it is
  // said out loud in the panel and in the headline, and it does not pretend to
  // be an error. A cash-only gym must still be able to close its month.
  if (check?.note && (check.r.state === 'differs' || check.r.state === 'not_entered')) {
    out.push({ kind: 'money_gap', text: check.note });
  }

  // `mixedCurrency`, not `currencies.length > 1`. The two differ by exactly the
  // case where one row states no currency: the total is withheld either way,
  // and only this field also raises the line that says why. A withheld figure
  // with no sentence beside it is a blank the reader has to explain to
  // themselves, and they explain it as nothing.
  if (income?.mixedCurrency) {
    out.push({
      kind: 'mixed_currency',
      text: income.currencies.length > 1
        ? `Payments in ${w.label} are recorded in ${income.currencies.join(' and ')}. They are not added together here, because that would not be a total.`
        : `Payments in ${w.label} do not all say what currency they are in${income.currencies.length ? ` — some are recorded in ${income.currencies[0]} and at least one states none` : ''}. No total is offered: an amount whose money is unknown is not an amount.`,
    });
  }
  if (owed?.mixedCurrency) {
    out.push({
      kind: 'mixed_currency',
      text: owed.currencies.length > 1
        ? `Invoices in ${w.label} are issued in ${owed.currencies.join(' and ')}, so no single figure is offered for what is owed.`
        : `Invoices in ${w.label} do not all say what currency they are in${owed.currencies.length ? ` — some are issued in ${owed.currencies[0]} and at least one states none` : ''}, so no single figure is offered for what is owed.`,
    });
  }
  // The two sides disagreeing with EACH OTHER has no blocker of its own above:
  // both sets are internally uniform, so neither mixed-currency line fires, and
  // without this the month would close with no reconciliation having run and
  // nothing on the screen saying so. Same kind as the two above because it is
  // the same fact — two currencies where a comparison needs one.
  if (check?.uncomparable === 'sides_differ' && check.note) {
    out.push({ kind: 'mixed_currency', text: check.note });
  }

  // Passes are the third money record on this screen, and until now the only
  // one nothing here asked a currency question about. They do NOT enter
  // `CloseSnapshot` — `closeMonth` in src/lib/gymClose.ts writes taken,
  // invoiced, outstanding, payroll, currency and unmarked sessions, and no pass
  // figure among them — so nothing wrong has ever been written to
  // `gym_month_closes` over this. It is still a line on the close: a gym that
  // changed currency mid-month has a pass total that is not a total, and the
  // month may not be signed off with an unexplained figure on it.
  if (passes?.mixedCurrency) {
    out.push({
      kind: 'mixed_currency',
      text: `Passes issued in ${w.label} were sold in ${
        passes.currencies.length > 1 ? passes.currencies.join(' and ') : 'more than one currency'
      }, so what they come to is not one figure. Pass sales are shown beside the takings and never added into them, and this is the same rule one level down.`,
    });
  }

  return out;
}

export type CloseState = 'closeable' | 'blocked';

/**
 * The month's pass sales, and what money they are in.
 *
 * The last two fields are the point of the type. `passRevenueCents` used to be
 * called from here with `Pick<GymPass, 'paidCents'>` — a signature that
 * narrowed away the currency of rows whose currency is nullable — and this
 * object carried the sum and nothing else, so `closeBlockers` could not see a
 * pass currency and the screen had no fact to print. `passConversion.ts`
 * already derived exactly these two for /passes; they are now derived once, in
 * `passRevenueCents`, and both readers take them from there.
 *
 * `cents` is deliberately still the raw sum when `mixedCurrency` is true rather
 * than null, because a caller wording a null `cents` is wording "not one pass
 * carried a price", which is a different and false thing to say about a gym
 * that priced four of them in two currencies. A caller holding
 * `mixedCurrency: true` must WITHHOLD the figure and say why — it may not put a
 * currency in front of it, and it may not silently print nothing either.
 */
export interface ClosePasses {
  /** Minor units summed across the priced passes, or null when none carried a
   *  price. NOT an amount of any single money when `mixedCurrency` is true. */
  cents: number | null;
  /** How many of the month's passes carried a recorded price. */
  priced: number;
  /** How many were issued in the month at all. */
  sold: number;
  /** What every priced pass agrees it was sold in, or null when they do not
   *  agree or none of them says. */
  currency: string | null;
  /** The codes actually stated, for a sentence that has to name them. */
  currencies: string[];
  /** True when the priced passes are not all in one money. */
  mixedCurrency: boolean;
}

export interface MonthClose {
  window: MonthWindow;
  ended: boolean;
  /** Null when the payments read did not succeed. Never an empty income. */
  income: Income | null;
  /** What the money was for. Null when the roster was not read. */
  purpose: Line[] | null;
  /** Invoices issued *in* the month — the side the reconciliation uses. */
  owed: Owed | null;
  /** Everything still unpaid that was issued on or before the month end,
   *  whatever month it came from. This is the answer to "what is still owed",
   *  which is not the same question as "what did this month bill". */
  arrears: Owed | null;
  check: MoneyCheck | null;
  payroll: PayrollView | null;
  /** Pass sales in the month, held apart from `income` on purpose — see below. */
  passes: ClosePasses | null;
  blockers: Blocker[];
  state: CloseState;
  /** The banner above the whole screen when a part failed. */
  warning: string | null;
}

export interface CloseOptions {
  policy: PayPolicy;
  /** The gym's standard session fee, for sessions with no snapshotted rate.
   *  Null when no fee is set — and then unpriced sessions stay unpriced rather
   *  than being valued at nothing. */
  fallbackRateCents?: number | null;
  now?: number;
  /**
   * The day to judge an invoice overdue against, as a plain ISO date — the
   * GYM's own, `gymDay(Date.now(), zone)`.
   *
   * Injected for the same reason `fmt` is: this module holds no tenant and
   * therefore no timezone, and a close that guessed one would be guessing about
   * which side of a month boundary somebody's invoice fell. It was not
   * injectable at all until now, and what it did instead was take UTC's
   * calendar day — which is nobody's, and which is one day ahead of the gym for
   * every reader west of Greenwich through their whole evening. An invoice due
   * on the 31st was counted overdue from 5pm on the 31st in Los Angeles, on the
   * one screen an owner uses to sign off a month.
   */
  today?: string;
  /** How to render an amount inside a sentence. Injected rather than assumed:
   *  this module holds no opinion about the gym's currency. */
  fmt?: (cents: number) => string;
}

/**
 * The whole close for one month.
 *
 * Every input arrives as a slice and every output that depends on a slice that
 * is not ready is null. There is no branch anywhere in here that substitutes an
 * empty array for a failed read.
 *
 * Pass sales sit in their own field and are never added into `income`. The
 * payments table and the passes table are two independent records with no link
 * column between them: a desk that sold a pass for cash may or may not also
 * have recorded a payment for it, and neither adding them (double counting) nor
 * ignoring one (silently dropping income) can be justified from the rows. So
 * both are shown, and the screen says they are two records rather than one sum.
 */
export function buildClose(rec: CloseRecord, w: MonthWindow, opts: CloseOptions): MonthClose {
  const now = opts.now ?? Date.now();
  // The reader's own day where the caller has not said which day it is. Not
  // UTC's, which is what this was and which belongs to nobody in the building;
  // see `today` on CloseOptions for what it cost. The gym's day is the true
  // answer and it is one argument away.
  const today = opts.today ?? isoDay(new Date(now));

  const paidRows = rowsOf(sliceMonth(rec.payments, w, (p) => p.takenAt));
  const invRows = rowsOf(rec.invoices);
  const sessRows = rowsOf(sliceMonth(rec.sessions, w, (x) => x.startsAt));
  const passRows = rowsOf(rec.passes);

  const income = paidRows ? incomeOf(paidRows) : null;
  const purpose = paidRows ? purposeOf(paidRows, rowsOf(rec.memberships), w) : null;

  // Invoices carry dates, not timestamps, so they are filtered on the day
  // rather than the instant.
  const owed = invRows ? owedOf(invRows.filter((i) => dayInMonth(i.issuedOn, w)), today) : null;
  // Arrears reach back: an invoice issued in June and still unpaid in August is
  // money the gym is owed at the August close. Scoped to invoices issued on or
  // before the month end so that closing an old month is not polluted by
  // billing that happened after it.
  const arrears = invRows ? owedOf(invRows.filter((i) => i.issuedOn <= w.lastDay), today) : null;

  const check = moneyCheck(income, owed, opts.fmt);

  const payroll = sessRows
    ? payrollOf(sessRows, opts.policy, opts.fallbackRateCents ?? null, now)
    : null;

  const passesInMonth = passRows ? passRows.filter((p) => dayInMonth(p.issuedOn, w)) : null;
  const passes: ClosePasses | null = passesInMonth
    ? (() => {
        // Every field, not three of six. This call took the sum and dropped the
        // currency on the floor, so a gym that changed currency mid-month had
        // AED 860 and GBP 240 arrive here as 1,100 with nothing anywhere saying
        // the two halves were not the same money.
        const r = passRevenueCents(passesInMonth);
        return {
          cents: r.cents,
          priced: r.priced,
          sold: r.total,
          currency: r.currency,
          currencies: r.currencies,
          mixedCurrency: r.mixedCurrency,
        };
      })()
    : null;

  const blockers = closeBlockers(rec, w, payroll, check, income, owed, passes, now);

  return {
    window: w,
    ended: monthEnded(w, now),
    income,
    purpose,
    owed,
    arrears,
    check,
    payroll,
    passes,
    blockers,
    state: blockers.length ? 'blocked' : 'closeable',
    warning: closeWarning(rec),
  };
}

/**
 * The headline sentence for the close, in the gym's own words.
 *
 * Never "closed ✓" when anything is blocking, and never a figure in the same
 * breath as a refusal — a payroll total printed beside "12 unmarked" is read as
 * the payroll total.
 */
export function closeHeadline(c: MonthClose): string {
  if (c.state === 'blocked') {
    const n = c.blockers.length;
    return `${c.window.label} is not closed. ${n} thing${s(n)} ${n === 1 ? 'is' : 'are'} in the way.`;
  }
  // Closeable, but the headline must not claim a check that never ran. A gym
  // that issues no invoices has nothing for its takings to be reconciled
  // against, and saying "reconciles" there would be the screen inventing
  // assurance it does not have.
  return c.check?.r.state === 'agrees'
    ? `${c.window.label} reconciles against the invoice register and nothing is unmarked. This month can be closed.`
    : `${c.window.label} has nothing unmarked and nothing unexplained. No invoice in the month was marked paid, so what came in stands on the payment record alone — it was not checked against a second source.`;
}
