// One movement can have four demonstrations. The coach was shown one of them
// and told nothing about the other three.
//
// app/(client)/exercise.tsx resolves a strict order — the client's own coach's
// clip, then the platform Academy clip, then the bought animation, then the
// catalogue's reference frames — and app/(trainer)/exercise.tsx is a preview of
// exactly that screen. Both render the winner and nothing else, which is right:
// a client wants the lift demonstrated, once, by the person who trains them.
//
// It is wrong for the coach, and in two directions.
//
//   · A coach who has filmed a movement TWICE sees one of the two and has no
//     way to tell which. videoForExercise() takes `hits.find(...)`, so the one
//     that plays is whichever came back first from a read ordered by nothing in
//     particular. The coach re-films to fix a clip they do not like and the old
//     one keeps playing.
//
//   · A coach whose colleague at the same gym has filmed it sees the Academy
//     clip or the catalogue animation instead. `useExerciseVideos` does not
//     filter by trainer — `exvid_read` decides visibility, and it admits a
//     gym's shared clips — so that colleague's clip is in the list, is not
//     shown here, and is the reason this coach need not spend an evening
//     filming it.
//
// So this module counts what is HELD for a movement, and names which of them is
// the one on screen. It re-derives nothing: the slug rule is exerciseId.ts's,
// and `shown` mirrors videoForExercise()'s order exactly rather than guessing
// at it — a preview that disagrees with the player about which clip wins is
// worse than no preview.
//
// ── Why the counts are gated and the KIND is not ──────────────────────────
//
// 'partial' from the clip library means the rows are real and there are more of
// them (src/lib/rowCap.ts). A clip we matched is therefore a fact — we have it
// — but "there are two of yours" is a floor, not a count, and the house rule is
// that a partial read is never counted. So under a partial or failed read this
// says what is on screen, which it knows, and refuses to enumerate the rest.
import { exerciseSlug } from './exerciseId';
import { num } from './format';

/** The minimum a clip has to carry to be attributed. Named as VideoItem names
 *  these fields, so a caller passes its rows straight in. */
export interface SourcedClip {
  exerciseId: string | null;
  name: string;
  trainerId?: string | null;
}

/** Which demonstration the screen is actually playing. */
export type ShownSource = 'mine' | 'academy' | 'other' | 'animation' | 'frames' | 'none';

export interface ClipSources {
  /** Clips this coach recorded. Always 0 while the signed-in id is unknown —
   *  see `ownershipKnown`; crediting somebody else's filming to this coach is
   *  the one error here that cannot be spotted by reading the screen. */
  mine: number;
  /** Platform clips, which belong to no trainer. */
  academy: number;
  /** Clips belonging to a trainer who is not this coach. Visible because the
   *  gym shares them; never played on this coach's preview while their own id
   *  is known, which is precisely why they have to be named. */
  others: number;
  /** The bought animation for the movement. */
  animation: boolean;
  /** The catalogue's reference stills. Not a clip and never described as one. */
  frames: boolean;
  /** Everything held, the one on screen included. */
  total: number;
  shown: ShownSource;
  /** False when nobody is signed in, so no clip can be called this coach's. */
  ownershipKnown: boolean;
}

/**
 * Everything held for one movement, and which of it is on screen.
 *
 * `shown` follows videoForExercise() with `preferTrainerId` set to `coachId`,
 * because that is the call app/(trainer)/exercise.tsx makes: the coach's own
 * clip wins, then the Academy's, and another coach's is NOT fallen back to. The
 * one exception is a null `coachId`, where that function has nobody to prefer
 * and returns the first hit — so a colleague's clip really can be what is
 * playing, and this reports it rather than calling it the Academy's.
 */
export function clipSources(
  exerciseName: string,
  videos: SourcedClip[],
  coachId: string | null,
  media: { animation: boolean; frames: boolean },
): ClipSources {
  const id = exerciseSlug(exerciseName);
  // The same two rules the player matches on, in the same order: the durable
  // exercise_id, then the slugged name for rows written before that column was
  // being filled. No fuzzy fallback — a near-miss here would report a clip of a
  // different movement as one of this movement's.
  const hits = id ? videos.filter((v) => v.exerciseId === id || exerciseSlug(v.name) === id) : [];

  let mine = 0;
  let academy = 0;
  let others = 0;
  for (const v of hits) {
    if (v.trainerId == null) academy += 1;
    else if (coachId && v.trainerId === coachId) mine += 1;
    else others += 1;
  }

  const shown: ShownSource = mine > 0 ? 'mine'
    : academy > 0 ? 'academy'
      // Only reachable with no signed-in id. With one, videoForExercise
      // refuses to fall back to a stranger's clip and so does this.
      : (!coachId && others > 0) ? 'other'
        : media.animation ? 'animation'
          : media.frames ? 'frames'
            : 'none';

  return {
    mine,
    academy,
    others,
    animation: media.animation,
    frames: media.frames,
    total: mine + academy + others + (media.animation ? 1 : 0) + (media.frames ? 1 : 0),
    shown,
    ownershipKnown: coachId != null,
  };
}

/**
 * The movement a clip is FOR, by the player's own two rules.
 *
 * The durable `exercise_id` first, then the slugged filename for every row
 * written before that column was being filled. This expression was written out
 * by hand in four places — the library's clip column, the coverage report, this
 * module and the video screen — and the failure when one copy drifts is a clip
 * that stops resolving, silently, for rows of exactly one vintage.
 *
 * Deliberately NOT the test videoForExercise() makes. That one accepts a clip
 * if EITHER field resolves to the movement, which is right for gathering every
 * candidate; this answers the different question of which single movement a
 * clip belongs to, so that one clip is counted once.
 */
export function movementSlug(v: SourcedClip): string {
  return v.exerciseId || exerciseSlug(v.name);
}

/**
 * How many clips in a library resolve to each movement.
 *
 * The coach's video screen lists clips, one row each, and two rows can name the
 * same movement — a re-film that did not replace the original, a coach's clip
 * sitting beside the Academy's, a colleague's shared into the same gym. Only
 * one of them will ever play. Rows that slug to nothing are left out: an
 * unnamed clip is not "the same movement" as another unnamed clip.
 */
export function clipsPerMovement(videos: SourcedClip[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const v of videos) {
    const slug = movementSlug(v);
    if (!slug) continue;
    n.set(slug, (n.get(slug) ?? 0) + 1);
  }
  return n;
}

/**
 * What a row in the clip library says when it is not the only clip for its
 * movement, or null when it is.
 *
 * `played` is whether THIS row is the one a client would be served. It is the
 * half that makes the note worth reading: "one of three" tells a coach there is
 * a pile, and only "and this is not the one they see" tells them the re-film
 * they did last week is not the take being watched.
 *
 * `whole` is the caller's `isWhole(status)`. Under a truncated read the number
 * is a floor — there may be a fourth clip past the row cap — so the fact is
 * stated without it. The fact itself survives: we are holding two, so there ARE
 * at least two, and that is a positive a partial read can support.
 */
export function duplicateClipNote(held: number, played: boolean, whole: boolean): string | null {
  if (held <= 1) return null;
  const which = played ? 'this is the one a client sees' : 'a client sees a different one';
  return whole
    ? `one of ${num(held)} clips for this movement · ${which}`
    : `one of several clips for this movement · ${which}`;
}

/** The demonstration on screen, said as the coach would say it. */
function shownLine(s: ClipSources): string | null {
  switch (s.shown) {
    case 'mine': return 'Your client sees your own clip.';
    case 'academy': return 'Your client sees the Academy clip, not one of yours.';
    case 'other': return 'Your client sees a clip belonging to another coach.';
    case 'animation': return 'Your client sees the catalogue animation, not a filmed clip.';
    case 'frames': return 'Your client sees the catalogue reference stills, not a filmed clip.';
    // Nothing is on screen. The screen's own "No Demonstration Yet" notice is
    // the whole story and a second sentence beside it would only repeat it.
    default: return null;
  }
}

/** Everything held that is NOT the thing on screen, named. */
function alsoHeld(s: ClipSources): string[] {
  const parts: string[] = [];
  const spare = s.shown === 'mine' ? s.mine - 1 : s.mine;
  if (spare > 0) {
    parts.push(spare === 1
      ? 'one more clip of your own'
      : `${num(spare)} more clips of your own`);
  }
  const academy = s.shown === 'academy' ? s.academy - 1 : s.academy;
  if (academy > 0) parts.push(academy === 1 ? 'the Academy clip' : `${num(academy)} Academy clips`);
  const others = s.shown === 'other' ? s.others - 1 : s.others;
  if (others > 0) {
    // Whose, deliberately not said. This coach may not be entitled to the
    // other's name, and the useful fact is that the movement is covered.
    parts.push(others === 1 ? 'a clip filmed by another coach' : `${num(others)} clips filmed by other coaches`);
  }
  if (s.animation && s.shown !== 'animation') parts.push('the catalogue animation');
  if (s.frames && s.shown !== 'frames') parts.push('the catalogue reference stills');
  return parts;
}

/** "a, b and c" — an Oxford-comma-free list, because this renders in prose. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The sentence under the demonstration, or null when there is nothing to say.
 *
 * `whole` is the caller's `isWhole(vidStatus)` over the CLIP library. The
 * catalogue's own animation and stills are not gated on it — they come off the
 * exercise row, which is a different read — so they are still named when the
 * clip library came back short.
 *
 * Null when one demonstration exists and it is the one playing, which is the
 * ordinary case: a note saying "there is one clip and you are looking at it"
 * on six hundred rows is noise, and noise is how the line that matters gets
 * skipped.
 */
export function clipSourceLine(s: ClipSources, whole: boolean): string | null {
  const head = shownLine(s);
  if (head == null) return null;

  const parts: string[] = [head];

  // Said before the inventory, because it changes how the inventory reads: a
  // clip credited to nobody is not evidence that this coach has not filmed it.
  if (!s.ownershipKnown && (s.academy > 0 || s.others > 0)) {
    parts.push('Nobody is signed in on this device, so none of the clips held for this movement can be told apart from your own.');
  }

  const also = alsoHeld(s);
  if (whole) {
    if (also.length) {
      parts.push(`Also held for this movement: ${joinList(also)}.`);
    }
  } else if (also.length) {
    // We saw these, so they exist; what we cannot say is that they are all of
    // them. A named list with an honest ceiling beats silence, which would read
    // as "this is the only one".
    parts.push(`Also held for this movement: ${joinList(also)}. Only part of your clip library was read, so there may be more.`);
  } else {
    parts.push('Only part of your clip library was read, so whether another clip exists for this movement is not known.');
  }

  // One demonstration, it is the one playing, the library was read in full and
  // we know whose it is. Nothing worth a line.
  if (parts.length === 1 && whole && s.total <= 1) return null;
  return parts.join(' ');
}
