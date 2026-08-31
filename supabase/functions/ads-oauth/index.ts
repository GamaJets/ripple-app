// ads-oauth — turns a Meta consent code into a stored ad-account connection.
//
// ── The rule this function exists to keep ─────────────────────────────────
//
// The app never sees a token. Not the short-lived one, not the long-lived one,
// not for a moment while a picker is open.
//
// supabase/functions/ocr-scan/index.ts records what happens otherwise:
// EXPO_PUBLIC_OCR_API_KEY was inlined into the JavaScript bundle at build time
// and shipped readable to anybody who unpacked the app. A Meta access token is
// a long way worse than an OCR key — it reads a business's customer data and
// sits on an account that spends money — so the split here is absolute:
//
//   · META_ADS_CLIENT_ID is public. It appears in the consent URL the app
//     opens, so it may be an EXPO_PUBLIC_ value.
//   · META_ADS_CLIENT_SECRET is a Supabase secret and is read here only. It
//     is never returned, never logged, and never sent anywhere but Meta.
//   · the access token is written straight into coach_ad_accounts, a table with
//     no policy and no grant for `authenticated` at all (part 100), and is read
//     back only by ads-sync under the service role.
//
// ── Two steps, because picking the ad account is the coach's decision ─────
//
// A Meta login can carry several ad accounts. Choosing the first one for the
// coach would decide, silently, which account their spend figures come from —
// and a coach who also runs ads for a client's gym would be shown the wrong
// business's money. So:
//
//   POST { action: 'connect', code, redirect_uri }
//        → exchanges the code, stores the token, returns the ACCOUNT LIST
//          (id, name, currency — none of it secret). If there is exactly one,
//          it is chosen there and then, because there is no decision to make.
//   POST { action: 'choose', account_id }
//        → verifies the id is really on the stored token, then records it.
//
// ── What does not work yet, and why it is not a bug ───────────────────────
//
// Meta gates `ads_read` behind App Review. Until this app has Advanced Access
// for it, the consent screen only grants the permission to people with a role
// on the Meta app itself (admin, developer, tester). Everybody else authorises
// successfully and then gets an empty ad-account list or a permission error on
// the first read. That is Meta's gate, not a fault here, and it is reported in
// those words so a coach is not left thinking Repple is broken.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
// Failures come back as HTTP 200 with an `error` field, the same as
// wearable-oauth: a non-2xx makes supabase-js null out `data` and the reason —
// which is the only actionable part — is lost on the way to the screen.
const fail = (msg: string) => json({ ok: false, error: msg });

// Pinned. Meta deprecates a version roughly every two years and an unpinned
// call changes behaviour on Meta's schedule rather than on a deploy.
const GRAPH = 'https://graph.facebook.com/v21.0';

/** Meta reports failure in the body as often as in the status. Read both. */
async function graph(url: string): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url);
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
    // "connection failed" sends them to neither.
    const detail = [e.message, e.error_user_msg].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, body };
}

/** The ad accounts a token can see, stripped to what is safe to show. */
async function adAccountsOn(token: string) {
  const r = await graph(`${GRAPH}/me/adaccounts?fields=id,account_id,name,currency,account_status&limit=100&access_token=${encodeURIComponent(token)}`);
  if (!r.ok) return r;
  const rows = Array.isArray(r.body?.data) ? r.body.data : [];
  return {
    ok: true as const,
    body: rows.map((a: any) => ({
      id: String(a?.id || ''),
      name: String(a?.name || '').trim(),
      // Meta's own field. Not defaulted to anything — an ad account with no
      // stated currency is one whose spend cannot be compared with revenue, and
      // part 100 refuses to store a figure without one.
      currency: a?.currency ? String(a.currency).toUpperCase() : null,
      // 1 is ACTIVE. Anything else still belongs to them and may hold history,
      // so it is listed rather than hidden, with the state shown.
      active: Number(a?.account_status) === 1,
    })).filter((a: any) => a.id),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const clientId = Deno.env.get('META_ADS_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('META_ADS_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) {
    return fail('Ad-account connection is not configured on the server yet — the owner sets META_ADS_CLIENT_ID and META_ADS_CLIENT_SECRET as Supabase secrets.');
  }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Who is asking, from their JWT alone. Never from the body: a trainer id in a
  // request body is a request to connect somebody else's ad account to your own
  // coaching profile, and the token would then be spent reading their business.
  let trainerId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    trainerId = data?.user?.id || '';
  } catch { /* falls through to the check below */ }
  if (!trainerId) return json({ ok: false, error: 'Sign in to Repple and try connecting again.' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return fail('bad json'); }
  const action = String(body.action || 'connect');
  const provider = 'meta';

  /* ── choose: attach one of the token's ad accounts to the connection ──── */
  if (action === 'choose') {
    const wanted = String(body.account_id || '').trim();
    if (!wanted) return fail('No ad account was chosen.');

    // no-error-ok: a missing row and a failed read are handled identically on
    // the next line — either way there is no token to verify against, and the
    // coach is told to connect again rather than shown a half-made connection.
    const { data: row } = await service
      .from('coach_ad_accounts')
      .select('access_token')
      .eq('trainer_id', trainerId).eq('provider', provider).maybeSingle();
    const token = String(row?.access_token || '');
    if (!token) return fail('That connection is no longer there. Connect your ad account again.');

    // Verified against Meta rather than trusted from the body. Without this a
    // coach could name any ad account id and Repple would try to read it every
    // sync, reporting a stranger's spend or a permanent permission error.
    const accounts = await adAccountsOn(token);
    if (!accounts.ok) return fail(`Meta refused the account list: ${accounts.error}`);
    const chosen = (accounts.body as any[]).find((a) => a.id === wanted);
    if (!chosen) return fail('That ad account is not one this Meta login can see. Pick one from the list.');

    const { error } = await service.rpc('choose_ad_account', {
      p_trainer_id: trainerId,
      p_provider: provider,
      p_external_account_id: chosen.id,
      p_account_name: chosen.name,
      p_account_currency: chosen.currency,
    });
    if (error) return fail(`The account was verified but not saved: ${error.message}`);
    return json({ ok: true, account: chosen });
  }

  /* ── connect: code → long-lived token → stored ────────────────────────── */
  if (action !== 'connect') return fail('unknown action');

  const code = String(body.code || '');
  const redirectUri = String(body.redirect_uri || '');
  if (!code || !redirectUri) return fail('The sign-in did not come back with a code. Tap Connect again.');

  // 1. The consent code, which is single-use and short-lived.
  const short = await graph(
    `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&client_secret=${encodeURIComponent(clientSecret)}`
    + `&code=${encodeURIComponent(code)}`,
  );
  if (!short.ok) {
    // The two failures worth naming, because their remedies are different and
    // neither is "try again": a used or stale code needs a fresh sign-in, and a
    // redirect mismatch needs fixing in the Meta app settings.
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

  // 2. Trade it for the ~60-day token. A short-lived token expires in about an
  // hour, which would mean a connection that works on the day it is made and
  // silently stops before the coach next looks — the exact failure the WHOOP
  // `offline` scope note in src/lib/wearables/oauthConfig.ts describes.
  const long = await graph(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&client_secret=${encodeURIComponent(clientSecret)}`
    + `&fb_exchange_token=${encodeURIComponent(shortToken)}`,
  );
  // A failure here is not fatal to connecting, but it IS a connection that will
  // die within the hour, so the coach is told rather than left to discover it.
  const token = long.ok ? String(long.body?.access_token || shortToken) : shortToken;
  const expiresIn = long.ok ? Number(long.body?.expires_in) : Number(short.body?.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  // 3. What Meta actually granted, which is not always what was asked for.
  //    Recorded so a later "permission denied" can name the missing permission
  //    instead of leaving the coach to guess between six causes.
  let scopes = '';
  const perms = await graph(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`);
  if (perms.ok) {
    scopes = (Array.isArray(perms.body?.data) ? perms.body.data : [])
      .filter((p: any) => p?.status === 'granted')
      .map((p: any) => String(p?.permission || ''))
      .filter(Boolean).join(',');
  }

  // 4. The accounts this login can see. Asked for BEFORE storing, so an App
  //    Review gate is reported as itself rather than as a connection that
  //    exists and never syncs.
  const accounts = await adAccountsOn(token);

  const { error: storeErr } = await service.rpc('store_ad_account', {
    p_trainer_id: trainerId,
    p_provider: provider,
    p_external_account_id: null,
    p_account_name: null,
    p_account_currency: null,
    p_access_token: token,
    p_refresh_token: null, // Meta has no refresh token; the long-lived one is re-exchanged.
    p_expires_at: expiresAt,
    p_scopes: scopes || null,
  });
  if (storeErr) return fail(`Meta signed you in but the connection could not be saved: ${storeErr.message}`);

  if (!accounts.ok) {
    return json({
      ok: true,
      connected: true,
      accounts: [],
      // Named, not flattened. `ads_read` missing here is App Review, and no
      // amount of reconnecting fixes it.
      warning: /permission/i.test(accounts.error)
        ? `Meta signed you in but would not list your ad accounts: ${accounts.error}. Reading ad spend needs the ads_read permission, which Meta only grants an app after App Review — until Repple has that, this works only for accounts with a role on the Repple Meta app.`
        : `Meta signed you in but would not list your ad accounts: ${accounts.error}`,
      longLived: long.ok,
    });
  }

  const list = accounts.body as any[];

  // Exactly one account is not a choice, so it is not put to the coach as one.
  if (list.length === 1) {
    const { error } = await service.rpc('choose_ad_account', {
      p_trainer_id: trainerId,
      p_provider: provider,
      p_external_account_id: list[0].id,
      p_account_name: list[0].name,
      p_account_currency: list[0].currency,
    });
    if (error) return json({ ok: true, connected: true, accounts: list, warning: `Your ad account could not be attached: ${error.message}` });
    return json({ ok: true, connected: true, chosen: list[0], accounts: list, longLived: long.ok });
  }

  return json({
    ok: true,
    connected: true,
    accounts: list,
    // Zero accounts under a successful list is a real answer — this login has
    // none — and it is worded as that rather than as a failure.
    warning: list.length === 0
      ? 'Meta signed you in, but this login has no ad accounts on it. If your ads run under a Business Manager, connect with the login that has access to it.'
      : undefined,
    longLived: long.ok,
  });
});
