"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currencyStepDone = currencyStepDone;
/**
 * The first-run fact for the currency step.
 *
 * `null` in means the read itself did not come back — `Promise.allSettled`
 * rejected — which is the same unknown as a failed resolve.
 */
function currencyStepDone(cur) {
    if (!cur)
        return null;
    if ((cur.currency || '').trim())
        return true;
    return cur.gap === 'gym-unset' || cur.gap === 'own-unset' ? false : null;
}
