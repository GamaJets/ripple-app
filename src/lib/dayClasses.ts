// The classes a coach teaches, on the day sheet of the coach's own calendar.
//
// ── What was there ────────────────────────────────────────────────────────
//
// app/(trainer)/calendar.tsx already loads the group timetable. It has to:
// `classClashes` in src/lib/booking.ts uses it to stop Generate Open Slots
// putting a bookable PT hour on top of a class the coach is running.
//
// It was never DRAWN. The day sheet is built from `byDay`, which holds
// `sessions` and nothing else, so a coach with a 6pm class and no one-to-ones
// on Thursday opened Thursday and read an empty day. The screen would refuse to
// generate a slot at six — silently, from the same list — while telling the
// person deciding whether to take a booking that the evening was free. The
// check existed and the coach could not see what it was checking against.
//
// ── Whose classes go on it ────────────────────────────────────────────────
//
// The same split `classClashes` makes, for the same reason:
//
//   · the coach's own, by `trainer_id`. These are the hours they will be
//     standing in a room for.
//   · the ones with NO coach recorded. Not "everything that is not mine": a
//     colleague's class is their business and their room, and drawing twenty of
//     them would bury the two that are the coach's. An unattributed class is
//     the one this cannot rule in or out, and a day sheet that hid it would be
//     asserting the hour is free when nothing knows that.
//
// A class that has been called off is left out. It is not happening, so the
// hour IS free, and drawing it would make a day look busy that is not.
// `isCancelled` reads an absent status as scheduled — the same reading
// src/lib/gymSchedule.ts makes, and the only one that cannot drop a real class
// off a timetable.
//
// Pure — no react, no supabase, no clock of its own. The day is passed in.
import type { LoadStatus } from '../ui/loadStatus';

/** One class as the day sheet needs to see it. A structural subset of
 *  `GymClass`, so the screen hands its own rows straight in. */
export interface CalendarClass {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  room: string;
  /** Null — or absent, on a row built before the column existed — means NO
   *  coach is recorded against it, which is "cannot tell" and not "not yours".
   *  See the header. */
  trainerId?: string | null;
  /** Absent means scheduled. A row from a database that predates part 195 is a
   *  class that is ON. */
  status?: 'scheduled' | 'cancelled';
}

/** One class on the sheet, with the one thing that changes what it means to the
 *  coach reading it. */
export interface DaySheetClass extends CalendarClass {
  /** True when this coach is recorded as teaching it. False for a class with no
   *  coach against it — never for a colleague's, which never gets this far. */
  mine: boolean;
}

/** Whether two instants fall on the same day in the reader's own zone.
 *
 *  Local parts and never `toISOString().slice(0, 10)`: the UTC date of a 6pm
 *  class in Los Angeles is the following day, which would file the coach's
 *  evening under tomorrow. */
function sameLocalDay(iso: string, day: Date): boolean {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
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
export function classesOnDay(
  all: readonly CalendarClass[],
  day: Date,
  uid: string | null,
): DaySheetClass[] {
  return all
    .filter((c) => c.status !== 'cancelled')
    .filter((c) => sameLocalDay(c.startsAt, day))
    .filter((c) => !c.trainerId || (!!uid && c.trainerId === uid))
    .map((c) => ({ ...c, mine: !!uid && c.trainerId === uid }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** What a row says about itself under the time. One line, because the coach is
 *  scanning a day and the distinction only matters for the second kind. */
export function classDayNote(c: DaySheetClass): string {
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
export function classDayCaveat(status: LoadStatus): string | null {
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
export function classDayHeading(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? 'Class that day' : `Classes that day · ${n}`;
}
