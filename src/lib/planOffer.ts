// Which plans a coach is shown, and whether any of them can be bought.
//
// ── The defect this replaces ──────────────────────────────────────────────
//
// app/(trainer)/billing.tsx rendered every entry in `PLANS` with a Subscribe
// button, and gated that button on `PRICE_IDS[plan.name]` existing. A plan with
// no price id therefore rendered a disabled button reading "Coming Soon", and
// pressing it alerted:
//
//     This plan needs a Stripe price id configured.
//
// That is a sentence for the person who deploys the app, shown to the person
// paying for it. A coach reading it learns that something is unconfigured, that
// there is a thing called a price id, and nothing whatsoever about when they
// might be able to buy the plan they just tried to buy. Worse, it appeared on
// the SAME list as plans that did work — so the price list said "Pro, 99/mo"
// with a dead button beside it while Starter was live directly above. A price
// list is a promise; half of it was not one.
//
// "Coming Soon" is not a fix either. It is a claim about the future that
// nothing in this repo can keep: a price id is an environment variable, and no
// date, decision or intent is attached to its absence. A plan is either for
// sale or it is not.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// A plan is OFFERED only when it can be bought — when it has a price id that
// `subscribeToPlan` can hand to Stripe Checkout. Everything else is hidden, and
// nothing dead is ever rendered.
//
// The one exception is the state where NOTHING can be bought, which is where
// this project is today: no EXPO_PUBLIC_STRIPE_PRICE_* variable is set in any
// eas.json profile. Hiding all three plans there would leave a coach on a
// screen headed "Billing" with no idea what the product costs or what the tiers
// are, which is less useful than the broken version was. So in that state the
// same plans render as a price list with no buttons at all, under the notice
// the screen already shows ("Billing is not switched on"). Nothing to press is
// honest; something that cannot be pressed is not.
//
// ── Why this lives here and not inline in the screen ──────────────────────
//
// Because it is the one rule on that screen that decides whether a customer is
// shown a price they cannot act on, and a rule like that is worth a test that
// fails when somebody changes it. src/lib/planOffer.test.ts is that test. The
// screen keeps the rendering; this keeps the decision.

/** The minimum a plan has to be for this file to have an opinion about it. */
export interface NamedPlan {
  name: string;
}

/**
 * What the billing screen should put on the page.
 *
 * `buyable` is deliberately derived from the plans themselves rather than read
 * off the price-id table. `billingAvailable()` in src/lib/billing.ts asks
 * whether ANY price id is set, which is a different question: a price id under
 * a name that is no longer in `PLANS` — a renamed tier, a removed one — makes
 * that true while leaving nothing on the screen to buy. The screen would then
 * drop its "not switched on" notice and render a list of plans with no
 * buttons and no explanation. Asking about the intersection cannot drift that
 * way, because it is the intersection the screen actually renders.
 */
export interface PlanOffer<P extends NamedPlan> {
  /** The plans to render, in the order they were given. */
  plans: P[];
  /** Whether those plans carry a working Subscribe button. */
  buyable: boolean;
}

/**
 * Decide what to show.
 *
 * `priceIds` is the raw environment-backed table, so an empty string is treated
 * exactly as an absent one: `process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO=""` is a
 * variable somebody set and left blank, and handing "" to Stripe Checkout fails
 * at the far end of a redirect rather than here.
 */
export function planOffer<P extends NamedPlan>(
  plans: readonly P[],
  priceIds: Readonly<Record<string, string | undefined>>,
): PlanOffer<P> {
  const priced = plans.filter((p) => !!priceIds[p.name]);
  return priced.length > 0
    ? { plans: priced, buyable: true }
    : { plans: [...plans], buyable: false };
}
