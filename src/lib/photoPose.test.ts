// Which way the person was facing, and what the app may say about it. Compile
// with tsc, run with node.
//
// The bug this guards: `progress_photos.pose` is live, constrained to exactly
// three values, and read by nothing — so app/(client)/compare.tsx put a
// front-on March photo beside a side-on September one under one heading and one
// set of figures, and offered the change in camera angle as a change in the
// body.
//
// The second bug it guards is the one an over-eager fix introduces: treating an
// unlabelled photo as a match. Every row in the table is unlabelled today, so a
// rule that reads absent as 'same' is the original silence with a function
// wrapped round it.
import { readPose, poseLabel, posesMatch, poseMismatchNote, POSES } from './photoPose';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── only what the CHECK constraint allows is a pose ───────────────────── */

eq(readPose('front'), 'front', 'the three the database permits read as themselves');
eq(readPose('side'), 'side', 'the three the database permits read as themselves');
eq(readPose('back'), 'back', 'the three the database permits read as themselves');
eq(POSES.length, 3, 'and there are exactly three, matching progress_photos_pose_check');

eq(readPose(null), null, 'an unlabelled photo has no pose, which is every row written before the column existed');
eq(readPose(undefined), null, 'and so does one whose column never came back');
eq(readPose(''), null, 'an empty string is not a pose');
eq(readPose('Front'), null, 'nor is a capitalised one — the constraint is exact, and a near miss is evidence something else wrote the row');
eq(readPose(' front '), null, 'nor a padded one');
eq(readPose('front-on'), null, 'nor a spelling this app has never written');
eq(readPose(3), null, 'nor a number');
eq(readPose({ pose: 'front' }), null, 'nor an object that happens to contain one');

/* ── what a label says, and what it refuses to say ─────────────────────── */

eq(poseLabel('front'), 'Front on', 'a pose reads as a direction a person would recognise');
eq(poseLabel('side'), 'Side on', 'a pose reads as a direction a person would recognise');
eq(poseLabel('back'), 'From behind', 'a pose reads as a direction a person would recognise');
eq(poseLabel(null), null,
  'an unlabelled photo gets no label at all — "Unknown" would say the app looked at the picture, and it never does');

/* ── absent is not agreement ───────────────────────────────────────────── */

eq(posesMatch('front', 'front'), 'same', 'two front-on photos show the same view');
eq(posesMatch('front', 'side'), 'different', 'a front and a side do not');
eq(posesMatch('side', 'back'), 'different', 'nor a side and a back');
eq(posesMatch('front', null), 'unknown', 'one labelled photo and one unlabelled settles nothing');
eq(posesMatch(null, 'front'), 'unknown', 'in either order');
eq(posesMatch(null, null), 'unknown',
  'and two unlabelled photos are NOT a match — that reading is the original bug, since every row in the table is unlabelled');

/* ── the sentence fires exactly once, on the case that needs it ────────── */

const note = poseMismatchNote('front', 'side');
ok(note != null && note.includes('front on') && note.includes('side on'),
  'a mismatch names both views rather than saying only that they differ');
ok(note != null && /angle/.test(note),
  'and says what is not comparable — the shape — rather than telling the member they chose wrong');
ok(note != null && !/wrong|mistake|should/i.test(note),
  'a member who deliberately compared two angles is not being corrected');

eq(poseMismatchNote('front', 'front'), null, 'nothing is said about a pair that agrees');
eq(poseMismatchNote('front', null), null, 'and nothing about a pair the app cannot judge');
eq(poseMismatchNote(null, null), null,
  'least of all about two unlabelled photos, which is every comparison anybody has made so far — a caveat on all of them is a caveat nobody reads');

/* ── every pair of real poses is decided, one way or the other ─────────── */

for (const a of POSES) {
  for (const b of POSES) {
    const m = posesMatch(a, b);
    eq(m, a === b ? 'same' : 'different', `${a} against ${b} is settled without a shrug`);
    eq(poseMismatchNote(a, b) != null, a !== b, `${a} against ${b} gets a sentence only when it needs one`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('photoPose: ok — a pose is what the member said, and absent is not agreement');
