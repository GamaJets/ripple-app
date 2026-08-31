// The app's side of automatic ad-spend collection: connecting an ad account,
// running a sync, and reading back what it did — including what it could not do.
//
// Every read here carries a LoadStatus with it, for the reason src/ui/
// loadStatus.ts gives at length: an empty list under a failed read looks exactly
// like a coach whose ads cost nothing, and this screen is the one where that
// sentence is about money going out. Nothing below turns a failure into a zero.
//
// No token ever reaches this file. `my_ad_account()` returns the connection
// without either token column, and the exchange happens in the ads-oauth edge
// function — see the header there, and supabase/functions/ocr-scan/index.ts for
// the key that shipped readable in the bundle and is why the rule is absolute.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { appLink } from '../lib/deepLink';
import type { LoadStatus } from './loadStatus';
import type { UnmatchReason } from '../lib/adMatch';

/**
 * The Meta app id. Public by design — it is in the consent URL every coach's
 * browser sees — so EXPO_PUBLIC_ is the right home for it, and the SECRET that
 * pairs with it lives only as a Supabase secret.
 *
 * Read as the literal `process.env.EXPO_PUBLIC_…` member expression. Expo's
 * Babel plugin substitutes that exact AST shape at build time and nothing else:
 * `(process.env as any)?.X` is left alone and reads undefined from a bundle
 * whose process.env is empty, which is how Spotify's client id came to be
 * reported as unconfigured when it had been set all along.
 */
export const META_ADS_CLIENT_ID = process.env.EXPO_PUBLIC_META_ADS_CLIENT_ID ?? '';

/**
 * Where Meta sends the coach back to.
 *
 * It has to be https. Facebook Login will not accept a custom scheme in its
 * Valid OAuth Redirect URIs at all, so — unlike the wearables in
 * src/lib/wearables/oauthConfig.ts, which redirect straight to `repple://` —
 * this bounces off a page on the marketing site that forwards the query string
 * on to the app.
 *
 * ONE registered address for every build, which is why the app's own scheme is
 * carried in `state` rather than being part of this URL. Repple is white-
 * labelled: each brand ships its own scheme (app.config.ts takes it from the
 * brand registry), and a callback page that redirected to a literal `repple://`
 * would send every other brand's coach nowhere at all — the same fault
 * src/lib/deepLink.ts documents for the password-reset email, which sent a
 * chain's locked-out member to their supplier's website.
 */
export const AD_OAUTH_REDIRECT = 'https://www.repplefitness.com/ads/callback';

/**
 * Where the callback page must send the coach on to: this build's own deep
 * link, resolved at runtime from the scheme the binary actually ships.
 */
export function adReturnUrl(): string {
  return appLink('ad-spend/callback');
}

/**
 * The `state` Meta echoes back, carrying two things:
 *
 *   · a nonce, checked on return, without which a link somebody else crafted
 *     could hand this app an authorisation code for THEIR ad account;
 *   · this build's return URL, so the one shared callback page can forward to
 *     whichever brand's app started the sign-in.
 *
 * The separator is '~', which is unreserved in a URL and appears in neither
 * half — a scheme cannot contain it and the nonce is base-36.
 */
export function adOauthState(nonce: string, returnUrl: string): string {
  return `${nonce}~${returnUrl}`;
}

/**
 * `ads_read` is the only permission this feature needs, and the only one asked
 * for. Asking for more than the job requires is how an app fails App Review and
 * how a coach comes to grant something they did not need to.
 */
export const AD_SCOPES = 'ads_read';

/**
 * Said on the screen, in the coach's own words rather than Meta's.
 *
 * This is not a feature that half-works: until Meta grants Advanced Access for
 * `ads_read`, a coach who is not a developer or tester on Repple's Meta app can
 * complete the whole sign-in and then get a permissions error on the first
 * read. Somebody who has not been told that reads it as Repple being broken and
 * goes back to typing figures in — which is fine — or stops trusting the
 * numbers that ARE right, which is not.
 */
export const APP_REVIEW_NOTE =
  'Meta has to approve Repple for the ads_read permission before this can read a real ad account. Until it does, connecting works only for Meta accounts that have a role on Repple’s own Meta app — everyone else will sign in successfully and then be refused when we ask for the spend. Entering what you spent by hand works today and always will.';

/* ── Shapes ─────────────────────────────────────────────────────────────── */

export type AdAccount = {
  provider: string;
  /** Null means connected but no ad account chosen yet — a real state. */
  externalAccountId: string | null;
  accountName: string | null;
  /** The AD ACCOUNT's currency, not the coach's. Null until a sync read it. */
  currency: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  scopes: string | null;
  expiresSoon: boolean;
};

export type SyncRun = {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'ok' | 'failed';
  /** Meta's own words. Null on a run that worked. */
  failure: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  currency: string | null;
  /** All null on a failed run — it does not know any of them. */
  adsSeen: number | null;
  matchedAds: number | null;
  unmatchedAds: number | null;
  matchedCents: number | null;
  /** Null where an unmatched ad's own amount could not be read. */
  unmatchedCents: number | null;
};

export type SyncedCode = {
  codeId: string | null;
  code: string;
  cents: number;
  currency: string;
  ads: number;
  /** False when the coach's own figure was kept and this one was not used. */
  applied: boolean;
};

export type UnmatchedRow = {
  adId: string | null;
  adName: string;
  url: string | null;
  /** Null means the spend was unreadable. Never rendered as zero. */
  cents: number | null;
  currency: string | null;
  reason: UnmatchReason;
};

/** Where the figure my_code_returns() shows for a code actually came from. */
export type SpendSource = {
  codeId: string | null;
  source: 'manual' | 'synced';
  cents: number;
  currency: string;
  updatedAt: string | null;
};

export type AdSpendRead = {
  status: LoadStatus;
  account: AdAccount | null;
  run: SyncRun | null;
  matched: SyncedCode[];
  unmatched: UnmatchedRow[];
  sources: SpendSource[];
  reason?: string;
};

const EMPTY: Omit<AdSpendRead, 'status'> = { account: null, run: null, matched: [], unmatched: [], sources: [] };

/** PostgREST hands bigint back as a string; only a finite number is a figure. */
const cents = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
};

const text = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/* ── Reading ────────────────────────────────────────────────────────────── */

/**
 * Everything the screen shows, in one read that either lands or does not.
 *
 * Four requests rather than one RPC, because three of the four tables are
 * ordinary coach-owned rows with an owner policy and only the account needs a
 * function to keep the tokens out. Any one of them failing makes the WHOLE read
 * 'error': a screen that showed a sync's matched codes without knowing whether
 * the unmatched list came back would be presenting attributed spend as all the
 * spend there was.
 */
export async function fetchAdSpend(): Promise<AdSpendRead> {
  if (!USE_SUPABASE) {
    return { status: 'error', ...EMPTY, reason: 'Sign in to Repple to connect an ad account.' };
  }
  const failed = (reason: string): AdSpendRead => ({ status: 'error', ...EMPTY, reason });

  try {
    const { data: acctRows, error: acctErr } = await supabase.rpc('my_ad_account');
    if (acctErr) {
      reportError('adSpend.account', acctErr);
      return failed('We could not check whether your ad account is connected, so nothing below says whether it is.');
    }
    const a = Array.isArray(acctRows) ? acctRows[0] : acctRows;
    const account: AdAccount | null = a
      ? {
        provider: String(a.provider || 'meta'),
        externalAccountId: text(a.external_account_id),
        accountName: text(a.account_name),
        currency: text(a.account_currency),
        connectedAt: text(a.connected_at),
        updatedAt: text(a.updated_at),
        scopes: text(a.scopes),
        expiresSoon: !!a.expires_soon,
      }
      : null;

    const { data: sources, error: srcErr } = await supabase.rpc('my_spend_sources');
    if (srcErr) {
      reportError('adSpend.sources', srcErr);
      return failed('We could not read which of your spend figures you typed and which were synced, so none of them is labelled below.');
    }
    const shapedSources: SpendSource[] = (sources ?? []).map((s: any) => ({
      codeId: s.code_id ?? null,
      source: s.source === 'synced' ? 'synced' : 'manual',
      cents: cents(s.amount_cents) ?? 0,
      currency: String(s.currency || '').toUpperCase(),
      updatedAt: text(s.updated_at),
    }));

    const { data: runs, error: runErr } = await supabase
      .from('coach_ad_sync_runs')
      .select('id, started_at, finished_at, status, failure, window_from, window_to, account_currency, ads_seen, matched_ads, unmatched_ads, matched_cents, unmatched_cents')
      .order('started_at', { ascending: false })
      .limit(1);
    if (runErr) {
      reportError('adSpend.runs', runErr);
      return failed('We could not read when your ad spend was last checked, so nothing below tells you whether it has been.');
    }
    const r = (runs ?? [])[0];
    if (!r) return { status: 'ready', ...EMPTY, account, sources: shapedSources };

    const run: SyncRun = {
      id: String(r.id),
      startedAt: text(r.started_at),
      finishedAt: text(r.finished_at),
      status: r.status === 'ok' ? 'ok' : 'failed',
      failure: text(r.failure),
      windowFrom: text(r.window_from),
      windowTo: text(r.window_to),
      currency: text(r.account_currency),
      adsSeen: cents(r.ads_seen),
      matchedAds: cents(r.matched_ads),
      unmatchedAds: cents(r.unmatched_ads),
      matchedCents: cents(r.matched_cents),
      unmatchedCents: cents(r.unmatched_cents),
    };

    // A failed run attributed nothing and listed nothing, by design — asking
    // for its rows would be asking a question it did not answer.
    if (run.status !== 'ok') {
      return { status: 'ready', ...EMPTY, account, run, sources: shapedSources };
    }

    const { data: matchedRows, error: matchedErr } = await supabase
      .from('coach_ad_code_spend')
      .select('code_id, code, amount_cents, currency, ads, applied')
      .eq('run_id', run.id);
    if (matchedErr) {
      reportError('adSpend.matched', matchedErr);
      return failed('We could not read what the last sync matched, so nothing below is a figure.');
    }

    const { data: unmatchedRows, error: unmatchedErr } = await supabase
      .from('coach_ad_unmatched')
      .select('ad_id, ad_name, destination_url, amount_cents, currency, reason')
      .eq('run_id', run.id);
    if (unmatchedErr) {
      reportError('adSpend.unmatched', unmatchedErr);
      // Deliberately fails the WHOLE read. Showing the matched spend while the
      // unmatched list is unknown would present part of a coach's budget as all
      // of it, which is the one thing this screen exists to prevent.
      return failed('We could not read the ads that could not be matched to a code, so the figures above would not be all of your spend. Nothing is shown rather than part of it.');
    }

    return {
      status: 'ready',
      account,
      run,
      sources: shapedSources,
      matched: (matchedRows ?? []).map((m: any) => ({
        codeId: m.code_id ?? null,
        code: String(m.code || '').toUpperCase(),
        cents: cents(m.amount_cents) ?? 0,
        currency: String(m.currency || '').toUpperCase(),
        ads: cents(m.ads) ?? 0,
        applied: !!m.applied,
      })).sort((x: SyncedCode, y: SyncedCode) => y.cents - x.cents || x.code.localeCompare(y.code)),
      unmatched: (unmatchedRows ?? []).map((u: any) => ({
        adId: text(u.ad_id),
        adName: String(u.ad_name || '').trim(),
        url: text(u.destination_url),
        cents: cents(u.amount_cents),
        currency: text(u.currency),
        reason: (u.reason || 'no-code') as UnmatchReason,
      })).sort((x: UnmatchedRow, y: UnmatchedRow) => (y.cents ?? -1) - (x.cents ?? -1)),
    };
  } catch (e) {
    reportError('adSpend.read', e);
    return failed('Your ad spend could not be read, so nothing here is a figure.');
  }
}

/* ── Acting ─────────────────────────────────────────────────────────────── */

export type Ad = { ok: true } | { ok: false; reason: string };
export type AdAccountChoice = { id: string; name: string; currency: string | null; active: boolean };
export type ConnectResult =
  | { ok: true; chosen: AdAccountChoice | null; accounts: AdAccountChoice[]; warning?: string }
  | { ok: false; reason: string };

function webBrowser(): any {
  // Lazily required, the same as src/lib/wearables/oauth.ts: an OTA update onto
  // a build made before expo-web-browser was added would otherwise crash on
  // import rather than saying plainly that this build cannot do it yet.
  try { return require('expo-web-browser'); } catch { return null; }
}

/** The consent URL. Public values only — the secret never leaves the server. */
export function adConsentUrl(state: string): string {
  // Built by hand rather than with URLSearchParams. React Native's polyfill for
  // it is partial — historically append/toString and not much else — and this
  // module runs on a device. encodeURIComponent is in every engine.
  const q = [
    ['client_id', META_ADS_CLIENT_ID],
    ['redirect_uri', AD_OAUTH_REDIRECT],
    ['response_type', 'code'],
    ['scope', AD_SCOPES],
    ['state', state],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
}

/** The query string of a URL, read without URLSearchParams. See above. */
function queryOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.split('#')[0].split('?').slice(1).join('?');
  for (const pair of q.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    } catch { /* a half-encoded parameter is not one we can read */ }
  }
  return out;
}

/**
 * Open Meta's consent screen, then hand the code to the server.
 *
 * The code goes straight to ads-oauth and the app is told only which ad
 * accounts the login can see — an id, a name and a currency, none of it secret.
 * The token itself is never in this process.
 */
export async function connectAdAccount(): Promise<ConnectResult> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to connect an ad account.' };
  if (!META_ADS_CLIENT_ID) {
    return { ok: false, reason: 'Connecting an ad account is not set up in this build — the owner sets EXPO_PUBLIC_META_ADS_CLIENT_ID (the Meta app id) and the META_ADS_CLIENT_SECRET Supabase secret.' };
  }
  const WB = webBrowser();
  if (!WB?.openAuthSessionAsync) {
    return { ok: false, reason: 'This version of the app cannot open a sign-in browser — updating to the latest build adds it. Entering what you spent by hand works now.' };
  }
  if (WB.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* ignore */ } }

  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const returnUrl = adReturnUrl();
  const state = adOauthState(nonce, returnUrl);

  let result: any;
  try {
    result = await WB.openAuthSessionAsync(adConsentUrl(state), returnUrl);
  } catch (e) {
    reportError('adSpend.consent', e);
    return { ok: false, reason: 'The Meta sign-in could not be opened.' };
  }
  if (!result || result.type !== 'success' || !result.url) {
    if (result?.type === 'dismiss' || result?.type === 'cancel') return { ok: false, reason: 'Sign-in cancelled — nothing was connected.' };
    return { ok: false, reason: 'The Meta sign-in did not come back, so nothing was connected.' };
  }

  const params = queryOf(String(result.url));
  const err = params.error_description || params.error;
  if (err) return { ok: false, reason: `Meta refused the sign-in: ${err}` };
  if (params.state !== state) {
    return { ok: false, reason: 'That sign-in did not come back from where it was sent, so nothing was connected. Try again from this screen.' };
  }
  const code = params.code || '';
  if (!code) return { ok: false, reason: 'Meta came back without a sign-in code, so nothing was connected.' };

  try {
    const { data, error } = await supabase.functions.invoke('ads-oauth', {
      body: { action: 'connect', code, redirect_uri: AD_OAUTH_REDIRECT },
    });
    if (error || (data as any)?.ok === false) {
      const detail = (data as any)?.error || (error as any)?.message || 'The server could not finish connecting.';
      reportError('adSpend.exchange', detail);
      return { ok: false, reason: String(detail) };
    }
    const d = data as any;
    return { ok: true, chosen: d?.chosen ?? null, accounts: Array.isArray(d?.accounts) ? d.accounts : [], warning: d?.warning };
  } catch (e) {
    reportError('adSpend.exchange', e);
    return { ok: false, reason: 'The server could not finish connecting your ad account.' };
  }
}

/** Say which ad account this connection is about. Verified server-side. */
export async function chooseAdAccount(accountId: string): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { data, error } = await supabase.functions.invoke('ads-oauth', { body: { action: 'choose', account_id: accountId } });
    if (error || (data as any)?.ok === false) {
      const detail = (data as any)?.error || (error as any)?.message || 'That ad account could not be saved.';
      reportError('adSpend.choose', detail);
      return { ok: false, reason: String(detail) };
    }
    return { ok: true };
  } catch (e) {
    reportError('adSpend.choose', e);
    return { ok: false, reason: 'That ad account could not be saved.' };
  }
}

/**
 * Run a sync now.
 *
 * A failure is reported AND recorded server-side, so the screen can show that
 * the last attempt failed rather than showing the previous successful run's
 * date as though nothing had happened since.
 */
export async function runAdSync(): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to check your ad spend.' };
  try {
    const { data, error } = await supabase.functions.invoke('ads-sync', { body: {} });
    if (error || (data as any)?.ok === false) {
      const detail = (data as any)?.error || (error as any)?.message || 'Your ad spend could not be checked.';
      reportError('adSpend.sync', detail);
      return { ok: false, reason: String(detail) };
    }
    return { ok: true };
  } catch (e) {
    reportError('adSpend.sync', e);
    return { ok: false, reason: 'Your ad spend could not be checked.' };
  }
}

/**
 * Disconnect. The sync history and the recorded figures stay — what a campaign
 * cost last month did not stop being true because the account was unlinked.
 */
export async function disconnectAdAccount(): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { error } = await supabase.rpc('disconnect_ad_account', { p_provider: 'meta' });
    if (error) {
      reportError('adSpend.disconnect', error);
      return { ok: false, reason: 'That could not be disconnected, so your ad account is still linked.' };
    }
    return { ok: true };
  } catch (e) {
    reportError('adSpend.disconnect', e);
    return { ok: false, reason: 'That could not be disconnected, so your ad account is still linked.' };
  }
}

/** Replace one code's typed figure with the synced one, at the coach's word. */
export async function useSyncedSpend(codeId: string | null): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { error } = await supabase.rpc('use_synced_spend', { p_code_id: codeId });
    if (error) {
      reportError('adSpend.useSynced', error);
      return { ok: false, reason: `${error.message}. Your own figure is still the one in use.` };
    }
    return { ok: true };
  } catch (e) {
    reportError('adSpend.useSynced', e);
    return { ok: false, reason: 'That could not be changed, so your own figure is still the one in use.' };
  }
}
