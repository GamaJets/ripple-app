// Reading, choosing, uploading and clearing a coach's logo. The only module
// that touches `trainers.logo_path` or the `coach-logos` bucket.
//
// ── Why the uploader ships with the column ────────────────────────────────
//
// app/(trainer)/brand.tsx refused a logo field because "a second image column
// with no uploader behind it is precisely the promise that had to be walked
// back". That is the reason this file exists rather than the reason the column
// does not: the column (supabase/parts/330), this uploader, and the three
// artefacts that draw it are one change, and none of them ships alone.
//
// ── The shape this follows ────────────────────────────────────────────────
//
// src/ui/messaging.ts, clause for clause, because a message attachment is the
// same problem and its answers were paid for:
//
//   · the picker is opened through `ensureMediaPermission`, which says its own
//     piece — including offering Settings when iOS will not ask again;
//   · the image is downscaled and re-encoded before a byte leaves, so what is
//     stored is a type the bucket accepts and not the HEIC an iPhone hands back;
//   · the size is checked HERE against the bucket's own limit, so an over-large
//     file is refused with a sentence rather than arriving as an opaque 413;
//   · THE FILE GOES FIRST, then the row. If the object does not land, the column
//     is not written — a record pointing at bytes that are not there is a logo
//     that renders as nothing with no way to find out why;
//   · and if the row is then refused, the object just uploaded is removed, so
//     the bucket does not fill with files nothing points at.
//
// ── Why the picture comes back as base64 rather than as a URL ─────────────
//
// Every place this logo is drawn is an EXPORT: an invoice's HTML handed to
// expo-print, a report's HTML, a PNG rasterised out of an SVG. A remote URL in
// any of those is a race — the renderer captures whatever has loaded — and its
// failure mode is a blank rectangle in a file that has already left the phone.
// So the bytes are fetched, encoded, and embedded. `base64FromBytes` and
// `safeLogoDataUri` in src/lib/coachLogo.ts are the pure halves of that.
import { useCallback, useEffect, useState } from 'react';
// Both are on scripts/check-native.mjs's SETTLED_IN_EVERY_BINARY list — every
// binary that accepts today's bundle has them — which is why src/ui/messaging.ts
// imports them the same way. The rule about bare imports is about modules that
// THROW on an older binary, and these two cannot be in one.
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { VARIANT } from '../lib/variant';
import { reportError } from '../lib/reportError';
import { writeFailure } from '../lib/wroteRows';
import { ensureMediaPermission } from './permissions';
import {
  LOGO_BUCKET, LOGO_MAX_PX, base64FromBytes, coachLogoPath, isOwnLogoPath,
  logoContentType, logoDataUri, logoExtension, logoRefusal, safeLogoDataUri,
} from '../lib/coachLogo';
import type { LoadStatus } from './loadStatus';

/** How long a signed URL for the coach's own logo lasts. One minute: it is
 *  fetched immediately and turned into bytes, and it is never handed to
 *  anything that keeps it. */
const LOGO_URL_TTL_S = 60;

/* ── the record ───────────────────────────────────────────────────────────── */

/**
 * The signed-in coach's stored logo key, or null when they have set none.
 *
 * Coach app only, and the guard is the one src/lib/trainerProfileAccess.ts
 * argues for: this reads the SIGNED-IN user's `trainers` row, so on the client
 * app it would be the reader's own.
 *
 * Throws on a failed read. A resolved null cannot tell "no logo" from "we could
 * not find out", and the screen has to say different things about them.
 */
export async function fetchMyLogoPath(): Promise<string | null> {
  if (!USE_SUPABASE || VARIANT !== 'trainer') return null;
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not signed in.');
  const { data, error } = await supabase
    .from('trainers').select('logo_path').eq('id', uid).maybeSingle();
  if (error) throw error;
  const path = (data?.logo_path as string | null) ?? null;
  // Judged against the caller's OWN id, which is what the storage policy reads.
  // A key pointing anywhere else is not signed and not drawn, whatever the
  // column says — the same discipline `viewerMaySee` keeps in photoShare.ts.
  return path && isOwnLogoPath(uid, path) ? path : null;
}

/* ── choosing one ─────────────────────────────────────────────────────────── */

export interface PickedLogo {
  uri: string;
  mimeType: string | null;
}

/**
 * Open the library.
 *
 * `{ picked: null, error: null }` is somebody backing out, which is not a
 * failure and must not raise anything at them. An `error` is a sentence to
 * show. `ensureMediaPermission` has already spoken for a refused permission, so
 * that case comes back as a plain cancel.
 *
 * Library only, and no camera option. A logo is a file somebody has; offering
 * to photograph one produces a picture of a screen, at an angle, with a
 * reflection in it.
 */
export async function pickLogo(): Promise<{ picked: PickedLogo | null; error: string | null }> {
  if (!(await ensureMediaPermission('library', 'set the logo that goes on your invoices and cards'))) {
    return { picked: null, error: null };
  }
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (res.canceled || !res.assets || !res.assets[0]) return { picked: null, error: null };
    const a = res.assets[0];
    return { picked: { uri: a.uri, mimeType: a.mimeType ?? null }, error: null };
  } catch (e) {
    reportError('coachLogo.pick', e);
    return { picked: null, error: 'Your photos could not be opened. Try again.' };
  }
}

/* ── storing one ──────────────────────────────────────────────────────────── */

const newToken = (): string =>
  Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '').padEnd(8, '0');

/**
 * Put the chosen image in the bucket and point the column at it.
 *
 * Returns `{ path }` only when BOTH landed. Every other outcome is `{ error }`
 * with something a person can read, and the caller must not tell a coach their
 * logo is set on the strength of having tried.
 *
 * A PNG is kept as a PNG. That is not a nicety: a mark on a transparent ground
 * is the normal case, and flattening one to JPEG puts a white box behind it on
 * a card whose ground is nearly black. Everything else is re-encoded as JPEG,
 * because the picker hands back HEIC on an iPhone and the bucket does not
 * accept it — uploading one under an image/jpeg content type would be storing a
 * file whose declared type is a lie.
 */
export async function uploadMyLogo(
  coachId: string,
  picked: PickedLogo,
  previousPath: string | null,
): Promise<{ path: string | null; error: string | null }> {
  if (!USE_SUPABASE) return { path: null, error: 'This build has no server, so your logo has nowhere to go.' };
  if (!coachId) return { path: null, error: 'Your logo was not saved, because there is nobody signed in to save it for.' };

  const keepPng = String(picked.mimeType ?? '').toLowerCase() === 'image/png';
  let uri = picked.uri;
  try {
    const out = await ImageManipulator.manipulateAsync(
      picked.uri,
      [{ resize: { width: LOGO_MAX_PX } }],
      {
        compress: 0.9,
        format: keepPng ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
      },
    );
    uri = out.uri;
  } catch (e) {
    reportError('coachLogo.prepare', e);
    return { path: null, error: 'That image could not be prepared. Try a PNG or a JPEG export of it.' };
  }

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(uri);
    if (!res.ok) return { path: null, error: 'That image could not be read off your phone.' };
    bytes = await res.arrayBuffer();
  } catch (e) {
    reportError('coachLogo.read-file', e);
    return { path: null, error: 'That image could not be read off your phone.' };
  }

  // Before a byte leaves, and against the bucket's own limit.
  const refusal = logoRefusal(bytes.byteLength);
  if (refusal) return { path: null, error: refusal };

  const ext = logoExtension(keepPng ? 'image/png' : 'image/jpeg');
  const path = coachLogoPath(coachId, Date.now(), newToken(), ext);
  const contentType = logoContentType(path);
  if (!contentType) return { path: null, error: 'That image is in a format this app cannot store.' };

  // upsert:false, and the key carries a timestamp and a token, so an upload is
  // always a new object. The bucket has no UPDATE policy by design (part 330):
  // replacing the bytes behind a key that has already been printed onto an
  // invoice is a change nobody could see afterwards.
  const up = await supabase.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (up.error) {
    reportError('coachLogo.upload', up.error, { path });
    return { path: null, error: 'Your logo could not be uploaded, so nothing has changed.' };
  }

  const res = await supabase.from('trainers').update({ logo_path: path }, { count: 'exact' }).eq('id', coachId);
  if (res.error) reportError('coachLogo.save', res.error);
  const failed = writeFailure('Your logo', res);
  if (failed) {
    // The row was refused, so the object it would have pointed at is removed.
    // A file nothing references is a file nobody can find and nobody can
    // delete — src/ui/messaging.ts made the same clean-up its own rule.
    await removeObject(path);
    return { path: null, error: failed };
  }

  // Only now: the old object is unreferenced and safe to remove. Doing it any
  // earlier would leave a coach whose write failed with neither logo.
  if (previousPath && previousPath !== path) await removeObject(previousPath);
  return { path, error: null };
}

/**
 * Take the logo off the account.
 *
 * The column first, then the bytes, which is the opposite order to the upload
 * and for the same reason: after each step the state that exists is one that
 * makes sense. A cleared column with the object still in the bucket is a coach
 * with no logo; a deleted object with the column still set is a coach whose
 * documents point at nothing.
 */
export async function clearMyLogo(coachId: string, path: string | null): Promise<string | null> {
  if (!USE_SUPABASE) return 'Your logo was not cleared.';
  if (!coachId) return 'Your logo was not cleared.';
  const res = await supabase.from('trainers').update({ logo_path: null }, { count: 'exact' }).eq('id', coachId);
  if (res.error) reportError('coachLogo.clear', res.error);
  const failed = writeFailure('Your logo', res);
  if (failed) return failed;
  if (path) await removeObject(path);
  return null;
}

/** Remove one object, reporting rather than raising. The caller has already
 *  decided what the coach is told; a failed clean-up leaves a file nobody can
 *  see and must not turn a successful change into a failed one. */
async function removeObject(path: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(LOGO_BUCKET).remove([path]);
    if (error) reportError('coachLogo.remove', error, { path });
  } catch (e) {
    reportError('coachLogo.remove', e, { path });
  }
}

/* ── getting the picture back ─────────────────────────────────────────────── */

/**
 * The stored logo as a data URI, or null.
 *
 * Null covers every way this can fail and that is deliberate at THIS level: the
 * caller's answer is the same for all of them, because the fallback is the
 * artefact they were producing before logos existed. The screen that needs to
 * tell a coach the difference reads `status` off the hook below instead.
 */
export async function loadLogoDataUri(path: string | null): Promise<string | null> {
  if (!USE_SUPABASE || !path) return null;
  const contentType = logoContentType(path);
  if (!contentType) return null;
  try {
    const { data, error } = await supabase.storage.from(LOGO_BUCKET).createSignedUrl(path, LOGO_URL_TTL_S);
    if (error) { reportError('coachLogo.sign', error, { path }); return null; }
    const url = data?.signedUrl;
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Re-validated on the way out rather than trusted because it was just
    // built. This string is written into an HTML attribute by
    // src/lib/coachInvoice.ts, and the check that makes that safe belongs on
    // every path that produces one.
    return safeLogoDataUri(logoDataUri(base64FromBytes(new Uint8Array(buf)), contentType));
  } catch (e) {
    reportError('coachLogo.fetch', e, { path });
    return null;
  }
}

/* ── the hook every screen uses ───────────────────────────────────────────── */

export interface MyCoachLogo {
  status: LoadStatus;
  /** The stored key, or null when none is set. Meaningless under 'error'. */
  path: string | null;
  /** The picture, ready to draw or embed. Null when there is none, when it
   *  could not be read, or while it is still being fetched. */
  dataUri: string | null;
  /**
   * Which of those three nulls this is.
   *
   * `dataUri: null` was the same value for "no logo" and "the file would not
   * download", and a screen that publishes cannot tell them apart from it. The
   * coach had done the work, the record said the logo was set, and the card
   * that went out under their name was unbranded — with the failure visible on
   * no surface at all, least of all the permanent one.
   *
   *   'ready'   — there is nothing more to fetch: either no logo is set, or the
   *               picture is here.
   *   'loading' — a key is set and the file is on its way.
   *   'error'   — a key is set and the file did not arrive.
   */
  pictureStatus: LoadStatus;
  reload: () => void;
}

/**
 * The coach's own logo, read once per screen.
 *
 * `status` is about the RECORD — whether we know what is set. The picture is a
 * second step that can fail on its own, and when it does the status stays
 * 'ready' with a null `dataUri`: the coach's account is not in doubt, one
 * download is. Both cases produce the same document, which is the one that was
 * produced yesterday.
 */
export function useMyCoachLogo(): MyCoachLogo {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [path, setPath] = useState<string | null>(null);
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [pictureStatus, setPictureStatus] = useState<LoadStatus>('loading');
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    setPictureStatus('loading');
    (async () => {
      let key: string | null = null;
      try {
        key = await fetchMyLogoPath();
      } catch (e) {
        // A failed read is not "this coach has no logo". One told that would
        // set one again, over the top of whatever is really there.
        reportError('coachLogo.load', e);
        if (live) { setStatus('error'); setPath(null); setDataUri(null); setPictureStatus('error'); }
        return;
      }
      if (!live) return;
      setPath(key);
      setStatus('ready');
      setDataUri(null);
      // No key is nothing to fetch, which is a finished answer and not a
      // download in flight.
      if (!key) { setPictureStatus('ready'); return; }
      setPictureStatus('loading');
      const uri = await loadLogoDataUri(key);
      if (!live) return;
      setDataUri(uri);
      // `loadLogoDataUri` answers null for every way the file did not arrive —
      // the signature, the fetch, the bytes — and each of them leaves a coach
      // with a logo set and no picture of it.
      setPictureStatus(uri ? 'ready' : 'error');
    })();
    return () => { live = false; };
  }, [nonce]);

  return { status, path, dataUri, pictureStatus, reload };
}
