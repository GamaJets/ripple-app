// Where an exercise's demonstration frames actually come from.
//
// `exercises.image_paths` holds RELATIVE paths — 'Barbell_Curl/0.jpg' — and
// never URLs. That was deliberate when the catalogue was built: a URL bakes
// somebody else's uptime into 917 rows, and changing host would mean rewriting
// every one of them. This module is the one place a path becomes a URL, so
// swapping the media is a one-line change here rather than a migration.
//
// ── This base URL is NOT shippable, and the guard below says so ────────────
//
// It points at the public-domain dataset's own GitHub repository, which is
// right for seeing the screen work and wrong for production: it is rate
// limited, it is not a CDN, and it is somebody else's bandwidth being spent on
// our users. Before this reaches the App Store the frames need to live in our
// own bucket — or be replaced wholesale by a licensed animation pack, which is
// exactly the swap the path-not-URL decision was protecting.
export const FRAME_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

/** True while the frames are served from the source repo rather than our own
 *  storage. Read by the preflight guard; also drives the on-screen note, so
 *  nobody demoes this to a stakeholder without knowing what they are seeing. */
export const FRAMES_ARE_UNHOSTED = FRAME_BASE.includes('githubusercontent.com');

/**
 * The full URLs for an exercise's demo frames, in order.
 *
 * An empty list is a real answer: 41 of our own rows carry no frames because
 * nobody has confirmed which catalogue movement they are, and a screen that
 * cannot tell "no frames" from "frames we failed to build a URL for" will show
 * a broken image to one of them.
 */
export function frameUrls(paths: readonly string[] | null | undefined): string[] {
  if (!paths || !paths.length) return [];
  const out: string[] = [];
  for (const p of paths) {
    const clean = String(p || '').trim().replace(/^\/+/, '');
    // Only the shapes the catalogue actually stores. Anything else is a row we
    // do not understand, and guessing at it produces a 404 the client reads as
    // "this app is broken" rather than as "we have no picture of this".
    if (!clean || !/^[\w.-]+\/\d+\.(jpg|jpeg|png|webp)$/i.test(clean)) continue;
    out.push(`${FRAME_BASE}/${clean}`);
  }
  return out;
}

/**
 * How long to hold each frame of the loop, in milliseconds.
 *
 * Two frames are a start position and an end position, so the "animation" is a
 * toggle. Fast reads as a flicker and is unpleasant to look at; slow stops
 * reading as one movement. 900ms is about the tempo of a controlled rep, which
 * is also the tempo the client should be copying.
 */
export const FRAME_MS = 900;

/** A sentence naming what the client is looking at, or null when there is
 *  nothing to caption. Provenance matters here: a coach's own clip and a stock
 *  diagram deserve different trust, and the client should be told which. */
export function demoCaption(source: string | null | undefined, frames: number): string | null {
  if (frames <= 0) return null;
  if (source === 'free-exercise-db') return 'Reference illustration — start and end position.';
  return null;
}
