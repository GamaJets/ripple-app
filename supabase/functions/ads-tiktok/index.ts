// ads-tiktok — connecting a TikTok ad account, and reading what it cost.
//
// The sibling of ads-google, in the same shape and for the same reason: sign
// in, say which advertiser, check the spend, all on one set of credentials.
// Meta's ads-oauth and ads-sync are untouched.
//
// ── The rule this function keeps, unchanged from part 100 ────────────────
//
// The app never sees a token. TIKTOK_ADS_APP_SECRET is a Supabase secret read
// only here; the app id is public by design because it is in the authorisation
// URL the coach's own browser opens. supabase/functions/ocr-scan/index.ts is
// the write-up of what happens otherwise.
//
// TikTok's access token is worse than Meta's to leak, not better: it is issued
// without an expiry. There is no sixty-day clock quietly closing the window on
// a token that got out, so the only thing standing between a leaked token and a
// business's ad account is somebody noticing and revoking it by hand.
//
// ── What TikTok calls things ─────────────────────────────────────────────
//
//   advertiser   what Meta calls an ad account and Google calls a customer.
//                A TikTok login can carry several; which one a coach's spend
//                comes from is their decision, never ours.
//   auth_code    the single-use code the authorisation page comes back with.
//   Access-Token a HEADER, not a query parameter and not a bearer token. Sent
//                as `Access-Token: <token>` on every call.
//
// ── Failure is in the body, at HTTP 200 ─────────────────────────────────
//
// TikTok answers almost everything with 200 and puts the real answer in a
// `code` field, where 0 means success. A reader that checks `res.ok` and stops
// reads every refusal as a success carrying no data, which here would be a
// coach's ad spend reported as an account with no ads in it — the one thing
// part 100 says must never be confused with a failure. So `code` is read first.
//
// ── Money ────────────────────────────────────────────────────────────────
//
// `spend` is documented as the estimated total spent IN THE ADVERTISER'S
// CURRENCY — a decimal string in major units, exactly the shape Meta reports.
// It therefore goes through the same adMatch.centsFromAmount as Meta's, with no
// conversion of its own; src/lib/adChannels.ts holds the reasoning and the test
// pins it, so a future change to one channel's units cannot be made quietly.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { matchAds, urlsFromCreative, type AdInsight } from '../../../src/lib/adMatch.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (msg: string) => json({ ok: false, error: msg });

const PROVIDER = 'tiktok';
// Pinned, the same as Meta's Graph version and Google's. An unpinned call
// changes behaviour on the provider's schedule rather than on a deploy.
const API = 'https://business-api.tiktok.com/open_api/v1.3';
const PAGE = 1000;

type Res<T> = { ok: true; body: T } | { ok: false; error: string };

/** One call. `code` is read before anything else — see the header. */
async function tt<T>(url: string, init: RequestInit): Promise<Res<T>> {
  let res: Response;
  try { res = await fetch(url, init); } catch { return { ok: false, error: 'TikTok could not be reached.' }; }
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
  const code = Number(body?.code);
  if (!res.ok || (Number.isFinite(code) && code !== 0)) {
    // TikTok's own words. "Permission denied" and "Access token is invalid"
    // send a coach to two different remedies, and a flattened "check failed"
    // sends them to neither.
    const detail = [body?.message, Number.isFinite(code) ? `code ${code}` : ''].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, body: (body?.data ?? {}) as T };
}

/** A GET with the token in the header and TikTok's JSON-in-a-query-parameter
 *  convention honoured: list arguments are sent as JSON text, not repeated. */
function get<T>(path: string, token: string, params: Record<string, string | number | boolean | string[]>): Promise<Res<T>> {
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? JSON.stringify(v) : String(v))}`)
    .join('&');
  return tt<T>(`${API}${path}?${q}`, { method: 'GET', headers: { 'Access-Token': token } });
}

type Acct = { id: string; name: string; currency: string | null; active: boolean };

/**
 * The advertisers this token can see, stripped to what is safe to show.
 *
 * The ids come back on the token exchange itself; the names and currencies need
 * a second call, and that call is the first thing a missing permission refuses.
 * A refusal here is reported as itself rather than as an empty list, because an
 * empty list means "this login has no ad accounts" and that is a different
 * sentence with a different remedy.
 */
async function advertisers(token: string, ids: string[]): Promise<Res<Acct[]>> {
  if (!ids.length) return { ok: true, body: [] };
  const out: Acct[] = [];
  // Capped per call by TikTok; a coach is choosing one, and a login reaching
  // more than this is a sign the wrong login was used.
  for (let i = 0; i < ids.length && i < 100; i += 50) {
    const r = await get<{ list?: any[] }>('/advertiser/info/', token, {
      advertiser_ids: ids.slice(i, i + 50),
      fields: ['advertiser_id', 'advertiser_name', 'name', 'currency', 'status'],
    });
    if (!r.ok) return r;
    for (const a of r.body?.list || []) {
      const id = String(a?.advertiser_id || '');
      if (!id) continue;
      out.push({
        id,
        name: String(a?.advertiser_name || a?.name || '').trim(),
        // TikTok's own field, never defaulted. An advertiser with no stated
        // currency is one whose spend cannot be compared with revenue, and
        // part 100 refuses to store a figure without one.
        currency: a?.currency ? String(a.currency).toUpperCase() : null,
        active: String(a?.status || '').toUpperCase().includes('ENABLE'),
      });
    }
  }
  return { ok: true, body: out };
}

/**
 * The advertisers this ACCESS TOKEN is authorised for, asked of TikTok.
 *
 * ── why this exists, when `advertisers()` is right there ─────────────────
 *
 * Because they answer two different questions, and `choose` was asking the
 * wrong one.
 *
 * Meta and Google both verify a chosen account the same way: fetch the list the
 * login can REACH and look for the id in it (`/me/adaccounts` in ads-oauth,
 * `listAccessibleCustomers` in ads-google). TikTok's `choose` instead called
 * `/advertiser/info/` with the id the coach had just named, which asks TikTok
 * to DESCRIBE that advertiser rather than to say whether this login may have
 * it. Whether that is also an authorisation check depends on behaviour TikTok
 * documents nowhere, and "probably scoped" is not a sentence to leave standing
 * in the one place a coach names an id from a request body.
 *
 * `/oauth2/advertiser/get/` is TikTok's own answer to the question actually
 * being asked. It is the same list the token exchange returns in
 * `advertiser_ids`, which is why it is trustworthy and why `connect` needs no
 * second call — that path already has it.
 *
 * It is the one endpoint here that does NOT take `Access-Token` as a header:
 * app id, secret and token all go in the query string, because it is an
 * authorisation endpoint rather than an Ads API one. Nothing logs the URL.
 */
async function reachableAdvertiserIds(token: string, appId: string, secret: string): Promise<Res<string[]>> {
  const q = `app_id=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`
    + `&access_token=${encodeURIComponent(token)}`;
  const r = await tt<{ list?: unknown[] }>(`${API}/oauth2/advertiser/get/?${q}`, { method: 'GET' });
  if (!r.ok) return r;
  const ids = (Array.isArray(r.body?.list) ? r.body.list : [])
    .map((a) => String((a as { advertiser_id?: unknown })?.advertiser_id ?? ''))
    .filter(Boolean);
  return { ok: true, body: ids };
}

/** Every page of a TikTok list endpoint. A page that fails aborts the whole
 *  read: a partial total filed as a total is the failure this feature exists
 *  to prevent. */
async function allPages<T>(path: string, token: string, params: Record<string, string | number | boolean | string[]>, cap = 40): Promise<Res<T[]>> {
  const rows: T[] = [];
  for (let page = 1; page <= cap; page++) {
    const r = await get<{ list?: T[]; page_info?: { total_page?: number } }>(path, token, { ...params, page, page_size: PAGE });
    if (!r.ok) return r;
    if (Array.isArray(r.body?.list)) rows.push(...r.body.list);
    const total = Number(r.body?.page_info?.total_page);
    if (!Number.isFinite(total) || page >= total) return { ok: true, body: rows };
  }
  return { ok: false, error: 'This TikTok account has more ads than one check can read. Nothing was recorded rather than a part of it.' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const appId = Deno.env.get('TIKTOK_ADS_APP_ID') || '';
  const secret = Deno.env.get('TIKTOK_ADS_APP_SECRET') || '';
  if (!appId || !secret) {
    return fail('Connecting a TikTok ad account is not configured on the server yet — the owner sets TIKTOK_ADS_APP_ID and TIKTOK_ADS_APP_SECRET as Supabase secrets, from an app created in the TikTok for Business developer portal.');
  }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Who is asking, from their JWT alone. Never from the body: a trainer id in a
  // request body is a request to connect somebody else's ad account to your own
  // coaching profile.
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
    if (!code) return fail('The sign-in did not come back with a code. Tap Connect again.');

    const tok = await tt<{ access_token?: string; advertiser_ids?: string[]; scope?: unknown }>(
      `${API}/oauth2/access_token/`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, secret, auth_code: code }) },
    );
    if (!tok.ok) {
      if (/auth_code|expired|used/i.test(tok.error)) {
        return fail(`TikTok would not accept that sign-in code (${tok.error}). A code is single-use and short-lived — tap Connect again to start a fresh sign-in.`);
      }
      return fail(`TikTok refused the sign-in: ${tok.error}`);
    }
    const token = String(tok.body?.access_token || '');
    if (!token) return fail('TikTok accepted the sign-in but returned no token.');
    const ids = (tok.body?.advertiser_ids || []).map((x) => String(x)).filter(Boolean);

    const accounts = await advertisers(token, ids);

    const { error: storeErr } = await service.rpc('store_ad_account', {
      p_trainer_id: trainerId,
      p_provider: PROVIDER,
      p_external_account_id: null,
      p_account_name: null,
      p_account_currency: null,
      p_access_token: token,
      p_refresh_token: null,
      // TikTok issues a long-lived token with no stated expiry. Null is the
      // honest record of that; my_ad_channels() reports expires_soon false for
      // it rather than inventing a date the screen would count down to.
      p_expires_at: null,
      p_scopes: Array.isArray(tok.body?.scope) ? (tok.body!.scope as unknown[]).map((s) => String(s)).join(',') : null,
    });
    if (storeErr) return fail(`TikTok signed you in but the connection could not be saved: ${storeErr.message}`);

    if (!accounts.ok) {
      return json({
        ok: true, connected: true, accounts: [],
        warning: `TikTok signed you in but would not describe your ad accounts: ${accounts.error}`,
      });
    }

    const list = accounts.body;
    if (list.length === 1) {
      const saved = await attach(service, trainerId, list[0]);
      if (saved) return json({ ok: true, connected: true, accounts: list, warning: saved });
      return json({ ok: true, connected: true, chosen: list[0], accounts: list });
    }
    return json({
      ok: true, connected: true, accounts: list,
      warning: list.length === 0
        ? 'TikTok signed you in, but this login has no ad account on it. If your ads run under a Business Centre, connect with the login that has access to it.'
        : undefined,
    });
  }

  /* ── choose ───────────────────────────────────────────────────────────── */

  if (action === 'choose') {
    const wanted = String(body.account_id || '').trim();
    if (!wanted) return fail('No ad account was chosen.');

    const conn = await connection(service, trainerId);
    if (!conn.ok) return fail(conn.error);

    // Verified against TikTok rather than trusted from the body. Without this a
    // coach could name any advertiser id and Repple would try to read it every
    // check, reporting a stranger's spend or a permanent permission error.
    //
    // Two calls, in this order, and the order is the point. The first asks
    // TikTok which advertisers this LOGIN may have and looks for the named id
    // in that list — the same intersection ads-oauth and ads-google do, and the
    // check `/advertiser/info/` alone was standing in for. Only then is the
    // advertiser described, because a name and a currency are worth having and
    // are not an authorisation.
    const reachable = await reachableAdvertiserIds(conn.body.token, appId, secret);
    if (!reachable.ok) return fail(`TikTok would not say which ad accounts your login can reach: ${reachable.error}`);
    if (!reachable.body.includes(wanted)) {
      return fail('That ad account is not one this TikTok login can see. Pick one from the list.');
    }

    const one = await advertisers(conn.body.token, [wanted]);
    if (!one.ok) return fail(`TikTok refused to describe that ad account: ${one.error}`);
    const chosen = one.body.find((a) => a.id === wanted);
    if (!chosen) return fail('That ad account is not one this TikTok login can see. Pick one from the list.');

    const saved = await attach(service, trainerId, chosen);
    if (saved) return fail(saved);
    return json({ ok: true, account: chosen });
  }

  /* ── sync ─────────────────────────────────────────────────────────────── */

  if (action !== 'sync') return fail('unknown action');

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
    if (error) return fail(`The check ran but could not be recorded: ${error.message}`);
    return status === 'ok'
      ? json({ ok: true, matched: matched.length, unmatched: unmatched.length, currency })
      : json({ ok: false, error: failure, recorded: true });
  };

  const conn = await connection(service, trainerId);
  if (!conn.ok) return fail(conn.error);
  if (!conn.body.advertiserId) return fail('Your TikTok login is connected but no ad account has been chosen yet.');
  const token = conn.body.token;
  const advertiserId = conn.body.advertiserId;

  /* 1. What each ad cost, over the account's whole life.
   *
   * `query_lifetime` is TikTok's equivalent of Meta's `date_preset=maximum`,
   * and it is used for the same reason: my_code_returns() sums every purchase a
   * code's clients have ever made, and thirty days of spend against lifetime
   * revenue is a ratio of two different things. The window is therefore not
   * reported as a pair of dates — TikTok does not say which days it covered,
   * and inventing a from-date here would be stating something we were not told.
   */
  const report = await allPages<any>('/report/integrated/get/', token, {
    advertiser_id: advertiserId,
    report_type: 'BASIC',
    data_level: 'AUCTION_AD',
    dimensions: ['ad_id'],
    metrics: ['spend', 'ad_name'],
    query_lifetime: true,
  });
  if (!report.ok) {
    const gated = /permission|not authoriz|scope/i.test(report.error);
    return record('failed', gated
      ? `TikTok refused to report your ad spend: ${report.error}. Reading spend needs the Ads Reporting permission on the app the coach authorised — the owner grants it in the TikTok for Business developer portal and the coach then reconnects.`
      : `TikTok refused to report your ad spend: ${report.error}`,
      null, null, null, null, [], []);
  }

  /* 2. Where each ad points. */
  const ads = await allPages<any>('/ad/get/', token, {
    advertiser_id: advertiserId,
    fields: ['ad_id', 'ad_name', 'landing_page_url', 'deeplink', 'page_id', 'tiktok_item_id'],
  });
  if (!ads.ok) {
    // Deliberately a failure, not a check where nothing matched. Without the
    // destinations every ad would read as "no link", and the coach would be
    // shown their whole budget as unattributable and go and edit ads that are
    // fine. ads-sync refuses the same way for the same reason.
    return record('failed', `TikTok reported your spend but not where the ads point (${ads.error}), so nothing could be matched to a code.`, null, null, null, null, [], []);
  }

  const urlsById = new Map<string, string[]>();
  for (const a of ads.body) {
    const id = String(a?.ad_id || '');
    if (id) urlsById.set(id, urlsFromCreative(a));
  }

  /* 3. The advertiser's currency. The report does not carry one, so it is asked
   *    for rather than assumed — a spend figure with no currency cannot be
   *    compared with what the coach's clients paid, and part 100 refuses to
   *    store one without it. */
  const info = await advertisers(token, [advertiserId]);
  const currency = info.ok ? (info.body[0]?.currency ?? null) : null;

  /* 4. Match. */
  const rows: AdInsight[] = report.body.map((r: any) => {
    const id = String(r?.dimensions?.ad_id ?? r?.ad_id ?? '');
    const m = r?.metrics || {};
    return {
      adId: id,
      adName: String(m?.ad_name || '').trim(),
      // A decimal string in the advertiser's own currency, which is exactly
      // what Meta reports and what centsFromAmount takes. No conversion here.
      spend: m?.spend ?? null,
      currency,
      urls: urlsById.get(id) ?? [],
    };
  });

  const codes = await coachCodes(service, trainerId);
  if (!codes.ok) return record('failed', codes.error, null, null, null, null, [], []);

  const result = matchAds(rows, codes.body);

  if (result.currencyConflict) {
    return record('failed', 'This TikTok account reported spend in more than one currency. Adding those together would not be an amount of money, so nothing was recorded.', null, null, null, result.adsSeen, [], []);
  }
  if (!result.currency && result.adsSeen > 0) {
    return record('failed', `TikTok did not say which currency this ad account bills in${info.ok ? '' : ` (${info.error})`}, and a spend figure with no currency cannot be compared with what your clients pay. Nothing was recorded.`, null, null, null, result.adsSeen, [], []);
  }

  return record('ok', null, result.currency, null, null, result.adsSeen,
    result.matched.map((m) => ({ code_id: m.codeId, code: m.code, cents: m.cents, ads: m.ads })),
    result.unmatched.map((u) => ({ ad_id: u.adId, ad_name: u.adName, url: u.url, cents: u.cents, reason: u.reason })));
});

/* ── the small shared pieces ────────────────────────────────────────────── */

/** The stored connection, without ever handing a token further than this file. */
async function connection(service: any, trainerId: string): Promise<Res<{ token: string; advertiserId: string }>> {
  // no-error-ok: a failed read and a missing row lead to the same sentence —
  // there is no usable connection either way, and the remedy the coach is given
  // (connect the account) is correct for both.
  const { data } = await service
    .from('coach_ad_accounts')
    .select('access_token, external_account_id')
    .eq('trainer_id', trainerId).eq('provider', PROVIDER).maybeSingle();
  const token = String(data?.access_token || '');
  if (!token) return { ok: false, error: 'No TikTok ad account is connected yet.' };
  return { ok: true, body: { token, advertiserId: String(data?.external_account_id || '') } };
}

/** Save the chosen advertiser. Returns a sentence on failure, nothing on
 *  success. */
async function attach(service: any, trainerId: string, a: Acct): Promise<string | null> {
  const { error } = await service.rpc('choose_ad_account', {
    p_trainer_id: trainerId,
    p_provider: PROVIDER,
    p_external_account_id: a.id,
    p_account_name: a.name,
    p_account_currency: a.currency,
  });
  return error ? `That ad account was verified but not saved: ${error.message}` : null;
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
