// The one place this app talks to a calendar that is not on the phone.
//
// src/ui/deviceBusy.ts is the same file for the handset's own diary, and the
// two are deliberately shaped alike: nothing here throws, every failure comes
// back as a status the sheet can put into words, and an empty list always
// arrives with something that says whether it means "clear" or "unknown".
//
// ── No secret is in this file, and none is in the bundle ──────────────────
//
// The client id is public — it is in the consent URL Google shows the coach.
// The client SECRET, if the deployment's OAuth client has one at all, is a
// Supabase secret read only inside supabase/functions/calendar-sync. The code
// this file gets back from Google is handed straight to that function, which
// does the exchange and stores the refresh token in a table with no select
// policy. Nothing token-shaped is ever held on the handset, in AsyncStorage or
// anywhere else.
//
// ── The read is times, and the SCOPE is what makes that true ──────────────
//
// The grant asked for below is `calendar.freebusy`, which can call exactly one
// Google endpoint and gets back start/end pairs. There is no title in the
// response to drop, because the permission Repple holds cannot see one. The
// edge function narrows even that to epoch milliseconds, and
// `remoteBusySpans` reads two properties off what arrives. See the header of
// src/lib/calendarSync.ts.
//
// ── The write is asked for separately, when it is turned on ───────────────
//
// Connecting requests the read scope ALONE. A coach who wants their Repple
// sessions in their Google calendar consents a second time, at the moment they
// ask for it, and that second consent is the only thing that ever grants this
// app `calendar.app.created`. Asking for the power to write to somebody's
// diary in order to read their free time is the kind of over-request that
// makes a consent screen meaningless.
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import type { BusySpan } from '../lib/deviceBusy';
import {
  GOOGLE_READ_SCOPE, GOOGLE_WRITE_SCOPE, NO_CALENDAR_LINK,
  remoteBusySpans, reversedClientRedirect,
  type CalendarLink, type PushResult, type SyncWireEvent,
} from '../lib/calendarSync';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * The Google OAuth client id for this build, as the literal member expression.
 *
 * Expo's Babel plugin substitutes `process.env.EXPO_PUBLIC_X` by matching that
 * exact AST shape. A cast, optional chaining, a computed key or an alias all
 * read undefined out of a bundle whose process.env is empty — which is exactly
 * how src/lib/spotify.ts told users the OWNER had not configured a client id
 * that was in .env and in all eight build profiles the whole time.
 */
const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID ?? '';

/**
 * Where Google sends the coach back, and it must match what is registered.
 *
 * An iOS or Android OAuth client's redirect is the client id reversed, so it is
 * DERIVED — one value for the owner to set, and no way to set the second one
 * inconsistently with the first. A Web-type client uses an https redirect that
 * cannot be derived from anything and is given outright instead.
 *
 * `OAUTH_REDIRECT` in src/lib/wearables/oauthConfig.ts is the write-up of what
 * a wrong redirect costs: the browser closes on an unhandled scheme and the
 * connection never completes, with no error anywhere for anybody to read.
 */
const REDIRECT_URI =
  (process.env.EXPO_PUBLIC_GOOGLE_CALENDAR_REDIRECT ?? '').trim()
  || reversedClientRedirect(CLIENT_ID)
  || '';

/** Whether this build can offer the connection at all. False is a state the
 *  screen SAYS — never a button that does nothing, and never a silently empty
 *  calendar. */
export const CALENDAR_SYNC_CONFIGURED = CLIENT_ID.length > 0 && REDIRECT_URI.length > 0;

function authSession(): any {
  try { return require('expo-auth-session'); } catch { return null; }
}
function webBrowser(): any {
  try { return require('expo-web-browser'); } catch { return null; }
}

/* ── the link ─────────────────────────────────────────────────────────────── */

export interface CalendarLinkRead {
  status: LoadStatus;
  link: CalendarLink;
}

/**
 * Whether this account has a Google calendar linked.
 *
 * Through `my_calendar_links()`, which returns flags and an expiry and never
 * token material — supabase/parts/360, and the same arrangement part 77 made
 * for wearables after a display bug nearly bought a SELECT policy on a table
 * full of OAuth tokens.
 *
 * 'error' with the disconnected default is UNKNOWN, not "not connected". The
 * screen must not offer a Connect button as though nothing were there when the
 * truth is that we could not ask.
 */
export async function readCalendarLink(): Promise<CalendarLinkRead> {
  try {
    const { data, error } = await supabase.rpc('my_calendar_links');
    if (error) {
      reportError('calendarSync.readLink', error.message);
      return { status: 'error', link: NO_CALENDAR_LINK };
    }
    const row = (Array.isArray(data) ? data : []).find(
      (r: { provider?: unknown }) => r?.provider === 'google',
    );
    if (!row) return { status: 'ready', link: NO_CALENDAR_LINK };
    return {
      status: 'ready',
      link: {
        provider: 'google',
        connected: true,
        hasRefresh: row.has_refresh === true,
        writeEnabled: row.write_enabled === true,
        hasWriteCalendar: row.has_write_calendar === true,
      },
    };
  } catch (e) {
    reportError('calendarSync.readLink', e instanceof Error ? e.name : 'link read failed');
    return { status: 'error', link: NO_CALENDAR_LINK };
  }
}

/**
 * Run the Google consent flow and hand the code to the server.
 *
 * `withWrite` decides which scopes are asked for, and it is false everywhere
 * except the moment a coach turns writing on. `include_granted_scopes` means
 * the second consent adds to the first rather than replacing it, so a coach who
 * enables writing does not lose the read they already granted.
 *
 * `prompt=consent` is not politeness. Google issues a refresh token on the
 * first grant and then only when consent is re-forced; without it a coach who
 * reconnects gets an access token that dies in an hour and a connection that
 * cannot renew itself. `LINK_NOTES['needs-reconnect']` is the sentence for when
 * it happens anyway.
 *
 * Throws with a message the coach can act on. Every caller shows it.
 */
export async function connectGoogleCalendar(withWrite = false): Promise<void> {
  if (!CALENDAR_SYNC_CONFIGURED) {
    throw new Error('Google Calendar is not set up in this version of Repple, so there is nothing here to sign in to.');
  }
  const AuthSession = authSession();
  if (!AuthSession) {
    throw new Error('This build cannot open a sign in browser yet. Reading your phone calendar and blocking time by hand both work today.');
  }
  const WB = webBrowser();
  if (WB?.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* nothing pending */ } }

  const discovery = { authorizationEndpoint: AUTHORIZE_URL, tokenEndpoint: TOKEN_URL };
  const scopes = withWrite ? [GOOGLE_READ_SCOPE, GOOGLE_WRITE_SCOPE] : [GOOGLE_READ_SCOPE];
  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    scopes,
    redirectUri: REDIRECT_URI,
    usePKCE: true,
    responseType: 'code',
    extraParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);

  if (!result || result.type !== 'success' || !result.params?.code) {
    if (result?.type === 'dismiss' || result?.type === 'cancel') throw new Error('Sign in cancelled.');
    // Say what Google said. An OAuth refusal arrives as `?error=` and
    // `?error_description=` on the redirect, and those are the only thing that
    // separates an unregistered redirect from a wrong client id from an API
    // that was never switched on — three faults with three different remedies,
    // all of which read as one sentence with no next step when the reason is
    // discarded. src/lib/wearables/oauth.ts cost a whole diagnosis to that.
    const err = String(result?.params?.error ?? '').trim();
    const desc = String(result?.params?.error_description ?? '').replace(/\+/g, ' ').trim();
    if (err || desc) throw new Error(`Google refused the sign in: ${desc || err}.`);
    throw new Error('Could not finish signing in to Google, and Google did not say why.');
  }

  const { data, error } = await supabase.functions.invoke('calendar-sync', {
    body: {
      action: 'connect',
      code: result.params.code,
      code_verifier: request.codeVerifier ?? null,
      redirect_uri: REDIRECT_URI,
    },
  });
  const detail = (data as any)?.error || (error as any)?.message;
  if (detail) {
    reportError('calendarSync.connect', String(detail));
    throw new Error(String(detail));
  }
}

/** Drop the connection: Repple's calendar is removed from Google, the grant is
 *  revoked, and the stored credential is deleted. */
export async function disconnectGoogleCalendar(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('calendar-sync', { body: { action: 'disconnect' } });
  const detail = (data as any)?.error || (error as any)?.message;
  if (detail) {
    reportError('calendarSync.disconnect', String(detail));
    throw new Error(String(detail));
  }
}

/* ── reading somebody else's calendar ─────────────────────────────────────── */

export interface RemoteBusyRead {
  /** 'ready' when Google answered. 'error' means the read did not happen, and
   *  an empty list under it means UNKNOWN rather than free — which is the whole
   *  reason this type is not just an array. */
  status: LoadStatus;
  spans: BusySpan[];
}

/**
 * When the coach is busy on their Google calendar, between two instants.
 *
 * Never throws. The reason for a failure is a fixed code the server chose
 * (`freebusy_http_403`), never Google's own message: a Google calendar is named
 * by an e-mail address and its error text quotes it, and `reportError` writes
 * into a table the gym owner can read. src/ui/deviceBusy.ts refuses to log the
 * caught value for the same reason.
 */
export async function readRemoteBusy(fromMs: number, toMs: number): Promise<RemoteBusyRead> {
  try {
    const { data, error } = await supabase.functions.invoke('calendar-sync', {
      body: { action: 'busy', fromMs, toMs },
    });
    if (error) {
      reportError('calendarSync.busy', 'invoke failed');
      return { status: 'error', spans: [] };
    }
    const payload = data as any;
    if (!payload?.ok) {
      reportError('calendarSync.busy', String(payload?.reason || payload?.error || 'busy read refused'));
      return { status: 'error', spans: [] };
    }
    // The narrowing, again, on this side of the wire. Two properties.
    return { status: 'ready', spans: remoteBusySpans(payload.spans) };
  } catch (e) {
    reportError('calendarSync.busy', e instanceof Error ? e.name : 'busy read failed');
    return { status: 'error', spans: [] };
  }
}

/* ── writing into somebody else's calendar ────────────────────────────────── */

/**
 * Turn writing on or off.
 *
 * Turning it ON runs a fresh consent that adds the `calendar.app.created`
 * scope, and only then asks the server to make the calendar. Two round trips,
 * on purpose: the coach sees Google's own screen naming the new permission at
 * the moment they ask for it, rather than having agreed to it days earlier as
 * part of a read.
 *
 * Turning it OFF stops writing and leaves what is already there. Deleting a
 * record of sessions that happened is what DISCONNECT does, and it is a bigger
 * button with a different sentence on it.
 */
export async function setCalendarWrite(enabled: boolean, label: string): Promise<void> {
  if (enabled) await connectGoogleCalendar(true);
  const { data, error } = await supabase.functions.invoke('calendar-sync', {
    body: { action: 'write', enabled, label },
  });
  const detail = (data as any)?.error || (data as any)?.reason || (error as any)?.message;
  if (detail) {
    reportError('calendarSync.write', String(detail));
    throw new Error(
      enabled
        ? 'Repple could not make a calendar in your Google account, so nothing is being written. Your sessions in Repple are unaffected.'
        : 'Repple could not turn writing off. Try again, or disconnect Google entirely.',
    );
  }
}

export type PushOutcome =
  | { ok: true; result: PushResult }
  /** `partial` is what the server had already done when it stopped, and it is
   *  carried rather than dropped because a half-written calendar reported as an
   *  untouched one is the same lie as a false count. Null when the server did
   *  not say — a transport failure, or a refusal before any write. */
  | { ok: false; reason: string; partial: PushResult | null };

/** The counts off a push response, whether it succeeded or stopped part-way.
 *  `|| 0` on each, because a field the server did not send must not become NaN
 *  in a sentence a coach reads. */
function pushCounts(payload: any): PushResult {
  return {
    created: Number(payload?.created) || 0,
    updated: Number(payload?.updated) || 0,
    removed: Number(payload?.removed) || 0,
  };
}

/**
 * Send the coach's booked sessions to the calendar Repple made.
 *
 * The payload is `SyncWireEvent[]` and that type has three string fields, none
 * of which could carry a client's name. The server builds the event body from a
 * fixed template and drops anything else it is given.
 *
 * `label` is the brand's name, and it is here for a repair rather than for a
 * first run: the coach is invited to delete Repple's calendar (see
 * WRITE_PRIVACY_NOTE) and the server re-creates it when the events listing
 * comes back 404, which needs a name for it. The server sanitises the string
 * and falls back to its own default, so an old build that sends nothing still
 * recovers — with a generic name rather than the brand's.
 */
export async function pushSessions(
  events: readonly SyncWireEvent[],
  fromMs: number,
  toMs: number,
  label: string,
): Promise<PushOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('calendar-sync', {
      body: { action: 'push', fromMs, toMs, events, label },
    });
    if (error) return { ok: false, reason: 'Repple could not reach the server to write your sessions.', partial: null };
    const payload = data as any;
    if (!payload?.ok) {
      reportError('calendarSync.push', String(payload?.reason || payload?.error || 'push refused'));
      return {
        ok: false,
        reason: 'Your sessions could not all be written to Google just now. Nothing in Repple has changed.',
        partial: pushCounts(payload),
      };
    }
    return { ok: true, result: pushCounts(payload) };
  } catch (e) {
    reportError('calendarSync.push', e instanceof Error ? e.name : 'push failed');
    return { ok: false, reason: 'Your sessions could not be written to Google just now. Nothing in Repple has changed.', partial: null };
  }
}

/**
 * How often the screen may push without being asked.
 *
 * A sync the coach has to remember to press is a sync that goes stale, and a
 * stale sync on this feature is the double booking the whole item exists to
 * prevent. So the schedule screen pushes on its own when writing is on — but
 * not on every render, and not once per pull to refresh either. Fifteen minutes
 * is far inside the window in which a session could be booked and forgotten,
 * and far outside anything that would make the calendar screen chatty.
 *
 * Module-level rather than component state on purpose: the point is to be
 * per-app-session, so navigating away and back does not start it again.
 */
const PUSH_FLOOR_MS = 15 * 60 * 1000;
let lastPushMs = 0;

/** True when an automatic push is due. Marks it taken, so two callers in the
 *  same render cannot both fire one. */
export function pushIsDue(nowMs: number = Date.now()): boolean {
  if (nowMs - lastPushMs < PUSH_FLOOR_MS) return false;
  lastPushMs = nowMs;
  return true;
}

/** Forget the last push, so the next check fires. Called after the coach turns
 *  writing on — they have just asked for this and should not wait a quarter of
 *  an hour to see it happen. */
export const pushAgainSoon = (): void => { lastPushMs = 0; };
