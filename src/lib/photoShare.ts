// Sending ONE progress photo to your coach — and taking it back.
//
// The rule the owner set: "Coaches shouldn't see the progress photos unless the
// user or client sends them to the trainer. That'll be the only way that a
// trainer should see or view the photos."
//
// So there is no setting in here. No `shareAll`, no `autoShare`, no default,
// no preference that outlives the photo it was set on. The only thing this
// file can do is create ONE grant for ONE photo addressed to ONE coach, list
// the grants that exist, and delete one. A photo you take tomorrow cannot be
// covered by a grant you made today, because tomorrow's photo has no row in
// `progress_photo_shares` and nothing here will write one for it.
//
// ── TWO LAYERS, ONE RULE ──────────────────────────────────────────────────
// A coach needs BOTH a row (`progress_photos`) and a file (an object in the
// private `photos` bucket) to see a photo. supabase/parts/47-share-progress-
// photo.sql grants those separately — two policies, two tables, two schemas —
// but defines the file predicate in terms of the row predicate, so the two can
// never disagree about who. `viewerMaySee()` below is the same rule again, in
// TypeScript, and it is applied to every row this file hands to a screen. That
// is not decoration: it means a regression in either policy shows up as a
// photo this app refuses to render rather than as a photo it renders.
//
// ── WHAT REVOCATION ACTUALLY DOES, AND THE ONE THING IT CANNOT DO ─────────
// Deleting the grant closes the row and the file at the same instant. It
// cannot reach back into a signed URL the coach's device already holds: those
// are signed by the storage service and are good until they expire, policy or
// no policy. That is why coach-side URLs here are minted with a FIVE MINUTE
// TTL rather than the hour `progressPhotos.ts` uses for your own photos — it
// is the difference between "your coach loses it within minutes" and "within
// the hour". `revokeCaveat()` is the sentence the app says about it, because
// the alternative is telling somebody it is gone when it is not.
//
// ── supabase-js RESOLVES ON A DATABASE ERROR ──────────────────────────────
// `await supabase.from(...)` returns { data: null, error } rather than
// throwing. A try/catch alone catches only the network dying, and a missed
// `.error` here would render as "nothing is shared" — the single most
// dangerous wrong answer this file can give, because it is also what a
// correctly-empty account looks like. Every call below checks `.error`, and
// every read that fails throws rather than returning [].
//
// ── WHY THE CLIENT IS REQUIRED LAZILY ─────────────────────────────────────
// Same reason as progressPhotos.ts: the pure half is covered by
// src/lib/coverage.test.ts under plain `node`, and a top-level import of
// ./supabase drags in AsyncStorage, which throws "window is not defined".

import type { ProgressPhoto } from './progressPhotos';
import { PHOTO_BUCKET } from './progressPhotos';
// The coach-side read hands its rows out through these rather than as plain
// strings — see ./photoInbox for why a signed URL is not a photo. This import
// is one-way on purpose: photoInbox knows nothing about the sharing rule, so
// the rule cannot be quietly restated over there.
import { signedLink, newestSharedFirst, type Inbox, type InboxPhoto } from './photoInbox';

/**
 * How long a coach's signed URL lasts. Deliberately short: it is the window in
 * which revocation has not yet taken effect on a link already minted. Long
 * enough to look at a photo, short enough that "I took it back" is true within
 * the length of a conversation.
 */
export const SHARED_URL_TTL_S = 5 * 60;

/** One grant: this photo, sent by this client, to this coach. */
export interface ShareGrant {
  photoId: string;
  clientId: string;
  coachId: string;
  sharedAt: string;
}

/** Whether a coaching relationship is live, as the database defines it —
 *  BOTH `coaching_relationships.status = 'active'` AND `clients.trainer_id`. */
export interface CoachLink {
  clientId: string;
  coachId: string;
  active: boolean;
}

/** The coach a client can send to. `null` from `fetchMyCoach()` means there is
 *  nobody to send to — not that the read failed, which throws. */
export interface CoachRef {
  id: string;
  name: string | null;
}

/** A photo as the coach's screen wants it. `url === null` is a row whose file
 *  would not sign — a gap, never a photo and never nothing. */
export interface SharedPhoto {
  id: string;
  path: string;
  takenAt: string;
  sharedAt: string;
  url: string | null;
}

/* ── pure ─────────────────────────────────────────────────────────────────
   No I/O, no client, no React. Covered by src/lib/coverage.test.ts. */

/**
 * MAY THIS VIEWER SEE THIS PHOTO? The one definition, mirroring the policies in
 * 47-share-progress-photo.sql clause for clause:
 *
 *   own photo                         → yes  (progress_photos_owner)
 *   a grant addressed to this viewer  → required (progress_photo_shared_with_viewer)
 *   the grant's sender IS the photo's owner → required (the WITH CHECK on pps_client)
 *   the coaching link still live      → required (coaching_link_active)
 *
 * The third clause is the one that stops one member reading another member's
 * shared photo: a grant is only ever evidence about the photo its OWNER sent.
 * Without it, any grant naming this viewer would unlock any photo id it happened
 * to carry, and the coach screen — which is handed rows by a query, not by the
 * policy engine — would render whatever came back.
 */
export function viewerMaySee(
  viewerId: string,
  photo: { id: string; clientId: string },
  grants: ShareGrant[],
  links: CoachLink[],
): boolean {
  if (!viewerId) return false;
  if (photo.clientId === viewerId) return true;
  const grant = grants.find((g) => g.photoId === photo.id && g.coachId === viewerId);
  if (!grant) return false;
  if (grant.clientId !== photo.clientId) return false;
  const link = links.find((l) => l.clientId === photo.clientId && l.coachId === viewerId);
  return !!link && link.active;
}

/**
 * What the client's own screen says about one photo.
 *
 * Three states, three renders, and 'unknown' is a real answer: before the
 * grants have been read — or after that read failed — this app does not know
 * whether the coach can see this photo, and saying "Private" would be
 * inventing the reassuring one.
 */
export function shareStateOf(photoId: string, grants: ShareGrant[] | null): 'unknown' | 'sent' | 'private' {
  if (grants === null) return 'unknown';
  return grants.some((g) => g.photoId === photoId) ? 'sent' : 'private';
}

/** The label under a photo, matching shareStateOf. Never "Private" on a guess. */
export function shareLabel(state: 'unknown' | 'sent' | 'private'): string {
  return state === 'sent' ? 'Sent to coach' : state === 'private' ? 'Only you' : '—';
}

/** How many photos the coach can currently open. `null` until it is known —
 *  "0 shared" and "we have not looked" must not print the same. */
export function sharedCount(grants: ShareGrant[] | null): number | null {
  return grants === null ? null : grants.length;
}

/**
 * The one-line summary for the section head. Unlike `photosNote` in
 * progressPhotos.ts this DOES speak when the count is zero, because "nothing is
 * shared" is the fact the client most needs stated rather than inferred.
 */
export function sharedNote(grants: ShareGrant[] | null): string | null {
  if (grants === null) return null;
  if (grants.length === 0) return 'None sent';
  return `${grants.length} sent to your coach`;
}

/**
 * Why this photo cannot be sent right now, or null if it can. Returned as the
 * sentence to show, because every one of these is something the person can act
 * on and "Couldn't share" is not.
 */
export function sendBlocker(
  photo: { id: string; url: string | null },
  coach: CoachRef | null,
  grants: ShareGrant[] | null,
): string | null {
  // The unknown-grants case is tested FIRST. Until that read lands there is no
  // honest thing to say about a coach either, and "you have no coach linked"
  // is a definite claim that a failed read has not earned.
  if (grants === null) return 'Still checking what your coach can already see — try again in a moment.';
  if (!coach) return 'You do not have a coach linked, so there is nobody to send this to.';
  if (grants.some((g) => g.photoId === photo.id)) return 'Your coach can already see this one.';
  if (photo.url === null) return 'This photo has no picture behind it any more, so there is nothing to send.';
  return null;
}

/** The honest sentence about a link the coach already opened. Kept here, in
 *  one place, so no screen quietly promises more than revocation delivers. */
export function revokeCaveat(): string {
  return 'A link your coach already had open can keep working for up to five minutes; after that it is gone for them.';
}

/** Newest first — a coach opening a client wants the most recent thing they
 *  were sent, not the oldest. Ties break on id so the order never wobbles. */
export function sortNewestShared(photos: SharedPhoto[]): SharedPhoto[] {
  return [...photos].sort((a, b) => {
    const d = Date.parse(b.sharedAt) - Date.parse(a.sharedAt);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

/** How many of the received photos have no image behind them. `null` when
 *  nothing has been loaded, never 0. */
export function missingSharedFiles(photos: SharedPhoto[] | null): number | null {
  return photos === null ? null : photos.filter((p) => p.url === null).length;
}

/* ── I/O ──────────────────────────────────────────────────────────────────── */

type Sb = typeof import('./supabase').supabase;

function db(): Sb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('./supabase') as { supabase: Sb }).supabase;
}

function report(context: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('./reportError') as {
      reportError: (c: string, e: unknown, x?: Record<string, unknown>) => void;
    };
    m.reportError(context, err, extra);
  } catch {
    /* reporting a failure must never itself fail */
  }
}

async function requireUid(sb: Sb): Promise<string> {
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  const uid = data?.user?.id;
  if (!uid) throw new Error('Sign in to send a photo to your coach.');
  return uid;
}

/**
 * The coach this client may send to, or null if there is nobody.
 *
 * Both links are required, because that is exactly what `coaching_link_active()`
 * requires in the policy. Asking the same question a different way here would
 * mean offering a Send button that the database then refuses — the app would
 * say "sent" and the coach would see nothing.
 *
 * A read failure THROWS. It must not come back as "you have no coach", which
 * is a real state with a real screen behind it.
 */
export async function fetchMyCoach(): Promise<CoachRef | null> {
  const sb = db();
  const uid = await requireUid(sb);

  const { data: me, error: cErr } = await sb
    .from('clients').select('trainer_id').eq('id', uid).maybeSingle();
  if (cErr) throw cErr;
  const coachId: string | null = (me as { trainer_id: string | null } | null)?.trainer_id ?? null;
  if (!coachId) return null;

  const { data: rel, error: rErr } = await sb
    .from('coaching_relationships')
    .select('coach_id')
    .eq('client_id', uid).eq('coach_id', coachId).eq('status', 'active')
    .maybeSingle();
  if (rErr) throw rErr;
  if (!rel) return null;

  // A name is a nicety; failing to get one is not a reason to say there is no
  // coach. It renders as an em-dash upstream.
  let name: string | null = null;
  const { data: prof, error: pErr } = await sb
    .from('profiles').select('full_name').eq('id', coachId).maybeSingle();
  if (pErr) report('photoShare.coachName', pErr, { coachId });
  else name = (prof as { full_name: string | null } | null)?.full_name ?? null;

  return { id: coachId, name };
}

/**
 * Every grant this client has outstanding — the answer to "which of my photos
 * can my coach see?". Throws on a read failure; the screen renders that as its
 * own state rather than as an empty list.
 */
export async function fetchMyShares(): Promise<ShareGrant[]> {
  const sb = db();
  const uid = await requireUid(sb);

  const { data, error } = await sb
    .from('progress_photo_shares')
    .select('photo_id, client_id, coach_id, shared_at')
    .eq('client_id', uid)
    .order('shared_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    photoId: r.photo_id as string,
    clientId: r.client_id as string,
    coachId: r.coach_id as string,
    sharedAt: r.shared_at as string,
  }));
}

/**
 * Send one photo. Returns the grant that now exists — read back from the
 * server, not assembled locally, so nothing tells the client a photo is shared
 * on the strength of a request that was never confirmed.
 */
export async function sharePhoto(photoId: string, coachId: string): Promise<ShareGrant> {
  const sb = db();
  const uid = await requireUid(sb);

  const { data, error } = await sb
    .from('progress_photo_shares')
    .insert({ photo_id: photoId, coach_id: coachId, client_id: uid })
    .select('photo_id, client_id, coach_id, shared_at')
    .single();
  if (error) throw error;
  if (!data) throw new Error('That photo was not sent — nothing has changed.');

  const r = data as any;
  return {
    photoId: r.photo_id as string,
    clientId: r.client_id as string,
    coachId: r.coach_id as string,
    sharedAt: r.shared_at as string,
  };
}

/**
 * Take one photo back. Deleting the grant closes the row and the file together
 * — see the header for the one thing it cannot reach.
 *
 * `.select()` so the delete reports what it actually removed: a delete that
 * matched nothing succeeds with `error: null`, and a caller that only checked
 * the error would tell somebody their photo was withdrawn when the grant is
 * still there under a coach id they no longer expect.
 */
export async function unsharePhoto(photoId: string, coachId: string): Promise<void> {
  const sb = db();
  const uid = await requireUid(sb);

  const { data, error } = await sb
    .from('progress_photo_shares')
    .delete()
    .eq('photo_id', photoId).eq('coach_id', coachId).eq('client_id', uid)
    .select('photo_id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('That photo was not withdrawn — nothing has changed. Pull to refresh and try again.');
  }
}

/**
 * COACH SIDE. What one client has sent this coach.
 *
 * Four reads, each checked, and then `viewerMaySee` over the result. The
 * predicate is not redundant with RLS: RLS decides what the SERVER returns and
 * this decides what the SCREEN renders, and the whole point of a consent
 * feature is that those two are checked against each other rather than one
 * being trusted to have been right.
 */
export async function fetchPhotosSharedWithMe(clientId: string): Promise<SharedPhoto[]> {
  const sb = db();
  const uid = await requireUid(sb);

  const { data: grantRows, error: gErr } = await sb
    .from('progress_photo_shares')
    .select('photo_id, client_id, coach_id, shared_at')
    .eq('coach_id', uid).eq('client_id', clientId);
  if (gErr) throw gErr;

  const grants: ShareGrant[] = (grantRows ?? []).map((r: any) => ({
    photoId: r.photo_id as string,
    clientId: r.client_id as string,
    coachId: r.coach_id as string,
    sharedAt: r.shared_at as string,
  }));
  if (grants.length === 0) return [];

  // Is this coach still this client's coach? Asked of the database rather than
  // assumed from the roster, which is a cached list.
  const { data: live, error: lErr } = await sb
    .rpc('coaching_link_active', { p_client: clientId, p_coach: uid });
  if (lErr) throw lErr;
  const links: CoachLink[] = [{ clientId, coachId: uid, active: live === true }];

  const { data: rows, error: pErr } = await sb
    .from('progress_photos')
    .select('id, client_id, taken_at, image_path')
    .in('id', grants.map((g) => g.photoId));
  if (pErr) throw pErr;

  const allowed = (rows ?? [])
    .map((r: any) => ({ id: r.id as string, clientId: r.client_id as string, takenAt: r.taken_at as string, path: r.image_path as string }))
    .filter((r) => {
      const may = viewerMaySee(uid, r, grants, links);
      // A row the server returned that this app will not show is a policy
      // regression, not a normal outcome. Say so somewhere a human reads.
      if (!may) report('photoShare.refusedRow', new Error('a row came back that no grant covers'), { photoId: r.id, clientId: r.clientId });
      return may;
    });
  if (allowed.length === 0) return [];

  const { data: signed, error: sErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(allowed.map((r) => r.path), SHARED_URL_TTL_S);
  if (sErr) throw sErr;

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (!s.error && s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const sharedAtByPhoto = new Map(grants.map((g) => [g.photoId, g.sharedAt]));
  return sortNewestShared(allowed.map((r) => ({
    id: r.id,
    path: r.path,
    takenAt: r.takenAt,
    sharedAt: sharedAtByPhoto.get(r.id) ?? r.takenAt,
    url: urlByPath.get(r.path) ?? null,
  })));
}

/**
 * COACH SIDE, for a screen that stays open. What one client has sent this
 * coach, stamped with when that was true and with every link carrying its own
 * death.
 *
 * ── WHY THIS EXISTS BESIDE fetchPhotosSharedWithMe ───────────────────────
 * That one answers a strip inside a sheet that is opened, glanced at and
 * dismissed, and it hands back plain `url` strings for it. This one feeds
 * app/(trainer)/client-photos.tsx, which a coach can leave open on a desk. Over
 * that span two things stop being true on their own: the signatures lapse, and
 * — the one that matters — the client may take a photo back. A bare string
 * survives both silently. So everything here is returned through
 * src/lib/photoInbox.ts's `SignedLink`, which cannot be rendered without being
 * asked whether it is still alive.
 *
 * ── THE LINK IS ASKED ABOUT EVEN WHEN THERE ARE NO GRANTS ────────────────
 * `pps_coach_read` already requires `coaching_link_active()`, so a coach who
 * has been let go reads zero grants — the same zero rows as a client who has
 * sent nothing. Those are not the same fact and a coach acts differently on
 * each, so `coaching_link_active` is called whatever the grant read returned
 * and the answer is carried out for the screen to say. This asks the database
 * only about a pair the caller is part of, which is what that function permits;
 * nothing here needs or requests any access the policies do not already give.
 *
 * Nothing else about the rule changes: the grants are the coach's own rows,
 * the photo rows come back only for ids those grants name, and `viewerMaySee`
 * re-checks each one against the policy in TypeScript before it is returned.
 *
 * THROWS on any failed read. A coach must never be told "they have sent you
 * nothing" on the strength of a read that did not happen.
 */
export async function fetchSharedInbox(clientId: string): Promise<Inbox> {
  const sb = db();
  const uid = await requireUid(sb);

  // Stamped before the first read rather than after the last. The list is at
  // least this old by the time it is on screen, and a stamp taken at the end
  // would under-state its age by however long the round trips took — in the
  // direction that delays noticing a withdrawal.
  const readAtMs = Date.now();

  const { data: grantRows, error: gErr } = await sb
    .from('progress_photo_shares')
    .select('photo_id, client_id, coach_id, shared_at')
    .eq('coach_id', uid).eq('client_id', clientId);
  if (gErr) throw gErr;

  const grants: ShareGrant[] = (grantRows ?? []).map((r: any) => ({
    photoId: r.photo_id as string,
    clientId: r.client_id as string,
    coachId: r.coach_id as string,
    sharedAt: r.shared_at as string,
  }));

  const { data: live, error: lErr } = await sb
    .rpc('coaching_link_active', { p_client: clientId, p_coach: uid });
  if (lErr) throw lErr;
  const linkActive = live === true;
  const links: CoachLink[] = [{ clientId, coachId: uid, active: linkActive }];

  const empty: Inbox = { clientId, coachId: uid, linkActive, photos: [], readAtMs };
  if (grants.length === 0 || !linkActive) return empty;

  // Four columns, and `weight_kg` / `body_fat_pct` are deliberately not among
  // them. The policy grants the whole row and 47 says so out loud; that those
  // two numbers are already visible to a linked coach elsewhere is not a reason
  // to carry them into a screen about a photograph, where they would turn a
  // picture somebody chose to send into a body-composition reading beside it.
  const { data: rows, error: pErr } = await sb
    .from('progress_photos')
    .select('id, client_id, taken_at, image_path')
    .in('id', grants.map((g) => g.photoId));
  if (pErr) throw pErr;

  const allowed = (rows ?? [])
    .map((r: any) => ({
      id: r.id as string,
      clientId: r.client_id as string,
      takenAt: r.taken_at as string,
      path: r.image_path as string,
    }))
    .filter((r) => {
      const may = viewerMaySee(uid, r, grants, links);
      // Same reasoning as fetchPhotosSharedWithMe: a row the server returned
      // that this app will not draw is a policy regression, not a normal
      // outcome, and it has to be legible to a human somewhere.
      if (!may) report('photoShare.refusedRow', new Error('a row came back that no grant covers'), { photoId: r.id, clientId: r.clientId });
      return may;
    });
  if (allowed.length === 0) return empty;

  // Taken before the request goes out: the signature's clock starts at the
  // server, so a mint time read after the round trip would credit the link with
  // life it does not have.
  const mintedAtMs = Date.now();
  const { data: signed, error: sErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(allowed.map((r) => r.path), SHARED_URL_TTL_S);
  if (sErr) throw sErr;

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (!s.error && s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  const sharedAtByPhoto = new Map(grants.map((g) => [g.photoId, g.sharedAt]));
  const photos: InboxPhoto[] = allowed.map((r) => ({
    id: r.id,
    path: r.path,
    takenAt: r.takenAt,
    // Falling back to takenAt would print a send date that nothing recorded.
    // A grant always carries shared_at, so this only fires if the two reads
    // disagree — in which case the screen shows a dash for the send date.
    sharedAt: sharedAtByPhoto.get(r.id) ?? '',
    link: signedLink(urlByPath.get(r.path) ?? null, mintedAtMs, SHARED_URL_TTL_S),
  }));

  return { clientId, coachId: uid, linkActive, photos: newestSharedFirst(photos), readAtMs };
}

/** Convenience for the client screen: the photos the coach can currently open,
 *  in the same order the strip shows them. Pure, so it is covered too. */
export function sentPhotos(photos: ProgressPhoto[] | null, grants: ShareGrant[] | null): ProgressPhoto[] | null {
  if (photos === null || grants === null) return null;
  const sent = new Set(grants.map((g) => g.photoId));
  return photos.filter((p) => sent.has(p.id));
}
