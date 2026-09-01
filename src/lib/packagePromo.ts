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
// A code is collected on STRIPE'S OWN hosted checkout page — `allow_promotion_
// codes: true` — so the client types it there and no screen in this app needs a
// field. Stripe then applies the discount to the total AFTER the session was
// created.
//
// On a SUBSCRIPTION, Repple's cut is `application_fee_percent`: a percentage,
// so it scales with the discount automatically. A 20% off code means the client
// pays 20% less and Repple takes its share of the smaller amount. Correct with
// no arithmetic anywhere.
//
// On a ONE-OFF, Repple's cut is `application_fee_amount`: an absolute figure in
// minor units, computed from the LIST price when the session is created,
// because at that moment nothing knows a code will be typed. Stripe then
// discounts the charge and does not touch the fee. So a coach running 30% off a
// £100 pack would receive £70 from the client and still pay a fee calculated on
// £100 — they would eat the whole discount AND a fee on money they never got,
// and nothing on any screen would say so. At a large enough discount the fee
// exceeds the charge and Stripe refuses the payment outright, which the client
// meets as a checkout that will not complete.
//
// Neither is acceptable, and the fix is not a cap on the percentage: it is for
// the code to be supplied WHEN THE SESSION IS CREATED, so the fee can be
// computed from the discounted total. That needs a field on the client's own
// checkout flow, which is a screen this work does not own. Until it exists,
// `promoBlocker` refuses a one-off package by name and says why.
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

/** Where the client types it, so the coach knows what to tell them. */
export const PROMO_IS_TYPED_AT_CHECKOUT =
  'Your client types the code on the payment page itself, so there is nothing for them to do in the app. Give them the code and it works at checkout.';

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
