// What actually landed in the coach's bank, as opposed to what a client was
// charged.
//
// ── The figure coaches argue with ──────────────────────────────────────────
//
// Every takings number in this app is GROSS. `STRIPE_AUTHORITY_NOTE` in
// coachLedger.ts has always said so: Stripe's processing fee, the platform's
// application fee and whether the money has cleared are facts that live at
// Stripe, and no webhook in this repo had ever been told any of them.
//
// That was honest and it was expensive. The gap between "AED 4,800 taken" and
// "AED 4,281 in my account" is the gap a coach fills with a suspicion about the
// platform, and there was nothing anywhere in the product that could answer it.
// Part 194 mirrors `payout.paid` and `payout.failed`, and this is what may be
// said about the rows that arrive.
//
// ── THE ONE THING A PAYOUT IS NOT ──────────────────────────────────────────
//
// It is not the net of a sale. A payout is a BALANCE reaching a bank — the
// residue of many charges, minus Stripe's fees, minus the platform's fees,
// minus any refunds, on Stripe's own schedule. A payout of AED 4,281 does not
// correspond to the AED 4,800 pack sold on Tuesday, and nothing in this app may
// draw a line between them: the temptation to show "sold 4,800 · received
// 4,281 · fees 519" is enormous and every one of those three numbers would be
// about a different set of transactions.
//
// So the two figures sit in different sections, are never subtracted from each
// other, and `PAYOUT_IS_NOT_A_SALE` says why on the page. This is the same
// discipline `NO_NET_NOTE` keeps for money in against money out, for the same
// reason: the moment a subtraction exists, somebody puts it in a hero.
//
// ── An empty list is not "you have been paid nothing" ──────────────────────
//
// It is very likely to mean the Connect webhook destination has not been
// subscribed to `payout.*` yet — part 194's deployment note is explicit that
// until it is, the branch is correct and never runs. A coach shown "nothing has
// been paid out" in that state would be told something false about their own
// bank account. `payoutsEmptyLine` says "nothing recorded here" and names the
// reason instead.
//
// Pure, framework-free and asserted against under plain `node`. The read is in
// src/ui/coachPayouts.ts.
import type { LoadStatus } from '../ui/loadStatus';
import { sumTaken, type Taken, type TakenRow } from './coachMoney';

/** One payout, as part 194 stores it. */
export interface CoachPayout {
  id: string;
  /** Minor units. Stripe's own figure. */
  amountCents: number | null;
  currency: string | null;
  /** Stripe's word, verbatim: 'paid', 'failed', 'pending', 'in_transit',
   *  'canceled', or something Stripe added after this was written. */
  status: string;
  /** `YYYY-MM-DD` Stripe expects it at the bank, or null. */
  arrivalOn: string | null;
  /** Why a failed payout failed, in Stripe's words. */
  failureMessage: string | null;
}

/* ── what a status means, without inventing one ───────────────────────────── */

/**
 * The four readings this app is willing to make of a Stripe payout status.
 *
 * 'unknown' is load-bearing and is where anything unrecognised goes. Stripe may
 * add a status tomorrow, and the coercion that would feel natural — treat
 * anything that is not obviously bad as arrived — is the one that tells a coach
 * money is in their bank when Stripe never said it was.
 */
export type PayoutState = 'arrived' | 'on-the-way' | 'failed' | 'unknown';

export function payoutState(status: string | null | undefined): PayoutState {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'paid') return 'arrived';
  if (s === 'pending' || s === 'in_transit') return 'on-the-way';
  if (s === 'failed' || s === 'canceled' || s === 'cancelled') return 'failed';
  return 'unknown';
}

/** The label for a row. Title Case: it heads a value rather than reading as
 *  prose. An unknown status says so rather than guessing. */
export function payoutStateLabel(status: string | null | undefined): string {
  const st = payoutState(status);
  if (st === 'arrived') return 'Arrived';
  if (st === 'on-the-way') return 'On The Way';
  if (st === 'failed') return 'Did Not Arrive';
  return 'Not Stated';
}

/**
 * What a failed payout means to the person waiting for the money.
 *
 * The most useful sentence this feature produces, and the reason
 * `failure_message` is stored at all: a payout that bounced because the bank
 * details are wrong is a coach who is not being paid and does not know it. The
 * message is STRIPE'S, quoted rather than paraphrased — this app does not know
 * what any particular failure means and would be guessing.
 */
export function payoutFailureLine(p: CoachPayout): string | null {
  if (payoutState(p.status) !== 'failed') return null;
  const why = String(p.failureMessage ?? '').trim();
  return why
    ? `This one did not reach your bank. Stripe’s reason: ${why}. Until it is fixed, money stays in your Stripe balance rather than arriving.`
    : 'This one did not reach your bank and Stripe did not say why. Until it is sorted out, money stays in your Stripe balance rather than arriving.';
}

/* ── what has actually arrived ────────────────────────────────────────────── */

export interface PayoutSummary {
  /** Payouts Stripe says ARRIVED, per currency. Null under anything but a whole
   *  read: a figure over the first page of somebody's banking is not a smaller
   *  number, it is a wrong one, and this is the number a coach reconciles
   *  against their actual bank statement. */
  arrived: Taken | null;
  /** How many are still on the way, or null when it could not be counted. */
  onTheWay: number | null;
  /** How many failed. The count a coach has to act on. */
  failed: number | null;
  /** How many carry a status this app does not recognise. Counted rather than
   *  swept into any of the three above. */
  unknown: number | null;
  /** Why there are no figures, or null when there are. */
  withheld: string | null;
}

/**
 * Payouts summed by what Stripe says happened to them.
 *
 * ONLY the arrived ones are added up. A payout in transit is not money in a
 * bank account, and a total that mixed the two would be exactly the figure a
 * coach plans a rent payment around and then does not have.
 *
 * Through `sumTaken` rather than a private loop, for its two rules: currencies
 * never merge, and an amount with no unit is counted rather than dropped.
 */
export function payoutSummary(rows: readonly CoachPayout[], status: LoadStatus): PayoutSummary {
  if (status !== 'ready') {
    return {
      arrived: null,
      onTheWay: null,
      failed: null,
      unknown: null,
      withheld: status === 'partial'
        ? 'More payouts are on record than could be read in one request, so no figure is stated. What is listed is real; it is not all of it.'
        : status === 'loading'
          ? 'Still reading what Stripe has paid out to you.'
          : 'What Stripe has paid out to you could not be read, so no figure is stated. This is not a statement that nothing has been paid out.',
    };
  }
  const arrivedRows: TakenRow[] = [];
  let onTheWay = 0;
  let failed = 0;
  let unknown = 0;
  for (const p of rows) {
    const st = payoutState(p.status);
    if (st === 'arrived') {
      arrivedRows.push({
        amount_cents: p.amountCents,
        currency: p.currency,
        // The day the money reached the bank, which is the date a coach
        // reconciles on. `''` where Stripe told us nothing, and that stand-in
        // is safe here for a reason worth stating rather than assuming:
        // `sumTaken` does not look at `created_at` at all, so an undated payout
        // is in this all-time figure exactly as it should be, and this function
        // never splits these rows by month, so there is no period for it to
        // fall silently out of.
        //
        // The month split for payouts is somewhere else entirely — src/lib/
        // coachStatement.ts passes `p.arrivalOn` straight to `splitByDay`,
        // which counts an unparseable day as `undated` and makes the statement
        // say so. Neither half quietly drops the row; both were checked, and
        // this note is here so the next person moving one does not have to
        // check again.
        created_at: p.arrivalOn ?? '',
      });
    } else if (st === 'on-the-way') onTheWay += 1;
    else if (st === 'failed') failed += 1;
    else unknown += 1;
  }
  return { arrived: sumTaken(arrivedRows), onTheWay, failed, unknown, withheld: null };
}

/* ── the sentences that keep this section honest ──────────────────────────── */

/**
 * That a payout is a balance and not a sale.
 *
 * On the screen, because the subtraction a reader would otherwise make in their
 * head — "taken 4,800, received 4,281, so the fees were 519" — is wrong on
 * every one of the three numbers. They cover different transactions over
 * different periods on Stripe's own schedule.
 */
export const PAYOUT_IS_NOT_A_SALE =
  'A payout is your Stripe balance reaching your bank, not the proceeds of one sale. It is many charges at once, less what Stripe and Repple took and anything refunded, on Stripe’s own schedule — so it does not line up with any figure above it and the two are deliberately never subtracted from each other.';

/**
 * That Stripe remains the record.
 *
 * This app now mirrors payouts and still holds no balance, no fee breakdown and
 * no bank details. What is here is what a webhook was told at the time.
 */
export const PAYOUT_STRIPE_IS_THE_RECORD =
  'These are mirrored from Stripe as each payout happens. Repple does not hold your balance, does not know what Stripe charged in fees, and cannot see your bank. Your Stripe dashboard is the record of what actually moved.';

/**
 * The sentence under an empty list, which depends entirely on the read AND on
 * whether the webhook is even subscribed.
 *
 * An empty list here is much more likely to mean "the Connect destination has
 * not been subscribed to payout events yet" than "Stripe has paid you nothing",
 * and a coach told the second about their own bank account would be told
 * something false. Part 194's deployment note is the other half of this.
 */
export function payoutsEmptyLine(status: LoadStatus): string {
  if (status === 'error') {
    return 'Your payouts could not be read, so nothing is listed. That is not a statement that Stripe has paid you nothing.';
  }
  if (status === 'partial') return 'There are more payouts on record than could be read in one request, so nothing here is a total.';
  if (status === 'loading') return 'Still reading.';
  return 'No payout has been recorded here yet. That is not the same as not having been paid: this app only learns about a payout when Stripe tells it about one, and if that has not been switched on at Stripe’s end nothing will appear here however much has reached your bank. Your Stripe dashboard is the record either way.';
}
