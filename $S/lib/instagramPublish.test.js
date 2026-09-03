"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What may be published to Instagram, what is refused, and the object that
// exists for a few seconds in between.
//
// The assertions worth reading are the first block. A card carrying a client's
// progress photograph must never reach a public URL, and the test for it is not
// "the screen hides the button" — it is that the value the publish function
// requires cannot be produced for such a card at all. The rest of this file is
// the aspect-ratio refusal (a card silently cropped is a figure cut in half),
// the unguessable key, and the difference between a container and a post.
const instagramPublish_1 = require("./instagramPublish");
const shareAsset_1 = require("./shareAsset");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const post = shareAsset_1.CARD_SIZES.find((s) => s.key === 'post');
const story = shareAsset_1.CARD_SIZES.find((s) => s.key === 'story');
const card = (over = {}) => ({
    kind: 'week',
    caption: 'Eighteen sessions coached.',
    filename: 'repple-week-2026-09-02-0900.png',
    width: post.w,
    height: post.h,
    photo: null,
    ...over,
});
/* ── the hard rule ────────────────────────────────────────────────────────── */
const withPhoto = (0, instagramPublish_1.checkPublishable)(card({ photo: { uri: 'data:image/jpeg;base64,AA', source: 'client-photo' } }));
eq(withPhoto.ok, false, 'a card carrying a client’s photograph is refused, whatever else is true of it');
ok(!withPhoto.ok && withPhoto.refusal === 'carries-a-photograph', 'and it is refused BY NAME, so the screen can say which rule it was');
ok(!withPhoto.ok && withPhoto.why === instagramPublish_1.PHOTO_KEEPS_THE_SHARE_SHEET, 'with the sentence that says the share sheet still posts it, rather than an apology');
ok(instagramPublish_1.PHOTO_KEEPS_THE_SHARE_SHEET.includes('share sheet'), 'the refusal names the path that DOES work — a refusal with no route through it reads as the app being broken');
// The photograph is checked before the shape. A coach whose card has both
// problems is told about the photograph, because fixing the shape would land
// them back on the same refusal.
const both = (0, instagramPublish_1.checkPublishable)(card({ width: story.w, height: story.h, photo: { uri: 'x', source: 'client-photo' } }));
ok(!both.ok && both.refusal === 'carries-a-photograph', 'a card with a photograph AND the wrong shape is refused for the photograph');
// A card whose photo came from the coach's own logo slot is still a photo field
// with something in it, and it is still refused. This is deliberate: the gate
// reads the FIELD, not the claimed source, so a mislabelled image cannot pass.
const mislabelled = (0, instagramPublish_1.checkPublishable)(card({ photo: { uri: 'x', source: 'coach-logo' } }));
ok(!mislabelled.ok && mislabelled.refusal === 'carries-a-photograph', 'the gate reads the photo field rather than trusting what the image says it is');
/* ── and the real card, built by the real builder ─────────────────────────── */
const built = (0, shareAsset_1.resultCard)({
    brand: 'Kinetic',
    clientName: 'Sarah Jones',
    spanLabel: '12 weeks in',
    figures: [{ label: 'Weight', value: '−8.4 kg' }],
    note: '',
    photo: { uri: 'data:image/jpeg;base64,AA', photoId: 'p1', consent: 'granted' },
}, { figures: true, name: false });
ok(built.ok, 'the result card with a granted photo builds — that permission is real and this is not undoing it');
if (built.ok) {
    const gate = (0, instagramPublish_1.checkPublishable)({ ...built.card, width: post.w, height: post.h });
    ok(!gate.ok && gate.refusal === 'carries-a-photograph', 'a REAL card built with a client’s own publish permission is still refused for Instagram: the client agreed to a post their coach makes, not to a public URL');
}
// The same card without a photograph goes.
const noPhoto = (0, shareAsset_1.resultCard)({ brand: 'Kinetic', clientName: 'Sarah Jones', spanLabel: '12 weeks in', figures: [{ label: 'Weight', value: '−8.4 kg' }], note: '', photo: null }, { figures: true, name: false });
ok(noPhoto.ok, 'the same card with no photograph builds');
if (noPhoto.ok) {
    const gate = (0, instagramPublish_1.checkPublishable)({ ...noPhoto.card, width: post.w, height: post.h });
    ok(gate.ok, 'and it publishes');
    ok(gate.ok && gate.card.photo === null, 'a publishable card carries a null photo in the type itself');
    ok(gate.ok && gate.card.checked === 'no-client-photograph', 'and a witness that it came out of this gate rather than being written by hand at a call site');
}
const week = (0, shareAsset_1.weekCard)({ brand: 'Kinetic', spanLabel: 'Last 7 days', sessions: 18, minutes: 1440, clients: 11 });
ok(week.ok, 'the week card builds');
if (week.ok) {
    ok((0, instagramPublish_1.checkPublishable)({ ...week.card, width: post.w, height: post.h }).ok, 'a coach’s own week has nobody else on it and publishes');
}
/* ── nothing to publish ───────────────────────────────────────────────────── */
const nothing = (0, instagramPublish_1.checkPublishable)(null);
ok(!nothing.ok && nothing.refusal === 'no-card', 'no card is its own refusal rather than a crash');
/* ── the shape, refused rather than cropped ───────────────────────────────── */
ok((0, instagramPublish_1.ratioAccepted)(post.w, post.h), '4:5 is the tallest a feed post may be, and is accepted');
ok(!(0, instagramPublish_1.ratioAccepted)(story.w, story.h), '9:16 is not a feed post and is refused rather than cropped');
ok((0, instagramPublish_1.ratioAccepted)(1080, 566), '1.91:1 is the widest, and is accepted');
ok(!(0, instagramPublish_1.ratioAccepted)(1080, 500), 'wider than 1.91:1 is refused');
ok((0, instagramPublish_1.ratioAccepted)(1080, 1080), 'a square sits inside the bounds');
ok(!(0, instagramPublish_1.ratioAccepted)(0, 1350), 'a zero width is not a shape');
ok(!(0, instagramPublish_1.ratioAccepted)(1080, 0), 'and neither is a zero height');
ok(!(0, instagramPublish_1.ratioAccepted)(Number.NaN, 1350), 'nor a width that is not a number');
eq((0, instagramPublish_1.aspectRatio)(1080, 1350), 0.8, '1080×1350 is exactly 4:5');
const shape = (0, instagramPublish_1.checkPublishable)(card({ width: story.w, height: story.h }));
ok(!shape.ok && shape.refusal === 'shape', 'a story card is refused for its shape');
ok(!shape.ok && shape.why.includes('9:16'), 'and the refusal names the shape it is');
ok(!shape.ok && shape.why.includes('Post'), 'and the shape to switch to, which is the action the coach can take');
eq((0, instagramPublish_1.ratioLabel)(1080, 1920), '9:16', 'the shapes this app makes are named rather than printed as decimals');
eq((0, instagramPublish_1.ratioLabel)(1080, 1350), '4:5', 'both of them');
/* ── the bytes ────────────────────────────────────────────────────────────── */
eq((0, instagramPublish_1.jpegFilename)('repple-week-2026-09-02-0900.png'), 'repple-week-2026-09-02-0900.jpg', 'the exported PNG name becomes a .jpg, because a .png holding JPEG bytes is a thing somebody later debugs');
eq((0, instagramPublish_1.jpegFilename)('card.jpeg'), 'card.jpg', 'and so does a .jpeg');
eq((0, instagramPublish_1.jpegFilename)(''), 'repple-card.jpg', 'an empty name still produces a filename');
ok((0, instagramPublish_1.isJpegBytes)([0xff, 0xd8, 0xff, 0xe0]), 'FF D8 FF is a JPEG');
ok(!(0, instagramPublish_1.isJpegBytes)([0x89, 0x50, 0x4e, 0x47]), 'a PNG is not, whatever content type it arrived under');
ok(!(0, instagramPublish_1.isJpegBytes)([0xff, 0xd8]), 'and two bytes are not enough to say');
ok(!(0, instagramPublish_1.isJpegBytes)(null), 'nor is nothing');
ok(!(0, instagramPublish_1.tooLarge)(400000), 'a card is a few hundred kilobytes');
ok((0, instagramPublish_1.tooLarge)(9 * 1024 * 1024), 'and Meta’s limit for a feed image is 8 MiB');
ok((0, instagramPublish_1.tooLarge)(0), 'an empty file is not a card');
/* ── the public object ────────────────────────────────────────────────────── */
const KEY = '0123456789abcdef0123456789abcdef';
eq((0, instagramPublish_1.cardObjectKey)(KEY), `${KEY}.jpg`, 'the key is 32 random hex characters and nothing else');
ok((0, instagramPublish_1.keyIsUnguessable)((0, instagramPublish_1.cardObjectKey)(KEY)), 'which is the shape this app recognises');
ok(!(0, instagramPublish_1.keyIsUnguessable)('coach-1/card-4.jpg'), 'a coach id and a counter are exactly what a key must not contain');
ok(!(0, instagramPublish_1.keyIsUnguessable)('2026-09-02.jpg'), 'and neither is a date');
let threw = false;
try {
    (0, instagramPublish_1.cardObjectKey)('short');
}
catch {
    threw = true;
}
ok(threw, 'a key built from anything but 32 hex characters throws rather than falling back to something derived');
threw = false;
try {
    (0, instagramPublish_1.cardObjectKey)('');
}
catch {
    threw = true;
}
ok(threw, 'including nothing at all, which is what a failed random source looks like');
eq((0, instagramPublish_1.cardPublicUrl)('https://abc.supabase.co', (0, instagramPublish_1.cardObjectKey)(KEY)), `https://abc.supabase.co/storage/v1/object/public/share-cards/${KEY}.jpg`, 'the public URL is the one address in this product that needs no signature');
eq((0, instagramPublish_1.cardPublicUrl)('https://abc.supabase.co/', (0, instagramPublish_1.cardObjectKey)(KEY)), `https://abc.supabase.co/storage/v1/object/public/share-cards/${KEY}.jpg`, 'a trailing slash on the project URL does not produce a double one');
eq((0, instagramPublish_1.cardPublicUrl)('https://abc.supabase.co', 'anything.jpg'), '', 'and a key this app did not make gets no URL at all');
/* ── the lifetime, and confirming a removal rather than assuming it ───────── */
eq(instagramPublish_1.CARD_OBJECT_TTL_MIN, 15, 'the ceiling on a public card object is fifteen minutes');
const t0 = Date.parse('2026-09-02T09:00:00Z');
ok(!(0, instagramPublish_1.cardObjectExpired)(t0, t0 + 60000), 'a minute-old object is doing its job');
ok(!(0, instagramPublish_1.cardObjectExpired)(t0, t0 + 14 * 60000), 'and so is a fourteen-minute-old one');
ok((0, instagramPublish_1.cardObjectExpired)(t0, t0 + 15 * 60000), 'at the ceiling it is a sweep’s business');
ok((0, instagramPublish_1.cardObjectExpired)(Number.NaN, t0), 'an object whose age cannot be established is swept rather than kept');
const listed = [{ name: `${KEY}.jpg` }];
ok((0, instagramPublish_1.cardObjectRemoved)(`${KEY}.jpg`, listed), 'storage naming the object is the only proof it was removed');
ok(!(0, instagramPublish_1.cardObjectRemoved)(`${KEY}.jpg`, []), 'an empty list is NOT proof: a refused delete looks exactly like an unnecessary one');
ok(!(0, instagramPublish_1.cardObjectRemoved)(`${KEY}.jpg`, null), 'and neither is nothing coming back');
ok((0, instagramPublish_1.cardObjectAbsent)(`${KEY}.jpg`, []), 'a listing that names nothing means the object is genuinely gone');
ok(!(0, instagramPublish_1.cardObjectAbsent)(`${KEY}.jpg`, listed), 'a listing that still names it means the delete was refused, not unnecessary');
ok(!(0, instagramPublish_1.cardObjectAbsent)(`${KEY}.jpg`, null), 'a listing that could not be read is not an answer either');
/* ── a container is not a post ────────────────────────────────────────────── */
eq((0, instagramPublish_1.postOutcome)('17841400', '17895695'), 'published', 'a media id is a post');
eq((0, instagramPublish_1.postOutcome)('17841400', null), 'container-only', 'a container id on its own is an upload that was never published');
eq((0, instagramPublish_1.postOutcome)('17841400', ''), 'container-only', 'and an empty media id is the same thing');
eq((0, instagramPublish_1.postOutcome)(null, null), 'nothing', 'and neither is nothing at all');
eq((0, instagramPublish_1.outcomeNote)('published'), 'Posted to Instagram.', 'only a media id gets that sentence');
ok((0, instagramPublish_1.outcomeNote)('container-only').includes('nothing is on your feed'), 'a container is reported as what it is, because announcing it as a post is the defect social.ts was written to end');
ok((0, instagramPublish_1.outcomeNote)('nothing', 'Permissions error').includes('Permissions error'), 'Meta’s own words survive, because "posting failed" sends a coach nowhere');
ok(!(0, instagramPublish_1.outcomeNote)('nothing', 'Permissions error.').includes('error..'), 'and a reason that already ends in a full stop does not get a second one');
/* ── whether it is offered at all ─────────────────────────────────────────── */
eq((0, instagramPublish_1.connectionState)(true, 'ready', true), 'connected', 'a landed read with an account is connected');
eq((0, instagramPublish_1.connectionState)(true, 'ready', false), 'not-connected', 'a landed read with no account is a real answer');
eq((0, instagramPublish_1.connectionState)(true, 'error', true), 'unknown', 'a failed read is UNKNOWN even when the last thing we held said connected — a green dot under a failed read is the original sin here');
eq((0, instagramPublish_1.connectionState)(true, 'loading', true), 'unknown', 'and so is a read still in flight');
eq((0, instagramPublish_1.connectionState)(true, 'partial', true), 'connected', 'a capped read still proves the row it returned');
eq((0, instagramPublish_1.connectionState)(false, 'ready', true), 'unconfigured', 'a build with no Meta app id says so, whatever the database holds');
eq((0, instagramPublish_1.connectionNote)('connected'), null, 'there is nothing to say about a connection that exists and is being used');
eq((0, instagramPublish_1.connectionNote)('unconfigured'), instagramPublish_1.INSTAGRAM_NOT_AVAILABLE, 'and the unconfigured case is a stated "not available"');
ok(((0, instagramPublish_1.connectionNote)('not-connected') ?? '').includes('Business or Creator'), 'the not-connected sentence names the account type Instagram requires, which is the thing coaches get wrong');
ok(((0, instagramPublish_1.connectionNote)('unknown') ?? '').includes('not a connection that failed'), 'and the unknown sentence does not accuse anybody’s account of anything');
ok(instagramPublish_1.INSTAGRAM_NOT_AVAILABLE.includes('App Review'), 'the "not available" sentence names Meta’s gate rather than implying Repple is broken');
ok((0, instagramPublish_1.reviewRefusalNote)('Permissions error').includes('App Review'), 'and a permissions error at post time is explained as the review gate, which is what it almost always is');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('instagramPublish: ok');
