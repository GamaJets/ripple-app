// The app's side of automatic ad-spend collection: connecting an ad account,
// running a check, and reading back what it did — including what it could not
// do, and which of three channels could not do it.
//
// Every read here carries a LoadStatus with it, for the reason src/ui/
// loadStatus.ts gives at length: an empty list under a failed read looks exactly
// like a coach whose ads cost nothing, and this screen is the one where that
// sentence is about money going out. Nothing below turns a failure into a zero.
//
// ── Three channels, and the read that was silently one ───────────────────
//
// Part 100 read `coach_ad_sync_runs` ordered by date with a limit of one. With
// a single provider that is the last check. With three it is the last check ON
// WHATEVER CHANNEL SYNCED MOST RECENTLY, and the screen would have shown that
// one channel's ads, matched codes and unmatched list as though they were the
// whole of the coach's advertising. So the run read is now my_ad_runs(), which
// is a DISTINCT ON the provider and returns one row per channel — see part 350.
//
// The combining is not done here. `combineChannelSpend` in src/lib/adChannels.ts
// is a pure function with a test, because the rule it holds — a channel that
// could not be read makes the TOTAL unknown, never a smaller number — is the
// one thing on this screen that a coach's budget depends on, and it is not
// something to discover from a real ad account.
//
// No token ever reaches this file. `my_ad_channels()` returns the connections
// without any token column, and the exchanges happen in the ads-oauth,
// ads-google and ads-tiktok edge functions — see the headers there, and
// supabase/functions/ocr-scan/index.ts for the key that shipped readable in the
// bundle and is why the rule is absolute.
import { supabase } from '../lib/supabase';
import { authNonce } from '../lib/authNonce';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { appLink } from '../lib/deepLink';
import type { LoadStatus } from './loadStatus';
import type { UnmatchReason } from '../lib/adMatch';
import {
  AD_CHANNELS, channelLabel, channelSetupNote, combineChannelSpend, isAdChannel,
  type AdChannel, type ChannelRun, type Combined,
} from '../lib/adChannels';

/**
 * The three public app identifiers, one per channel.
 *
 * Public by design — each appears in the consent URL every coach's browser sees
 * — so EXPO_PUBLIC_ is the right home for them, and the SECRETS that pair with
 * them live only as Supabase secrets.
 *
 * Read as the literal `process.env.EXPO_PUBLIC_…` member expression. Expo's
 * Babel plugin substitutes that exact AST shape at build time and nothing else:
 * `(process.env as any)?.X` is left alone and reads undefined from a bundle
 * whose process.env is empty, which is how Spotify's client id came to be
 * reported as unconfigured when it had been set all along. That is also why
 * these are three constants rather than one lookup by channel name — a computed
 * key is exactly the shape the plugin cannot see.
 */
export const META_ADS_CLIENT_ID = process.env.EXPO_PUBLIC_META_ADS_CLIENT_ID ?? '';
export const GOOGLE_ADS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ADS_CLIENT_ID ?? '';
export const TIKTOK_ADS_APP_ID = process.env.EXPO_PUBLIC_TIKTOK_ADS_APP_ID ?? '';

/** Whether this build can even open the sign-in for a channel. */
export function channelClientId(c: AdChannel): string {
  switch (c) {
    case 'meta': return META_ADS_CLIENT_ID;
    case 'google': return GOOGLE_ADS_CLIENT_ID;
    case 'tiktok': return TIKTOK_ADS_APP_ID;
  }
}

/**
 * Where the provider sends the coach back to. One address, all three channels.
 *
 * It has to be https. Facebook Login will not accept a custom scheme in its
 * Valid OAuth Redirect URIs at all, Google refuses one for a web client, and
 * TikTok requires an https callback registered on the app — so — unlike the
 * wearables in src/lib/wearables/oauthConfig.ts, which redirect straight to
 * `repple://` — this bounces off a page on the marketing site that forwards the
 * query string on to the app.
 *
 * ONE registered address for every build and every channel, which is why the
 * app's own scheme is carried in `state` rather than being part of this URL.
 * Repple is white-labelled: each brand ships its own scheme (app.config.ts
 * takes it from the brand registry), and a callback page that redirected to a
 * literal `repple://` would send every other brand's coach nowhere at all — the
 * same fault src/lib/deepLink.ts documents for the password-reset email, which
 * sent a chain's locked-out member to their supplier's website.
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
 * The `state` the provider echoes back, carrying two things:
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
 * The permission each channel is asked for, and nothing beyond it. Asking for
 * more than the job requires is how an app fails review and how a coach comes
 * to grant something they did not need to.
 *
 *   Meta    `ads_read`.
 *   Google  the single `adwords` scope, which is the only one the Google Ads
 *           API has. It is a read/write scope — Google publishes no read-only
 *           one — so nothing here ever issues a mutate, and the coach is told
 *           on the screen that Repple only ever reads.
 *   TikTok  no scope parameter at all: the permissions are fixed on the app in
 *           the developer portal, and the authorisation page shows the coach
 *           what they are.
 */
export const AD_SCOPES = 'ads_read';
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

/**
 * Said on the screen, in the coach's own words rather than Meta's.
 *
 * This is not a feature that half-works: until Meta grants Advanced Access for
 * `ads_read`, a coach who is not a developer or tester on Repple's Meta app can
 * complete the whole sign-in and then get a permissions error on the first
 * read. Somebody who has not been told that reads it as Repple being broken and
 * goes back to typing figures in — which is fine — or stops trusting the
 * numbers that ARE right, which is not.
 *
 * It is about META. Google and TikTok are separate APIs with separate
 * credentials and separate approvals, and neither is gated by this one.
 */
export const APP_REVIEW_NOTE =
  'Meta has to approve Repple for the ads_read permission before this can read a real ad account. Until it does, connecting works only for Meta accounts that have a role on Repple’s own Meta app — everyone else will sign in successfully and then be refused when we ask for the spend. Entering what you spent by hand works today and always will. This is about Meta only: Google Ads and TikTok are separate approvals and are not waiting on it.';

/** Said once, above all three. Every one of these reads and none of them
 *  writes, and a coach handing over an ad account is entitled to know it. */
export const READ_ONLY_NOTE =
  'Repple only ever reads from a connected ad account. Nothing here creates, edits, pauses or pays for an ad, and disconnecting stops the reading at once.';

/* ── Shapes ─────────────────────────────────────────────────────────────── */

export type AdAccount = {
  channel: AdChannel;
  /** Null means connected but no ad account chosen yet — a real state. */
  externalAccountId: string | null;
  accountName: string | null;
  /** The AD ACCOUNT's currency, not the coach's. Null until a check read it. */
  currency: string | null;
  /** Google only: the manager account it is reached through. */
  managerAccountId: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  scopes: string | null;
  expiresSoon: boolean;
};

export type SyncRun = {
  channel: AdChannel;
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: 'ok' | 'failed';
  /** The provider's own words. Null on a run that worked. */
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

/** One channel, whole: whether it is connected, what its last check said, and
 *  what that check found. Always three of these, connected or not — a channel
 *  the coach has not linked is a row that offers to link it, not an absence. */
export type ChannelState = {
  channel: AdChannel;
  account: AdAccount | null;
  run: SyncRun | null;
  matched: SyncedCode[];
  unmatched: UnmatchedRow[];
};

export type AdSpendRead = {
  status: LoadStatus;
  channels: ChannelState[];
  sources: SpendSource[];
  /** The figure across every connected channel, or the reason there is none. */
  combined: Combined;
  reason?: string;
};

const blank = (c: AdChannel): ChannelState => ({ channel: c, account: null, run: null, matched: [], unmatched: [] });
const EMPTY = (): Omit<AdSpendRead, 'status' | 'combined'> => ({
  channels: AD_CHANNELS.map(blank),
  sources: [],
});

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
 * Five requests rather than one RPC, because three of the five are ordinary
 * coach-owned rows with an owner policy and only the connections need a
 * function to keep the tokens out. Any one of them failing makes the WHOLE read
 * 'error': a screen that showed one channel's matched codes without knowing
 * whether the unmatched list came back would be presenting attributed spend as
 * all the spend there was.
 */
export async function fetchAdSpend(): Promise<AdSpendRead> {
  const failed = (reason: string): AdSpendRead => ({
    status: 'error', ...EMPTY(),
    combined: { ok: false, reason: 'no-channels', missing: [], currencies: [], channels: [] },
    reason,
  });

  if (!USE_SUPABASE) return failed('Sign in to Repple to connect an ad account.');

  try {
    const { data: acctRows, error: acctErr } = await supabase.rpc('my_ad_channels');
    if (acctErr) {
      reportError('adSpend.channels', acctErr);
      return failed('We could not check which ad accounts are connected, so nothing below says whether any is. If they were connected, they still are.');
    }

    const states = new Map<AdChannel, ChannelState>(AD_CHANNELS.map((c) => [c, blank(c)]));
    for (const a of (acctRows ?? []) as any[]) {
      const p = String(a?.provider || '');
      // A provider written by a newer build than this one. Skipped rather than
      // guessed at — and it does not silently become Meta, which is what
      // reading the first row used to do.
      if (!isAdChannel(p)) continue;
      const s = states.get(p);
      if (!s) continue;
      s.account = {
        channel: p,
        externalAccountId: text(a.external_account_id),
        accountName: text(a.account_name),
        currency: text(a.account_currency),
        managerAccountId: text(a.manager_account_id),
        connectedAt: text(a.connected_at),
        updatedAt: text(a.updated_at),
        scopes: text(a.scopes),
        expiresSoon: !!a.expires_soon,
      };
    }

    const { data: sources, error: srcErr } = await supabase.rpc('my_spend_sources');
    if (srcErr) {
      reportError('adSpend.sources', srcErr);
      return failed('We could not read which of your spend figures you typed and which were collected, so none of them is labelled below.');
    }
    const shapedSources: SpendSource[] = (sources ?? []).map((s: any) => ({
      codeId: s.code_id ?? null,
      source: s.source === 'synced' ? 'synced' : 'manual',
      cents: cents(s.amount_cents) ?? 0,
      currency: String(s.currency || '').toUpperCase(),
      updatedAt: text(s.updated_at),
    }));

    const { data: runs, error: runErr } = await supabase.rpc('my_ad_runs');
    if (runErr) {
      reportError('adSpend.runs', runErr);
      return failed('We could not read when your ad spend was last checked, so nothing below tells you whether it has been.');
    }
    for (const r of (runs ?? []) as any[]) {
      const p = String(r?.provider || '');
      if (!isAdChannel(p)) continue;
      const s = states.get(p);
      if (!s) continue;
      s.run = {
        channel: p,
        id: String(r.run_id),
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
    }

    // A failed run attributed nothing and listed nothing, by design — asking
    // for its rows would be asking a question it did not answer.
    //
    // Not chunked, and the bound is `AD_CHANNELS`. `states` is keyed by channel
    // and seeded from that tuple, `isAdChannel` drops anything else `my_ad_runs`
    // names, and each state holds at most one run — so this is at most three
    // ids however much a coach has spent or how long they have been running
    // ads. The two `.in('run_id', …)` reads below cannot grow a request line.
    const okRunIds = [...states.values()]
      .filter((s) => s.run?.status === 'ok')
      .map((s) => s.run!.id);

    if (okRunIds.length) {
      const { data: matchedRows, error: matchedErr } = await supabase
        .from('coach_ad_code_spend')
        .select('run_id, code_id, code, amount_cents, currency, ads, applied')
        .in('run_id', okRunIds);
      if (matchedErr) {
        reportError('adSpend.matched', matchedErr);
        return failed('We could not read what the last checks matched, so nothing below is a figure.');
      }

      const { data: unmatchedRows, error: unmatchedErr } = await supabase
        .from('coach_ad_unmatched')
        .select('run_id, ad_id, ad_name, destination_url, amount_cents, currency, reason')
        .in('run_id', okRunIds);
      if (unmatchedErr) {
        reportError('adSpend.unmatched', unmatchedErr);
        // Deliberately fails the WHOLE read. Showing the matched spend while the
        // unmatched list is unknown would present part of a coach's budget as all
        // of it, which is the one thing this screen exists to prevent.
        return failed('We could not read the ads that could not be matched to a code, so the figures above would not be all of your spend. Nothing is shown rather than part of it.');
      }

      const byRun = new Map<string, ChannelState>();
      for (const s of states.values()) if (s.run) byRun.set(s.run.id, s);

      for (const m of (matchedRows ?? []) as any[]) {
        const s = byRun.get(String(m.run_id));
        if (!s) continue;
        s.matched.push({
          codeId: m.code_id ?? null,
          code: String(m.code || '').toUpperCase(),
          cents: cents(m.amount_cents) ?? 0,
          currency: String(m.currency || '').toUpperCase(),
          ads: cents(m.ads) ?? 0,
          applied: !!m.applied,
        });
      }
      for (const u of (unmatchedRows ?? []) as any[]) {
        const s = byRun.get(String(u.run_id));
        if (!s) continue;
        s.unmatched.push({
          adId: text(u.ad_id),
          adName: String(u.ad_name || '').trim(),
          url: text(u.destination_url),
          cents: cents(u.amount_cents),
          currency: text(u.currency),
          reason: (u.reason || 'no-code') as UnmatchReason,
        });
      }
      for (const s of states.values()) {
        s.matched.sort((x, y) => y.cents - x.cents || x.code.localeCompare(y.code));
        s.unmatched.sort((x, y) => (y.cents ?? -1) - (x.cents ?? -1));
      }
    }

    const channels = AD_CHANNELS.map((c) => states.get(c)!);
    return { status: 'ready', channels, sources: shapedSources, combined: combineChannelSpend(channels.map(asChannelRun)) };
  } catch (e) {
    reportError('adSpend.read', e);
    return failed('Your ad spend could not be read, so nothing here is a figure.');
  }
}

/**
 * One channel reduced to what the combining rule needs.
 *
 * `chosen` is the distinction that keeps a half-made connection from making the
 * total unknown for ever: a coach who has authorised Google and not yet said
 * which ad account it is about has nothing to read and will not have until they
 * choose, so that is an unfinished connection rather than an unread channel.
 * Part 350's apply_synced_spend() draws the same line, and the two must agree —
 * one of them saying there is a total while the other refuses to write it is a
 * screen contradicting the figures it is showing.
 */
export function asChannelRun(s: ChannelState): ChannelRun {
  return {
    channel: s.channel,
    chosen: !!s.account?.externalAccountId,
    state: !s.run ? 'never' : s.run.status === 'ok' ? 'ok' : 'failed',
    currency: s.run?.status === 'ok' ? s.run.currency : null,
    codes: s.run?.status === 'ok'
      ? s.matched.map((m) => ({ codeId: m.codeId, code: m.code, cents: m.cents, ads: m.ads }))
      : [],
  };
}

/* ── Acting ─────────────────────────────────────────────────────────────── */

export type Ad = { ok: true } | { ok: false; reason: string };
export type AdAccountChoice = { id: string; name: string; currency: string | null; active: boolean };
export type ConnectResult =
  | { ok: true; channel: AdChannel; chosen: AdAccountChoice | null; accounts: AdAccountChoice[]; warning?: string }
  | { ok: false; reason: string };

function webBrowser(): any {
  // Lazily required, the same as src/lib/wearables/oauth.ts: an OTA update onto
  // a build made before expo-web-browser was added would otherwise crash on
  // import rather than saying plainly that this build cannot do it yet.
  try { return require('expo-web-browser'); } catch { return null; }
}

/** Which edge function answers for a channel. Meta's two are part 100's and are
 *  deliberately left alone; the other two each handle their own whole flow. */
function fn(c: AdChannel, action: 'connect' | 'choose' | 'sync'): string {
  if (c === 'meta') return action === 'sync' ? 'ads-sync' : 'ads-oauth';
  return c === 'google' ? 'ads-google' : 'ads-tiktok';
}

/**
 * The consent URL for one channel. Public values only — no secret leaves the
 * server, and none of these three carries one.
 *
 * Built by hand rather than with URLSearchParams. React Native's polyfill for
 * it is partial — historically append/toString and not much else — and this
 * module runs on a device. encodeURIComponent is in every engine.
 */
export function adConsentUrl(c: AdChannel, state: string): string {
  const q = (pairs: [string, string][]) => pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  switch (c) {
    case 'meta':
      return `https://www.facebook.com/v21.0/dialog/oauth?${q([
        ['client_id', META_ADS_CLIENT_ID],
        ['redirect_uri', AD_OAUTH_REDIRECT],
        ['response_type', 'code'],
        ['scope', AD_SCOPES],
        ['state', state],
      ])}`;
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?${q([
        ['client_id', GOOGLE_ADS_CLIENT_ID],
        ['redirect_uri', AD_OAUTH_REDIRECT],
        ['response_type', 'code'],
        ['scope', GOOGLE_ADS_SCOPE],
        // Both are required to be issued a refresh token, and a connection
        // without one works for an hour and then silently stops. `consent`
        // rather than `select_account` because Google withholds the refresh
        // token from an account that has granted this before, and a coach who
        // reconnects after a failure would get a connection that cannot renew.
        ['access_type', 'offline'],
        ['prompt', 'consent'],
        ['state', state],
      ])}`;
    case 'tiktok':
      return `https://business-api.tiktok.com/portal/auth?${q([
        ['app_id', TIKTOK_ADS_APP_ID],
        ['redirect_uri', AD_OAUTH_REDIRECT],
        ['state', state],
      ])}`;
  }
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
 * Open the channel's consent screen, then hand the code to the server.
 *
 * The code goes straight to the edge function and the app is told only which ad
 * accounts the login can see — an id, a name and a currency, none of it secret.
 * The token itself is never in this process.
 *
 * TikTok answers with `auth_code` where the other two answer with `code`; both
 * are read, because a provider's spelling of the same field is not worth a
 * second function.
 */
export async function connectAdChannel(c: AdChannel): Promise<ConnectResult> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to connect an ad account.' };
  if (!channelClientId(c)) return { ok: false, reason: channelSetupNote(c) };

  const WB = webBrowser();
  if (!WB?.openAuthSessionAsync) {
    return { ok: false, reason: 'This version of the app cannot open a sign-in browser — updating to the latest build adds it. Entering what you spent by hand works now.' };
  }
  if (WB.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* ignore */ } }

  // A CSPRNG where the runtime has one — see src/lib/authNonce.ts for why this
  // is not the same call the scan ids make, and why it is not expo-crypto.
  // `strong` is deliberately not a gate: refusing to let somebody connect an
  // account on an older runtime is a worse trade than a weaker nonce, and a
  // weak nonce is still far better than none.
  const nonce = authNonce().value;
  const returnUrl = adReturnUrl();
  const state = adOauthState(nonce, returnUrl);

  let result: any;
  try {
    result = await WB.openAuthSessionAsync(adConsentUrl(c, state), returnUrl);
  } catch (e) {
    reportError('adSpend.consent', e);
    return { ok: false, reason: `The ${channelLabel(c)} sign-in could not be opened.` };
  }
  if (!result || result.type !== 'success' || !result.url) {
    if (result?.type === 'dismiss' || result?.type === 'cancel') return { ok: false, reason: 'Sign-in cancelled — nothing was connected.' };
    return { ok: false, reason: `The ${channelLabel(c)} sign-in did not come back, so nothing was connected.` };
  }

  const params = queryOf(String(result.url));
  const err = params.error_description || params.error || params.error_message;
  if (err) return { ok: false, reason: `${channelLabel(c)} refused the sign-in: ${err}` };
  if (params.state !== state) {
    return { ok: false, reason: 'That sign-in did not come back from where it was sent, so nothing was connected. Try again from this screen.' };
  }
  const code = params.code || params.auth_code || '';
  if (!code) return { ok: false, reason: `${channelLabel(c)} came back without a sign-in code, so nothing was connected.` };

  try {
    const { data, error } = await supabase.functions.invoke(fn(c, 'connect'), {
      body: { action: 'connect', code, redirect_uri: AD_OAUTH_REDIRECT },
    });
    if (error || (data as any)?.ok === false) {
      const detail = (data as any)?.error || (error as any)?.message || 'The server could not finish connecting.';
      reportError('adSpend.exchange', detail);
      return { ok: false, reason: String(detail) };
    }
    const d = data as any;
    return { ok: true, channel: c, chosen: d?.chosen ?? null, accounts: Array.isArray(d?.accounts) ? d.accounts : [], warning: d?.warning };
  } catch (e) {
    reportError('adSpend.exchange', e);
    return { ok: false, reason: `The server could not finish connecting your ${channelLabel(c)} account.` };
  }
}

/** Say which ad account this connection is about. Verified server-side. */
export async function chooseAdAccount(c: AdChannel, accountId: string): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { data, error } = await supabase.functions.invoke(fn(c, 'choose'), { body: { action: 'choose', account_id: accountId } });
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
 * Check one channel now.
 *
 * A failure is reported AND recorded server-side, so the screen can show that
 * this channel's last attempt failed rather than showing the previous
 * successful check's date as though nothing had happened since.
 */
export async function runAdSync(c: AdChannel): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to check your ad spend.' };
  try {
    const { data, error } = await supabase.functions.invoke(fn(c, 'sync'), { body: { action: 'sync' } });
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
 * Disconnect one channel. The check history and the recorded figures stay —
 * what a campaign cost last month did not stop being true.
 *
 * What DOES change is the combined figure, and it changes for the better: a
 * coach who disconnects the channel that would not read gets their total back,
 * because the sum is then over the channels that remain. Part 350's
 * disconnect_ad_account() recomputes it in the same transaction.
 */
export async function disconnectAdChannel(c: AdChannel): Promise<Ad> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { error } = await supabase.rpc('disconnect_ad_account', { p_provider: c });
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

/**
 * Replace one code's typed figure with the collected one, at the coach's word.
 *
 * The figure taken is the SUM across every connected channel, and the server
 * refuses outright where a channel is unread — see part 350. "Use the collected
 * figure" must never be a way to end up with a figure that is missing a channel,
 * and the refusal comes back here as the reason the coach is shown.
 */
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
