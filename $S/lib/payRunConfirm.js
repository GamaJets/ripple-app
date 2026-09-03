"use strict";
// The question asked before a coach is marked as paid.
//
// ── The asymmetry this closes ─────────────────────────────────────────────
//
// studio-web/app/payroll/page.tsx settles a payroll run on ONE click of a
// button in a table row. `settle()` runs straight from `onClick` into
// `recordSettlement`, which writes a `payroll_settlements` row and stamps every
// session, class line and adjustment in the run with its id. Those rows then
// carry a settlement and never appear in a run again.
//
// The Reverse control eleven hundred lines below it demands a typed sentence
// (`reversalReasonBlocker`) before it will undo the same thing.
//
// studio-web/app/close/page.tsx already wrote down why that is the wrong way
// round, about a different pair of buttons on a different screen:
//
//     "So the click that needed no confirmation was the one that locks a month
//      for the whole gym, and the one that needed a typed sentence was the one
//      that unlocks it."
//
// It is the same shape here and the stakes are higher, because this is the one
// screen in the product where money LEAVES the building. /costs asks before it
// removes a single forty-pound line. Payroll asked nothing before recording
// four figures paid to a person.
//
// ── A step, not a typed reason ────────────────────────────────────────────
//
// The same call /close makes, for the same reason, in its own words: "a close
// is the ordinary, correct month-end action and making somebody write a
// sentence to do their job is how a confirmation becomes a thing people click
// through. What it must not be is one press." Running payroll is the ordinary
// correct action too. One step, carrying the figure.
//
// ── Why the figure is on the confirming button ────────────────────────────
//
// Because the row it came from is somewhere else on the screen by the time the
// question is being read, and because a person who mis-clicked one row of a
// twelve-row table is about to confirm the wrong coach. The name and the amount
// are the two facts that catch that, so both are on the last thing pressed.
//
// ── The sentence the label does not say ───────────────────────────────────
//
// "Mark as paid" records a payment. It does not make one — nothing in this
// product moves money to a coach — and a run marked paid before the transfer is
// actually sent reads, for ever afterwards, as a coach who has been paid. That
// is the mistake a person makes once, at speed, on a Friday, and it is worth
// one sentence at the point of the press.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAY_RUN_NO_LABEL = void 0;
exports.payRunStops = payRunStops;
exports.payRunHeading = payRunHeading;
exports.payRunBody = payRunBody;
exports.payRunYesLabel = payRunYesLabel;
/**
 * Why this run must not even be offered a confirmation, or null.
 *
 * The screen's own `settle()` opens with two silent `return`s — one for a
 * missing currency, one for a run with nothing on it. A button that is pressed,
 * does nothing, and says nothing is its own small defect, and it is the one
 * that survives every future reordering of the blocker chain above it. This
 * turns both into a sentence.
 */
function payRunStops(r) {
    if (rowCount(r) === 0) {
        return 'There is nothing outstanding in this run to record, so there is nothing to pay.';
    }
    if (!r.amountText) {
        return 'What this run comes to cannot be stated, so it must not be recorded as paid. '
            + 'The Owed column says which part of it is unknown.';
    }
    return null;
}
/** The question, with the two facts that catch a mis-clicked row. */
function payRunHeading(r) {
    const amt = r.amountText ?? 'this run';
    return r.who
        ? `Record ${amt} paid to ${r.who}?`
        : `Record ${amt} paid to this trainer?`;
}
/**
 * What pressing yes does, in three sentences: what leaves the run, what this
 * console is and is not doing, and what undoing it costs.
 */
function payRunBody(r) {
    return [
        `This stamps ${stamped(r)} as settled for ${r.periodLabel}. Those exact rows leave the run `
            + `and will not appear in another one.`,
        `It records that the money went out by ${r.methodLabel}. It does not send it — the transfer `
            + `is yours to make, and a run marked paid before the money moves reads afterwards as a `
            + `coach who has been paid.`,
        `Undoing it takes a written reason and leaves the settlement on the record, marked reversed.`,
    ].join(' ');
}
/** The last thing pressed, carrying the figure. */
function payRunYesLabel(r) {
    return r.amountText ? `Yes — record ${r.amountText} paid` : 'Yes — record this run paid';
}
/** The way out. Deliberately not "Cancel": on a screen where Reverse, void and
 *  cancelled-session all mean something specific, one more Cancel is a word
 *  doing two jobs. */
exports.PAY_RUN_NO_LABEL = 'Not yet';
/* ── helpers ───────────────────────────────────────────────────────────────── */
function rowCount(r) {
    return Math.max(0, r.sessions) + Math.max(0, r.classes) + Math.max(0, r.adjustments);
}
/**
 * The rows being stamped, listed — and only the kinds that are actually there.
 *
 * "3 sessions, 0 classes and 0 adjustments" reads as a form printout and buries
 * the one number that matters among two that do not.
 */
function stamped(r) {
    const parts = [];
    if (r.sessions > 0)
        parts.push(`${r.sessions} session${r.sessions === 1 ? '' : 's'}`);
    if (r.classes > 0)
        parts.push(`${r.classes} class${r.classes === 1 ? '' : 'es'}`);
    if (r.adjustments > 0)
        parts.push(`${r.adjustments} adjustment${r.adjustments === 1 ? '' : 's'}`);
    if (parts.length === 0)
        return 'nothing';
    if (parts.length === 1)
        return parts[0];
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
