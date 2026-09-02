// The rules that decide whether a card may be handed to Instagram, and the
// rules about the one public object in this product.
//
// ── Why there is a second path at all ──────────────────────────────────────
//
// `src/lib/social.ts` hands a composed card to the OS share sheet, and its
// header explains at length why that was the honest answer to "publish to my
// socials": the thing it replaced named four networks, showed a green dot
// beside each and uploaded nothing to any of them, ever.
//
// Nothing about that is being undone. The share sheet stays, it is still the
// default, and it is the ONLY path for a card with a photograph on it. What is
// added beside it is one network, done properly: Instagram's Content
// Publishing API, with an OAuth connection to a Business or Creator account,
// a card that Meta fetches, and a report of what Meta actually said.
//
// ── The constraint that shapes everything below ────────────────────────────
//
// INSTAGRAM WILL NOT ACCEPT AN IMAGE. IT FETCHES ONE.
//
// Publishing a feed post is two Graph calls: create a container against
// `/{ig-user-id}/media` carrying an `image_url`, then publish that container.
// Meta pulls the URL from its own servers, with no Authorization header and no
// cookie, so the card has to exist at a publicly reachable, unauthenticated
// URL for long enough to be fetched. It must be JPEG — Meta does not accept
// PNG on this endpoint — and its aspect ratio must sit between 4:5 and 1.91:1.
//
// Every one of Repple's seven storage buckets is `public = false`. There is no
// public object in this product and that is not an oversight. So this feature
// creates the eighth bucket, it is public, and the whole of the reasoning about
// what may go in it lives here and in supabase/parts/400.
//
// ── THE HARD RULE ──────────────────────────────────────────────────────────
//
// A CARD CARRYING A CLIENT'S PHOTOGRAPH NEVER REACHES A PUBLIC URL.
//
// `supabase/parts/331` gives a client a per-photo permission to publish, and
// `src/lib/shareAsset.ts` will put a photograph on a card when it holds one.
// That permission is real and it is the client's. It is ALSO a permission given
// to a coach, for a post that coach makes, from the coach's own phone — not a
// permission for this product to place a picture of somebody's body at a URL
// that anybody on the internet can fetch without signing in to anything.
//
// The refusal is by construction rather than by a screen remembering:
// `checkPublishable` is the only thing in this app that can produce a
// `PublishableCard`, `publishCardToInstagram` in src/ui/instagram.ts takes
// nothing else, and a card whose `photo` is non-null is refused BY NAME with a
// sentence the coach can read. There is no flag to set and no branch to get
// wrong: the card with the photograph keeps the share sheet, which works today,
// posts from the coach's own device, and involves no public object at all.
//
// ── Pure ───────────────────────────────────────────────────────────────────
//
// No imports of any kind, and that is load-bearing rather than tidy.
// `supabase/functions/instagram-publish` imports this file, Deno resolves a
// specifier literally, and `moduleResolution: bundler` refuses an import path
// ending in `.ts` — so a module an edge function imports must be a LEAF.
// `npm run check:functions` walks transitively and fails on the first
// extensionless relative import it can reach from a function.
//
// One consequence worth naming: `ReadStatus` below is a hand-copy of
// `LoadStatus` from src/ui/loadStatus.ts, and `cardObjectRemoved` /
// `cardObjectAbsent` are the same two judgements `objectRemoved` /
// `absentFromListing` make in src/lib/gymDocs.ts. Both are duplicated because
// importing them would put a relative import in a leaf. Read gymDocs.ts for the
// argument; it is not repeated here.

/* ── what the server needs from a human ───────────────────────────────────── */

/** The bucket the card is written to. Public — the only one in this product. */
export const CARD_BUCKET = 'share-cards';

/**
 * How long a card object is allowed to exist.
 *
 * The object is created at the moment of publishing and removed as soon as
 * Meta is known to be finished with it, which is normally a few seconds. This
 * is the CEILING rather than the expected lifetime: it is what a sweep uses to
 * clear an object whose request died between the upload and the delete.
 *
 * Fifteen minutes is chosen against the two failures. Too short and a slow
 * container ingestion races the sweep, which fails as a broken post — Meta
 * fetching a 404 produces a container that never leaves 'IN_PROGRESS'. Too long
 * and a card that failed to publish sits readable by anybody holding the URL.
 * Meta's own documented ceiling for a container to be published is 24 hours;
 * ingestion of a single image is seconds, and this leaves three orders of
 * magnitude of headroom over the thing that actually has to finish.
 */
export const CARD_OBJECT_TTL_MIN = 15;

/** Meta's own limit for a feed image. 8 MiB. */
export const MAX_CARD_BYTES = 8 * 1024 * 1024;

/**
 * The aspect ratios Instagram accepts for a feed post, as width ÷ height.
 *
 * 4:5 (0.8) is the tallest and 1.91:1 the widest. Outside that Instagram either
 * refuses the container or CROPS, and a silently cropped card is a figure cut
 * in half over somebody's headline. So this refuses rather than crops, and says
 * which shape to switch to.
 */
export const MIN_RATIO = 0.8;
export const MAX_RATIO = 1.91;

/* ── a card, reduced to what publishing needs to know about it ─────────────── */

/**
 * What `checkPublishable` reads.
 *
 * Structural rather than `ShareCard` from src/lib/shareAsset.ts, for the leaf
 * reason above — but the field that matters is spelled the same way it is
 * spelled there, so a `ShareCard` satisfies this without conversion and cannot
 * be passed with its photo quietly dropped on the way in.
 */
export interface CardForPublish {
  kind: string;
  caption: string;
  filename: string;
  /** The exported pixel dimensions, not the preview's. */
  width: number;
  height: number;
  /**
   * Present when the card carries an image of the client.
   *
   * The gate below reads whether this field is THERE, not what it says about
   * itself: a `source` that claims to be a logo does not make the pixels a
   * logo, and the one thing this must never do is take an image's word for
   * whose it is. Both fields are optional here only so that a `CardImage` from
   * src/lib/shareAsset.ts satisfies this shape without conversion.
   */
  photo?: { source?: string; uri?: string } | null;
}

/**
 * A card that has been checked and may be published.
 *
 * `photo: null` is stated in the type, and `checked` is a witness that this
 * value came out of `checkPublishable` rather than being written by hand at a
 * call site. Nothing else in this codebase constructs one, and the publish
 * function in src/ui/instagram.ts accepts nothing else — which is what makes
 * "no client photograph reaches a public URL" a property of the types rather
 * than of a screen remembering to check.
 */
export interface PublishableCard {
  readonly caption: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly photo: null;
  readonly checked: 'no-client-photograph';
}

export type PublishRefusal =
  /** The card has a client's progress photograph on it. */
  | 'carries-a-photograph'
  /** Instagram's feed will not take this shape. */
  | 'shape'
  /** There is no card yet — the figures did not build one. */
  | 'no-card';

export type PublishGate =
  | { ok: true; card: PublishableCard }
  | { ok: false; refusal: PublishRefusal; why: string };

/**
 * THE gate. The only route to a `PublishableCard`.
 *
 * Order matters: the photograph is checked FIRST, before the shape, so a coach
 * whose card has both a photograph and the wrong aspect ratio is told about the
 * photograph. Fixing the shape would leave them back at the same refusal, and a
 * refusal that moves is a refusal that reads as the app being fussy rather than
 * as a rule about their client.
 */
export function checkPublishable(card: CardForPublish | null | undefined): PublishGate {
  if (!card) {
    return {
      ok: false, refusal: 'no-card',
      why: 'There is no card to post yet. Instagram takes the finished graphic, so it needs one that has built.',
    };
  }

  if (card.photo) {
    return {
      ok: false, refusal: 'carries-a-photograph',
      why: PHOTO_KEEPS_THE_SHARE_SHEET,
    };
  }

  if (!ratioAccepted(card.width, card.height)) {
    return {
      ok: false, refusal: 'shape',
      why: `Instagram's feed only takes a card between 4:5 and 1.91:1, and this one is ${ratioLabel(card.width, card.height)}. `
        + 'Switch the shape to Post and it will go. Repple will not crop it to fit, because a card cropped to a shape it was not laid out for cuts the figures off it.',
    };
  }

  return {
    ok: true,
    card: {
      caption: String(card.caption ?? ''),
      filename: jpegFilename(card.filename),
      width: Math.round(card.width),
      height: Math.round(card.height),
      photo: null,
      checked: 'no-client-photograph',
    },
  };
}

/**
 * What the coach is told when their card has a photograph on it.
 *
 * Not an apology and not a fault. It is the reason the thing is safe, said in
 * the coach's own terms: the card still posts, from their phone, in two taps,
 * and the difference is that Meta never has to be able to reach it.
 */
export const PHOTO_KEEPS_THE_SHARE_SHEET =
  'This card has your client’s photo on it, so it goes through your phone’s share sheet rather than through Instagram directly. '
  + 'Posting it here would mean putting their photo at a public web address for Meta to come and fetch, and their permission was for a post you make, not for a picture of them sitting on the open internet. '
  + 'Share it from your phone and it reaches exactly the same account. You post it, and nothing of theirs is ever published by Repple.';

/** The line under the Instagram button on a card with no photograph, so the
 *  rule is visible before it is ever hit. */
export const WHY_NO_PHOTOGRAPHS =
  'Instagram fetches the image from a web address rather than accepting it from the app, so a card posted this way is briefly public. Cards with a client’s photo on them are never posted this way — they go through your share sheet instead.';

/* ── the shape ────────────────────────────────────────────────────────────── */

/** Width ÷ height, or 0 when either is not a usable number. */
export function aspectRatio(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
  return w / h;
}

/**
 * Whether Instagram's feed accepts this shape.
 *
 * The bounds are inclusive to a hundredth, because 1080×1350 is exactly 0.8 and
 * floating-point division of two integers that divide exactly is exact — but
 * 1080×1920 is 0.5625 and nothing near a boundary, so the tolerance costs
 * nothing and protects a card sized from a rounded layout.
 */
export function ratioAccepted(w: number, h: number): boolean {
  const r = aspectRatio(w, h);
  if (!r) return false;
  return r >= MIN_RATIO - 0.001 && r <= MAX_RATIO + 0.001;
}

/** "9:16", "4:5" — the shape as a coach would say it, for the refusal. */
export function ratioLabel(w: number, h: number): string {
  const r = aspectRatio(w, h);
  if (!r) return 'not a shape Repple could measure';
  // The two this app actually produces, named rather than computed, because
  // "0.5625:1" tells a coach nothing about which button to press.
  if (Math.abs(r - 0.5625) < 0.002) return '9:16';
  if (Math.abs(r - 0.8) < 0.002) return '4:5';
  if (Math.abs(r - 1) < 0.002) return 'square';
  return `${r.toFixed(2)}:1`;
}

/* ── the bytes ────────────────────────────────────────────────────────────── */

/** The card's filename with a .jpg on it. Instagram takes JPEG only, and a
 *  file called .png with JPEG bytes in it is a thing somebody later debugs. */
export function jpegFilename(name: string | null | undefined): string {
  const n = String(name ?? '').trim() || 'repple-card.jpg';
  return n.replace(/\.(png|jpeg|jpg)$/i, '') + '.jpg';
}

/**
 * Are these bytes actually a JPEG?
 *
 * Checked server-side on the way in, because the alternative is discovering it
 * from Meta: a PNG uploaded under `image/jpeg` produces a container that fails
 * ingestion with a message about the media, several seconds later, after a
 * public object has already been created for it.
 *
 * FF D8 FF is the SOI marker plus the first byte of the next marker, which is
 * every JPEG variant this app can produce.
 */
export function isJpegBytes(bytes: ArrayLike<number> | null | undefined): boolean {
  if (!bytes || bytes.length < 3) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Over Meta's own 8 MiB limit for a feed image. */
export function tooLarge(byteLength: number): boolean {
  return !Number.isFinite(byteLength) || byteLength <= 0 || byteLength > MAX_CARD_BYTES;
}

/* ── the public object ────────────────────────────────────────────────────── */

/**
 * The key of the one public object, from 32 random hex characters.
 *
 * UNGUESSABLE, which is the requirement, and everything that would make it
 * guessable is deliberately absent: not the coach's id, not the card's id, not
 * a date, not a counter, nothing enumerable. 128 bits of randomness with no
 * structure around it.
 *
 * It matters more than it usually would because the bucket is public and there
 * is therefore no policy between a URL and the bytes. What there IS, is no
 * SELECT policy on the bucket at all, so the object cannot be LISTED either —
 * an attacker cannot enumerate what they cannot guess, and cannot ask what is
 * there.
 *
 * Throws on anything else rather than falling back to something derived. A
 * caller whose random source failed must not quietly publish under a
 * predictable name.
 */
export function cardObjectKey(hex: string): string {
  const h = String(hex ?? '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) {
    throw new Error('A card object key needs 32 random hex characters. Refusing to build one from anything else.');
  }
  return `${h}.jpg`;
}

/** Whether a key is one this app would have made: 32 hex characters and a
 *  .jpg, with no path, no coach id and nothing enumerable in it. */
export function keyIsUnguessable(key: string | null | undefined): boolean {
  return /^[0-9a-f]{32}\.jpg$/.test(String(key ?? ''));
}

/** The public URL Meta will fetch. Built from the project URL rather than
 *  guessed, and it is the only URL in this product that needs no signature. */
export function cardPublicUrl(supabaseUrl: string, key: string): string {
  const base = String(supabaseUrl ?? '').replace(/\/+$/, '');
  if (!base || !keyIsUnguessable(key)) return '';
  return `${base}/storage/v1/object/public/${CARD_BUCKET}/${key}`;
}

/** Past its ceiling, and therefore a sweep's business. */
export function cardObjectExpired(createdAtMs: number, nowMs: number): boolean {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - createdAtMs >= CARD_OBJECT_TTL_MIN * 60_000;
}

/**
 * Did Storage say it removed this key?
 *
 * `remove()` answers with the list of objects it actually deleted, and an empty
 * list is NOT an error: an object the policy would not let the caller delete is
 * silently omitted. The same judgement as `objectRemoved` in gymDocs.ts, which
 * holds the full argument.
 */
export function cardObjectRemoved(key: string, data: unknown): boolean {
  if (!Array.isArray(data)) return false;
  const base = key.slice(key.lastIndexOf('/') + 1);
  return data.some((o: any) => o?.name === key || o?.name === base);
}

/** Is this key absent from a listing of its own folder? An empty listing means
 *  absent; a listing that names it means the removal was refused rather than
 *  unnecessary. */
export function cardObjectAbsent(key: string, data: unknown): boolean {
  if (!Array.isArray(data)) return false;
  const base = key.slice(key.lastIndexOf('/') + 1);
  return !data.some((o: any) => o?.name === base || o?.name === key);
}

/* ── what Meta actually did ───────────────────────────────────────────────── */

/**
 * A container that was created and a post that was published are two events,
 * and only the second is a post.
 *
 * This is the `publishToSocials` failure in its Instagram-shaped form: the
 * container call is the one that returns quickly and succeeds most often, and
 * an app that announced "posted" on its id would be announcing an upload that
 * has not been published and may never be. So the outcome is derived from the
 * two ids rather than from whether the request threw.
 */
export type PostOutcome = 'published' | 'container-only' | 'nothing';

export function postOutcome(containerId: string | null | undefined, mediaId: string | null | undefined): PostOutcome {
  if (String(mediaId ?? '').trim()) return 'published';
  if (String(containerId ?? '').trim()) return 'container-only';
  return 'nothing';
}

/**
 * What to tell the coach, per outcome. `detail` is Meta's own words where there
 * are any: "Permissions error" and "The image is too large" send a coach to two
 * completely different remedies and a flattened "posting failed" sends them to
 * neither.
 */
export function outcomeNote(outcome: PostOutcome, detail?: string | null): string {
  const said = String(detail ?? '').trim();
  const because = said ? `: ${said.replace(/[.\s]+$/, '')}.` : '.';
  switch (outcome) {
    case 'published':
      return 'Posted to Instagram.';
    case 'container-only':
      return `Instagram took the image and did not publish it, so nothing is on your feed${because}`
        + ' The card is unchanged and you can post it from your share sheet in the meantime.';
    case 'nothing':
    default:
      return `Instagram did not take the card, so nothing was posted${because}`
        + ' Your share sheet still works and the card is unchanged.';
  }
}

/* ── whether this is offered at all ───────────────────────────────────────── */

/**
 * The same four values as `LoadStatus` in src/ui/loadStatus.ts, hand-copied
 * because this file is a leaf. A ui-side `LoadStatus` satisfies it structurally.
 */
export type ReadStatus = 'loading' | 'ready' | 'partial' | 'error';

/**
 * Whether a coach has an Instagram account connected — and the two states that
 * are neither yes nor no.
 *
 * 'unknown' under a failed read is the house rule and it is the exact defect
 * src/lib/social.ts was written to end: the old screen's green "connected" dot
 * was `!!process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID`, a build-time string that
 * says nothing about whether an account is linked. A connection that could not
 * be read is not a connection, and it is not a refusal either.
 *
 * 'unconfigured' is the honest answer while this build carries no Meta app id,
 * or while the permission is not through App Review. It is a clearly-stated
 * "not available" rather than a dead button.
 */
export type ConnectionState = 'unconfigured' | 'unknown' | 'connected' | 'not-connected';

export function connectionState(configured: boolean, status: ReadStatus, hasAccount: boolean): ConnectionState {
  if (!configured) return 'unconfigured';
  if (status === 'loading' || status === 'error') return 'unknown';
  return hasAccount ? 'connected' : 'not-connected';
}

/** The sentence beside each state. Null for 'connected': there is nothing to
 *  say about a connection that exists and is about to be used. */
export function connectionNote(state: ConnectionState): string | null {
  switch (state) {
    case 'connected':
      return null;
    case 'not-connected':
      return 'Connect the Instagram account you post from and Repple can put a card on your feed. It has to be a Business or Creator account with a Facebook Page linked to it — Instagram’s publishing API does not accept personal accounts at all.';
    case 'unknown':
      return 'Repple could not check whether your Instagram account is connected, so it is not offering to post. This is not a connection that failed, and nothing has been posted. Your share sheet works either way.';
    case 'unconfigured':
    default:
      return INSTAGRAM_NOT_AVAILABLE;
  }
}

/**
 * The "not available" sentence, and it names the reason rather than shrugging.
 *
 * Meta gates `instagram_content_publish` behind App Review. Until this app has
 * it, the consent screen grants the permission only to people with a role on
 * the Meta app itself. That is Meta's gate and no amount of building here opens
 * it, so the honest thing is to say so and leave the share sheet in place —
 * which posts to the same Instagram, from the same phone, today.
 */
export const INSTAGRAM_NOT_AVAILABLE =
  'Posting straight to Instagram is not switched on in this build. It needs a Meta app whose Instagram publishing permission has been through Meta’s App Review, which is theirs to grant rather than ours. '
  + 'Your share sheet posts the same card to the same account in two taps in the meantime.';

/** What the coach is told when the permission is there but Meta refuses it —
 *  the App Review case, which reads like a bug and is not one. */
export function reviewRefusalNote(detail: string | null | undefined): string {
  const said = String(detail ?? '').trim();
  return `Instagram refused the post${said ? `: ${said.replace(/[.\s]+$/, '')}.` : '.'} `
    + 'A permissions error here usually means Meta App Review has not approved this app for publishing yet, rather than anything being wrong with your account or your card. Nothing was posted.';
}
