// Permission to publish a progress photo, and the three ways a card must not
// get one.
//
// The assertions worth reading are the ones about 'unknown'. A consent read
// that failed is the state this app has historically rendered as an empty list
// and then stated as a fact; here that mistake would put somebody's body on
// Instagram, so it is tested as hard as the refusal itself.
import {
  PUBLISH_IS_SEPARATE_NOTE, SEEING_IS_NOT_PUBLISHING,
  mayPublishPhoto, publishAskBody, publishAskTitle, publishBlocker, publishConsentNote,
  publishConsentOf, publishLabel, publishStateOf, publishablePhotos, withdrawPublishBody,
  type PublishGrant,
} from './photoPublish';
import { resultCard } from './shareAsset';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const COACH = 'coach-1';
const OTHER_COACH = 'coach-2';
const CLIENT = 'client-1';
const grant = (photoId: string, coachId = COACH): PublishGrant =>
  ({ photoId, clientId: CLIENT, coachId, grantedAt: '2026-08-01T00:00:00Z' });

/* ── the gate ─────────────────────────────────────────────────────────────── */

ok(mayPublishPhoto('granted'), 'a granted permission is the only thing that opens the gate');
ok(!mayPublishPhoto('absent'), 'no permission, no photo');
ok(!mayPublishPhoto('unknown'), 'and a read that did not land is not a permission either');

/* ── resolving a permission from what came back ───────────────────────────── */

const grants = [grant('p1')];

eq(publishConsentOf('p1', COACH, grants, 'ready'), 'granted', 'the client’s own row is what grants it');
eq(publishConsentOf('p2', COACH, grants, 'ready'), 'absent', 'a photo with no row is not covered by one for another photo');
eq(publishConsentOf('p1', OTHER_COACH, grants, 'ready'), 'absent',
  'a permission is addressed to a PERSON: another coach is not covered by it');

// The four shapes of "we do not know", which must all behave identically.
eq(publishConsentOf('p1', COACH, grants, 'error'), 'unknown',
  'rows from a failed read are not evidence, even when they contain the grant');
eq(publishConsentOf('p1', COACH, grants, 'loading'), 'unknown', 'and neither is a read still in flight');
eq(publishConsentOf('p1', COACH, null, 'ready'), 'unknown', 'a null list is unknown rather than empty');
eq(publishConsentOf('p1', COACH, [], 'error'), 'unknown',
  'an empty list under error means UNKNOWN, never "they agreed to none"');
// And the one that must NOT be unknown, or the feature never works.
eq(publishConsentOf('p1', COACH, [], 'ready'), 'absent',
  'an empty list under ready is a real answer: this client has agreed to nothing');
eq(publishConsentOf('p1', COACH, grants, 'partial'), 'granted',
  'a capped read still proves the row it returned');

/* ── the picker is built from permissions, not from visibility ────────────── */

const visible = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

eq(JSON.stringify(publishablePhotos(visible, COACH, grants, 'ready')), JSON.stringify([{ id: 'p1' }]),
  'only the photo the client agreed to is offered, out of three the coach can see');
eq(publishablePhotos(visible, COACH, grants, 'error'), null,
  'a failed permissions read offers nothing and says nothing — null, not an empty list');
eq(publishablePhotos(visible, COACH, null, 'ready'), null, 'and neither does an absent one');
eq(publishablePhotos(visible, null, grants, 'ready'), null, 'nor a coach who is not established');
eq(publishablePhotos(null, COACH, grants, 'ready'), null,
  'a failed read of the photos themselves is unknown too, not "you have none"');
eq(JSON.stringify(publishablePhotos(visible, OTHER_COACH, grants, 'ready')), '[]',
  'a coach with no permissions from this client is offered nothing, which under ready is a true answer');

/* ── the card refuses, whatever the coach ticked ──────────────────────────── */

const figures = [{ label: 'Weight', value: '−8.4 kg' }];
const build = (consent: 'granted' | 'absent' | 'unknown') => resultCard(
  {
    brand: 'Warehouse', clientName: 'Sarah Jones', spanLabel: '12 weeks in', figures,
    note: 'Brilliant work.',
    photo: { uri: 'file:///tmp/p1.jpg', photoId: 'p1', consent },
  },
  // Both of the coach's own ticks ON. Neither of them has a vote here, which is
  // the entire point: they are the coach's word about the numbers and the name,
  // and this is the client's own word about their body.
  { figures: true, name: true },
);

const granted = build('granted');
ok(granted.ok && granted.card.photo?.uri === 'file:///tmp/p1.jpg', 'with the client’s permission the photo is on the card');
ok(granted.ok && granted.card.photo?.source === 'client-photo', 'and it is labelled as whose it is');

const absent = build('absent');
ok(absent.ok, 'without it the card still builds — the figures were agreed to separately');
eq(absent.ok ? absent.card.photo : 'built nothing', null,
  'but it carries no photo, and no placeholder standing in for one');

const unknown = build('unknown');
eq(unknown.ok ? unknown.card.photo : 'built nothing', null,
  'and a permissions read that failed is treated exactly as a refusal');

// The two cards a viewer would receive are identical apart from the picture:
// nothing on the card says a photo was asked for and withheld, because that
// would itself be a statement about the client made without asking them.
if (absent.ok && unknown.ok) {
  eq(JSON.stringify(absent.card), JSON.stringify(unknown.card),
    'a card with no permission and a card with no answer are the same artefact');
}

/* ── anything drawn beside the photo is scrubbed ──────────────────────────── */

// The headline is the largest type on the card and it is free text the coach
// types. A photograph with a first name over it is an identification, so
// without name consent the name comes out of the headline as well as out of the
// caption and the kicker.
const typedName = resultCard(
  {
    brand: 'W', clientName: 'Sarah Jones', spanLabel: "Sarah's 12 weeks", figures,
    note: 'Great work.',
    photo: { uri: 'file:///tmp/p1.jpg', photoId: 'p1', consent: 'granted' },
  },
  { figures: true, name: false },
);
ok(typedName.ok, 'a photo with figure consent and no name consent still builds');
if (typedName.ok) {
  ok(!/Sarah/i.test(JSON.stringify(typedName.card)),
    'the name the coach typed into the headline does not survive beside their photo');
  ok(typedName.card.photo !== null, 'and the photo, which was separately agreed to, still does');
}

/* ── what each side is told ───────────────────────────────────────────────── */

eq(publishConsentNote('granted'), null, 'a permission that exists needs no caveat beside it');
ok((publishConsentNote('absent') ?? '').includes('has not agreed'),
  'an absent permission is described as something the client has not done');
ok((publishConsentNote('unknown') ?? '').includes('not a client who refused'),
  'and an unreadable one explicitly is not reported as a refusal');
ok(SEEING_IS_NOT_PUBLISHING.includes('separate thing'),
  'the coach is told why a photo they can plainly see is not offered');

eq(publishAskTitle('Jo'), 'Let Jo publish this photo?', 'the client is asked about a named person');
eq(publishAskTitle(null), 'Let your coach publish this photo?', 'and about "your coach" when the name is not known');
ok(publishAskBody('Jo').includes('this photo only'), 'the question says it covers one photo');
ok(publishAskBody('Jo').includes('take this back'), 'and that it can be withdrawn');
ok(withdrawPublishBody('Jo').includes('still open it'),
  'withdrawing publication does not withdraw the photo, and the sentence says so');
ok(withdrawPublishBody('Jo').includes('stays posted'),
  'and it does not claim to unpost anything');
ok(PUBLISH_IS_SEPARATE_NOTE.includes('separate thing'),
  'the client’s own screen holds both halves of the distinction in one line');

/* ── the client's own three states ────────────────────────────────────────── */

eq(publishStateOf('p1', grants), 'allowed', 'a photo with a permission reads as allowed');
eq(publishStateOf('p2', grants), 'not-allowed', 'one without reads as not allowed');
eq(publishStateOf('p1', null), 'unknown', 'and one whose permissions did not load reads as unknown');
eq(publishLabel('unknown'), 'Not known', 'which is labelled as not known rather than as a no');

eq(publishBlocker('p9', { id: COACH }, [{ photoId: 'p1' }]) === null, false,
  'a photo that has not been sent cannot be agreed to for publication');
ok((publishBlocker('p9', { id: COACH }, [{ photoId: 'p1' }]) ?? '').includes('Send this photo'),
  'and the reason says what to do first, rather than surfacing a foreign key violation');
eq(publishBlocker('p1', { id: COACH }, [{ photoId: 'p1' }]), null, 'a photo that has been sent can be');
ok(publishBlocker('p1', null, [{ photoId: 'p1' }]) !== null, 'with no coach there is nobody to agree with');
ok((publishBlocker('p1', { id: COACH }, null) ?? '').includes('could not check'),
  'and an unknown share list blocks rather than guessing');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`photoPublish: ok`);
