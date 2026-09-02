// The app's side of posting one card to Instagram: connecting an account,
// asking whether one is connected, and handing over a JPEG.
//
// ── No token reaches this file, and none can ──────────────────────────────
//
// `instagram_accounts` has no policy and no grant for `authenticated` (part
// 401), so there is nothing here to read even by accident. What the screen gets
// is `my_instagram_account()`, a SECURITY DEFINER function returning flags and
// names. The exchange, the token and the publish all happen in
// supabase/functions/instagram-publish — see its header, and see
// supabase/functions/ocr-scan/index.ts for the key that once shipped readable
// inside the JavaScript bundle, which is why this rule is absolute.
//
// ── What this module will not do ──────────────────────────────────────────
//
// Publish a card with a client's photograph on it. `publishCardToInstagram`
// takes a `PublishableCard`, which only `checkPublishable` in
// src/lib/instagramPublish.ts can produce, and which that function refuses to
// produce for a card whose `photo` is non-null. There is no second argument to
// override it and no branch that skips it: a card with a photograph has no
// value of that type in existence anywhere, so it cannot be passed to this.
//
// The share sheet in src/lib/social.ts stays for exactly those cards, and for
// every card, and for every other network.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { appLink } from '../lib/deepLink';
import type { LoadStatus } from './loadStatus';
import { connectionState, type ConnectionState, type PublishableCard } from '../lib/instagramPublish';
// Settled in every binary — scripts/check-native.mjs's SETTLED_IN_EVERY_BINARY
// list carries it at c4c6299, 17 July — so it is imported directly here for the
// reason src/ui/coachLogo.ts gives beside the same import. The rule about bare
// imports of native modules is about modules that THROW on an older binary, and
// this cannot be in one.
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * The Meta app id, public by design: it appears in the consent URL every coach's
 * browser sees. The SECRET that pairs with it is a Supabase secret and is read
 * only inside the edge function.
 *
 * Read as the literal `process.env.EXPO_PUBLIC_…` member expression, because
 * Expo's Babel plugin substitutes that exact AST shape at build time and
 * nothing else — `(process.env as any)?.X` reads undefined from a bundle whose
 * process.env is empty, which is how Spotify's client id came to be reported as
 * unconfigured when it had been set all along.
 *
 * It may be the same Meta app as the ads one, or a different one. Nothing here
 * assumes either: they are separate values so that a project can have ad
 * reading approved and content publishing not, which is the likely order.
 */
export const INSTAGRAM_CLIENT_ID = process.env.EXPO_PUBLIC_INSTAGRAM_CLIENT_ID ?? '';

/**
 * Where Meta sends the coach back to.
 *
 * The SAME page the ad-account sign-in uses, deliberately. Facebook Login will
 * not accept a custom scheme in Valid OAuth Redirect URIs at all, so this has
 * to be an https address that forwards the query string on to the app — and
 * building a second forwarding page for the second Meta flow would be a second
 * thing to register, a second thing to deploy and a second thing to get wrong.
 * The app's own scheme travels in `state`, which is what makes one page enough
 * for every brand and every flow.
 */
export const INSTAGRAM_OAUTH_REDIRECT = 'https://www.repplefitness.com/ads/callback';

/** This build's own deep link, resolved from the scheme the binary ships. */
export function instagramReturnUrl(): string {
  return appLink('share-kit/instagram');
}

/**
 * The permissions a post needs, and nothing beyond them.
 *
 *   instagram_basic            read the account this posts to
 *   instagram_content_publish  THE one. Behind Meta App Review.
 *   pages_show_list            list the Pages, to find the linked account
 *   pages_read_engagement      read a Page's linked Instagram account
 *
 * Asking for more than the job requires is how an app fails review and how a
 * coach comes to grant something they did not need to.
 */
export const INSTAGRAM_SCOPES = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement';

/** The consent URL. Public values only. */
export function instagramConsentUrl(state: string): string {
  const q = (pairs: [string, string][]) => pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://www.facebook.com/v21.0/dialog/oauth?${q([
    ['client_id', INSTAGRAM_CLIENT_ID],
    ['redirect_uri', INSTAGRAM_OAUTH_REDIRECT],
    ['response_type', 'code'],
    ['scope', INSTAGRAM_SCOPES],
    ['state', state],
  ])}`;
}

/* ── what the screen may know ─────────────────────────────────────────────── */

/** Flags and names. Never a token: there is none to be had here. */
export interface InstagramAccount {
  pageName: string | null;
  username: string | null;
  /** An account has been chosen and a post has somewhere to go. */
  ready: boolean;
  expiresSoon: boolean;
  connectedAt: string | null;
}

export interface InstagramRead {
  status: LoadStatus;
  account: InstagramAccount | null;
  /** Never 'connected' under a failed read. See src/lib/instagramPublish.ts. */
  state: ConnectionState;
  reload: () => void;
}

/**
 * Whether this coach has Instagram connected.
 *
 * `account` is null under anything but a landed read, and `status` says which —
 * the pairing src/ui/loadStatus.ts asks for. A read that failed produces
 * 'unknown' rather than 'not-connected', because telling a coach they have
 * nothing connected when the question was never answered sends them to
 * reconnect an account that was already there.
 */
export function useMyInstagram(): InstagramRead {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [account, setAccount] = useState<InstagramAccount | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    if (!USE_SUPABASE) { setStatus('ready'); setAccount(null); return; }
    // Nothing is asked when this build could not use the answer. A project
    // that has not applied part 401 yet would otherwise log a failed read for
    // every coach who opens the Share Kit, about a feature that is switched
    // off — and `connectionState` already answers 'unconfigured' here.
    if (!INSTAGRAM_CLIENT_ID) { setStatus('ready'); setAccount(null); return; }
    setStatus('loading');
    (async () => {
      try {
        const { data, error } = await supabase.rpc('my_instagram_account');
        if (!live) return;
        if (error) {
          reportError('instagram.read', error);
          setAccount(null);
          setStatus('error');
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        setAccount(row
          ? {
            pageName: row.page_name ?? null,
            username: row.ig_username ?? null,
            ready: !!row.ready,
            expiresSoon: !!row.expires_soon,
            connectedAt: row.connected_at ?? null,
          }
          : null);
        setStatus('ready');
      } catch (e) {
        if (!live) return;
        reportError('instagram.read', e);
        setAccount(null);
        setStatus('error');
      }
    })();
    return () => { live = false; };
  }, [nonce]);

  return {
    status,
    account,
    state: connectionState(!!INSTAGRAM_CLIENT_ID, status, !!account?.ready),
    reload,
  };
}

/* ── connecting ───────────────────────────────────────────────────────────── */

export interface PageChoice { id: string; name: string; igUsername: string | null; hasInstagram: boolean }
export type ConnectResult =
  | { ok: true; chosen: PageChoice | null; pages: PageChoice[]; warning?: string }
  | { ok: false; reason: string };
export type Acted = { ok: true } | { ok: false; reason: string };

function webBrowser(): any {
  // Lazily required, the same as src/ui/adSpend.ts: an over-the-air update onto
  // a build made before expo-web-browser was added would otherwise crash on
  // import rather than saying plainly that this build cannot do it yet.
  try { return require('expo-web-browser'); } catch { return null; }
}

/** The `state` Meta echoes back: a nonce, checked on return, plus this build's
 *  own return URL so the one shared callback page can forward to whichever
 *  brand's app started the sign-in. Same separator and same reasoning as
 *  `adOauthState`. */
export function instagramOauthState(nonce: string, returnUrl: string): string {
  return `${nonce}~${returnUrl}`;
}

/** The query string of a URL, read without URLSearchParams — React Native's
 *  polyfill for it is partial and this runs on a device. */
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
 * The code goes straight to the edge function and the app is told only which
 * Pages the login can see: an id, a name, and whether an Instagram account is
 * attached. No token is in this process at any point.
 */
export async function connectInstagram(): Promise<ConnectResult> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to connect Instagram.' };
  if (!INSTAGRAM_CLIENT_ID) {
    return { ok: false, reason: 'Posting straight to Instagram is not switched on in this build, so there is nothing to connect to yet. Your share sheet posts the same card in the meantime.' };
  }

  const WB = webBrowser();
  if (!WB?.openAuthSessionAsync) {
    return { ok: false, reason: 'This version of the app cannot open a sign-in browser. Updating to the latest build adds it, and your share sheet works now.' };
  }
  if (WB.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* ignore */ } }

  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const returnUrl = instagramReturnUrl();
  const state = instagramOauthState(nonce, returnUrl);

  let result: any;
  try {
    result = await WB.openAuthSessionAsync(instagramConsentUrl(state), returnUrl);
  } catch (e) {
    reportError('instagram.consent', e);
    return { ok: false, reason: 'The Instagram sign-in could not be opened.' };
  }
  if (!result || result.type !== 'success' || !result.url) {
    if (result?.type === 'dismiss' || result?.type === 'cancel') return { ok: false, reason: 'Sign-in cancelled, and nothing was connected.' };
    return { ok: false, reason: 'The Instagram sign-in did not come back, so nothing was connected.' };
  }

  const params = queryOf(String(result.url));
  const err = params.error_description || params.error || params.error_message;
  if (err) return { ok: false, reason: `Meta refused the sign-in: ${err}` };
  if (params.state !== state) {
    return { ok: false, reason: 'That sign-in did not come back from where it was sent, so nothing was connected. Try again from this screen.' };
  }
  const code = params.code || '';
  if (!code) return { ok: false, reason: 'Meta came back without a sign-in code, so nothing was connected.' };

  try {
    const { data, error } = await supabase.functions.invoke('instagram-publish', {
      body: { action: 'connect', code, redirect_uri: INSTAGRAM_OAUTH_REDIRECT },
    });
    if (error || (data as any)?.ok === false) {
      const detail = (data as any)?.error || (error as any)?.message || 'The server could not finish connecting.';
      reportError('instagram.exchange', detail);
      return { ok: false, reason: String(detail) };
    }
    const d = data as any;
    return { ok: true, chosen: d?.chosen ?? null, pages: Array.isArray(d?.pages) ? d.pages : [], warning: d?.warning };
  } catch (e) {
    reportError('instagram.exchange', e);
    return { ok: false, reason: 'The server could not finish connecting your Instagram account.' };
  }
}

/** Say which Page, and therefore which Instagram account. Verified server-side
 *  against the token, never trusted from here. */
export async function chooseInstagramPage(pageId: string): Promise<Acted> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { data, error } = await supabase.functions.invoke('instagram-publish', { body: { action: 'choose', page_id: pageId } });
    if (error || (data as any)?.ok === false) {
      const detail = (data as any)?.error || (error as any)?.message || 'That account could not be saved.';
      reportError('instagram.choose', detail);
      return { ok: false, reason: String(detail) };
    }
    return { ok: true };
  } catch (e) {
    reportError('instagram.choose', e);
    return { ok: false, reason: 'That account could not be saved.' };
  }
}

/** Drop the credential. The post history stays: what was published did not stop
 *  having been published. */
export async function disconnectInstagram(): Promise<Acted> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first.' };
  try {
    const { error } = await supabase.rpc('disconnect_instagram');
    if (error) {
      reportError('instagram.disconnect', error);
      return { ok: false, reason: 'That could not be disconnected, so your Instagram account is still linked.' };
    }
    return { ok: true };
  } catch (e) {
    reportError('instagram.disconnect', e);
    return { ok: false, reason: 'That could not be disconnected, so your Instagram account is still linked.' };
  }
}

/* ── posting ──────────────────────────────────────────────────────────────── */

/**
 * What actually happened, in Meta's terms rather than in ours.
 *
 * `published` is true only when Meta returned a media id. A container that was
 * created is reported as its own thing, because it is: it is an upload that has
 * not been published and may never be, and calling it a post is the exact
 * defect src/lib/social.ts was written to end.
 */
export type PostResult =
  | { ok: true; permalink: string | null; warning?: string }
  | { ok: false; reason: string; containerCreated: boolean };

/**
 * The rendered PNG as JPEG bytes, base64, or null with a reason.
 *
 * react-native-svg exports PNG and Instagram's feed endpoint takes JPEG only,
 * so the conversion is not optional. It goes through a file because
 * ImageManipulator reads a URI: expo-file-system's two generations are both
 * asked about, because SDK 54 replaced `cacheDirectory`/`writeAsStringAsync`
 * with `Paths.cache`/`new File()` and left the old names on the module as stubs
 * that THROW when called — a probe naming only one of them gets a confident
 * wrong answer, which is the fault src/lib/social.ts documents at length.
 */
async function pngToJpegBase64(pngBase64: string, filename: string): Promise<{ base64: string } | { error: string }> {
  let FileSystem: any = null;
  try { FileSystem = require('expo-file-system'); } catch { /* older binary */ }

  const canWrite = !!(FileSystem?.Paths?.cache && FileSystem?.File)
    || !!(FileSystem?.cacheDirectory && FileSystem?.writeAsStringAsync);
  if (!canWrite) {
    return { error: 'This version of the app can’t prepare a JPEG for Instagram. Update to the next release, and share the card from your share sheet in the meantime.' };
  }

  let uri: string;
  try {
    const png = filename.replace(/\.jpg$/i, '.png');
    if (FileSystem?.Paths?.cache && FileSystem?.File) {
      const f = new FileSystem.File(FileSystem.Paths.cache, png);
      // A card posted a minute ago is still at this path on a second post
      // within the same minute, and create() refuses an existing one.
      f.create({ overwrite: true, intermediates: true });
      // Synchronous in the new API: write returns void, so awaiting it would
      // silently succeed on a failed write.
      f.write(pngBase64, { encoding: 'base64' });
      uri = f.uri;
    } else {
      uri = FileSystem.cacheDirectory + png;
      // Must stay awaited on the old API: converting a file before its bytes
      // are on disk produces an empty JPEG, which posts as a blank square.
      await FileSystem.writeAsStringAsync(uri, pngBase64, { encoding: FileSystem.EncodingType?.Base64 ?? 'base64' });
    }
  } catch (e) {
    reportError('instagram.writePng', e);
    return { error: 'The card could not be saved to your phone before posting, so nothing was sent.' };
  }

  try {
    const out = await ImageManipulator.manipulateAsync(uri, [], {
      // 0.92 rather than 1.0. A card is flat colour and large type, so the
      // difference is invisible and the file is a third of the size — which
      // matters because it crosses the network twice, once to Repple and once
      // to Meta.
      compress: 0.92,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!out?.base64) return { error: 'The card could not be turned into a JPEG, so nothing was sent to Instagram.' };
    return { base64: out.base64 };
  } catch (e) {
    reportError('instagram.jpeg', e);
    return { error: 'The card could not be turned into a JPEG, so nothing was sent to Instagram.' };
  }
}

/**
 * Post one card.
 *
 * The argument is a `PublishableCard`, which is the whole safety story in one
 * line: only `checkPublishable` produces one, and it refuses a card carrying a
 * client's photograph. There is no parameter here that could carry a photo and
 * no shape of call that could smuggle one in.
 *
 * `kind` is carried for the post record and is the card's kind, not its
 * contents. Nothing about the figures, the caption's subject or the client
 * leaves in that field.
 */
export async function publishCardToInstagram(
  card: PublishableCard, pngBase64: string, kind: string,
): Promise<PostResult> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to post.', containerCreated: false };
  if (!pngBase64) {
    return { ok: false, reason: 'Your phone could not turn the card into an image, so nothing was sent to Instagram. The caption and the card are unchanged.', containerCreated: false };
  }

  const jpeg = await pngToJpegBase64(pngBase64, card.filename);
  if ('error' in jpeg) return { ok: false, reason: jpeg.error, containerCreated: false };

  try {
    const { data, error } = await supabase.functions.invoke('instagram-publish', {
      body: {
        action: 'publish',
        jpeg_base64: jpeg.base64,
        caption: card.caption,
        width: card.width,
        height: card.height,
        kind,
        // The declaration the server checks. `card.photo` is `null` in the
        // type, so this cannot say anything else without the type being
        // subverted first.
        photo: card.photo === null ? 'none' : 'client-photo',
      },
    });
    if (error || (data as any)?.ok === false) {
      const d = data as any;
      const detail = d?.error || (error as any)?.message || 'Instagram could not be reached, so nothing was posted.';
      reportError('instagram.publish', detail);
      return { ok: false, reason: String(detail), containerCreated: !!d?.containerId };
    }
    const d = data as any;
    return { ok: true, permalink: d?.permalink ?? null, warning: d?.warning };
  } catch (e) {
    reportError('instagram.publish', e);
    return { ok: false, reason: 'Instagram could not be reached, so nothing was posted. Your card is unchanged.', containerCreated: false };
  }
}
