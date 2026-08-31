// ads-sync — reads what a coach's ads cost and files it against their join
// codes, by reading the code out of each ad's own destination link.
//
// ── Why the matching is done this way ─────────────────────────────────────
//
// The coach already puts `https://…/join?c=CODE` in their Instagram bio. They
// set the same link as the ad's destination. So the ad carries the code, and
// this function only has to read it back — no mapping screen, nothing for the
// coach to keep up to date, and nothing to be silently wrong about after the
// month it was filled in. The parsing itself lives in src/lib/adMatch.ts, as a
// pure module with a test, because every line of it is a decision about
// somebody's money.
//
// It is imported from there rather than copied. A second copy of these rules
// would be the one that drifts, and the test would still pass on the other one.
//
// ── The window, which has to match the revenue it is compared against ────
//
// my_code_returns() sums EVERY purchase a code's clients have ever made. So the
// spend put beside it is asked for over the ad account's whole life
// (`date_preset=maximum`) and not over the last 30 days. Thirty days of spend
// against lifetime revenue is a ratio of two different things, and it flatters
// every campaign that has been running longer than a month.
//
// ── What is honest about a failure ───────────────────────────────────────
//
// A sync that could not ask is recorded as `failed`, with Meta's own words, and
// writes no spend at all. It cannot: it does not know any. A sync that ran and
// found nothing is recorded as `ok` with zero ads seen, which is a different
// fact and sends the coach somewhere different. Nothing in this file ever turns
// the first into the second.
//
// Ads whose destination carries no code are recorded as UNMATCHED with their
// spend, not dropped and not zeroed — see part 100 and adMatch.ts. A tidier
// total that quietly excluded them is the failure this whole feature is for.
//
// ── What does not work yet ───────────────────────────────────────────────
//
// Meta gates `ads_read` behind App Review. Until Repple's Meta app has Advanced
// Access, `/insights` answers a permissions error for everybody who does not
// hold a role on that app. That comes back here as a `failed` run carrying
// Meta's message, and the screen says what it means, because "no spend found"
// would be a lie about the coach's campaigns.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { matchAds, urlsFromCreative, type AdInsight } from '../../../src/lib/adMatch.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (msg: string) => json({ ok: false, error: msg });

const GRAPH = 'https://graph.facebook.com/v21.0';
const PROVIDER = 'meta';

/** One Graph call. Meta reports failure in the body as often as in the status. */
async function graph(url: string): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  let res: Response;
  try { res = await fetch(url); } catch { return { ok: false, error: 'Meta could not be reached.' }; }
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { body = { error: { message: text.slice(0, 300) } }; }
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    const detail = [e.message, e.error_user_msg].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, body };
}

/**
 * Every page of a Graph edge.
 *
 * Paging is not optional here. Meta caps a page well below the number of ads a
 * busy account holds, and stopping at the first page would report a fraction of
 * the spend as the whole of it — a total that is confidently, quietly low.
 * A page that fails aborts the whole read rather than returning what it has.
 */
async function graphAll(url: string, cap = 20): Promise<{ ok: true; rows: any[] } | { ok: false; error: string }> {
  const rows: any[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < cap; page++) {
    const r: { ok: true; body: any } | { ok: false; error: string } = await graph(next);
    if (!r.ok) return r;
    if (Array.isArray(r.body?.data)) rows.push(...r.body.data);
    next = r.body?.paging?.next ? String(r.body.paging.next) : null;
  }
  if (next) {
    // Better to refuse than to file a partial total as a total. src/ui/
    // loadStatus.ts is the same rule stated for reads inside the app.
    return { ok: false, error: 'This ad account has more ads than one sync can read. Nothing was recorded rather than a part of it.' };
  }
  return { ok: true, rows };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // From the JWT alone — never from the body. See ads-oauth for why.
  let trainerId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    trainerId = data?.user?.id || '';
  } catch { /* handled below */ }
  if (!trainerId) return json({ ok: false, error: 'Sign in to Repple and try again.' }, 401);

  /** Record the attempt, whole, and answer the app. */
  const record = async (
    status: 'ok' | 'failed',
    failure: string | null,
    currency: string | null,
    windowFrom: string | null,
    windowTo: string | null,
    adsSeen: number | null,
    matched: unknown[],
    unmatched: unknown[],
  ) => {
    const { error } = await service.rpc('record_ad_sync', {
      p_trainer_id: trainerId,
      p_provider: PROVIDER,
      p_status: status,
      p_failure: failure,
      p_from: windowFrom,
      p_to: windowTo,
      p_currency: currency,
      p_ads_seen: adsSeen,
      p_matched: matched,
      p_unmatched: unmatched,
    });
    // A run that happened and was not recorded is worse than one that did not
    // happen: the screen would keep showing the previous sync's date as if
    // nothing had been tried since.
    if (error) return fail(`The sync ran but could not be recorded: ${error.message}`);
    return status === 'ok'
      ? json({ ok: true, matched: matched.length, unmatched: unmatched.length, currency })
      : json({ ok: false, error: failure, recorded: true });
  };

  const clientId = Deno.env.get('META_ADS_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('META_ADS_CLIENT_SECRET') || '';

  // no-error-ok: a failed read and a missing row lead to the same sentence on
  // the next line — there is no usable connection either way, and the remedy
  // the coach is given (connect the account) is correct for both.
  const { data: acct } = await service
    .from('coach_ad_accounts')
    .select('access_token, external_account_id, expires_at, account_currency')
    .eq('trainer_id', trainerId).eq('provider', PROVIDER).maybeSingle();

  // Not recorded as a failed run: nothing was attempted, and a run row here
  // would put "sync failed" in a coach's history for never having connected.
  if (!acct?.access_token) return fail('No ad account is connected yet.');
  if (!acct?.external_account_id) return fail('Your Meta login is connected but no ad account has been chosen yet.');

  let token = String(acct.access_token);

  // A long-lived Meta token lasts about sixty days and is extended by trading
  // it for another. Done here rather than on a schedule so a coach who opens
  // this screen once a month never has to reconnect; a failure is ignored
  // because the current token is still valid today and the sync below will say
  // plainly if it is not.
  const expiresAt = acct.expires_at ? Date.parse(String(acct.expires_at)) : NaN;
  if (clientId && clientSecret && Number.isFinite(expiresAt) && expiresAt - Date.now() < 14 * 86400_000) {
    const fresh = await graph(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(clientId)}`
      + `&client_secret=${encodeURIComponent(clientSecret)}`
      + `&fb_exchange_token=${encodeURIComponent(token)}`,
    );
    if (fresh.ok && fresh.body?.access_token) {
      token = String(fresh.body.access_token);
      const secs = Number(fresh.body?.expires_in);
      await service.rpc('store_ad_account', {
        p_trainer_id: trainerId, p_provider: PROVIDER,
        p_external_account_id: acct.external_account_id,
        p_account_name: null,
        p_account_currency: acct.account_currency ?? null,
        p_access_token: token,
        p_refresh_token: null,
        p_expires_at: Number.isFinite(secs) && secs > 0 ? new Date(Date.now() + secs * 1000).toISOString() : null,
        p_scopes: null,
      });
    }
  }

  const act = String(acct.external_account_id);
  const tokenQ = `access_token=${encodeURIComponent(token)}`;

  /* ── 1. Spend per ad, over the account's whole life ────────────────────── */
  const insights = await graphAll(
    `${GRAPH}/${encodeURIComponent(act)}/insights`
    + `?level=ad&fields=ad_id,ad_name,spend,account_currency,date_start,date_stop`
    + `&date_preset=maximum&limit=500&${tokenQ}`,
  );
  if (!insights.ok) {
    const gated = /permission|ads_read|(#|code )10\b|OAuthException/i.test(insights.error);
    return record('failed', gated
      ? `Meta refused to report your ad spend: ${insights.error}. Reading spend needs the ads_read permission, which Meta grants an app only after App Review — until Repple has that, this works only for Meta accounts with a role on the Repple app.`
      : `Meta refused to report your ad spend: ${insights.error}`,
      null, null, null, null, [], []);
  }

  /* ── 2. Where each ad points ──────────────────────────────────────────── */
  const ads = await graphAll(
    `${GRAPH}/${encodeURIComponent(act)}/ads`
    + `?fields=id,name,creative{id,object_story_spec,asset_feed_spec,link_url,url_tags,effective_object_story_id}`
    + `&limit=200&${tokenQ}`,
  );
  if (!ads.ok) {
    // Deliberately a failure, not a sync where nothing matched. Without the
    // destinations every ad would be "no link", and the coach would be shown
    // their entire budget as unattributable and go and edit ads that are fine.
    return record('failed', `Meta reported your spend but not where the ads point (${ads.error}), so nothing could be matched to a code.`, null, null, null, null, [], []);
  }

  const urlsById = new Map<string, string[]>();
  for (const a of ads.rows) {
    const id = String(a?.id || '');
    if (id) urlsById.set(id, urlsFromCreative(a?.creative));
  }

  /* ── 3. The coach's own codes, named and default ───────────────────────── */
  const { data: named, error: namedErr } = await service
    .from('coach_join_codes')
    .select('id, code, label')
    .eq('trainer_id', trainerId);
  if (namedErr) return record('failed', `Your join codes could not be read, so no spend was filed against them: ${namedErr.message}`, null, null, null, null, [], []);

  const { data: me, error: meErr } = await service
    .from('trainers').select('join_code').eq('id', trainerId).maybeSingle();
  if (meErr) return record('failed', `Your main code could not be read, so no spend was filed against it: ${meErr.message}`, null, null, null, null, [], []);

  const codes = [
    ...(named ?? []).map((c: any) => ({ id: String(c.id), code: String(c.code || ''), label: String(c.label || c.code || '') })),
    // Null id is the default code, keyed exactly as coach_code_spend keys it.
    ...(me?.join_code ? [{ id: null, code: String(me.join_code), label: 'Your main code' }] : []),
  ];

  /* ── 4. Match ─────────────────────────────────────────────────────────── */
  const rows: AdInsight[] = insights.rows.map((r: any) => ({
    adId: String(r?.ad_id || ''),
    adName: String(r?.ad_name || '').trim(),
    spend: r?.spend ?? null,
    currency: r?.account_currency ?? null,
    urls: urlsById.get(String(r?.ad_id || '')) ?? [],
  }));
  const windowFrom = insights.rows.map((r: any) => r?.date_start).filter(Boolean).sort()[0] ?? null;
  const windowTo = insights.rows.map((r: any) => r?.date_stop).filter(Boolean).sort().slice(-1)[0] ?? null;

  const result = matchAds(rows, codes);

  // Two currencies in one account, or none at all. Either way there is no unit
  // to put on a total, and a total with no unit is not an amount of money.
  if (result.currencyConflict) {
    return record('failed', 'This ad account reported spend in more than one currency. Adding those together would not be an amount of money, so nothing was recorded.', null, windowFrom, windowTo, result.adsSeen, [], []);
  }
  if (!result.currency && result.adsSeen > 0) {
    return record('failed', 'Meta did not say which currency this ad account bills in, and a spend figure with no currency cannot be compared with what your clients pay. Nothing was recorded.', null, windowFrom, windowTo, result.adsSeen, [], []);
  }

  return record(
    'ok', null, result.currency, windowFrom, windowTo, result.adsSeen,
    result.matched.map((m) => ({ code_id: m.codeId, code: m.code, cents: m.cents, ads: m.ads })),
    result.unmatched.map((u) => ({ ad_id: u.adId, ad_name: u.adName, url: u.url, cents: u.cents, reason: u.reason })),
  );
});
