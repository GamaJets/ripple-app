"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The rule that stops a coach being shown a price they cannot pay.
//
// The bug: app/(trainer)/billing.tsx rendered every plan in `PLANS` and then
// disabled the button under any plan with no Stripe price id, labelling it
// "Coming Soon" and alerting "This plan needs a Stripe price id configured."
// A paying customer read a deployment note. These assertions are the shape of
// that never happening again — a plan is offered only when it can be bought.
const planOffer_1 = require("./planOffer");
const ownerMock_1 = require("./ownerMock");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};
const names = (o) => o.plans.map((p) => p.name);
const P = [{ name: 'Starter' }, { name: 'Pro' }, { name: 'Studio' }];
/* ── the reported defect ───────────────────────────────────────────────── */
// One tier live and two not is the exact state that produced the alert: a list
// where Subscribe and "Coming Soon" sat one above the other.
const partial = (0, planOffer_1.planOffer)(P, { Starter: 'price_123' });
ok(partial.buyable, 'one priced plan is enough for the list to be a real offer');
eq(names(partial), ['Starter'], 'only the plan that can be bought is offered');
const twoOfThree = (0, planOffer_1.planOffer)(P, { Starter: 'price_1', Studio: 'price_3' });
eq(names(twoOfThree), ['Starter', 'Studio'], 'the unpriced middle tier is dropped, not greyed out');
// The price table is an environment-variable bag and its key order is nobody's
// decision. The screen renders cheapest-first because PLANS is written that
// way, so the filter must follow the plans and never the table — a list that
// opened on the 249 tier reads as the price going up.
eq(names((0, planOffer_1.planOffer)(P, { Studio: 'price_3', Starter: 'price_1' })), ['Starter', 'Studio'], 'the surviving plans keep the order PLANS gave them, not the price table order');
/* ── nothing configured, which is where this project is today ──────────── */
// Every eas.json profile ships without a EXPO_PUBLIC_STRIPE_PRICE_* variable,
// so this is the live case, not a corner. Hiding all three would leave a screen
// headed Billing that does not say what the product costs.
const none = (0, planOffer_1.planOffer)(P, {});
ok(!none.buyable, 'no price ids anywhere means nothing on this screen can be bought');
eq(names(none), ['Starter', 'Pro', 'Studio'], 'so all three render, as a price list rather than an offer');
eq((0, planOffer_1.planOffer)([], {}).buyable, false, 'no plans at all is not buyable either');
eq((0, planOffer_1.planOffer)([], {}).plans, [], 'and there is nothing to list');
/* ── the ways an env-backed table lies ─────────────────────────────────── */
// `process.env.X=` sets the variable to "". Treating that as configured sends
// an empty price id to Stripe Checkout, which fails after a redirect out of the
// app — the worst place to discover it, because the coach is mid-payment.
const blank = (0, planOffer_1.planOffer)(P, { Starter: '', Pro: undefined, Studio: 'price_3' });
eq(names(blank), ['Studio'], 'an empty price id is an absent one, not a present one');
// A price id under a name no longer in PLANS — a renamed or retired tier — is
// why `buyable` is derived from the intersection rather than from
// billingAvailable(). That helper answers "is any price id set", which is true
// here, and the screen would have dropped its "not switched on" notice and then
// rendered three plans with no buttons and no explanation for their absence.
const orphan = (0, planOffer_1.planOffer)(P, { Legacy: 'price_old' });
ok(!orphan.buyable, 'a price id for a plan nobody sells does not make the list buyable');
eq(names(orphan), ['Starter', 'Pro', 'Studio'], 'and the price list is shown intact');
/* ── the real table ────────────────────────────────────────────────────── */
// Guards the join between the two files that have to agree: a plan renamed in
// ownerMock without its EXPO_PUBLIC_STRIPE_PRICE_* counterpart being renamed
// silently stops being sellable, and this is the only place that would notice.
eq(names((0, planOffer_1.planOffer)(ownerMock_1.PLANS, { Starter: 'p1', Pro: 'p2', Studio: 'p3' })), ['Starter', 'Pro', 'Studio'], 'the three real plan names are exactly the three the price table is keyed on');
ok(ownerMock_1.PLANS.every((p) => p.name.trim().length > 0), 'every real plan has a name to key a price id on');
if (errors.length) {
    errors.forEach((e) => console.error('FAIL', e));
    process.exit(1);
}
console.log('planOffer: ok — nothing is offered that cannot be bought');
