// Every assertion here is a thing a coach would otherwise have been left to
// guess: which of their two clips is playing, that a colleague already filmed
// this, or that the clip on screen is not theirs at all.
//
// `shown` is checked against the order videoForExercise() actually implements
// rather than against the order this module would like — the two must agree or
// the preview describes a screen the client is not looking at.
import {
  clipSources, clipSourceLine, clipsPerMovement, movementSlug, duplicateClipNote, type SourcedClip,
} from './clipSources';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const COACH = 'coach-1';
const OTHER = 'coach-2';
// A 'db…' id is a row on the server. Anything else is a clip this phone kept
// because the insert was refused — which also carries a null trainer, and is
// not the Academy's.
let SEQ = 0;
const clip = (name: string, trainerId: string | null, exerciseId: string | null = null): SourcedClip =>
  ({ id: 'db' + (SEQ += 1), exerciseId, name, trainerId });
/** A clip saved on this handset and nowhere else. */
const phoneOnly = (name: string, exerciseId: string | null = null): SourcedClip =>
  ({ id: 'vx' + (SEQ += 1), exerciseId, name, trainerId: null });

const bare = { animation: false, frames: false };

// ── matching is the player's rule, and only the player's rule ─────────────
{
  const s = clipSources('Back Squat', [clip('Back Squat', COACH)], COACH, bare);
  eq(s.mine, 1, 'a clip whose NAME slugs to the movement is matched — the bridge for rows with no exercise_id');

  const byId = clipSources('Back Squat', [clip('my squat video', COACH, 'back-squat')], COACH, bare);
  eq(byId.mine, 1, 'and so is one carrying the durable exercise_id under any filename');

  // The substring match this whole module line descends from returned a rowing
  // machine for "Row". A near miss is a clip of the wrong movement reported as
  // one of this movement's.
  const near = clipSources('Squat', [clip('Back Squat', COACH)], COACH, bare);
  eq(near.total, 0, '"Squat" does not collect Back Squat — there is no fuzzy fallback');

  eq(clipSources('', [clip('Back Squat', COACH)], COACH, bare).total, 0,
    'an unnamed movement matches nothing rather than everything');
}

// ── who each clip belongs to ──────────────────────────────────────────────
{
  const s = clipSources('Back Squat', [
    clip('Back Squat', COACH),
    clip('Back Squat', null),
    clip('Back Squat', OTHER),
  ], COACH, { animation: true, frames: true });
  eq([s.mine, s.academy, s.others], [1, 1, 1], 'one of each, sorted by who filmed it');
  eq(s.total, 5, 'the animation and the reference stills are demonstrations too');
  eq(s.shown, 'mine', 'the coach previewing their own client sees their own clip');
  ok(s.ownershipKnown, 'with a signed-in id, ownership is a thing we know');
}

// ── shown mirrors videoForExercise, including its refusals ────────────────
{
  eq(clipSources('Back Squat', [clip('Back Squat', null)], COACH, bare).shown, 'academy',
    'no clip of yours, so the Academy clip plays');

  // The refusal that matters: with a coach known, a stranger's clip is never
  // fallen back to, so what the client actually sees is the animation.
  const colleague = clipSources('Back Squat', [clip('Back Squat', OTHER)], COACH, { animation: true, frames: false });
  eq(colleague.shown, 'animation', "another coach's clip is not played to this coach's client");
  eq(colleague.others, 1, 'but it is counted, because it is the reason not to film this one twice');

  eq(clipSources('Back Squat', [], COACH, { animation: false, frames: true }).shown, 'frames',
    'with no clip and no animation, the reference stills are what is on screen');
  eq(clipSources('Back Squat', [], COACH, bare).shown, 'none', 'and with nothing at all, nothing is');

  // Signed out, videoForExercise has nobody to prefer and takes the first hit.
  const out = clipSources('Back Squat', [clip('Back Squat', OTHER)], null, bare);
  eq(out.shown, 'other', "with no signed-in id a stranger's clip really is what plays");
  eq(out.mine, 0, 'and nothing is credited to a coach we cannot identify');
  ok(!out.ownershipKnown, 'which the caller is told outright');
}

// ── the line: silent when there is nothing to disambiguate ────────────────
{
  eq(clipSourceLine(clipSources('Back Squat', [clip('Back Squat', COACH)], COACH, bare), true), null,
    'one clip, it is yours, and it is playing — no note on six hundred rows');
  eq(clipSourceLine(clipSources('Back Squat', [], COACH, { animation: true, frames: false }), true), null,
    'the animation alone is the ordinary case and says nothing');
  eq(clipSourceLine(clipSources('Back Squat', [], COACH, bare), true), null,
    'nothing on screen: the screen already has a notice saying so, and two would be one too many');
}

// ── the line: the two cases this item exists for ──────────────────────────
{
  // A coach who filmed it twice. One of the two plays and until now nothing
  // said which, or that there was a second.
  const twice = clipSourceLine(clipSources('Back Squat', [
    clip('Back Squat', COACH), clip('back squat.mov', COACH, 'back-squat'),
  ], COACH, bare), true);
  ok(twice != null && twice.includes('your own clip'), 'it says the clip on screen is yours');
  ok(twice != null && twice.includes('one more clip of your own'),
    'and that a second of yours exists, which is the whole complaint');

  // Their clip is NOT the one being shown.
  const academy = clipSourceLine(clipSources('Back Squat', [clip('Back Squat', null)], COACH,
    { animation: true, frames: false }), true);
  ok(academy != null && academy.includes('not one of yours'),
    'when the Academy clip is playing the coach is told it is not theirs');
  ok(academy != null && academy.includes('the catalogue animation'),
    'and the animation sitting behind it is named');

  // A colleague already filmed it. Never played here, so never mentioned.
  const mate = clipSourceLine(clipSources('Back Squat', [clip('Back Squat', OTHER)], COACH,
    { animation: true, frames: false }), true);
  ok(mate != null && mate.includes('another coach'),
    "a colleague's clip is named, because it is the reason not to spend an evening re-filming it");
}

// ── the line: a partial clip library is never counted ─────────────────────
{
  const s = clipSources('Back Squat', [clip('Back Squat', COACH), clip('Back Squat', null)], COACH, bare);
  const short = clipSourceLine(s, false);
  ok(short != null && short.includes('Only part of your clip library was read'),
    'a truncated read says so rather than presenting its prefix as the whole');
  ok(short != null && short.includes('there may be more'),
    'and names the ceiling instead of implying there is none');
  // What we DID see is still a fact, and withholding it would be its own lie.
  ok(short != null && short.includes('the Academy clip'), 'the clips we matched are still named');

  // Nothing else matched, under a read that may simply not have reached it.
  const alone = clipSourceLine(clipSources('Back Squat', [clip('Back Squat', COACH)], COACH, bare), false);
  ok(alone != null && alone.includes('not known'),
    'with nothing else seen, "there is only one" is exactly the claim a partial read cannot make');
}

// ── the line: signed out, nothing is credited to anybody ──────────────────
{
  const out = clipSourceLine(clipSources('Back Squat', [clip('Back Squat', OTHER)], null, bare), true);
  ok(out != null && out.includes('Nobody is signed in'),
    'a clip nobody can be matched to is not evidence the coach has not filmed this');
}

// ── the clip that is on this phone and nowhere else ───────────────────────
//
// `useExerciseVideos` returns `[...remote, ...added]`, and an `added` row is
// minted with `trainerId: null` — character for character the shape of a
// platform clip. Read on that field alone, every offline save was counted as
// the Academy's, and this screen — whose header is "What your client sees" —
// told a coach their client was watching a platform demonstration of a
// movement nobody outside their handset had a demonstration of.
{
  const s = clipSources('Back Squat', [phoneOnly('Back Squat')], COACH, bare);
  eq(s.academy, 0, 'a clip with no row is not the Academy\u2019s');
  eq(s.mine, 0, "and it is not counted among the clips a client can watch");
  eq(s.local, 1, 'it is its own figure');
  eq(s.total, 1, 'and it is still something held for the movement');
  eq(s.shown, 'local', 'the player really does put it on screen, so the preview says so');

  // Read through a default rather than `!`: a regression here returns null,
  // and a test that throws on it reports a stack trace where it should be
  // reporting which claim stopped being true.
  const line = clipSourceLine(s, true) ?? '';
  ok(line !== '', 'and this is the one single-clip case that is never silent');
  ok(!line.includes('Academy'), 'the sentence never calls it the Academy clip');
  ok(line.includes('saved on this phone only'), `it says where the clip is: ${line}`);
  ok(line.includes('cannot see it'), 'and what that means for the client');
}

// The player's order is copied, not improved on: `videos` is [...remote,
// ...added], so a real Academy row is found before an offline save.
{
  const s = clipSources('Back Squat', [clip('Back Squat', null), phoneOnly('Back Squat')], COACH, bare);
  eq(s.shown, 'academy', 'the server row is the one videoForExercise returns');
  eq([s.academy, s.local], [1, 1], 'and both are counted, apart');
  const line = clipSourceLine(s, true) ?? '';
  ok(line.includes('saved on this phone only'), `the handset copy is named as also held: ${line}`);
}

// A coach's own server clip outranks everything, and the phone copy is still
// named — it is the reason their library shows two rows for one movement.
{
  const s = clipSources('Back Squat', [clip('Back Squat', COACH), phoneOnly('Back Squat')], COACH, bare);
  eq(s.shown, 'mine', 'their own uploaded clip wins');
  eq(s.local, 1, 'the phone copy is counted');
  ok((clipSourceLine(s, true) ?? '').includes('never reached the server'), 'and explained rather than left as a mystery row');
}

// With the catalogue holding artwork, the phone copy still wins on THIS
// handset — which is exactly why the line has to say the client sees neither.
{
  const s = clipSources('Back Squat', [phoneOnly('Back Squat')], COACH, { animation: true, frames: false });
  eq(s.shown, 'local', 'videoForExercise returns the clip before any catalogue fallback');
  const line = clipSourceLine(s, true) ?? '';
  ok(line.includes('cannot see it'), 'so the coach is told their client is not seeing this');
  ok(line.includes('the catalogue animation'), 'and what the client gets instead is named');
}

// ── two rows of the clip library, one movement ────────────────────────────
{
  eq(movementSlug(clip('Back Squat', COACH)), 'back-squat', 'a clip with no exercise_id is placed by its name');
  eq(movementSlug(clip('IMG_4471.mov', COACH, 'back-squat')), 'back-squat',
    'and one with the column filled is placed by the column, whatever it is called');
  eq(movementSlug(clip('', null)), '', 'a clip that resolves to nothing is not a movement');

  const tally = clipsPerMovement([
    clip('Back Squat', COACH),
    clip('IMG_4471.mov', COACH, 'back-squat'),
    clip('Back Squat', null),
    clip('Front Squat', COACH),
    clip('', COACH),
  ]);
  eq(tally.get('back-squat'), 3, 'three rows in the library are the same movement');
  eq(tally.get('front-squat'), 1, 'and one is its own');
  eq(tally.get(''), undefined, 'two unnamed clips are not "the same movement" as each other');
}

// ── and the row says so ───────────────────────────────────────────────────
{
  eq(duplicateClipNote(1, true, true), null, 'the only clip for a movement needs no explaining');

  const played = duplicateClipNote(3, true, true);
  ok(played != null && played.includes('one of 3'), 'a row in a pile says how big the pile is');
  ok(played != null && played.includes('this is the one a client sees'), 'and that this row is the one that plays');

  const shadowed = duplicateClipNote(3, false, true);
  ok(shadowed != null && shadowed.includes('a client sees a different one'),
    'the re-film that never replaced the original is the whole reason for this line');

  // The row cap. We are holding two, so there are at least two — a positive a
  // truncated read supports. "Exactly two" is not.
  const short = duplicateClipNote(2, true, false);
  ok(short != null && short.includes('several') && !short.includes('2'),
    'a partial read states the collision without counting it');
}

if (errors.length) {
  console.error(`clipSources.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('clipSources.test.ts — ok');
