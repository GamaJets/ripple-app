// The rules that stand between a coach and a photograph that is not theirs,
// and between a client and a bubble that says "sent" over nothing.
//
// Two halves, and they fail differently:
//
//   the KEY      is what the storage policies read. Segment 1 decides who can
//                open the file; segment 2 decides who could have put it there.
//                A path this file accepts that the policy would refuse is a
//                403 the app has already told the sender was a delivery.
//   the ROW      is what the app draws. Every "cannot tell" here has to come
//                out as a sentence rather than as a blank, because a message
//                that quietly renders without its attachment is the same lie
//                as one that never sent it.
import {
  MESSAGE_ATTACHMENT_PATH_RE, MESSAGE_MEDIA_MAX_BYTES, MESSAGE_MEDIA_TTL_S,
  messageAttachmentPath, isThreadAttachmentPath, attachmentUploaderId,
  attachmentContentType, attachmentExtension, attachmentKindFor,
  readAttachment, attachmentRefusal, attachmentNoun, hasSomethingToSend, unsentNote,
} from './messageAttachments';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CLIENT = '759c8d25-4d50-4a5c-bdb5-806bcad18ac1';
const COACH = '24d22d9d-ff68-4af0-95bd-46bdd1f10e10';
const STRANGER = '1efee95c-f17d-47b7-bff8-fcc11c7c8d65';

// ── the key the policies read ──────────────────────────────────────────────
{
  const p = messageAttachmentPath(CLIENT, CLIENT, 1756600000000, 'ab12cd34', 'jpg');
  eq(p, `${CLIENT}/${CLIENT}/1756600000000-ab12cd34.jpg`, 'the client uploading to their own thread');
  ok(MESSAGE_ATTACHMENT_PATH_RE.test(p), 'and it matches the shape the policies expect');
  ok(isThreadAttachmentPath(p, CLIENT), 'it is in this thread');
  eq(attachmentUploaderId(p), CLIENT, 'and the client is who put it there');

  const q = messageAttachmentPath(CLIENT, COACH, 1756600000001, 'zz99', 'mp4');
  ok(isThreadAttachmentPath(q, CLIENT), "the coach's clip is in the CLIENT's thread, not the coach's");
  eq(attachmentUploaderId(q), COACH, 'and the coach is who put it there');
  // The two segments say different things, and reading the wrong one is how a
  // coach's own folder would become a thread anybody could read.
  ok(!isThreadAttachmentPath(q, COACH), "the coach's own id is not a thread key here");

  // A timestamp with a fraction on it produced "1756600000000.5-tok.jpg", which
  // is a second dot and an extension the bucket does not accept.
  ok(MESSAGE_ATTACHMENT_PATH_RE.test(messageAttachmentPath(CLIENT, CLIENT, 1756600000000.5, 'tok', 'jpg')),
    'a fractional clock still produces a legal key');
  // An extension or token from somewhere untrusted cannot change what object
  // the path addresses.
  ok(MESSAGE_ATTACHMENT_PATH_RE.test(messageAttachmentPath(CLIENT, CLIENT, 1, '../../etc', 'jpg')),
    'a token full of traversal is replaced, not embedded');
  ok(!messageAttachmentPath(CLIENT, CLIENT, 1, '../../etc', 'jpg').includes('..'),
    'and no traversal survives into the key');
  eq(messageAttachmentPath(CLIENT, CLIENT, 1, 'tok', 'jpg/../../x').endsWith('.jpg'), true,
    'an extension that is a path is replaced with jpg');
}

// ── paths this app must refuse to build a URL for ──────────────────────────
{
  const junk = [
    `${CLIENT}/probe.jpg`,                          // no sender segment — the forgery guard
    `${CLIENT}/${COACH}/../../etc/passwd`,          // traversal
    `${CLIENT}/${COACH}/`,                          // a folder, not a file
    `${CLIENT}/${COACH}/no-extension`,              // nothing to say what it is
    `${CLIENT}/${COACH}/a/b.jpg`,                   // a third level nothing writes
    `not-a-uuid/${COACH}/x.jpg`,                    // segment 1 must be a thread
    `${CLIENT}/not-a-uuid/x.jpg`,                   // segment 2 must be a person
    `/${CLIENT}/${COACH}/x.jpg`,                    // a leading slash is a different object
    '',
  ];
  for (const j of junk) {
    ok(!MESSAGE_ATTACHMENT_PATH_RE.test(j), `"${j}" is not a message attachment key`);
    ok(!isThreadAttachmentPath(j, CLIENT), `"${j}" is not accepted as being in this thread`);
    eq(attachmentUploaderId(j), null, `"${j}" names nobody as its uploader`);
  }
}

// ── the negative case, said in the app's own words ─────────────────────────
//
// A stranger's object is refused HERE as well as by the policy. The policy is
// what makes it safe; this is what makes it legible — the app never signs a URL
// it should not, so a refusal shows up as "cannot show" rather than as a bare
// 403 arriving after a bubble has already claimed a photograph.
{
  const theirs = `${STRANGER}/${STRANGER}/1756600000000-x.jpg`;
  ok(!isThreadAttachmentPath(theirs, CLIENT), "another thread's object is not in this thread");
  const r = readAttachment({ attachment_path: theirs, attachment_kind: 'image' }, CLIENT);
  eq(r.state, 'unreadable', "a row aimed at another thread's file is not drawn");
}

// ── what a row is carrying ─────────────────────────────────────────────────
{
  const path = `${CLIENT}/${COACH}/1756600000000-abc.mp4`;
  const good = readAttachment({ attachment_path: path, attachment_kind: 'video' }, CLIENT);
  eq(good.state, 'ok', 'a coach clip on the client thread reads back');
  ok(good.state === 'ok' && good.attachment.kind === 'video', 'as a video');
  ok(good.state === 'ok' && good.attachment.path === path, 'at the path it was stored under');

  eq(readAttachment({}, CLIENT).state, 'none', 'a plain text message carries no attachment');
  eq(readAttachment({ attachment_path: null, attachment_kind: null }, CLIENT).state, 'none',
    'and nulls are the same answer');

  // Half a pair. The database refuses to write either of these (23514, proven
  // live), so reaching one means something upstream changed — which is exactly
  // when guessing is worst.
  eq(readAttachment({ attachment_kind: 'image' }, CLIENT).state, 'unreadable',
    'a message CLAIMING a photo with no path is not a message with a photo');
  eq(readAttachment({ attachment_path: `${CLIENT}/${COACH}/1-a.jpg` }, CLIENT).state, 'unreadable',
    'and a path with nothing saying what it is cannot be drawn');
  eq(readAttachment({ attachment_path: `${CLIENT}/${COACH}/1-a.gif`, attachment_kind: 'gif' }, CLIENT).state,
    'unreadable', 'a kind this app does not know is said out loud, not skipped');

  // The sentence is the deliverable: an unreadable attachment must produce
  // something a person can read under the bubble.
  const u = readAttachment({ attachment_kind: 'image' }, CLIENT);
  ok(u.state === 'unreadable' && u.why.length > 20, 'and it comes with a sentence to show');
}

// ── what the picker handed us ──────────────────────────────────────────────
{
  eq(attachmentKindFor('image/heic', 'IMG_4821.HEIC'), 'image', 'an iPhone photo is a photo');
  eq(attachmentKindFor('video/quicktime', 'IMG_4822.MOV'), 'video', 'and an iPhone clip is a video');
  eq(attachmentKindFor('image/jpeg'), 'image', 'a mime type alone is enough');
  eq(attachmentKindFor(null, 'squat.mp4'), 'video', 'a filename alone is enough');
  eq(attachmentKindFor(null, 'report.pdf'), null, 'a PDF is neither, and is refused rather than sent');
  eq(attachmentKindFor(null, null), null, 'and a picker that said nothing at all is not guessed at');
  eq(attachmentKindFor('application/octet-stream', 'clip'), null, 'nor is a nameless blob');
}

// ── the extension states what the bytes ARE ────────────────────────────────
{
  // Images are re-encoded on the way out, so a HEIC is stored as what it became.
  eq(attachmentExtension('image', 'image/heic', 'IMG_4821.HEIC'), 'jpg', 'an image is stored as the JPEG it is re-encoded to');
  eq(attachmentExtension('image', 'image/png', 'shot.png'), 'jpg', 'and so is a PNG, because that is what comes out');
  // Video is passed through, so the container has to follow the actual file.
  eq(attachmentExtension('video', 'video/quicktime', 'IMG.MOV'), 'mov', 'a QuickTime clip keeps its container');
  eq(attachmentExtension('video', 'video/mp4', 'a.mp4'), 'mp4', 'and an MP4 keeps its own');
  eq(attachmentExtension('video', null, 'IMG_4822.MOV'), 'mov', 'the filename answers when the picker did not');
  eq(attachmentExtension('video', null, null), 'mp4', 'and mp4 is the default when nothing said');

  // The content type is derived from the key we are about to write, so it can
  // never disagree with the extension the object is stored under.
  eq(attachmentContentType(`${CLIENT}/${COACH}/1-a.jpg`), 'image/jpeg', 'jpg uploads as image/jpeg');
  eq(attachmentContentType(`${CLIENT}/${COACH}/1-a.mov`), 'video/quicktime', 'mov uploads as video/quicktime');
  eq(attachmentContentType(`${CLIENT}/${COACH}/1-a.mp4`), 'video/mp4', 'mp4 uploads as video/mp4');
  eq(attachmentContentType(`${CLIENT}/${COACH}/1-a.heic`), null, 'and a HEIC has no content type here, so it is never uploaded as one');
  eq(attachmentContentType('noextension'), null, 'nor has a key with no extension');
}

// ── refusals happen before a byte leaves the phone ─────────────────────────
{
  eq(attachmentRefusal(1024 * 1024, 'image'), null, 'an ordinary photo goes');
  eq(attachmentRefusal(MESSAGE_MEDIA_MAX_BYTES, 'video'), null, 'a clip exactly at the bucket limit goes');
  ok(attachmentRefusal(MESSAGE_MEDIA_MAX_BYTES + 1, 'video') !== null, 'one byte over does not');
  ok(String(attachmentRefusal(MESSAGE_MEDIA_MAX_BYTES + 1, 'video')).includes('64 MB'),
    'and the refusal names the limit in the units a person reads');
  ok(String(attachmentRefusal(MESSAGE_MEDIA_MAX_BYTES + 1, 'video')).includes('shorter'),
    'and says what to do instead');
  // A zero-byte file uploads perfectly happily and is a grey box at the far end.
  ok(attachmentRefusal(0, 'image') !== null, 'an empty file is refused rather than sent');
  ok(attachmentRefusal(Number.NaN, 'image') !== null, 'and so is a size we could not measure');
  ok(attachmentRefusal(-1, 'video') !== null, 'and a nonsense one');
  // The client-side cap IS the bucket's, or the app predicts the wrong refusal.
  eq(MESSAGE_MEDIA_MAX_BYTES, 67108864, "the byte cap is the bucket's own file_size_limit (part 124)");
}

// ── a photograph is a message; a caption is optional ───────────────────────
{
  ok(hasSomethingToSend('', true), 'a photo with no caption is something to send');
  ok(hasSomethingToSend('how is this?', false), 'and so is a caption with no photo');
  ok(!hasSomethingToSend('', false), 'but an empty box with nothing attached is not');
  ok(!hasSomethingToSend('   \n ', false), 'nor is whitespace');
  ok(hasSomethingToSend('   ', true), 'a photo carries a blank caption without complaint');
}

// ── the sentence under a bubble that did not go ────────────────────────────
{
  eq(unsentNote('your coach', 'send', null), 'Not sent — your coach cannot see this',
    'a plain message that was refused');
  eq(unsentNote('your coach', 'upload', 'image'),
    'Not sent — the photo did not upload, so your coach cannot see it',
    'a photo whose FILE did not go says so, because that is the fixable part');
  eq(unsentNote('they', 'upload', 'video'),
    'Not sent — the video did not upload, so they cannot see it',
    'and the coach side says it in their words');
  eq(unsentNote('they', 'send', 'image'), 'Not sent — they cannot see this photo',
    'an uploaded photo whose row was refused is still not sent');
  // Not one of these may read as a delivery.
  for (const n of [unsentNote('your coach', 'send', null), unsentNote('your coach', 'upload', 'image'),
    unsentNote('they', 'send', 'video')]) {
    ok(n.startsWith('Not sent'), `"${n}" leads with the fact that it did not go`);
  }
  eq(attachmentNoun('image'), 'photo', 'the word for an image in a sentence');
  eq(attachmentNoun('video'), 'video', 'and for a video');
}

// ── the signed URL is short-lived, because it is a bearer token ────────────
{
  ok(MESSAGE_MEDIA_TTL_S > 0, 'a signature has a life');
  ok(MESSAGE_MEDIA_TTL_S <= 60 * 60, 'and it is under an hour — anyone holding the string can open the file');
  ok(MESSAGE_MEDIA_TTL_S >= 60 * 5, 'but long enough to open a thread and play a clip in it');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`messageAttachments: ok (bucket cap ${MESSAGE_MEDIA_MAX_BYTES} bytes, signatures ${MESSAGE_MEDIA_TTL_S}s)`);
