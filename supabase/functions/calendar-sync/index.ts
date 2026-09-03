// calendar-sync — the server half of two-way calendar sync (Coach S3).
//
// ── What this is allowed to know, and what it is not ──────────────────────
//
// It holds the coach's Google refresh token, which is a standing credential
// against their account. That is why the token exchange, every refresh and
// every API call happen HERE and not in the app: supabase/functions/ocr-scan
// records what happens otherwise — EXPO_PUBLIC_OCR_API_KEY was inlined into the
// JavaScript bundle and shipped readable to anybody who unpacked the app. A
// Google refresh token is a very long way worse than an OCR key.
//
//   · GOOGLE_CALENDAR_CLIENT_ID is public. It appears in the consent URL the
//     app opens, so it is also an EXPO_PUBLIC_ value in the build.
//   · GOOGLE_CALENDAR_CLIENT_SECRET is a Supabase secret, read here only, and
//     is OPTIONAL — a Google client of the iOS or Android type has no secret at
//     all, and sending an empty one is a rejected request rather than a
//     harmless no-op. See `tokenForm` below.
//   · the tokens are written into calendar_links (supabase/parts/360), a table
//     with a delete policy and deliberately no select policy, and are read back
//     only here under the service role.
//
// ── TIMES ONLY, and the scope is what enforces it ─────────────────────────
//
// The read path calls exactly one Google endpoint: POST /freeBusy. The grant
// Repple asks for is `calendar.freebusy`, which can call that endpoint and
// nothing else — no events.list, no calendar listing, no attendee, no title.
// The response for a calendar is a list of `{start, end}` and this function
// narrows even that to `{start, end}` as EPOCH MILLISECONDS before anything
// leaves the response body, so the only thing that ever crosses the wire to a
// phone is a pair of numbers. There is nothing else in the JSON by the time the
// app sees it, and there was nothing else in it to begin with.
//
// The same discipline applies to failures. `reason` on a busy failure is a
// fixed string plus an HTTP status, never Google's own message: a library error
// quoting the request it choked on could put a calendar identifier — which for
// a Google account is an e-mail address — into a table the gym owner reads.
// src/ui/deviceBusy.ts makes exactly this call for exactly this reason.
//
// ── The write direction, fenced twice ─────────────────────────────────────
//
// Repple creates ONE secondary calendar in the coach's account and writes only
// inside it. The grant it holds for writing is `calendar.app.created`, which
// reaches calendars this application created and nothing else in the account —
// so a bug that tried to touch the coach's own entries is refused by Google
// before it gets near them.
//
// On top of that, every event Repple writes carries an id beginning `repple`
// followed by a Repple session's uuid, and nothing without that prefix is ever
// patched or deleted even inside our own calendar.
//
// And the app CANNOT send a title. The push payload is a list of
// `{ id, startIso, endIso }` — three strings, no field for a name — and the
// event body below is built here from a fixed template. A client's name has no
// route to Google through this code.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
// Failures come back as HTTP 200 with an `error` field, the same as
// wearable-oauth and ads-oauth: a non-2xx makes supabase-js null out `data` and
// the reason — the only actionable part — is lost on the way to the screen.
const fail = (msg: string) => json({ ok: false, error: msg });

const PROVIDER = 'google';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

/** The mark on everything this product writes. Mirrors SYNC_ID_PREFIX in
 *  src/lib/calendarSync.ts, which is where the base32hex constraint on a Google
 *  event id is written up. Nothing that fails this is ever patched or deleted. */
const SYNC_ID_RE = /^repple[0-9a-f]{32}$/;

/** The title of every event Repple writes, fixed here so the app cannot choose
 *  it. A booked session is somebody's appointment with a named person; the
 *  coach knows who, and Google does not need to. */
const EVENT_SUMMARY = 'Coaching session';

/**
 * Client credentials, in the form Google wants them.
 *
 * A Web-type OAuth client has a secret and Google rejects the exchange without
 * it. An iOS or Android client has none, and sending `client_secret=` empty is
 * an `invalid_client` rather than a shrug. So the secret is included only when
 * one is actually configured, and both kinds of client work from the same
 * deployment.
 */
function tokenForm(base: Record<string, string>): URLSearchParams | null {
  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') || '';
  if (!clientId) return null;
  const f = new URLSearchParams({ ...base, client_id: clientId });
  const secret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET') || '';
  if (secret) f.set('client_secret', secret);
  return f;
}

interface TokenAnswer { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }

async function postToken(form: URLSearchParams): Promise<{ ok: true; tok: TokenAnswer } | { ok: false; why: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch {
    return { ok: false, why: 'Google’s sign-in server could not be reached.' };
  }
  let parsed: TokenAnswer = {};
  try { parsed = await res.json(); } catch { parsed = {}; }
  if (!res.ok || !parsed.access_token) {
    // Google's token errors are about CONFIGURATION — a redirect that is not
    // registered, a client id that does not exist, a code already used. None of
    // them carries diary content, and all of them are useless to diagnose
    // without the text, so this one is passed through.
    const detail = parsed.error_description || parsed.error || `HTTP ${res.status}`;
    return { ok: false, why: String(detail) };
  }
  return { ok: true, tok: parsed };
}

/** A calendar API call, with the token. Returns the parsed body, or a status —
 *  never Google's error text, which for this API can name a calendar and a
 *  Google calendar is named by an e-mail address. */
async function api(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: true; body: any } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) {
    // Drain and discard. The body is not read, so it cannot be logged, returned
    // or accidentally attached to an error by a later edit.
    try { await res.text(); } catch { /* nothing to drain */ }
    return { ok: false, status: res.status };
  }
  if (res.status === 204) return { ok: true, body: null };
  try { return { ok: true, body: await res.json() }; } catch { return { ok: true, body: null }; }
}

interface LinkRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  write_calendar_id: string | null;
  write_enabled: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return fail('bad json'); }
  const action = String(body.action || '');

  const supaUrl = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Identify the caller from their JWT. Never from the body: a user id in a
  // request body is a request to act as somebody else.
  let userId = '';
  try {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data } = await service.auth.getUser(jwt);
    if (data?.user?.id) userId = data.user.id;
  } catch { /* falls through to the refusal below */ }
  if (!userId) return fail('Not signed in — sign in to Repple and try connecting your calendar again.');

  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') || '';
  if (!clientId) {
    return fail('Google Calendar is not set up in this deployment. Set GOOGLE_CALENDAR_CLIENT_ID as a Supabase secret.');
  }

  /* ── connect ──────────────────────────────────────────────────────────── */

  if (action === 'connect') {
    const code = String(body.code || '');
    const redirectUri = String(body.redirect_uri || '');
    if (!code || !redirectUri) return fail('missing code or redirect uri');

    const form = tokenForm({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    if (!form) return fail('Google Calendar is not set up in this deployment.');
    if (body.code_verifier) form.set('code_verifier', String(body.code_verifier));

    const r = await postToken(form);
    if (!r.ok) return fail(`Google refused the sign-in: ${r.why}`);

    const expiresAt = new Date(Date.now() + (Number(r.tok.expires_in) || 3600) * 1000).toISOString();
    // A re-consent that returns no refresh token must not wipe the one already
    // stored: Google issues a refresh token on the FIRST grant and then only
    // when prompt=consent is forced, so overwriting with null here is how a
    // working connection quietly becomes an hour-long one.
    const { data: prev, error: prevErr } = await service.from('calendar_links')
      .select('refresh_token, write_calendar_id, write_enabled')
      .eq('user_id', userId).eq('provider', PROVIDER).maybeSingle();
    // A failed read here is NOT "there was nothing before". Treated as one it
    // would write null over a working refresh token and turn a live connection
    // into an hour-long one, silently, on the happiest path this function has —
    // a coach re-authorising to add the write scope.
    if (prevErr) return fail('The existing connection could not be read, so nothing was changed. Try again.');

    const { error } = await service.from('calendar_links').upsert({
      user_id: userId,
      provider: PROVIDER,
      access_token: r.tok.access_token!,
      refresh_token: r.tok.refresh_token ?? prev?.refresh_token ?? null,
      expires_at: expiresAt,
      write_calendar_id: prev?.write_calendar_id ?? null,
      write_enabled: prev?.write_enabled ?? false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });
    if (error) return fail(`Signed in to Google, but the connection could not be saved: ${error.message}`);

    return json({ ok: true, provider: PROVIDER, hasRefresh: !!(r.tok.refresh_token ?? prev?.refresh_token) });
  }

  /* ── every other action needs the stored link ─────────────────────────── */

  const { data: rows, error: readErr } = await service.from('calendar_links')
    .select('access_token, refresh_token, expires_at, write_calendar_id, write_enabled')
    .eq('user_id', userId).eq('provider', PROVIDER).limit(1);
  if (readErr) return fail('The stored calendar connection could not be read.');
  const row: LinkRow | undefined = rows?.[0];

  if (action === 'disconnect') {
    // Best effort, in this order: remove the calendar Repple made (so nothing
    // of ours is left in the account), tell Google to forget the grant, then
    // drop the credential. Each step is allowed to fail without stopping the
    // next — the one that MUST happen is the last, because a token we no longer
    // use is a token nobody is watching.
    if (row) {
      const live = await usableToken(service, userId, row);
      if (live.ok && row.write_calendar_id) {
        await api(live.token, `/calendars/${encodeURIComponent(row.write_calendar_id)}`, { method: 'DELETE' });
      }
      if (row.refresh_token) {
        try { await fetch(`${REVOKE_URL}?token=${encodeURIComponent(row.refresh_token)}`, { method: 'POST' }); } catch { /* revoked or already gone */ }
      }
    }
    const { error } = await service.from('calendar_links').delete()
      .eq('user_id', userId).eq('provider', PROVIDER);
    if (error) return fail(`Could not remove the stored connection: ${error.message}`);
    return json({ ok: true, disconnected: true });
  }

  if (!row) return json({ ok: false, connected: false, error: 'No Google calendar is connected to this account.' });

  const live = await usableToken(service, userId, row);
  if (!live.ok) return json({ ok: false, connected: false, error: live.why });
  const token = live.token;

  /* ── busy ─────────────────────────────────────────────────────────────── */

  if (action === 'busy') {
    const fromMs = Number(body.fromMs);
    const toMs = Number(body.toMs);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return fail('bad window');
    }
    const r = await api(token, '/freeBusy', {
      method: 'POST',
      body: {
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        // `primary` and nothing else. The freebusy grant cannot enumerate the
        // account's calendars, which is the price of a scope that cannot read a
        // title; src/lib/calendarSync.ts REMOTE_SCOPE_NOTE says so to the coach
        // rather than letting a partial answer read as a complete one.
        items: [{ id: 'primary' }],
      },
    });
    // A fixed reason and a status. Never Google's text: a Google calendar is
    // named by an e-mail address and its error messages quote it.
    if (!r.ok) return json({ ok: false, connected: true, reason: `freebusy_http_${r.status}` });

    const cal = r.body?.calendars?.primary;
    // Google reports a per-calendar refusal INSIDE a 200. Treated as an answer
    // it would be an empty busy list, which on this screen is the sentence "you
    // are free all fortnight" — the one src/lib/deviceBusy.ts exists to refuse.
    if (!cal || (Array.isArray(cal.errors) && cal.errors.length > 0)) {
      return json({ ok: false, connected: true, reason: 'freebusy_calendar_error' });
    }
    // THE NARROWING. Two numbers per period and nothing else leaves this
    // function. Everything downstream of this line, on the server and on the
    // phone, is arithmetic.
    const spans: { start: number; end: number }[] = [];
    for (const p of Array.isArray(cal.busy) ? cal.busy : []) {
      const s = Date.parse(String(p?.start ?? ''));
      const e = Date.parse(String(p?.end ?? ''));
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) spans.push({ start: s, end: e });
    }
    return json({ ok: true, connected: true, spans });
  }

  /* ── write on or off ──────────────────────────────────────────────────── */

  if (action === 'write') {
    const enabled = body.enabled === true;
    if (!enabled) {
      // Turning writing off stops writing. It does NOT delete the calendar:
      // the events already there are a record of sessions that happened, and
      // removing somebody's past from their diary because they moved a switch
      // is not a thing a switch should do. Disconnecting removes the calendar,
      // and it says so where the coach reads it.
      const { error } = await service.from('calendar_links')
        .update({ write_enabled: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('provider', PROVIDER);
      if (error) return fail(`Could not turn writing off: ${error.message}`);
      return json({ ok: true, writeEnabled: false });
    }

    let calendarId = row.write_calendar_id;
    if (!calendarId) {
      // The brand's own name, sanitised HERE rather than trusted. It is the one
      // string the app supplies that a person ever reads, and a free-text field
      // on a path that writes into somebody's Google account should not be one.
      const label = String(body.label || '').replace(/[^\p{L}\p{N} .&'-]/gu, '').trim().slice(0, 40) || 'Coaching';
      const made = await api(token, '/calendars', {
        method: 'POST',
        body: {
          summary: `${label} coaching`,
          description: 'Sessions your clients have booked. This calendar was made by your coaching app and only it writes here; delete this calendar to remove everything the app added.',
        },
      });
      if (!made.ok || !made.body?.id) {
        return json({ ok: false, connected: true, reason: `calendar_create_http_${made.ok ? 'empty' : made.status}` });
      }
      calendarId = String(made.body.id);
    }
    const { error } = await service.from('calendar_links')
      .update({ write_calendar_id: calendarId, write_enabled: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('provider', PROVIDER);
    if (error) return fail(`Made the calendar, but could not record it: ${error.message}`);
    return json({ ok: true, writeEnabled: true, hasWriteCalendar: true });
  }

  /* ── push ─────────────────────────────────────────────────────────────── */

  if (action === 'push') {
    if (!row.write_enabled || !row.write_calendar_id) {
      return json({ ok: false, connected: true, reason: 'write_not_enabled' });
    }
    const fromMs = Number(body.fromMs);
    const toMs = Number(body.toMs);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return fail('bad window');

    // The whole of what the app may say about a session: an id we minted and
    // two instants. Anything else on the object is dropped here, and the loop
    // below reads three properties.
    const wanted = new Map<string, { startIso: string; endIso: string }>();
    for (const e of Array.isArray(body.events) ? body.events : []) {
      const id = String(e?.id ?? '');
      if (!SYNC_ID_RE.test(id)) continue;
      const s = Date.parse(String(e?.startIso ?? ''));
      const t = Date.parse(String(e?.endIso ?? ''));
      if (!Number.isFinite(s) || !Number.isFinite(t) || t <= s) continue;
      wanted.set(id, { startIso: new Date(s).toISOString(), endIso: new Date(t).toISOString() });
    }

    const calPath = `/calendars/${encodeURIComponent(row.write_calendar_id)}/events`;
    const existing = new Map<string, { startMs: number; endMs: number }>();
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        maxResults: '2500',
        showDeleted: 'false',
      });
      if (pageToken) q.set('pageToken', pageToken);
      const listed = await api(token, `${calPath}?${q.toString()}`);
      if (!listed.ok) return json({ ok: false, connected: true, reason: `events_list_http_${listed.status}` });
      for (const ev of Array.isArray(listed.body?.items) ? listed.body.items : []) {
        const id = String(ev?.id ?? '');
        if (!SYNC_ID_RE.test(id)) continue;
        const s = Date.parse(String(ev?.start?.dateTime ?? ''));
        const e = Date.parse(String(ev?.end?.dateTime ?? ''));
        existing.set(id, { startMs: Number.isFinite(s) ? s : NaN, endMs: Number.isFinite(e) ? e : NaN });
      }
      pageToken = String(listed.body?.nextPageToken ?? '');
      if (!pageToken) break;
    }

    let created = 0, updated = 0, removed = 0;
    for (const [id, want] of wanted) {
      const have = existing.get(id);
      const times = {
        start: { dateTime: want.startIso },
        end: { dateTime: want.endIso },
      };
      if (!have) {
        // The whole event body, written here and nowhere else. No description,
        // no location, no attendees — an attendee would make Google e-mail an
        // invitation to a client who never asked Google for anything — and no
        // reminder overrides, because a coach's own alert settings are theirs.
        const made = await api(token, calPath, {
          method: 'POST',
          body: {
            id,
            summary: EVENT_SUMMARY,
            ...times,
            visibility: 'private',
            transparency: 'opaque',
            reminders: { useDefault: true },
            extendedProperties: { private: { repple: 'session' } },
          },
        });
        // 409 is this event already existing outside the listed window, which
        // is a success for our purposes: the session is in the calendar.
        if (made.ok) created++;
        else if (made.status !== 409) return json({ ok: false, connected: true, reason: `event_insert_http_${made.status}`, created, updated, removed });
        continue;
      }
      if (have.startMs !== Date.parse(want.startIso) || have.endMs !== Date.parse(want.endIso)) {
        const patched = await api(token, `${calPath}/${encodeURIComponent(id)}`, { method: 'PATCH', body: times });
        if (patched.ok) updated++;
      }
    }
    for (const id of existing.keys()) {
      if (wanted.has(id)) continue;
      // Only ids this product minted, inside a calendar this product made, on a
      // grant that reaches nothing else. Three fences, and the innermost one is
      // this line.
      if (!SYNC_ID_RE.test(id)) continue;
      const gone = await api(token, `${calPath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (gone.ok || gone.status === 404 || gone.status === 410) removed++;
    }

    return json({ ok: true, connected: true, created, updated, removed });
  }

  return fail(`unknown action '${action}'`);
});

/**
 * A token that will still be valid when the next call lands, refreshing if it
 * will not.
 *
 * The sixty-second margin is the same one wearable-day uses: a token that
 * expires between the check and the request is a failure the user reads as a
 * broken connection.
 *
 * `no_refresh_token` is kept apart from `refresh_failed` because they have
 * different remedies. The first means Google never issued one — the consent was
 * granted without offline access — and only reconnecting fixes it. The second
 * means the refresh was refused, usually because the grant was revoked in the
 * Google account, and reconnecting fixes that too but for a different reason a
 * coach can act on.
 */
async function usableToken(
  service: any,
  userId: string,
  row: LinkRow,
): Promise<{ ok: true; token: string } | { ok: false; why: string }> {
  const expired = !!row.expires_at && Date.parse(row.expires_at) < Date.now() + 60000;
  if (!expired) return { ok: true, token: row.access_token };
  if (!row.refresh_token) {
    return { ok: false, why: 'Google did not give Repple permission to keep this connection alive, so it has expired. Connect again.' };
  }
  const form = tokenForm({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
  if (!form) return { ok: false, why: 'Google Calendar is not set up in this deployment.' };
  const r = await postToken(form);
  if (!r.ok) {
    return { ok: false, why: 'Google would not renew this connection, which usually means access was removed in your Google account. Connect again.' };
  }
  const access = r.tok.access_token!;
  // Unchecked, and supabase-js resolves with `{ error }` rather than throwing,
  // so a failure here was silent. The call this token was fetched for still
  // works — that is why it is not fatal — but nothing was stored, so every
  // subsequent request refreshes again. Google does rotate a refresh token when
  // it chooses to, and a rotation that is not stored leaves this row holding one
  // Google will refuse for ever: the coach's calendar then reads
  // `refresh_failed` and the only remedy is reconnecting, which nothing tells
  // them to do. Logged rather than swallowed, because that is the difference
  // between a findable fault and a connection that just stopped.
  const { error: storeErr } = await service.from('calendar_links').update({
    access_token: access,
    refresh_token: r.tok.refresh_token ?? row.refresh_token,
    expires_at: new Date(Date.now() + (Number(r.tok.expires_in) || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId).eq('provider', PROVIDER);
  if (storeErr) console.error('calendar-sync: renewed the Google token for ' + userId + ' and could not store it, so this connection may need reconnecting:', storeErr.message);
  return { ok: true, token: access };
}
