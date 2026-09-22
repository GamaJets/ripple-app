// Which clip the player picks, and what it calls the one it picked.
// Compile with tsc, run with node.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// src/ui/exerciseVideos.ts hands every screen `[...remote, ...added]`. An
// `added` entry is minted by `addVideo` when the INSERT was REFUSED: a clip the
// coach filmed, kept in this handset's AsyncStorage, with no row behind it and
// no way for any client to reach it. It carries `trainerId: null`.
//
// So does a platform (Academy) clip. Character for character, the two are the
// same shape in that column, and `videoForExercise` and `isAcademyClip` both
// tested `trainerId == null`. The player therefore served a handset-only clip
// as the Academy's, and said so on a screen whose every sentence is about what
// the CLIENT sees.
//
// The id prefix is the only thing that separates them — 'db…' is a row in
// `exercise_videos`, 'vx…' is the handset — and clipOwner.ts is where that is
// written down. These assertions are that the player asks it.
//
// `isAcademyClip` is gone (see the note where it lived in exerciseId.ts): it
// was a second, reader-blind spelling of `clipOwner(...) === 'platform'` with
// no caller left, so the assertions that used it now ask clipOwner, which is
// what every screen asks. `VideoLike.id` is required too, so the id-less
// fallback those assertions used to lean on no longer compiles — the block
// below that tested the fallback was testing the defect, and went with it.
//
// ── The other half: the preview must not disagree ─────────────────────────
//
// app/(trainer)/exercise.tsx renders what the player picks and src/lib/
// clipSources.ts writes the sentence under it. Its `shown` is ordered "exactly
// where videoForExercise actually puts it". That is only true if somebody keeps
// checking, so the last block here checks it: for every library shape below,
// what clipSources SAYS is on screen is what videoForExercise RETURNS.
import { videoForExercise, exerciseSlug, sameExercise, findExercise, synonymAliases, type ExerciseRef, type VideoLike } from './exerciseId';
import { clipOwner } from './clipOwner';
import { clipSources } from './clipSources';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ME = 'coach-me';
const THEM = 'coach-them';

interface Clip { id: string; exerciseId: string | null; name: string; trainerId: string | null }

/** A row in exercise_videos filmed by this coach. */
const mine: Clip = { id: 'db-1111', exerciseId: 'back-squat', name: 'Back Squat', trainerId: ME };
/** Another coach's, visible because the gym publishes it. */
const theirs: Clip = { id: 'db-2222', exerciseId: 'back-squat', name: 'Back Squat', trainerId: THEM };
/** A clip that ships with Repple. Belongs to no trainer. */
const academy: Clip = { id: 'db-3333', exerciseId: 'back-squat', name: 'Back Squat', trainerId: null };
/**
 * What `addVideo` persists when the insert is refused. This is copied from
 * src/ui/exerciseVideos.ts rather than invented: `id: 'vx' + …`, `exerciseId:
 * exerciseSlug(name)`, `trainerId: null`. If that mint ever changes shape, this
 * fixture is the thing that should be updated to match it.
 */
const handset: Clip = { id: 'vxm4k7q2z1', exerciseId: 'back-squat', name: 'Back Squat', trainerId: null };

/* ── the reported bug ──────────────────────────────────────────────────── */

// The two fixtures differ in exactly one character position — the id prefix —
// and that is the whole of the difference between "everyone sees this" and
// "nobody but this handset can see this".
{
  eq(clipOwner(handset, ME), 'local', 'the handset entry is local, by the prefix');
  eq(clipOwner(academy, ME), 'platform', 'and the row with no trainer is the platform’s');
  eq(handset.trainerId, academy.trainerId, 'the trainer column cannot tell them apart');

  ok(clipOwner(handset, null) !== 'platform',
     'a clip stranded on one handset is NOT the Academy’s — this returned true, and the screens repeated it');
  ok(clipOwner(academy, null) === 'platform', 'and a real platform row still is');
  ok(clipOwner(mine, null) !== 'platform' && clipOwner(theirs, null) !== 'platform',
     'a clip with a coach against it never was');
}

// Every kind, one classifier, and no second spelling of it. There used to be a
// loop here checking that `isAcademyClip` agreed with `clipOwner`; the honest
// way to keep two functions agreeing is to have one, so `isAcademyClip` is gone
// and this states the classification outright instead.
{
  const kinds: [typeof mine, string][] = [
    [mine, 'mine'], [theirs, 'other'], [academy, 'platform'], [handset, 'local'],
  ];
  for (const [c, want] of kinds) {
    eq(clipOwner(c, ME), want, `clipOwner calls ${c.id} ${want}`);
  }
  // And the reader matters, which is the half `isAcademyClip` could not express:
  // it hard-coded myId = null, so it could never have said 'mine' about this.
  eq(clipOwner(mine, null), 'other',
     'the coach’s own row reads as a stranger’s to a reader we cannot name — a predicate with no reader could never say otherwise');
}

/* ── what the player does with a handset-only clip ─────────────────────── */

// It PLAYS it. The clip is real, it is on this device, and the person looking
// at it is the coach who filmed it. Blacking out the screen over a file sitting
// in the same app would be a worse answer than showing it.
{
  const clip = videoForExercise('Back Squat', [handset], ME);
  eq(clip && clip.id, handset.id, 'the handset clip is what plays when it is the only one held');
  ok(clip != null && clipOwner(clip, ME) !== 'platform',
     'and it is not described as the platform’s while it plays');
}

// It plays THIRD: below the coach's own row and below the Academy's. Not a
// preference — clipSources orders mine → academy → local to match this, and the
// preview and the player must not disagree.
{
  eq(videoForExercise('Back Squat', [handset, academy, mine], ME), mine,
     'the coach’s own row wins over both');
  eq(videoForExercise('Back Squat', [handset, academy], ME), academy,
     'the Academy row is served to the client, so it wins over a clip no client can reach');
  eq(videoForExercise('Back Squat', [theirs, handset], ME), handset,
     'and a handset clip beats a stranger’s, which is never served at all');
}

// Ranked by KIND, not by array position. `hits.find(trainerId == null)` took
// whichever came first, and agreed with clipSources only because
// `[...remote, ...added]` happens to put every server row ahead of every
// handset one. That is a property of one caller, not of this function.
{
  eq(videoForExercise('Back Squat', [handset, academy], ME), academy,
     'the platform row wins even when the handset entry is listed first');
  eq(videoForExercise('Back Squat', [academy, handset], ME), academy,
     'and the answer does not change when the list is reordered');
  eq(videoForExercise('Back Squat', [handset, academy], null), academy,
     'the same with nobody signed in');
}

// A stranger's clip is still never served to somebody with a coach, and the
// handset entry does not change that either way.
{
  eq(videoForExercise('Back Squat', [theirs], ME), null,
     'a member is shown nothing rather than a coach who is not theirs');
  eq(videoForExercise('Back Squat', [theirs], null), theirs,
     'with nobody to prefer, the only clip there is is the right answer');
}

/* ── the matching rules are untouched ──────────────────────────────────── */

// The slug rules this file has always had. Restated here because the clip
// selection above is only sound if the set it selects from is right.
{
  eq(exerciseSlug('  Bent-Over   Row '), 'bent-over-row', 'a name becomes one slug');
  ok(sameExercise('Push-up', 'push up'), 'the same movement, spelled differently');
  const cat: ExerciseRef[] = [{ id: 'back-squat', name: 'Back Squat', group: 'Legs' }];
  eq(findExercise('back squat', cat)?.id, 'back-squat', 'a name finds its catalogue row');

  const byName: Clip = { id: 'db-4444', exerciseId: null, name: 'Front Squat', trainerId: ME };
  eq(videoForExercise('Front Squat', [byName], ME), byName,
     'a row written before exercise_id existed still resolves, by name');
  eq(videoForExercise('Squat', [mine, byName], ME), null,
     'a partial name matches nothing — no fuzzy fallback, ever');
  eq(videoForExercise('', [mine], ME), null, 'no exercise, no clip');
}

/* ── a clip that never said where it came from cannot be built ─────────── */

// This block used to assert the opposite of itself. It read:
//
//     const noId = { exerciseId: 'back-squat', name: 'Back Squat', trainerId: null };
//     ok(isAcademyClip(noId), 'a clip with no id stated is read by its trainer column alone');
//
// `noId` is, field for field, what `addVideo` persists when the insert is
// refused, minus the one field that would have given it away — and the
// assertion called it the Academy's. That is the reported defect, written down
// as expected behaviour, under a comment explaining that the fallback existed
// for two fixtures in coverage.test.ts. Those fixtures now carry ids, so the
// reason is gone and the fallback with it.
//
// What replaces it is not a runtime assertion, because there is nothing left to
// run: `VideoLike.id` is `string`, so a clip with no id does not compile. The
// `@ts-expect-error` below is that fact, checked — if anyone makes `id`
// optional again, there will be no error to expect and `tsc` fails HERE, on
// this line, with this comment next to it.
{
  // @ts-expect-error — a clip with no id has not said whether it is a row or a
  // handset entry, and there is no longer a column-only reading to fall back
  // on. Required `id` is what makes that unrepeatable rather than merely fixed.
  const noId: VideoLike = { exerciseId: 'back-squat', name: 'Back Squat' };
  void noId;

  // The same guard one level down lives in clipOwner.test.ts, on `OwnableClip`.
  //
  // And with ids supplied, the preference order this block used to check by
  // accident still holds — stated over clips that say what they are.
  eq(videoForExercise('Back Squat', [mine, academy], ME), mine,
     'the preference order holds when every clip states its provenance');
}

/* ── the preview and the player still agree ────────────────────────────── */

// src/lib/clipSources.ts says its `shown` is ordered "exactly where
// videoForExercise actually puts it". This is that claim, checked rather than
// commented: over every library shape, the KIND clipSources names is the kind
// of the clip this function returns — and when it names no clip at all, this
// function returns none.
{
  const shownToOwner: Record<string, string> = {
    mine: 'mine', academy: 'platform', other: 'other', local: 'local',
  };
  const libraries: Clip[][] = [
    [], [mine], [academy], [theirs], [handset],
    [mine, academy], [mine, handset], [academy, handset], [theirs, handset],
    [handset, academy], [handset, mine], [theirs, academy],
    [mine, academy, theirs, handset], [handset, theirs, academy, mine],
  ];
  const media = { animation: false, frames: false };
  for (const coachId of [ME, null]) {
    for (const lib of libraries) {
      const s = clipSources('Back Squat', lib, coachId, media);
      const played = videoForExercise('Back Squat', lib, coachId);
      const where = `${JSON.stringify(lib.map((c) => c.id))} as ${coachId ?? 'nobody'}`;
      const wantOwner = shownToOwner[s.shown];
      if (wantOwner === undefined) {
        // 'animation', 'frames' or 'none': the preview says no clip is on
        // screen, so the player must not be playing one.
        eq(played, null, `clipSources says "${s.shown}" and the player agrees there is no clip — ${where}`);
      } else {
        ok(played != null, `clipSources says "${s.shown}" so the player must return a clip — ${where}`);
        if (played) {
          eq(clipOwner(played, coachId), wantOwner,
             `the preview says "${s.shown}" and the player plays that kind — ${where}`);
        }
      }
    }
  }

  // The one that used to be wrong end to end: a handset clip with no platform
  // row anywhere near it. The preview names it 'local' and says the client
  // cannot see it; the player plays it and does not call it the Academy's.
  const s = clipSources('Back Squat', [theirs, handset], ME, media);
  eq(s.shown, 'local', 'the preview calls it what it is');
  eq(s.academy, 0, 'and counts no Academy clip, because there is none');
  const played = videoForExercise('Back Squat', [theirs, handset], ME);
  eq(played, handset, 'the player plays the same clip the preview described');
  ok(played != null && clipOwner(played, ME) !== 'platform', 'and does not file it under the Academy');
}

/* ── the names people actually type ─────────────────────────────────────────
 *
 * A coach typed "Abdominal crunch". The catalogue holds `ab-crunch`, the slug
 * of what was typed is `abdominal-crunch`, and every screen that files a
 * logged set against a movement found nothing — so a set of crunches lit no
 * muscle and counted towards none.
 */
{
  const cat = [
    { id: 'ab-crunch', synonyms: ['Abdominal crunch', 'abdominal crunches'] },
    { id: 'heel-flicks', synonyms: ['butt kicks', 'heel kicks'] },
    { id: 'crunches', synonyms: [] as string[] },
  ];
  const a = synonymAliases(cat);
  eq(a.get(exerciseSlug('Abdominal crunch')), 'ab-crunch',
     'the name a coach typed reaches the row it means');
  eq(a.get('butt-kicks'), 'heel-flicks', 'and so does the name a member types');
  eq(a.get('ab-crunch'), undefined, 'a row is never an alias of itself');
  eq(a.get('squat'), undefined, 'and nothing is invented for a name nobody listed');
}

// A synonym that IS another row's id must not redirect that row. `bench-press`
// listed as somebody's alternative name cannot be allowed to move the row that
// is bench press.
{
  const a = synonymAliases([
    { id: 'bench-press', synonyms: [] as string[] },
    { id: 'dumbbell-press', synonyms: ['Bench press'] },
  ]);
  eq(a.get('bench-press'), undefined, 'a real row outranks anybody else\u2019s synonym for it');
}

// Two rows claiming one name is a question the catalogue cannot answer, and
// picking the first would be picking by array order — the exact failure this
// file records having shipped once already.
{
  const a = synonymAliases([
    { id: 'ab-crunch', synonyms: ['Crunch'] },
    { id: 'cable-crunch', synonyms: ['Crunch'] },
  ]);
  eq(a.get('crunch'), undefined, 'an ambiguous name resolves to nothing rather than to a guess');
}

// A blank or absent column is the ordinary case and is never a crash.
{
  const a = synonymAliases([
    { id: 'row' },
    { id: 'pull-up', synonyms: null },
    { id: 'dip', synonyms: ['', '   '] },
  ]);
  eq(a.size, 0, 'no synonyms is no aliases, and no exception');
}

if (errors.length) {
  console.error(`exerciseId: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('exerciseId ok — the player plays the handset clip and never calls it the Academy’s.');
