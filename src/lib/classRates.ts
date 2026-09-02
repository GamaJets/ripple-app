// The two rates a class has, and the shape of the row they are read from.
//
// Kept apart from classAttendance.ts on purpose. That module builds a Supabase
// client at import time, which drags React Native's AsyncStorage in with it and
// cannot be loaded outside the app — so anything living there is untestable.
// The same reasoning is why gymSchedule and gymTrainers take the client as an
// argument rather than importing one.

export interface ClassSummaryRow {
  classId: string;
  title: string;
  kind: string;
  branch: string;
  trainerId: string;
  trainerName: string;
  startsAt: string;
  /** Places the class was set up to hold. 0 when never recorded — which is not
   *  the same as a class with no room, so callers must not divide by it
   *  without checking. */
  capacity: number;
  booked: number;
  /** Of those booked, how many were marked present. */
  attended: number;
  /**
   * Waitlisters somebody marked present.
   *
   * The register lists every booking whatever its status and the tick is one
   * button, so this happens constantly: a place comes free at the door and the
   * coach ticks the person in front of them. Until part 460 those ticks were
   * counted in `attended` over a `booked` denominator they were never in, which
   * is how a class of 12 with 10 of its members present and 2 walk-ins reported
   * a 100% show rate — and how the month's rate could pass 100% altogether.
   *
   * Counted rather than discarded: these are real people who really trained and
   * the gym really pays for them. They belong nowhere near the numerator of a
   * show rate, which is what `GymClass.waitlistAttended` in src/lib/gymSchedule.ts
   * already says about the console's read of the same table.
   *
   * OPTIONAL, and undefined means a database that has not had part 460 applied
   * yet. Undefined is not zero: the column is genuinely unknown there, and the
   * one thing that must not happen is a screen printing "0 walk-ins" about a
   * class it never asked.
   */
  waitlistAttended?: number;
}

export interface ClassRates {
  classes: number;
  capacity: number;
  booked: number;
  attended: number;
  /** booked / capacity, or null when no class in the set recorded a capacity. */
  fill: number | null;
  /** attended / booked, or null when nothing was booked. Since part 460 this
   *  cannot exceed 1: the numerator is filtered to booked rows on the server. */
  show: number | null;
  /**
   * Walk-ins off the waitlist across the set, or null when the rows predate
   * part 460 and do not carry the column.
   *
   * Null and not 0, for the reason every other unknown in this file is null: a
   * month whose rows cannot answer is not a month in which nobody walked in.
   */
  waitlistAttended: number | null;
}

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
export function summariseClassRows(rows: ClassSummaryRow[]): ClassRates {
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
