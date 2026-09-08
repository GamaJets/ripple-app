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
// ── THE PLATFORM FEE, WHICH IS WHY THE TWO KINDS OF PACKAGE DIFFER ────────
//
// This is the part worth reading before anybody widens it further.
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
// no arithmetic anywhere, whatever the price and whatever the discount.
//
// On a ONE-OFF, Repple's cut is `application_fee_amount`: an absolute figure in
// minor units, and Stripe requires it in the SAME call that creates the
// session. Left computed from the LIST price it is straightforwardly wrong:
// Stripe discounts the charge and does not touch the fee, so a coach running
// 30% off a £100 pack receives £70 from the client and still pays a fee worked
// out on £100 — eating the whole discount AND a fee on money they never got.
// At a large enough discount the fee exceeds the charge and Stripe refuses the
// payment outright, which the client meets as a checkout that will not
// complete. Stripe's own wording, on the direct-charges page: the value "must
// be positive and less than the amount of the charge".
//
// ── WHAT WAS TRIED, AND WHY IT ONLY HALF WORKS ────────────────────────────
//
// The obvious fix is to know the coupon BEFORE the session is created — which
// is possible, because `promotionCodes.list({ code })` is already called on the
// coach's account to resolve what the client typed — and to derive the fee from
// the discounted total rather than from the list price.
//
// It runs into one wall, and the wall is not the ordering. `application_fee_
// amount` is an input and `amount_total` is an output of the same call, so the
// fee can only ever come from a total this app PREDICTED. The wall is that for
// a PERCENTAGE discount the prediction needs Stripe's rounding rule, and
// STRIPE DOES NOT DOCUMENT ONE. Not on the Coupon object, not on the Discount
// object, not on either discounts guide, not on the Billing coupons page. The
// only rounding Stripe writes down is for TAX (billing/taxes/tax-rates, "Round
// at the invoice line item level…") and for its own processing fee, and neither
// governs this. A rule learned by observation is a rule that can change in a
// release note nobody here reads, and a prediction one minor unit out is a
// coach underpaid on every sale of that package, quietly, forever.
//
// A second call is not an escape either: Checkout owns the PaymentIntent it
// creates, `checkout.sessions.update` accepts four parameters and none of them
// is the fee, and patching the PaymentIntent from outside is undocumented
// rather than permitted — a fee that may or may not survive to the charge is
// worse than a wrong one, because it is wrong intermittently.
//
// ── SO THE RULE IS EXACTNESS, NOT PREDICTION ──────────────────────────────
//
// A code works on a one-off exactly when the discount is a WHOLE NUMBER OF
// MINOR UNITS with no rounding involved at all — in which case every rounding
// rule agrees, including the undocumented one, and there is nothing left to
// predict. `oneOffDiscount` below is that rule. Two shapes qualify:
//
//   · An `amount_off` coupon IN THE SESSION'S OWN CURRENCY. Stripe subtracts an
//     integer from an integer. There is no rounding anywhere in it.
//   · A `percent_off` coupon where `price × percent` divides by 100 exactly.
//     30% of £100.00 is 3000 minor units on any arithmetic anybody could
//     implement. 20% of £49.99 is 999.8, which is not a number of pennies, and
//     is REFUSED — by name, with the reason, at the coach's screen when the
//     code is created and again at the checkout in case the package has been
//     repriced since.
//
// Everything else is refused too, and the list is deliberately long: a coupon
// restricted to Stripe Products (this app's packages are inline `price_data`
// with no stored Product, so `applies_to` cannot match one), a multi-currency
// coupon, an `amount_off` in a currency the package is not sold in, a promotion
// code carrying a minimum-spend or first-time-customer restriction, and any
// coupon Stripe itself reports as no longer valid. Stripe does not document
// what several of those do to a session that names them, and a refusal is a
// good outcome where a wrong fee is not.
//
// ── AND THE PREDICTION IS STILL CHECKED AGAINST REALITY ───────────────────
//
// Exact arithmetic on this side is not proof about Stripe's side. The one-off
// checkout stamps the total it expects onto the session's metadata, and the
// stripe-webhook compares it with the `amount_total` Stripe actually charged
// when the sale completes. A difference is recorded on the sale
// (`client_purchases.fee_variance_cents`, part 311) and shown to the coach,
// because a figure nobody reconciles is how a coach is underpaid by one minor
// unit on every sale of a package for a year. It is a RECORDED DISCREPANCY
// rather than a hard failure for one reason: by the time that event arrives the
// card has been charged and Stripe has already taken the fee, so there is
// nothing left to refuse, and refusing to write the row would leave a client
// who has paid with no pack and no record of paying.
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
  /**
   * The list price in minor units, which a ONE-OFF needs and a subscription
   * does not.
   *
   * On a subscription the fee is a percentage and nothing about the price
   * enters into whether a code may be attached. On a one-off the fee is an
   * absolute figure derived from the discounted total, and whether that total
   * can be known exactly depends on the price and the percentage together —
   * see `oneOffDiscount`. So the price is part of the target rather than
   * something the caller checks separately, because a caller that forgot to
   * would be a caller quietly allowing a fee nobody can compute.
   */
  priceCents: number;
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

/* ── what actually comes off a ONE-OFF, and when nobody can say ──────────── */

/**
 * A percentage discount that lands on a whole number of minor units, or null
 * when it does not.
 *
 * The single arithmetic fact the one-off feature rests on. `priceCents *
 * percentOff` is divided by 100 only when it divides EXACTLY, so the answer is
 * never a rounded one — and where it would be, this returns null and the caller
 * refuses rather than picking a rounding rule on Stripe's behalf. Stripe does
 * not document which one it uses; the header has the search.
 *
 * The multiplication is done before the division, on integers, so no float ever
 * holds an intermediate: `4999 * 20` is 99,980 and `99980 % 100` is 80, which
 * is the refusal. `(4999 * 20) / 100` as a float is 999.8000000000001 on some
 * inputs, and a test for "is this a whole number" written that way passes and
 * fails by accident. The largest product this can produce is a price under
 * 100,000,000,000 minor units times 100, which is comfortably inside a safe
 * integer.
 */
export function exactPercentOff(priceCents: number, percentOff: number): number | null {
  if (!Number.isInteger(priceCents) || priceCents < 0) return null;
  if (!Number.isInteger(percentOff) || percentOff <= 0 || percentOff > 100) return null;
  const product = priceCents * percentOff;
  if (!Number.isSafeInteger(product)) return null;
  if (product % 100 !== 0) return null;
  return product / 100;
}

/**
 * One Stripe Coupon, reduced to everything that decides what comes off ONE line
 * item priced in ONE currency.
 *
 * Every field here is a thing that, left unread, produces a fee computed from a
 * total Stripe did not charge. They are read off the coupon the checkout
 * already expands — see connect-checkout — rather than assumed from what this
 * app would have created, because a coach can make a coupon in their own Stripe
 * dashboard and `promotionCodes.list` finds it exactly like one of ours.
 */
export interface CouponShape {
  /** 0–100, or null on an amount-off coupon. */
  percentOff: number | null;
  /** Minor units, or null on a percentage coupon. */
  amountOff: number | null;
  /** The currency `amountOff` is denominated in. Stripe sets this only when
   *  `amount_off` is set. */
  amountOffCurrency: string | null;
  /** True when the coupon carries `currency_options` — per-currency amounts
   *  off. Refused rather than read: which of them Stripe picks for a session is
   *  a rule this app is not going to reimplement. */
  multiCurrency: boolean;
  /** True when the coupon has `applies_to`, which names Stripe PRODUCTS. This
   *  app's packages are inline `price_data` with an ad-hoc product, so such a
   *  coupon cannot be reasoned about here at all. */
  appliesToProducts: boolean;
  /** Stripe's own `valid` — expired, used up, or otherwise finished. */
  valid: boolean;
}

/**
 * A Promotion Code's redemption restrictions.
 *
 * All three are refused, and the reason is the same for all three: Stripe
 * documents WHEN restrictions are checked ("at redemption time") and not what
 * happens to a Checkout Session that names a code whose restriction is not met.
 * For `first_time_transaction` there are at least documented error codes, so
 * the outcome is a checkout that will not open. For `minimum_amount` there is
 * no documented error and no documented fallback, which leaves "the session is
 * created and the discount silently does not apply" on the table — and that is
 * precisely a fee computed from a total nobody charged.
 */
export interface CodeRestrictions {
  /** Minor units of minimum spend, or null for none. */
  minimumAmount: number | null;
  firstTimeTransaction: boolean;
  /** `restrictions.currency_options` — per-currency minimums. */
  multiCurrency: boolean;
}

/** What comes off a one-off sale, or the reason nobody can say. */
export type DiscountPlan =
  | { ok: true; discountCents: number; totalCents: number }
  | { ok: false; why: string };

/**
 * What a code takes off ONE one-off package, exactly, or why it cannot.
 *
 * The whole of the one-off feature. It answers only where the answer is
 * arithmetic rather than a guess about Stripe, and `why` is written for the
 * SERVER LOG and for a coach reading it — the client is told
 * `CODE_CANNOT_COME_OFF_THIS_ONE` instead, because a client is owed the price
 * they are actually being asked for and not Repple's internal arithmetic.
 *
 * Order matters below. The shape checks come before the money, so a coupon that
 * is both invalid and in the wrong currency is refused for the reason a coach
 * can act on first.
 */
export function oneOffDiscount(
  priceCents: number,
  currency: string,
  coupon: CouponShape,
  restrictions: CodeRestrictions,
): DiscountPlan {
  const cur = String(currency ?? '').trim().toLowerCase();
  if (!cur) return { ok: false, why: 'the package has no currency, so there is no money for a discount to be in' };
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return { ok: false, why: `the package price ${priceCents} is not a whole number of minor units above nought` };
  }

  if (!coupon.valid) return { ok: false, why: 'Stripe reports the coupon behind that code as no longer valid' };
  if (coupon.appliesToProducts) {
    return { ok: false, why: 'the coupon is restricted to particular Stripe products, and this package is an inline price with no stored product for that restriction to match' };
  }
  if (coupon.multiCurrency) {
    return { ok: false, why: 'the coupon carries per-currency amounts, and which one Stripe would apply to this session is not something this app will guess at' };
  }
  if (restrictions.multiCurrency) {
    return { ok: false, why: 'the code carries per-currency minimums, and which one Stripe would enforce is not something this app will guess at' };
  }
  if (restrictions.minimumAmount != null) {
    return { ok: false, why: 'the code carries a minimum spend, and Stripe does not document whether a session below it is refused or created with no discount at all' };
  }
  if (restrictions.firstTimeTransaction) {
    return { ok: false, why: 'the code is restricted to first-time customers, which Stripe checks against a Customer this checkout does not have yet' };
  }

  const hasPct = coupon.percentOff != null && Number.isFinite(coupon.percentOff);
  const hasAmt = coupon.amountOff != null && Number.isFinite(coupon.amountOff);
  if (hasPct && hasAmt) {
    return { ok: false, why: 'the coupon states both a percentage and an amount off, which is not a shape this app can resolve to one figure' };
  }

  if (hasAmt) {
    const off = Number(coupon.amountOff);
    const offCur = String(coupon.amountOffCurrency ?? '').trim().toLowerCase();
    if (!offCur) return { ok: false, why: 'the coupon takes an amount off and names no currency for it' };
    if (offCur !== cur) {
      // The one thing Stripe genuinely does not document, and the one this app
      // is least able to survive being wrong about. Repple is white-labelled: a
      // coach in Dubai and a coach in London run the same code path, and a
      // "£20 off" coupon meeting an AED package is either an error, a no-op or
      // twenty dirhams off, and nothing in Stripe's reference says which.
      return { ok: false, why: `the coupon takes ${off} ${offCur.toUpperCase()} off and this package is sold in ${cur.toUpperCase()}` };
    }
    if (!Number.isInteger(off) || off <= 0) {
      return { ok: false, why: `the coupon's amount off, ${off}, is not a whole number of minor units above nought` };
    }
    // Clamped at the price, and this is Stripe's own behaviour rather than a
    // decision: a coupon "for an amount equal to or exceeding the Checkout
    // Session total" is documented as the way to make a session free. The
    // clamp is here so the total below can never be negative.
    const discountCents = Math.min(off, priceCents);
    return { ok: true, discountCents, totalCents: priceCents - discountCents };
  }

  if (hasPct) {
    const pct = Number(coupon.percentOff);
    if (!Number.isInteger(pct) || pct <= 0 || pct > 100) {
      // A fractional percentage is a real Stripe shape (`percent_off` is a
      // decimal) and it is refused rather than handled, because 12.5% of an odd
      // price is exactly the rounding this whole design exists to avoid.
      // Bare, and deliberately. This branch is reached BECAUSE `pct` is not a
      // whole number, so the sentence does carry a decimal separator every time
      // it is printed — but this module is reached from
      // supabase/functions/connect-checkout and connect-promo, and a server has
      // no reader whose locale it could ask. `appLocale()` on Deno would resolve
      // to the container's, which is nobody's. Importing src/lib/units here also
      // pulls src/lib/locale into the Deno module graph, which
      // scripts/check-functions.mjs refuses on its own terms.
      //
      // The screen that shows this to a coach is where a separator belongs, and
      // it is the one place that knows whose separator it is.
      return { ok: false, why: `the coupon takes ${pct}% off, which is not a whole percentage between 1 and 100` };
    }
    const discountCents = exactPercentOff(priceCents, pct);
    if (discountCents == null) {
      return {
        ok: false,
        // The product is fractional — that is the whole subject of the
        // sentence — and it is left bare for the reason given in the branch
        // above: this runs on the server as well as the phone. It is also a
        // COUNT OF MINOR UNITS rather than an amount, carrying no currency, so
        // `money` is not the answer either: there is nothing here to take
        // decimal places from, and inventing some would be the defect this file
        // is written against.
        why: `${pct}% of ${priceCents} minor units is ${(priceCents * pct) / 100}, which is not a whole number of them — and Stripe does not document how it rounds a percentage discount, so what it would actually charge cannot be known before the session is created`,
      };
    }
    return { ok: true, discountCents, totalCents: priceCents - discountCents };
  }

  return { ok: false, why: 'the coupon states neither a percentage nor an amount off' };
}

/**
 * What a CLIENT is told when their code cannot come off the one-off they are
 * buying.
 *
 * One sentence for every refusal `oneOffDiscount` makes, on purpose. A client
 * is not owed Repple's fee arithmetic, cannot act on "the coupon carries
 * per-currency amounts", and would read any of the precise reasons as the app
 * being broken. What they need is that the price shown is the price, and who to
 * ask. The precise reason goes to the server log, where the coach's support
 * question can be answered from it.
 */
export const CODE_CANNOT_COME_OFF_THIS_ONE =
  'That code does not come off this one. Nothing has been charged — buy it at the price shown, or check with your coach which of the things they sell it is for.';

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
    // A one-off takes a code now, and only where the discount lands on a whole
    // number of minor units. See `oneOffDiscount` and the header: Repple's cut
    // on a one-off is an absolute figure that has to be sent in the same call
    // that creates the session, so it is derived from the discounted total this
    // app worked out — and that total may only ever be one nothing had to round
    // to reach, because Stripe does not document how it rounds a percentage.
    //
    // Refused HERE rather than at the client's checkout wherever possible, so
    // the coach finds out while they are making the code rather than when the
    // first person tries to use it. The checkout runs the same arithmetic
    // again, because a package can be repriced after a code is made and a
    // ceiling checked once is a ceiling that stops being true.
    if (!Number.isInteger(target.priceCents) || target.priceCents <= 0) {
      out.push(`“${target.name}” has no usable price, so there is nothing for a percentage to come off.`);
    } else if (Number.isInteger(percentOff) && percentOff >= 1 && percentOff <= MAX_PERCENT_OFF && exactPercentOff(target.priceCents, percentOff) == null) {
      out.push(`${percentOff}% off “${target.name}” does not come to a whole number of the smallest unit of your currency, and on a one-off sale that matters: Repple’s share is an exact figure worked out from the discounted price, and Stripe does not say anywhere how it rounds a percentage. ${wholePercentsFor(target.priceCents)}`);
    }
  }
  return out;
}

/**
 * The percentages that DO come out whole on one price, as a sentence.
 *
 * The half of the refusal above that a coach can act on. "That does not divide"
 * is a fact about arithmetic; "20, 40, 50, 60 and 80 do" is a thing to type.
 * Capped at the first few so the sentence stays a sentence, and honest about
 * there being none — which is what a price like 4999 gives, and the answer then
 * is to price the pack at a round figure rather than to keep guessing.
 */
export function wholePercentsFor(priceCents: number): string {
  const works: number[] = [];
  for (let p = 1; p <= MAX_PERCENT_OFF; p += 1) {
    if (exactPercentOff(priceCents, p) != null) works.push(p);
  }
  if (!works.length) {
    // Currency-neutral on purpose. Repple is white-labelled and this sentence
    // is read by a coach charging in dirhams as often as by one charging in
    // sterling, so it describes the SHAPE of the price rather than naming a
    // money: nothing after the decimal point, whatever the decimal point is
    // worth. A yen has none at all, and the advice is silently correct there
    // too, because every yen price already is a whole one.
    return 'No whole percentage comes out exactly on this price. Give the package a price with nothing after the decimal point and every percentage works, or run the offer on a package that renews instead.';
  }
  if (works.length === MAX_PERCENT_OFF) {
    // Every price that is a whole number of MAJOR units lands here, because it
    // already divides by a hundred. Unreachable from the refusal above, which
    // only fires on a percentage that did not work, and kept because a caller
    // asking this question deserves the true answer rather than a list of the
    // first eight of ninety.
    return 'Any whole percentage comes out exactly on this price.';
  }
  const shown = works.slice(0, 8);
  const list = shown.length === 1
    ? `${shown[0]}%`
    : `${shown.slice(0, -1).map((n) => n + '%').join(', ')} and ${shown[shown.length - 1]}%`;
  const more = works.length > shown.length ? ', among others' : '';
  return `On this price ${list}${more} come${shown.length === 1 && !more ? 's' : ''} out exactly.`;
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
 * ── And what this can and cannot say about a ONE-OFF ──────────────────────
 *
 * It no longer refuses one outright. A one-off takes a code where the discount
 * lands on a whole number of minor units — see `oneOffDiscount` and the header
 * — and whether it does depends on the COUPON, which is a thing only the server
 * holds: it is resolved by `promotionCodes.list` on the coach's own Stripe
 * account, inside connect-checkout, after this function has run.
 *
 * So the division of labour changed rather than the rule. This still runs on
 * both sides and still refuses a code that is not a code; the one-off's real
 * test runs on the server only, with the coupon in hand, and a client whose
 * code fails it is told `CODE_CANNOT_COME_OFF_THIS_ONE` while the precise
 * reason goes to the log. That is the same shape as a code that does not exist
 * or belongs to another package: this screen cannot know, the server can, and
 * nothing is charged either way.
 */
export function checkoutCodeBlocker(typed: string, target: PromoTarget | null): string | null {
  const c = normaliseCode(typed);
  if (!c) return 'Type the code your coach gave you. Letters and numbers only.';
  if (c.length < 3) return 'That code is too short. Check what your coach gave you.';
  if (!target) return 'That package could not be read, so a code cannot be checked against it.';
  return null;
}

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
 *
 * This is about what Repple CREATES, and it is not a claim about what Stripe
 * holds. A coach can make an amount-off coupon in their own Stripe dashboard
 * and `promotionCodes.list` finds it exactly like one of ours, so
 * `oneOffDiscount` reads that shape too — and accepts it only where the amount
 * is in the very currency the package is sold in, which is the case this
 * sentence's objection does not cover. In any other currency it is refused, for
 * precisely the reason written above.
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
