// ── The gym's own Stripe account, from the owner's side ─────────────────────
//
// `connect_accounts` (part 21) is one row per COACH. `gym_connect_accounts`
// (part 280) is one row per GYM, and this module is what an owner sees of it.
//
// Why the two cannot be the same row is the whole point and it is worth stating
// once more here, where somebody setting it up will read it: a gym membership
// sold on the owner's personal coach account makes a different legal entity the
// merchant of record for it. The charge succeeds, the member is a member, the
// money is in the wrong company's balance and the wrong company's name is on
// the card statement. Nothing in the app would look wrong.
//
// ── One arrangement, and no switch ────────────────────────────────────────
//
// A gym sells on a STANDARD account taking DIRECT charges, which is the one
// arrangement where Stripe puts fraud and dispute liability on the connected
// account, or it does not sell. There is no legacy to keep working: no gym has
// ever had an account, so there is no `charge_model` column and no destination
// path. `canTakeDirectCharges` in src/lib/directCharges.ts is the gate, shared
// with the coach side rather than restated, and src/lib/memberBuy.ts's test
// asserts the member-facing version agrees with it on every account shape.
//
// Nothing in here is framework-specific: the Supabase client comes in as an
// argument, the shape src/lib/memberRecord.ts and src/lib/gymPasses.ts use.
import { canTakeDirectCharges, accountTypeOf } from './directCharges';

type Queryable = {
  from: (table: string) => any;
  functions: { invoke: (name: string, opts: { body: unknown }) => Promise<{ data: any; error: any }> };
};

/** The gym's payment account as its OWNER may read it. Everything here is on
 *  `gym_connect_accounts` and is admitted by `gym_connect_owner`. */
export interface GymMerchant {
  /** Stripe's `acct_...`. Null means onboarding was never finished far enough
   *  for Stripe to give us one. */
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  /** Stripe's own word for what the account IS. Null means nobody has asked
   *  Stripe yet, which is a different fact from any answer it could give. */
  accountType: string | null;
  /** The `card_payments` capability. Null is "not recorded", which falls back
   *  to `chargesEnabled`; a value that is present and not 'active' is a
   *  refusal. */
  cardPaymentsStatus: string | null;
  payoutsEnabled: boolean | null;
}

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Where the gym's payment setup stands, as a sentence an owner can act on.
 *
 * `kind` is what a screen branches on. The distinction that matters is between
 * 'none' and everything else: a gym that has never started is one tap from
 * starting, and a gym that Stripe is still verifying is not waiting on anybody
 * here.
 */
export type MerchantState =
  /** No account at all. Nothing has been started. */
  | { kind: 'none'; note: string; cta: string }
  /** Stripe has an account and has not finished with it. */
  | { kind: 'pending'; note: string; cta: string }
  /** Ready to take a card. */
  | { kind: 'live'; note: string; cta: string }
  /** An account exists and cannot take payments in this arrangement, and no
   *  amount of waiting will change that. */
  | { kind: 'blocked'; note: string; cta: string };

/**
 * What to tell the owner, from the row.
 *
 * The verdict comes from `canTakeDirectCharges` rather than from reading the
 * columns again here. What this adds is which KIND of not-ready it is, because
 * "carry on where you left off" and "this account can never take payments" are
 * different instructions and the second one needs a person.
 */
export function merchantState(m: GymMerchant | null | undefined): MerchantState {
  if (!m || !m.stripeAccountId) {
    return {
      kind: 'none',
      note: 'Your gym cannot take card payments in the app yet. Setting this up creates a Stripe account in your gym’s name, and members can then buy and renew memberships and passes themselves.',
      cta: 'Set Up Card Payments',
    };
  }

  const verdict = canTakeDirectCharges({
    stripe_account_id: m.stripeAccountId,
    account_type: m.accountType,
    card_payments_status: m.cardPaymentsStatus,
    charges_enabled: m.chargesEnabled,
  });
  if (verdict.ok) {
    return {
      kind: 'live',
      note: 'Your gym can take card payments. Members can buy and renew memberships, drop-ins and class packs in the app, and the money goes to your gym’s own Stripe account.',
      cta: 'Open Stripe Setup',
    };
  }

  // An account Stripe has answered about, whose answer is not 'standard'. It
  // cannot be converted: Stripe fixes an account's type at creation and will
  // not change it afterwards. Said plainly rather than left looking like
  // something more verification would fix.
  const type = accountTypeOf({ account_type: m.accountType });
  if (type && type !== 'standard') {
    return {
      kind: 'blocked',
      note: 'Your gym’s Stripe account is not the kind that can take payments on its own, and Stripe does not allow an account to change kind. Contact support before anybody tries to buy anything.',
      cta: 'Open Stripe Setup',
    };
  }

  return {
    kind: 'pending',
    note: m.detailsSubmitted
      ? 'Stripe is still verifying your gym. Nothing can be bought in the app until it finishes, and that usually clears within a day.'
      : 'Your gym’s Stripe setup is not finished, so nothing can be bought in the app yet. Carry on where you left off.',
    cta: m.detailsSubmitted ? 'Open Stripe Setup' : 'Finish Stripe Setup',
  };
}

/**
 * The gym's payment account, or why we could not read it.
 *
 * `value: null` is a gym with no row at all, which is every gym today. It is
 * NOT the same as a failed read, and an owner told "you have not set this up"
 * when the read simply failed would set it up twice.
 */
export async function fetchGymMerchant(sb: Queryable, tenantId: string): Promise<Read<GymMerchant | null>> {
  if (!tenantId) return { ok: false, reason: 'No gym.' };
  try {
    const { data, error } = await sb.from('gym_connect_accounts')
      .select('stripe_account_id, charges_enabled, details_submitted, account_type, card_payments_status, payouts_enabled')
      .eq('tenant_id', tenantId).maybeSingle();
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: {
      stripeAccountId: typeof data.stripe_account_id === 'string' && data.stripe_account_id.trim() ? data.stripe_account_id : null,
      chargesEnabled: data.charges_enabled === true,
      detailsSubmitted: data.details_submitted === true,
      accountType: typeof data.account_type === 'string' && data.account_type.trim() ? data.account_type : null,
      cardPaymentsStatus: typeof data.card_payments_status === 'string' && data.card_payments_status.trim() ? data.card_payments_status : null,
      payoutsEnabled: data.payouts_enabled == null ? null : data.payouts_enabled === true,
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * Start or resume the gym's Stripe onboarding. Returns the URL for the caller
 * to open, so this module stays free of react-native.
 *
 * Both URLs are https and not app links. Stripe's account-links documentation
 * says `return_url` and `refresh_url` "can only use HTTPS in live mode", so a
 * custom scheme works in test and is refused the day this goes live — which
 * would surface as the first real owner failing to onboard, at the moment they
 * were handing Stripe their passport and their bank details. The same trap
 * src/lib/connect.ts records for the coach flow.
 */
export async function startGymOnboarding(
  sb: Queryable,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await sb.functions.invoke('gym-onboard', {
      body: { refresh_url: urls.refreshUrl, return_url: urls.returnUrl },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.url) return { ok: true, url: String(data.url) };
    return { ok: false, error: data?.error || 'Could not start Stripe setup.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
