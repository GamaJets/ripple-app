// Whose clips a handset is holding. Compile with tsc, run with node.
//
// Four failures are guarded, and all four have a shared gym handset in them:
//
//   1. ONE KEY FOR EVERYBODY. `repple.exerciseVideos` had no account in it and
//      no entry in src/lib/signOutState.ts, so a clip a coach kept on the phone
//      because its row was refused was read back by the next coach to sign in.
//
//   2. A KEY THAT IS NOT AN ACCOUNT. An empty id, or the literal 'unknown' that
//      src/ui/clientData.tsx settles on before the auth read lands, must not
//      become a key: every signed-out session on the handset would share it,
//      which is the defect again under a longer name.
//
//   3. THE OLD KEY BEING READ. It is deleted, never migrated — there is no way
//      to tell a single-owner handset's own old clips from a shared handset's
//      previous coach's, and the wrong guess puts one coach's list under
//      another coach's name on the screen that offers to share it.
//
//   4. A STORED BLOB STEERING A WRITE. `removeVideo` deletes a row and its
//      stored object when an id starts with 'db', and `playbackUrl` signs
//      whatever `path` says. An entry in this store has never had a row, so an
//      id claiming one is refused here rather than sent to the server.
import {
  HANDSET_CLIPS_PREFIX, LEGACY_HANDSET_CLIPS_KEY, handsetClipsKey, isHandsetClipsKey,
  readHandsetClips, writeHandsetClips, type StoredClip,
} from './handsetClips';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const A = '11111111-2222-3333-4444-555555555555';
const B = '99999999-8888-7777-6666-555555555555';

const clip = (over: Partial<StoredClip> = {}): StoredClip => ({
  id: 'vx1a2b3c',
  name: 'Kettlebell Windmill',
  group: 'Shoulders',
  dur: 'clip',
  uploaded: true,
  path: `${A}/1700000000000-abcd1234.mp4`,
  exerciseId: 'kettlebell-windmill',
  trainerId: null,
  visibility: 'clients',
  ...over,
});

/* ── 1 · the account is in the key ─────────────────────────────────────── */

{
  const ka = handsetClipsKey(A);
  const kb = handsetClipsKey(B);
  ok(ka !== null && kb !== null, 'a signed-in account has a key');
  ok(ka !== kb, 'two accounts on one handset do not share a key');
  ok(ka!.startsWith(HANDSET_CLIPS_PREFIX), 'the key is recognisable as one of these');
  ok(isHandsetClipsKey(ka!), 'and recognised by the predicate the sign-out assertion uses');
  ok(!isHandsetClipsKey(LEGACY_HANDSET_CLIPS_KEY),
    'the unqualified key is NOT one of these — it is the thing being replaced');
  eq(handsetClipsKey(` ${A} `), ka, 'a padded id is the same account');
}

/* ── 2 · no account, no store ──────────────────────────────────────────── */

{
  for (const bad of [null, undefined, '', '   ', 'unknown']) {
    eq(handsetClipsKey(bad as string | null), null, `${JSON.stringify(bad)} is not an account and must not be a key`);
  }
}

/* ── 3 · the round trip, and what it refuses ───────────────────────────── */

{
  const one = clip();
  const back = readHandsetClips(writeHandsetClips([one]));
  eq(back.length, 1, 'a clip written is a clip read');
  eq(back[0].name, one.name, 'the name survives');
  eq(back[0].path, one.path, 'so does the path the player signs');
  eq(back[0].visibility, 'clients', 'and the visibility the coach chose');

  // A row id. The whole hazard: `removeVideo` would aim a DELETE at the server.
  eq(readHandsetClips(JSON.stringify([clip({ id: 'db7f3e' })])).length, 0,
    'an entry claiming a server row is dropped rather than kept');
  eq(readHandsetClips(JSON.stringify([clip({ id: '' })])).length, 0, 'an entry with no id is dropped');
  eq(readHandsetClips(JSON.stringify([clip({ name: '   ' })])).length, 0, 'an entry with no name is dropped');
  eq(readHandsetClips(JSON.stringify([clip(), null, 7, 'x', clip({ id: 'vx2' })])).length, 2,
    'the entries that are clips survive the ones that are not');

  // Never widened on a guess.
  eq(readHandsetClips(JSON.stringify([{ ...clip(), visibility: 'everyone' }]))[0].visibility, 'private',
    'a visibility we cannot read is narrowed, never widened');

  // Derived, not trusted: two facts about one clip cannot disagree.
  const linkOnly = readHandsetClips(JSON.stringify([
    { ...clip(), path: undefined, url: 'https://example.test/a.mp4', dur: 'clip', uploaded: false },
  ]))[0];
  eq(linkOnly.dur, 'link', 'a clip with no file of ours is a link');
  eq(linkOnly.uploaded, true, 'and a link is something a player can open');
  const empty = readHandsetClips(JSON.stringify([{ ...clip(), path: undefined, url: undefined, uploaded: true }]))[0];
  eq(empty.uploaded, false, 'an entry with no file and no link is not "Live" whatever it claims');

  // No entry in this store has a row, so none of them has a trainer.
  eq(readHandsetClips(JSON.stringify([clip({ trainerId: B })]))[0].trainerId, null,
    'a stored trainer id is not a claim this store gets to make');
}

/* ── 4 · an unreadable store is no clips, and says nothing else ────────── */

{
  for (const bad of [null, undefined, '', 'not json', '{"a":1}', '42', 'null']) {
    eq(readHandsetClips(bad as string | null).length, 0, `${JSON.stringify(bad)} reads as no clips`);
  }
  eq(writeHandsetClips([]), '[]', 'an empty list writes as an empty list');
  // The caller's `hydrated` flag is what separates "no clips" from "we could
  // not read": this function cannot, and must not pretend to.
  eq(readHandsetClips('[]').length, readHandsetClips('not json').length,
    'a parse failure and an empty store are the same VALUE here — the caller keeps the difference');
}

if (errors.length) {
  console.error(`handsetClips: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('handsetClips: ok');
