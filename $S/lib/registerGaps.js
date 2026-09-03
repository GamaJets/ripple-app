"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missingRegisters = missingRegisters;
exports.peopleWaiting = peopleWaiting;
exports.gapsHeading = gapsHeading;
exports.gapsNote = gapsNote;
exports.gapLine = gapLine;
const coachRegister_1 = require("./coachRegister");
/** Milliseconds since the epoch for an ISO instant, or null when it is not one. */
function instant(iso) {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
}
/**
 * The classes with bookings and no register, newest first.
 *
 * `now` is the coach's own instant — the same one the screen's window is built
 * from — and is only ever used to drop classes that have not happened yet
 * (rule 2). It never decides that a register is too old to take: nothing in the
 * database thinks so, and a screen that hid a three-month-old gap would be
 * hiding the one the coach most needs to be told about.
 */
function missingRegisters(rows, now) {
    const nowMs = now.getTime();
    const cutoff = Number.isFinite(nowMs) ? nowMs : null;
    const out = [];
    for (const r of (0, coachRegister_1.splitTaught)(rows).unregistered) {
        const at = instant(r.startsAt);
        // Rule 2. An unreadable start is NOT excluded here — see rule 3; only a
        // start we can read AND that is in the future is.
        if (at != null && cutoff != null && at > cutoff)
            continue;
        out.push({
            at,
            gap: {
                classId: r.classId,
                title: r.title,
                branch: r.branch,
                startsAt: r.startsAt,
                booked: r.booked,
            },
        });
    }
    // Rule 4, and rule 3's "sorted last": a null start sorts after every readable
    // one, whichever side of the comparison it is on.
    out.sort((a, b) => {
        if (a.at == null && b.at == null)
            return a.gap.classId.localeCompare(b.gap.classId);
        if (a.at == null)
            return 1;
        if (b.at == null)
            return -1;
        return (b.at - a.at) || a.gap.classId.localeCompare(b.gap.classId);
    });
    return out.map((x) => x.gap);
}
/**
 * How many people are sitting in those classes unaccounted for, or null when
 * one of the rows cannot say.
 *
 * Rule 5. `booked` arrives through `Number(r.booked || 0)` in
 * src/lib/classAttendance.ts, so a column that came back as text or absent
 * lands here as NaN or 0 — and 0 is a real answer while NaN is not.
 */
function peopleWaiting(gaps) {
    let sum = 0;
    for (const g of gaps) {
        if (!Number.isFinite(g.booked) || g.booked < 0)
            return null;
        sum += g.booked;
    }
    return sum;
}
/**
 * The heading over the list, or null when there is nothing to head.
 *
 * Null and not "0 registers outstanding": a coach who has taken every register
 * should not be shown a section congratulating them on it every time they open
 * the screen. The absence IS the message.
 */
function gapsHeading(gaps) {
    const n = gaps.length;
    if (n === 0)
        return null;
    return n === 1 ? '1 register still open' : `${n} registers still open`;
}
/**
 * What those open registers cost, said once, above the list.
 *
 * Two claims and both are load-bearing:
 *
 *   · the gym reads these classes as nobody having attended. That is what
 *     `class_attendance_summary` returns for a class with no `attended_at`
 *     anywhere on it, and it is what `classPayAmount` prices a per-attendee
 *     class on.
 *   · it can still be fixed. `set_class_attendance` has no time bound.
 *
 * What it deliberately does NOT say is that taking the register will get the
 * coach paid. Whether a gym has already run its payroll for that period is a
 * fact this screen has not read and must not imply — `payroll_settlements` is
 * readable by the coach but it settles SESSIONS, and whether a gym folds class
 * pay into the same run is a thing each gym decides. So the sentence stops at
 * the record, which is the part this app can stand behind.
 */
function gapsNote(gaps) {
    if (gaps.length === 0)
        return null;
    const people = peopleWaiting(gaps);
    const who = people == null
        ? 'The people who booked them'
        : people === 1
            ? 'The 1 person who booked'
            : `The ${people} people who booked them`;
    return `${who} reach your gym's record as nobody having attended. A register has no closing time — open one and mark it now, and the class counts.`;
}
/**
 * The line under one open register.
 *
 * `booked` and nothing else. The screen already prints the date and the class's
 * own title above it, and the number of places held is the only fact here that
 * says how much is missing.
 */
function gapLine(gap) {
    if (!Number.isFinite(gap.booked) || gap.booked < 0) {
        return 'Nobody was marked on this one, and how many booked could not be read.';
    }
    if (gap.booked === 1)
        return '1 person booked and nobody was marked.';
    return `${gap.booked} people booked and nobody was marked.`;
}
