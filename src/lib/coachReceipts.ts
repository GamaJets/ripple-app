// The half of a coach's income this app has never been able to see.
//
// ── What was missing, and how big it is ────────────────────────────────────
//
// Money in was read from two tables and only two: `client_purchases` and
// `client_subscription_payments`. Both are written by the stripe-webhook, so
// both are money that moved through Stripe. Cash, a bank transfer, and anything
// taken at a gym's front desk were permanently invisible.
//
// For most self-employed coaches card is the MINORITY of income. So the Money
// screen was not slightly short: it understated the business, said so in its
// own "What Is Not Here" section, and a coach who reads a figure that is a
// third of what they know they earned stops opening the screen. Every honest
// caveat in coachLedger.ts and coachStatement.ts about this — and there are
// four of them — was a caveat about a hole that could simply be filled.
//
// ── THE LINE THIS FILE MUST NOT CROSS ──────────────────────────────────────
//
// This is the coach recording WHAT A CLIENT PAID THEM. It is not, and must
// never become, the coach recording THEIR OWN PAY.
//
// The next person to read this will assume the rule that governs
// studio-web/app/coach/earnings applies here, because it is the same word —
// "earnings" — about the same person. It does not apply. That rule is about a
// GYM PAYING AN EMPLOYED TRAINER: a payroll figure a coach must not be able to
// author, because the party that owes it is the gym and a self-authored figure
// is a self-authored invoice to their employer. Everything on that side of the
// product is read-only for exactly that reason.
//
// A receipt here is the opposite direction. The money has already moved, from a
// client to this coach, outside this app entirely; the coach is a self-employed
// person writing down a payment they have already been handed. Nobody owes
// anything as a result of writing it, no payroll run reads it, no gym is
// invoiced by it, and it is visible to nobody but the coach who wrote it.
//
// The two guards that keep it on this side of the line:
//
//   1. `receiptBlockers` refuses a receipt whose payer is the coach themselves.
//      A coach cannot be their own client, and a row saying "I paid me" is the
//      shape a payroll claim would have to take.
//   2. Part 190 grants INSERT with `coach_id = auth.uid()` and nothing that
//      would let one coach write a row against another, or against a gym.
//
// ── What a receipt claims, and what it does not ────────────────────────────
//
// It claims exactly one thing: that this coach says they received this amount,
// in this currency, from this person, on this day, by this method. That is the
// coach's own word, exactly as `InvoiceKind = 'received'` is, and every screen
// that shows it says so. It is NOT reconciled against a bank, it is not proof
// that money moved, and it is never mixed into the Stripe figures — a receipt
// and a `client_purchases` row can describe the same money, and adding them
// would count a payment twice.
//
// Pure, framework-free and asserted against under plain `node`. The reads and
// writes are in src/ui/coachReceipts.ts.
import type { LoadStatus } from '../ui/loadStatus';
// One money formatter for the whole app. It refuses to print an amount whose
// currency it was not told, and it knows which currencies have no minor unit.
import { sumTaken, type Taken, type TakenRow } from './coachMoney';
// The typed-amount reader the invoice sheet already uses, rather than a second
// one. A coach typing "45,50" into two different money fields in this app must
// not get two different amounts out, and getting the zero-decimal rule wrong
// charges somebody a hundred times too much.
import { draftMinorUnits } from './coachInvoice';

/* ── how the money arrived ────────────────────────────────────────────────── */

/**
 * How a payment reached the coach.
 *
 * Four values, and none of them is 'card'. A card payment that went through
 * Repple is already in `client_purchases` and recording it here would count it
 * twice; a card payment taken on the coach's own terminal or at a gym's front
 * desk did not go through Repple at all and is `card_at_gym`. The distinction
 * is the whole reason the label says where the card was taken rather than that
 * a card was used.
 *
 * A string union rather than free text, because the method is the one field a
 * coach might later filter or total by, and forty spellings of "bank transfer"
 * is a column nobody can group.
 */
export type ReceiptMethod = 'cash' | 'transfer' | 'card_at_gym' | 'other';

export const RECEIPT_METHODS: ReadonlyArray<{ id: ReceiptMethod; label: string; note: string }> = [
  { id: 'cash', label: 'Cash', note: 'Handed to you' },
  { id: 'transfer', label: 'Bank Transfer', note: 'Straight into your account' },
  { id: 'card_at_gym', label: 'Card Elsewhere', note: 'A terminal or a front desk, not through this app' },
  { id: 'other', label: 'Something Else', note: 'Anything the three above do not cover' },
];

/** The method's label, or the stored id where a newer build wrote one this one
 *  does not know. Never a blank and never "unknown": a receipt whose method
 *  cannot be named is still a real payment and the amount beside it still
 *  stands. */
export function methodLabel(id: string | null | undefined): string {
  const found = RECEIPT_METHODS.find((m) => m.id === id);
  return found ? found.label : String(id ?? '').trim() || 'Not stated';
}

/* ── one receipt ──────────────────────────────────────────────────────────── */

export interface CoachReceipt {
  id: string;
  /** The client's account, where they have one. Null for somebody the coach
   *  bills by hand, which is most of the people who pay in cash. */
  clientId: string | null;
  /** The name the coach typed, snapshotted. Deliberately a copy and not a join,
   *  for the reason part 138 gives about `bill_to`: a person who changes their
   *  name later has not changed who paid this. */
  paidBy: string;
  /** Minor units, matching every other money column in this app. */
  amountCents: number | null;
  /** ISO 4217, uppercase. Never null in practice — part 190 makes it NOT NULL
   *  because a figure with no currency on it is not an amount of money — but a
   *  null here prints a dash and is counted out of the total rather than being
   *  summed into a unit nobody stated. */
  currency: string | null;
  method: string;
  /** `YYYY-MM-DD`, the day the coach says the money arrived. A DATE and not an
   *  instant: cash was handed over on a day, in the place both people were
   *  standing, and turning that into a timestamp would put a Monday payment on
   *  Sunday for every coach west of Greenwich. */
  receivedOn: string;
  note: string | null;
  createdAt: string | null;
}

/* ── what the coach typed, before it is anything ──────────────────────────── */

export interface ReceiptDraft {
  paidBy: string;
  /** MAJOR units, as a person types them — "45.50". Converted once, by the same
   *  function the invoice sheet uses. */
  amountText: string;
  currency: string | null;
  method: ReceiptMethod;
  receivedOn: string;
  note?: string | null;
  /** The client's account id where this is one of the coach's own clients. */
  clientId?: string | null;
  /**
   * The signed-in coach's own id, for the one refusal below. Passed in rather
   * than read from a session inside this module, because this file is pure and
   * runs under plain node — and because a guard that depends on a global is a
   * guard that silently stops guarding in a test.
   */
  coachId?: string | null;
}

/**
 * Every reason this receipt cannot be recorded, in the coach's own words.
 *
 * A list rather than the first failure, the same discipline `invoiceBlockers`
 * keeps: somebody who has left three fields empty should be told all three at
 * once rather than made to press the button three times. An empty list means it
 * can go.
 */
export function receiptBlockers(d: ReceiptDraft): string[] {
  const out: string[] = [];
  if (!String(d.paidBy ?? '').trim()) {
    out.push('Say who paid you. This is your own record of a payment, so it needs a name on it to be worth anything later.');
  }

  // THE guard that keeps this feature on the right side of the line in the
  // header. A coach is not their own client and cannot pay themselves; a row
  // that said so would be the coach authoring a figure about what they are owed
  // rather than recording money a client has already handed them, which is the
  // one thing this app refuses to let a coach do anywhere.
  const me = String(d.coachId ?? '').trim();
  if (me && String(d.clientId ?? '').trim() === me) {
    out.push('You cannot record a payment from yourself. This is for money a client has paid you, not for your own pay — nothing in this app lets you write down what you are owed by anybody.');
  }

  // Currency before amount, because without one the amount cannot be
  // interpreted at all and "your gym has not set a currency" is a different
  // problem with a different fix.
  const cur = (d.currency || '').trim();
  if (!cur) {
    out.push('No currency has been set, so there is nothing to record this in. Repple is white-labelled and there is no default that is right for every gym — an owner sets it in the gym settings, or you set one on a package.');
  } else if (!/^[A-Za-z]{3}$/.test(cur)) {
    out.push('The currency on record is not a three-letter code, so no amount can be recorded in it.');
  } else if (draftMinorUnits(d.amountText, cur) === null) {
    out.push('Enter the amount as a number greater than zero. A payment of nothing is not a payment, and an amount that cannot be read is refused rather than rounded to one that can.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.receivedOn ?? ''))) {
    out.push('The day you were paid could not be read.');
  }
  if (!RECEIPT_METHODS.some((m) => m.id === d.method)) {
    out.push('Say how the money reached you.');
  }
  return out;
}

/* ── what they add up to ──────────────────────────────────────────────────── */

/**
 * Receipts as a `Taken`, so the Money screen adds them the same way it adds
 * everything else.
 *
 * Through `sumTaken` rather than a private loop, for its two rules: currencies
 * never merge, and an amount with no unit is counted rather than dropped. A
 * coach who takes cash from a visitor in sterling must not be shown one figure
 * covering both that and their dirham book.
 *
 * The date passed as `created_at` is `receivedOn` — the day the coach says the
 * money arrived, never the day the row was written. A coach catching up on
 * three weeks of cash on a Sunday evening must not have all of it land in that
 * Sunday's month, and `since()` and `splitByPeriod()` both read this field.
 */
export function receiptsTaken(rows: readonly CoachReceipt[]): Taken {
  return sumTaken(rows.map((r): TakenRow => ({
    amount_cents: r.amountCents,
    currency: r.currency,
    created_at: r.receivedOn,
  })));
}

/* ── the sentences that keep the screen honest ────────────────────────────── */

/**
 * What a receipt is. Said on the screen, not only here.
 *
 * The coach's own word, in exactly the voice `kindLine` uses on an invoice.
 * This app was not there, was not told by a bank, and has not reconciled
 * anything.
 */
export const RECEIPT_IS_YOUR_WORD =
  'These are payments you have told this app about. Nothing here has been checked against a bank, a card processor or anybody else, and this app was not involved in any of them. They are your own record of money you say you were handed.';

/**
 * That a receipt is not a payroll claim.
 *
 * On the screen because the word "earnings" means two opposite things in this
 * product, and a coach who has seen the read-only earnings screen on the gym
 * side will reasonably wonder why this one lets them type. The answer is the
 * direction the money moved, and it is worth one sentence.
 */
export const RECEIPT_IS_NOT_PAY =
  'This is for money a client has already paid you. It is not a record of pay you are owed by a gym and nothing here is read by anybody who pays you — where a gym employs you, what they owe you is theirs to state and you cannot write it down yourself.';

/**
 * That a receipt and a Stripe sale can be the same money.
 *
 * The most likely way this feature produces a wrong figure: a coach records the
 * cash deposit for a pack whose balance Stripe also took, and the Money screen
 * counts it twice. Nothing can detect that — the two rows share no key and this
 * app is told nothing about either payment — so the screen says it rather than
 * pretending to.
 */
export const RECEIPT_MAY_DOUBLE_COUNT =
  'Record only what did NOT go through this app. A payment Stripe took is already counted under sales and renewals, and a receipt written for the same money would count it twice — nothing can tell that the two are the same payment, because they share nothing this app can read.';

/**
 * That the client has not been told.
 *
 * A receipt is the coach's own ledger line and there is no client screen for
 * it, deliberately: the artefact for telling somebody you have their money is
 * an INVOICE marked received, which is numbered, printable and already built.
 * A coach who wants the client to have a record is pointed at that.
 */
export const RECEIPT_IS_NOT_A_DOCUMENT =
  'Nobody but you can see these and nobody is notified about one. If the person who paid you needs something for it, issue an invoice marked as received — that is a numbered document you can send them, and it says on its own face what it is.';

/**
 * The sentence under an empty list, which depends entirely on the read.
 *
 * A confident "you have recorded nothing" over a failed read is the same defect
 * this codebase exists to prevent, on the one screen where the whole point is
 * that a figure was too small.
 */
export function receiptsEmptyLine(status: LoadStatus): string {
  if (status === 'error') {
    return 'Your recorded payments could not be read, so nothing is listed. That is not a statement that you have recorded none, and anything already recorded still stands.';
  }
  if (status === 'partial') {
    return 'There are more recorded payments than could be read in one request, so nothing here is a total.';
  }
  if (status === 'loading') return 'Still reading.';
  return 'You have not recorded any payments taken outside this app. Cash, bank transfers and anything taken at a gym’s front desk never reach Repple on their own, so until you record them the figures above are a floor rather than what you earn.';
}
