"use strict";
// Direct charges — which Stripe account a charge lives on, who is liable for it,
// and what the platform may take off it.
//
// ── Why this is a pure module, and why the edge functions import it ───────
//
// Repple is moving from DESTINATION charges to DIRECT charges. Under
// destination charges the charge is created on the PLATFORM account and the
// money is transferred on to the coach; the platform is the merchant of record,
// and Stripe debits the PLATFORM's balance for every refund and every
// chargeback. Under direct charges the charge is created ON the coach's
// connected account: the coach is the merchant of record, and Stripe debits the
// COACH's balance for refunds and disputes. That difference is the entire point
// of the change, and it is a difference in one request option.
//
// Three separate rules had to be written down for that to be safe, and all
// three are the kind that cannot be asserted while they live inside a Deno
// function:
//
//   1. WHICH MODEL an account sells under. Both models must coexist — see
//      `modelForAccount` — and getting it wrong does not fail loudly, it
//      creates a charge on the wrong ledger.
//   2. WHICH ACCOUNT an existing object lives on. A subscription created under
//      destination charges lives on the platform; one created under direct
//      charges lives on the coach's account. Every later Stripe call about it —
//      retrieve, update, billing portal — must be made in that same context or
//      Stripe answers "No such subscription" for an object that plainly exists.
//   3. WHAT THE PLATFORM MAY TAKE. Stripe requires `application_fee_amount` to
//      be POSITIVE and STRICTLY LESS than the charge. A fee of zero — which is
//      what a 10% fee on a 4-unit package rounds to — is not "no fee", it is a
//      rejected Checkout Session and a client who cannot buy anything.
//
// So they live here, with a test, and `connect-checkout`, `connect-onboard` and
// `stripe-webhook` import them the same way `connect-checkout` already imports
// `subscriptionScope.ts`. Imported rather than copied on purpose: a second copy
// of the fee arithmetic would be the one that drifts, and the test would keep
// passing on the other one.
//
// There is NO default currency anywhere in this file, and no amount here is
// ever currency-aware: `application_fee_amount` is denominated in the same
// minor unit as the charge it is taken from, so the arithmetic is unit-free and
// the caller carries the currency. A "cents" in a name here means minor units
// of whatever the tenant charges in — fils, pence, cents.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FEE_PCT = void 0;
exports.modelForAccount = modelForAccount;
exports.accountForObject = accountForObject;
exports.optionsForObject = optionsForObject;
exports.platformFeePct = platformFeePct;
exports.applicationFeeCents = applicationFeeCents;
exports.liabilityFrom = liabilityFrom;
exports.accountTypeFor = accountTypeFor;
exports.chargeModelFor = chargeModelFor;
exports.accountTypeOf = accountTypeOf;
exports.canTakeDirectCharges = canTakeDirectCharges;
/** A non-empty account id, or null. Trimmed, because a column that holds `' '`
 *  is a column that would otherwise be sent to Stripe as an account header. */
const acctId = (raw) => {
    if (typeof raw !== 'string')
        return null;
    const s = raw.trim();
    return s ? s : null;
};
/**
 * How does this coach sell TODAY?
 *
 * Only the exact word 'direct' selects direct charges. Null, an unrecognised
 * word, a column that does not exist yet on an old row — every one of those
 * answers 'destination', which is what the account has been doing all along.
 *
 * That asymmetry is deliberate and it is the safety property of this whole
 * change. Both models have to coexist: coaches onboarded before today are on
 * Express accounts that CANNOT be converted (Stripe fixes an account's
 * controller and dashboard type at creation and refuses to change either), so
 * they will still be selling under destination charges long after new coaches
 * are selling under direct ones. A default of 'direct' would silently move
 * every one of those coaches onto a model their account is not configured for
 * — and the failure would land on a client at a checkout page.
 */
function modelForAccount(acct) {
    return acct?.charge_model === 'direct' ? 'direct' : 'destination';
}
/**
 * Which Stripe account does this stored object live on? Null means the
 * platform.
 *
 * Read from the object's OWN column, never from the coach's current
 * `charge_model`. A coach switched from destination to direct still has live
 * subscriptions that were created on the platform, and asking the coach's
 * account which model to use would send every call about those to the wrong
 * ledger — where Stripe answers 404 and the app tells a paying client their
 * subscription does not exist.
 */
function accountForObject(row) {
    return acctId(row?.stripe_account_id);
}
/**
 * The Stripe request options for a call about a stored object: `{ stripeAccount
 * }` for something on a connected account, `undefined` for something on the
 * platform.
 *
 * `undefined` rather than `{}` because that is what the Stripe SDK wants for
 * "no account context", and because an empty object passed as options is easy
 * to read as "options were considered" when they were not.
 */
function optionsForObject(row) {
    const id = accountForObject(row);
    return id ? { stripeAccount: id } : undefined;
}
/** What `PLATFORM_FEE_PCT` is when nobody has set it. Unchanged from what
 *  `connect-checkout` has always used, so an unset secret keeps behaving. */
exports.DEFAULT_FEE_PCT = 10;
/**
 * Read PLATFORM_FEE_PCT, or refuse it.
 *
 * This was `Number(Deno.env.get('PLATFORM_FEE_PCT') ?? '10')` and nothing
 * checked the answer. `Number('ten')` is NaN, and NaN travels: the one-off path
 * computed `Math.round(price * NaN / 100)` and sent `application_fee_amount:
 * NaN`, and the subscription path sent `application_fee_percent: NaN` straight
 * into a live recurring charge. Stripe refuses both, so the visible symptom is
 * that nobody can buy anything from anybody — with a typo in a secret as the
 * cause and nothing naming it.
 *
 * 100 and above is refused rather than clamped. A fee of 100% is not a fee, it
 * is the coach working for nothing, and Stripe rejects an application fee that
 * is not strictly less than the charge anyway. Negative is refused for the same
 * reason in the other direction: it would be Repple paying the coach extra.
 */
function platformFeePct(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s)
        return { ok: true, pct: exports.DEFAULT_FEE_PCT };
    const n = Number(s);
    if (!Number.isFinite(n))
        return { ok: false, reason: `PLATFORM_FEE_PCT is "${raw}", which is not a number.` };
    if (n < 0)
        return { ok: false, reason: `PLATFORM_FEE_PCT is ${n}, which would pay the coach more than the client was charged.` };
    if (n >= 100)
        return { ok: false, reason: `PLATFORM_FEE_PCT is ${n}, which would take the whole charge or more. Stripe requires the fee to be less than the amount.` };
    return { ok: true, pct: n };
}
/**
 * The platform's cut of a one-off charge, in the charge's own minor units.
 *
 * `fee: null` means OMIT the field, and it is not the same as zero. Stripe
 * requires `application_fee_amount` to be positive and strictly less than the
 * charge; a literal 0 is refused and takes the whole Checkout Session with it.
 *
 * ── Where the threshold actually is ───────────────────────────────────────
 *
 * This said "a 10% fee on a 5-unit package rounds to 0", and the file's own
 * test says otherwise on the line below the one that pins it: the arithmetic is
 * `Math.round`, so half a minor unit rounds UP. 5 × 10% is 0.5, which is 1 —
 * the smallest fee that survives — and the last price that yields nothing is 4.
 * The rule is `priceCents × pct < 50`, not `< 100`, and the comment was out by
 * a factor of two at the boundary it existed to describe.
 *
 * It mattered because it travelled. The same sentence was written into
 * `connect-checkout` (correctly, as "4 minor units at 10%") and out of here
 * onto the public site as a pricing promise, where it has since been corrected.
 * The code is right and was always right; the prose was wrong, and prose about
 * a rounding boundary is the kind that gets quoted rather than re-derived.
 *
 * It is not a hypothetical either way — it is any cheap package in any
 * currency, and the failure would be a client staring at "Could not start
 * checkout" on a package priced correctly.
 *
 * The other end is refused rather than clamped: a fee that meets or exceeds the
 * charge is a misconfiguration, and clamping it to `price - 1` would quietly
 * take almost all of somebody's money instead of saying that the number is
 * wrong.
 */
function applicationFeeCents(priceCents, pct) {
    if (typeof priceCents !== 'number' || !Number.isInteger(priceCents)) {
        return { ok: false, reason: 'The package price is not a whole number of minor units, so no fee can be taken from it.' };
    }
    if (priceCents < 0)
        return { ok: false, reason: 'The package price is negative.' };
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) {
        return { ok: false, reason: `A platform fee of ${pct}% cannot be applied.` };
    }
    const fee = Math.round((priceCents * pct) / 100);
    if (fee <= 0)
        return { ok: true, fee: null };
    if (fee >= priceCents) {
        return { ok: false, reason: `A ${pct}% fee on ${priceCents} would be ${fee}, which is not less than the charge. Stripe refuses that.` };
    }
    return { ok: true, fee };
}
/**
 * Read CONNECT_ACCOUNT_LIABILITY.
 *
 * THE DEFAULT IS 'coach', AND THE ASYMMETRY IS THE POINT. It used to be
 * 'platform', on the reasoning that a typo in a secret must not silently
 * onboard somebody under an arrangement nobody chose. That reasoning has not
 * changed; what changed is which arrangement is the dangerous one to fall into
 * by accident. Coaches on Standard accounts is now the product decision, so an
 * unset, empty or mistyped secret must NOT quietly put a new coach on an
 * Express account — because that account can never be converted, and Repple
 * would be carrying that coach's chargebacks for the life of their business
 * with nothing in the app or the database looking wrong.
 *
 * Only the exact word 'platform' selects the legacy path, and it exists so an
 * account that already exists is still describable, not so new ones are made
 * that way. If you are reading this because you want to "simplify" the default
 * back: the Express liability rule three paragraphs up is why you must not.
 */
function liabilityFrom(raw) {
    return (typeof raw === 'string' ? raw.trim().toLowerCase() : '') === 'platform' ? 'platform' : 'coach';
}
/**
 * The `type` sent to `accounts.create` for a NEW connected account.
 *
 * 'standard' is a single documented parameter — Stripe's own Standard-account
 * guide says "You must pass the following parameter: type = standard" — and it
 * is sent INSTEAD of a controller hash, never alongside one: `type` and
 * `controller` are alternatives, and sending both is how an account ends up in
 * an arrangement nobody chose.
 */
function accountTypeFor(liability) {
    return liability === 'coach' ? 'standard' : 'express';
}
/**
 * The charge model that account must sell under, decided in the same breath.
 *
 * Not a preference. Stripe lists Standard's supported charge types as "Direct
 * only", so a destination charge on a Standard account is a request Stripe
 * refuses; and a direct charge on a legacy Express account is the liability
 * half-measure described above. Each type has exactly one model that is both
 * accepted and honest, so this function has no second opinion to offer.
 */
function chargeModelFor(liability) {
    return liability === 'coach' ? 'direct' : 'destination';
}
/** What Stripe says an account's type is, normalised. Null means the column has
 *  not been written for this account yet — which, for every row that existed
 *  before part 161, is true and means Express. It is NOT rounded to 'express'
 *  here, because "we have not asked Stripe" and "Stripe told us Express" are
 *  different states and only one of them is safe to sell a direct charge on. */
function accountTypeOf(row) {
    const s = typeof row?.account_type === 'string' ? row.account_type.trim().toLowerCase() : '';
    return s === 'standard' || s === 'express' || s === 'custom' || s === 'none' ? s : null;
}
/**
 * Can this account take a DIRECT charge right now?
 *
 * Two questions, and they fail for different reasons.
 *
 * FIRST, IS THIS THE RIGHT KIND OF ACCOUNT. `charge_model` is a column, and a
 * column can be edited — part 161 describes the owner writing it "one coach at
 * a time". Written onto an EXPRESS account it does not deliver what it says: the
 * charge really would be created on the coach's ledger, and Repple would still
 * be the party Stripe holds for the fraud, the dispute and any balance the
 * coach cannot repay. Nothing would look wrong until a chargeback arrived. So
 * the account's own type is checked, and only 'standard' passes. A null type is
 * refused too — it means nobody has asked Stripe what this account is, and the
 * only rows that can be both null and 'direct' are ones somebody edited by
 * hand. No coach selling today is affected by that refusal, because no row is
 * 'direct' until this ships.
 *
 * SECOND, HAS STRIPE FINISHED WITH THEM. Stripe is explicit that the connected
 * account must have `card_payments` ACTIVE for direct charges — requested is not
 * enough, and an account halfway through onboarding has it requested. But
 * `card_payments_status` is null on every row written before part 161, and
 * gating on a column that is null everywhere would stop every coach selling the
 * moment this deploys. So a null status is not a refusal, it is an absence: fall
 * back to `charges_enabled`, which is Stripe's own aggregate answer to the same
 * question and which the `account.updated` webhook has been maintaining all
 * along. A status that is PRESENT and not 'active' is a refusal, because then
 * Stripe has told us plainly and there is nothing to infer.
 */
function canTakeDirectCharges(acct) {
    if (!acctId(acct?.stripe_account_id))
        return { ok: false, reason: 'This trainer is not set up to take payments yet.' };
    if (accountTypeOf(acct) !== 'standard') {
        return { ok: false, reason: 'This trainer’s payout account is not the kind that can take payments on its own, so nothing has been charged.' };
    }
    const status = typeof acct?.card_payments_status === 'string' ? acct.card_payments_status.trim() : '';
    if (status && status !== 'active') {
        return { ok: false, reason: 'This trainer has not finished verifying with Stripe, so card payments are not active on their account yet.' };
    }
    if (!acct?.charges_enabled)
        return { ok: false, reason: 'This trainer is not set up to take payments yet.' };
    return { ok: true };
}
