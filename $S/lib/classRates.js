"use strict";
// The two rates a class has, and the shape of the row they are read from.
//
// Kept apart from classAttendance.ts on purpose. That module builds a Supabase
// client at import time, which drags React Native's AsyncStorage in with it and
// cannot be loaded outside the app — so anything living there is untestable.
// The same reasoning is why gymSchedule and gymTrainers take the client as an
// argument rather than importing one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.summariseClassRows = summariseClassRows;
/**
 * Fill and show, which are different questions.
 *
 * **Fill** is how full the room was booked; **show** is how many of those
 * booked actually turned up. Collapsing them into one word is what let a single
 * class read 71% on the timetable and 80% on the analytics screen — the second
 * was printing attended/booked under the label "fill".
 *
 * Both sum first and divide once, so a small class cannot swing the result the
 * way an average-of-averages would. Either rate is null rather than 0 when its
 * denominator was never recorded: a class nobody booked has no show rate, which
 * is not the same as everybody failing to turn up.
 */
function summariseClassRows(rows) {
    const capacity = rows.reduce((a, r) => a + (r.capacity || 0), 0);
    const booked = rows.reduce((a, r) => a + r.booked, 0);
    const attended = rows.reduce((a, r) => a + r.attended, 0);
    // Summed only when EVERY row carries the column. A set mixing rows that know
    // and rows that do not would report a total that is the walk-ins from part of
    // the month, stated as the walk-ins from all of it.
    const walkKnown = rows.length > 0 && rows.every((r) => typeof r.waitlistAttended === 'number');
    return {
        classes: rows.length,
        capacity,
        booked,
        attended,
        fill: capacity > 0 ? booked / capacity : null,
        show: booked > 0 ? attended / booked : null,
        waitlistAttended: walkKnown ? rows.reduce((a, r) => a + (r.waitlistAttended || 0), 0) : null,
    };
}
