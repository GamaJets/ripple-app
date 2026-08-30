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

/**
 * Where the RepDB illustrations come from.
 *
 * The npm CDN for the public package. Correct for seeing the catalogue work and
 * wrong for release for the same reason as FRAME_BASE: it is somebody else's
 * bandwidth and somebody else's uptime. Before this ships the images either move
 * to our own private bucket — the licence's term 3 forbids republishing the
 * dataset, and a private bucket serving our own app is in-app use, not
 * republication — or are bundled with the binary, which at ~16KB each is
 * genuinely viable and buys offline into the bargain.
 */
export const REPDB_FRAME_BASE = 'https://cdn.jsdelivr.net/npm/@repdb/exercises@2026.8.1';

/** True while frames are served from somebody else's servers rather than our
 *  own storage. Drives the on-screen warning, so nobody demoes this without
 *  knowing what they are looking at. */
/**
 * Whether any picture on screen is still coming from somebody else's servers.
 *
 * False now: the bought pack is in our own private bucket, signed per request,
 * and the two vendor bases below are kept only as the fallback for a row that
 * has not been migrated — of which there are none in the catalogue today.
 *
 * This is a constant rather than a check per row on purpose. It drives the
 * on-screen "not for release" warning, and a warning that appears on some
 * screens and not others teaches people to ignore it. If a vendor base is ever
 * reintroduced as the primary source, flip this back and the warning returns
 * everywhere at once.
 */
export const FRAMES_ARE_UNHOSTED = false;

/**
 * The full URLs for an exercise's demo frames, in order.
 *
 * An empty list is a real answer: 41 of our own rows carry no frames because
 * nobody has confirmed which catalogue movement they are, and a screen that
 * cannot tell "no frames" from "frames we failed to build a URL for" will show
 * a broken image to one of them.
 */
export function frameUrls(
  paths: readonly string[] | null | undefined,
  source?: string | null,
): string[] {
  if (!paths || !paths.length) return [];
  // Two catalogues, two path shapes, two hosts. RepDB stores
  // 'images/flat/<id>-start.webp'; free-exercise-db stores 'Folder_Name/0.jpg'.
  // Deciding by the SOURCE column rather than by sniffing the string, because a
  // guess that gets it wrong produces a 404 the client reads as a broken app.
  const repdb = source === 'repdb';
  const base = repdb ? REPDB_FRAME_BASE : FRAME_BASE;
  const shape = repdb
    ? /^images\/[\w-]+\/[\w-]+\.(webp|png|jpg|jpeg)$/i
    : /^[\w.-]+\/\d+\.(jpg|jpeg|png|webp)$/i;
  const out: string[] = [];
  for (const p of paths) {
    const clean = String(p || '').trim().replace(/^\/+/, '');
    // Only the shapes the catalogue actually stores. Anything else is a row we
    // do not understand, and guessing at it produces a 404 the client reads as
    // "this app is broken" rather than as "we have no picture of this".
    if (!clean || !shape.test(clean)) continue;
    out.push(`${base}/${clean}`);
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
  if (source === 'repdb') return 'Illustration — start and peak position.';
  if (source === 'free-exercise-db') return 'Reference illustration — start and end position.';
  return null;
}

/** The bucket a bought animation pack is uploaded into. Private: a commercial
 *  licence permits use inside the app and rarely permits leaving the files
 *  openly fetchable, so these are signed like a coach's own clip. */
export const DEMO_BUCKET = 'exercise-demos';

/**
 * Whether an animation may be shown to a real person in this build.
 *
 * A preview bundle is CC BY-NC — fine for deciding whether to buy, never fine
 * in a product that sells memberships. The realistic failure is not a decision
 * anybody makes, it is one nobody revisits: the preview gets wired in to look
 * at, it works, and four builds later it is in an App Store binary that nobody
 * re-checked. So the licence travels with the row and is asked every time it is
 * about to render.
 *
 * `null` is not permission. An animation whose licence nobody recorded is
 * treated exactly like an evaluation one, because the reason it is unrecorded
 * is unknown and the expensive guess is the permissive one.
 */
export function demoIsShippable(licence: string | null | undefined, isRelease: boolean): boolean {
  if (licence === 'commercial') return true;
  // Evaluation assets, and unlabelled ones, render only in a build that is not
  // going to anybody — so the pack can actually be judged before it is bought.
  return !isRelease;
}

/**
 * Where an EVALUATION animation is served from while somebody is judging a pack.
 *
 * A preview bundle arrives as a folder on whoever's laptop is assessing it. It
 * is CC BY-NC — usable to decide whether to buy and never usable in a product
 * that sells memberships — so it deliberately does NOT go into the
 * exercise-demos bucket, which exists for licensed content the app may ship.
 * Uploading it there would be the first step of forgetting which is which.
 *
 * Localhost, because the simulator shares the host's network. On a real device
 * this resolves to nothing and the screen falls back to the still frames, which
 * is the correct outcome: an evaluation asset has no business on a handset.
 */
export const EVAL_DEMO_BASE = 'http://localhost:8899';

/**
 * The URL for a row's animation, or null.
 *
 * Two routes that must not be confused. A COMMERCIAL animation lives in our own
 * private bucket and is signed — the caller does that, because signing is
 * asynchronous. An EVALUATION animation is served from wherever the preview
 * pack is being assessed and never touches our storage at all.
 *
 * `null` for anything else, including a licence nobody recorded: the reason it
 * is unrecorded is unknown, and the expensive guess is the permissive one.
 */
export function evalAnimationUrl(
  animationPath: string | null | undefined,
  licence: string | null | undefined,
): string | null {
  if (licence !== 'evaluation') return null;
  const clean = String(animationPath || '').trim().replace(/^\/+/, '');
  // Only the shape the evaluation server serves. A path we do not recognise is
  // a row we do not understand, and guessing produces a broken image rather
  // than an honest gap.
  if (!/^[\w-]+\.(webp|gif|mp4|webm)$/i.test(clean)) return null;
  return `${EVAL_DEMO_BASE}/${clean}`;
}
