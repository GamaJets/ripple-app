// What a gym has actually settled for a coach it employs — and the two things
// the coach could not see behind each figure.
//
// ── Why none of this was reachable ────────────────────────────────────────
//
// Three tables in this schema were written so the person being paid could read
// them, and the coach app had never selected any of the three:
//
//   `payroll_settlements`   `settlements_trainer_read` (part 36, rewritten in
//                           part 145) is `trainer_id = (select auth.uid())`.
//                           A run the gym closed, with the period it covered,
//                           the amount handed over and the currency it was in.
//   `payroll_adjustments`   `payroll_adjustments_self_r` (part 183). The bonus,
//                           the deduction, the reimbursement, the advance —
//                           each with the note the gym is REQUIRED to write on
//                           it, because "an adjustment with no reason on it is
//                           the line a coach queries and nobody can answer".
//   `gym_class_pay`         `gym_class_pay_self_r` (part 183). One line per
//                           class taught: the rate as it stood, the headcount
//                           the register said, and what that came to.
//
// `grep -rl payroll_settlements 'app/(trainer)'` returned nothing. The owner's
// console reads all three; `studio-web/app/payroll/page.tsx` settles the runs;
// `app/(owner)/class-analytics.tsx` breaks them down. The coach whose wages
// they are had `app/(trainer)/my-register.tsx` telling them, in their own
// words, "nothing here is money … this page stops there".
//
// So the permission existed, the columns existed, and the sentence a coach
// would have to ask their gym for was one this app could already have shown
// them. That is the whole item.
//
// ── THE HONEST ANSWER FOR A COACH WITH NO GYM ─────────────────────────────
//
// Seven coaches are live on this product and every one of them is alone in
// their own tenant. Nobody has run a pay cycle; every table above has zero
// rows. So the state this module is overwhelmingly most likely to be rendered
// in is "there is no gym", and getting THAT right matters more than every
// other branch put together.
//
// A settlement list that came back empty for a self-employed coach would read
// as "your gym has paid you nothing". `paidView` therefore answers 'no_gym'
// from the tenant link BEFORE it ever looks at the rows, and the screen states
// it in a sentence — `NO_GYM_SETTLEMENTS_NOTE` — rather than drawing an empty
// list and letting the absence speak. This is the same refusal
// src/lib/coachPayTerms.ts makes for the rate card and src/lib/currencySource.ts
// makes for the currency, and it is here for the same reason.
//
// ── AND FOR A READ THAT DID NOT LAND ──────────────────────────────────────
//
// 'partial' is its own answer and it is NOT 'ready'. A coach with more
// settlements than one PostgREST page returns (see src/lib/rowCap.ts) may be
// shown the rows that came back and may NOT be shown a total over them: a
// year's pay computed from an unknown fraction of the runs, rendered as a
// figure, is a number with nothing about it to doubt. `paidView` gives that
// case its own kind — 'prefix' — which carries rows and no pots, so the
// mistake is not available to the caller rather than merely discouraged.
//
// ── A REVERSED RUN IS A SECOND FACT, NOT AN ERASURE ───────────────────────
//
// Part 183 added `reversed_at` / `reversed_by` / `reverse_reason` under a CHECK
// that makes a reversal without a reason impossible, and says on the column:
// "The row is NEVER deleted — a settlement that was recorded and then withdrawn
// is two facts, and deleting it leaves neither."
//
// So a reversed run is LISTED, marked, and carries the gym's stated reason. It
// is kept out of every pot, because it is not money that went out, and the
// count of reversed runs is reported separately so its absence from the figures
// is stated rather than inferred. A coach who remembers being told about a
// payment and finds no trace of it has no way to raise it; a coach who sees it
// marked "taken back — <reason>" has the whole conversation in front of them.
//
// ── NEVER SUM TWO CURRENCIES, AND NEVER RECOMPUTE A SNAPSHOT ──────────────
//
// Part 36 snapshots `amount_cents` and `currency` on the settlement precisely
// so a later fee change cannot rewrite what was handed over. Nothing here
// recomputes a settlement from its lines. `lineTally` adds the lines up and the
// caller prints that BESIDE the snapshot, labelled as what the lines say — and
// `SNAPSHOT_IS_THE_RECORD` is the sentence under it. Where they disagree the
// snapshot is the payment and the lines are the working.
//
// Amounts in different currencies are never added. `paidPots` groups by
// currency and returns one pot per money, exactly as `sumTaken` in
// src/lib/coachMoney.ts does, and a caller with two pots prints two figures.
//
// Pure: no react, no supabase, no clock. The reads are in
// src/ui/coachSettlements.ts.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import type { GymLink } from './coachPayTerms';
import type { AdjustmentKind, ClassPayKind } from './gymPay';
import { dayLabel } from './coachStatement';

/** ' gbp ' and 'GBP' are one currency; '' is not a currency at all. The same
 *  normalisation `code` performs in src/lib/coachPayTerms.ts and
 *  src/lib/sumCurrency.ts, repeated rather than exported from one of them
 *  because both of those would drag their own module in behind it. */
const code = (c: string | null | undefined): string | null =>
  (c ?? '').trim().toUpperCase() || null;

/** A column PostgREST may hand back as a string, read as a number — and
 *  anything unparseable as null rather than as a figure beside a currency.
 *  Null is never zero here: a settlement whose amount could not be read is a
 *  payment of an unknown size, and calling it nought would report a coach as
 *  having been paid nothing for a period they worked. */
const cents = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ── the row, as the coach's own read returns it ───────────────────────────── */

/**
 * One closed payroll run, from `payroll_settlements`.
 *
 * Every field nullable and every one deliberately so. The database has most of
 * them NOT NULL — the shape here describes what a READ can hand back, which
 * includes a row from a build that did not select a column and a value that
 * does not parse. A type that promised `amountCents: number` would be asserting
 * something about somebody's wages that the read cannot guarantee.
 */
export interface Settlement {
  id: string;
  /** Bare `YYYY-MM-DD`. Compared as a STRING and never parsed: `Date.parse`
   *  resolves a bare date to UTC midnight, which is the day before for every
   *  reader west of Greenwich. See src/lib/localDate.ts. */
  periodFrom: string | null;
  periodTo: string | null;
  /** Minor units, snapshotted by the run. Never recomputed from today's rates. */
  amountCents: number | null;
  /** What that amount IS. Never the gym's current currency — part 36 keeps this
   *  column so a gym changing currency cannot re-denominate a past payment. */
  currency: string | null;
  sessionsCount: number | null;
  method: string | null;
  note: string | null;
  settledAt: string | null;
  /** Set means the run was taken back. The row stays; see the header. */
  reversedAt: string | null;
  /** Required by `payroll_settlements_reverse_has_why` whenever `reversedAt`
   *  is set, so a reversal the coach can see always says why. */
  reverseReason: string | null;
  /** How much of `amountCents` was money the coach spent and got back rather
   *  than pay (part 482). NULL means THE RUN DID NOT SAY — which is every
   *  settlement recorded before that column existed — and 0 means it said and
   *  none of it was. Reading the first as the second would report a historical
   *  run as wholly taxable pay, which is a claim about somebody's tax that
   *  nothing in this database supports. */
  reimbursementCents: number | null;
}

/** One `payroll_adjustments` row, as the coach reads it. `amountCents` is
 *  SIGNED by kind — negative for a deduction or an advance — and part 183's
 *  `payroll_adjustments_sign_matches_kind` is what makes a positive deduction
 *  unrecordable in the first place. */
export interface CoachAdjustment {
  id: string;
  kind: AdjustmentKind;
  amountCents: number | null;
  currency: string | null;
  /** NOT NULL and non-blank at the database. This is the line the coach reads
   *  when they want to know what a figure was for. */
  note: string | null;
  /** The date the adjustment belongs to, not the date it was typed. Bare. */
  appliesOn: string | null;
  settlementId: string | null;
}

/** One `gym_class_pay` line: a class taught, at the rate as it stood, for the
 *  headcount the register said. All three snapshotted by part 183. */
export interface CoachClassLine {
  id: string;
  payKind: ClassPayKind | null;
  rateCents: number | null;
  /** NULL on a per-class line because it did not enter into the amount. A zero
   *  is a real answer — an empty class — and the two are not the same. */
  attendees: number | null;
  amountCents: number | null;
  currency: string | null;
  settlementId: string | null;
}

/** One session the run paid for, from `sessions`. `rateCents` is null for an
 *  UNPRICED session, which `payrollTotal` in src/lib/gymSessions.ts already
 *  refuses to total rather than counting as nothing. */
export interface CoachSessionLine {
  id: string;
  startsAt: string | null;
  status: string | null;
  rateCents: number | null;
  currency: string | null;
  settlementId: string | null;
}

/* ── what the coach is shown ───────────────────────────────────────────────── */

/** One money's worth of settled runs. Two currencies are two pots and are
 *  never added: there is no rate in this app that converts one into the other,
 *  and a sum across them is not an amount of anything. */
export interface PaidPot { currency: string; minorUnits: number; count: number }

/**
 * What the "What You Have Been Paid" section says.
 *
 *  'no_gym'   there is no gym attached to this account. Nobody could have
 *             settled anything, and that is a SENTENCE rather than an empty
 *             list. Most coaches on this product are here.
 *  'unread'   the read failed or has not landed. Nothing is stated — not a
 *             count, not a total, and above all not "nothing".
 *  'prefix'   the read came back at the row ceiling. The runs that arrived may
 *             be listed; no figure over them may be. Deliberately carries no
 *             pots at all, so the caller cannot print one by mistake.
 *  'none'     the read landed, there is a gym, and it has settled nothing.
 *             A real and useful answer — and true for every gym today.
 *  'paid'     runs, grouped by the currency each one states.
 */
export type PaidView =
  | { kind: 'no_gym' }
  | { kind: 'unread' }
  | { kind: 'prefix'; rows: Settlement[] }
  | { kind: 'none' }
  | {
      kind: 'paid';
      /** Every run, reversed ones included, newest first as read. */
      rows: Settlement[];
      /** Live runs only, one per currency. */
      pots: PaidPot[];
      /** Runs taken back. In no pot, and counted so their absence is stated. */
      reversed: number;
      /** Runs whose amount or currency could not be read. In no pot either,
       *  and counted for exactly the same reason: a figure quietly short by
       *  one run looks precisely like a correct one. */
      undenominated: number;
    };

/** Whether this run was taken back. A blank string is not a reversal — the
 *  CHECK allows only NULL or a real timestamp, and treating whitespace as a
 *  date would strike a live payment off the coach's own record. */
export function isReversed(s: Settlement): boolean {
  return !!(s.reversedAt ?? '').trim();
}

/**
 * The view, from the gym link, the read and the rows.
 *
 * The order of these four tests is the entire safety argument and it is the
 * same order `rateCard` uses:
 *
 *   1. an unestablished gym or an unlanded read says NOTHING. 'unknown' is what
 *      a failed profile read looks like, and answering it with 'no_gym' would
 *      tell an employed coach on a bad connection that they do not work
 *      anywhere.
 *   2. no gym is then a stated fact.
 *   3. 'partial' is separated from 'ready' BEFORE anything is counted.
 *   4. only then is an empty list called empty.
 */
export function paidView(
  link: GymLink,
  status: LoadStatus,
  rows: readonly Settlement[],
): PaidView {
  // `isWhole` and never `!== 'error'`, in both places it is asked. 'partial' is
  // the ONE status other than 'ready' allowed past the first test, and it is
  // named here rather than left to fall through a gap in an enumeration — which
  // is how a prefix comes to be counted. It is caught by the third test two
  // lines down and given a kind that cannot hold a total.
  if (link === 'unknown') return { kind: 'unread' };
  if (!isWhole(status) && status !== 'partial') return { kind: 'unread' };
  if (link === 'none') return { kind: 'no_gym' };
  if (!isWhole(status)) return { kind: 'prefix', rows: [...rows] };
  if (!rows.length) return { kind: 'none' };

  const pots = new Map<string, PaidPot>();
  let reversed = 0;
  let undenominated = 0;
  for (const s of rows) {
    if (isReversed(s)) { reversed += 1; continue; }
    const cur = code(s.currency);
    const amount = cents(s.amountCents);
    // Both halves, and the `||` is deliberate. An amount with no currency
    // cannot be printed and a currency with no amount is not a figure; either
    // one alone would put a number on screen that says less than nothing.
    if (!cur || amount == null) { undenominated += 1; continue; }
    const pot = pots.get(cur) ?? { currency: cur, minorUnits: 0, count: 0 };
    pot.minorUnits += amount;
    pot.count += 1;
    pots.set(cur, pot);
  }
  return {
    kind: 'paid',
    rows: [...rows],
    pots: [...pots.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    reversed,
    undenominated,
  };
}

/**
 * What is said where the runs would be listed.
 *
 * Four sentences and never three. The one that has to be separate is 'none' vs
 * 'unread': telling an employed coach that their gym has settled nothing for
 * them, because a query was refused, is the single worst thing this section
 * could print — it is a statement about their employer's conduct made from a
 * timeout, and it is the sentence that stops them asking.
 */
export function settledEmptyLine(v: PaidView): string {
  switch (v.kind) {
    case 'no_gym': return NO_GYM_SETTLEMENTS_NOTE;
    case 'unread': return SETTLEMENTS_UNREAD_NOTE;
    case 'none':
      return 'Your gym has not closed a payroll run for you yet, so there is nothing here to show. '
        + 'Work you have done is not lost by being unsettled — it is waiting for the next run.';
    default: return '';
  }
}

/** The period one run covered, both ends, in the reader's own language.
 *  Returns null rather than a dash when either end is unreadable, so a caller
 *  interpolating it has to branch: a dash as the subject of a sentence reads as
 *  the screen having broken. See scripts/check-prose.mjs. */
export function periodLabel(s: Settlement): string | null {
  const from = dayLabel(s.periodFrom);
  const to = dayLabel(s.periodTo);
  if (from === '—' || to === '—') return null;
  return `${from} to ${to}`;
}

/* ── pay and reimbursement are not the same money ──────────────────────────── */

/**
 * The split of one run into pay and money handed back.
 *
 *  'unstated'   `reimbursement_cents` is NULL — the run did not say. Every
 *               settlement closed before part 482 is here, and there is no way
 *               to find out now. NOT a split of zero.
 *  'undenominated'  there is a split and no currency or no total to hold it.
 *  'stated'     the run said. `payCents` is the rest of the amount.
 *
 * `payCents` may be NEGATIVE, and that is a real run rather than a bug: part
 * 482 deliberately does not constrain the reimbursement against the total,
 * because a run whose deductions exceed its session pay leaves the
 * reimbursement larger than what was handed over. `splitNote` says so where it
 * happens rather than clamping it to zero, which would silently restate what
 * somebody was paid.
 */
export type RunSplit =
  | { kind: 'unstated' }
  | { kind: 'undenominated' }
  | { kind: 'stated'; payCents: number; reimbursementCents: number; currency: string };

export function runSplit(s: Settlement): RunSplit {
  const r = cents(s.reimbursementCents);
  // NULL is the run not saying. A negative is a value no constraint in this
  // schema can produce, so it is unreadable rather than a figure to subtract.
  if (r == null || r < 0) return { kind: 'unstated' };
  const total = cents(s.amountCents);
  const cur = code(s.currency);
  if (total == null || !cur) return { kind: 'undenominated' };
  return { kind: 'stated', payCents: total - r, reimbursementCents: r, currency: cur };
}

/**
 * The sentence under the split — which is the whole point of showing it.
 *
 * "14 sessions plus a £40 kit reimbursement" has to read as two things and not
 * one number, because one of them is taxable and the other is not.
 * `ADJUSTMENT_LABEL` in src/lib/gymPay.ts has said that since the kinds
 * existed, part 482 put the split on the settlement so it could not be lost,
 * and the coach could see neither.
 */
export function splitNote(v: RunSplit): string {
  if (v.kind === 'unstated') return SPLIT_NOT_STATED_NOTE;
  if (v.kind === 'undenominated') {
    return 'This run records a reimbursement and there is no readable total or currency to split, so '
      + 'the two halves are not shown. Both figures are on the run; neither can be written down here.';
  }
  if (v.reimbursementCents === 0) {
    return 'This run said what it was made of: none of it was a reimbursement, so all of it is pay.';
  }
  if (v.payCents < 0) {
    return 'The money handed back to you on this run is larger than the run itself, which happens when '
      + 'deductions came off the pay. The two figures are what the run recorded and the total above is '
      + 'what was actually handed over.';
  }
  return 'Two kinds of money, and they are deliberately not one figure: pay is pay, and a reimbursement '
    + 'is your gym giving back what you spent. Whoever files your payroll needs them apart.';
}

/* ── the lines behind a run ────────────────────────────────────────────────── */

/** The adjustments this run picked up. Ordered as read; the caller prints each
 *  with its own `ADJUSTMENT_LABEL` and its note, never a bare signed number. */
export function adjustmentsFor(id: string, rows: readonly CoachAdjustment[]): CoachAdjustment[] {
  return rows.filter((r) => r.settlementId === id);
}

/** The class-pay lines this run paid for. */
export function classLinesFor(id: string, rows: readonly CoachClassLine[]): CoachClassLine[] {
  return rows.filter((r) => r.settlementId === id);
}

/** The sessions this run paid for. */
export function sessionLinesFor(id: string, rows: readonly CoachSessionLine[]): CoachSessionLine[] {
  return rows.filter((r) => r.settlementId === id);
}

/**
 * What one class line was worth and how it got there, in one phrase — the
 * arithmetic the coach is checking against the register they took.
 *
 * A per-attendee line names the headcount BECAUSE that is the number they are
 * checking. A per-class line does not, and must not: `attendees` is NULL there
 * by construction (`gym_class_pay_attendees_shape`), and printing a zero would
 * read as the coach having taught to an empty room.
 */
export function classLineWorking(l: CoachClassLine, rate: string | null): string | null {
  if (!rate) return null;
  if (l.payKind === 'per_attendee') {
    if (l.attendees == null) return null;
    return `${rate} per person`;
  }
  if (l.payKind === 'per_class') return `${rate} for the class`;
  return null;
}

/**
 * What a set of lines adds up to, and in what.
 *
 * Null `cents` whenever the lines do not agree on one currency, which is the
 * same refusal `adjustmentsTotal` in src/lib/gymPay.ts makes and for the same
 * reason: the owner's console once rendered a euro reimbursement added to a
 * sterling bonus under the gym's own currency code. `currencies` comes back so
 * a caller can NAME the moneys it is refusing to add, which is what the house
 * rule asks for.
 *
 * `unpriced` is lines with no readable amount. They are counted and never
 * treated as nought — a tally quietly short by one line is indistinguishable
 * from a correct one.
 */
export interface LineTally {
  cents: number | null;
  currency: string | null;
  currencies: string[];
  count: number;
  unpriced: number;
}

export function lineTally(
  rows: readonly { amountCents: number | null; currency: string | null }[],
): LineTally {
  const currencies = [...new Set(rows.map((r) => code(r.currency)).filter((c): c is string => !!c))].sort();
  let sum = 0;
  let unpriced = 0;
  for (const r of rows) {
    const a = cents(r.amountCents);
    if (a == null || !code(r.currency)) { unpriced += 1; continue; }
    sum += a;
  }
  const one = currencies.length === 1 ? currencies[0] : null;
  // Three separate refusals, and each is a different fact. No lines: nothing
  // was computed. More than one currency: there is no single amount that
  // exists. A line that could not be priced: the sum is a floor, not a total,
  // and a floor printed as a total is the defect this whole file guards.
  if (!rows.length || !one || unpriced) {
    return { cents: null, currency: one, currencies, count: rows.length, unpriced };
  }
  return { cents: sum, currency: one, currencies, count: rows.length, unpriced };
}

/* ── the sentences ─────────────────────────────────────────────────────────── */

/**
 * Said where the settlement list would be, for a coach who works for
 * themselves — which is every coach on this product today.
 *
 * It names the absence rather than leaving an empty list to imply a gym that
 * has paid them nothing, and it does not send them looking for a screen or a
 * setting that nobody can reach. The second half matters as much as the first:
 * a coach with no gym is not missing a feature, they are simply not employed by
 * one, and their own money is on the rest of this screen.
 */
export const NO_GYM_SETTLEMENTS_NOTE =
  'There is no gym attached to this account, so there is no payroll to show you. Nothing has been '
  + 'settled for you because there is nobody to settle it — what you charge your own clients is the '
  + 'rest of this screen, and it is yours.';

/** Said when the read did not come back. Deliberately NOT "your gym has paid
 *  you nothing": that is a statement about somebody's employer made from a
 *  timeout, and it is the sentence that stops them asking. */
export const SETTLEMENTS_UNREAD_NOTE =
  'Your payroll could not be read, so nothing about it is shown here. This is not a statement that you '
  + 'have been paid nothing — whatever your gym has settled is unchanged and still on record.';

/** Said under a run whose `reimbursement_cents` is NULL. */
export const SPLIT_NOT_STATED_NOTE =
  'This run did not record how much of it was pay and how much was money you spent and got back, so '
  + 'Repple will not split it. That is not a claim that all of it was pay — runs closed before the app '
  + 'recorded the split simply do not say, and there is no way to work it out now.';

/** Said beside the lines, wherever they are drawn. */
export const SNAPSHOT_IS_THE_RECORD =
  'The amount at the top is what your gym recorded handing over, saved as it stood on the day. The '
  + 'lines underneath are what the app holds about how it was made up. If the two disagree, the amount '
  + 'is the payment and the lines are the working — take the difference to your gym rather than to the '
  + 'figures.';

/** Said above a reversed run. */
export const REVERSED_IS_NOT_DELETED =
  'A run your gym took back stays on this list, marked, with the reason they gave. It is left in no '
  + 'total on this screen because it is not money that went out, and it is not removed because a '
  + 'payment that was recorded and then withdrawn is two things that happened, not none.';

/** Said under the whole section. The gap it names is the one a coach would
 *  otherwise assume closed: this app knows what the GYM recorded, and knows
 *  nothing at all about whether it reached a bank. */
export const SETTLED_IS_NOT_RECEIVED =
  'This is what your gym recorded settling, not what arrived in your account. Repple does not move this '
  + 'money, is not told when it lands, and has no way to check either. Your payslip and your bank are '
  + 'the record of that.';
