"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAUGHT_SCOPE_NOTE = void 0;
exports.rollingWindow = rollingWindow;
exports.splitTaught = splitTaught;
exports.showRateOf = showRateOf;
exports.paidHeadcount = paidHeadcount;
exports.paidHeadcountTotal = paidHeadcountTotal;
exports.classLine = classLine;
exports.gapNote = gapNote;
exports.walkInsKnown = walkInsKnown;
/**
 * The last `days` days, ending now.
 *
 * Rolling rather than calendar, and deliberately: nobody is paid against this
 * window, and "the last 30 days" is what a coach means when they ask how their
 * classes have been going. `setDate` on a local Date, so the boundary is the
 * coach's own midnight — the same choice app/(owner)/class-analytics.tsx makes
 * for the same reason, and the one that stops an evening class on the last day
 * of a month landing in the next one because Greenwich says so.
 */
function rollingWindow(now, days) {
    if (!Number.isFinite(days) || days <= 0)
        return null;
    const t = now.getTime();
    if (!Number.isFinite(t))
        return null;
    const from = new Date(t);
    from.setDate(from.getDate() - days);
    return { fromISO: from.toISOString(), toISO: new Date(t).toISOString(), label: `the last ${days} days` };
}
function splitTaught(rows) {
    const registered = [];
    const unregistered = [];
    const noBookings = [];
    for (const r of rows) {
        const marked = r.attended > 0 || (r.waitlistAttended ?? 0) > 0;
        if (marked)
            registered.push(r);
        else if (r.booked > 0)
            unregistered.push(r);
        else
            noBookings.push(r);
    }
    return { registered, unregistered, noBookings };
}
/**
 * Of the people who booked one class, the proportion who were marked present —
 * or null when nobody booked it.
 *
 * The same rule `registerArc` in src/lib/classRegister.ts states over live
 * register rows, applied to the aggregated row the server returns for a class
 * that has already been taught. Null and not 0 for a class nobody booked: a
 * ring drawn at zero says nobody turned up, and nobody was expected.
 *
 * It cannot exceed 1. `class_attendance_summary` filters its numerator to
 * `status = 'booked'` (part 460), which is the server-side half of the same fix
 * classRegister.ts is the client-side half of.
 */
function showRateOf(row) {
    if (row.booked <= 0)
        return null;
    return row.attended / row.booked;
}
/**
 * The headcount a gym pays a per-attendee class on: everybody who was marked
 * present, off the register and off the door.
 *
 * NULL when the walk-ins are unknown, which is a database without part 460's
 * `waitlist_attended` column. Not zero. `classPayBlocker` in src/lib/gymPay.ts
 * makes exactly this refusal on the gym's side and says why in the sentence
 * this comment keeps quoting; a coach's own copy of the figure has no business
 * being more confident than the payroll it is a copy of.
 */
function paidHeadcount(row) {
    if (row.waitlistAttended == null)
        return null;
    return row.attended + row.waitlistAttended;
}
/**
 * The same across a set of classes, or null if a single row cannot answer.
 *
 * All-or-nothing rather than a sum over the rows that can: a partial total
 * looks exactly like a whole one and would understate what a coach delivered,
 * which is the direction this figure must never be wrong in.
 */
function paidHeadcountTotal(rows) {
    let sum = 0;
    for (const r of rows) {
        const n = paidHeadcount(r);
        if (n == null)
            return null;
        sum += n;
    }
    return sum;
}
/**
 * The line under one class.
 *
 * Three facts kept as three, in classRegister.ts's shape: how many of the
 * booked were here, how many came off the waitlist, and — where it applies —
 * that nobody marked the class at all. The walk-ins are never added to the
 * first figure and never subtracted from it.
 *
 * No sentence in here says "missed", and none of them says a number about a
 * class whose walk-ins are unknown.
 */
function classLine(row) {
    const walkKnown = row.waitlistAttended != null;
    const walk = row.waitlistAttended ?? 0;
    const walkPart = !walkKnown
        ? ' Walk-ins are not recorded on this gym, so the headcount you were owed for may be higher.'
        : walk > 0
            ? ` ${walk} ${walk === 1 ? 'person' : 'people'} came off the waitlist and ${walk === 1 ? 'is' : 'are'} counted separately.`
            : '';
    if (row.attended === 0 && walk === 0) {
        if (row.booked === 0)
            return `Nobody booked this one.${walkPart}`;
        return `${row.booked} booked and nothing was marked against anybody — this is a register that was not taken, not a class nobody came to.${walkPart}`;
    }
    if (row.booked === 0)
        return `Nobody booked this one.${walkPart}`;
    return `${row.attended} of the ${row.booked} booked were marked here.${walkPart}`;
}
/**
 * What is missing from the figures above this, or null when nothing is.
 *
 * One sentence, said once, near the totals rather than on every row. The two
 * gaps are different and are never merged: classes with no register taken are a
 * hole in the RATE, and unknown walk-ins are a hole in the HEADCOUNT.
 */
function gapNote(split, walkInsKnown) {
    const parts = [];
    const u = split.unregistered.length;
    if (u > 0) {
        parts.push(`${u} ${u === 1 ? 'class had' : 'classes had'} bookings and no register taken. `
            + `${u === 1 ? 'It is' : 'They are'} left out of the rate rather than counted as nobody turning up.`);
    }
    if (!walkInsKnown) {
        parts.push('This gym does not record walk-ins separately, so no headcount is shown — an unknown number of people is not nought of them.');
    }
    return parts.length ? parts.join(' ') : null;
}
/** True when every row can answer for its walk-ins. False means part 460 has
 *  not been applied here and the column is genuinely absent — which is not the
 *  same as a term in which nobody walked in. */
function walkInsKnown(rows) {
    return rows.every((r) => r.waitlistAttended != null);
}
/**
 * The sentence about what this list is NOT.
 *
 * `class_attendance_summary` admits a class on `gc.trainer_id = auth.uid()`.
 * Part 460 widened the REGISTER to a gym's staff — cover, illness, a swap in
 * the group chat — and did not widen this read, and part 165 records that every
 * class the web console created carries `trainer_id` NULL. So a coach can take
 * a register for a class that will never appear on this screen, and the absence
 * of it here is not evidence they did not teach it. Stated on the page, because
 * a coach counting their own term against this list would otherwise count short.
 */
exports.TAUGHT_SCOPE_NOTE = 'Only classes recorded against your name are here. A class you covered for somebody, or one the '
    + 'front desk set up without naming you, is not on this list — and that is not evidence you did '
    + 'not teach it.';
