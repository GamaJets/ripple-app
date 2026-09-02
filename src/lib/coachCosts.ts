// What a coach's own business costs them.
//
// ── What was missing, and how big it is ────────────────────────────────────
//
// The outgoing half of the Money screen had two sources and its empty state
// listed both: "Your Repple plan and any ad spend you record show up here."
// That was the whole of it.
//
// For a self-employed coach the largest single line of the year is usually the
// gym rent or the chair fee, and this app held no trace of it. Nor of
// insurance, professional indemnity, CPD, equipment, kit, travel between
// clients, or the accountant who prepares the return the statement is meant to
// be handed to. So the statement was one-sided by construction — every penny
// in, no penny out — given to somebody whose whole job is the difference.
//
// This is the same shape as coachReceipts.ts (part 190: the coach recording
// money that moved outside the app) pointed the other way, and it is
// deliberately built from the same pieces so the two cannot drift: one typed
// amount reader, one summing function, one set of rules about currency.
//
// ── THE LINE THIS FILE MUST NOT CROSS ──────────────────────────────────────
//
// NOTHING HERE IS EVER SUBTRACTED FROM ANYTHING.
//
// `NO_NET_NOTE` in coachLedger.ts is a standing rule of this product, and this
// module is the single biggest temptation to break it: the moment money in and
// money out are both readable, somebody computes a profit and puts it in a
// hero. There is no `net`, no `profit`, no `margin` and no `balance` in this
// file, and there must never be one.
//
// The figure would be wrong for four independent reasons, any one of which is
// enough:
//
//   1. the takings are GROSS — Stripe's processing fee and the platform's
//      application fee are not in this database at all;
//   2. the cash half of the income is whatever the coach happened to write
//      down, and `RECEIPT_MAY_DOUBLE_COUNT` says it may double-count;
//   3. the costs half is whatever the coach happened to write down too, and
//      most of it will be missing in the first month of using this;
//   4. the two sides can be in different currencies — a coach paid in dirhams
//      may pay a UK insurer in sterling — and this app holds no rate.
//
// A number over those is not a smaller truth. It is a number about nothing,
// and it would be read as what the coach earned.
//
// ── What a cost claims, and what it does not ───────────────────────────────
//
// One thing: that this coach says they paid this amount, in this currency, for
// this, on this day. The coach's own word, exactly as a receipt is. Nothing has
// been checked against a bank, a card or a supplier's invoice.
//
// It is deliberately NOT a claim about tax. There is no deductibility flag and
// no VAT field, for the reason `INVOICE_TAX` gives in coachInvoice.ts: what is
// allowable turns on the coach's country, their trade and their accountant's
// judgement, and a "deductible" tick in this app would be tax advice printed
// under somebody's name. The categories below are the words a person uses to
// sort their own spending and nothing reads them as anything else.
//
// Pure, framework-free and asserted against under plain `node`. The reads and
// writes are in src/ui/coachCosts.ts.
import type { LoadStatus } from '../ui/loadStatus';
// One summing function for the whole app: currencies never merge, and an amount
// with no unit is counted rather than dropped.
import { sumTaken, type Taken, type TakenRow } from './coachMoney';
// The typed-amount reader the invoice sheet and the receipt sheet already use,
// rather than a third one. A coach typing "12.500" into two money fields in
// this app must not get two different amounts out, and it is the reader that
// knows a dinar has a thousand fils in it rather than a hundred.
import { draftAmount } from './coachInvoice';

/* ── what the money went on ───────────────────────────────────────────────── */

/**
 * What a cost was for.
 *
 * A closed set, for the reason `ReceiptMethod` is one: the category is the
 * field a coach might later total or filter by, and forty spellings of
 * "insurance" is a column nobody can group. 'other' is the escape hatch and the
 * description carries the detail.
 *
 * There is deliberately no 'advertising' and no 'platform'. Ad spend is already
 * recorded against a join code and the coach's own Repple plan is already read
 * from their billing, so both are on the Going Out side of the Money screen
 * already — a row here for either would count the same money twice, exactly as
 * a receipt written for a Stripe sale would on the way in. `COSTS_NOT_TWICE`
 * says so on the screen.
 */
export type CostCategory =
  | 'rent' | 'insurance' | 'education' | 'equipment'
  | 'kit' | 'travel' | 'professional' | 'other';

/**
 * The categories, in the order they are offered.
 *
 * Rent first because it is the largest line in most coaches' years and the one
 * this feature exists for. `note` is the plain-English gloss under the label,
 * so nobody has to guess whether a first-aid course is 'education' or 'other'.
 */
export const COST_CATEGORIES: ReadonlyArray<{ id: CostCategory; label: string; note: string }> = [
  { id: 'rent', label: 'Rent or Chair Fee', note: 'Gym rent, a chair fee, a share of a studio' },
  { id: 'insurance', label: 'Insurance', note: 'Public liability, professional indemnity, equipment cover' },
  { id: 'education', label: 'Courses and CPD', note: 'A qualification, a course, a workshop, a book' },
  { id: 'equipment', label: 'Equipment', note: 'Weights, bands, a bench, anything you train people with' },
  { id: 'kit', label: 'Kit', note: 'Clothing you train in, shoes, a bag' },
  { id: 'travel', label: 'Travel', note: 'Getting to clients — fuel, fares, parking' },
  { id: 'professional', label: 'Professional Fees', note: 'An accountant, a solicitor, a registration body' },
  { id: 'other', label: 'Something Else', note: 'Anything the seven above do not cover' },
];

/** The category's label, or the stored id where a newer build wrote one this
 *  one does not know. Never a blank and never "unknown": a cost whose category
 *  cannot be named is still money that left, and the amount beside it still
 *  stands. */
export function categoryLabel(id: string | null | undefined): string {
  const found = COST_CATEGORIES.find((c) => c.id === id);
  return found ? found.label : String(id ?? '').trim() || 'Not stated';
}

/* ── one cost ─────────────────────────────────────────────────────────────── */

export interface CoachCost {
  id: string;
  /** What it was for, in the coach's own words. */
  description: string;
  category: string;
  /** Minor units, matching every other money column in this app. */
  amountCents: number | null;
  /** ISO 4217, uppercase. Never null in practice — part 450 makes it NOT NULL
   *  because a figure with no currency on it is not an amount of money — but a
   *  null here prints a dash and is counted out of the total rather than being
   *  summed into a unit nobody stated. */
  currency: string | null;
  /** `YYYY-MM-DD`, the day the coach says the money went out. A DATE and not an
   *  instant: rent was paid on a day, and turning that into a timestamp would
   *  put a Monday payment on Sunday for every coach west of Greenwich. */
  paidOn: string;
  note: string | null;
  createdAt: string | null;
}

/* ── what the coach typed, before it is anything ──────────────────────────── */

export interface CostDraft {
  description: string;
  /** MAJOR units, as a person types them — "45.50". Converted once, by the same
   *  function the invoice and receipt sheets use. */
  amountText: string;
  currency: string | null;
  category: CostCategory;
  paidOn: string;
  note?: string | null;
}

/**
 * Every reason this cost cannot be recorded, in the coach's own words.
 *
 * A list rather than the first failure, the same discipline `invoiceBlockers`
 * and `receiptBlockers` keep: somebody who has left three fields empty should
 * be told all three at once rather than made to press the button three times.
 * An empty list means it can go.
 */
export function costBlockers(d: CostDraft): string[] {
  const out: string[] = [];
  if (!String(d.description ?? '').trim()) {
    out.push('Say what this was for. An amount with nothing beside it is a line you will not be able to place in eleven months, which is when you will be looking at it.');
  }

  // Currency before amount, because without one the amount cannot be
  // interpreted at all and "your gym has not set a currency" is a different
  // problem with a different fix.
  const cur = (d.currency || '').trim();
  if (!cur) {
    out.push('No currency has been set, so there is nothing to record this in. Repple is white-labelled and there is no default that is right for every gym — an owner sets it in the gym settings, or you set one on a package.');
  } else if (!/^[A-Za-z]{3}$/.test(cur)) {
    out.push('The currency on record is not a three-letter code, so no amount can be recorded in it.');
  } else {
    // The reader's own reason rather than a sentence written here, so a coach
    // in Kuwait is told that the last place must be a nought and a coach in
    // Japan is told a yen has no smaller unit.
    const read = draftAmount(d.amountText, cur);
    if (!read.ok) out.push(read.reason);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.paidOn ?? ''))) {
    out.push('The day you paid it could not be read.');
  }
  if (!COST_CATEGORIES.some((c) => c.id === d.category)) {
    out.push('Say what kind of cost this was.');
  }
  return out;
}

/* ── what they add up to ──────────────────────────────────────────────────── */

/**
 * Costs as a `Taken`, so the Money screen adds them the same way it adds
 * everything else.
 *
 * The type name is about the SHAPE, not the direction — one pot per currency,
 * unlabelled and unpriced rows counted rather than dropped — and reusing it is
 * what stops the outgoing side growing a second opinion about how to add money
 * up. It does NOT mean these are takings, and nothing that consumes this may
 * put it in the same total as one.
 *
 * The date passed as `created_at` is `paidOn` — the day the coach says the
 * money went out, never the day the row was written. A quarter of receipts
 * written up in one evening must not all land in that evening's month, and
 * `since()` and `splitByPeriod()` both read this field.
 */
export function costsTaken(rows: readonly CoachCost[]): Taken {
  return sumTaken(rows.map((c): TakenRow => ({
    amount_cents: c.amountCents,
    currency: c.currency,
    created_at: c.paidOn,
  })));
}

/**
 * The same rows split by what they were spent on, biggest first.
 *
 * Per category AND per currency, never one figure per category: a coach paying
 * rent in dirhams and insurance in sterling has two amounts of money and not a
 * sum. The rows that cannot be denominated are counted inside each category's
 * own `Taken`, exactly as they are in the total, so a category's lines and the
 * whole never disagree about what was left out.
 *
 * Categories with nothing in them are absent rather than present at zero. A
 * "Kit — 0.00" line is a statement that this coach spent nothing on kit, and
 * what it actually means is that they have not written any down.
 */
export interface CostCategoryPot { category: string; label: string; taken: Taken }

export function costsByCategory(rows: readonly CoachCost[]): CostCategoryPot[] {
  const by = new Map<string, CoachCost[]>();
  for (const c of rows) {
    const key = String(c.category ?? '').trim() || 'other';
    const list = by.get(key);
    if (list) list.push(c); else by.set(key, [c]);
  }
  const out: CostCategoryPot[] = [];
  for (const [category, list] of by) {
    out.push({ category, label: categoryLabel(category), taken: costsTaken(list) });
  }
  // By the biggest single pot in each category, then by label so the order is
  // stable when two categories have nothing comparable in them. Sorting on a
  // sum ACROSS currencies would be the addition this file exists to refuse, so
  // it is the largest pot that decides and not a total.
  const top = (p: CostCategoryPot) => p.taken.pots.reduce((m, x) => Math.max(m, x.minorUnits), 0);
  return out.sort((a, b) => (top(b) - top(a)) || a.label.localeCompare(b.label));
}

/* ── the sentences that keep the screen honest ────────────────────────────── */

/**
 * What a recorded cost is. Said on the screen, not only here.
 *
 * The coach's own word, in exactly the voice `RECEIPT_IS_YOUR_WORD` uses on the
 * way in. This app was not there, was not shown a receipt, and has not
 * reconciled anything.
 */
export const COST_IS_YOUR_WORD =
  'These are things you have told this app you paid for. Nothing here has been checked against a bank, a card or a supplier, and this app was not involved in any of them. They are your own record of money you say went out.';

/**
 * That nothing is subtracted, and why.
 *
 * The most important sentence this feature carries, and it goes on the screen
 * because the absence of a profit figure reads as an omission unless somebody
 * says it was a decision. A reader who is not told will do the subtraction in
 * their head, and every input to it is incomplete in a way only they can know.
 */
export const COSTS_ARE_NEVER_NETTED =
  'Nothing here is taken off what you were paid, and there is no profit figure anywhere in this app. What comes in is gross of Stripe’s fee and the platform’s, both sides are only as complete as what you have written down, and the two can be in different currencies. A single number over that would be about neither question. Your accountant does this subtraction with your full records; this is one of the things you hand them.';

/**
 * That this is not a tax record.
 *
 * The invoice refuses to state a tax rate for the same reason and says so on
 * its own face. A coach who sees a costs list will reasonably expect a
 * "deductible" tick next to each line, and the honest answer is that whether a
 * cost is allowable is their accountant's judgement about their trade in their
 * country, not a checkbox this app can offer.
 */
export const COSTS_ARE_NOT_TAX_ADVICE =
  'No cost here is marked as allowable or not allowable, and none of them has been treated as a deduction. Whether something can be set against your income depends on your country, your trade and your accountant’s judgement, and this app knows none of the three. This is a list of what you say you paid, for them to work from.';

/**
 * That two things already counted must not be written down again.
 *
 * The most likely way this feature produces a wrong figure. Ad spend already
 * sits against a join code and the coach's own Repple plan is already read from
 * their billing, so both are on the Going Out side before a coach types
 * anything — and a row for either would count the same money twice. It is the
 * same trap `RECEIPT_MAY_DOUBLE_COUNT` names on the way in, and the same
 * answer: nothing can detect it, so the screen says it.
 */
export const COSTS_NOT_TWICE =
  'Leave out your Repple plan and your ad spend. Both are already counted under what is going out — your plan from your own billing, your ad spend from what you record against a join code — and writing either down here would count it twice. Nothing can tell that two rows are the same money.';

/**
 * The sentence under an empty list, which depends entirely on the read.
 *
 * A confident "you have recorded nothing" over a failed read is the same defect
 * this codebase exists to prevent, and here it would tell a coach their rent is
 * not on record when the truth is that the query was refused.
 */
export function costsEmptyLine(status: LoadStatus): string {
  if (status === 'error') {
    return 'Your recorded costs could not be read, so nothing is listed. That is not a statement that you have recorded none, and anything already recorded still stands.';
  }
  if (status === 'partial') {
    return 'There are more recorded costs than could be read in one request, so nothing here is a total.';
  }
  if (status === 'loading') return 'Still reading.';
  return 'You have not recorded anything your business costs you. Rent or a chair fee, insurance, courses, equipment, kit, travel and your accountant never reach this app on their own, so until you write them down the outgoing side of your Money screen is your Repple plan and your ad spend and nothing else.';
}
