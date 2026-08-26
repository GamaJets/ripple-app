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

import type { GymPayment, Membership, InvoiceStatus } from './gymRecord';
import type { PtSession, PayrollLine, PayrollTotal, PayPolicy } from './gymSessions';
import { payrollByTrainer, payrollTotal, settlementBlocker } from './gymSessions';
import type { GymPass } from './gymPasses';
import { passRevenueCents } from './gymPasses';
import type { Slice } from './memberView';
import { rowsOf } from './memberView';
import { reconcile, type Reconciliation } from './finReconcile';

/* ── the month itself ──────────────────────────────────────────────────────── */

/** 'YYYY-MM'. */
export type MonthKey = string;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface MonthWindow {
  key: MonthKey;
  /** 'August 2026'. Fixed English, not locale-dependent, so a test can pin it. */
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
    label: `${MONTHS[mo - 1]} ${y}`,
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

export interface Line {
  key: string;
  label: string;
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
  /** Every distinct currency seen. More than one and no total is offered,
   *  because adding dirhams to pounds is not a sum, it is a fabrication. */
  currencies: string[];
  /** Payments with nobody's name on them. Reported, never hidden in the total. */
  unattributed: number;
  unattributedCents: number;
}

const METHOD_LABEL: Record<string, string> = {
  card: 'Card',
  cash: 'Cash',
  transfer: 'Bank transfer',
  direct_debit: 'Direct debit',
  other: 'Other',
};

/** What the gym took, and how. Rows must already be narrowed to the month. */
export function incomeOf(payments: GymPayment[]): Income {
  const byMethod = new Map<string, Line>();
  const currencies = new Set<string>();
  let cents = 0;
  let unattributed = 0;
  let unattributedCents = 0;

  for (const p of payments) {
    currencies.add(p.currency);
    cents += p.amountCents;
    if (!p.memberId) {
      unattributed += 1;
      unattributedCents += p.amountCents;
    }
    const key = p.method ?? 'other';
    const l = byMethod.get(key) ?? { key, label: METHOD_LABEL[key] ?? key, cents: 0, count: 0 };
    l.cents += p.amountCents;
    l.count += 1;
    byMethod.set(key, l);
  }

  const mixed = currencies.size > 1;
  return {
    // No payments is not zero income — nobody recorded anything, which is a
    // different claim and renders as a dash.
    takenCents: payments.length === 0 || mixed ? null : cents,
    count: payments.length,
    byMethod: [...byMethod.values()].sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key)),
    currencies: [...currencies].sort(),
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

  const lines: Record<Purpose, Line> = {
    membership: { key: 'membership', label: PURPOSE_LABEL.membership, cents: 0, count: 0 },
    no_membership: { key: 'no_membership', label: PURPOSE_LABEL.no_membership, cents: 0, count: 0 },
    unattributed: { key: 'unattributed', label: PURPOSE_LABEL.unattributed, cents: 0, count: 0 },
  };

  for (const p of payments) {
    const k: Purpose = !p.memberId ? 'unattributed' : held.has(p.memberId) ? 'membership' : 'no_membership';
    lines[k].cents += p.amountCents;
    lines[k].count += 1;
  }

  return [lines.membership, lines.no_membership, lines.unattributed].filter((l) => l.count > 0);
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
  currencies: string[];
}

/** The receivables picture for a month. Rows must already be narrowed to it. */
export function owedOf(invoices: GymInvoice[], today: string): Owed {
  const currencies = new Set<string>();
  let settled = 0, settledCents = 0;
  let outstanding = 0, outstandingCents = 0;
  let overdue = 0, overdueCents = 0;
  let dropped = 0, droppedCents = 0;

  for (const inv of invoices) {
    currencies.add(inv.currency);
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
    currencies: [...currencies].sort(),
  };
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
}

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

  // Both sides silent: no invoices marked paid and no payments recorded. There
  // is nothing to reconcile and nothing wrong; say so rather than manufacturing
  // a zero-against-zero agreement.
  if (derived == null && taken == null) return null;

  const r = reconcile(taken ?? 0, derived);
  const gapCents = r.delta;

  return { r, gapCents, note: gapNote(r, taken, fmt) };
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
  now: number = Date.now(),
): Blocker[] {
  const out: Blocker[] = [];

  for (const b of brokenCloseParts(rec)) {
    out.push({
      kind: 'read_failed',
      text: `Could not read ${b.label} — ${b.cost}. Nothing can be closed over a read that failed.`,
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

  if (income && income.currencies.length > 1) {
    out.push({
      kind: 'mixed_currency',
      text: `Payments in ${w.label} are recorded in ${income.currencies.join(' and ')}. They are not added together here, because that would not be a total.`,
    });
  }
  if (owed && owed.currencies.length > 1) {
    out.push({
      kind: 'mixed_currency',
      text: `Invoices in ${w.label} are issued in ${owed.currencies.join(' and ')}, so no single figure is offered for what is owed.`,
    });
  }

  return out;
}

export type CloseState = 'closeable' | 'blocked';

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
  passes: { cents: number | null; priced: number; sold: number } | null;
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
  const today = new Date(now).toISOString().slice(0, 10);

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
  const passes = passesInMonth
    ? (() => {
        const r = passRevenueCents(passesInMonth);
        return { cents: r.cents, priced: r.priced, sold: r.total };
      })()
    : null;

  const blockers = closeBlockers(rec, w, payroll, check, income, owed, now);

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
