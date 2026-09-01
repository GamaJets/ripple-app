// What My Bookings is allowed to say about a list assembled from two reads.
//
// app/(client)/bookings.tsx merges group classes and personal-training sessions
// into one chronological list. They are two tables behind two policies, and
// either can fail on its own — so the list has a state the screen had no shape
// for: REAL ROWS, SHORT. The screen consulted its own `bookingsWhole` and
// `bookingsFailed` only on the `items.length === 0` path, so:
//
//   · a member booked into Tuesday's spin class, whose classes read failed and
//     whose sessions read succeeded, saw "Upcoming" listing their PT session
//     alone — a complete-looking list with nothing anywhere saying a whole half
//     of it was missing. They do not turn up. The gym charges the no-show.
//   · under 'partial' the empty state printed the literal string "Loading."
//     forever, on a screen where every read had finished.
//
// Both sentences are built here rather than inline so the wording can name the
// half that is missing — "your class bookings", not "your bookings" — and so a
// test can hold it to that. Naming the half is the point: a member who knows
// their classes did not load knows to check the timetable, where a member told
// "something went wrong" does not know what to check.
import type { LoadStatus } from '../ui/loadStatus';

/** The banner over a list that has rows but is not the whole list. */
export interface BookingsGap {
  /** <Notice title> — a sentence, like every other title on that screen. */
  title: string;
  /** The sentence under it. */
  note: string;
}

/** Which halves of the list are unaccounted for, in the reader's words. */
function halves(classes: boolean, sessions: boolean): string {
  if (classes && sessions) return 'your class bookings and your PT sessions';
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
export function bookingsGap(classStatus: LoadStatus, sessionStatus: LoadStatus): BookingsGap | null {
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
export function emptyBookingsLine(classStatus: LoadStatus, sessionStatus: LoadStatus): string {
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
