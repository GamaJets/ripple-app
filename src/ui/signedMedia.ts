// Signed URLs for catalogue media, in batches.
//
// ── Why signing at all ─────────────────────────────────────────────────────
//
// The licensed pack lives in a PRIVATE bucket, because the licence forbids
// leaving the raw images in "an open storage bucket". So a path is not a URL:
// it has to be signed, and signing is asynchronous where reading a path is not.
//
// ── Why batched, and why cached ────────────────────────────────────────────
//
// The library lists fifty rows at a time. Signing each thumbnail on its own is
// fifty round trips to draw one screen, on a phone, before anything appears.
// createSignedUrls takes the whole page in one request.
//
// The cache is what makes scrolling work: a path signed once is reused until
// its URL is close to expiring, so paging back and forth costs nothing. Entries
// are dropped a few minutes BEFORE the signature actually expires — handing a
// component a URL that dies while the image is still loading produces a broken
// picture with no way to tell why.
import { supabase } from '../lib/supabase';
import { DEMO_BUCKET } from '../lib/exerciseMedia';
import { reportError } from '../lib/reportError';

/** An hour is long enough that a session never re-signs, short enough that a
 *  leaked URL is worthless by the time anybody finds it. */
const TTL_SECONDS = 60 * 60;
/** Retire a URL five minutes early, so nothing is handed a signature that
 *  expires mid-download. */
const SAFETY_MS = 5 * 60 * 1000;

const cache = new Map<string, { url: string; until: number }>();

/** The prefixes our own uploads use. A path under one of these is in our
 *  bucket and must be signed; anything else is still a vendor CDN path and is
 *  resolved by frameUrls instead. Named explicitly rather than sniffed,
 *  because a wrong guess here is a broken picture with no error to read. */
const OURS = ['stills/', 'anim/', 'equipment/'];

/** True for a path that lives in our bucket and therefore needs signing. A
 *  bare filename — 'bench-leg-pull-in.webp' — is an animation key, which the
 *  uploader writes at the bucket root, so that counts too. */
export const needsSigning = (p: string | null | undefined): boolean => {
  if (!p) return false;
  if (OURS.some((pre) => p.startsWith(pre))) return true;
  return /^[\w-]+\.(webp|mp4|gif)$/i.test(p);   // animation_path, bucket root
};

/**
 * Sign every path given, in one request, and return path → URL.
 *
 * Paths already cached are not re-requested. A path that cannot be signed is
 * simply absent from the result rather than mapped to an empty string: the
 * caller then renders "no picture", which is true, instead of a broken image.
 */
export async function signMedia(paths: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const wanted: string[] = [];

  for (const p of paths) {
    if (!p) continue;
    const hit = cache.get(p);
    if (hit && hit.until > now) { out.set(p, hit.url); continue; }
    if (!wanted.includes(p)) wanted.push(p);
  }
  if (!wanted.length) return out;

  try {
    const { data, error } = await supabase.storage.from(DEMO_BUCKET).createSignedUrls(wanted, TTL_SECONDS);
    if (error) { reportError('signedMedia.sign', error, { count: wanted.length }); return out; }
    for (const row of data ?? []) {
      // Supabase returns one entry per requested path, each carrying its own
      // error — a single missing file does not fail the batch, and must not be
      // allowed to blank the other forty-nine.
      const path = (row as any)?.path as string | undefined;
      const url = (row as any)?.signedUrl as string | undefined;
      if (!path || !url) continue;
      cache.set(path, { url, until: now + TTL_SECONDS * 1000 - SAFETY_MS });
      out.set(path, url);
    }
  } catch (e) {
    reportError('signedMedia.sign', e, { count: wanted.length });
  }
  return out;
}

/** Drop everything. Used when the signed-in account changes — a URL signed for
 *  one session should not outlive it. */
export function clearSignedMedia(): void { cache.clear(); }
