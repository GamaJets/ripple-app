// A discount code on a coach's package, and the reason it works on one kind of
// package and not the other.
//
// ── What a coach had instead ───────────────────────────────────────────────
//
// A package was a flat price with no coupon, no trial and no proration
// (`createPackage` in src/lib/connect.ts). January and September offers are how
// coaches fill a book, and running one meant creating a SECOND package at the
// lower price, telling the right people about it, and remembering to withdraw
// it in February — which nobody does, so the offer price quietly becomes the
// price.
//
// ── WHERE THESE CODES LIVE, AND WHY THERE IS NO TABLE ─────────────────────
//
// At Stripe, on the coach's own connected account, as a Coupon with a
// Promotion Code attached. This app stores NOTHING about them.
//
// That is deliberate and it is the same argument part 192 makes about refunds.
// Stripe already holds the code, the percentage, the expiry, the redemption
// limit AND the redemption count, and it is the thing that actually applies the
// discount at checkout. A mirror of all that in this database would be a second
// copy that has to be kept in step with a system this app does not control —
// and the first time they disagreed, the screen would be showing a coach an
// offer that is not the one their clients are getting.
//
// The cost is a round trip to list them, and a hard dependency on Stripe being
// reachable to show the section at all. Payments is already a screen that says
// nothing useful without Stripe, so this changes nothing about its failure
// modes.
//
// ── SUBSCRIPTION PACKAGES ONLY, AND THE REASON IS THE PLATFORM FEE ────────
//
// This is the part worth reading before anybody widens it.
//
// A code is collected on the CLIENT'S OWN checkout screen — app/(client)/
// packages.tsx — and travels with the request that creates the Checkout
// Session. It used to be collected on Stripe's hosted page instead
// (`allow_promotion_codes: true`), which was less to build and could enforce
// neither of the two rules below, because a box on Stripe's page is a box no
// code in this repo ever sees. `checkoutCodeBlocker` is the rule now, run by
// that screen as a convenience and by connect-checkout as the rule.
//
// On a SUBSCRIPTION, Repple's cut is `application_fee_percent`: a percentage,
// so it scales with the discount automatically. A 20% off code means the client
// pays 20% less and Repple takes its share of the smaller amount. Correct with
// no arithmetic anywhere.
//
// On a ONE-OFF, Repple's cut is `application_fee_amount`: an absolute figure in
// minor units. Left as it was, it is computed from the LIST price, Stripe then
// discounts the charge and does not touch the fee, and a coach running 30% off
// a £100 pack receives £70 from the client and still pays a fee calculated on
// £100 — eating the whole discount AND a fee on money they never got, with
// nothing on any screen saying so. At a large enough discount the fee exceeds
// the charge and Stripe refuses the payment outright, which the client meets as
// a checkout that will not complete.
//
// ── AND WHY HAVING THE CODE EARLIER DOES NOT FIX THE ONE-OFF ──────────────
//
// This file used to say the fix was for the code to be supplied WHEN THE
// SESSION IS CREATED, so the fee could be computed from the discounted total,
// and that it only needed a field on the client's checkout flow. The field
// exists now. It does not fix this, and the reason is an ORDERING that no field
// can change.
//
// `application_fee_amount` is an input to `checkout.sessions.create`. What the
// discount actually comes to is an OUTPUT of that same call — Stripe applies
// the coupon and works out the total inside it. So the fee can never be derived
// from what Stripe charged; it can only be derived from a discounted total this
// app predicted, and Stripe's own percentage rounding is not this app's to
// reproduce. A prediction one minor unit out is a coach underpaid on every sale
// of that package, quietly, forever. Nothing that can be sent in that call is
// the figure Stripe is about to compute in it.
//
// A second call is not an escape either: Stripe's Checkout owns the
// PaymentIntent it creates and documents that changes made to it from outside
// may be overwritten, so "create the session, read `amount_total`, then patch
// the fee onto the PaymentIntent" is a fee that may or may not survive to the
// charge — which is worse than a wrong one, because it is wrong intermittently.
//
// So the refusal stands, and it is now enforced at the CHECKOUT as well as at
// the coach's screen: `promoBlocker` refuses a one-off package by name when a
// coach tries to attach a code to it, and `checkoutCodeBlocker` refuses one
// against a one-off sale when a client types it. Both are run by their screen
// and again by their edge function.
//
// Pure, framework-free and asserted against under plain `node`.

/** A package, reduced to the one thing that decides whether a code may be
 *  attached to it. `billing_interval` is 'month' or 'year' for a subscription
 *  and null for a one-off — part 97's two axes. */
export interface PromoTarget {
  id: string;
  name: string;
  billingInterval: string | null;
  active: boolean;
}

/** One code, as Stripe holds it. Nothing here is stored in this database. */
export interface PromoCode {
  /** Stripe's promotion code id. */
  id: string;
  /** What the client types. Stripe upper-cases it. */
  code: string;
  /** 1 to 90. There is deliberately no amount-off variant — see
   *  `PROMO_IS_A_PERCENTAGE`. */
  percentOff: number;
  active: boolean;
  /** How many times it has been used. Stripe's count, which is the only one. */
  timesRedeemed: number;
  /** The cap the coach set, or null for none. */
  maxRedemptions: number | null;
  /** `YYYY-MM-DD` after which it stops working, or null for no expiry. */
  expiresOn: string | null;
  /** The package it is restricted to, or null when it applies to any of this
   *  coach's recurring packages. */
  packageId: string | null;
}

/* ── the code itself ──────────────────────────────────────────────────────── */

/**
 * What the coach typed, as Stripe will store it.
 *
 * Upper case, no spaces, letters and digits only. Normalised HERE rather than
 * left to Stripe so the screen shows the coach the code their client will
 * actually have to type: a coach who types "new year 25" and is shown that
 * back, while Stripe stored something else, will print the wrong thing on a
 * poster.
 */
export function normaliseCode(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
}

/**
 * Every reason a code cannot be created, in the coach's own words.
 *
 * A list rather than the first failure, the same discipline `invoiceBlockers`
 * keeps. An empty list means it can go.
 */
export function promoBlocker(code: string, percentOff: number, target: PromoTarget | null): string[] {
  const out: string[] = [];
  const c = normaliseCode(code);
  if (!c) {
    out.push('Type a code. It is what your client types at checkout, so letters and numbers only — anything else is dropped.');
  } else if (c.length < 3) {
    out.push('That code is too short to be worth typing. Three characters is the shortest Stripe will take.');
  }

  if (!Number.isFinite(percentOff) || !Number.isInteger(percentOff) || percentOff < 1) {
    out.push('Say how much off, as a whole percentage. A discount of nothing is not an offer.');
  } else if (percentOff > MAX_PERCENT_OFF) {
    // Capped, and the reason is not squeamishness about generosity. Stripe
    // refuses a charge whose application fee is not strictly less than the
    // total, and a near-total discount is the shape that trips it — the client
    // meets a checkout that will not complete and nothing tells anybody why.
    out.push(`The most this can take off is ${MAX_PERCENT_OFF}%. A bigger discount than that leaves too little on the charge for the payment to go through at all, and your client would meet a checkout that simply fails.`);
  }

  // THE restriction, and the one worth reading the header for.
  if (!target) {
    out.push('Choose which package this is for.');
  } else if (!target.active) {
    out.push('That package is not on sale, so a code for it would do nothing.');
  } else if (!target.billingInterval) {
    out.push(`“${target.name}” is a one-off sale rather than a subscription, and a code cannot be attached to one yet. Repple’s share of a one-off is worked out from the full price before your client types anything, so a discount would come entirely out of your end and you would still pay a fee on money you did not receive. On a subscription the share is a percentage and it comes down with the price, which is why those work.`);
  }
  return out;
}

/* ── the client's end of the same code ────────────────────────────────────── */

/**
 * Whether a code the CLIENT typed may be sent with this checkout, or the reason
 * it may not — in the client's words rather than the coach's.
 *
 * ── Why there is a field at all now ───────────────────────────────────────
 *
 * There was not one. `allow_promotion_codes: true` put the box on STRIPE'S
 * hosted page, which is genuinely less to build and has two costs that are only
 * obvious once codes exist:
 *
 *   1. THE PACKAGE RESTRICTION WAS NOT ENFORCED ANYWHERE. A code is created for
 *      one package and the restriction is recorded in Stripe METADATA, because
 *      this app's packages are inline prices with no stored Product for
 *      Stripe's own `applies_to` to point at — connect-promo says so in as many
 *      words. Stripe therefore does not enforce it, and a box on Stripe's page
 *      is a box nothing in this repo can see, so a code meant for one recurring
 *      package worked on every other one the coach sells. Typed HERE, the
 *      restriction can be checked before the session is created.
 *   2. THE ONE-OFF REFUSAL WAS ONLY EVER A COACH-SIDE ONE. `promoBlocker` stops
 *      a coach ATTACHING a code to a one-off package. Nothing stopped a code
 *      created for a subscription being typed against a one-off sale, and the
 *      only reason it did not happen is that the one-off branch never presented
 *      a box. That is a property of a missing feature, not a rule.
 *
 * So the code is collected in the app and travels with the request. Both
 * refusals above are then run in one place — this function — by the client's
 * screen as a convenience and by supabase/functions/connect-checkout as the
 * rule.
 *
 * ── And the one-off still refuses ─────────────────────────────────────────
 *
 * The header of this file has the long form. The short one: on a one-off,
 * Repple's cut is an absolute `application_fee_amount` that has to be sent in
 * the same call that creates the session, and Stripe computes the discounted
 * total inside that call — so there is no ordering in which the fee is derived
 * from what Stripe actually charged. A fee predicted from a discount this app
 * calculated is not the same thing, and the difference is a coach underpaid or
 * a payment Stripe refuses outright. The refusal stands and is now enforced at
 * the checkout as well as at the coach's screen.
 */
export function checkoutCodeBlocker(typed: string, target: PromoTarget | null): string | null {
  const c = normaliseCode(typed);
  if (!c) return 'Type the code your coach gave you. Letters and numbers only.';
  if (c.length < 3) return 'That code is too short. Check what your coach gave you.';
  if (!target) return 'That package could not be read, so a code cannot be checked against it.';
  if (!target.billingInterval) return CODE_IS_NOT_FOR_A_ONE_OFF;
  return null;
}

/**
 * What a client is told when they type a code against a one-off pack.
 *
 * Not the fee explanation. A client is not owed Repple's internal arithmetic
 * and would not be helped by it; what they need is which of their coach's
 * things a code works on, and the price they are actually being asked for.
 */
export const CODE_IS_NOT_FOR_A_ONE_OFF =
  'Discount codes work on the memberships your coach charges for every month or year. This one is bought once, at the price shown.';

/**
 * Whether a code created for one package may be used on another.
 *
 * `codePackageId` is Stripe metadata written by connect-promo at creation.
 * A code with none — one made in the coach's own Stripe dashboard rather than
 * through this app — is not restricted by this app either, because there is
 * nothing recorded to restrict it to and inventing one would refuse a code the
 * coach deliberately made general.
 */
export function codeAppliesTo(codePackageId: string | null | undefined, packageId: string): boolean {
  const restricted = String(codePackageId ?? '').trim();
  if (!restricted) return true;
  return restricted === String(packageId ?? '').trim();
}

/** Said when a real, live code is typed against the wrong package. Names
 *  neither package: the client knows which one they are buying, and telling
 *  them which OTHER thing their coach's offer is for is the coach's business
 *  rather than this screen's. */
export const CODE_IS_FOR_ANOTHER_PACKAGE =
  'That code is for something else your coach sells, so it does not come off this one. Check with them which it is for.';

/**
 * The ceiling on a discount, and it is about Stripe rather than about taste.
 *
 * Stripe requires an application fee to be strictly LESS than the charge. A 95%
 * discount on a package whose platform fee is 10% of the list price leaves a
 * charge smaller than the fee, and Stripe refuses the payment — which the
 * client meets as a checkout that will not complete, with nothing anywhere
 * naming the cause.
 *
 * 90 rather than 99 because the fee percentage is a platform setting that can
 * change, and a ceiling that is only just safe at today's setting is a ceiling
 * that stops being safe when somebody edits an environment variable.
 */
export const MAX_PERCENT_OFF = 90;

/* ── what a code is doing now ─────────────────────────────────────────────── */

export type PromoState = 'live' | 'expired' | 'used-up' | 'withdrawn';

/**
 * Where a code stands, as of the day the caller says it is.
 *
 * `today` is passed in rather than read from a clock inside this function, for
 * the reason every date function in this codebase is written that way: a `new
 * Date()` here would be UTC-shaped and untestable, and the caller already knows
 * which day the DEVICE is on.
 */
export function promoState(p: PromoCode, today: string): PromoState {
  if (!p.active) return 'withdrawn';
  if (p.maxRedemptions != null && p.timesRedeemed >= p.maxRedemptions) return 'used-up';
  const exp = String(p.expiresOn ?? '').slice(0, 10);
  // ISO dates sort lexicographically, so no Date is constructed at all — the
  // same reason `splitByDay` in coachStatement.ts compares strings.
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && /^\d{4}-\d{2}-\d{2}$/.test(today) && today > exp) return 'expired';
  return 'live';
}

/** The state's own label. Title Case: it heads a value on a row. */
export function promoStateLabel(state: PromoState): string {
  if (state === 'live') return 'Live';
  if (state === 'expired') return 'Expired';
  if (state === 'used-up') return 'Used Up';
  return 'Withdrawn';
}

/**
 * What a code has actually done, in one line under it.
 *
 * The redemption count is STRIPE'S and is the only one — this app keeps no
 * copy of it, so there is nothing here that can disagree with what the coach
 * would see in their Stripe dashboard.
 */
export function promoUseLine(p: PromoCode): string {
  const n = Number.isFinite(p.timesRedeemed) ? p.timesRedeemed : 0;
  const used = n === 0 ? 'Nobody has used it yet' : `Used ${n} ${n === 1 ? 'time' : 'times'}`;
  const cap = p.maxRedemptions != null ? ` of ${p.maxRedemptions}` : '';
  const until = p.expiresOn ? `, and it stops working after ${p.expiresOn}` : '';
  return `${used}${cap}${until}.`;
}

/* ── the sentences that keep this honest ──────────────────────────────────── */

/**
 * That a percentage is the only shape offered, and why.
 *
 * An amount off would need a CURRENCY, and Repple is white-labelled: a coach
 * selling in dirhams and a visitor's coach selling in sterling cannot share a
 * "£20 off" code, and a code created in one currency silently doing nothing in
 * another is the quiet failure this app spends its design budget avoiding. A
 * percentage is the same offer in every currency and needs no unit at all.
 */
export const PROMO_IS_A_PERCENTAGE =
  'A code takes a percentage off, never a fixed amount. Repple is white-labelled, so a fixed amount would need a currency and would do nothing at all for a client paying in a different one — a percentage is the same offer whatever you charge in.';

/**
 * Where the client types it, so the coach knows what to tell them.
 *
 * This used to say the code was typed on the payment page itself, and that was
 * true while `allow_promotion_codes` put the box there. It moved into the app,
 * because a box on Stripe's page is one nothing in this repo can see and the
 * restriction to a single package is recorded in Stripe metadata that Stripe
 * does not enforce — see `checkoutCodeBlocker`. A coach telling their client
 * the wrong place to type it is a coach fielding a message about a code that
 * "does not work".
 */
export const PROMO_IS_TYPED_AT_CHECKOUT =
  'Your client types the code in the app, on the package itself, before the payment page opens. Give them the code and tell them to tap Have A Code when they subscribe.';

/**
 * That Stripe holds these and this app does not.
 *
 * On the screen because a coach who withdraws a code here and then sees it in
 * their Stripe dashboard should understand which of the two is the record. It
 * is Stripe, and there is only one copy.
 */
export const PROMO_LIVES_AT_STRIPE =
  'These live in your own Stripe account rather than in Repple, which is why the number of times each has been used is exact — there is one copy of it and Stripe keeps it. Withdrawing one here archives it at Stripe.';

/**
 * That withdrawing does not un-discount anybody.
 *
 * The thing a coach would otherwise assume. Somebody already on a subscription
 * bought with a code keeps that price until the subscription ends, because that
 * is what they agreed to — and a coach who withdraws a code believing it ends
 * the discount for existing subscribers has a surprise coming a year later.
 */
export const PROMO_WITHDRAW_IS_FORWARD_ONLY =
  'Withdrawing a code stops anybody new using it. It does not change what somebody already subscribed on it pays — they keep the price they signed up at until their subscription ends, which is what they agreed to.';
