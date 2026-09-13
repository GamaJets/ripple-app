// A clip of one set. Compile with tsc, run with node.
//
// The failure worth guarding is not a broken upload. It is a path shaped so
// the storage policy reads the wrong first segment — which is the segment that
// decides whether the caller is the member or their coach, and therefore who
// can watch a video of somebody training.
import {
  formClipPath, isOwnClipPath, clipRefusal, clipRefusalLine, clipNoteLine,
  MEMBER_CONSENT_NOTE, MAX_CLIP_SECONDS, MAX_CLIP_BYTES, FORM_CLIP_BUCKET,
} from './formCheck';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const UID = '759c8d25-4d50-4a5c-bdb5-806bcad18ac1';
const WORKOUT = '33333333-4444-5555-6666-777777777777';

/* ── the first path segment is the whole of the access rule ───────────────── */

{
  const p = formClipPath(UID, WORKOUT, 2, 1_757_000_000_000, 'AbC!def');
  ok(p.startsWith(`${UID}/`), 'the key opens with the member id, which both storage policies match on');
  eq(p.split('/').length, 2, 'and is exactly one folder deep, so foldername()[1] is that id');
  ok(p.endsWith('.mp4'), 'and names itself a video');
  ok(/-2-/.test(p), 'the set index is in the key, so an orphan can be traced without a join');
  ok(!/[^a-z0-9/.\-]/.test(p.slice(UID.length + 1)), 'and nothing but safe characters follow the folder');
}

// A token that could carry a slash would put the object a folder deeper — which
// the policy refuses, but refuses for a reason nobody could see from the key.
{
  const p = formClipPath(UID, WORKOUT, 0, 1, 'a/b/../c');
  eq(p.split('/').length, 2, 'a token containing slashes cannot move the object');
  ok(!p.includes('..'), 'and cannot traverse');
}

// Nothing usable in the token still yields a legible key rather than one
// ending in a bare dash.
ok(/clip\.mp4$/.test(formClipPath(UID, WORKOUT, 0, 1, '!!!')), 'an empty token falls back to a named key');
ok(/workout-/.test(formClipPath(UID, '', 0, 1, 'tok')), 'and so does a missing workout id');

// A negative or absurd set index cannot produce a key the row cannot describe.
ok(/-0-/.test(formClipPath(UID, WORKOUT, -3, 1, 'tok')), 'a negative set index floors to zero rather than appearing in the key');

/* ── the same rule, applied before the upload rather than after ───────────── */

ok(isOwnClipPath(UID, `${UID}/w-0-1-abc.mp4`), 'a key in the member’s own folder passes');
ok(!isOwnClipPath(UID, `${UID}/deeper/w.mp4`), 'a key one folder deeper does NOT, even though the policy would allow it');
ok(!isOwnClipPath(UID, 'someone-else/w.mp4'), 'another member’s folder is refused');
ok(!isOwnClipPath(UID, `${UID}/../escape.mp4`), 'and so is traversal');
ok(!isOwnClipPath(null, `${UID}/w.mp4`), 'no signed-in id, no write');
ok(!isOwnClipPath(UID, ''), 'and no path, no write');
ok(!isOwnClipPath(UID, `${UID}/${'x'.repeat(300)}.mp4`), 'an absurd key is refused rather than sent');

/* ── who may hold a clip at all ───────────────────────────────────────────── */

eq(clipRefusal({ hasCoach: true, setExists: true }), null, 'a logged set and a coach is all it takes');

// The one an app would skip. A member with no coach filming into a bucket
// nobody can read is storage somebody pays for and nobody watches.
eq(clipRefusal({ hasCoach: false, setExists: true }), 'no-coach', 'no coach, no form check');
ok(/do not have one yet/.test(clipRefusalLine('no-coach') ?? ''), 'and the sentence says why, not "something went wrong"');
ok(/Find a coach/.test(clipRefusalLine('no-coach') ?? ''), 'and names the next action');

// The set is checked FIRST: a member with no coach AND no logged set should be
// told about the set, which is the thing in front of them.
eq(clipRefusal({ hasCoach: false, setExists: false }), 'no-set', 'the nearer problem is the one reported');

eq(clipRefusal({ hasCoach: true, setExists: true, seconds: MAX_CLIP_SECONDS + 1 }), 'too-long', 'over a minute is refused');
eq(clipRefusal({ hasCoach: true, setExists: true, seconds: MAX_CLIP_SECONDS }), null, 'exactly a minute is allowed');
eq(clipRefusal({ hasCoach: true, setExists: true, bytes: MAX_CLIP_BYTES + 1 }), 'too-big', 'and so is an oversized file');
// Unknown length or size is NOT a refusal: some pickers do not report either,
// and refusing on a missing measurement would block the feature on those phones.
eq(clipRefusal({ hasCoach: true, setExists: true, seconds: null, bytes: null }), null,
  'an unmeasured clip is allowed through — storage refuses it if it truly is too big');

/* ── consent, said before the camera opens ────────────────────────────────── */

ok(/goes to your coach and to nobody else/.test(MEMBER_CONSENT_NOTE), 'the note names exactly who sees it');
ok(/not your gym, not reception/.test(MEMBER_CONSENT_NOTE), 'and rules out the people a member would reasonably wonder about');
ok(/change coach/.test(MEMBER_CONSENT_NOTE), 'and says access ends when the coaching does');
ok(/delete it yourself/.test(MEMBER_CONSENT_NOTE), 'and that they can remove it');

/* ── what the coach reads ─────────────────────────────────────────────────── */

ok(/knee cave/.test(clipNoteLine('does my knee cave on rep 4', 'Tue')), 'the member’s own question is carried through');
ok(/“/.test(clipNoteLine('does my knee cave', null)), 'and quoted, because it is their words and not ours');
ok(/without a question/.test(clipNoteLine(null, 'Tue')), 'a clip with no question says so rather than showing an empty quote');
ok(/without a question/.test(clipNoteLine('   ', 'Tue')), 'and whitespace is not a question either');

eq(FORM_CLIP_BUCKET, 'form-checks', 'the bucket is named once and matches supabase/parts/2617');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('formCheck: ok (the key cannot leave the member’s folder, no coach means no clip, and consent is said before the camera opens)');
