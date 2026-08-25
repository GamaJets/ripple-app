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
}

export interface ClassRates {
  classes: number;
  capacity: number;
  booked: number;
  attended: number;
  /** booked / capacity, or null when no class in the set recorded a capacity. */
  fill: number | null;
  /** attended / booked, or null when nothing was booked. */
  show: number | null;
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
  return {
    classes: rows.length,
    capacity,
    booked,
    attended,
    fill: capacity > 0 ? booked / capacity : null,
    show: booked > 0 ? attended / booked : null,
  };
}
