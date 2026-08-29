// What a coach may DRAW, and for how long, once a shared progress photo has
// come back from the server.
//
// ── WHY THIS IS A SEPARATE FILE FROM photoShare.ts ────────────────────────
// photoShare.ts owns the RULE — who may see what — and mirrors
// supabase/parts/47-share-progress-photo.sql clause for clause. Nothing in
// here decides access, and nothing in here may ever be mistaken for the thing
// that does. This file owns the narrower question that only the reading end
// has: the grant is real and the file signed, so what is honest to put on a
// screen at THIS instant, given that both facts have a shelf life. It is also
// where the coach-side pure logic can carry its own test, since the test that
// covers photoShare.ts's pure half is owned elsewhere.
//
// ── A SIGNED URL IS NOT A PHOTO. IT IS A PHOTO FOR FIVE MINUTES ───────────
// The `photos` bucket is private, so every image the coach sees is reached
// through a signed URL, minted with photoShare.SHARED_URL_TTL_S — five
// minutes, deliberately short, because that window is the only thing
// revocation cannot reach into (see that file's header).
//
// A string that has outlived its signature is not a slightly old photo. The
// storage service refuses it, React Native renders the refusal as an empty
// frame in the exact place a body was a moment ago, and a coach who left this
// screen open over a lunch break would otherwise be looking at a picture its
// owner may have withdrawn twenty minutes earlier and been told, by the app,
// that they had.
//
// So this file does not hand out strings. A link is `{ url, expiresAtMs }` and
// `liveUrl()` is the only way to get the string back out of it — it returns
// null the moment the signature is spent. A screen cannot render a dead link
// by forgetting to check, because there is nothing to render until it has
// checked. The type is the check.
//
// ── FRESHNESS IS CORRECTNESS HERE, NOT POLISH ────────────────────────────
// The worst thing this feature can do is keep showing a photo somebody took
// back. Two mechanisms, and they are independent on purpose: the list is
// re-asked of the server every `refreshEveryMs()`, and every link dies on its
// own at `expiresAtMs` whether or not that refresh happened. If the network
// goes away entirely, the second one still holds — the photos stop rendering
// within five minutes rather than sitting there indefinitely on the strength
// of a read that is no longer true.

/** A signed link to one file, and the instant the signature stops working. */
export interface SignedLink {
  readonly url: string;
  readonly expiresAtMs: number;
}

/**
 * One photo as the coach's screen holds it.
 *
 * `link === null` is a row whose file would not sign: the client sent it, the
 * grant is live, and the bytes could not be reached. That is a gap with a
 * reason, and it must render as neither a photo nor an absence.
 */
export interface InboxPhoto {
  id: string;
  path: string;
  /** When the photo was taken. NOT when it was sent. */
  takenAt: string;
  /** When the client sent it to this coach. NOT when it was taken. */
  sharedAt: string;
  link: SignedLink | null;
}

/**
 * One answer to "what has this client sent me", stamped with when it was
 * asked. The stamp is load-bearing: a list of shared photos means nothing
 * without the time it was true at, because the client may withdraw any of them
 * a second later.
 */
export interface Inbox {
  clientId: string;
  coachId: string;
  /**
   * Whether the coaching link was live at `readAtMs`, straight from
   * `coaching_link_active()`. False makes an empty `photos` mean something
   * completely different — see `emptyReason()`.
   */
  linkActive: boolean;
  photos: InboxPhoto[];
  readAtMs: number;
}

/**
 * How long before a signature actually expires this app stops trusting it.
 *
 * A link handed to an <Image> at the last second would begin its request
 * before expiry and finish it after, which the storage service answers as a
 * failure — a blank frame, indistinguishable from a withdrawn photo. Erring
 * early costs a few seconds of a five-minute window and buys the guarantee
 * that anything on screen is a link that was comfortably alive when it went up.
 */
export const LINK_MARGIN_MS = 20_000;

/**
 * Build a link from what `createSignedUrls` returned.
 *
 * The mint instant is passed in rather than read here so the caller can take it
 * BEFORE issuing the request: the signature's clock started at the server, and
 * a timestamp taken after the round trip would over-state the life left by
 * however long the network took.
 */
export function signedLink(
  url: string | null | undefined,
  mintedAtMs: number,
  ttlS: number,
): SignedLink | null {
  if (!url) return null;
  if (!Number.isFinite(mintedAtMs) || !Number.isFinite(ttlS) || ttlS <= 0) return null;
  return { url, expiresAtMs: mintedAtMs + ttlS * 1000 };
}

/**
 * The URL, but only while it is still good. The single way a URL leaves this
 * module, and the reason a stale image cannot reach the screen by omission.
 */
export function liveUrl(link: SignedLink | null, nowMs: number): string | null {
  if (!link) return null;
  return nowMs + LINK_MARGIN_MS < link.expiresAtMs ? link.url : null;
}

/**
 * The three states one tile can be in, which are three different sentences.
 * 'expired' is temporary and about this app; 'missing' is about the file and
 * will not fix itself by waiting.
 */
export function linkState(link: SignedLink | null, nowMs: number): 'live' | 'expired' | 'missing' {
  if (!link) return 'missing';
  return liveUrl(link, nowMs) ? 'live' : 'expired';
}

/**
 * How often the list must be asked for again.
 *
 * Comfortably inside the signature's life, so links are replaced before a
 * coach ever sees one lapse, and — the reason that matters — so a photo the
 * client took back stops being listed within about four minutes rather than
 * whenever somebody happens to reopen the screen.
 */
export function refreshEveryMs(ttlS: number): number {
  const ttl = ttlS * 1000;
  return Math.max(30_000, ttl - 60_000);
}

/** Whether the list on screen is old enough to owe the server another ask.
 *  A list that was never read is stale by definition, not fresh by default. */
export function inboxStale(inbox: Inbox | null, nowMs: number, ttlS: number): boolean {
  if (!inbox) return true;
  return nowMs - inbox.readAtMs >= refreshEveryMs(ttlS);
}

/** How many of the loaded photos currently have no usable link — expired or
 *  never signed. `null` when nothing has been read, never 0. */
export function unusableCount(inbox: Inbox | null, nowMs: number): number | null {
  if (!inbox) return null;
  return inbox.photos.filter((p) => liveUrl(p.link, nowMs) === null).length;
}

/** Is this photo still in the list the server last gave us? The question the
 *  opened viewer asks after every refresh, because the answer turning false is
 *  the client withdrawing it while a coach was looking. */
export function stillShared(photoId: string, inbox: Inbox | null): boolean {
  if (!inbox) return false;
  return inbox.photos.some((p) => p.id === photoId);
}

/** What to say when a photo disappears out from under an open viewer. It does
 *  not claim to know which of the two happened, because it cannot. */
export function withdrawnNote(): string {
  return 'That photo is no longer shared with you — they either took it back or deleted it. It has gone from the list.';
}

/**
 * Why the list is empty, which is three different facts and must not print as
 * one sentence.
 *
 * `null` means it is not empty. The 'unlinked' case is the one worth the extra
 * read behind it: with no live coaching link the policies return nothing, and
 * reporting that as "they have sent you nothing" would be a claim about the
 * client made from a fact about the account.
 */
export function emptyReason(inbox: Inbox | null): 'unknown' | 'unlinked' | 'none' | null {
  if (!inbox) return 'unknown';
  if (!inbox.linkActive) return 'unlinked';
  return inbox.photos.length === 0 ? 'none' : null;
}

/** The count for a section head. `null` before anything is known — "0 shared"
 *  and "we have not looked" must not print the same. */
export function inboxNote(inbox: Inbox | null): string | null {
  if (!inbox) return null;
  if (!inbox.linkActive) return null;
  const n = inbox.photos.length;
  return n === 0 ? 'None sent' : n === 1 ? '1 photo' : `${n} photos`;
}

/** How old the list is, in the words a coach can act on. A read stamped in the
 *  future is a clock that moved, not a list from the future. */
export function checkedNote(inbox: Inbox | null, nowMs: number): string | null {
  if (!inbox) return null;
  const age = nowMs - inbox.readAtMs;
  if (!Number.isFinite(age) || age < 60_000) return 'Checked just now';
  const mins = Math.floor(age / 60_000);
  return mins === 1 ? 'Checked 1 minute ago' : `Checked ${mins} minutes ago`;
}

/**
 * Whole days between a photo being taken and being sent.
 *
 * `null` when either timestamp will not parse, or when the send did not come
 * after the shot. Nothing is rounded up and nothing is guessed: a figure this
 * screen cannot support is a figure it does not print.
 */
export function gapDays(takenAt: string, sharedAt: string): number | null {
  const t = Date.parse(takenAt);
  const s = Date.parse(sharedAt);
  if (!Number.isFinite(t) || !Number.isFinite(s)) return null;
  const days = Math.floor((s - t) / 86400000);
  return days > 0 ? days : null;
}

/**
 * The line that stops a six-week-old photo being read as this morning's.
 *
 * The two dates on a shared photo are genuinely different facts and a coach
 * acts differently on each: one is when the body in the picture looked like
 * that, the other is when the person decided to show it. Same-day sends get no
 * line at all — there is nothing to disambiguate, and a sentence there would be
 * noise on every tile.
 */
export function gapNote(takenAt: string, sharedAt: string): string | null {
  const d = gapDays(takenAt, sharedAt);
  if (d === null) return null;
  return d === 1 ? 'Taken the day before it was sent' : `Taken ${d} days before it was sent`;
}

/** A timestamp as a date, or null when the record will not parse. Callers
 *  print a dash for null; this never invents a readable date for one. */
export function stamp(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Newest send first — a coach opening a client wants the thing they were most
 * recently given. Ordered by when it was SENT rather than when it was taken,
 * because the send is the act addressed to them. Ties break on id so the order
 * cannot wobble between two reads of the same set.
 */
export function newestSharedFirst<T extends { id: string; sharedAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = Date.parse(b.sharedAt) - Date.parse(a.sharedAt);
    return Number.isFinite(d) && d !== 0 ? d : a.id.localeCompare(b.id);
  });
}
