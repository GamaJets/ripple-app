// Coach · a calendar that lives somewhere else.
//
// ── What this is, next to S6 ──────────────────────────────────────────────
//
// src/lib/deviceBusy.ts reads the diary on the PHONE. That covers a coach who
// keeps their life in the calendar app on the handset Repple is installed on,
// and it covers nobody else: the coach whose appointments live in a Google
// account they read on a laptop, the coach who has just changed phone, the
// coach on a work-issued handset with a separate personal account. For all of
// them the phone answers "nothing found", which is the truest empty list this
// app can produce and is still, on this screen, the wrong answer.
//
// So this adds a SECOND source of the same fact — when is the coach busy —
// and, for the first time in this app, a direction of travel back out.
//
// ── The rule S6 set, kept here, harder ────────────────────────────────────
//
// TIMES ONLY. NEVER TITLES, ATTENDEES, NOTES OR LOCATIONS.
//
// `toBusySpan` in deviceBusy.ts reads exactly `startDate` and `endDate` off a
// native object. A remote calendar is worse: an events.list response hands back
// the summary, the description, the location, the organiser's e-mail address,
// every attendee's e-mail address and response, the conferencing link, the
// recurrence rule and the private notes, all in one JSON body, and any of it
// would be one `...spread` away from a row a gym owner can read.
//
// Two things stop that, and the first one is not our code:
//
//   1. THE SCOPE. Repple asks Google for `calendar.freebusy` and nothing more.
//      That scope can call exactly one endpoint — POST /freeBusy — and that
//      endpoint's entire response for a calendar is a list of `{start, end}`.
//      There is no title in it to drop, because Google will not give this
//      grant one. A future edit cannot widen the read by writing more code;
//      it would have to change the scope, which invalidates every existing
//      consent and makes every coach re-authorise. That is the shape of a
//      boundary worth having.
//
//   2. `remoteBusySpan` below, which reads two properties off whatever came
//      back and returns two numbers, exactly as `toBusySpan` does — and hands
//      back the SAME `BusySpan` type, so the two sources merge into one list
//      through code that has never seen either calendar.
//
// ── The write direction, and what it may never touch ──────────────────────
//
// Reading is a copy. Writing is somebody else's calendar, and a sync that can
// modify or delete an entry a person made themselves is not a feature, it is a
// liability. So the write side is fenced twice, and again the first fence is
// not our code:
//
//   1. THE SCOPE. `calendar.app.created` grants access to calendars THIS
//      APPLICATION CREATED and to nothing else in the account. Repple creates
//      one secondary calendar and writes only inside it. A bug that tried to
//      delete the coach's own primary entries would be refused by Google
//      before it reached them, because the grant does not reach them.
//
//   2. THE MARKER. Every event Repple writes carries an id beginning
//      `SYNC_ID_PREFIX`, derived from the Repple session's own uuid. Nothing
//      without that prefix is ever patched or deleted, even inside our own
//      calendar. The whole of Repple's footprint in somebody's Google account
//      is therefore removable by deleting one calendar.
//
// And what goes OUT is as narrow as what comes in. `syncWireEvent` below
// returns three strings — an id and two instants — and that is the entire
// payload the app is able to hand the server. There is no field on it that
// could carry a client's name, so no future edit can accidentally publish one
// to a third party the client has never heard of. The event Google ends up
// storing is titled "Coaching session" with no attendee, no location, no
// description and no guest: enough for the coach to see the hour is taken,
// and nothing at all about who it is with.
import { BRAND } from './brands';
import { localDate } from './localDate';
import type { BusySpan, BusyPermission, BusyView } from './deviceBusy';
import type { LoadStatus } from '../ui/loadStatus';

/* ── reading ──────────────────────────────────────────────────────────────── */

/**
 * The scopes Repple asks Google for, and the reason each is the narrow one.
 *
 * `calendar.freebusy` is not `calendar.readonly`. The readonly scope would let
 * this app list calendars and read every event on them in full; freebusy can
 * call one endpoint that answers in start/end pairs. The cost of choosing it is
 * real and is stated where the coach reads it: freeBusy can only be asked about
 * calendars this grant can name, so Repple asks about the account's PRIMARY
 * calendar. An appointment the coach files on a secondary calendar is not seen,
 * and `REMOTE_SCOPE_NOTE` says so rather than letting an incomplete answer read
 * as a complete one.
 *
 * `calendar.app.created` is likewise not `calendar.events`. It reaches only
 * calendars this application made.
 */
export const GOOGLE_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
export const GOOGLE_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

/** Which calendar the read covers, in the coach's words. */
export const REMOTE_SCOPE_NOTE =
  'Repple asks Google only when you are busy on your main calendar, and Google answers with times and nothing else. No title, no notes, no location and nobody you are meeting can be read, because the permission Repple holds cannot see any of it. Anything you keep on a second calendar is not covered.';

/**
 * Epoch milliseconds for a value off a remote calendar, or null.
 *
 * Two shapes arrive. A busy period is RFC3339 carrying its own offset
 * ('2026-09-08T09:00:00+02:00' or a 'Z'), which is an INSTANT and is parsed as
 * one. A floating all-day value is a bare 'YYYY-MM-DD', which is a DAY in the
 * coach's own life: `Date.parse` would resolve it to UTC midnight, which is the
 * previous afternoon in Kiritimati and the following morning in Midway, so it
 * goes through `localDate` and becomes local midnight. This repo has shipped
 * that exact bug twice, which is why src/lib/localDate.ts exists at all.
 *
 * A number is taken as epoch milliseconds. The server narrows Google's answer
 * to numbers before it leaves the edge function, so that is the normal path;
 * the string branches are what make this readable and testable without one.
 */
function remoteMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const d = localDate(v);
    const t = d ? d.getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * The two numbers, off whatever the remote calendar handed back, and nothing
 * else.
 *
 * `unknown` on purpose, exactly as `toBusySpan` takes `unknown`: typing this
 * parameter as a Google free/busy period would invite somebody to widen it one
 * field at a time, and there is nothing else on that object this app is allowed
 * to want. Every property read is written out below and there are two of them.
 *
 * Returns a `BusySpan` — the SAME two-number shape the phone's calendar
 * produces — so `busyCandidates` merges the two sources without ever knowing
 * there were two.
 */
export function remoteBusySpan(raw: unknown): BusySpan | null {
  if (!raw || typeof raw !== 'object') return null;
  const startMs = remoteMs((raw as { start?: unknown }).start);
  const endMs = remoteMs((raw as { end?: unknown }).end);
  if (startMs == null || endMs == null) return null;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Every readable period in a list, with the unreadable ones dropped. A dropped
 *  period is time the coach blocks by hand, which is what they do today; a
 *  guessed one is time nobody can book. */
export function remoteBusySpans(raw: unknown): BusySpan[] {
  if (!Array.isArray(raw)) return [];
  const out: BusySpan[] = [];
  for (const r of raw) {
    const s = remoteBusySpan(r);
    if (s) out.push(s);
  }
  return out;
}

/* ── two sources of the same fact ─────────────────────────────────────────── */

/** Where a busy period came from. Never shown to a client, and never attached
 *  to a period on screen either: a coach picking times to block does not need
 *  to know which of their two calendars produced each row, and the merge below
 *  makes the question meaningless anyway. */
export type SyncSource = 'device' | 'google';

/** What one source is doing. `active` is false for a source that is not in play
 *  at all — no native calendar in this binary, or no Google account linked —
 *  which is a different thing from a source that failed and must never be
 *  counted as one that answered. */
export interface BusySourceState {
  kind: SyncSource;
  active: boolean;
  status: LoadStatus;
  /** Only the phone has one. A refusal arrives as `status: 'ready'` with
   *  `permission: 'denied'`, because the operating system did answer. */
  permission?: BusyPermission;
}

/** What the sheet is showing, and which sources are not in it. */
export interface CombinedBusy {
  view: BusyView;
  /** Sources that were in play and did not answer — refused, or failed. Under
   *  any view at all, a non-empty list here means the periods on screen are not
   *  the whole account of the coach's time. */
  missing: SyncSource[];
}

/**
 * The state of a sheet fed by more than one calendar.
 *
 * `busyView` in deviceBusy.ts answers this for ONE source. Two sources make one
 * new way to be wrong and it is the same way the whole feature exists to
 * prevent: the phone answers, Google fails, the merged list is short, and a
 * sheet built on `count === 0` says "nothing in your calendar falls in this
 * window" — which is the sentence "you are free", said about a fortnight nobody
 * managed to read.
 *
 * So a source that failed is never silently dropped:
 *
 *   · every source in play still loading  → 'loading'
 *   · NO source answered                  → 'denied' when the only source is
 *                                            the phone and it refused us,
 *                                            'failed' otherwise
 *   · nothing found AND a source missing  → 'failed', never 'empty'
 *   · nothing found and every source in   → 'empty'
 *   · anything found                      → 'list', with `missing` naming the
 *                                            source the caller must warn about
 *
 * The last one is the deliberate choice. The periods that DID come back are
 * real and blockable, and hiding them behind an error would make a coach block
 * nothing at all; showing them without saying a calendar is absent would let
 * the list read as complete. Both are said at once.
 */
export function combineBusy(
  sources: readonly BusySourceState[],
  asked: boolean,
  count: number,
): CombinedBusy {
  const active = sources.filter((s) => s.active);
  // Nothing can be read on this build and nothing is linked. Saying so outranks
  // every other state, including a stale permission: offering a button that
  // cannot do anything is worse than saying why it is not there.
  if (active.length === 0) return { view: 'unavailable', missing: [] };
  if (!asked) return { view: 'ask', missing: [] };
  if (active.some((s) => s.status === 'loading')) return { view: 'loading', missing: [] };

  const missing = active
    .filter((s) => s.status === 'error' || s.permission === 'denied')
    .map((s) => s.kind);

  if (missing.length === active.length) {
    const onlyRefused = active.length === 1 && active[0].permission === 'denied';
    return { view: onlyRefused ? 'denied' : 'failed', missing };
  }
  // 'empty' is the one word that means "you are free", so it is reachable only
  // when every source in play answered.
  if (count === 0) return { view: missing.length > 0 ? 'failed' : 'empty', missing };
  return { view: 'list', missing };
}

/**
 * The sentence naming what is not in the list, or null when nothing is.
 *
 * Always ends by saying what the absence does NOT mean. That clause is the
 * whole point of the function: a coach who reads "your Google calendar could
 * not be read" and nothing else will still take the short list in front of them
 * as their week.
 */
export function missingSourceNote(missing: readonly SyncSource[]): string | null {
  if (missing.length === 0) return null;
  const both = missing.includes('device') && missing.includes('google');
  const what = both
    ? 'Neither your phone calendar nor your Google calendar could be read'
    : missing.includes('google')
      ? 'Your Google calendar could not be read'
      : 'Your phone calendar could not be read';
  return `${what}, so anything in it is missing from this list. This is not a statement that you are free at any of these times.`;
}

/* ── the link itself ──────────────────────────────────────────────────────── */

/** What the server says about a coach's Google connection. Names, flags and an
 *  expiry — never token material. The RPC behind it (`my_calendar_links`,
 *  supabase/parts/360) exists for exactly the reason `my_wearable_providers`
 *  does: answering "is this connected" must not require handing a screen an
 *  OAuth refresh token. */
export interface CalendarLink {
  provider: 'google';
  connected: boolean;
  /** Whether a refresh token was issued. Without one the connection dies about
   *  an hour after it is made and the only cure is reconnecting, so it is worth
   *  saying before that hour is up rather than after. */
  hasRefresh: boolean;
  /** Whether the coach has turned on writing, and whether the calendar Repple
   *  writes into has actually been created. The two are separate: the toggle is
   *  a decision and the calendar is a round trip that can fail. */
  writeEnabled: boolean;
  hasWriteCalendar: boolean;
}

export const NO_CALENDAR_LINK: CalendarLink = {
  provider: 'google',
  connected: false,
  hasRefresh: false,
  writeEnabled: false,
  hasWriteCalendar: false,
};

/** How the link row reads on the screen. Six states, and the two that matter
 *  most are the two that are NOT 'connected': a build with no client id is not
 *  a coach who has declined, and a connection with no refresh token is not a
 *  working one. */
export type LinkState =
  /** No Google client id in this build. Nobody can connect and it is not their
   *  fault; see `LINK_NOTES`. */
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  /** Connected, but Google issued no refresh token — the grant lasts about an
   *  hour. Reconnecting is the only fix. */
  | 'needs-reconnect'
  | 'connected'
  /** Connected and writing sessions back. */
  | 'two-way';

export function linkState(a: { configured: boolean; connecting: boolean; link: CalendarLink }): LinkState {
  if (!a.configured) return 'unconfigured';
  if (a.connecting) return 'connecting';
  if (!a.link.connected) return 'disconnected';
  if (!a.link.hasRefresh) return 'needs-reconnect';
  return a.link.writeEnabled && a.link.hasWriteCalendar ? 'two-way' : 'connected';
}

/**
 * What each link state says.
 *
 * 'unconfigured' is the one that has to be written carefully. A missing client
 * id is a thing the OWNER has not done, and the wearables screen already
 * learned what happens when the owner's setup instructions are printed to the
 * person holding the phone: src/lib/wearables/oauthConfig.ts has a whole field
 * (`clientNote`) that exists because a gym member was told to register an app
 * at dev.fitbit.com. So this says the gap is ours and points at the thing that
 * does work.
 */
export const LINK_NOTES: Record<LinkState, string> = {
  unconfigured: 'Repple has not finished setting Google Calendar up in this version, so there is nothing here to sign in to yet and nothing is wrong with your Google account. Reading your phone calendar and blocking time by hand both work today.',
  disconnected: 'Not connected. Repple reads nothing from Google until you sign in, and blocking time by hand is unaffected either way.',
  connecting: 'Waiting for Google to finish signing you in…',
  'needs-reconnect': 'Google did not give Repple permission to keep this connection alive, so it stops working about an hour after it is made. Connect again to fix it.',
  connected: 'Connected. Repple reads when you are busy on your main Google calendar, and writes nothing back.',
  'two-way': 'Connected. Repple reads when you are busy, and puts the sessions clients book into a separate calendar of its own.',
};

/* ── writing ──────────────────────────────────────────────────────────────── */

/**
 * The mark on everything Repple puts in somebody's Google account.
 *
 * Google requires an event id to be base32hex — the characters `a`-`v` and
 * `0`-`9` — which is why this is spelled with letters that survive the rule and
 * why a uuid's hex digits can be used verbatim. Every letter here is at or
 * below `v`; a prefix containing `w`, `x`, `y` or `z` would be rejected by
 * Google at insert time, on a call this repo has no way to exercise.
 *
 * It is a FIXED string and not the brand's, deliberately. A chain that rebrands
 * must not orphan every event Repple has already written, and an id is not a
 * label anybody reads.
 */
export const SYNC_ID_PREFIX = 'repple';

const SYNC_ID_RE = /^repple[0-9a-f]{32}$/;

/**
 * The Google event id for a Repple session, or null.
 *
 * Derived from the session's own uuid rather than allocated, which is what
 * makes writing idempotent: the same session pushed twice is the same event,
 * so a sync that runs on every refresh cannot fill somebody's calendar with
 * duplicates of the same Tuesday. Null rather than a guess for anything that is
 * not a uuid — an id we invented could collide with an event we did not write.
 */
export function syncEventId(sessionId: string): string | null {
  const hex = String(sessionId || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return SYNC_ID_PREFIX + hex;
}

/**
 * Whether an event id is one Repple minted.
 *
 * The gate on every patch and every delete, on top of the scope that already
 * confines those calls to a calendar this app created. Two fences rather than
 * one, because the thing on the other side of them is a person's diary and
 * because the outer fence is enforced by a Google grant that a future
 * re-authorisation could widen without anybody here noticing.
 */
export const isSyncEventId = (id: unknown): boolean =>
  typeof id === 'string' && SYNC_ID_RE.test(id);

/**
 * The WHOLE of what the app is able to send about a session.
 *
 * Three strings: an id we minted, and two instants. There is no field on this
 * object that could carry a client's name, a note, an address or a phone
 * number, so no future edit of the screen can publish one to Google by
 * accident — the wire simply has nowhere to put it. A test asserts the key set
 * outright, the same way deviceBusy.test.ts asserts that a `BusySpan` has two
 * keys and both are numbers.
 *
 * The event Google actually stores is built by the edge function from a fixed
 * template: summary 'Coaching session', no description, no location, no
 * attendees, no guests, no reminder overrides. The app cannot influence any of
 * it, which is the point.
 */
export interface SyncWireEvent {
  /** `SYNC_ID_PREFIX` + the session uuid's hex. */
  id: string;
  /** RFC3339, UTC. An instant, so the coach's calendar renders it in whatever
   *  zone their account is set to and a coach who travels is not shown their
   *  sessions an hour out. */
  startIso: string;
  endIso: string;
}

/** A session as this module needs to see it. Four fields off `TrainingSession`,
 *  named here so the pure half never touches the provider type. */
export interface SyncSessionInput {
  id: string;
  startsAt: string;
  durationMin: number;
  status: string;
}

/** How long a written event runs when the session does not say. The same
 *  default `sessions.duration_min` carries. */
const DEFAULT_MINUTES = 60;

/**
 * The events Repple would put in the coach's calendar for a window.
 *
 * BOOKED SESSIONS ONLY, and that is a decision rather than a filter. An open
 * slot is an offer, not a commitment, and writing every offered hour into
 * somebody's personal calendar would bury the appointments they actually have
 * under a wall of availability. A blocked period is already an absence and
 * writing it back would be Repple telling the coach's calendar what the coach's
 * calendar told Repple.
 *
 * Sorted by id so the plan is stable, and de-duplicated, so two calls with the
 * same sessions produce the same list and a diff against what is already there
 * has nothing spurious in it.
 */
export function plannedSyncEvents(
  sessions: readonly SyncSessionInput[],
  fromMs: number,
  toMs: number,
): SyncWireEvent[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  const seen = new Set<string>();
  const out: SyncWireEvent[] = [];
  for (const s of sessions) {
    if (!s || s.status !== 'booked') continue;
    const id = syncEventId(s.id);
    if (!id || seen.has(id)) continue;
    const startMs = Date.parse(String(s.startsAt));
    if (!Number.isFinite(startMs) || startMs < fromMs || startMs >= toMs) continue;
    const mins = Number(s.durationMin);
    const dur = Number.isFinite(mins) && mins > 0 ? Math.round(mins) : DEFAULT_MINUTES;
    seen.add(id);
    out.push({
      id,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(startMs + dur * 60000).toISOString(),
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** What the server did, as counts. Nothing about which sessions, because the
 *  coach does not need it and a log line naming one would be a client's
 *  appointment in a table. */
export interface PushResult {
  created: number;
  updated: number;
  removed: number;
}

/**
 * The one line a coach reads after their sessions were written.
 *
 * Zero of everything is a real and common outcome — a second run of an
 * unchanged week — and it says so plainly rather than reading as a failure,
 * because "nothing happened" and "nothing worked" are the pair this repo keeps
 * confusing and they have opposite next steps.
 */
export function pushSummaryLine(r: PushResult): string {
  const parts: string[] = [];
  if (r.created > 0) parts.push(`${r.created} added`);
  if (r.updated > 0) parts.push(`${r.updated} updated`);
  if (r.removed > 0) parts.push(`${r.removed} removed`);
  if (parts.length === 0) return 'Your Google calendar already matches your booked sessions, so nothing was changed.';
  return `${parts.join(', ')} in your Google calendar. Only sessions Repple put there are ever touched.`;
}

/**
 * The promise the write side makes, kept in the same file as the code that
 * keeps it — the same arrangement as `BUSY_PRIVACY_NOTE` in deviceBusy.ts, and
 * for the same reason: the sentence and the behaviour are decided together or
 * they drift apart.
 */
export const WRITE_PRIVACY_NOTE =
  `Repple makes a calendar of its own in your Google account, called "${BRAND.label} coaching", and writes only inside it. Each booked session appears as "Coaching session" with no client name, no notes, no address and no guests, so nothing about a client reaches Google. Nothing you or anybody else put in your calendar is ever changed or deleted, and removing this calendar removes everything Repple added.`;

/** The button, saying what it will do. Null when there is nothing to send,
 *  which is the caller's cue to disable it. */
export function pushLabel(count: number): string | null {
  if (!Number.isInteger(count) || count < 1) return null;
  return count === 1 ? 'Send 1 Session' : `Send ${count} Sessions`;
}

/* ── the credential a human has to create ─────────────────────────────────── */

/**
 * The redirect URI for a Google OAuth client of the iOS or Android type,
 * derived from the client id, or null.
 *
 * Google mints those client ids as `<id>.apps.googleusercontent.com` and
 * requires the redirect to be the same thing reversed —
 * `com.googleusercontent.apps.<id>:/oauthredirect`. Deriving it means the owner
 * sets ONE value and cannot set the second one inconsistently with the first,
 * which is the failure mode `OAUTH_REDIRECT` in wearables/oauthConfig.ts
 * documents: a redirect that does not match what is registered closes the
 * browser on an unhandled scheme and the connection never completes, with no
 * error anywhere.
 *
 * Null for anything that is not a Google client id — a Web-type client uses an
 * https redirect that cannot be derived from anything and has to be given
 * outright.
 */
export function reversedClientRedirect(clientId: string): string | null {
  const m = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.apps\.googleusercontent\.com$/.exec(String(clientId || '').trim());
  if (!m) return null;
  return `com.googleusercontent.apps.${m[1]}:/oauthredirect`;
}
