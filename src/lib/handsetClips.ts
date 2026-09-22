// The clips that never left this handset — and whose they are.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// src/ui/exerciseVideos.ts kept them under one unqualified AsyncStorage key:
//
//   const KEY = 'repple.exerciseVideos';
//   try { const raw = await AsyncStorage.getItem(KEY); if (raw) setAdded(JSON.parse(raw)); } catch {}
//   const persist = (next) => { setAdded(next); AsyncStorage.setItem(KEY, JSON.stringify(next)); };
//
// That is the shape src/lib/mealSwaps.ts was written to end, for the same
// handset and for the same reason. A key with no account in it is a key the
// next account inherits, and nothing cleared it: the key was not in
// `PERSONAL_DEVICE_KEYS` (src/lib/signOutState.ts), and it is the only mention
// of that string in the repository, so no screen removed it either. It
// survived sign-out, sign-in and the next member entirely.
//
// ── What it actually holds, checked rather than assumed ───────────────────
//
// An `added` entry is a clip whose row was REFUSED — `addVideo` returns 'local'
// and keeps the entry on the phone: a name, a muscle group, an external link if
// the coach pasted one, and the storage `path` of a video already uploaded to
// the private bucket under the uploader's own folder.
//
// The end that reads it is narrower than it first looks, and the difference is
// worth writing down rather than repeating:
//
//   · `useExerciseVideos` is imported by app/(trainer)/videos.tsx,
//     app/(trainer)/library.tsx and app/(trainer)/exercise.tsx. Nothing else in
//     the tree imports it, and `exercise_videos` is read nowhere else.
//   · The CLIENT screens do not read it. app/(client)/exercise.tsx,
//     app/(client)/library.tsx and app/(client)/workouts.tsx reach clips
//     through `useExerciseDetail` / `useExerciseCatalogue` in
//     src/ui/exerciseDetail.ts, which queries the catalogue and never touches
//     this key. And app/(trainer)/_layout.tsx redirects when
//     `groupAllowed('trainer')` is false, so a member's build cannot render the
//     screens that do.
//
// So the inheritance is coach → next person on a coach build, not coach →
// client. It is still a person's record left for a stranger: the next coach to
// sign in on the gym's handset opens Videos and reads the previous coach's clip
// names and muscle groups — which at this gym are things like a named client's
// rehab drill — beside a play button. A pasted `url` plays for them; a `path`
// into the private bucket does not, because `exvid_object_r` needs a row and
// there is none, so that one fails as a video that will not load rather than as
// a leak of the file.
//
// ── The fix ───────────────────────────────────────────────────────────────
//
// The account goes in the key, exactly as src/lib/mealSwaps.ts puts it in the
// meal-swap key. A key with the account in it is unreadable to the next account
// by construction, which is why src/lib/signOutState.ts needs no entry for it
// and says so about every other per-account key.
//
// ── What is NOT migrated, and why ─────────────────────────────────────────
//
// The old global key is deleted rather than read into the signed-in account,
// which is the call Lane 4 made for `repple.mealOverride` and it is the same
// call here. Reading it would be the defect performed once, deliberately:
// nothing on the device distinguishes a single-owner handset's own old clips
// from a shared handset's previous coach's, and the cost of guessing wrong is
// one coach's clip list appearing under another coach's name — on the screen
// that then offers to share it. Guessing right saves a coach re-adding a
// handful of entries that never reached the server anyway.
// `LEGACY_HANDSET_CLIPS_KEY` is exported so the hook can remove it on sight and
// so the choice is visible to a reader rather than implied.

/** Who a trainer decided may watch a clip. Mirrors the CHECK constraint on
 *  exercise_videos.visibility; 'private' still reaches anyone named in
 *  exercise_video_grants. Declared here rather than in the hook because the
 *  validator below has to narrow to it. */
export type ClipVisibility = 'private' | 'clients' | 'gym' | 'public';

/**
 * One clip as the handset holds it.
 *
 * Structurally the hook's `VideoItem`, which is an alias of this — one shape,
 * so the thing that is written and the thing that is validated cannot drift.
 */
export interface StoredClip {
  id: string;
  name: string;
  group: string;
  dur: string;
  /** Whether there is anything a player could actually open. */
  uploaded: boolean;
  url?: string;
  /** Path inside the private bucket, when we host the file ourselves. */
  path?: string;
  /** Catalogue id of the movement this demonstrates, or null for an entry that
   *  never reached the server. */
  exerciseId: string | null;
  /** Whose clip it is. Null means a platform clip belonging to no gym. */
  trainerId: string | null;
  visibility: ClipVisibility;
}

/** Every handset-clip key starts with this. Nothing reads it at runtime; it is
 *  here so the shape can be asserted and recognised. */
export const HANDSET_CLIPS_PREFIX = 'repple.exerciseVideos:';

/** The unqualified key this replaces. Removed on sight, never read — see the
 *  header. */
export const LEGACY_HANDSET_CLIPS_KEY = 'repple.exerciseVideos';

/** The id prefix `useExerciseVideos` mints for an entry with no row behind it.
 *  src/lib/clipOwner.ts is where that prefix is given its meaning; this is the
 *  writing end of the same fact. */
const LOCAL_ID_PREFIX = 'vx';

const VISIBILITIES: readonly ClipVisibility[] = ['private', 'clients', 'gym', 'public'];

/**
 * Where this coach's handset clips live.
 *
 * Null when there is no account to scope them to — signed out, or a session
 * still restoring — and a null means DO NOT PERSIST. Falling back to a shared
 * key is the defect itself. Nothing is lost by not saving: a clip added before
 * anybody is signed in belongs to no coach, and `addVideo` cannot have reached
 * the server with it either.
 */
export function handsetClipsKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  // 'unknown' is the literal src/ui/clientData.tsx settles on before the auth
  // read lands, and it is not an account. It is guarded here for the same
  // reason mealSwapsKey guards it: every signed-out session on a handset would
  // otherwise share one key, which is what this file exists to stop.
  if (!id || id === 'unknown') return null;
  return `${HANDSET_CLIPS_PREFIX}${id}`;
}

/** Whether a key holds somebody's handset clips. For the sign-out assertion. */
export const isHandsetClipsKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(HANDSET_CLIPS_PREFIX);

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The clips read back off a stored string.
 *
 * Every field is checked rather than trusted. The old code was a bare
 * `JSON.parse` inside a `try`, so anything that parsed at all was spread
 * straight into the list the library screen renders and the player opens —
 * and two of those fields decide what the app DOES rather than what it shows:
 *
 *   · `id`. `removeVideo` branches on a 'db' prefix and deletes a row and its
 *     stored object by it. An entry in this store has never had a row, so an
 *     id that claims one is refused here rather than sent to the server.
 *   · `path`. It is handed to `createSignedUrl` against the private bucket.
 *
 * An entry that is not shaped like a clip is DROPPED rather than repaired:
 * there is no honest repair for a name or an id that is not a string, and half
 * a clip drawn in a library is a row a coach taps.
 *
 * An unreadable blob is NO clips. That is not a failed read being called an
 * empty one — the caller keeps its own `hydrated` flag false on a failed READ
 * and refuses to write, so "we could not parse this" and "the store would not
 * answer" stay different facts at the one place they differ: whether the next
 * write is allowed to stand on top of the bytes.
 */
export function readHandsetClips(raw: string | null | undefined): StoredClip[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: StoredClip[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const v = entry as Record<string, unknown>;
    const id = text(v.id);
    // A local entry, or nothing. See above: the prefix is what stops a stored
    // blob steering a DELETE at somebody's row.
    if (!id.startsWith(LOCAL_ID_PREFIX)) continue;
    const name = text(v.name);
    if (!name) continue;
    const url = text(v.url);
    const path = text(v.path);
    const exerciseId = text(v.exerciseId);
    out.push({
      id,
      name,
      group: text(v.group) || 'Uncategorised',
      // 'clip' when we hold the file, 'link' when the coach pointed at one —
      // derived rather than trusted, so a stored `dur` cannot disagree with the
      // two fields it describes.
      dur: path ? 'clip' : 'link',
      // Derived for the same reason `dur` is. `uploaded` means "a player has
      // something to open", and the two fields it is a statement about are
      // right here; a stored `true` beside no link and no path is what drew an
      // entry as "Live" and counted it toward "N of M recorded" once already
      // (see rowToItem in src/ui/exerciseVideos.ts).
      uploaded: !!(path || url),
      ...(url ? { url } : {}),
      ...(path ? { path } : {}),
      exerciseId: exerciseId || null,
      // Always null, and not read off the blob. An entry in this store has no
      // row, so it has no trainer_id; a stored non-null would be a claim about
      // ownership that nothing on the server backs. src/lib/clipOwner.ts reads
      // the pair and answers 'local' off the id, which is the same answer — but
      // it should not depend on this file having been honest by luck.
      trainerId: null,
      // Narrowed, never widened. An unreadable visibility on a clip with no row
      // shares nothing either way, and guessing 'gym' at a value we cannot read
      // is the one direction that could ever cost somebody something.
      visibility: VISIBILITIES.includes(v.visibility as ClipVisibility)
        ? (v.visibility as ClipVisibility)
        : 'private',
    });
  }
  return out;
}

/** The clips as they go to the store. The counterpart of `readHandsetClips`,
 *  routed through it so that what is written is exactly what will be read back
 *  and the two cannot drift. */
export function writeHandsetClips(clips: readonly StoredClip[]): string {
  return JSON.stringify(readHandsetClips(JSON.stringify(clips ?? [])));
}
