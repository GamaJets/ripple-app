// The key a clip is stored under, and the sentence a coach reads when it is
// not stored at all.
// Compile with tsc, run with node.
//
// The assertion that carries the weight of supabase/parts/1150 is the one that
// says two uploads in the SAME millisecond produce different keys. With
// `upsert: true` and a millisecond key, that collision silently replaced the
// bytes behind a clip a named client already held a grant and a signed URL for.
// With `upsert: false` it would merely refuse — and with a token it does not
// arise at all.
import {
  VIDEO_BUCKET, exerciseVideoPath, isOwnVideoPath, videoUploadFailureLine, videoUploadRefusal,
  orphanedVideoObject,
} from './exerciseVideoUpload';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const COACH = '11111111-2222-3333-4444-555555555555';

/* ── the key ───────────────────────────────────────────────────────────── */

eq(VIDEO_BUCKET, 'exercise-videos', 'the bucket is the one the storage policies name');

eq(exerciseVideoPath(COACH, 1_756_000_000_000, 'AbC12!'), `${COACH}/1756000000000-abc12.mp4`,
  'the coach folder, the millisecond, the sanitised token, and the extension');

// The whole point of the token.
ok(exerciseVideoPath(COACH, 5, 'aaaa') !== exerciseVideoPath(COACH, 5, 'bbbb'),
  'two uploads in the same millisecond do not produce the same key');

// And the whole point of not relying on the clock. A phone correcting its clock
// backwards hands the same millisecond out twice, hours apart.
ok(exerciseVideoPath(COACH, 5, 'aaaa') !== exerciseVideoPath(COACH, 4, 'aaaa'),
  'a moved clock still changes the key');

eq(exerciseVideoPath(COACH, 5, ''), `${COACH}/5-clip.mp4`,
  'an empty token still produces a usable name rather than one ending in a dash');
eq(exerciseVideoPath(COACH, 5, '../../etc'), `${COACH}/5-etc.mp4`,
  'and a token carrying traversal cannot move the object out of the folder the policy checks');
eq(exerciseVideoPath(COACH, 5.9, 'a'), `${COACH}/5-a.mp4`,
  'a fractional millisecond is floored rather than written with a dot in it');

/* ── the folder the write policy checks ────────────────────────────────── */

ok(isOwnVideoPath(COACH, exerciseVideoPath(COACH, 1, 'tok')), 'a key this module built is the coach own');
ok(!isOwnVideoPath(COACH, `${COACH}/nested/a.mp4`),
  'one folder deep only — foldername() would take the first segment of a longer path happily');
ok(!isOwnVideoPath(COACH, `${COACH}/../other/a.mp4`), 'and no traversal');
ok(!isOwnVideoPath(COACH, 'someone-else/1-a.mp4'), 'another coach folder is not this coach own');
ok(!isOwnVideoPath(COACH, `${COACH}/`), 'a folder with no file in it is not a key');
ok(!isOwnVideoPath('', `${COACH}/1-a.mp4`), 'and a missing uid answers no rather than matching anything');

/* ── why the upload failed ─────────────────────────────────────────────── */

// The case `upsert: false` newly makes possible, and the only one where trying
// again immediately is the right advice.
eq(videoUploadRefusal({ statusCode: '409', message: 'Duplicate' }), 'taken', 'a 409 is the key being taken');
eq(videoUploadRefusal({ message: 'The resource already exists' }), 'taken', 'and so is the message form of it');

eq(videoUploadRefusal({ statusCode: 403, message: 'new row violates row-level security policy' }), 'refused',
  'a policy refusal is a refusal');
eq(videoUploadRefusal({ message: 'invalid JWT' }), 'refused', 'and so is a dead session');

// The one that was wrong for years: a server that answered is not an absent
// network, and "check your connection" sends somebody to fix the thing that is
// working.
eq(videoUploadRefusal({ statusCode: 500, message: 'Internal error' }), 'refused',
  'a server that replied is not an unreachable one');
eq(videoUploadRefusal({ message: 'Network request failed' }), 'unreachable',
  'only a failure with no reply at all is a network failure');
eq(videoUploadRefusal(null), 'refused', 'and an error with nothing in it is not guessed at');

/* ── what the coach reads ──────────────────────────────────────────────── */

const lines = (['signed-out', 'taken', 'refused', 'unreachable'] as const).map(videoUploadFailureLine);

for (const line of lines) {
  ok(line.length > 0, 'every cause has a sentence');
  // Every one of them opens by saying the clip did NOT go. A failure sentence
  // that leads with anything else is read as a warning about a clip that landed.
  ok(line.startsWith('That clip was not uploaded'),
    `no failure sentence claims the clip landed — ${line}`);
  ok(!/saved to your library|added to your library|your clients can/i.test(line),
    `and none of them describes an audience for a file nobody stored — ${line}`);
}

ok(new Set(lines).size === lines.length, 'the four causes read differently, or telling them apart bought nothing');

ok(/still on your phone/.test(videoUploadFailureLine('unreachable')),
  'a coach is told the video they picked is not lost');
ok(/sign(ed)? in/i.test(videoUploadFailureLine('signed-out')),
  'and a signed-out coach is told the one thing that would fix it');
ok(!/connection/.test(videoUploadFailureLine('refused')),
  'a refused write does not send the coach to check a working connection');
ok(/nobody has been given a link/.test(videoUploadFailureLine('refused')),
  'and says the thing that matters after part 1150: nothing was handed to anybody');
ok(/again/.test(videoUploadFailureLine('taken')),
  'the collision case says to try again, because the next attempt mints a fresh token');

/* ── the file left behind when the row does not land ─────────────────────
 *
 * An object in `exercise-videos` with no `exercise_videos` row is invisible to
 * everybody: `exvid_object_r` is `can_watch_exercise_video(name)`, which asks
 * that very table. It cannot be listed, signed, or found in order to be
 * deleted by hand; `trg_exercise_video_deleted` needs a row to fire; and
 * `queue_account_object_purges()` does not enumerate this bucket (live,
 * 6 Sep 2026). So it outlives the coach's account with their face in it.
 */

const KEY = exerciseVideoPath(COACH, 1757116800000, 'ab12cd34');

eq(orphanedVideoObject('refused', COACH, KEY), KEY,
  'the server answered and there is no row, so the object we just uploaded is ours to delete now');

// The one that must NOT delete. supabase-js rejects on a dead network AFTER
// the request has gone, so an unanswered insert may well have landed — and
// deleting the object then leaves a live row pointing at nothing, which is the
// outcome src/ui/exerciseVideos.ts names as the worst its delete path produces.
eq(orphanedVideoObject('unconfirmed', COACH, KEY), null,
  'a write that got no reply keeps its file — the row may exist');
eq(orphanedVideoObject('saved', COACH, KEY), null,
  'and a saved row owns its file');

// A clip added by LINK uploaded nothing. Removing a path we did not write
// would be a delete aimed at a key that is not ours to aim at.
eq(orphanedVideoObject('refused', COACH, null), null, 'no upload, nothing to discard');
eq(orphanedVideoObject('refused', COACH, undefined), null, 'and undefined is the same answer');
eq(orphanedVideoObject('refused', COACH, ''), null, 'and so is an empty key');

// Never somebody else's folder, and never a shape this app does not write.
// `isOwnVideoPath` is the same guard `exvid_object_w` applies to the upload.
eq(orphanedVideoObject('refused', COACH, '99999999-2222-3333-4444-555555555555/1-a.mp4'), null,
  'a key in another coach\'s folder is never discarded from here');
eq(orphanedVideoObject('refused', COACH, `${COACH}/nested/1-a.mp4`), null,
  'nor a nested key, which nothing in this app writes');
eq(orphanedVideoObject('refused', null, KEY), null,
  'and with nobody signed in there is no folder to prove ownership of');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('exerciseVideoUpload.test.ts — ok');
