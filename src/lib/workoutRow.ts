// Turning a workout entry into a `workouts` row and back.
//
// This lived inside the provider, where nothing could reach it without pulling
// in React — so it was never tested, and for months `entryToRow` quietly left
// out `feel` and `zones`. Both were read back on the way in, so the code looked
// symmetrical; 56 workouts were written before anyone noticed neither field had
// ever reached the database.
//
// It is plain data in and plain data out, so it belongs here where a test can
// hold both ends and check they agree. See the round-trip assertions in
// coverage.test.ts: any new column added to one side and forgotten on the other
// fails there rather than in production.
import type { WorkoutEntry } from './mockData';

/** The shape `workouts` rows come back as. */
export interface WorkoutRow {
  id?: string;
  user_id?: string;
  performed_at: string;
  exercise: string;
  sets?: [number, number][] | null;
  /** Which sets were bodyweight, aligned to `sets`. See WorkoutEntry.bw. */
  bw?: boolean[] | null;
  /** Which sets were held rather than repeated, aligned to `sets`. On such a
   *  set the first number of the pair is SECONDS. See WorkoutEntry.timed. */
  timed?: boolean[] | null;
  /** The tempo each set was PERFORMED at, aligned to `sets`, absent where
   *  nobody recorded one. See WorkoutEntry.tempos — null at an index is not a
   *  tempo of zero and not a prescription met. */
  tempos?: WorkoutEntry['tempos'] | null;
  feel?: WorkoutEntry['feel'] | null;
  cardio?: WorkoutEntry['cardio'] | null;
  kcal?: number | null;
  zones?: WorkoutEntry['zones'] | null;
  /** Whole-session length in minutes, when the person typed one. See
   *  `WorkoutEntry.sessionMins` — null means unknown, never zero. */
  session_mins?: number | null;
  /** Set by a coach logging a session for their client. The insert policy
   *  requires it to equal the coach's own id, so it cannot be forged. */
  logged_by?: string | null;
  /** The booked PT session this training was done in, when it was done in one.
   *  Null is the ordinary case — see supabase/parts/890. Read-only from here:
   *  `entryToRow` deliberately does not write it, because it is a fact about a
   *  WRITE and not about an entry, and src/ui/floorQueue.ts spreads it onto the
   *  insert itself for exactly that reason. */
  session_id?: string | null;
  /** Stamped by the guard_workout_attribution trigger when the client edits a
   *  workout their coach logged. Read-only from the app. */
  amended_at?: string | null;
}

/**
 * The columns a coach's read of somebody else's `workouts` asks for.
 *
 * Here rather than in a screen because it belongs beside `rowToEntry`, which is
 * the thing that decides what a row has to contain: a column added to the type
 * and forgotten here comes back undefined and is read as absent, which on this
 * data means a set nobody did or a session with no length.
 *
 * `app/(trainer)/client-training.tsx` and `app/(trainer)/client-report.tsx`
 * still each declare their own identical literal. They predate this constant
 * and are not touched here — three copies of a column list is a drift waiting
 * to happen and pointing them at this one is a separate, mechanical change.
 *
 * Deliberately NOT the whole row: `bw`, `timed` and `tempos` are omitted
 * because the screens reading this show repped work, and `user_id` because the
 * filter already names it.
 */
export const WORKOUT_COLS =
  'id, performed_at, exercise, sets, feel, cardio, kcal, session_mins, logged_by, amended_at';

export const rowToEntry = (r: WorkoutRow): WorkoutEntry => ({
  id: r.id,
  t: r.performed_at,
  exercise: r.exercise,
  sets: r.sets ?? undefined,
  bw: r.bw ?? undefined,
  timed: r.timed ?? undefined,
  tempos: r.tempos ?? undefined,
  feel: r.feel ?? undefined,
  cardio: r.cardio ?? undefined,
  kcal: r.kcal ?? undefined,
  zones: r.zones ?? undefined,
  sessionMins: r.session_mins ?? undefined,
  loggedBy: r.logged_by ?? undefined,
  sessionId: r.session_id ?? undefined,
  amendedAt: r.amended_at ?? undefined,
});

export const entryToRow = (uid: string, e: WorkoutEntry): WorkoutRow => ({
  user_id: uid,
  performed_at: e.t,
  exercise: e.exercise,
  sets: e.sets ?? null,
  bw: e.bw ?? null,
  timed: e.timed ?? null,
  tempos: e.tempos ?? null,
  feel: e.feel ?? null,
  cardio: e.cardio ?? null,
  kcal: e.kcal ?? null,
  zones: e.zones ?? null,
  session_mins: e.sessionMins ?? null,
  // No amended_at: the trigger owns it. Writing it from here would let a client
  // decide whether their own edit left a mark, which is the point of the mark.
  logged_by: e.loggedBy ?? null,
});

/** Every field of an entry that is meant to survive a trip to the database.
 *  `id` is excluded: the server assigns it, so a new entry has none yet. */
export const PERSISTED_FIELDS: (keyof WorkoutEntry)[] =
  ['t', 'exercise', 'sets', 'bw', 'timed', 'tempos', 'feel', 'cardio', 'kcal', 'zones', 'sessionMins', 'loggedBy'];
// `amendedAt` is deliberately absent, for the same reason `id` is: the server
// assigns it. It comes back on the way in and is never sent on the way out.
//
// `sessionId` is absent on the same accounting and a slightly different one.
// It is not the server's to assign, but it is not the ENTRY's either: it says
// which booked hour a particular WRITE was made against, so a client logging
// the same movement tomorrow must not inherit it, and the offline queue must
// not re-send it onto a row it was never true of. src/ui/floorQueue.ts spreads
// it onto the insert where it belongs, and says so in the same words.
