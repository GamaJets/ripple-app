// What a coach may be told about the invoices Repple has sent THEM.
//
// ── The gap this closes ───────────────────────────────────────────────────
//
// app/(trainer)/billing.tsx is headed "Billing" and its own subtitle says
// "Your Repple plan, payment method and invoices." It showed the plan, it
// handed off to Stripe for the payment method, and it showed no invoice of any
// kind — not a paid one, not an unpaid one, not a receipt to hand an
// accountant. The only place in the app that touched this ledger was
// app/(trainer)/money.tsx, which lists what is OUTSTANDING (`fetchFailedInvoices`
// reads `status in ('open','uncollectible')`) and sends the coach here for the
// rest. Here was nothing.
//
// Every coach-business app the trainers in this project compare Repple to —
// TrueCoach, Trainerize, Everfit, PT Distinction — puts the billing history on
// the billing page: a date, an amount, whether it was paid, and a link to the
// receipt. It is the page somebody opens in January with an accountant on the
// phone. The rows already exist (`invoices`, supabase/parts/20), the coach is
// already allowed to read their own (`inv_read`: `trainer_id = auth.uid()`,
// supabase/parts/106), and there is already a currency-correct formatter for
// the amount (`money` in src/lib/billing.ts). Nothing new is needed anywhere.
//
// ── Why the wording lives here and not in the screen ──────────────────────
//
// Because three of the four things this list says are the kind of claim this
// repo keeps having to take back:
//
//   · "Nothing has been billed to you yet" said over a read that failed.
//   · A count of invoices stated over a read that stopped at its cap.
//   · A TOTAL. There is no total here and there will not be one: `currency` is
//     per row, Repple is white-labelled, and two currencies do not add up.
//     src/lib/coachMoney.ts holds that rule for the coach's own book and this
//     is the same rule pointed at Repple's.
//
// A screen can be edited into saying any of the three. A file with a test
// beside it is harder to.
import type { LoadStatus } from '../ui/loadStatus';

/** The columns of `invoices` this module has an opinion about. The row shape
 *  itself is `Invoice` in src/lib/billing.ts, which is where the read lives. */
export interface PlanInvoice {
  id: string;
  amount_due: number | null;
  currency: string | null;
  status: string | null;
  attempt_count: number | null;
  hosted_invoice_url: string | null;
  created_at: string;
}

/**
 * What the section may draw.
 *
 * 'unread' and 'none' are the two that must never be confused: a coach told
 * "nothing has been billed to you" by a failed read has been told their account
 * is clear, and the whole reason money.tsx carries its own version of this
 * sentence is that a clear-looking account is what stops somebody looking.
 */
export type InvoiceListState = 'loading' | 'unread' | 'none' | 'some' | 'some-partial';

export function invoiceListState(rows: PlanInvoice[] | null, status: LoadStatus): InvoiceListState {
  if (status === 'loading') return 'loading';
  // Null rows is UNKNOWN whatever the status says, and 'error' is UNKNOWN
  // whatever the rows say. Either one alone is enough.
  if (status === 'error' || rows === null) return 'unread';
  if (rows.length === 0) {
    // A truncated read that came back with nothing is not a completed read of
    // an empty ledger; it is a ceiling reached at zero, which is a failure of
    // the read rather than a fact about the account.
    return status === 'partial' ? 'unread' : 'none';
  }
  return status === 'partial' ? 'some-partial' : 'some';
}

/** The sentence above the list, or null when the rows speak for themselves. */
export function invoiceListNote(state: InvoiceListState): string | null {
  switch (state) {
    case 'loading':
      return 'Reading your invoices.';
    case 'unread':
      return 'Your invoices could not be read just now. An empty space here is not a clear account. Nothing has '
        + 'been paid or unpaid by this screen failing to load.';
    case 'none':
      return 'Nothing has been billed to you yet. Each time your plan renews, Stripe raises an invoice and it appears here.';
    case 'some-partial':
      // Never a count. The rows shown are real; how many there are is not a
      // thing this read can say, and an accountant working from a short list
      // is the reason it says so out loud.
      return 'These are the most recent. There are more than fitted in one read, so this is not your whole history.';
    case 'some':
      return null;
  }
}

/**
 * Whether an invoice was paid, in words, and never as a guess.
 *
 * Stripe's `status` is one of draft / open / paid / uncollectible / void, and
 * the column is nullable in supabase/parts/20 — a row written before the
 * webhook filled it in has none. That row is NOT "unpaid": it is a row whose
 * state we have not been told, and the difference matters to somebody deciding
 * whether to ring their bank.
 */
export function invoiceStatusLine(inv: Pick<PlanInvoice, 'status' | 'attempt_count'>): string {
  const s = (inv.status ?? '').trim().toLowerCase();
  if (!s) return 'Whether this was paid was not recorded';
  if (s === 'paid') return 'Paid';
  if (s === 'void') return 'Cancelled by Stripe. Nothing is owed on it';
  if (s === 'draft') return 'Not issued yet';
  if (s === 'uncollectible') return 'Written off as uncollectible. This one did not go through';
  if (s === 'open') {
    // `attempt_count` is nullable too, and `?? 0` on it would print "no
    // attempts" for a card Stripe has tried four times. Absent is absent.
    const n = inv.attempt_count;
    if (typeof n === 'number' && Number.isFinite(n) && n > 1) {
      return `Not paid. Your card has been tried ${n} times`;
    }
    return 'Not paid yet';
  }
  // A status Stripe added after this was written. Printed as it stands rather
  // than rounded to the nearest one we know.
  return `Stripe calls this “${inv.status}”`;
}

/** True when the row is one the coach has to do something about. */
export function invoiceNeedsMark(inv: Pick<PlanInvoice, 'status'>): boolean {
  const s = (inv.status ?? '').trim().toLowerCase();
  return s === 'open' || s === 'uncollectible';
}

/**
 * Said once, under the list.
 *
 * The two things a reader of this list would otherwise assume: that the
 * amounts can be added up, and that Repple is the authority on them. Neither is
 * true. Stripe is the ledger; this is a copy of it kept by a webhook.
 */
export const INVOICES_ARE_NOT_TOTALLED =
  'Each amount is in the currency Stripe billed it in, and they are not added up here. Two currencies do not '
  + 'make a total. Stripe’s own copy is the one to give an accountant; open an invoice to get it.';

/** Whether a row can be opened at all. A Stripe-hosted page needs a url, and a
 *  row whose webhook never carried one is a dead tap rather than a receipt. */
export function invoiceOpenable(inv: Pick<PlanInvoice, 'hosted_invoice_url'>): boolean {
  const u = (inv.hosted_invoice_url ?? '').trim();
  return u.startsWith('https://');
}
