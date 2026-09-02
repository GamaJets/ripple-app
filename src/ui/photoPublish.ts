// Reading and writing the permission to PUBLISH a progress photo. The only
// module that touches `progress_photo_publish_grants`.
//
// Two directions, deliberately in one file, exactly as src/ui/coachBrand.ts
// keeps its two:
//
//   · the CLIENT lists their own permissions, gives one and takes one back;
//   · the COACH lists the permissions addressed to them by one client, and can
//     do nothing else at all.
//
// One file because they are two ends of one wire and the failure worth
// preventing is the two ends disagreeing about what an absent row means.
// src/lib/photoPublish.ts holds every rule; nothing here decides anything.
//
// ── The asymmetry is the feature ─────────────────────────────────────────
//
// There is no coach-side write in this file and there must never be one. A
// permission a coach can author is not a permission — it is a checkbox with an
// audit trail. supabase/parts/331 enforces that with a SELECT-only policy for
// the coach, and this file matches it so a reader of either can see the shape
// of the other.
//
// ── Why a coach cannot ask for this from here ────────────────────────────
//
// There is also no "request permission" call, and that is a decision rather
// than a gap. A prompt from a coach, inside an app the coach's branding is on,
// asking a client to agree that their body may be posted, is a request made
// with the weight of the relationship behind it. The client's own Progress
// screen is where it is offered, on their own initiative, beside the photo it
// is about. If a coach wants to ask, they can ask them.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { PublishGrant } from '../lib/photoPublish';
// One embedded-image path for the whole app: the same base64 encoder and the
// same validator the coach's logo goes through. See src/lib/coachLogo.ts.
import { base64FromBytes, logoDataUri, safeLogoDataUri } from '../lib/coachLogo';
import type { LoadStatus } from './loadStatus';

const COLS = 'photo_id, client_id, coach_id, granted_at';

const rowToGrant = (r: any): PublishGrant => ({
  photoId: r.photo_id as string,
  clientId: r.client_id as string,
  coachId: r.coach_id as string,
  grantedAt: r.granted_at as string,
});

async function requireUid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const uid = data?.user?.id;
  if (!uid) throw new Error('Sign in to change what your coach may publish.');
  return uid;
}

/* ── the client's own permissions ─────────────────────────────────────────── */

/**
 * Every publication permission this client has outstanding.
 *
 * Throws on a read failure. The screen renders that as its own state — a
 * resolved empty array would be indistinguishable from a client who has agreed
 * to nothing, and those need opposite sentences.
 */
export async function fetchMyPublishGrants(): Promise<PublishGrant[]> {
  if (!USE_SUPABASE) return [];
  const uid = await requireUid();
  const { data, error } = await supabase
    .from('progress_photo_publish_grants')
    .select(COLS)
    .eq('client_id', uid)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToGrant);
}

/**
 * Agree that one photo may be used in something this coach publishes.
 *
 * Returns the row that now exists, read back from the server rather than
 * assembled locally, so nothing tells a client they have agreed to something on
 * the strength of a request that was never confirmed.
 *
 * The insert can be refused by the foreign key in part 331 when the photo has
 * not been sent to this coach. `publishBlocker` in src/lib/photoPublish.ts says
 * that in words BEFORE the request, so this path is the belt to that brace.
 */
export async function allowPublish(photoId: string, coachId: string): Promise<PublishGrant> {
  if (!USE_SUPABASE) throw new Error('This build has no server, so nothing was changed.');
  const uid = await requireUid();
  const { data, error } = await supabase
    .from('progress_photo_publish_grants')
    .insert({ photo_id: photoId, coach_id: coachId, client_id: uid })
    .select(COLS)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Nothing was changed. Try again in a moment.');
  return rowToGrant(data);
}

/**
 * Take that permission back.
 *
 * `.select()` so the delete reports what it actually removed. A delete that
 * matched nothing succeeds with `error: null`, and a caller that checked only
 * the error would tell somebody their permission had been withdrawn while the
 * row was still there — which is the one sentence this feature cannot afford to
 * get wrong.
 *
 * It does NOT unshare the photo. The coach can still open it, because that is a
 * separate thing the client separately agreed to, and withdrawing one silently
 * withdrawing the other would be the app making a decision nobody asked for.
 */
export async function withdrawPublish(photoId: string, coachId: string): Promise<void> {
  if (!USE_SUPABASE) throw new Error('This build has no server, so nothing was changed.');
  const uid = await requireUid();
  const { data, error } = await supabase
    .from('progress_photo_publish_grants')
    .delete()
    .eq('photo_id', photoId).eq('coach_id', coachId).eq('client_id', uid)
    .select('photo_id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('That permission was not withdrawn, so nothing has changed. Pull to refresh and try again.');
  }
}

/* ── the coach's side, which reads and nothing else ───────────────────────── */

/**
 * What one client has agreed this coach may publish.
 *
 * `ppg_coach_read` re-checks the coaching link on every row, so a coach who was
 * let go reads nothing here from the instant either link breaks — and the rows
 * are removed shortly afterwards by part 47's triggers cascading into part 331.
 *
 * Throws on failure. `publishablePhotos()` turns a failure into null rather than
 * into an empty picker, because an empty picker is a claim about what somebody
 * agreed to.
 */
export async function fetchPublishGrantsFrom(clientId: string): Promise<PublishGrant[]> {
  if (!USE_SUPABASE) return [];
  const uid = await requireUid();
  const { data, error } = await supabase
    .from('progress_photo_publish_grants')
    .select(COLS)
    .eq('coach_id', uid)
    .eq('client_id', clientId)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToGrant);
}

/**
 * A signed photo URL turned into bytes the card can carry, or null.
 *
 * A share card is EXPORTED — rasterised out of an SVG by `toDataURL` — and a
 * remote URL in that SVG is a race the renderer resolves by capturing whatever
 * had loaded. Its failure mode is a blank rectangle in a PNG that has already
 * gone to the share sheet. So the picture is fetched and embedded, exactly as
 * src/ui/coachLogo.ts does for the coach's own mark.
 *
 * It also closes the URL's own window: `SHARED_URL_TTL_S` is five minutes, and
 * a card composed for ten would otherwise lose its picture halfway through.
 *
 * Null for every failure. This is not the layer that decides whether a photo
 * may be used — `mayPublishPhoto` did that before anything was fetched — so a
 * failure here is one download, and the caller draws the card without it.
 */
export async function photoDataUri(url: string | null | undefined): Promise<string | null> {
  const u = String(url ?? '').trim();
  if (!u) return null;
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    // Only the two the bucket stores. Anything else is a response this app did
    // not put there, and guessing image/jpeg at a body that is not one produces
    // a picture that fails to decode inside an already-exported file.
    if (type !== 'image/png' && type !== 'image/jpeg') return null;
    const buf = await res.arrayBuffer();
    return safeLogoDataUri(logoDataUri(base64FromBytes(new Uint8Array(buf)), type));
  } catch (e) {
    reportError('photoPublish.fetchImage', e);
    return null;
  }
}

/**
 * The coach's read of one client's permissions, with its own status.
 *
 * `grants` is null under anything but a landed read, and `status` says which.
 * That pairing is the whole contract with src/lib/photoPublish.ts: a null list
 * and an 'error' status both resolve to 'unknown', and 'unknown' is not consent.
 */
export interface PublishGrantsRead {
  status: LoadStatus;
  grants: PublishGrant[] | null;
  reload: () => void;
}

export function usePublishGrantsFrom(clientId: string | null): PublishGrantsRead {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [grants, setGrants] = useState<PublishGrant[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    // No client chosen is not a failed read and not an empty one. Nothing has
    // been asked, so nothing is known, and the screen says so in its own words.
    if (!clientId) { setStatus('loading'); setGrants(null); return; }
    setStatus('loading');
    setGrants(null);
    (async () => {
      try {
        const rows = await fetchPublishGrantsFrom(clientId);
        if (live) { setGrants(rows); setStatus('ready'); }
      } catch (e) {
        reportError('photoPublish.coachRead', e);
        // Explicitly back to null, never to []. An empty array here would tell
        // a coach their client had agreed to nothing when in fact nobody asked
        // the server successfully.
        if (live) { setGrants(null); setStatus('error'); }
      }
    })();
    return () => { live = false; };
  }, [clientId, nonce]);

  return { status, grants, reload };
}
