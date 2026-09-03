"use strict";
// Which currency a coach is priced in, and which of the two places it came
// from — decided ONCE, here, rather than by whichever screen asked.
//
// ── The rule, in one sentence ─────────────────────────────────────────────
//
//     The gym on `profiles.tenant_id` is the authority on the currency.
//     `trainers.currency` (part 940) applies IF AND ONLY IF there is no gym.
//
// Not "whichever answered". Not "the coach's own if the gym has not set one".
// A coach inside a gym whose owner has not chosen yet is a coach WAITING ON
// THEIR OWNER: answering them from their own column would price their packages
// differently from the coach at the next desk, put a different currency on
// their invoices from the one their clients are charged in, and do it silently.
// So a gym that exists and has set nothing produces a withheld figure and a
// sentence naming the owner — exactly what it produced before part 940 — and
// the coach's own column stays dormant.
//
// ── Why this is a module and not three lines in a screen ──────────────────
//
// Because the second answer is the whole danger. `fetchInvoiceCurrency` in
// src/ui/coachInvoices.ts and `issue_coach_invoice()` in part 138 already
// disagreed about a coach's currency for a year — one read
// `profiles.tenant_id`, the other `trainers.tenant_id`, and part 711 leaves
// those two pointing at different gyms once somebody has left one. Nobody
// noticed, because both answers render perfectly. A precedence rule that lives
// in six screens is six rules.
//
// ── A failed read is not "unset", and that is most of this file ───────────
//
// The gym read returns `{ currency: null, error }` on a refused read,
// and reading the null before the error is precisely how "your gym has not set
// a currency" came to be said to coaches whose read had timed out (see
// src/lib/currencyGap.ts, which exists for that bug). The same trap is now
// doubled: a failed read of the GYM half must not fall through to the coach's
// own column, because "no gym" is then not established, and offering a coach a
// currency picker on the strength of it would let them write a currency onto
// an account that already has one.
//
// So the gym half is examined first, its failure is checked before its
// emptiness, and the coach's own half is only ever consulted once "there is no
// gym" is an ANSWER rather than an absence of one.
//
// Nothing here imports the Supabase client — the reads live in
// src/lib/myCurrency.ts, which hands the two halves to `resolveMyCurrency`
// below. That is the rule every tested module in src/lib follows and it is
// enforced by the runner: these tests are compiled by tsc and run by plain
// node, so one import of `./supabase` would take this file out of the suite.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMyCurrency = resolveMyCurrency;
exports.myCurrencyLine = myCurrencyLine;
exports.currencyFromNote = currencyFromNote;
const code = (v) => {
    const c = (v || '').trim().toUpperCase();
    return c ? c : null;
};
const gapOnly = (gap) => ({ currency: null, from: null, gap, canSetOwn: false });
/**
 * The precedence rule, applied.
 *
 * ORDER IS THE WHOLE OF IT, and it is the same order `currencyGapOf` uses for
 * the same reason: the failure is checked before the emptiness, at every step.
 *
 *   1. still reading — nothing is known.
 *   2. the gym read FAILED — unknown. Not "no gym", so the coach's own column
 *      is not consulted and no picker is offered.
 *   3. there IS a gym — its currency is the answer, set or not. The coach's
 *      own column is never read past this line.
 *   4. there is no gym — the coach's own half decides, with its own failure
 *      checked before its own emptiness.
 */
function resolveMyCurrency(gym, own, loading = false) {
    if (loading)
        return gapOnly('reading');
    // Before `hasGym`, always. A refused profile read gives `hasGym: false` and
    // reading that as "independent" is how a coach in a gym would be offered a
    // picker that writes over their gym's own setting.
    if (gym.failed)
        return gapOnly('unreadable');
    if (gym.hasGym) {
        const c = code(gym.currency);
        if (c)
            return { currency: c, from: 'gym', gap: null, canSetOwn: false };
        // A gym with no currency is the owner's to fix, and it stays that way.
        // This is the branch part 164 already serves for a coach alone in a
        // personal tenant, and `trainers.currency` is deliberately not reached.
        return gapOnly('gym-unset');
    }
    if (own.failed)
        return gapOnly('unreadable');
    if (own.unavailable)
        return gapOnly('unavailable');
    if (!own.hasRow)
        return gapOnly('nowhere');
    const c = code(own.currency);
    if (c)
        return { currency: c, from: 'own', gap: null, canSetOwn: false };
    return { currency: null, from: null, gap: 'own-unset', canSetOwn: true };
}
/**
 * The sentence to print, given the gap and what the coach loses by it.
 *
 * `consequence` is a clause continuing "…, so ___" — lower case, no full stop,
 * e.g. "there is no unit to price these sessions in". The fragment is what
 * lets one set of explanations serve six different figures without any of them
 * saying something vague about "amounts". Same contract as
 * `currencyGapLine` in src/lib/currencyGap.ts, which this is the wider sibling
 * of: that one knows about a gym, this one also knows about a coach who has
 * none.
 *
 * Only 'gym-unset' names an owner. That sentence was previously printed at
 * every one of these causes, and it is false at five of them — it sent a coach
 * whose read had timed out to chase a person about a setting that was already
 * correct, and it sent an independent coach to chase a person who does not
 * exist.
 */
function myCurrencyLine(gap, consequence) {
    const c = consequence.trim().replace(/[.]+$/, '');
    switch (gap) {
        case 'reading':
            return `Your currency is still being read, so ${c}.`;
        case 'unreadable':
            return `Your currency could not be read, so ${c}. That is a read that failed rather than a setting nobody has made — try again in a moment.`;
        case 'unavailable':
            return `Setting a currency of your own is not switched on yet, so ${c}. That is a change waiting to be applied to the database rather than anything you have done.`;
        case 'nowhere':
            return `There is no coach record on this account, so ${c}. Nothing can be set here until there is one.`;
        case 'gym-unset':
            return `Your gym has not set a currency, so ${c}. An owner sets one in the gym settings.`;
        case 'own-unset':
            return `You have not said what you charge in, so ${c}. You are attached to no gym, so it is yours to choose — you set it once in Settings.`;
    }
}
/**
 * Where the figure on screen came from, in the coach's words, or null when
 * there is nothing to say.
 *
 * Printed beside a total rather than left implicit because the two sources
 * behave differently and the coach can only act on one of them: a gym's
 * currency changes when its owner changes it, and their own changes never.
 */
function currencyFromNote(from, currency) {
    const c = code(currency);
    if (!c || !from)
        return null;
    return from === 'gym' ? `Priced in ${c}, from your gym’s setting` : `Priced in ${c}, which you set`;
}
