// Whether the coach can be paid, and whether we actually know.
//
// ── The bug ────────────────────────────────────────────────────────────────
//
// `fetchMyConnect` (src/lib/connect.ts) is careful about this and says so in
// its own comment: a refused read used to fall through to the same default a
// coach with no account gets, so it now answers `null` for "could not read" and
// a zeroed row for "read, and there is no account". The comment ends "the
// caller renders that differently."
//
// Neither caller did.
//
//   app/(trainer)/payments.tsx — `const active = conn?.charges_enabled;` and
//   then `{!active ? <Notice title="Set Up Payouts"> … <Cta label="Set Up
//   Payouts" onPress={onboard} />`. A coach in a lift, whose account is live
//   and taking money, is told they have no payout account and handed a button
//   that starts onboarding a SECOND one.
//
//   app/(trainer)/money.tsx — branched 'error' correctly and not 'loading', so
//   for the length of the read the screen printed "You have no Stripe payout
//   account, so nothing can be taken through Repple."
//
// Both are the house rule: loading, failed and empty are three different
// sentences, and a failed read is never drawn as an empty result. This module
// is where the three get separated, once, so the two screens cannot drift apart
// again — and so the state that must never render an onboarding button is a
// named value rather than a `!` in JSX.
//
// ── Why null is 'unreadable' and never 'none' ──────────────────────────────
//
// `payoutStage(null, 'ready')` is a contradiction — the read succeeded and
// produced nothing, when success produces at minimum a zeroed row. It resolves
// to 'unreadable' rather than 'none' because the two answers are not equally
// wrong: "we could not check" costs a coach one retry, and "you have no payout
// account" sent to a coach who has one costs them a duplicate Stripe account,
// with their identity documents in it, that nobody can pay them through.
import type { LoadStatus } from '../ui/loadStatus';

/**
 * The shape this module needs off a Connect account row. Structural on purpose:
 * `ConnectStatus` lives in src/lib/connect.ts, which reaches Supabase, and the
 * test for this file runs under plain node.
 */
export interface PayoutAccount {
  stripe_account_id: string | null;
  charges_enabled: boolean | null;
  details_submitted?: boolean | null;
  account_type?: string | null;
}

/**
 * The five things that can be true about a coach's payouts.
 *
 *  'loading'    — the first read has not come back. Say nothing yet.
 *  'unreadable' — the read failed, was refused, or answered nothing at all.
 *                 NOT a statement that they have no account, and the one stage
 *                 that must never offer onboarding.
 *  'none'       — read, and Stripe has no account for this coach. Onboard.
 *  'started'    — read, an account exists, Stripe has not enabled charges on
 *                 it. Continue, never start again.
 *  'active'     — read, charges enabled. They can be paid.
 */
export type PayoutStage = 'loading' | 'unreadable' | 'none' | 'started' | 'active';

export function payoutStage(acct: PayoutAccount | null | undefined, read: LoadStatus): PayoutStage {
  if (read === 'loading') return 'loading';
  // 'partial' cannot arise from a single-row read, and if it ever does it means
  // the row we are holding is not the whole answer — which is exactly the case
  // this screen must not make a claim from.
  if (read !== 'ready') return 'unreadable';
  if (!acct) return 'unreadable';
  if (acct.charges_enabled === true) return 'active';
  if (acct.stripe_account_id) return 'started';
  return 'none';
}

/**
 * May this stage be offered the Stripe onboarding button?
 *
 * Only the two stages where we have READ the account and know what starting
 * onboarding would do. This is the guard the payments screen was missing: it
 * asked `!charges_enabled`, which is true of 'unreadable' and 'loading' as
 * well, and a second onboarding started from either of those is a second live
 * account under the same coach.
 */
export const canOnboard = (s: PayoutStage): boolean => s === 'none' || s === 'started';

/**
 * May a claim about whether this coach can take money be printed at all?
 *
 * False for both stages where the answer is unknown, so a screen can gate one
 * sentence on it rather than repeating the two-way check.
 */
export const payoutKnown = (s: PayoutStage): boolean =>
  s === 'none' || s === 'started' || s === 'active';
