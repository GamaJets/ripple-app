// Where a technique clip goes, and what a coach is told when it does not go
// there.
//
// ── Why a millisecond was not a key ────────────────────────────────────────
//
// src/ui/exerciseVideos.ts built its object key as `${uid}/${Date.now()}.mp4`
// and wrote it with `upsert: true` — the only `upsert: true` against storage
// anywhere in this repository. Every other bucket passes `upsert: false` and
// puts a random token in the key: coachLogoPath() (src/lib/coachLogo.ts),
// coachDocPath() (src/lib/coachDocs.ts), the avatar and message-attachment
// keys, and photoObjectPath() all build `<uid>/<millis>-<token>…`.
//
// The two halves are one decision, not two. `upsert: true` sends `x-upsert`,
// which turns the write into an `insert … on conflict do update` against
// `storage.objects` — and that is a REPLACEMENT of the bytes behind a key that
// a client may already hold a signed URL for. `exercise-videos` is the one
// bucket in this product whose objects are handed to NAMED OTHER PEOPLE by an
// explicit act (`exercise_video_grants`), so the bucket with the sharing
// mechanism was the bucket with the overwrite hole. supabase/parts/1150 drops
// `exvid_object_u` — the only UPDATE policy on `storage.objects` in the whole
// project, counted live — and names this file as its follow-up.
//
// With the policy gone, `upsert: true` still SENDS, because the table-level
// UPDATE grant is Supabase's and is untouched; it simply fails at the row when
// a key collides. So `upsert: false` is not a workaround for the policy, it is
// the honest statement of what the app actually wants: a new object every time.
// And once the app is asking for a new object every time, the key has to BE new
// every time. A millisecond is not: two taps inside the same millisecond from
// one coach collide, and — far more likely on a phone — `Date.now()` is not
// monotonic across a clock correction, a timezone change or a manual clock set.
// The token is what makes the key new; the timestamp is only what makes a
// folder listing read in order.
//
// ── Why the sentences are here ────────────────────────────────────────────
//
// A refused upload used to be `if (error) return null` and nothing else — no
// report, no distinction between "you are signed out", "that key is taken" and
// "the network died". The screen said "Check your connection and try again" to
// all three. These are pure so the reason and the sentence are assertable
// without a device, a session or a bucket.

/** The private bucket. Named once so the three call sites in
 *  src/ui/exerciseVideos.ts cannot drift apart from each other. */
export const VIDEO_BUCKET = 'exercise-videos';

/**
 * Where one coach's clip goes.
 *
 * The first segment is the uploader's own id, because that is the whole of the
 * storage write rule — `exvid_object_w` is
 * `(storage.foldername(name))[1] = auth.uid()::text` and nothing else — so a
 * path shaped any other way is refused before a byte moves.
 *
 * `at` and `token` are arguments rather than read here, exactly as
 * coachDocPath() takes them: the caller supplies the randomness it already
 * has, and this stays pure and testable.
 *
 * The token is sanitised rather than trusted, and never empty. A key ending in
 * `-.mp4` would look like a bug in a bucket listing, and an unsanitised token
 * could carry a `/` and put the object one folder deeper than the policy
 * expects — which would be refused, but refused for a reason nobody could see
 * from the key.
 */
export function exerciseVideoPath(uid: string, at: number, token: string): string {
  const safe = String(token ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'clip';
  return `${uid}/${Math.floor(at)}-${safe}.mp4`;
}

/**
 * Is this key inside this coach's own folder?
 *
 * The TypeScript half of `exvid_object_w`, applied before the upload rather
 * than after the refusal. One folder deep and no traversal: `foldername(name)`
 * takes the FIRST segment of a longer path happily, so a key like
 * `<uid>/a/b.mp4` satisfies the policy while being a shape nothing in this app
 * writes or expects to read back.
 */
export function isOwnVideoPath(uid: string | null | undefined, path: string | null | undefined): boolean {
  const id = String(uid ?? '').trim();
  const p = String(path ?? '').trim();
  if (!id || !p || p.length > 200) return false;
  if (!p.startsWith(`${id}/`)) return false;
  const rest = p.slice(id.length + 1);
  return !!rest && !rest.includes('/') && !rest.includes('..');
}

/** Why an upload did not happen. Four causes that want four different next
 *  actions from the coach, and which the one old sentence covered with
 *  "check your connection". */
export type VideoUploadRefusal = 'signed-out' | 'taken' | 'refused' | 'unreachable';

/**
 * What storage said, as one of the four.
 *
 * `taken` is the case `upsert: false` newly makes possible: the object already
 * exists, which storage answers with 409 / "Duplicate". It is the ONLY one of
 * the four where trying again immediately is the right advice, because the next
 * attempt mints a fresh token — so it is worth telling apart rather than
 * folding into a general failure.
 *
 * Anything storage answered but did not explain is `refused`, never
 * `unreachable`: a server that replied is not an absent network, and telling
 * somebody standing in a gym with four bars to check their connection sends
 * them to fix the one thing that is working.
 */
export function videoUploadRefusal(error: unknown): VideoUploadRefusal {
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown; error?: unknown } | null;
  if (!e) return 'refused';
  const status = Number(e.statusCode ?? e.status ?? NaN);
  const text = `${String(e.message ?? '')} ${String(e.error ?? '')}`.toLowerCase();
  if (status === 409 || text.includes('duplicate') || text.includes('already exists') || text.includes('resource already')) {
    return 'taken';
  }
  if (status === 401 || status === 403 || text.includes('jwt') || text.includes('unauthor')) return 'refused';
  // Only a failure with no reply at all is a network failure. supabase-js
  // surfaces those as a TypeError from fetch with no status on it.
  if (!Number.isFinite(status) && (text.includes('network') || text.includes('fetch') || text.includes('timeout'))) {
    return 'unreachable';
  }
  return 'refused';
}

/**
 * The sentence the coach reads, per cause.
 *
 * Each one ends in the action that would actually work. None of them claims the
 * clip was saved, and none of them claims it was lost from the phone — the file
 * the coach picked is still on their handset either way, and saying so is what
 * stops somebody deleting the original before checking.
 */
export function videoUploadFailureLine(reason: VideoUploadRefusal): string {
  switch (reason) {
    case 'signed-out':
      return 'That clip was not uploaded because you are not signed in on this device. Sign in and add it again — the video is still on your phone.';
    case 'taken':
      return 'That clip was not uploaded because another file was already stored under the same name. Tap add again; it will be given a new one.';
    case 'unreachable':
      return 'That clip was not uploaded — we could not reach the server. The video is still on your phone; try again when you have a connection.';
    case 'refused':
    default:
      return 'That clip was not uploaded. The server refused the file and nothing was saved, so nobody has been given a link to it. The video is still on your phone — try again in a moment.';
  }
}
