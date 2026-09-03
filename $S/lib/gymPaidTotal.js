"use strict";
// What one member has paid, when "one member" has paid in more than one money.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// /members had two of them. The roster's Paid column and the dossier's "Paid,
// all time" tile both rendered `MemberDossier.paidCents`, which is
//
//   pays.reduce((a, p) => a + p.amountCents, 0)
//
// — every payment added together with no regard to `p.currency` — under the
// gym's CURRENT `tenants.currency`. The payments table three inches below
// renders each row with `money(p.amountCents, p.currency)`, honestly.
//
// So a gym that has ever changed currency showed one tile reading AED 4,300
// over a list of GBP and AED rows. That tile is the figure an owner reads down
// the phone when a member queries their account, and it is not a total: it is a
// bigger number with three letters stamped on it that belong to some of its
// parts.
//
// ── Why a verdict rather than a number ─────────────────────────────────────
//
// Because there are six answers and only one of them is a number, and every
// screen that tried to express this in a ternary picked three of the six. The
// read may not have finished; it may have failed; the member may have paid
// nothing; the rows may exist and state no amount or no currency, which is not
// nothing; there may be one currency, which prints; or there may be two, which
// does not and must say why.
//
// The grouping itself is `sumTaken` in src/lib/coachMoney.ts — the same
// function /analytics and /revenue total with — so there is one implementation
// of "never add two currencies" rather than a second one here that can drift
// from it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.paidTotal = paidTotal;
exports.paidNote = paidNote;
const coachMoney_1 = require("./coachMoney");
/**
 * What this member has paid.
 *
 * `state` is the slice state of the payments read, and it is taken separately
 * from the rows for the reason the rest of this codebase keeps them apart: an
 * empty array from a refused read and an empty array from a gym that has never
 * billed this person are the same array.
 */
function paidTotal(state, rows) {
    if (state === 'failed' || state === 'error')
        return { kind: 'failed' };
    if (state !== 'ready' && state !== 'partial')
        return { kind: 'loading' };
    if (rows == null)
        return { kind: 'failed' };
    const t = (0, coachMoney_1.sumTaken)(rows.map((r) => ({ amount_cents: r.amountCents, currency: r.currency, created_at: '' })));
    const unstated = t.unlabelled + t.unpriced;
    if (t.pots.length === 0) {
        return unstated > 0 ? { kind: 'unstated', count: unstated } : { kind: 'none' };
    }
    if (t.pots.length > 1) {
        return { kind: 'many', currencies: t.pots.map((p) => p.currency) };
    }
    return { kind: 'one', currency: t.pots[0].currency, minorUnits: t.pots[0].minorUnits, short: unstated };
}
/**
 * The line under the figure, or the line instead of one.
 *
 * `last` is the caller's already-formatted "last paid" phrase, shown only where
 * there is a whole figure to date — a caption about recency under a tile that
 * is refusing to state a total reads as though the total were fine.
 */
function paidNote(t, last) {
    switch (t.kind) {
        case 'loading': return undefined;
        case 'failed': return 'payments not read';
        case 'none': return 'nothing recorded';
        case 'unstated':
            return `${t.count} payment${t.count === 1 ? '' : 's'} on record ${t.count === 1 ? 'states' : 'state'} no amount or no currency, so a total cannot be written`;
        case 'many':
            return `paid in ${t.currencies.join(' and ')} — two currencies are not one total, so the figure is on each payment below instead`;
        case 'one':
            return t.short > 0
                ? `${t.short} further payment${t.short === 1 ? '' : 's'} states no amount or no currency and ${t.short === 1 ? 'is' : 'are'} not in this figure`
                : last;
    }
}
