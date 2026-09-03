"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const exerciseVideoUpload_1 = require("./exerciseVideoUpload");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const COACH = '11111111-2222-3333-4444-555555555555';
/* ── the key ───────────────────────────────────────────────────────────── */
eq(exerciseVideoUpload_1.VIDEO_BUCKET, 'exercise-videos', 'the bucket is the one the storage policies name');
eq((0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 1756000000000, 'AbC12!'), `${COACH}/1756000000000-abc12.mp4`, 'the coach folder, the millisecond, the sanitised token, and the extension');
// The whole point of the token.
ok((0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 5, 'aaaa') !== (0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 5, 'bbbb'), 'two uploads in the same millisecond do not produce the same key');
// And the whole point of not relying on the clock. A phone correcting its clock
// backwards hands the same millisecond out twice, hours apart.
ok((0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 5, 'aaaa') !== (0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 4, 'aaaa'), 'a moved clock still changes the key');
eq((0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 5, ''), `${COACH}/5-clip.mp4`, 'an empty token still produces a usable name rather than one ending in a dash');
eq((0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 5, '../../etc'), `${COACH}/5-etc.mp4`, 'and a token carrying traversal cannot move the object out of the folder the policy checks');
eq((0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 5.9, 'a'), `${COACH}/5-a.mp4`, 'a fractional millisecond is floored rather than written with a dot in it');
/* ── the folder the write policy checks ────────────────────────────────── */
ok((0, exerciseVideoUpload_1.isOwnVideoPath)(COACH, (0, exerciseVideoUpload_1.exerciseVideoPath)(COACH, 1, 'tok')), 'a key this module built is the coach own');
ok(!(0, exerciseVideoUpload_1.isOwnVideoPath)(COACH, `${COACH}/nested/a.mp4`), 'one folder deep only — foldername() would take the first segment of a longer path happily');
ok(!(0, exerciseVideoUpload_1.isOwnVideoPath)(COACH, `${COACH}/../other/a.mp4`), 'and no traversal');
ok(!(0, exerciseVideoUpload_1.isOwnVideoPath)(COACH, 'someone-else/1-a.mp4'), 'another coach folder is not this coach own');
ok(!(0, exerciseVideoUpload_1.isOwnVideoPath)(COACH, `${COACH}/`), 'a folder with no file in it is not a key');
ok(!(0, exerciseVideoUpload_1.isOwnVideoPath)('', `${COACH}/1-a.mp4`), 'and a missing uid answers no rather than matching anything');
/* ── why the upload failed ─────────────────────────────────────────────── */
// The case `upsert: false` newly makes possible, and the only one where trying
// again immediately is the right advice.
eq((0, exerciseVideoUpload_1.videoUploadRefusal)({ statusCode: '409', message: 'Duplicate' }), 'taken', 'a 409 is the key being taken');
eq((0, exerciseVideoUpload_1.videoUploadRefusal)({ message: 'The resource already exists' }), 'taken', 'and so is the message form of it');
eq((0, exerciseVideoUpload_1.videoUploadRefusal)({ statusCode: 403, message: 'new row violates row-level security policy' }), 'refused', 'a policy refusal is a refusal');
eq((0, exerciseVideoUpload_1.videoUploadRefusal)({ message: 'invalid JWT' }), 'refused', 'and so is a dead session');
// The one that was wrong for years: a server that answered is not an absent
// network, and "check your connection" sends somebody to fix the thing that is
// working.
eq((0, exerciseVideoUpload_1.videoUploadRefusal)({ statusCode: 500, message: 'Internal error' }), 'refused', 'a server that replied is not an unreachable one');
eq((0, exerciseVideoUpload_1.videoUploadRefusal)({ message: 'Network request failed' }), 'unreachable', 'only a failure with no reply at all is a network failure');
eq((0, exerciseVideoUpload_1.videoUploadRefusal)(null), 'refused', 'and an error with nothing in it is not guessed at');
/* ── what the coach reads ──────────────────────────────────────────────── */
const lines = ['signed-out', 'taken', 'refused', 'unreachable'].map(exerciseVideoUpload_1.videoUploadFailureLine);
for (const line of lines) {
    ok(line.length > 0, 'every cause has a sentence');
    // Every one of them opens by saying the clip did NOT go. A failure sentence
    // that leads with anything else is read as a warning about a clip that landed.
    ok(line.startsWith('That clip was not uploaded'), `no failure sentence claims the clip landed — ${line}`);
    ok(!/saved to your library|added to your library|your clients can/i.test(line), `and none of them describes an audience for a file nobody stored — ${line}`);
}
ok(new Set(lines).size === lines.length, 'the four causes read differently, or telling them apart bought nothing');
ok(/still on your phone/.test((0, exerciseVideoUpload_1.videoUploadFailureLine)('unreachable')), 'a coach is told the video they picked is not lost');
ok(/sign(ed)? in/i.test((0, exerciseVideoUpload_1.videoUploadFailureLine)('signed-out')), 'and a signed-out coach is told the one thing that would fix it');
ok(!/connection/.test((0, exerciseVideoUpload_1.videoUploadFailureLine)('refused')), 'a refused write does not send the coach to check a working connection');
ok(/nobody has been given a link/.test((0, exerciseVideoUpload_1.videoUploadFailureLine)('refused')), 'and says the thing that matters after part 1150: nothing was handed to anybody');
ok(/again/.test((0, exerciseVideoUpload_1.videoUploadFailureLine)('taken')), 'the collision case says to try again, because the next attempt mints a fresh token');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('exerciseVideoUpload.test.ts — ok');
