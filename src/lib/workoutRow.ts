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
  feel?: WorkoutEntry['feel'] | null;
  cardio?: WorkoutEntry['cardio'] | null;
  kcal?: number | null;
  zones?: WorkoutEntry['zones'] | null;
  /** Whole-session length in minutes, when the person typed one. See
   *  `WorkoutEntry.sessionMins` — null means unknown, never zero. */
  session_mins?: number | null;
}

export const rowToEntry = (r: WorkoutRow): WorkoutEntry => ({
  id: r.id,
  t: r.performed_at,
  exercise: r.exercise,
  sets: r.sets ?? undefined,
  feel: r.feel ?? undefined,
  cardio: r.cardio ?? undefined,
  kcal: r.kcal ?? undefined,
  zones: r.zones ?? undefined,
  sessionMins: r.session_mins ?? undefined,
});

export const entryToRow = (uid: string, e: WorkoutEntry): WorkoutRow => ({
  user_id: uid,
  performed_at: e.t,
  exercise: e.exercise,
  sets: e.sets ?? null,
  feel: e.feel ?? null,
  cardio: e.cardio ?? null,
  kcal: e.kcal ?? null,
  zones: e.zones ?? null,
  session_mins: e.sessionMins ?? null,
});

/** Every field of an entry that is meant to survive a trip to the database.
 *  `id` is excluded: the server assigns it, so a new entry has none yet. */
export const PERSISTED_FIELDS: (keyof WorkoutEntry)[] =
  ['t', 'exercise', 'sets', 'feel', 'cardio', 'kcal', 'zones', 'sessionMins'];
