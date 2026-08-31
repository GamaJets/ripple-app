// Whose clip is this, from the coach looking at it?
//
// ── Why this is a module and not an `&&` in the row ────────────────────────
//
// The trainer video library (app/(trainer)/videos.tsx) decided what controls a
// row gets from one expression:
//
//     const mine = v.id.startsWith('db');
//
// which does not mean "mine". It means "this came from the exercise_videos
// table". `useExerciseVideos` deliberately does NOT filter its read by trainer
// — `exvid_read` decides what a person may see, and it knows about grants and
// gym-wide sharing that a client-side filter would get wrong — so that list
// also holds the clips that ship with Repple (trainer_id null) and every other
// coach's clips marked 'public'. All of them arrive with a 'db' id.
//
// So every one of them was drawn with the visibility chip, the "Who can see
// this" panel, the named-sharing list and the Remove button, over rows
// `exvid_trainer_rw` (`trainer_id = auth.uid()`) will not let this coach touch.
// The screen even had the right sentence in its else branch — "not one of
// yours" — under a predicate that disagreed with it.
//
// What made that survive is that it looked like nothing: three words on a row,
// no number in them, and the two facts it confuses are one column apart. The
// fix is a name and a test rather than a longer expression, because the next
// person adding a control to that row has to be able to ask this question
// without re-deriving what a 'db' prefix means.
//
// ── The prefixes ──────────────────────────────────────────────────────────
//
// `useExerciseVideos` mints ids in two shapes and the prefix is the whole of
// the type information:
//
//   'db' + uuid  — a row in exercise_videos. There is something to write to.
//   'vx' + …     — an AsyncStorage entry that never reached the server. There
//                  is no row, so there is nothing to share and nobody to share
//                  it with; it can only be forgotten.

/** What a clip is TO THE COACH READING IT — which decides what they are offered. */
export type ClipOwner =
  /** Their own row. Everything is theirs to change. */
  | 'mine'
  /** A clip that ships with Repple, belonging to no trainer. */
  | 'platform'
  /** Another coach's, visible here because they published it. */
  | 'other'
  /** This phone only. No row, so no sharing and no permissions. */
  | 'local';

/** The two fields that answer the question, named as VideoItem names them. */
export interface OwnableClip {
  id: string;
  trainerId: string | null;
}

/**
 * Who owns the clip, as far as this coach is concerned.
 *
 * `myId` is null while the signed-in id is still unknown, and that case
 * deliberately does NOT resolve to 'mine'. Guessing wrong in that direction
 * offers a control that cannot work and then reports success when the server
 * refuses it; guessing wrong the other way hides a control for the moment it
 * takes the session to land, and the screen redraws when it does.
 *
 * A row with no prefix this module knows is treated as 'local'. There is no
 * third id shape today, and inventing 'mine' for one that appears later is the
 * failure this whole file exists to prevent.
 */
export function clipOwner(clip: OwnableClip, myId: string | null): ClipOwner {
  if (!clip.id.startsWith('db')) return 'local';
  if (clip.trainerId === null) return 'platform';
  if (myId && clip.trainerId === myId) return 'mine';
  return 'other';
}

/**
 * Whether this coach may change who watches the clip, share it by name, or
 * delete the row.
 *
 * One predicate for all three because they are one permission —
 * `exvid_trainer_rw` — and splitting them would let the row offer two of the
 * three over a clip it may not write.
 */
export function canManageClip(clip: OwnableClip, myId: string | null): boolean {
  return clipOwner(clip, myId) === 'mine';
}

/**
 * Whether the row's Remove control belongs on it.
 *
 * Wider than `canManageClip` by exactly one case: a local-only entry has no row
 * to refuse the delete, and forgetting it is the only thing a coach can do with
 * one. That is why this is a second function rather than the same one reused —
 * the two lists genuinely differ, and the version that reused it silently
 * dropped the coach's only way to clear a failed upload off their phone.
 */
export function canRemoveClip(clip: OwnableClip, myId: string | null): boolean {
  const o = clipOwner(clip, myId);
  return o === 'mine' || o === 'local';
}
