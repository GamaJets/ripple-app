"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classesOnDay = classesOnDay;
exports.classDayNote = classDayNote;
exports.classDayCaveat = classDayCaveat;
exports.classDayHeading = classDayHeading;
/** Whether two instants fall on the same day in the reader's own zone.
 *
 *  Local parts and never `toISOString().slice(0, 10)`: the UTC date of a 6pm
 *  class in Los Angeles is the following day, which would file the coach's
 *  evening under tomorrow. */
function sameLocalDay(iso, day) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()))
        return false;
    return d.getFullYear() === day.getFullYear()
        && d.getMonth() === day.getMonth()
        && d.getDate() === day.getDate();
}
/**
 * The classes to draw under a day on the coach's calendar, earliest first.
 *
 * `uid` null is a coach whose own id is not known yet — a sign-in still being
 * restored. Nothing can then be attributed to them, so only the unattributed
 * classes come back, and every one of them is drawn as "no coach recorded",
 * which is true.
 */
function classesOnDay(all, day, uid) {
    return all
        .filter((c) => c.status !== 'cancelled')
        .filter((c) => sameLocalDay(c.startsAt, day))
        .filter((c) => !c.trainerId || (!!uid && c.trainerId === uid))
        .map((c) => ({ ...c, mine: !!uid && c.trainerId === uid }))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
/** What a row says about itself under the time. One line, because the coach is
 *  scanning a day and the distinction only matters for the second kind. */
function classDayNote(c) {
    return c.mine
        ? 'Your class · members book this separately'
        : 'A class in this slot with no coach recorded against it, so it may or may not be yours';
}
/**
 * What to say about the timetable this day sheet was built from, or null when
 * it was read whole.
 *
 * Never claims the evening is clear. That is the whole job of the function: an
 * empty class list under 'error' is a read that did not happen, and the one
 * thing a day sheet must not do is report a free hour it never checked. The
 * same argument `classCheckCaveat` in src/lib/booking.ts makes for the booking
 * side of the same screen.
 */
function classDayCaveat(status) {
    if (status === 'loading') {
        return 'Still reading your class timetable, so any classes you teach that day are not on this list yet.';
    }
    if (status === 'partial') {
        return 'Your class timetable came back at its row limit, so classes you teach may be missing from this day. An hour that looks free here may not be.';
    }
    if (status === 'error') {
        return 'Your class timetable could not be read, so no classes are shown for this day. That is the read failing, not a free evening — check before you take a booking.';
    }
    return null;
}
/**
 * The heading under the sessions on a day that has classes on it, or null when
 * there are none to head.
 *
 * Counted rather than assumed, and only ever a count of what is on the list —
 * `classDayCaveat` carries whether the list is the whole of it.
 */
function classDayHeading(n) {
    if (n <= 0)
        return null;
    return n === 1 ? 'Class that day' : `Classes that day · ${n}`;
}
