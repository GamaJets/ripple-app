"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canOnboard = void 0;
exports.payoutStage = payoutStage;
function payoutStage(acct, read) {
    if (read === 'loading')
        return 'loading';
    // 'partial' cannot arise from a single-row read, and if it ever does it means
    // the row we are holding is not the whole answer — which is exactly the case
    // this screen must not make a claim from.
    if (read !== 'ready')
        return 'unreadable';
    if (!acct)
        return 'unreadable';
    if (acct.charges_enabled === true)
        return 'active';
    if (acct.stripe_account_id)
        return 'started';
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
const canOnboard = (s) => s === 'none' || s === 'started';
exports.canOnboard = canOnboard;
