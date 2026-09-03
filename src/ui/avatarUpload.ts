// Putting a member's profile photo somewhere their coach can actually see it.
//
// The rules — the bucket, the key, the size, and what may be stored in
// `profiles.avatar` at all — are in src/lib/avatarImage.ts, where they are
// tested. This file is the part with a device and a network in it.
//
// ── The shape, and why it is this way round ───────────────────────────────
//
// `uploadMyAvatar` returns a URL only when the bytes are in the bucket. It does
// not write `profiles` — src/ui/clientData.tsx owns that column, does it with
// `count: 'exact'`, and reports a write that matched no rows as the failure it
// is. So the caller's order is: upload, and only on a URL call `setPhoto`.
// Nothing here reports success on the strength of having tried, which is the
// rule this codebase has broken four times.
//
// Modelled on src/ui/coachLogo.ts, which does the same job for a coach's mark
// against supabase/parts/330.
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import {
  AVATAR_BUCKET, AVATAR_MAX_PX, avatarObjectKey, avatarRefusal,
  AVATAR_NO_SERVER_NOTE, AVATAR_UPLOAD_FAILED_NOTE,
} from '../lib/avatarImage';

/** 16 hex characters. Not derived from the member, the date or the photo, so a
 *  URL cannot be constructed from anything anybody knows about them. */
const newToken = (): string => {
  let s = '';
  while (s.length < 16) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, 16);
};

export interface AvatarUpload {
  /** The public URL of the stored object. Null whenever anything at all went
   *  wrong — there is no partial success here. */
  url: string | null;
  /** A sentence to show. Null only when `url` is set. */
  error: string | null;
}

/**
 * Downscale the chosen image, put it in the bucket, and hand back the URL.
 *
 * The re-encode is not cosmetic. A picker on an iPhone hands back HEIC, and the
 * bucket accepts JPEG and PNG: uploading HEIC under an image/jpeg content type
 * would be storing a file whose declared type is a lie, and one no browser in
 * the console would draw. Everything becomes a JPEG at AVATAR_MAX_PX.
 */
export async function uploadMyAvatar(uid: string, localUri: string): Promise<AvatarUpload> {
  if (!USE_SUPABASE) return { url: null, error: AVATAR_NO_SERVER_NOTE };
  if (!uid) return { url: null, error: 'Your photo was not uploaded, because there is nobody signed in to store it for.' };

  let uri = localUri;
  try {
    const out = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: AVATAR_MAX_PX } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );
    uri = out.uri;
  } catch (e) {
    reportError('avatar.prepare', e);
    return { url: null, error: 'That photo could not be prepared, so nothing was uploaded. Try another one.' };
  }

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(uri);
    if (!res.ok) return { url: null, error: 'That photo could not be read off your phone, so nothing was uploaded.' };
    bytes = await res.arrayBuffer();
  } catch (e) {
    reportError('avatar.read-file', e);
    return { url: null, error: 'That photo could not be read off your phone, so nothing was uploaded.' };
  }

  const refusal = avatarRefusal(bytes.byteLength);
  if (refusal) return { url: null, error: refusal };

  let path: string;
  try {
    path = avatarObjectKey(uid, newToken());
  } catch (e) {
    reportError('avatar.key', e);
    return { url: null, error: AVATAR_UPLOAD_FAILED_NOTE };
  }

  // upsert:false against a fresh key every time. The bucket has no UPDATE
  // policy, for the reason parts 91, 124 and 330 give: replacing the bytes
  // behind a key somebody has already loaded is a change nobody can see.
  const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (up.error) {
    reportError('avatar.upload', up.error, { path });
    return { url: null, error: AVATAR_UPLOAD_FAILED_NOTE };
  }

  const pub = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = pub?.data?.publicUrl ?? null;
  if (!url) {
    // The object is in the bucket and nothing can point at it, so it is removed
    // rather than left as a file nobody can find — src/ui/coachLogo.ts and
    // src/ui/messaging.ts make the same clean-up their rule.
    reportError('avatar.public-url', new Error('no public url for stored avatar'), { path });
    await removeObject(path);
    return { url: null, error: AVATAR_UPLOAD_FAILED_NOTE };
  }
  return { url, error: null };
}

/**
 * ── The previous photo is NOT deleted here, and that is deliberate ────────
 *
 * src/ui/coachLogo.ts removes the old object, and it may: it writes the column
 * itself, with `count: 'exact'`, so it knows the new key is live before the old
 * one goes. This path cannot know that. `setPhoto` hands the URL to
 * src/ui/clientData.tsx, whose push is debounced and whose result arrives on
 * `saveFailed` some time later — so deleting the old object at the moment of
 * choosing would, on a failed write, leave a member with a column pointing at a
 * file that no longer exists and no photo anywhere.
 *
 * The cost is a superseded object left in the member's own folder. It is in
 * their export (src/lib/gdpr.ts lists the bucket) and it goes with the account.
 * Open work: a confirmed-write callback out of clientData is what would let the
 * old key be collected, and it belongs with that column's owner.
 */
async function removeObject(path: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (error) reportError('avatar.remove', error, { path });
  } catch (e) {
    reportError('avatar.remove', e, { path });
  }
}
