// Turning an exercise from a spelling into a thing.
//
// An exercise has only ever been a display string in this app: the builder
// writes `name: 'Back Squat'` into the program JSON, the client logs
// `exercise: 'Back Squat'` into `workouts`, and the video library matched the
// two with a bidirectional substring test computed at render time —
//
//     vn === n || vn.includes(n) || n.includes(vn)
//
// which is why asking for "Squat" returned whichever of Back Squat, Front Squat
// or Goblet Squat happened to sort first, and why "Row" could return a rowing
// machine. A client following their coach's program was shown a demo of a
// different movement, confidently and with no way to tell.
//
// The `exercises` table has been in the schema since the first migration, keyed
// on a text slug, and held zero rows until 49-exercise-video-library.sql seeded
// it. This module is the slug rule, and it is deliberately the only one: the
// same function names a row in that table, resolves a program exercise to its
// catalogue entry, and picks the video for it. If the rule lives in two places
// it will drift, and the failure when it drifts is silent.

/** A catalogue entry, as the seed and the app both understand it. */
export interface ExerciseRef {
  id: string;
  name: string;
  group: string;
}

/**
 * The identifier for an exercise name.
 *
 * Lowercase; every run of non-alphanumeric characters becomes one hyphen; no
 * leading or trailing hyphen. Mirrored exactly by the seed in
 * supabase/parts/49-exercise-video-library.sql — the two must agree or a
 * trainer's clip stops resolving.
 *
 *   'Back Squat'    → 'back-squat'
 *   'Push-up'       → 'push-up'
 *   'Bent-Over Row' → 'bent-over-row'   (and so does 'Bent-over Row')
 */
export function exerciseSlug(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ /g, '-');
}

/** Whether two exercise names mean the same movement. Case and punctuation
 *  differ across the three vocabularies the app ships; the movement does not. */
export function sameExercise(a: string, b: string): boolean {
  const sa = exerciseSlug(a);
  return sa.length > 0 && sa === exerciseSlug(b);
}

/**
 * The catalogue entry for a name, or null when the movement is not in the
 * catalogue — which is a real answer, not a failure. A trainer can type any
 * exercise they like into the builder, and one they invented this morning has
 * no seeded row until their first video mints it.
 */
export function findExercise(name: string, catalogue: ExerciseRef[]): ExerciseRef | null {
  const id = exerciseSlug(name);
  if (!id) return null;
  return catalogue.find((e) => e.id === id) ?? null;
}

/** The minimum a video has to carry to be matched to an exercise. */
export interface VideoLike {
  exerciseId: string | null;
  name: string;
}

/**
 * The clip to play for an exercise, or null when there is none.
 *
 * Two rules, in order, and no third:
 *
 *   1. the clip whose exercise_id is this exercise — the durable link, set when
 *      the trainer recorded it against a catalogue movement;
 *   2. the clip whose *name* slugs to the same id — the bridge for every row
 *      written before there was an exercise_id to write.
 *
 * There is deliberately no fuzzy fallback. A near-miss here is a video of the
 * wrong movement presented as the right one, and a client copying it under load
 * is how people get hurt. No clip is an honest answer; the wrong clip is not.
 *
 * `preferTrainerId` breaks a tie towards the client's own coach, so a member
 * sees their coach demonstrating the lift rather than a platform stock clip.
 */
export function videoForExercise<T extends VideoLike & { trainerId?: string | null }>(
  exerciseName: string,
  videos: T[],
  preferTrainerId?: string | null,
): T | null {
  const id = exerciseSlug(exerciseName);
  if (!id) return null;

  const hits = videos.filter((v) => v.exerciseId === id || exerciseSlug(v.name) === id);
  if (!hits.length) return null;
  if (!preferTrainerId) return hits[0];
  return hits.find((v) => v.trainerId === preferTrainerId) ?? hits[0];
}
