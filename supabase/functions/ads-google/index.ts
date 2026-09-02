// ads-google — connecting a Google Ads account, and reading what it cost.
//
// Meta's two functions (ads-oauth, ads-sync) stay exactly as they are. This is
// one function for the whole of Google because the three things a coach does —
// sign in, say which account, check the spend — are three actions on one set of
// credentials, and splitting them across two deployments doubled the number of
// places the Graph version and the token rules had to agree in.
//
// ── The rule this function keeps, unchanged from part 100 ────────────────
//
// The app never sees a token. Not the access token, not the refresh token, not
// for a moment while a picker is open. GOOGLE_ADS_CLIENT_SECRET and
// GOOGLE_ADS_DEVELOPER_TOKEN are Supabase secrets read only here; the client id
// is public by design because it is in the consent URL the coach's own browser
// opens. supabase/functions/ocr-scan/index.ts is the write-up of what happens
// otherwise — a key inlined into the bundle and shipped readable to anyone who
// unpacked the app — and a Google Ads refresh token is a long way worse than an
// OCR key, because it never expires on its own and it reads an account that
// spends money.
//
// ── Three credentials, not two, and the third is the one that stalls ─────
//
// Meta needs an app id and a secret. Google needs those AND a developer token,
// which is a separate thing issued by Google against a Google Ads MANAGER
// account and approved separately:
//
//   · a token with Test Access reads test accounts only. A live account answers
//     with a permission error that reads exactly like a missing OAuth scope and
//     is not one.
//   · Basic Access is applied for through the Google Ads UI and is what this
//     needs. It is not the same approval as Meta's App Review, it is not
//     blocked by it, and it is not granted by it.
//
// A missing or unapproved developer token is reported in those words rather
// than as "Google refused", because the remedy is an application form and no
// amount of reconnecting will do it.
//
// ── The version is pinned, and pinned where it can be changed ────────────
//
// Google sunsets a major API version roughly a year after it ships and returns
// 404 for one that is gone — a working integration simply stops on a date
// chosen by Google. So the version is a secret with a default rather than a
// literal: the owner moves GOOGLE_ADS_API_VERSION forward without a deploy, and
// a coach gets an error naming the version rather than "not found".
//
// ── Money ────────────────────────────────────────────────────────────────
//
// `metrics.cost_micros` is millionths of the account's base currency unit.
// src/lib/adChannels.ts converts it, once, and says at length why the result is
// hundredths-of-major for every currency including the ones with no minor unit
// and the ones with three. Nothing in this file divides anything.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { matchAds, urlsFromCreative, type AdInsight } from '../../../src/lib/adMatch.ts';
import { majorFromMicros } from '../../../src/lib/adChannels.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
// Failures come back as HTTP 200 with an `error` field, the same as ads-oauth
// and wearable-oauth: a non-2xx makes supabase-js null out `data`, and the
// reason — which is the only actionable part — is lost on the way to the screen.
const fail = (msg: string) => json({ ok: false, error: msg });

const PROVIDER = 'google';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://googleads.googleapis.com';
// v25 shipped July 2026 and sunsets around August 2027. Overridable, see header.
const VERSION = Deno.env.get('GOOGLE_ADS_API_VERSION') || 'v25';

/**
 * The window, and why it is the whole of it.
 *
 * my_code_returns() sums EVERY purchase a code's clients have ever made, so the
 * spend put beside it has to cover the same span. Meta has `date_preset=maximum`
 * for this; Google has no such preset and refuses a metrics query with no date
 * range at all, so the range is stated: from before Google Ads existed to today.
 * Thirty days of spend against lifetime revenue is a ratio of two different
 * things and flatters every campaign that has run longer than a month.
 */
const LIFETIME_FROM = '2000-01-01';
const today = () => new Date().toISOString().slice(0, 10);

type Res<T> = { ok: true; body: T } | { ok: false; error: string };

/** One call, with Google's error body read rather than only its status. */
async function call<T>(url: string, init: RequestInit): Promise<Res<T>> {
  let res: Response;
  try { res = await fetch(url, init); } catch { return { ok: false, error: 'Google could not be reached.' }; }
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: { message: text.slice(0, 300) } }; }
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    // Google's own words. "Developer token is not approved" and "invalid_grant"
    // send a coach to two entirely different remedies, and a flattened
    // "connection failed" sends them to neither.
    const detail = [
      e.message,
      e.status,
      body?.error_description,
      Array.isArray(e.details) ? e.details.map((d: any) => d?.errors?.map((x: any) => x?.message).join('; ')).filter(Boolean).join('; ') : '',
    ].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    if (res.status === 404 && /v\d+/.test(url)) {
      return { ok: false, error: `${detail}. This build asks for Google Ads API ${VERSION}, which Google may have sunset — the owner sets GOOGLE_ADS_API_VERSION to the current one.` };
    }
    return { ok: false, error: detail };
  }
  return { ok: true, body: body as T };
}

/** A permission error whose real cause is the developer token, said as itself. */
function developerTokenNote(error: string): string | null {
  if (/DEVELOPER_TOKEN_NOT_APPROVED|developer token/i.test(error)) {
    return `Google refused the read: ${error}. A Google Ads developer token starts with Test Access, which reads test accounts only; reading a live account needs Basic Access, applied for separately in the Google Ads interface. Reconnecting will not change it.`;
  }
  return null;
}

/** Form-encoded, because Google's token endpoint takes nothing else. */
function form(pairs: Record<string, string>): string {
  return Object.entries(pairs).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** A fresh access token from the stored refresh token. */
async function accessTokenFrom(refresh: string, clientId: string, clientSecret: string): Promise<Res<{ access_token: string; expires_in?: number }>> {
  return await call(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ refresh_token: refresh, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
  });
}

/** One GAQL query, all pages. A page that fails aborts the whole read rather
 *  than returning what it has: a partial total filed as a total is the failure
 *  this feature exists to prevent, and graphAll in ads-sync says the same. */
async function search(customerId: string, loginCustomerId: string | null, token: string, devToken: string, query: string, cap = 40): Promise<Res<any[]>> {
  const rows: any[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < cap; page++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };
    // Omitted rather than sent empty for an account the login owns directly —
    // an empty login-customer-id is refused, and a wrong one is refused with a
    // permissions message that reads like an approval problem.
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
    const r = await call<{ results?: any[]; nextPageToken?: string }>(
      `${API}/${VERSION}/customers/${encodeURIComponent(customerId)}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query, pageSize: 10000, ...(pageToken ? { pageToken } : {}) }) },
    );
    if (!r.ok) return r;
    if (Array.isArray(r.body?.results)) rows.push(...r.body.results);
    pageToken = r.body?.nextPageToken ? String(r.body.nextPageToken) : null;
    if (!pageToken) return { ok: true, body: rows };
  }
  return { ok: false, error: 'This Google Ads account has more ads than one check can read. Nothing was recorded rather than a part of it.' };
}

type Acct = { id: string; name: string; currency: string | null; active: boolean; manager: string | null };

/**
 * Every ad account this login can actually spend from.
 *
 * Two hops, because Google's list is not a list of ad accounts. It is a list of
 * accounts the login can act on, and for most agencies and most coaches with a
 * bookkeeper that is a MANAGER account, which holds no ads and no spend of its
 * own. Stopping at the first hop would show the coach a single account that
 * always reads zero.
 *
 * So each accessible customer is asked for its own client list, which for a
 * plain account is a list containing itself. Managers are dropped from what is
 * offered — there is nothing to read on one — and the manager's id is carried
 * on the child, because every later call has to name it.
 */
async function adAccountsOn(token: string, devToken: string): Promise<Res<Acct[]>> {
  const top = await call<{ resourceNames?: string[] }>(
    `${API}/${VERSION}/customers:listAccessibleCustomers`,
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'developer-token': devToken } },
  );
  if (!top.ok) return top;
  const ids = (top.body?.resourceNames || []).map((n) => String(n).split('/').pop() || '').filter(Boolean);

  const out: Acct[] = [];
  const seen = new Set<string>();
  // Capped. A large agency login can reach thousands of accounts and a coach is
  // choosing ONE — a list past this is a sign the wrong login was used, and the
  // screen says so rather than paging through somebody's whole book.
  for (const id of ids.slice(0, 20)) {
    const r = await search(id, id, token, devToken,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, '
      + 'customer_client.manager, customer_client.status FROM customer_client');
    if (!r.ok) {
      // One unreadable manager does not hide the accounts that did answer, but
      // it is not silently dropped either: if NOTHING answered, the error below
      // is what the coach is told.
      if (!out.length && ids.length === 1) return r;
      continue;
    }
    for (const row of r.body) {
      const c = row?.customerClient || {};
      const cid = String(c?.id || '');
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      if (c?.manager === true) continue;
      out.push({
        id: cid,
        name: String(c?.descriptiveName || '').trim(),
        // Google's own field, never defaulted. An account with no stated
        // currency is one whose spend cannot be compared with revenue, and
        // part 100 refuses to store a figure without one.
        currency: c?.currencyCode ? String(c.currencyCode).toUpperCase() : null,
        active: String(c?.status || '') === 'ENABLED',
        manager: cid === id ? null : id,
      });
    }
  }
  return { ok: true, body: out };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const clientId = Deno.env.get('GOOGLE_ADS_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') || '';
  const devToken = Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '';
  if (!clientId || !clientSecret || !devToken) {
    return fail('Connecting a Google Ads account is not configured on the server yet — the owner sets GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_DEVELOPER_TOKEN as Supabase secrets. The developer token is issued against a Google Ads manager account and has to be approved for Basic Access before it reads a live account.');
  }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Who is asking, from their JWT alone. Never from the body: a trainer id in a
  // request body is a request to connect somebody else's ad account to your own
  // coaching profile, and the token would then be spent reading their business.
  let trainerId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    trainerId = data?.user?.id || '';
  } catch { /* handled below */ }
  if (!trainerId) return json({ ok: false, error: 'Sign in to Repple and try again.' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return fail('bad json'); }
  const action = String(body.action || 'connect');

  /* ── connect ──────────────────────────────────────────────────────────── */

  if (action === 'connect') {
    const code = String(body.code || '');
    const redirectUri = String(body.redirect_uri || '');
    if (!code || !redirectUri) return fail('The sign-in did not come back with a code. Tap Connect again.');

    const tok = await call<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tok.ok) {
      if (/invalid_grant/i.test(tok.error)) {
        return fail(`Google would not accept that sign-in code (${tok.error}). A code is single-use and short-lived — tap Connect again to start a fresh sign-in.`);
      }
      if (/redirect_uri/i.test(tok.error)) {
        return fail(`Google rejected the redirect address (${tok.error}). It has to be listed as an Authorised redirect URI on the OAuth client in the Google Cloud console.`);
      }
      return fail(`Google refused the sign-in: ${tok.error}`);
    }
    const access = String(tok.body?.access_token || '');
    const refresh = String(tok.body?.refresh_token || '');
    if (!access) return fail('Google accepted the sign-in but returned no token.');
    // The one that matters. An access token lasts an hour; without a refresh
    // token this connection works this afternoon and silently stops before the
    // coach next looks — which is the failure the WHOOP `offline` note in
    // src/lib/wearables/oauthConfig.ts describes. Google only issues one when
    // the consent URL carries access_type=offline AND prompt=consent, and it
    // does not issue a second for an account that has already granted it.
    if (!refresh) {
      return fail('Google signed you in but did not issue a token that lasts. This happens when the Google account has connected Repple before: remove Repple at myaccount.google.com under Data and privacy, then connect again.');
    }

    const accounts = await adAccountsOn(access, devToken);

    const { error: storeErr } = await service.rpc('store_ad_account', {
      p_trainer_id: trainerId,
      p_provider: PROVIDER,
      p_external_account_id: null,
      p_account_name: null,
      p_account_currency: null,
      p_access_token: access,
      p_refresh_token: refresh,
      p_expires_at: Number.isFinite(Number(tok.body?.expires_in)) && Number(tok.body?.expires_in) > 0
        ? new Date(Date.now() + Number(tok.body!.expires_in) * 1000).toISOString()
        : null,
      p_scopes: tok.body?.scope ? String(tok.body.scope) : null,
    });
    if (storeErr) return fail(`Google signed you in but the connection could not be saved: ${storeErr.message}`);

    if (!accounts.ok) {
      return json({
        ok: true, connected: true, accounts: [],
        warning: developerTokenNote(accounts.error) || `Google signed you in but would not list your ad accounts: ${accounts.error}`,
      });
    }

    const list = accounts.body;
    // Exactly one account is not a choice, so it is not put to the coach as one.
    if (list.length === 1) {
      const saved = await attach(service, trainerId, list[0]);
      if (saved) return json({ ok: true, connected: true, accounts: list, warning: saved });
      return json({ ok: true, connected: true, chosen: list[0], accounts: list });
    }
    return json({
      ok: true, connected: true, accounts: list,
      warning: list.length === 0
        ? 'Google signed you in, but this login can reach no ad account that holds ads. If your ads run under a manager account, connect with the login that has access to it.'
        : undefined,
    });
  }

  /* ── choose ───────────────────────────────────────────────────────────── */

  if (action === 'choose') {
    const wanted = String(body.account_id || '').trim();
    if (!wanted) return fail('No ad account was chosen.');

    const conn = await connection(service, trainerId);
    if (!conn.ok) return fail(conn.error);

    const fresh = await accessTokenFrom(conn.body.refresh, clientId, clientSecret);
    if (!fresh.ok) return fail(`Google would not renew the connection: ${fresh.error}. Connect your Google Ads account again.`);

    // Verified against Google rather than trusted from the body. Without this a
    // coach could name any customer id and Repple would try to read it every
    // check, reporting a stranger's spend or a permanent permission error.
    const accounts = await adAccountsOn(String(fresh.body.access_token), devToken);
    if (!accounts.ok) return fail(developerTokenNote(accounts.error) || `Google refused the account list: ${accounts.error}`);
    const chosen = accounts.body.find((a) => a.id === wanted);
    if (!chosen) return fail('That ad account is not one this Google login can reach. Pick one from the list.');

    const saved = await attach(service, trainerId, chosen);
    if (saved) return fail(saved);
    return json({ ok: true, account: chosen });
  }

  /* ── sync ─────────────────────────────────────────────────────────────── */

  if (action !== 'sync') return fail('unknown action');

  /** Record the attempt, whole, and answer the app. */
  const record = async (
    status: 'ok' | 'failed', failure: string | null, currency: string | null,
    windowFrom: string | null, windowTo: string | null, adsSeen: number | null,
    matched: unknown[], unmatched: unknown[],
  ) => {
    const { error } = await service.rpc('record_ad_sync', {
      p_trainer_id: trainerId, p_provider: PROVIDER, p_status: status, p_failure: failure,
      p_from: windowFrom, p_to: windowTo, p_currency: currency, p_ads_seen: adsSeen,
      p_matched: matched, p_unmatched: unmatched,
    });
    // A run that happened and was not recorded is worse than one that did not
    // happen: the screen would keep showing the previous check's date as if
    // nothing had been tried since.
    if (error) return fail(`The check ran but could not be recorded: ${error.message}`);
    return status === 'ok'
      ? json({ ok: true, matched: matched.length, unmatched: unmatched.length, currency })
      : json({ ok: false, error: failure, recorded: true });
  };

  const conn = await connection(service, trainerId);
  // Not recorded as a failed run: nothing was attempted, and a run row here
  // would put "check failed" in a coach's history for never having connected.
  if (!conn.ok) return fail(conn.error);
  if (!conn.body.customerId) return fail('Your Google login is connected but no ad account has been chosen yet.');

  const fresh = await accessTokenFrom(conn.body.refresh, clientId, clientSecret);
  if (!fresh.ok) {
    return record('failed', `Google would not renew the connection: ${fresh.error}. Connect your Google Ads account again from this screen.`, null, null, null, null, [], []);
  }
  const access = String(fresh.body.access_token || '');

  const from = LIFETIME_FROM;
  const to = today();
  const rowsRes = await search(conn.body.customerId, conn.body.manager, access, devToken,
    'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls, '
    + 'ad_group_ad.ad.final_mobile_urls, ad_group_ad.ad.tracking_url_template, '
    + 'metrics.cost_micros, customer.currency_code '
    + `FROM ad_group_ad WHERE segments.date BETWEEN '${from}' AND '${to}'`);
  if (!rowsRes.ok) {
    return record('failed', developerTokenNote(rowsRes.error) || `Google refused to report your ad spend: ${rowsRes.error}`,
      null, from, to, null, [], []);
  }

  // One row per ad per query, already aggregated over the window because
  // segments.date is filtered and not selected. Where Google does return an ad
  // twice, the two rows are two AdInsights against the same code and add — the
  // matcher sums per code, so nothing is lost and nothing is double-counted
  // that Google did not itself report twice.
  const ads: AdInsight[] = rowsRes.body.map((r: any) => {
    const ad = r?.adGroupAd?.ad || {};
    return {
      adId: String(ad?.id || ''),
      adName: String(ad?.name || '').trim(),
      // Handed to the matcher in MAJOR units, which is the one shape it takes
      // from every channel. majorFromMicros moves the point six places and does
      // nothing else; what a hundredth is stays adMatch's single decision.
      spend: majorFromMicros(r?.metrics?.costMicros),
      currency: r?.customer?.currencyCode ?? null,
      // final_urls is an array, final_mobile_urls another, and a tracking
      // template a string with {lpurl} in it. urlsFromCreative walks whatever
      // shape it is handed and keeps every http(s) string, so a Google ad type
      // that puts its destination somewhere new is still read.
      urls: urlsFromCreative({
        finalUrls: ad?.finalUrls, finalMobileUrls: ad?.finalMobileUrls, tracking: ad?.trackingUrlTemplate,
      }),
    };
  });

  const codes = await coachCodes(service, trainerId);
  if (!codes.ok) return record('failed', codes.error, null, from, to, null, [], []);

  const result = matchAds(ads, codes.body);

  if (result.currencyConflict) {
    return record('failed', 'This Google Ads account reported spend in more than one currency. Adding those together would not be an amount of money, so nothing was recorded.', null, from, to, result.adsSeen, [], []);
  }
  if (!result.currency && result.adsSeen > 0) {
    return record('failed', 'Google did not say which currency this ad account bills in, and a spend figure with no currency cannot be compared with what your clients pay. Nothing was recorded.', null, from, to, result.adsSeen, [], []);
  }

  return record('ok', null, result.currency, from, to, result.adsSeen,
    result.matched.map((m) => ({ code_id: m.codeId, code: m.code, cents: m.cents, ads: m.ads })),
    result.unmatched.map((u) => ({ ad_id: u.adId, ad_name: u.adName, url: u.url, cents: u.cents, reason: u.reason })));
});

/* ── the small shared pieces ────────────────────────────────────────────── */

/** The stored connection, without ever handing a token further than this file. */
async function connection(service: any, trainerId: string): Promise<Res<{ refresh: string; customerId: string; manager: string | null }>> {
  // no-error-ok: a failed read and a missing row lead to the same sentence —
  // there is no usable connection either way, and the remedy the coach is given
  // (connect the account) is correct for both.
  const { data } = await service
    .from('coach_ad_accounts')
    .select('refresh_token, external_account_id, manager_account_id')
    .eq('trainer_id', trainerId).eq('provider', PROVIDER).maybeSingle();
  const refresh = String(data?.refresh_token || '');
  if (!refresh) return { ok: false, error: 'No Google Ads account is connected yet.' };
  return {
    ok: true,
    body: {
      refresh,
      customerId: String(data?.external_account_id || ''),
      manager: data?.manager_account_id ? String(data.manager_account_id) : null,
    },
  };
}

/** Save the chosen account, and the manager it is reached through. Returns a
 *  sentence on failure and nothing on success. */
async function attach(service: any, trainerId: string, a: Acct): Promise<string | null> {
  const { error } = await service.rpc('choose_ad_account', {
    p_trainer_id: trainerId,
    p_provider: PROVIDER,
    p_external_account_id: a.id,
    p_account_name: a.name,
    p_account_currency: a.currency,
  });
  if (error) return `That ad account was verified but not saved: ${error.message}`;
  // Separate from choose_ad_account() because only Google has a manager, and
  // widening a function every other provider calls to carry a field only one of
  // them uses is how the field comes to be set wrongly by the other two.
  const { error: mErr } = await service
    .from('coach_ad_accounts')
    .update({ manager_account_id: a.manager })
    .eq('trainer_id', trainerId).eq('provider', PROVIDER);
  if (mErr) return `That ad account was saved but the manager account it sits under was not (${mErr.message}), so the next check will be refused. Choose it again.`;
  return null;
}

/** The coach's own codes, named and default — the list an ad is matched to. */
async function coachCodes(service: any, trainerId: string): Promise<Res<{ id: string | null; code: string; label: string }[]>> {
  const { data: named, error: namedErr } = await service
    .from('coach_join_codes').select('id, code, label').eq('trainer_id', trainerId);
  if (namedErr) return { ok: false, error: `Your join codes could not be read, so no spend was filed against them: ${namedErr.message}` };
  const { data: me, error: meErr } = await service
    .from('trainers').select('join_code').eq('id', trainerId).maybeSingle();
  if (meErr) return { ok: false, error: `Your main code could not be read, so no spend was filed against it: ${meErr.message}` };
  return {
    ok: true,
    body: [
      ...(named ?? []).map((c: any) => ({ id: String(c.id), code: String(c.code || ''), label: String(c.label || c.code || '') })),
      // Null id is the default code, keyed exactly as coach_code_spend keys it.
      ...(me?.join_code ? [{ id: null, code: String(me.join_code), label: 'Your main code' }] : []),
    ],
  };
}
