// Group fitness classes — the multi-location "gym platform" layer. A gym chain
// runs classes across several branches; each class is a scheduled group session
// with a capacity. Clients pick their branch, then book/cancel (waitlist when
// full).
//
// Types and the class-format vocabulary only. MOCK_CLASSES previously held a
// twelve-class schedule with invented instructors ("Coach Mia", "Coach Nadia")
// and invented booking counts, and BRANCHES hardcoded six Dubai locations that
// a real gym does not necessarily have — both shipped in the production
// bundle, and the branch list was what a trainer picked from when creating a
// real class. Branches now come from the gym's own classes, and MOCK_CLASSES
// is gone entirely: it had been an empty array nothing imported, which is a
// place for sample data to grow back.

export type ClassBookingStatus = 'booked' | 'waitlist';

/**
 * Whether a class is still on, or was called off and KEPT.
 *
 * The same two values `ClassStatus` carries in src/lib/gymSchedule.ts, spelt
 * out again here rather than imported: this module is types only and is pulled
 * into the client bundle, and gymSchedule.ts brings the row-cap and write
 * assertions with it.
 */
export type ClassStatus = 'scheduled' | 'cancelled';

export interface GymClass {
  id: string;
  title: string;
  kind: string;          // CrossFit · HYROX · GRIT · Cycle · Yoga Flow · Reformer …
  instructor: string;
  branch: string;        // gym location (e.g. "Al Quoz", "DIFC", "Yas Bay")
  room: string;          // room within the branch (optional)
  startsAt: string;      // ISO
  durationMin: number;
  capacity: number;
  booked: number;        // confirmed count (from class_counts on the backend)
  /**
   * How many people are on the waitlist for this class.
   *
   * Null means UNKNOWN, and there are two ways to get there: the counts read
   * failed (`countsKnown` false), or the database predates part 210 and
   * `class_counts()` returned no such column. Zero means a settled read found
   * nobody queueing.
   *
   * That distinction is the whole point of the field. A full class with six
   * people waiting is a second session on Thursday; a full class with an
   * unknown queue is not, and drawing a dash rather than a zero is what stops
   * a coach concluding there is no demand when nobody looked.
   */
  waiting: number | null;
  /**
   * Whether this class is still on, or was called off.
   *
   * `gym_classes.status`, added by part 195, and the app read `select('*')`
   * without ever mapping it — so a class the gym cancelled from the console
   * drew on the coach's phone exactly like one that was going ahead, and the
   * coach turned up and told the members it was on.
   *
   * OPTIONAL, and undefined means scheduled. That is the same reading
   * `isCancelled` in src/lib/gymSchedule.ts makes and for the same reason: a
   * row from a database that predates part 195, or one built by hand, is a
   * class that is ON, which is what it was before the column existed. It is
   * also the only reading that cannot silently drop a real class off a
   * timetable.
   */
  /**
   * The coach recorded as teaching it — `gym_classes.trainer_id`.
   *
   * The app's own Add a Class writes it; studio-web's wrote free-text
   * `instructor` and never the id, so part 165 notes that "every class already
   * on the board has `trainer_id` NULL". Null therefore means UNATTRIBUTED, not
   * "somebody else's": nothing may conclude from a null that this class is not
   * the reader's, and nothing may conclude that it is.
   */
  trainerId?: string | null;
  status?: ClassStatus;
  /** Why it was called off, free text the console captured. Null on a class
   *  nobody gave a reason for; undefined on a row read before part 195. */
  cancelReason?: string | null;
  /**
   * The weekly series this occurrence belongs to, or null for a one-off.
   *
   * Null is a real answer and is not backfilled — a series of one makes "this
   * class" and "this and every later one" the same button.
   */
  seriesId?: string | null;
}

// Common studio-class formats (chain-agnostic; a gym can add its own).
export const CLASS_KINDS = ['Abs & Glutes', 'Boxing', 'CrossFit', 'Cycle', 'GRIT', 'HYROX', 'MetCon', 'Olympic Lifting', 'Reformer Pilates', 'Strength & Conditioning', 'TRX', 'Yoga Flow', 'Yoga Stretch', 'Zumba'] as const;

// A gym's branches are derived from the classes it has actually created — see
// `branchesFrom` — so nothing is suggested that the gym did not enter itself.
export function branchesFrom(classes: { branch: string }[]): string[] {
  return [...new Set(classes.map((c) => (c.branch || '').trim()).filter(Boolean))].sort();
}
