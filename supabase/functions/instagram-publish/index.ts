// instagram-publish — the only thing in this product that writes a public
// object, and the only thing that posts anywhere on a coach's behalf.
//
// ── What this is, beside what was already here ────────────────────────────
//
// `src/lib/social.ts` hands a composed card to the phone's share sheet. That
// path is untouched, it is still the default, and it is still the ONLY path for
// a card carrying a client's photograph. This adds one network beside it.
//
// A feed post through the Content Publishing API is two Graph calls:
//
//   POST /{ig-user-id}/media          with an image_url  → a container id
//   POST /{ig-user-id}/media_publish  with that id       → a media id
//
// Meta FETCHES the image_url from its own servers. There is no upload endpoint
// and no way to hand it bytes, so the card has to exist at a publicly reachable
// unauthenticated URL for long enough to be fetched. That is why part 400
// exists and why it is the eighth bucket and the only public one.
//
// ── The rules, in the order they are enforced ─────────────────────────────
//
// 1. NO TOKEN EVER REACHES A DEVICE. `instagram_accounts` has no policy and no
//    grant for `authenticated` (part 401), the token is read here under the
//    service role, and the app asks `my_instagram_account()` for flags. The
//    consequence of the other choice is in supabase/functions/ocr-scan: an
//    EXPO_PUBLIC_ key inlined into the bundle and shipped readable.
//
// 2. WHO IS ASKING COMES FROM THE JWT, NEVER THE BODY. A trainer id in a
//    request body is a request to post to somebody else's Instagram account.
//
// 3. THE CARD IS JPEG, THE RIGHT SHAPE, AND UNDER 8 MiB — checked here, from
//    the bytes, before a public object exists. `isJpegBytes` reads the SOI
//    marker rather than trusting the content type, because a PNG uploaded as
//    image/jpeg fails ingestion several seconds later, after the object is
//    already public.
//
// 4. A CARD WITH A CLIENT'S PHOTOGRAPH IS REFUSED. The app's gate is the
//    structural one — `checkPublishable` in src/lib/instagramPublish.ts is the
//    only thing that can produce a `PublishableCard` and it refuses a card
//    whose photo is non-null — and this is the second layer: the request has to
//    declare `photo: 'none'`, and anything else is refused by name. A server
//    cannot look at a JPEG and see whose body is in it, so this is honestly a
//    declaration rather than a proof, and it is written down as one.
//
// 5. THE OBJECT OUTLIVES THE REQUEST WHATEVER HAPPENS, and is removed only
//    when Meta is known to be finished with it. See `publish` below.
//
// ── What a human has to obtain, and where it goes ────────────────────────
//
//   INSTAGRAM_CLIENT_ID       Meta app id. Public: it appears in the consent
//                             URL. Also set as EXPO_PUBLIC_INSTAGRAM_CLIENT_ID
//                             for the app, which is the same value.
//   INSTAGRAM_CLIENT_SECRET   Meta app secret. A Supabase secret, read here
//                             only, never returned and never logged.
//   SWEEP_SECRET              Optional, and only for the scheduled sweep. The
//                             same secret sweep-stale-visits uses.
//
// And the thing no configuration can supply: Meta gates
// `instagram_content_publish` behind App Review. Until this app has it, the
// consent screen grants the permission only to people with a role on the Meta
// app itself, so everybody else authorises successfully and is then refused on
// the first publish with a permissions error. That is Meta's gate, not a fault
// here, and it is reported in those words so a coach is not left thinking
// Repple is broken.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CARD_BUCKET, CARD_OBJECT_TTL_MIN, cardObjectAbsent, cardObjectKey, cardObjectRemoved,
  cardPublicUrl, isJpegBytes, ratioAccepted, tooLarge,
} from '../../../src/lib/instagramPublish.ts';
import { secretConfigured, secretMatches } from '../../../src/lib/sharedSecret.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-sweep-secret' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
// Failures come back as HTTP 200 with an `error` field, the same as ads-oauth
// and wearable-oauth: a non-2xx makes supabase-js null out `data`, and the
// reason — which is the only actionable part — is lost on the way to the screen.
const fail = (msg: string, extra: Record<string, unknown> = {}) => json({ ok: false, error: msg, ...extra });

// Pinned. Meta deprecates a version roughly every two years and an unpinned
// call changes behaviour on Meta's schedule rather than on a deploy.
const GRAPH = 'https://graph.facebook.com/v21.0';

/** How long to wait for Meta to finish fetching the image before publishing.
 *  A single feed image is normally ready on the first or second look. */
const READY_TRIES = 12;
const READY_GAP_MS = 1500;

type GraphResult = { ok: true; body: any } | { ok: false; error: string };

/** Meta reports failure in the body as often as in the status. Read both. */
async function graph(url: string, init?: RequestInit): Promise<GraphResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: 'Meta could not be reached.' };
  }
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { body = { error: { message: text.slice(0, 300) } }; }
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    // Meta's own words. "Permissions error" and "Invalid OAuth access token"
    // send a coach to two completely different remedies, and a flattened
    // "posting failed" sends them to neither.
    const detail = [e.message, e.error_user_msg].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, body };
}

const post = (url: string) => graph(url, { method: 'POST' });

/**
 * The Pages this login can see, each with the Instagram account linked to it.
 *
 * Both halves are needed and neither is optional: the Content Publishing API
 * posts to an Instagram BUSINESS or CREATOR account, and it reaches one only
 * through the Page it is linked to. A Page with no linked account is listed
 * anyway, with `igUserId` null, because "you have three Pages and none of them
 * has an Instagram account attached" is a thing a coach can act on and an empty
 * list is not.
 */
async function pagesOn(userToken: string) {
  const r = await graph(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`
    + `&limit=100&access_token=${encodeURIComponent(userToken)}`,
  );
  if (!r.ok) return r;
  const rows = Array.isArray(r.body?.data) ? r.body.data : [];
  return {
    ok: true as const,
    pages: rows.map((p: any) => ({
      id: String(p?.id || ''),
      name: String(p?.name || '').trim(),
      // The PAGE token, not the user token. This is what a publish is made
      // with, and it is never returned to the app.
      token: String(p?.access_token || ''),
      igUserId: p?.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
      igUsername: p?.instagram_business_account?.username ? String(p.instagram_business_account.username) : null,
    })).filter((p: any) => p.id),
  };
}

/** What is safe to show the app: no token, ever. */
const publicPage = (p: any) => ({ id: p.id, name: p.name, igUsername: p.igUsername, hasInstagram: !!p.igUserId });

/* ── the public object ────────────────────────────────────────────────────── */

/**
 * Delete the bytes, and refuse to claim it unless they went.
 *
 * `remove()` returning an empty list is ambiguous — the object was already
 * gone, or the delete was refused — and the two are opposite answers to "is
 * this card still on the public internet". So the ambiguous case is resolved by
 * looking: a listing either still names the object, in which case the removal
 * did not happen, or it does not, in which case it is genuinely absent and that
 * is what was asked for. A listing that cannot be read is not an answer either.
 *
 * This is `removeDocumentObject` in src/lib/gymDocs.ts, in Deno, for the same
 * reason: the one thing it must never do is report a removal it has not
 * observed. Here that matters more than it does for a gym's paperwork, because
 * the bucket is public.
 */
async function removeCardObject(service: any, key: string): Promise<{ removed: boolean; why: string | null }> {
  const bucket = service.storage.from(CARD_BUCKET);
  const { data, error } = await bucket.remove([key]);
  if (error) {
    return { removed: false, why: `storage refused the delete: ${error.message || 'no reason given'}` };
  }
  if (cardObjectRemoved(key, data)) return { removed: true, why: null };

  const listing = await bucket.list('', { search: key, limit: 100 });
  if (listing.error) {
    return { removed: false, why: `storage accepted the delete without saying what it removed, and the bucket could not be listed to check: ${listing.error.message || 'no reason given'}` };
  }
  if (!cardObjectAbsent(key, listing.data)) {
    return { removed: false, why: 'storage accepted the delete and removed nothing — the object is still in the bucket' };
  }
  return { removed: true, why: null };
}

/**
 * Record the outcome of a removal on the ledger row, whichever way it went.
 *
 * Answers whether the ledger actually took it, and both halves of that are
 * checked because neither was.
 *
 * The result used not to be bound at all, so `error` was not read and nor was
 * the row count — and a PostgREST UPDATE that matches ZERO rows is a 204 with a
 * null error, indistinguishable from one that changed something. This table is
 * the only record of what this product has put on the public internet, and the
 * only thing that will ever come back for an object: `sweep` selects the rows
 * whose `removed_at` is null. So a ledger row that is not there is an object no
 * sweep will ever look for again.
 *
 * The key is 32 hex characters of `crypto.getRandomValues` and the client is
 * the service role, so nothing filters this update and zero rows has exactly
 * one meaning: the row is gone. Paired with a removal that could NOT be
 * confirmed, that is a public object nothing knows about — the state the ledger
 * exists to make impossible, and the state the caller is otherwise about to
 * promise a coach the sweep will clear.
 *
 * Logged rather than thrown. Five of the six call sites are already returning
 * somebody Meta's own refusal, which is the actionable half of what they have
 * to say; the sixth is a published post. Only that sixth changes what the coach
 * is told, and only when the object is still up.
 */
async function markRemoval(service: any, key: string, r: { removed: boolean; why: string | null }): Promise<boolean> {
  const { error, count } = await service.from('share_card_objects').update({
    removed_at: r.removed ? new Date().toISOString() : null,
    remove_failure: r.why,
  }, { count: 'exact' }).eq('object_key', key);
  if (error) {
    console.error(
      'instagram-publish: card object ' + key + ' ' + (r.removed ? 'was removed' : 'could NOT be removed')
      + ' and the ledger refused the record of it: ' + error.message
      + (r.removed ? '' : ' The object is still public and the sweep will still find it.'),
    );
    return false;
  }
  if (!count) {
    console.error(
      'instagram-publish: card object ' + key + ' ' + (r.removed ? 'was removed' : 'could NOT be removed')
      + ' and share_card_objects has no row for it to be recorded on.'
      + (r.removed
        ? ' Nothing is public and nothing is owed.'
        : ' THE OBJECT IS STILL PUBLIC AND NO SWEEP WILL FIND IT — the sweep reads this table. Remove ' + key
          + ' from the ' + CARD_BUCKET + ' bucket by hand.'),
    );
    return false;
  }
  return true;
}

/**
 * Every card object past its ceiling whose removal was never confirmed.
 *
 * Runs at the START of every request that touches this function, so the normal
 * failure — a publish that died between the upload and the delete — is cleared
 * by the next thing the coach does, without a scheduler existing. The scheduled
 * entry below is the belt to that's braces: a coach who publishes once a month
 * should not leave an orphan up for a month.
 *
 * It is best-effort and silent. A sweep that fails does not change what the
 * request it was attached to should do.
 */
async function sweep(service: any): Promise<{ swept: number; left: number }> {
  let swept = 0;
  let left = 0;
  try {
    // no-error-ok: a sweep that cannot read its own ledger does nothing, and
    // the caller's own work is unaffected either way.
    const { data } = await service
      .from('share_card_objects')
      .select('object_key')
      .is('removed_at', null)
      .lt('expires_at', new Date().toISOString())
      .limit(100);
    for (const row of (data ?? [])) {
      const key = String(row?.object_key || '');
      if (!key) continue;
      const r = await removeCardObject(service, key);
      await markRemoval(service, key, r);
      if (r.removed) swept++; else left++;
    }
  } catch { /* best effort, by design */ }
  return { swept, left };
}

/* ── the handler ──────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any = {};
  try { body = await req.json(); } catch { return fail('bad json'); }
  const action = String(body.action || 'publish');

  /* ── sweep: the scheduled entry point, and the only unauthenticated one ─
   *
   * Takes no input at all and returns counts only, for sweep-stale-visits'
   * reasons: a definer-shaped endpoint that accepts a tenant or a key from its
   * caller is a way to ask this function to delete something specific. It
   * refuses outright when SWEEP_SECRET is unset rather than running
   * unauthenticated. */
  if (action === 'sweep') {
    const secret = Deno.env.get('SWEEP_SECRET') || '';
    if (!secretConfigured(secret)) return fail('The sweep is not configured on this project. Set SWEEP_SECRET as a Supabase secret to schedule it.');
    // One secret guarding two endpoints should not be compared two ways — and
    // for a while it was compared three, because notify-message holds a shared
    // secret too and was still on a bare `!==`. The rule is now stated once, in
    // src/lib/sharedSecret.ts, and tested there.
    const offered = req.headers.get('x-sweep-secret') || '';
    if (!secretMatches(offered, secret)) {
      return json({ ok: false, error: 'no' }, 401);
    }
    return json({ ok: true, ...(await sweep(service)) });
  }

  const clientId = Deno.env.get('INSTAGRAM_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('INSTAGRAM_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) {
    return fail('Posting to Instagram is not configured on the server yet — the owner sets INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET as Supabase secrets.');
  }

  // Who is asking, from their JWT alone. Never from the body: a trainer id in a
  // request body is a request to post to somebody else's Instagram account.
  let trainerId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    trainerId = data?.user?.id || '';
  } catch { /* falls through to the check below */ }
  if (!trainerId) return json({ ok: false, error: 'Sign in to Repple and try again.' }, 401);

  // Before anything else this request does. An orphan from a previous publish
  // is a public object, and the sooner it goes the better.
  await sweep(service);

  /* ── connect: code → long-lived token → the Pages it can see ─────────── */
  if (action === 'connect') {
    const code = String(body.code || '');
    const redirectUri = String(body.redirect_uri || '');
    if (!code || !redirectUri) return fail('The sign-in did not come back with a code. Tap Connect again.');

    const short = await graph(
      `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(clientId)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&client_secret=${encodeURIComponent(clientSecret)}`
      + `&code=${encodeURIComponent(code)}`,
    );
    if (!short.ok) {
      // The two failures worth naming, because their remedies are different and
      // neither is "try again": a used or stale code needs a fresh sign-in, and
      // a redirect mismatch needs fixing in the Meta app settings.
      if (/expired|been used|authorization code/i.test(short.error)) {
        return fail(`Meta would not accept that sign-in code (${short.error}). Tap Connect again to start a fresh sign-in.`);
      }
      if (/redirect/i.test(short.error)) {
        return fail(`Meta rejected the redirect address (${short.error}). It has to be listed under Valid OAuth Redirect URIs in the Meta app settings.`);
      }
      return fail(`Meta refused the sign-in: ${short.error}`);
    }
    const shortToken = String(short.body?.access_token || '');
    if (!shortToken) return fail('Meta accepted the sign-in but returned no token.');

    // Trade it for the ~60-day token. A short-lived one expires in about an
    // hour, which is a connection that works on the day it is made and silently
    // stops before the coach next opens the screen.
    const long = await graph(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(clientId)}`
      + `&client_secret=${encodeURIComponent(clientSecret)}`
      + `&fb_exchange_token=${encodeURIComponent(shortToken)}`,
    );
    const userToken = long.ok ? String(long.body?.access_token || shortToken) : shortToken;
    const warning = long.ok ? undefined
      : `Meta would not issue a long-lived token (${long.error}), so this connection will stop working within the hour. Disconnect and connect again, and if it keeps happening the Meta app needs looking at.`;
    const expiresIn = long.ok ? Number(long.body?.expires_in || 0) : 0;
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    const listed = await pagesOn(userToken);
    if (!listed.ok) return fail(`Meta refused the list of Pages: ${listed.error}`);
    const pages = (listed as any).pages as any[];

    // Exactly one Page WITH an Instagram account is not a decision, so it is
    // made here. Anything else is the coach's to say: a coach who also runs a
    // client's gym Page would otherwise have a card posted to the wrong
    // business's feed, silently, and there is no undoing a post.
    const withIg = pages.filter((p) => p.igUserId);
    let chosen = withIg.length === 1 ? withIg[0] : null;

    /* ── a reconnect may not destroy a working connection ────────────────
     *
     * The upsert below replaces every column of the row, and it used to write
     * `ig_user_id: chosen?.igUserId ?? null` unconditionally. `chosen` is null
     * whenever the login reaches anything other than exactly one Instagram
     * account — so a coach who was posting yesterday, and who tapped Connect
     * because the app told them their token expires within the week, had their
     * account UNSET by the act of renewing it. Renewing a credential is the
     * commonest reason to be here and it was the destructive path.
     *
     * Two rules, in order:
     *
     *   · If this login still reaches the Page the row already names, that
     *     Page is kept and its token refreshed. That IS the renewal, and it
     *     needs no decision from the coach because they made it already.
     *
     *   · If it does not, and the row was working, NOTHING IS WRITTEN. A
     *     sign-in that cannot replace a connection does not get to end it.
     *     Switching accounts stays available and stays explicit: disconnect,
     *     then connect.
     *
     * A row that was half-made — authorised, no account chosen — has nothing
     * to protect and falls through to the write as before, which is what puts
     * a fresh list in front of the coach.
     */
    // no-error-ok: a row that cannot be read is treated as no row, which sends
    // this down the same path as a first connection — a fresh write. The only
    // thing lost is the protection below, and asserting a connection exists on
    // the strength of a failed read would be worse.
    const { data: existing } = await service
      .from('instagram_accounts').select('page_id, ig_user_id, ig_username').eq('trainer_id', trainerId).maybeSingle();
    const hadPage = String(existing?.page_id || '');
    const wasReady = !!existing?.ig_user_id;
    if (!chosen && hadPage) chosen = withIg.find((p) => p.id === hadPage) ?? null;
    if (!chosen && wasReady) {
      const had = existing?.ig_username ? `@${existing.ig_username}` : 'the Instagram account';
      return fail(
        `That Meta login does not reach ${had} that Repple posts to, so nothing has been changed and your existing connection still works. `
        + 'To post from a different account, disconnect first and then connect.',
      );
    }

    const { error } = await service.from('instagram_accounts').upsert({
      trainer_id: trainerId,
      page_id: chosen?.id ?? null,
      page_name: chosen?.name ?? null,
      ig_user_id: chosen?.igUserId ?? null,
      ig_username: chosen?.igUsername ?? null,
      // The PAGE token where one has been settled on, and the user token
      // otherwise — which is what `choose` reads to list the Pages again.
      access_token: chosen?.token || userToken,
      expires_at: expiresAt,
      scopes: String(short.body?.scope || '') || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'trainer_id' });
    if (error) return fail(`Instagram was connected but the connection could not be saved: ${error.message}`);

    return json({
      ok: true,
      chosen: chosen ? { id: chosen.id, name: chosen.name, igUsername: chosen.igUsername } : null,
      pages: pages.map(publicPage),
      warning,
    });
  }

  /* ── choose: which Page, and therefore which Instagram account ───────── */
  if (action === 'choose') {
    const wanted = String(body.page_id || '').trim();
    if (!wanted) return fail('No Page was chosen.');

    // no-error-ok: a missing row and a failed read are handled identically on
    // the next line — either way there is no token to verify against, and the
    // coach is told to connect again rather than shown a half-made connection.
    const { data: row } = await service
      .from('instagram_accounts').select('access_token').eq('trainer_id', trainerId).maybeSingle();
    const token = String(row?.access_token || '');
    if (!token) return fail('That connection is no longer there. Connect Instagram again.');

    // Verified against Meta rather than trusted from the body. Without this a
    // coach could name any Page id and Repple would try to post to it.
    const listed = await pagesOn(token);
    if (!listed.ok) return fail(`Meta refused the list of Pages: ${listed.error}`);
    const chosen = ((listed as any).pages as any[]).find((p) => p.id === wanted);
    if (!chosen) return fail('That Page is not one this Meta login can see. Pick one from the list.');
    if (!chosen.igUserId) {
      return fail('That Page has no Instagram Business or Creator account linked to it, so there is nowhere for a post to go. Link one in Meta Business Suite and connect again.');
    }

    // Counted. The response below names the Page back to the coach as the one
    // they are now posting from, and that sentence is only true if a row took
    // the choice. This runs under the service role, so nothing filters it: zero
    // rows means the connection was removed between the read a few lines above
    // and this write. Left unchecked the coach is shown a chosen Page, posts
    // against a connection that is not there, and finds out at the first
    // publish — by which time they have written the caption.
    const { error, count } = await service.from('instagram_accounts').update({
      page_id: chosen.id,
      page_name: chosen.name,
      ig_user_id: chosen.igUserId,
      ig_username: chosen.igUsername,
      access_token: chosen.token || token,
      updated_at: new Date().toISOString(),
    }, { count: 'exact' }).eq('trainer_id', trainerId);
    if (error) return fail(`That account was verified but not saved: ${error.message}`);
    if (!count) return fail('That account was verified, but the Instagram connection it belongs to is no longer there to save it onto. Connect Instagram again.');

    return json({ ok: true, chosen: { id: chosen.id, name: chosen.name, igUsername: chosen.igUsername } });
  }

  /* ── publish ──────────────────────────────────────────────────────────── */
  if (action !== 'publish') return fail('unknown action');

  // Layer two of the hard rule. The app's gate is structural — nothing but
  // `checkPublishable` can produce the value its publish function accepts — and
  // this is the declaration that has to accompany it. A server cannot look at a
  // JPEG and see whose body is in it, so this is not a proof, and it is written
  // down as a declaration rather than dressed up as one.
  const photo = String(body.photo || '');
  if (photo !== 'none') {
    return fail('A card carrying a client’s photograph is not published this way. It goes through the share sheet on the coach’s own phone, where no public copy of it is ever made.');
  }

  const caption = String(body.caption || '').slice(0, 2200);
  const width = Number(body.width || 0);
  const height = Number(body.height || 0);
  if (!ratioAccepted(width, height)) {
    return fail('Instagram’s feed only takes a card between 4:5 and 1.91:1, and this one is outside that. Repple will not crop it to fit.');
  }

  const b64 = String(body.jpeg_base64 || '');
  if (!b64) return fail('No image came with that request, so nothing was posted.');
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return fail('That image could not be read, so nothing was posted.');
  }
  // From the bytes, not from a content type somebody sent. Instagram does not
  // accept PNG on this endpoint, and a PNG labelled image/jpeg fails ingestion
  // several seconds later — after a public object already exists for it.
  if (!isJpegBytes(bytes)) return fail('That card is not a JPEG. Instagram’s feed takes JPEG only, and nothing has been uploaded.');
  if (tooLarge(bytes.byteLength)) return fail('That card is over Instagram’s 8 MB limit for a feed image, so nothing was uploaded.');

  // no-error-ok: a missing row and a failed read both mean there is no token to
  // post with, and the next line says exactly that.
  const { data: acct } = await service
    .from('instagram_accounts').select('ig_user_id, ig_username, access_token').eq('trainer_id', trainerId).maybeSingle();
  const igUserId = String(acct?.ig_user_id || '');
  const token = String(acct?.access_token || '');
  if (!token) return fail('There is no Instagram account connected to this coach. Connect one and try again.');
  if (!igUserId) return fail('This connection has no Instagram account chosen yet. Pick the Page you post from and try again.');

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const key = cardObjectKey(randomHex32());
  const publicUrl = cardPublicUrl(supabaseUrl, key);
  if (!publicUrl) return fail('This project has no address Meta could fetch the card from, so nothing was uploaded.');

  const cardKind = String(body.kind || '').slice(0, 32) || null;

  // The ledger row goes in BEFORE the upload. An upload that succeeds while
  // this request dies would otherwise leave a public object nothing knows
  // about — invisible to the sweep, and therefore there for ever.
  const expiresAt = new Date(Date.now() + CARD_OBJECT_TTL_MIN * 60_000).toISOString();
  const { error: ledgerError } = await service.from('share_card_objects')
    .insert({ object_key: key, trainer_id: trainerId, expires_at: expiresAt });
  if (ledgerError) {
    return fail(`The card could not be prepared for posting: ${ledgerError.message}. Nothing has been uploaded and nothing has been posted.`);
  }

  const up = await service.storage.from(CARD_BUCKET).upload(key, bytes, {
    contentType: 'image/jpeg',
    // Nothing may overwrite anything here. A key collision at 128 bits is not a
    // thing that happens, and if it did, silently replacing another coach's
    // in-flight card is not the way to find out.
    upsert: false,
    // Meta fetches once, within seconds. There is nothing to cache and a cached
    // copy of a card that has been deleted is the one thing worth avoiding.
    cacheControl: '0',
  });
  if (up.error) {
    // Nothing was written, so there is nothing to sweep and the ledger row is
    // removed rather than marked as deleted. A row saying an object was removed
    // when it never existed is a false entry in the one table that says what
    // has been public.
    //
    // no-count-ok: zero rows deleted is the outcome this line asks for. The row
    // was inserted a few lines above under the service role, the key is 32 hex
    // characters of `crypto.getRandomValues` and nothing else filters this, so
    // zero rows means the row is already absent — and an absent row is exactly
    // what "no false entry" means. Unlike `markRemoval` above, there is no
    // public object on the other side of this: the upload is the thing that
    // just failed, so there is nothing for a sweep to be deprived of.
    const { error: cleanupErr } = await service.from('share_card_objects').delete().eq('object_key', key);
    if (cleanupErr) {
      // Not returned: the coach is about to be told, in the next line, the one
      // thing they can act on — the upload failed and nothing was posted. What
      // this leaves behind is a ledger row for an object that was never
      // created, which the sweep will confirm absent and close at the ceiling.
      console.error('instagram-publish: upload of ' + key + ' failed and its ledger row could not be cleared: ' + cleanupErr.message);
    }
    return fail(`The card could not be put where Instagram can fetch it: ${up.error.message}. Nothing has been posted.`);
  }

  const recordFailure = async (why: string, containerId: string | null) => {
    await service.from('instagram_posts').insert({
      trainer_id: trainerId,
      status: containerId ? 'container' : 'failed',
      container_id: containerId,
      media_id: null,
      card_kind: cardKind,
      object_key: key,
      failure: why.slice(0, 500),
    });
  };

  /* ── 1. the container. This is the call Meta fetches the URL during ──── */
  const created = await post(
    `${GRAPH}/${encodeURIComponent(igUserId)}/media?image_url=${encodeURIComponent(publicUrl)}`
    + `&caption=${encodeURIComponent(caption)}&access_token=${encodeURIComponent(token)}`,
  );
  if (!created.ok) {
    // A definite refusal: Meta answered, and it answered no. It is not going to
    // come back for the image, so the object goes now.
    await recordFailure(created.error, null);
    const r = await removeCardObject(service, key);
    await markRemoval(service, key, r);
    return fail(created.error, { stage: 'container', objectRemoved: r.removed });
  }
  const containerId = String(created.body?.id || '');
  if (!containerId) {
    await recordFailure('Meta accepted the image and returned no container id.', null);
    const r = await removeCardObject(service, key);
    await markRemoval(service, key, r);
    return fail('Instagram accepted the card and gave nothing back to publish, so nothing was posted.', { stage: 'container' });
  }

  /* ── 2. wait until Meta has finished with the URL ──────────────────────
   *
   * THE OBJECT OUTLIVES THE REQUEST WHATEVER HAPPENS, and this is the reason.
   * The fetch is asynchronous: deleting the object the instant the container
   * call returns is a race, and losing it is a post that never appears or one
   * that appears broken. `status_code` is Meta's own answer to "have you
   * finished with it": FINISHED means the media is ingested and publishable,
   * IN_PROGRESS means they are still working, ERROR means they gave up.
   *
   * Nothing is deleted while the answer is IN_PROGRESS. If this loop runs out
   * of patience the object is LEFT, its ledger row stands, and the sweep takes
   * it at the ceiling — which is fifteen minutes, three orders of magnitude
   * more than ingesting one image takes. A deleted-too-early object cannot be
   * undone; a late-swept one is a URL nobody has. */
  let ready = false;
  let readyDetail = '';
  for (let i = 0; i < READY_TRIES; i++) {
    const st = await graph(`${GRAPH}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
    if (!st.ok) { readyDetail = st.error; break; }
    const code = String(st.body?.status_code || '');
    if (code === 'FINISHED') { ready = true; break; }
    if (code === 'ERROR' || code === 'EXPIRED') { readyDetail = String(st.body?.status || code); break; }
    await new Promise((r) => setTimeout(r, READY_GAP_MS));
  }
  if (!ready) {
    const why = readyDetail || 'Instagram was still fetching the image when Repple stopped waiting.';
    await recordFailure(why, containerId);
    // Deliberately NOT removed here. Meta may still be fetching, and a delete
    // now is the race this whole section exists to avoid. The sweep has it.
    return fail(
      `Instagram took the image and has not published it: ${why} Nothing is on your feed. Try again in a moment, or post it from your share sheet.`,
      { stage: 'container', containerId, objectRemoved: false },
    );
  }

  /* ── 3. publish. Only this returns a post ─────────────────────────────── */
  const published = await post(
    `${GRAPH}/${encodeURIComponent(igUserId)}/media_publish?creation_id=${encodeURIComponent(containerId)}`
    + `&access_token=${encodeURIComponent(token)}`,
  );
  if (!published.ok) {
    await recordFailure(published.error, containerId);
    // Safe to remove, and for the reason the section above gives: the status
    // was FINISHED, so Meta has the bytes and is not coming back for the URL.
    // A publish that was refused is a reason to take the public copy down
    // sooner rather than to leave it for the ceiling.
    const r = await removeCardObject(service, key);
    await markRemoval(service, key, r);
    return fail(published.error, { stage: 'publish', containerId, objectRemoved: r.removed });
  }
  const mediaId = String(published.body?.id || '');
  if (!mediaId) {
    await recordFailure('Meta published and returned no media id.', containerId);
    const r = await removeCardObject(service, key);
    await markRemoval(service, key, r);
    return fail('Instagram did not say whether the post went up, so Repple will not claim that it did. Check your feed before posting again.', { stage: 'publish', containerId, objectRemoved: r.removed });
  }

  // A permalink is a convenience, not a fact the post depends on. A failure
  // here changes nothing about what happened.
  let permalink: string | null = null;
  const link = await graph(`${GRAPH}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(token)}`);
  if (link.ok && link.body?.permalink) permalink = String(link.body.permalink);

  await service.from('instagram_posts').insert({
    trainer_id: trainerId,
    status: 'published',
    container_id: containerId,
    media_id: mediaId,
    permalink,
    card_kind: cardKind,
    object_key: key,
    published_at: new Date().toISOString(),
  });

  // Meta has the media. The public object has done its whole job and goes now,
  // with the removal CONFIRMED rather than assumed. A removal that cannot be
  // confirmed leaves the ledger row open and is reported to the coach — the
  // post is up either way, and a warning about a temporary file is a different
  // thing from a post that failed.
  const removal = await removeCardObject(service, key);
  const recorded = await markRemoval(service, key, removal);

  return json({
    ok: true,
    mediaId,
    containerId,
    permalink,
    objectRemoved: removal.removed,
    // Three states, not two, because the sweep is a promise this function can
    // only keep while the ledger row exists. An object that could not be
    // confirmed deleted AND could not be recorded is one the sweep reads no row
    // for and will never come back to, so saying "Repple will remove it" there
    // would be a claim about a thing that is not going to happen.
    warning: removal.removed ? undefined
      : recorded
        ? 'Your post is up. The temporary copy of the card could not be confirmed as deleted, so Repple will remove it on the next sweep.'
        : 'Your post is up. The temporary copy of the card could not be confirmed as deleted, and Repple has no record left to sweep it from, so it will not be removed on its own. Tell whoever runs this Repple, and quote ' + key + '.',
  });
});

/**
 * 128 bits of randomness as 32 hex characters.
 *
 * The key is built from this and nothing else — no coach id, no card id, no
 * date, nothing enumerable. `cardObjectKey` throws rather than accepting
 * anything that is not this shape, so a failed random source cannot quietly
 * become a predictable name.
 */
function randomHex32(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((n) => n.toString(16).padStart(2, '0')).join('');
}

