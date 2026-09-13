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
//
// WHOSE a clip is, is a rule of the same kind, and it lives in
// src/lib/clipOwner.ts.
// This file asks that module rather than keeping a second opinion: the second
// opinion was `trainerId == null`, which cannot tell a clip that ships with
// Repple from one stranded in a handset's AsyncStorage because the insert was
// refused, and it put the latter on screen under the former's name.
import { clipOwner, type ClipOwner } from './clipOwner';

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

/** The minimum a video has to carry to be matched to an exercise.
 *
 *  `id` is REQUIRED, and that is the point of it. It is how the clip is TOLD
 *  APART from another clip carrying the same trainer column, and the reason is
 *  in `ownerOf` below: a handset entry and an Academy row are identical in
 *  `trainerId` and differ only in the id prefix.
 *
 *  It was optional for one wave, because two fixture sets in coverage.test.ts
 *  were written before it mattered and `ownerOf` fell back to the trainer
 *  column alone when it was missing. That fallback WAS the defect, kept alive
 *  behind a `?`: any new caller omitting an id got the old, wrong reading and
 *  nothing said so. The fixtures now carry ids (a 'db…' for a row, a 'vx…' for
 *  a handset entry), the fallback is gone, and a clip with no id is a compile
 *  error — which is the only version of this fix that cannot come back.
 *
 *  Every screen passes a `VideoItem`, whose `id: string` comes from `ExVideo`,
 *  so nothing live had to change to make this required. */
export interface VideoLike {
  id: string;
  exerciseId: string | null;
  name: string;
}

/**
 * What a clip IS, asked the one way this app answers it.
 *
 * `clipOwner` (src/lib/clipOwner.ts) is that way, and this delegates to it
 * rather than restating the test. The restatement is what broke: `trainerId ==
 * null` was written here, in the clip library row, in the coverage report and
 * in the preview screen, and the four copies did not mean the same thing.
 *
 * `useExerciseVideos` hands back `[...remote, ...added]`. An `added` entry is
 * minted by `addVideo` when the INSERT was refused — a clip that lives in this
 * handset's AsyncStorage and nowhere else — and it carries `trainerId: null`,
 * character for character the shape of a platform clip. The id prefix is the
 * only thing that separates them: 'db…' is a row in `exercise_videos`, 'vx…' is
 * the handset.
 *
 * There is no id-less branch here any more, and its absence is the fix. It used
 * to read the trainer column alone when `id` was missing — "the reading every
 * caller got before" — which is a polite name for the defect. A caller that
 * supplied no id got a clip called the Academy's on the strength of a null
 * column, silently, exactly as the four screens had. `VideoLike.id` is required
 * now, so that caller does not compile; the only remaining normalisation is
 * `trainerId ?? null`, which is about an absent field, not an absent fact.
 */
function ownerOf(v: { id: string; trainerId?: string | null }, myId: string | null): ClipOwner {
  return clipOwner({ id: v.id, trainerId: v.trainerId ?? null }, myId);
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
 * Which of several clips, in strict order:
 *
 *   1. the client's OWN coach — a member should see the person who actually
 *      trains them demonstrating the lift;
 *   2. the platform Academy clip, which is an `exercise_videos` row with no
 *      trainer — the fallback that means a new coach's clients are not staring
 *      at an empty library while their coach finds time to film;
 *   3. a clip held on THIS handset and nowhere else;
 *   4. nothing.
 *
 * Explicitly NOT "some other coach's clip". That used to be rule 3, by way of
 * `?? hits[0]` — so a member whose own coach had not filmed a squat could be
 * shown a stranger from another gym demonstrating it. The movement would be
 * right and the person would be wrong, which is confusing at best; and with a
 * private bucket and per-clip visibility it may not even be theirs to see.
 *
 * ── Rule 3, and why it is a rule of its own ───────────────────────────────
 *
 * It used to be part of rule 2. `hits.find((v) => v.trainerId == null)` takes
 * the first clip with no trainer, and an `added` entry — a clip kept on the
 * handset because the INSERT was refused — carries `trainerId: null` exactly
 * like a platform row. So the player picked up a handset-only clip under the
 * heading of the Academy, and `isAcademyClip` agreed with it.
 *
 * The clip is PLAYED, and that half was right: it is a real recording, the
 * person looking at it is the coach who filmed it seconds ago, and it is in the
 * list this device holds. Refusing to play it would black out a screen over a
 * clip sitting on the same handset. What was wrong is calling it the platform's
 * — a coach told "your client sees the Academy clip" about a file no client can
 * reach has been told the opposite of the one thing that matters, which is that
 * the upload never landed and has to be done again.
 *
 * It is ranked BELOW the Academy row, not above, and that is not a preference:
 * app/(trainer)/exercise.tsx previews this screen through
 * src/lib/clipSources.ts, whose `shown` is ordered mine → academy → local to
 * match this function. A preview that disagrees with the player about which
 * clip wins is worse than no preview, so the two orders are one order.
 *
 * The order is now by KIND rather than by array position, which is the second
 * half of the same fix. `hits.find(trainerId == null)` returned whichever of a
 * handset entry and a platform row came first in the array; `clipSources`
 * counts by kind and cannot see array position at all. They agreed only because
 * `[...remote, ...added]` happens to put every server row first. That is a
 * property of one caller, and it was the only thing holding the preview and the
 * player together.
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

  const myId = preferTrainerId ?? null;
  const first = (want: ClipOwner): T | undefined => hits.find((v) => ownerOf(v, myId) === want);

  // Their own coach. `ownerOf` returns 'mine' only when there is an id to
  // prefer, so the `preferTrainerId ?` guard the old line carried is now part of
  // the classifier rather than repeated here.
  const mine = first('mine');
  if (mine) return mine;

  // The Academy: a row belonging to no coach, shown to everyone.
  const academy = first('platform');
  if (academy) return academy;

  // This handset's own. Real, playable here, and reaching nobody else — see the
  // note on rule 3 above for why it plays and why it plays third.
  const local = first('local');
  if (local) return local;

  // No coach of this client's, no Academy clip and nothing on the handset. When
  // nobody has been asked to prefer anyone, the only clip there is is the right
  // answer; when somebody has, a stranger's clip is not it.
  return preferTrainerId ? null : hits[0];
}

// ── `isAcademyClip` was here, and it is gone on purpose ───────────────────
//
// It answered "is this a platform Academy clip rather than a coach's own",
// originally as `v.trainerId == null` written out a fourth time, and latterly
// as `ownerOf(v, null) === 'platform'`. The second version was correct. It is
// still gone, and the reason is not that it was wrong.
//
//  1. Nothing called it. app/(trainer)/videos.tsx was the last caller and now
//     asks `clipOwner` directly; app/(trainer)/library.tsx, app/(client)/
//     workouts.tsx, src/lib/clipSources.ts and src/lib/videoCoverage.ts all do
//     the same. Its only importers were two test files, which is a function
//     kept alive by its own tests.
//  2. `check:dead-exports` would never have said so. It exempts pure helpers
//     by design — see the rationale at the top of scripts/check-dead-exports.mjs
//     — so this one would have sat here green forever. Leaving it to a gate
//     that has decided not to look is not a decision, it is a hope.
//  3. It was a SECOND way to ask a question this module exists to have one
//     answer to, and a lossy one: it hard-coded `myId = null`, so it could
//     never return 'mine'. The next screen to reach for the readable name
//     would have got a coach-blind answer that is right about the Academy and
//     silently wrong about the reader's own clips — which is the same shape of
//     failure, one column over, as the bug this file's header describes.
//
// Ask `clipOwner(clip, myId) === 'platform'` (src/lib/clipOwner.ts). It is the
// one place the question is answered, it takes the reader into account, and
// every live caller already asks it that way.
