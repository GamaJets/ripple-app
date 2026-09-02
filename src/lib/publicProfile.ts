// A coach's page on the open web: what may go on it, and what may not.
//
// `trainers.listed` puts a coach in Find a Trainer, which lives inside the
// client app behind a sign-in. The people most likely to become a coach's next
// client are already following them somewhere else, and until this there was no
// address in the whole product a coach could put in a bio. supabase/parts/340
// is the database half and `web/coach.html` is the page; this file is every
// rule the two of them have to agree about, kept here because a page on the
// open web is the one surface where being subtly wrong is permanent.
//
// ── The three refusals ────────────────────────────────────────────────────
//
// 1. THE DIRECTORY OPT-IN IS NOT CONSENT TO THIS. `listed` says "clients
//    browsing Repple can see me". A public page is no sign-in, no account,
//    indexable and forwardable, and reading one as the other would be this
//    product deciding on a coach's behalf that they are the same thing. So
//    there is a second switch, off by default, and it sits ON TOP of the first:
//    `publicPageState` has no branch that produces 'live' without both, and
//    part 340's trigger takes the page down the moment `listed` goes off.
//
// 2. NOT ONE WORD A CLIENT WROTE. `coach_reviews` has no grant to anybody and
//    both of its readers are SECURITY DEFINER functions revoked from `anon`, so
//    the existing RPCs cannot serve this page at all. They should not be
//    extended to either: `coach_reviews_for` returns the reviewer's first name,
//    and IDENTITY_NOTE in ./reviews.ts is the promise made to the reviewer
//    before they write, which describes a screen inside the app and is not
//    consent to a first name and a paragraph on a crawlable URL. The page
//    publishes an aggregate and nothing else, and it computes what that
//    aggregate may be made to say with `ratingDisplay` from ./reviews.ts rather
//    than dividing for itself.
//
// 3. NOTHING MAY READ AS CHECKED, AND NOTHING EXPIRED MAY READ AS CURRENT.
//    `publishableCredentials` drops an expired row, and part 340 drops it in
//    SQL as well so it never leaves the database. In the app an expired row
//    stays visible and sorts last, because a signed-in prospect can ask about
//    it; a page is skimmed by somebody who cannot ask anybody anything, and
//    "Level 3 Personal Trainer" in a list reads as current however the small
//    print under it is worded.
//
// Pure. No react, no supabase. The page is static HTML with no build step, so
// it carries its own copy of the sentences below and publicProfile.test.ts
// holds the two against each other — the arrangement joinPage.test.ts already
// uses for the brand table baked into web/join.html.

import { credentialState, type Credential } from './coachCredentials';
import type { LoadStatus } from '../ui/loadStatus';

/* ── the address ──────────────────────────────────────────────────────────── */

/** Shorter than this is not an address, it is a collision waiting to happen. */
export const HANDLE_MIN = 3;
/** Longer than this is not something anybody types off a phone screen. */
export const HANDLE_MAX = 30;

/**
 * Names a coach may not take.
 *
 * Every top-level path web/ serves, plus the words a reader would take as
 * Repple speaking rather than as a coach. Held identically by
 * `reserved_public_handles()` in supabase/parts/340, and the test parses that
 * array and fails if the two part company: the server is the authority, and a
 * list that exists twice without a check is a list that will disagree with
 * itself.
 */
export const RESERVED_HANDLES: readonly string[] = Object.freeze([
  'account', 'admin', 'api', 'app', 'apps', 'badges', 'blog', 'brand', 'client', 'clients',
  'coach', 'coaches', 'confirmed', 'connect', 'contact', 'delete-account', 'download',
  'faq', 'favicon', 'forgot-password', 'help', 'home', 'how-it-works', 'index', 'join',
  'legal', 'login', 'logout', 'me', 'new', 'none', 'null', 'owner', 'play', 'press',
  'pricing', 'privacy', 'profile', 'register', 'repple', 'reset-password', 'root',
  'security', 'settings', 'signin', 'signup', 'sitemap', 'staff', 'static', 'studio',
  'support', 'terms', 'test', 'trainer', 'trainers', 'undefined', 'user', 'www',
]);

/**
 * What the coach typed, as it would be stored.
 *
 * Spaces become hyphens rather than being dropped, because "jas fitness" typed
 * into a handle field means two words and "jasfitness" quietly loses the seam.
 * Everything the column cannot hold is removed here so the field shows the
 * coach what they are actually claiming while they type it.
 */
export function normaliseHandle(input: string | null | undefined): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, HANDLE_MAX);
}

export type HandleProblem =
  | 'ok'
  | 'empty'
  | 'too-short'
  | 'too-long'
  | 'edge-hyphen'
  | 'reserved';

/**
 * Why this handle cannot be used, or 'ok'.
 *
 * Takes the NORMALISED form, so there is no branch for a character the field
 * never let through. The server holds the same shape as a CHECK constraint and
 * the reserved list inside `set_my_public_page`; this end is the one that can
 * explain itself before a round trip.
 */
export function handleProblem(handle: string): HandleProblem {
  const h = handle;
  if (!h) return 'empty';
  if (h.length < HANDLE_MIN) return 'too-short';
  if (h.length > HANDLE_MAX) return 'too-long';
  if (h.startsWith('-') || h.endsWith('-')) return 'edge-hyphen';
  if (RESERVED_HANDLES.includes(h)) return 'reserved';
  return 'ok';
}

export function handleProblemText(p: HandleProblem): string {
  switch (p) {
    case 'ok':          return '';
    case 'empty':       return 'Pick a short address for your page, like your name or your business.';
    case 'too-short':   return `An address is at least ${HANDLE_MIN} characters.`;
    case 'too-long':    return `Keep it to ${HANDLE_MAX} characters or fewer.`;
    case 'edge-hyphen': return 'An address cannot start or end with a hyphen.';
    case 'reserved':    return 'That word is part of the Repple site, so a page there would look like ours rather than yours. Pick another.';
  }
}

/**
 * The address itself, or null when there is nothing to print.
 *
 * A query parameter rather than a path segment, and the reason is in
 * web/coach.html: `web/` is copied to the host verbatim with no build step and
 * no worker, so a path form would need a host-specific rewrite rule that
 * nothing in this repository can test. `?h=` and not `?c=`, because `?c=` is
 * the join code everywhere else on this site and `codeFromUrl` in ./adMatch.ts
 * reads it wherever it appears.
 */
export function publicPageUrl(origin: string, handle: string | null | undefined): string | null {
  const h = normaliseHandle(handle);
  if (handleProblem(h) !== 'ok') return null;
  const base = String(origin ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/coach?h=${h}`;
}

/**
 * The link the page's own join button points at, so an arrival is attributed.
 *
 * Null with no code: a join button that opens /join with nothing in it drops
 * the arrival into the unattributed bucket, which is the failure the whole
 * join-code feature exists to remove.
 */
export function publicJoinUrl(origin: string, joinCode: string | null | undefined): string | null {
  const code = String(joinCode ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const base = String(origin ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/join?c=${code}`;
}

/* ── the coach's switch ───────────────────────────────────────────────────── */

/** Where a coach's page stands, from the two switches and the handle. */
export type PublicPageState =
  /** No page, and none possible: they are not in the directory. */
  | 'off-directory'
  /** In the directory, but they have not chosen an address yet. */
  | 'no-address'
  /** Address chosen, page switched off. Nothing is served. */
  | 'ready'
  /** Live on the open web. */
  | 'live';

export function publicPageState(input: {
  listed: boolean;
  handle: string | null | undefined;
  on: boolean;
}): PublicPageState {
  const h = normaliseHandle(input.handle);
  const usable = handleProblem(h) === 'ok';
  if (!input.listed) return 'off-directory';
  if (!usable) return 'no-address';
  return input.on ? 'live' : 'ready';
}

/**
 * What the coach is told about it. Sentence case, and it never says "live"
 * about a page that is not.
 */
export function publicPageStateNote(s: PublicPageState): string {
  switch (s) {
    case 'off-directory':
      return 'Your page needs Find a Trainer switched on first. It shows the same profile to a wider audience, so it is the same decision made twice rather than a different one.';
    case 'no-address':
      return 'Choose a short address and your page has somewhere to live. Nothing is published until you switch it on.';
    case 'ready':
      return 'Off. The address is yours and nothing is being served at it.';
    case 'live':
      return 'Live. Anybody with the link can read this, whether or not they have a Repple account.';
  }
}

/**
 * What is on the page, in the order it appears, said to the coach BEFORE they
 * publish.
 *
 * This is the consent, so it is a list and not a paragraph. A coach who cannot
 * see what they are handing to the open web has not agreed to anything, and the
 * test asserts that every item here is something part 340's function actually
 * returns.
 */
export const PUBLISHED_FIELDS: readonly string[] = Object.freeze([
  'Your trading name, or your own name where you have not set one',
  'Your accent colour',
  'Your tagline and your bio',
  'Your specialties and what you offer',
  'Your session rate, but only alongside the currency it is in',
  'The qualifications and insurance you have stated, unless they have expired',
  'How many reviews you have, and their average once there are enough of them',
  'Your join code, in the link that brings somebody into the app',
]);

/**
 * What is never on it, said in the same breath and for the same reason.
 *
 * The second item is the one a coach will ask about, so it is stated first
 * among the reviews and it is stated as a refusal rather than as a limitation.
 */
export const WITHHELD_FIELDS: readonly string[] = Object.freeze([
  'What any client wrote in a review, and any reviewer’s name',
  'A qualification that has expired',
  'Anything suggesting Repple has checked your qualifications',
  'Your clients, your bookings, your earnings and your messages',
  'Your email address and your phone number',
  'A price with no currency on it',
]);

/** Every word the server can answer `set_my_public_page` with, plus a failure. */
export type PublishResult =
  | 'published' | 'saved' | 'cleared'
  | 'taken' | 'invalid' | 'reserved' | 'needs_directory'
  | 'not_a_coach' | 'signed_out'
  /** The call itself did not land. Distinct from every refusal above. */
  | 'failed';

/** Whatever the RPC returned, narrowed to something with a sentence behind it. */
export function asPublishResult(v: unknown): PublishResult {
  return v === 'published' || v === 'saved' || v === 'cleared' || v === 'taken'
      || v === 'invalid' || v === 'reserved' || v === 'needs_directory'
      || v === 'not_a_coach' || v === 'signed_out'
    ? v
    : 'failed';
}

/**
 * The outcome in words. `changed` is the flag a screen uses to decide whether
 * to re-read: it is true for exactly the three results that wrote something,
 * and false for 'failed', which is the one result under which the coach's own
 * screen and the server may now disagree.
 */
export function publishOutcome(r: PublishResult, handle: string): { title: string; body: string; changed: boolean } {
  const h = normaliseHandle(handle);
  switch (r) {
    case 'published':
      return { title: 'Your page is live', body: `Anybody with the link can read it now. Send them to /coach?h=${h}.`, changed: true };
    case 'saved':
      return { title: 'Address saved', body: 'Nothing is published yet. Switch the page on when you are ready for people to read it.', changed: true };
    case 'cleared':
      return { title: 'Page taken down', body: 'The address is free again and nothing is being served at it.', changed: true };
    case 'taken':
      return { title: 'Address not available', body: 'Another coach already has that one. Try adding your town, or the name you trade under.', changed: false };
    case 'invalid':
      return { title: 'Address not saved', body: `Use ${HANDLE_MIN} to ${HANDLE_MAX} letters, numbers and hyphens, starting and ending with a letter or a number.`, changed: false };
    case 'reserved':
      return { title: 'Address not saved', body: handleProblemText('reserved'), changed: false };
    case 'needs_directory':
      return { title: 'Not published', body: 'Switch on Find a Trainer first. Your page shows the same profile to a wider audience, so it needs the same permission.', changed: false };
    case 'not_a_coach':
      return { title: 'Not saved', body: 'This account has no coaching profile, so there is nothing to publish.', changed: false };
    case 'signed_out':
      return { title: 'Not saved', body: 'Sign in and try again.', changed: false };
    case 'failed':
      return { title: 'Could not save', body: 'We could not reach the server, so nothing changed. Your page is whatever it was before this.', changed: false };
  }
}

/* ── what the page may say ────────────────────────────────────────────────── */

/**
 * The credentials that may appear on a public page.
 *
 * `null` in means null out: an empty list under a failed read is not "this
 * coach has stated nothing", and this returns null rather than an empty array
 * so a caller cannot render one as the other. The order is the server's, which
 * is kind then title.
 */
export function publishableCredentials(list: Credential[] | null, today: string): Credential[] | null {
  if (list === null) return null;
  return list.filter(
    (c) => c.verification === 'self_declared' && credentialState(c, today) !== 'expired',
  );
}

/**
 * The sentence above that list, on the page a stranger reads.
 *
 * Held byte-for-byte by web/coach.html and asserted by the test. It is a
 * shorter cousin of CLAIM_NOTE in ./coachCredentials.ts and it carries the same
 * fact, because the reader of this page is deciding the same thing with less
 * around them to explain it.
 */
export const PUBLIC_CLAIM_NOTE =
  'These are what the coach says about themselves. Repple has not seen the certificates and has not checked them with the awarding bodies, so ask to see them or look the registration number up yourself.';

/**
 * The sentence beside the rating, and the one that explains an absence nobody
 * would otherwise understand.
 *
 * A reader who can see "4.6 from 12 reviews" and cannot read a single one of
 * them will assume the reviews are being hidden because they are bad. They are
 * being withheld because publishing them would publish the people who wrote
 * them, and saying so is both true and better for the coach.
 */
export const PUBLIC_REVIEW_NOTE =
  'Reviews are written by this coach’s own clients inside the app. Repple does not publish what they wrote or who they are, so the number is all that appears here.';

/**
 * A price, or nothing at all.
 *
 * Repple is white-labelled and `tenants.currency` is nullable on purpose, so a
 * figure whose currency nobody set is withheld rather than printed bare. A bare
 * "120" on a public page is read in whatever money the reader happens to be
 * thinking in, which is the same wrong number with fewer clues.
 *
 * Zero is not a rate here. `trainers.session_fee` defaulted to 0 for rows
 * created before the column was nullable and three of the eight rows on
 * production still hold one, so a 0 is an unset rate and not a coach who works
 * for nothing.
 */
export function publicFee(
  fee: number | null | undefined,
  currency: string | null | undefined,
): { amount: number; currency: string } | null {
  const code = String(currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const amount = Number(fee);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: code };
}

/* ── the four things the page can be ──────────────────────────────────────── */

/**
 * What the reader of a public URL is looking at.
 *
 * 'absent' and 'unreadable' are the pair this type exists for. The server
 * answers a handle nobody holds and a page that has been switched off with the
 * same zero rows, which is deliberate and is the whole of 'absent'. A read that
 * FAILED is not that: an empty profile under a failed read is a coach who looks
 * like they have nothing, on the page they put in their own bio.
 */
export type PageState = 'loading' | 'ready' | 'absent' | 'unreadable' | 'no-address';

/**
 * `found` is whether a row came back. It is only meaningful under 'ready', and
 * under anything else it is ignored rather than trusted.
 *
 * 'partial' is treated as unreadable. It cannot arise from a function that
 * returns at most one row, and it is handled anyway, because the status is the
 * caller's claim about whether it holds all of it and a page that renders a
 * profile under a status saying otherwise is wrong the day that changes.
 */
export function pageState(status: LoadStatus, handle: string, found: boolean): PageState {
  if (handleProblem(normaliseHandle(handle)) !== 'ok') return 'no-address';
  if (status === 'loading') return 'loading';
  if (status !== 'ready') return 'unreadable';
  return found ? 'ready' : 'absent';
}

/** The kicker above that heading. Null wherever there is a profile to draw. */
export function pageStateEyebrow(s: PageState): string | null {
  switch (s) {
    case 'ready':
    case 'loading':    return null;
    case 'absent':     return 'Nothing here';
    case 'unreadable': return 'Our end';
    case 'no-address': return 'This link';
  }
}

/** The heading a reader gets when there is no profile to draw. */
export function pageStateHeading(s: PageState): string | null {
  switch (s) {
    case 'ready':
    case 'loading':   return null;
    case 'absent':    return 'There is no page at this address';
    case 'unreadable': return 'We could not load this page';
    case 'no-address': return 'This address is a coach’s page';
  }
}

/**
 * And the sentence under it.
 *
 * 'absent' says plainly that nothing is here, and does not fall through into a
 * marketing page: somebody who followed a coach's link and landed on "Repple,
 * the white-label fitness platform" has been told their coach does not exist by
 * a page that is pretending nothing went wrong.
 *
 * 'unreadable' says nothing whatsoever about the coach. It is the same rule
 * ratingDisplay keeps in ./reviews.ts, applied to a whole person.
 */
export function pageStateNote(s: PageState): string | null {
  switch (s) {
    case 'ready':
    case 'loading':
      return null;
    case 'absent':
      return 'Nobody is publishing a page here. If a coach gave you this link, check it against what they sent you, or ask them for it again.';
    case 'unreadable':
      return 'This is our end, not theirs. The coach’s page may be perfectly fine and we could not read it, so try again in a moment.';
    case 'no-address':
      return 'A coach’s link carries their own address on the end of it. This one does not, so there is nothing to show.';
  }
}
