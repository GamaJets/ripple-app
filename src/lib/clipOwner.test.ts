// Which video-library rows a coach may actually manage.
// Compile with tsc, run with node.
//
// The bug: app/(trainer)/videos.tsx decided this with `v.id.startsWith('db')`
// under the name `mine`. That prefix means "there is a row in exercise_videos",
// not "the row is yours" — and `useExerciseVideos` reads the table WITHOUT a
// trainer filter on purpose, so the list also holds the clips that ship with
// Repple and every other coach's clips marked 'public'.
//
// The result was the visibility chip, the "Who can see this" panel, the
// named-sharing list and Remove offered over rows `exvid_trainer_rw`
// (trainer_id = auth.uid()) refuses. Proved live against phgfwzpkkwdysftlgkoq
// with a second seeded coach: one SELECT of the other coach's public clip, and
// an UPDATE of it affecting 0 rows and raising nothing at all — which the write
// path then reported to the coach as success.
import { clipOwner, canManageClip, canRemoveClip, type OwnableClip } from './clipOwner';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ME = 'coach-me';
const THEM = 'coach-them';

const mine: OwnableClip = { id: 'db-1111', trainerId: ME };
const theirs: OwnableClip = { id: 'db-2222', trainerId: THEM };
const platform: OwnableClip = { id: 'db-3333', trainerId: null };
const local: OwnableClip = { id: 'vx-4444', trainerId: null };

/* ── the reported bug ──────────────────────────────────────────────────── */

// All four of these start with 'db' or were treated as manageable by the old
// predicate. Only one of them is this coach's.
{
  eq(clipOwner(mine, ME), 'mine', "the coach's own row is theirs");
  eq(clipOwner(theirs, ME), 'other', "another coach's published clip is not");
  eq(clipOwner(platform, ME), 'platform', 'a clip that ships with Repple is not');
  eq(clipOwner(local, ME), 'local', 'and an entry that never reached the server is not');
}

// The controls the row offers. This is the assertion the old code failed: three
// of these four were drawn with the full sharing panel.
{
  ok(canManageClip(mine, ME), 'a coach manages their own clip');
  ok(!canManageClip(theirs, ME), 'a coach does not manage another coach’s clip');
  ok(!canManageClip(platform, ME), 'a coach does not manage a platform clip');
  ok(!canManageClip(local, ME), 'there is no row behind a local entry to manage');
}

/* ── the signed-in id is not always known ──────────────────────────────── */

// Null myId must not resolve to 'mine'. Guessing that way offers a control that
// cannot work and reports success when the server refuses it; guessing the
// other way hides a control for the moment it takes the session to land.
{
  eq(clipOwner(mine, null), 'other', 'an unknown reader owns nothing');
  ok(!canManageClip(mine, null), 'and is offered nothing to manage');
  // A null trainerId is still a platform clip whether or not we know the
  // reader, because that fact is about the row and not about the reader.
  eq(clipOwner(platform, null), 'platform', 'a platform clip is one regardless of who is looking');
}

// The empty string is not a match either. `auth.user?.id ?? null` is the source,
// but a `?? ''` anywhere upstream would otherwise make every platform-adjacent
// row "mine" for everybody at once.
{
  eq(clipOwner({ id: 'db-5', trainerId: '' }, ''), 'other', 'an empty id matches nobody');
}

/* ── remove is deliberately wider by exactly one case ───────────────────── */

// A local-only entry has no row to refuse the delete, and forgetting it is the
// only thing a coach can do with one. Reusing canManageClip here would take
// away their only way to clear a failed upload off the phone.
{
  ok(canRemoveClip(mine, ME), 'a coach removes their own clip');
  ok(canRemoveClip(local, ME), 'and can forget a local-only entry');
  ok(!canRemoveClip(theirs, ME), 'but cannot remove another coach’s clip');
  ok(!canRemoveClip(platform, ME), 'nor one that ships with Repple');
  // The two lists differ in exactly one place, which is the whole reason there
  // are two functions.
  const all = [mine, theirs, platform, local];
  eq(all.filter((c) => canRemoveClip(c, ME)).length
     - all.filter((c) => canManageClip(c, ME)).length,
     1, 'remove is wider than manage by one case, and only one');
}

/* ── the prefix is the type, and an unknown one is not "mine" ───────────── */

// There is no third id shape today. Inventing 'mine' for one that appears later
// is the failure the module exists to prevent.
{
  eq(clipOwner({ id: 'zz-9', trainerId: ME }, ME), 'local', 'an unrecognised prefix has no row behind it');
  ok(!canManageClip({ id: 'zz-9', trainerId: ME }, ME), 'so it is not managed');
}

// A row that is genuinely this coach's is not lost to any of the above — the
// useful half of the predicate has to survive the fix.
{
  eq(clipOwner({ id: 'db-abc-def', trainerId: ME }, ME), 'mine', 'a real uuid row still resolves to mine');
  ok(canManageClip({ id: 'db-abc-def', trainerId: ME }, ME), 'and is fully manageable');
}

if (errors.length) {
  console.error(`clipOwner: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('clipOwner ok — only a coach’s own row is offered the controls that write to it.');
