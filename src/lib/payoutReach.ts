// Whether the money a coach takes will actually reach them — which is a
// different question from whether they can take it.
//
// ── The defect this closes ────────────────────────────────────────────────
//
// `payoutStage` in src/lib/payoutAccount.ts answers 'active' off
// `charges_enabled`, and app/(trainer)/payments.tsx draws that as a tick, the
// words "Payouts active", and the sentence "You can accept client payments."
// The tick and the second sentence are about CHARGES. The heading is about
// payouts, and nothing on that screen had ever read a payout column.
//
// supabase/parts/161 added the two that answer it, and the tokens
// `payouts_enabled` and `transfers_status` appeared nowhere in the coach app —
// not in `app/(trainer)/**` and not in `src/`. `fetchMyConnect` selects `*`, so
// both values were being fetched, handed to the screen, and dropped on the
// floor by a type that did not name them.
//
// Those are not the same fact. Stripe enables charges on an account well before
// it enables payouts: an account can be taking a client's card all week with
// `payouts_enabled: false`, because identity or bank details are still
// outstanding. The coach reads "Payouts active", waits for money that is sitting
// in a Stripe balance, and has nothing anywhere telling them what to finish.
//
// ── Two hops, two answers, and they are kept apart ────────────────────────
//
// `payouts_enabled` is the hop from the connected account to the coach's bank.
// `transfers_status` is the capability that lets Repple move a destination
// charge ONTO that account in the first place. A coach can have either without
// the other, the remedies are different, and collapsing them into one green or
// red light is how a screen comes to tell somebody to re-do onboarding they
// have already finished. So they are two functions with two sentences.
//
// ── Null is not false, here more than anywhere ────────────────────────────
//
// Part 161 says it on the columns themselves: "null means 'not recorded yet'
// rather than 'not active' — the `account.updated` webhook fills these in". A
// null read as false tells every coach whose webhook has not fired that Stripe
// will not pay them, which is a false alarm about somebody's wages; a null read
// as true is the bug above, restated. It is its own answer and it says so.
//
// Pure: no react, no supabase, no clock.

/**
 * The two capability fields this module reads off a `connect_accounts` row.
 *
 * Structural and both optional, for the reason `PayoutAccount` in
 * src/lib/payoutAccount.ts gives: `ConnectStatus` lives in src/lib/connect.ts,
 * which reaches Supabase, and the test for this file runs under plain node.
 * Optional rather than required because a row read by an older build, or by a
 * database where part 161 has not been applied, carries neither — and that is
 * 'unrecorded', which is exactly what an absent property must resolve to.
 */
export interface PayoutCapability {
  payouts_enabled?: boolean | null;
  transfers_status?: string | null;
}

/**
 * Whether Stripe will pay this account out.
 *
 *  'reaching'    Stripe says payouts are enabled. Money reaches their bank.
 *  'held'        Stripe says they are not. Charges may still be landing; the
 *                balance stays with Stripe until something outstanding is done.
 *  'unrecorded'  nobody has asked Stripe, or the webhook has not filled it in.
 *                NOT a No, and nothing green may be drawn on it either.
 */
export type PayoutReach = 'reaching' | 'held' | 'unrecorded';

export function payoutReach(acct: PayoutCapability | null | undefined): PayoutReach {
  const v = acct?.payouts_enabled;
  if (v === true) return 'reaching';
  if (v === false) return 'held';
  return 'unrecorded';
}

/**
 * Whether Repple can move a destination charge onto the account at all.
 *
 * Stripe's capability vocabulary is 'active', 'pending', 'inactive' and
 * 'unrequested'. Only the first is a yes. The rest are folded into 'not_active'
 * rather than each getting a verdict, because the coach's position is identical
 * under all three and the raw word is carried to the screen separately — the
 * one place it is worth printing is beside Stripe's own name for it, so a coach
 * reading their Stripe dashboard sees the same string this app does.
 */
export type TransferState = 'active' | 'not_active' | 'unrecorded';

export function transferState(acct: PayoutCapability | null | undefined): TransferState {
  const raw = (acct?.transfers_status ?? '').trim().toLowerCase();
  if (!raw) return 'unrecorded';
  return raw === 'active' ? 'active' : 'not_active';
}

/**
 * The heading over a coach's payout state, for an account whose CHARGES are
 * already enabled.
 *
 * "Payouts active" is reserved for the one state in which that sentence is
 * true. The held heading names both halves in the order the coach experiences
 * them, because the first half is genuinely good news and burying it would send
 * somebody to re-onboard an account that is taking money perfectly well.
 */
export function payoutHeading(r: PayoutReach): string {
  switch (r) {
    case 'reaching': return 'Payouts active';
    case 'held': return 'Card payments yes, payouts not yet';
    case 'unrecorded': return 'Card payments active';
  }
}

/** What sits under that heading. */
export function payoutNote(r: PayoutReach): string {
  switch (r) {
    case 'reaching':
      return 'You can accept client payments, and Stripe is paying your balance out to your bank.';
    case 'held':
      return 'You can accept client payments and Stripe is holding the balance rather than paying it out. '
        + 'Nothing is lost and nothing has failed. Stripe has something outstanding on this account, '
        + 'usually identity or bank details, and it lists what in your Stripe onboarding. Payouts start '
        + 'from the moment it is satisfied, including for money already taken.';
    case 'unrecorded':
      return 'You can accept client payments. Whether Stripe is paying your balance out to your bank has '
        + 'not been recorded here, so it is not being claimed either way. This is a fact we have not '
        + 'received from Stripe, not a No. Your own Stripe dashboard is the answer while it is missing.';
  }
}

/**
 * The transfers sentence, or null when there is nothing to add.
 *
 * Null in both of the states that are not a problem to report: 'active' is the
 * working case, and 'unrecorded' is already covered by whatever `payoutNote`
 * said about what is and is not on the record — a second paragraph of the same
 * hedge reads as two separate faults.
 *
 * `raw` is the stored string, quoted back rather than translated. Stripe's own
 * word is what the coach will see in their dashboard and what support will ask
 * them for, and this app inventing a synonym for 'pending' helps nobody.
 */
export function transferNote(t: TransferState, raw: string | null | undefined): string | null {
  if (t !== 'not_active') return null;
  const word = (raw ?? '').trim();
  return `Stripe has not activated transfers on your account${word ? `. It reports them as “${word}”` : ''}. `
    + 'Where Repple passes a client payment on to you rather than your account taking it directly, that '
    + 'hop is the one this blocks. It is finished in the same Stripe onboarding.';
}

/** Whether the payout state is one a screen may draw as settled. The two that
 *  are not are not equally bad, and neither is a tick. */
export const payoutsSettled = (r: PayoutReach): boolean => r === 'reaching';
