"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsGap = bookingsGap;
exports.emptyBookingsLine = emptyBookingsLine;
/** Which halves of the list are unaccounted for, in the reader's words. */
function halves(classes, sessions) {
    if (classes && sessions)
        return 'your class bookings and your PT sessions';
    return classes ? 'your class bookings' : 'your PT sessions';
}
/**
 * The banner for a list that HAS rows. Null when both reads are whole — the one
 * case where what is on screen is everything the server holds.
 *
 * 'loading' earns a banner of its own rather than silence: the list on screen
 * during the first read is half-built by definition, and a member who scrolls a
 * short list and closes the screen never sees the rest arrive.
 */
function bookingsGap(classStatus, sessionStatus) {
    const cErr = classStatus === 'error', sErr = sessionStatus === 'error';
    if (cErr || sErr) {
        return {
            title: 'Some of your bookings could not be read',
            note: `We couldn’t read ${halves(cErr, sErr)}, so anything of that kind is missing from this list. `
                + 'This is not a cancellation — check before assuming a booking is not on.',
        };
    }
    const cLoad = classStatus === 'loading', sLoad = sessionStatus === 'loading';
    if (cLoad || sLoad) {
        return {
            title: 'Still reading your bookings',
            note: `We are still reading ${halves(cLoad, sLoad)}, so this list is not finished yet.`,
        };
    }
    const cPart = classStatus === 'partial', sPart = sessionStatus === 'partial';
    if (cPart || sPart) {
        return {
            title: 'Not all of your bookings could be read',
            note: `There is more of ${halves(cPart, sPart)} on record than we can read in one go, `
                + 'so this list may be short of one and anything here that looks like a total is not one.',
        };
    }
    return null;
}
/**
 * The line under an EMPTY list. "No upcoming bookings" is a statement about the
 * member's calendar and only two whole reads may make it.
 */
function emptyBookingsLine(classStatus, sessionStatus) {
    if (classStatus === 'error' || sessionStatus === 'error') {
        return 'Your bookings could not be read, so this is not a statement that you have none. '
            + 'Check again when you have signal before assuming a session is not on.';
    }
    if (classStatus === 'loading' || sessionStatus === 'loading') {
        return 'Reading your bookings…';
    }
    if (classStatus === 'partial' || sessionStatus === 'partial') {
        // The string here was "Loading." — which under 'partial' never stopped
        // being true-looking and never stopped being wrong: nothing was loading.
        return 'We couldn’t read all of your bookings, so this is not a statement that you have none upcoming. '
            + 'Check again in a moment.';
    }
    return 'No upcoming bookings. Book a class or a PT session to get started.';
}
