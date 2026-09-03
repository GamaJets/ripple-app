"use strict";
// Reconciling a figure the owner typed against the same figure Repple can
// work out for itself.
//
// The financial-health screen asks an owner to type their recurring membership
// revenue and their active member count. Both are things the database already
// knows: memberships on priced plans give one, memberships with status
// 'active' give the other. Two sources for one number that nothing compares is
// how a console starts contradicting itself — one screen says AED 40,000 and
// another says AED 34,500, and neither admits the other exists.
//
// This does not pick a winner. An owner typing a different number from the one
// the records imply is usually right about something the records do not hold —
// a corporate contract invoiced annually offline, a plan whose price changed
// mid-month. Silently overwriting that would replace one wrong number with
// another and lose the owner's knowledge in the process. So the rule is:
// surface the difference, name both figures, and let the person decide.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcile = reconcile;
exports.unreadable = unreadable;
exports.reconcileNote = reconcileNote;
/**
 * Compare a typed figure with a derived one.
 *
 * `tolerance` is a fraction of the derived value, not an absolute amount, so
 * the same rule works for a figure in dirhams and a headcount. It defaults to
 * 2%: rounding, a payment landing a day late or a mid-month price change should
 * not raise a flag, but a genuinely different number should.
 *
 * A derived value of null means the records hold nothing — no priced plan, no
 * membership. That is `no_record`, never a derived zero, because "we have not
 * recorded it" and "it is nothing" are different answers and only one of them
 * should make an owner doubt what they typed.
 */
function reconcile(typed, derived, tolerance = 0.02) {
    if (derived == null) {
        return { state: 'no_record', typed, derived: null, delta: null, driftPct: null };
    }
    if (!typed) {
        return { state: 'not_entered', typed, derived, delta: null, driftPct: null };
    }
    const delta = derived - typed;
    // Guard the divide: a derived zero is a real measurement (nobody active), but
    // it cannot be a denominator.
    const driftPct = derived === 0 ? (delta === 0 ? 0 : 1) : Math.abs(delta) / Math.abs(derived);
    return {
        state: driftPct <= tolerance ? 'agrees' : 'differs',
        typed,
        derived,
        delta,
        driftPct,
    };
}
/**
 * The comparison a caller whose read FAILED should show.
 *
 * Separate from `reconcile()` rather than a fourth branch inside it, because
 * `reconcile()` is pure over its two arguments and genuinely cannot distinguish
 * an empty register from an unread one — only the caller holding the rejected
 * promise can. Every derived field is null, as under `no_record`: nothing here
 * is known, and a screen must not offer a "Use It" button for a figure that was
 * never read.
 */
function unreadable(typed) {
    return { state: 'unreadable', typed, derived: null, delta: null, driftPct: null };
}
/**
 * A sentence for the screen, or null when there is nothing worth saying.
 *
 * `agrees` returns null on purpose. A console that congratulates itself every
 * time two numbers match trains people to stop reading it; the interesting
 * states are the ones that need an action.
 */
function reconcileNote(r, label, fmt = String) {
    switch (r.state) {
        case 'no_record':
            return `Nothing recorded yet, so your ${label} cannot be checked against the register.`;
        case 'unreadable':
            // Says what happened and what it is NOT, because the sentence above is
            // what this used to render and an owner has to be able to tell them apart.
            return `Your register could not be read, so your ${label} has not been checked — this is a failed read, not an empty register.`;
        case 'not_entered':
            return `Your records show ${fmt(r.derived)}. Use that, or type your own figure.`;
        case 'differs':
            return `Your records show ${fmt(r.derived)}, which is ${fmt(Math.abs(r.delta))} ${r.delta > 0 ? 'more' : 'less'} than the ${fmt(r.typed)} entered here.`;
        case 'agrees':
        default:
            return null;
    }
}
