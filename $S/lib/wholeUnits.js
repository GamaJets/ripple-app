"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_CURRENCY_CHECK_NOTE = void 0;
exports.wholeFromMinor = wholeFromMinor;
// A stored minor-unit integer, back as the WHOLE-UNIT NUMBER a person typed.
//
// ── Why this is not `cents / 100` ─────────────────────────────────────────
//
// src/lib/coachMoney.ts already argues the whole case and holds the two lists
// this depends on: `ZERO_DECIMAL` (a yen has no sen — ¥5,000 is stored as the
// integer 5000) and `THREE_DECIMAL` (a Kuwaiti dinar has 1000 fils in it). The
// factor is a property of the currency, not of money, and it is 1, 100 or 1000.
//
// app/(owner)/financials.tsx is the screen that forced this file. It is the one
// screen in the owner app whose entire job is checking the figures an owner
// TYPED against the same figures worked out from the register, and it did the
// conversion as `Math.round(sum.mrrCents / 100)`. On a gym billing in yen that
// turned a real ¥500,000 of recurring revenue into 5,000, told the owner their
// records disagreed with what they had entered, and offered a "Use It" button
// that would overwrite their correct figure with the wrong one — after which
// the health score, the grade and the net-profit sentence are all computed from
// it. In Kuwaiti dinar it went the other way and ten times too big.
//
// ── Why the inverse lives here and not beside `minorFromWhole` ────────────
//
// It would be better placed next to its own mirror image in coachMoney.ts, and
// this file exists in this shape only because that module is another lane's
// this session. It imports `currencyDecimals` from there rather than repeating
// the two lists, because a second copy of the zero-decimal set is a second
// thing to forget a currency in — which is the mistake the whole family of
// functions exists to prevent.
//
// ── Null, never zero, and never a guess ───────────────────────────────────
//
// There is no default currency in this product, so there is no default factor
// either. With no currency the stored integer could be hundredths of something
// or whole units of it, and the caller is handed null so it can withhold the
// figure. A caller that turns that null into a 0 has reintroduced the bug in a
// louder form: a zero is a claim, and this one would be a claim about somebody's
// revenue.
const coachMoney_1 = require("./coachMoney");
/**
 * A minor-unit amount as a whole-unit number, or null when it cannot be known.
 *
 * The counterpart of `minorFromWhole` in src/lib/coachMoney.ts, and the numeric
 * counterpart of `majorFromMinor` — that one returns the STRING a person types
 * into a field, which is right for pre-filling a box and wrong for a comparison,
 * because `'12.50' > 100` is not arithmetic anybody meant.
 *
 * Rounded rather than truncated, and rounded on the division rather than
 * reconstructed from digits: the caller of this is comparing against a figure a
 * person typed in whole units, so a fraction of a unit is below the resolution
 * of the question being asked. `majorFromMinor` is the one to reach for when
 * the fraction matters.
 */
function wholeFromMinor(minorUnits, currency) {
    const dp = (0, coachMoney_1.currencyDecimals)(currency);
    if (dp == null || minorUnits == null || !Number.isFinite(minorUnits))
        return null;
    if (dp === 0)
        return Math.trunc(minorUnits);
    return Math.round(minorUnits / 10 ** dp);
}
/**
 * What a screen says where a check against the register would go, when the gym
 * has not set a currency.
 *
 * One wording in one place, for the reason `NO_ZONE_NOTE` in src/lib/gymZone.ts
 * and `NO_PAY_POLICY_NOTE` in src/lib/gymPolicy.ts both give. It is deliberately
 * NOT `reconcileNote`'s "Nothing recorded yet, so your MRR cannot be checked
 * against the register" — that sentence sends an owner looking for memberships
 * they entered correctly, when what is actually missing is one field in Ops.
 */
exports.NO_CURRENCY_CHECK_NOTE = 'This gym has not set its currency, so the amounts in the register cannot be '
    + 'scaled into an amount to check this against. Set the currency in Ops and '
    + 'this check works from that moment on. Nothing you have typed has changed.';
