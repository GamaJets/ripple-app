// The gym's logo: chosen on the owner's Brand screen, stored in the private
// gym-logos bucket (supabase/parts/3270), and drawn on the gym's share cards.
//
// The coach version is src/ui/coachLogo.ts, and this is that file for a gym.
// It reuses every pure rule from src/lib/coachLogo.ts: the size cap, the two
// formats, the <owner id>/<file> key shape and the data: URI the card needs.
// The id here is the TENANT's, which is what part 3270's folder check expects.
import { useCallback, useEffect, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { writeFailure } from '../lib/wroteRows';
import {
  LOGO_MAX_PX, base64FromBytes, coachLogoPath, isOwnLogoPath,
  logoContentType, logoDataUri, logoExtension, logoRefusal, safeLogoDataUri,
} from '../lib/coachLogo';
import type { PickedLogo } from './coachLogo';
import type { LoadStatus } from './loadStatus';

export { pickLogo } from './coachLogo';

export const GYM_LOGO_BUCKET = 'gym-logos';
const URL_TTL_S = 60;

const newToken = (): string =>
  Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '').padEnd(8, '0');

async function removeObject(path: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(GYM_LOGO_BUCKET).remove([path]);
    if (error) reportError('gymLogo.remove', error, { path });
  } catch (e) { reportError('gymLogo.remove', e, { path }); }
}

/** Upload, then point the gym at it, then drop the old file. The new file is
 *  removed again if the gym row refuses it, so a failure leaves nothing behind. */
export async function uploadGymLogo(
  tenantId: string, picked: PickedLogo, previousPath: string | null,
): Promise<{ path: string | null; error: string | null }> {
  if (!USE_SUPABASE) return { path: null, error: 'This build has no server, so your logo has nowhere to go.' };
  if (!tenantId) return { path: null, error: 'Your gym has not loaded yet, so the logo was not saved.' };
  const keepPng = String(picked.mimeType ?? '').toLowerCase() === 'image/png';
  let uri = picked.uri;
  try {
    const out = await ImageManipulator.manipulateAsync(picked.uri, [{ resize: { width: LOGO_MAX_PX } }],
      { compress: 0.9, format: keepPng ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG });
    uri = out.uri;
  } catch (e) {
    reportError('gymLogo.prepare', e);
    return { path: null, error: 'That image could not be prepared. Try a PNG or a JPEG export of it.' };
  }
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(uri);
    if (!res.ok) return { path: null, error: 'That image could not be read off your phone.' };
    bytes = await res.arrayBuffer();
  } catch (e) {
    reportError('gymLogo.read-file', e);
    return { path: null, error: 'That image could not be read off your phone.' };
  }
  const refusal = logoRefusal(bytes.byteLength);
  if (refusal) return { path: null, error: refusal };
  const path = coachLogoPath(tenantId, Date.now(), newToken(), logoExtension(keepPng ? 'image/png' : 'image/jpeg'));
  const contentType = logoContentType(path);
  if (!contentType) return { path: null, error: 'That image is in a format this app cannot store.' };
  const up = await supabase.storage.from(GYM_LOGO_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (up.error) {
    reportError('gymLogo.upload', up.error, { path });
    return { path: null, error: 'Your logo could not be uploaded, so nothing has changed.' };
  }
  const res = await supabase.from('tenants').update({ logo: path }, { count: 'exact' }).eq('id', tenantId);
  if (res.error) reportError('gymLogo.save', res.error);
  const failed = writeFailure('Your logo', res);
  if (failed) { await removeObject(path); return { path: null, error: failed }; }
  if (previousPath && previousPath !== path) await removeObject(previousPath);
  return { path, error: null };
}

export async function clearGymLogo(tenantId: string, path: string | null): Promise<string | null> {
  if (!USE_SUPABASE || !tenantId) return 'Your logo was not removed.';
  const res = await supabase.from('tenants').update({ logo: null }, { count: 'exact' }).eq('id', tenantId);
  if (res.error) reportError('gymLogo.clear', res.error);
  const failed = writeFailure('Your logo', res);
  if (failed) return failed;
  if (path) await removeObject(path);
  return null;
}

async function loadDataUri(path: string): Promise<string | null> {
  const contentType = logoContentType(path);
  if (!contentType) return null;
  try {
    const { data, error } = await supabase.storage.from(GYM_LOGO_BUCKET).createSignedUrl(path, URL_TTL_S);
    if (error || !data?.signedUrl) { if (error) reportError('gymLogo.sign', error, { path }); return null; }
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    return safeLogoDataUri(logoDataUri(base64FromBytes(new Uint8Array(await res.arrayBuffer())), contentType));
  } catch (e) { reportError('gymLogo.fetch', e, { path }); return null; }
}

export interface GymLogo {
  /** Whether the gym row was read. A null path under 'ready' is "no logo". */
  status: LoadStatus;
  path: string | null;
  /** Ready to draw on a card, or null. */
  dataUri: string | null;
  reload: () => void;
}

export function useGymLogo(tenantId: string | null | undefined): GymLogo {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [path, setPath] = useState<string | null>(null);
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!USE_SUPABASE || !tenantId) return;
    let live = true;
    setStatus('loading');
    (async () => {
      const { data, error } = await supabase.from('tenants').select('logo').eq('id', tenantId).maybeSingle();
      if (!live) return;
      if (error) { reportError('gymLogo.load', error); setStatus('error'); setPath(null); setDataUri(null); return; }
      const key = typeof data?.logo === 'string' && isOwnLogoPath(tenantId, data.logo) ? data.logo : null;
      setPath(key);
      setStatus('ready');
      const uri = key ? await loadDataUri(key) : null;
      if (live) setDataUri(uri);
    })();
    return () => { live = false; };
  }, [tenantId, nonce]);
  return { status, path, dataUri, reload };
}
