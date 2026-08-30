// Thumbnails for a list of catalogue rows, signed in one request.
//
// The stills live in a private bucket, so every one needs a signed URL. Asking
// for each row on its own would be fifty round trips to draw one screen, and
// the batching in signedMedia turns that into one — with a cache, so paging
// back and forth afterwards costs nothing.
//
// Factored out of the client library when the coach's program builder needed
// the same thing: a coach choosing between Hip Thrust and Barbell Glute Bridge
// is choosing between two pictures, and the builder was showing them two
// strings. Two copies of a batching effect is how one of them ends up merging
// its results and the other replacing them — which reads as rows going blank
// when you scroll back up.
import { useEffect, useState } from 'react';
import { signMedia, needsSigning } from './signedMedia';
import { frameUrls } from '../lib/exerciseMedia';

/** The fields a row needs to have a thumbnail resolved. */
export interface ThumbRow {
  thumbPath: string | null;
  source?: string | null;
}

export function useCatalogueThumbs(rows: ThumbRow[]): (row: ThumbRow) => string | null {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const paths = rows.map((r) => r.thumbPath).filter((p): p is string => !!p && needsSigning(p));
  const key = paths.join('|');

  useEffect(() => {
    let cancelled = false;
    if (!paths.length) return;
    (async () => {
      const signed = await signMedia(paths);
      // Merged, never replaced: a later page must not blank the rows above it,
      // which is what scrolling back up would then show.
      if (!cancelled) setThumbs((prev) => new Map([...prev, ...signed]));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A path we host needs the signed URL; anything else is a vendor CDN link
  // that is already fetchable. Null when there is no picture — the caller
  // draws its own empty tile rather than being handed a broken image.
  return (row: ThumbRow) => {
    if (!row.thumbPath) return null;
    if (needsSigning(row.thumbPath)) return thumbs.get(row.thumbPath) ?? null;
    return frameUrls([row.thumbPath], row.source ?? null)[0] ?? null;
  };
}
