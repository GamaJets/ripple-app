// What may be published to Instagram, what is refused, and the object that
// exists for a few seconds in between.
//
// The assertions worth reading are the first block. A card carrying a client's
// progress photograph must never reach a public URL, and the test for it is not
// "the screen hides the button" — it is that the value the publish function
// requires cannot be produced for such a card at all. The rest of this file is
// the aspect-ratio refusal (a card silently cropped is a figure cut in half),
// the unguessable key, and the difference between a container and a post.
import {
  CARD_OBJECT_TTL_MIN, INSTAGRAM_NOT_AVAILABLE, PHOTO_KEEPS_THE_SHARE_SHEET,
  aspectRatio, cardObjectAbsent, cardObjectExpired, cardObjectKey, cardObjectRemoved,
  cardPublicUrl, checkPublishable, connectionNote, connectionState, isJpegBytes,
  jpegFilename, keyIsUnguessable, outcomeNote, postOutcome, ratioAccepted, ratioLabel,
  reviewRefusalNote, tooLarge,
} from './instagramPublish';
import { CARD_SIZES, resultCard, weekCard } from './shareAsset';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const post = CARD_SIZES.find((s) => s.key === 'post')!;
const story = CARD_SIZES.find((s) => s.key === 'story')!;

const card = (over: Partial<Parameters<typeof checkPublishable>[0]> = {}) => ({
  kind: 'week',
  caption: 'Eighteen sessions coached.',
  filename: 'repple-week-2026-09-02-0900.png',
  width: post.w,
  height: post.h,
  photo: null,
  ...over,
} as any);

/* ── the hard rule ────────────────────────────────────────────────────────── */

const withPhoto = checkPublishable(card({ photo: { uri: 'data:image/jpeg;base64,AA', source: 'client-photo' } }));
eq(withPhoto.ok, false, 'a card carrying a client’s photograph is refused, whatever else is true of it');
ok(!withPhoto.ok && withPhoto.refusal === 'carries-a-photograph',
  'and it is refused BY NAME, so the screen can say which rule it was');
ok(!withPhoto.ok && withPhoto.why === PHOTO_KEEPS_THE_SHARE_SHEET,
  'with the sentence that says the share sheet still posts it, rather than an apology');
ok(PHOTO_KEEPS_THE_SHARE_SHEET.includes('share sheet'),
  'the refusal names the path that DOES work — a refusal with no route through it reads as the app being broken');

// The photograph is checked before the shape. A coach whose card has both
// problems is told about the photograph, because fixing the shape would land
// them back on the same refusal.
const both = checkPublishable(card({ width: story.w, height: story.h, photo: { uri: 'x', source: 'client-photo' } }));
ok(!both.ok && both.refusal === 'carries-a-photograph',
  'a card with a photograph AND the wrong shape is refused for the photograph');

// A card whose photo came from the coach's own logo slot is still a photo field
// with something in it, and it is still refused. This is deliberate: the gate
// reads the FIELD, not the claimed source, so a mislabelled image cannot pass.
const mislabelled = checkPublishable(card({ photo: { uri: 'x', source: 'coach-logo' } }));
ok(!mislabelled.ok && mislabelled.refusal === 'carries-a-photograph',
  'the gate reads the photo field rather than trusting what the image says it is');

/* ── and the real card, built by the real builder ─────────────────────────── */

const built = resultCard(
  {
    brand: 'Kinetic',
    clientName: 'Sarah Jones',
    spanLabel: '12 weeks in',
    figures: [{ label: 'Weight', value: '−8.4 kg' }],
    note: '',
    photo: { uri: 'data:image/jpeg;base64,AA', photoId: 'p1', consent: 'granted' },
  },
  { figures: true, name: false },
);
ok(built.ok, 'the result card with a granted photo builds — that permission is real and this is not undoing it');
if (built.ok) {
  const gate = checkPublishable({ ...built.card, width: post.w, height: post.h });
  ok(!gate.ok && gate.refusal === 'carries-a-photograph',
    'a REAL card built with a client’s own publish permission is still refused for Instagram: the client agreed to a post their coach makes, not to a public URL');
}

// The same card without a photograph goes.
const noPhoto = resultCard(
  { brand: 'Kinetic', clientName: 'Sarah Jones', spanLabel: '12 weeks in', figures: [{ label: 'Weight', value: '−8.4 kg' }], note: '', photo: null },
  { figures: true, name: false },
);
ok(noPhoto.ok, 'the same card with no photograph builds');
if (noPhoto.ok) {
  const gate = checkPublishable({ ...noPhoto.card, width: post.w, height: post.h });
  ok(gate.ok, 'and it publishes');
  ok(gate.ok && gate.card.photo === null, 'a publishable card carries a null photo in the type itself');
  ok(gate.ok && gate.card.checked === 'no-client-photograph',
    'and a witness that it came out of this gate rather than being written by hand at a call site');
}

const week = weekCard({ brand: 'Kinetic', spanLabel: 'Last 7 days', sessions: 18, minutes: 1440, clients: 11 });
ok(week.ok, 'the week card builds');
if (week.ok) {
  ok(checkPublishable({ ...week.card, width: post.w, height: post.h }).ok,
    'a coach’s own week has nobody else on it and publishes');
}

/* ── nothing to publish ───────────────────────────────────────────────────── */

const nothing = checkPublishable(null);
ok(!nothing.ok && nothing.refusal === 'no-card', 'no card is its own refusal rather than a crash');

/* ── the shape, refused rather than cropped ───────────────────────────────── */

ok(ratioAccepted(post.w, post.h), '4:5 is the tallest a feed post may be, and is accepted');
ok(!ratioAccepted(story.w, story.h), '9:16 is not a feed post and is refused rather than cropped');
ok(ratioAccepted(1080, 566), '1.91:1 is the widest, and is accepted');
ok(!ratioAccepted(1080, 500), 'wider than 1.91:1 is refused');
ok(ratioAccepted(1080, 1080), 'a square sits inside the bounds');
ok(!ratioAccepted(0, 1350), 'a zero width is not a shape');
ok(!ratioAccepted(1080, 0), 'and neither is a zero height');
ok(!ratioAccepted(Number.NaN, 1350), 'nor a width that is not a number');
eq(aspectRatio(1080, 1350), 0.8, '1080×1350 is exactly 4:5');

const shape = checkPublishable(card({ width: story.w, height: story.h }));
ok(!shape.ok && shape.refusal === 'shape', 'a story card is refused for its shape');
ok(!shape.ok && shape.why.includes('9:16'), 'and the refusal names the shape it is');
ok(!shape.ok && shape.why.includes('Post'), 'and the shape to switch to, which is the action the coach can take');
eq(ratioLabel(1080, 1920), '9:16', 'the shapes this app makes are named rather than printed as decimals');
eq(ratioLabel(1080, 1350), '4:5', 'both of them');

/* ── the bytes ────────────────────────────────────────────────────────────── */

eq(jpegFilename('repple-week-2026-09-02-0900.png'), 'repple-week-2026-09-02-0900.jpg',
  'the exported PNG name becomes a .jpg, because a .png holding JPEG bytes is a thing somebody later debugs');
eq(jpegFilename('card.jpeg'), 'card.jpg', 'and so does a .jpeg');
eq(jpegFilename(''), 'repple-card.jpg', 'an empty name still produces a filename');

ok(isJpegBytes([0xff, 0xd8, 0xff, 0xe0]), 'FF D8 FF is a JPEG');
ok(!isJpegBytes([0x89, 0x50, 0x4e, 0x47]), 'a PNG is not, whatever content type it arrived under');
ok(!isJpegBytes([0xff, 0xd8]), 'and two bytes are not enough to say');
ok(!isJpegBytes(null), 'nor is nothing');

ok(!tooLarge(400_000), 'a card is a few hundred kilobytes');
ok(tooLarge(9 * 1024 * 1024), 'and Meta’s limit for a feed image is 8 MiB');
ok(tooLarge(0), 'an empty file is not a card');

/* ── the public object ────────────────────────────────────────────────────── */

const KEY = '0123456789abcdef0123456789abcdef';
eq(cardObjectKey(KEY), `${KEY}.jpg`, 'the key is 32 random hex characters and nothing else');
ok(keyIsUnguessable(cardObjectKey(KEY)), 'which is the shape this app recognises');
ok(!keyIsUnguessable('coach-1/card-4.jpg'), 'a coach id and a counter are exactly what a key must not contain');
ok(!keyIsUnguessable('2026-09-02.jpg'), 'and neither is a date');

let threw = false;
try { cardObjectKey('short'); } catch { threw = true; }
ok(threw, 'a key built from anything but 32 hex characters throws rather than falling back to something derived');
threw = false;
try { cardObjectKey(''); } catch { threw = true; }
ok(threw, 'including nothing at all, which is what a failed random source looks like');

eq(cardPublicUrl('https://abc.supabase.co', cardObjectKey(KEY)),
  `https://abc.supabase.co/storage/v1/object/public/share-cards/${KEY}.jpg`,
  'the public URL is the one address in this product that needs no signature');
eq(cardPublicUrl('https://abc.supabase.co/', cardObjectKey(KEY)),
  `https://abc.supabase.co/storage/v1/object/public/share-cards/${KEY}.jpg`,
  'a trailing slash on the project URL does not produce a double one');
eq(cardPublicUrl('https://abc.supabase.co', 'anything.jpg'), '',
  'and a key this app did not make gets no URL at all');

/* ── the lifetime, and confirming a removal rather than assuming it ───────── */

eq(CARD_OBJECT_TTL_MIN, 15, 'the ceiling on a public card object is fifteen minutes');
const t0 = Date.parse('2026-09-02T09:00:00Z');
ok(!cardObjectExpired(t0, t0 + 60_000), 'a minute-old object is doing its job');
ok(!cardObjectExpired(t0, t0 + 14 * 60_000), 'and so is a fourteen-minute-old one');
ok(cardObjectExpired(t0, t0 + 15 * 60_000), 'at the ceiling it is a sweep’s business');
ok(cardObjectExpired(Number.NaN, t0), 'an object whose age cannot be established is swept rather than kept');

const listed = [{ name: `${KEY}.jpg` }];
ok(cardObjectRemoved(`${KEY}.jpg`, listed), 'storage naming the object is the only proof it was removed');
ok(!cardObjectRemoved(`${KEY}.jpg`, []), 'an empty list is NOT proof: a refused delete looks exactly like an unnecessary one');
ok(!cardObjectRemoved(`${KEY}.jpg`, null), 'and neither is nothing coming back');
ok(cardObjectAbsent(`${KEY}.jpg`, []), 'a listing that names nothing means the object is genuinely gone');
ok(!cardObjectAbsent(`${KEY}.jpg`, listed), 'a listing that still names it means the delete was refused, not unnecessary');
ok(!cardObjectAbsent(`${KEY}.jpg`, null), 'a listing that could not be read is not an answer either');

/* ── a container is not a post ────────────────────────────────────────────── */

eq(postOutcome('17841400', '17895695'), 'published', 'a media id is a post');
eq(postOutcome('17841400', null), 'container-only', 'a container id on its own is an upload that was never published');
eq(postOutcome('17841400', ''), 'container-only', 'and an empty media id is the same thing');
eq(postOutcome(null, null), 'nothing', 'and neither is nothing at all');
eq(outcomeNote('published'), 'Posted to Instagram.', 'only a media id gets that sentence');
ok(outcomeNote('container-only').includes('nothing is on your feed'),
  'a container is reported as what it is, because announcing it as a post is the defect social.ts was written to end');
ok(outcomeNote('nothing', 'Permissions error').includes('Permissions error'),
  'Meta’s own words survive, because "posting failed" sends a coach nowhere');
ok(!outcomeNote('nothing', 'Permissions error.').includes('error..'),
  'and a reason that already ends in a full stop does not get a second one');

/* ── whether it is offered at all ─────────────────────────────────────────── */

eq(connectionState(true, 'ready', true), 'connected', 'a landed read with an account is connected');
eq(connectionState(true, 'ready', false), 'not-connected', 'a landed read with no account is a real answer');
eq(connectionState(true, 'error', true), 'unknown',
  'a failed read is UNKNOWN even when the last thing we held said connected — a green dot under a failed read is the original sin here');
eq(connectionState(true, 'loading', true), 'unknown', 'and so is a read still in flight');
eq(connectionState(true, 'partial', true), 'connected', 'a capped read still proves the row it returned');
eq(connectionState(false, 'ready', true), 'unconfigured',
  'a build with no Meta app id says so, whatever the database holds');
eq(connectionNote('connected'), null, 'there is nothing to say about a connection that exists and is being used');
eq(connectionNote('unconfigured'), INSTAGRAM_NOT_AVAILABLE, 'and the unconfigured case is a stated "not available"');
ok((connectionNote('not-connected') ?? '').includes('Business or Creator'),
  'the not-connected sentence names the account type Instagram requires, which is the thing coaches get wrong');
ok((connectionNote('unknown') ?? '').includes('not a connection that failed'),
  'and the unknown sentence does not accuse anybody’s account of anything');
ok(INSTAGRAM_NOT_AVAILABLE.includes('App Review'),
  'the "not available" sentence names Meta’s gate rather than implying Repple is broken');
ok(reviewRefusalNote('Permissions error').includes('App Review'),
  'and a permissions error at post time is explained as the review gate, which is what it almost always is');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('instagramPublish: ok');
