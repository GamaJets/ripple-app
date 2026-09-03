"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayAllowed = dayAllowed;
exports.monthHasAllowedDay = monthHasAllowedDay;
exports.dayRefusal = dayRefusal;
// Days a field will not take, decided before the coach taps one.
//
// ── The report behind it ──────────────────────────────────────────────────
//
// `src/ui/DateSheet.tsx` put a month over four fields that already refused
// certain days. The worst of them is the one on app/(trainer)/invoices.tsx that
// records the day an invoice was paid: `settleDayBlocker` refuses a day before
// the invoice was written and a day after today, and both refusals are correct
// — money cannot have arrived before the document existed, and money recorded
// as arriving tomorrow is a figure in a ledger that has not happened.
//
// A calendar that draws all thirty of March and then refuses the eleven the
// coach can actually reach is a worse control than the text box it replaced.
// The coach taps, reads a sentence telling them no, taps again, reads it again.
// A grid's whole advantage is that the answer is visible before the finger
// moves, and a greyed cell is that advantage; a refusal after the tap is the
// text box with extra steps.
//
// So the sheet is given a range and draws the days outside it as unreachable.
// This module is the arithmetic, kept out of the component so it can be
// asserted without rendering anything.
//
// ── A bound that cannot be read blocks nothing ────────────────────────────
//
// Every bound here arrives from a row: `inv.issuedOn`, the coach's own `today`,
// the other end of a statement period. Any of them can come back as null, as ''
// or as something this build cannot parse, and the tempting reading — "I cannot
// tell whether this day is allowed, so refuse it" — produces a calendar with
// every single cell greyed out and no way forward at all. That is the shape of
// failure this codebase keeps finding: a screen that says nothing is possible
// because one read came back empty.
//
// An unreadable bound is therefore IGNORED, and the caller's own blocker — the
// one on the write, in src/lib/coachInvoice.ts — is still there and still says
// no. Widening the calendar cannot let a bad day through; it can only let the
// coach reach the refusal they would have reached before this file existed.
//
// ── Where the wording comes from ──────────────────────────────────────────
//
// `dayRefusal` takes the day formatter rather than importing one, so the
// sentence it composes is asserted in a test under six timezones and every
// locale without the assertion being about what Intl does on the runner. The
// screens hand it `fmtFullDay`, which is the reader's own language and order.
const programStart_1 = require("./programStart");
const monthGrid_1 = require("./monthGrid");
/** A bound this build can actually compare against, or null. Not exported: a
 *  caller asking "is this a day" should ask `isStartDate`, which is the one
 *  answer to that question in this codebase. */
function bound(v) {
    const s = String(v ?? '').trim();
    return (0, programStart_1.isStartDate)(s) ? s : null;
}
/**
 * Whether a day can be chosen under this range.
 *
 * False for anything that is not a readable calendar day, so a caller can hand
 * it a half-typed string without checking first. `YYYY-MM-DD` compares
 * correctly as a string once both sides are known to be that shape, which
 * `isStartDate` and `bound` have both established by the time the comparison
 * happens — no Date is constructed here and none is needed.
 */
function dayAllowed(iso, range) {
    const day = String(iso ?? '').trim();
    if (!(0, programStart_1.isStartDate)(day))
        return false;
    if (!range)
        return true;
    const lo = bound(range.min);
    const hi = bound(range.max);
    if (lo && day < lo)
        return false;
    if (hi && day > hi)
        return false;
    return true;
}
/**
 * Whether any day of this month can be chosen — what decides whether a month
 * is worth stepping to at all.
 *
 * Two contiguous spans overlap, so this is an interval intersection and not a
 * test of the month's two ends. The first draft WAS that test — "if neither the
 * 1st nor the last is allowed, nothing between them is" — and it is false for
 * exactly the case a coach hits: a range that sits INSIDE one month, which is
 * every invoice issued this month and settled this month. It said March had no
 * reachable day while the 10th was sitting in the middle of it, and the sweep
 * in the test beside this file is what said so.
 *
 * `month` is 0-11 as everywhere else here, and out-of-range months are
 * normalised by `daysInMonth`/`isoFromParts` rather than being an error, so a
 * caller can ask about the month after December.
 */
function monthHasAllowedDay(year, month, range) {
    if (!range)
        return true;
    const lo = bound(range.min);
    const hi = bound(range.max);
    if (!lo && !hi)
        return true;
    // A pair the wrong way round is empty, and is left empty rather than swapped:
    // a calendar that offered days a caller had ruled out would be worse than one
    // offering none, and nothing in the app builds one.
    if (lo && hi && lo > hi)
        return false;
    const first = (0, monthGrid_1.isoFromParts)(year, month, 1);
    const last = (0, monthGrid_1.isoFromParts)(year, month, (0, monthGrid_1.daysInMonth)(year, month));
    if (lo && last < lo)
        return false;
    if (hi && first > hi)
        return false;
    return true;
}
/**
 * Why this day cannot be chosen, in one sentence, or null when it can.
 *
 * Three refusals and they are ordered, because a coach who typed "next friday"
 * needs to be told the shape before they are told the range. Nothing here
 * corrects anything: a date this app cannot read is never stored, for the
 * reason `isStartDate`'s own header gives — a stored unparseable value puts
 * every screen that reads it back into "unreadable" for ever.
 *
 * `dayLabel` formats a bound for the reader. It is a parameter and not an
 * import so this stays a pure function of its inputs: the screens pass
 * `fmtFullDay`, which asks the handset what language and what order, and the
 * test passes one that does not.
 */
function dayRefusal(iso, range, dayLabel) {
    const day = String(iso ?? '').trim();
    if (!(0, programStart_1.isStartDate)(day)) {
        return 'That is not a day this app can read. Write it as year, month and day — 2026-09-07 — or pick it off the calendar above.';
    }
    const lo = bound(range?.min);
    const hi = bound(range?.max);
    if (lo && day < lo)
        return `This field takes nothing earlier than ${dayLabel(lo)}, so that day is not one it can be given.`;
    if (hi && day > hi)
        return `This field takes nothing later than ${dayLabel(hi)}, so that day is not one it can be given.`;
    return null;
}
