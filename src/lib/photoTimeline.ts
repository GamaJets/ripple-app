// Ordering the photographs a client has sent their coach, and pairing two of
// them when the coach asks for two.
//
// ── what this adds, and what it very deliberately does not ────────────────
//
// Nothing here reaches a photograph. Every input is an `InboxPhoto` that
// src/lib/photoShare.ts has already decided the viewer may see — the grant is
// checked in `progress_photos_shared_read` and again in `photos_obj_read_shared`
// on the bytes, and a third time in TypeScript before `fetchSharedInbox`
// returns a row (see that file's header). This module runs AFTER all of that,
// on rows that are already on the screen, and it sorts them.
//
// So it widens no permission and it cannot: a photo with no grant never arrives
// here, and a photo that arrives here is one the client addressed to this coach
// by name. If the whole file were deleted the coach would see exactly the same
// set of pictures in a different order.
//
// ── ordered by when they were TAKEN, which is a change of subject ──────────
//
// `photoInbox.newestSharedFirst` orders by when a photo was SENT, and that is
// the right order for an inbox: the send is the act addressed to the coach, and
// a coach opening a client wants the thing they were most recently given.
//
// It is the wrong order for a timeline. A client who finds three old photos on
// their camera roll and sends them this morning has three sends a minute apart
// and three photographs months apart, and an inbox order draws them as one
// moment. `photoInbox.gapNote` already exists because that gap is real and
// common. A timeline is the other view of the same rows — ordered by the day
// the picture is OF — and the two dates stay on every tile in both, because a
// screen showing one of them lets a six-week-old photo read as this morning.
//
// ── and it computes nothing about the body ────────────────────────────────
//
// The intervals below are intervals between DATES. There is no measurement, no
// derived reading off an image, no progress verdict, and no pairing chosen by
// the app. `pairOf` takes two ids that a coach picked and puts the earlier one
// on the left — which is arithmetic on two dates and not a before-and-after
// claim. app/(trainer)/client-photos.tsx sets out at length why this screen
// says nothing about the body in the picture; that rule is upheld here, and the
// absence of anything numeric in this file is how.
//
// Pure, no clock, no React.
import { dateParts } from './localDate';

/** The minimum this module needs off a row. `InboxPhoto` (src/lib/photoInbox.ts)
 *  satisfies it, and nothing here wants the signed link — a module that sorts
 *  rows has no business holding a URL to a body. */
export interface TimelinePhoto {
  readonly id: string;
  /** When the photo was taken. An ISO instant from the client's phone. */
  readonly takenAt: string;
  /** When the client sent it to this coach. Never the same question. */
  readonly sharedAt: string;
}

/** One row of the timeline. */
export interface TimelineRow<T extends TimelinePhoto> {
  readonly photo: T;
  /**
   * The photo's own calendar day, or null when `takenAt` will not read.
   *
   * Null is not an error and the row is not dropped: a photograph whose date is
   * unreadable is still a photograph the client sent, and hiding it would tell
   * a coach they had been sent fewer than they had. It simply cannot be placed
   * on a timeline, and the screen says so beside it.
   */
  readonly dayKey: string | null;
  /**
   * Whole days since the previous photo in this ordering, or null for the
   * first one and for any row whose date — or whose predecessor's — will not
   * read. Never 0 as a stand-in: two photos on one day really is 0, and that
   * has to stay distinguishable from "cannot say".
   */
  readonly sincePrevDays: number | null;
}

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * A stored value as the LOCAL calendar day it belongs to.
 *
 * Never `takenAt.slice(0, 10)`. `progress_photos.taken_at` is written as
 * `new Date().toISOString()` — an instant in UTC — so somebody in New York
 * photographing themselves at 9pm on the 28th has a stored day of the 29th, and
 * a slice would file that photograph under the wrong day and misorder it
 * against a scan or another photo taken the next morning. src/lib/photoCompare.ts
 * documents the identical trap at length; `dateParts` is the shared fix.
 */
export function photoDayKey(iso: string | null | undefined): string | null {
  const p = dateParts(iso);
  return p ? `${p[0]}-${pad(p[1] + 1)}-${pad(p[2])}` : null;
}

/** Whole days between two local calendar days, or null when either will not
 *  read. Built from local midnights so a month boundary and a daylight-saving
 *  change both cost exactly the days they are. */
export function daysApart(aISO: string | null | undefined, bISO: string | null | undefined): number | null {
  const a = dateParts(aISO);
  const b = dateParts(bISO);
  if (!a || !b) return null;
  const from = new Date(a[0], a[1], a[2]).getTime();
  const to = new Date(b[0], b[1], b[2]).getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * Oldest photograph first, by the day it is OF.
 *
 * Rows whose date will not read sort to the END rather than to the start: they
 * cannot be placed, and putting an unplaceable row at the head of a timeline
 * would make it look like the beginning of the story. Ties break on id so the
 * order cannot wobble between two reads of the same set — the same guarantee
 * `photoInbox.newestSharedFirst` makes, and for the same reason.
 */
export function takenOldestFirst<T extends TimelinePhoto>(photos: readonly T[]): T[] {
  return [...photos].sort((a, b) => {
    const ka = photoDayKey(a.takenAt);
    const kb = photoDayKey(b.takenAt);
    if (ka == null && kb == null) return a.id.localeCompare(b.id);
    if (ka == null) return 1;
    if (kb == null) return -1;
    // Bare day keys compare as strings, which is date order, and is why they
    // are never parsed back into a Date to be compared.
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * The timeline: every photo in taken order, each carrying the interval since
 * the one before it.
 *
 * The interval is what makes this a timeline rather than a list. Four photos
 * over three years and four photos over three weeks are the same grid today.
 */
export function timeline<T extends TimelinePhoto>(photos: readonly T[]): TimelineRow<T>[] {
  const ordered = takenOldestFirst(photos);
  let prev: string | null = null;
  return ordered.map((photo) => {
    const dayKey = photoDayKey(photo.takenAt);
    const sincePrevDays = prev != null && dayKey != null ? daysApart(prev, dayKey) : null;
    if (dayKey != null) prev = dayKey;
    return { photo, dayKey, sincePrevDays };
  });
}

/** The number of rows that carry no readable date, so a screen can say so
 *  rather than leaving them looking like ordinary members of the sequence. */
export function undatedCount(photos: readonly TimelinePhoto[]): number {
  let n = 0;
  for (const p of photos) if (photoDayKey(p.takenAt) == null) n++;
  return n;
}

/**
 * What the set covers, in one sentence — or null when there is nothing to span.
 *
 * Subject-free so the caller supplies the voice. It states dates and a count
 * and nothing else: no rate, no "good coverage", no judgement about how often
 * somebody photographs themselves.
 */
export function spanNote(photos: readonly TimelinePhoto[]): string | null {
  const dated = takenOldestFirst(photos).filter((p) => photoDayKey(p.takenAt) != null);
  if (dated.length < 2) return null;
  const from = photoDayKey(dated[0].takenAt);
  const to = photoDayKey(dated[dated.length - 1].takenAt);
  const d = daysApart(from, to);
  if (d == null || d <= 0) return null;
  const over = d < 14 ? `${d} days` : `${Math.round(d / 7)} weeks`;
  return `${dated.length} photographs spanning ${over}.`;
}

/** Two photographs a coach has chosen to look at side by side, earlier on the
 *  left. */
export interface PhotoPair<T extends TimelinePhoto> {
  readonly earlier: T;
  readonly later: T;
  /** Whole days between the two, or null when either date will not read. Never
   *  0 for "cannot say": two photos taken on one day are genuinely 0 apart. */
  readonly apartDays: number | null;
}

/**
 * Order two chosen photographs, or refuse.
 *
 * Null when either id is not in the set, and null when they are the same
 * photograph — a picture compared against itself is a control that looks like a
 * result, and the interval under it would be a confident 0.
 *
 * Which is EARLIER is decided by the day each was taken, never by the order the
 * coach tapped them in and never by when they were sent. A client who sends
 * January's photo after March's would otherwise get a pair captioned backwards,
 * which is the one way a side-by-side can lie without saying anything.
 *
 * A photograph with no readable date cannot be ordered and is refused rather
 * than guessed at: this function will not decide which of two bodies came
 * first on the strength of a timestamp it could not read.
 */
export function pairOf<T extends TimelinePhoto>(
  photos: readonly T[],
  aId: string,
  bId: string,
): PhotoPair<T> | null {
  if (!aId || !bId || aId === bId) return null;
  const a = photos.find((p) => p.id === aId);
  const b = photos.find((p) => p.id === bId);
  if (!a || !b) return null;
  const ka = photoDayKey(a.takenAt);
  const kb = photoDayKey(b.takenAt);
  if (ka == null || kb == null) return null;
  // Same day is not a refusal — two photographs taken one morning are a real
  // pair — so the tie falls to id, which is stable and makes no claim.
  const aFirst = ka !== kb ? ka < kb : a.id.localeCompare(b.id) <= 0;
  const earlier = aFirst ? a : b;
  const later = aFirst ? b : a;
  return { earlier, later, apartDays: daysApart(earlier.takenAt, later.takenAt) };
}

/**
 * The caption under a pair: how far apart the two photographs are.
 *
 * The whole of what this app is prepared to say about two pictures of somebody
 * else's body. It is a fact about the calendar. Anything about what changed
 * between them is the coach's to think and not the app's to assert — see the
 * header of app/(trainer)/client-photos.tsx.
 */
export function pairNote<T extends TimelinePhoto>(pair: PhotoPair<T> | null): string | null {
  if (!pair) return null;
  const d = pair.apartDays;
  if (d == null) return 'These two cannot be placed against each other — one of the dates will not read.';
  if (d === 0) return 'Both taken on the same day.';
  if (d === 1) return 'One day apart.';
  if (d < 14) return `${d} days apart.`;
  if (d < 120) return `${Math.round(d / 7)} weeks apart.`;
  return `${Math.round(d / 30)} months apart.`;
}
