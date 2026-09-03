"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Whether the coach can be paid, and whether we know. Compile with tsc, run
// with node.
//
// The bug this guards: `fetchMyConnect` answers null for "could not read" and a
// zeroed row for "no account", and said in its own comment that the caller
// renders those differently. The payments screen collapsed them back into
// `!conn?.charges_enabled` and drew a failed read as "Set Up Payouts" — with
// the button that onboards a second Stripe account under it. These assertions
// pin the two things that must never be true again: a failed read is not an
// absent account, and onboarding is not offered from a stage we could not read.
const payoutAccount_1 = require("./payoutAccount");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const NONE = { stripe_account_id: null, charges_enabled: false, details_submitted: false, account_type: null };
const STARTED = { stripe_account_id: 'acct_1', charges_enabled: false, details_submitted: true, account_type: 'standard' };
const LIVE = { stripe_account_id: 'acct_1', charges_enabled: true, details_submitted: true, account_type: 'standard' };
/* ── the three answers a read can give ─────────────────────────────────── */
eq((0, payoutAccount_1.payoutStage)(NONE, 'ready'), 'none', 'a zeroed row is a coach with no account');
eq((0, payoutAccount_1.payoutStage)(STARTED, 'ready'), 'started', 'an account Stripe has not enabled is started');
eq((0, payoutAccount_1.payoutStage)(LIVE, 'ready'), 'active', 'charges enabled is active');
/* ── and the two where there is no answer ──────────────────────────────── */
eq((0, payoutAccount_1.payoutStage)(null, 'loading'), 'loading', 'nothing has come back yet');
eq((0, payoutAccount_1.payoutStage)(null, 'error'), 'unreadable', 'a failed read is unreadable');
// The defect, stated directly. This is what payments.tsx drew as "Set Up
// Payouts" and money.tsx drew as "You have no Stripe payout account".
ok((0, payoutAccount_1.payoutStage)(null, 'error') !== 'none', 'a failed read is NOT an absent account');
ok((0, payoutAccount_1.payoutStage)(null, 'loading') !== 'none', 'a read in flight is NOT an absent account');
// A coach whose account is live, on a bad connection. The rows are gone, the
// status is 'error', and the screen must not say anything about their account.
eq((0, payoutAccount_1.payoutStage)(LIVE, 'error'), 'unreadable', 'a live account under a failed read is unreadable, not active');
eq((0, payoutAccount_1.payoutStage)(LIVE, 'partial'), 'unreadable', 'a truncated read is not a whole answer about one account');
// Success that produced nothing is a contradiction — fetchMyConnect returns a
// zeroed row on success — and it resolves the safe way. "We could not check"
// costs one retry; "you have no payout account" costs a duplicate Stripe
// account with the coach's passport in it.
eq((0, payoutAccount_1.payoutStage)(null, 'ready'), 'unreadable', 'ready with no row is unreadable, never none');
eq((0, payoutAccount_1.payoutStage)(undefined, 'ready'), 'unreadable', 'undefined is treated the same as null');
/* ── who may be handed the onboarding button ───────────────────────────── */
ok((0, payoutAccount_1.canOnboard)('none'), 'a coach with no account may onboard');
ok((0, payoutAccount_1.canOnboard)('started'), 'a coach mid-onboarding may continue');
ok(!(0, payoutAccount_1.canOnboard)('unreadable'), 'a read we could not make must NOT offer onboarding');
ok(!(0, payoutAccount_1.canOnboard)('loading'), 'a read still in flight must NOT offer onboarding');
ok(!(0, payoutAccount_1.canOnboard)('active'), 'a coach already taking money is not offered onboarding');
/* ── the invariant, over every stage there is ──────────────────────────── */
// Onboarding is offered ONLY from a stage the account was actually read in.
// Written as a sweep rather than as three more `ok`s so that a sixth stage
// added later cannot quietly default into the onboardable set — which is
// exactly how 'unreadable' ended up under the button in the first place.
const ALL = ['loading', 'unreadable', 'none', 'started', 'active'];
const READ = ['none', 'started', 'active'];
for (const s of ALL) {
    ok(!(0, payoutAccount_1.canOnboard)(s) || READ.includes(s), `${s} may only offer onboarding if it was read`);
}
eq(ALL.filter(payoutAccount_1.canOnboard).join(','), 'none,started', 'and exactly two stages do');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('payoutAccount.test.ts — all assertions passed');
