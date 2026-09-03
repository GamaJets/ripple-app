// A member's profile photo: what may be stored in `profiles.avatar`, and what
// must never be.
//
// ── What was in that column ───────────────────────────────────────────────
//
// app/(client)/profile.tsx handed `ImagePicker`'s asset uri straight to
// `setPhoto`, and src/ui/clientData.tsx wrote that string into
// `profiles.avatar`. On a phone that string is
// `file:///var/mobile/Containers/Data/Application/<UUID>/tmp/…jpg` — a path
// inside one handset's own sandbox. Three things followed:
//
//   1. The member saw their photo, because their device could open its own
//      file, and concluded their coach could see it too.
//   2. The coach got a blank circle, in the message thread and on the roster,
//      because `profiles.avatar` is read by other accounts as a URL and a
//      device path is not one anywhere but on that device.
//   3. The member's own copy vanished the first time iOS cleared the picker's
//      cache, with nothing on screen having changed.
//
// And the row is shared: a container path is a small piece of the member's
// device, written into a row their coach, their gym and the web console read.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// `profiles.avatar` holds a URL every reader can fetch, or nothing. There is no
// third state, and this module is where that is decided rather than in each of
// the four places that read the column. `isDeviceAvatar` is the guard on the
// way in — src/ui/clientData.tsx will not write one — and `avatarSource` is the
// guard on the way out, so the rows already carrying a device path draw as a
// monogram rather than as a broken image.
//
// The bytes go to the `avatars` bucket in supabase/parts/961 and the public URL
// of the stored object is what the column gets. src/ui/avatarUpload.ts is the
// upload; nothing in this file has a device, a network or React in it, so every
// rule below is asserted under `npm test`.

/** The bucket from supabase/parts/961. */
export const AVATAR_BUCKET = 'avatars';

/**
 * The same 2 MB the bucket is configured with, said here as well so the app can
 * refuse a file with a sentence BEFORE a byte leaves the phone. Storage answers
 * an over-large object with a 413 that arrives as an opaque failure.
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** The longest edge a profile photo is stored at. It is drawn at 34–96 px in
 *  this app and at about 128 in the console; 512 covers a retina render of the
 *  largest of those with room to spare, and keeps the upload quick on the gym
 *  wifi this is done on. */
export const AVATAR_MAX_PX = 512;

/**
 * The object key for a member's photo.
 *
 * The first folder is the member's own id because that is what the storage
 * policy scopes writes by — `(storage.foldername(name))[1] = auth.uid()::text`,
 * the same shape parts 91, 124 and 330 use. The rest is random, so replacing a
 * photo is a new object rather than new bytes behind a key somebody has already
 * loaded, and no URL can be derived from knowing whose it is.
 *
 * Throws rather than falling back: a key built from a blank id would be written
 * at the root of a shared bucket, where the policy would refuse it and the
 * failure would look like a network fault.
 */
export function avatarObjectKey(uid: string, token: string): string {
  const id = (uid ?? '').trim();
  const tok = (token ?? '').trim().toLowerCase();
  if (!id) throw new Error('An avatar key needs the signed-in id.');
  if (!/^[a-z0-9]{8,}$/.test(tok)) throw new Error('An avatar key needs a random token.');
  return `${id}/${tok}.jpg`;
}

/** Why these bytes cannot be stored, or null when they can. */
export function avatarRefusal(byteLength: number): string | null {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return 'That image could not be read off your phone, so nothing was uploaded.';
  }
  if (byteLength > MAX_AVATAR_BYTES) {
    return 'That photo is too large to store. Choose a smaller one, or take a new photo.';
  }
  return null;
}

/**
 * Is this a path on somebody's handset rather than a URL?
 *
 * Every scheme a picker on either platform can hand back. `content://` is
 * Android's, `ph://` and `assets-library://` are the iOS photo library's, and a
 * bare `/var/…` or `/data/…` is what a few libraries return with no scheme at
 * all. All of them are local to one device and none of them means anything in
 * a shared row.
 */
export function isDeviceAvatar(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return false;
  return (
    v.startsWith('file:')
    || v.startsWith('content:')
    || v.startsWith('ph:')
    || v.startsWith('assets-library:')
    || v.startsWith('/var/')
    || v.startsWith('/data/')
    || v.startsWith('/storage/')
  );
}

/**
 * The avatar to draw, or null to draw a monogram.
 *
 * Null for a device path — including the ones already stored, which is the
 * whole reason this is a function and not a truthiness check. Null too for the
 * literal strings 'null' and 'undefined', which is what a write that stringified
 * a missing value leaves behind and which would otherwise be requested as a
 * relative URL.
 */
export function avatarSource(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (v === 'null' || v === 'undefined') return null;
  if (isDeviceAvatar(v)) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^data:image\//i.test(v)) return v;
  return null;
}

/**
 * What to tell a member whose stored photo is a device path.
 *
 * Shown on their own profile, because they are the only person who can fix it
 * and because from where they are sitting nothing looks wrong: the old app drew
 * their own file happily. It says what happened rather than "add a photo",
 * which would read as though they had never set one.
 */
export const DEVICE_AVATAR_NOTE =
  'Your photo was saved as a file on the phone that chose it, so nobody else could ever see it — your coach has been looking at a blank circle. Choose it again and it will be uploaded properly this time.';

/** What to say when the upload did not happen. Never "saved". */
export const AVATAR_UPLOAD_FAILED_NOTE =
  'Your photo was not uploaded, so it has not been changed. Nothing was saved anywhere and you can try again in a moment.';

/** What to say when the build has no server behind it. */
export const AVATAR_NO_SERVER_NOTE =
  'This build has no server, so a photo has nowhere to go and would not reach your coach.';
