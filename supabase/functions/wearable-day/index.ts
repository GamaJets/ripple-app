// wearable-day — returns today's normalized metrics for a connected cloud vendor.
// Reads the stored token, refreshes it if expired, calls the vendor API, and maps
// the response to { activeKcal, steps, heartRateAvg, heartRateResting, workoutMins }.
// Defensive: any missing field comes back null; never throws to the client.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const today = () => new Date().toISOString().slice(0, 10);
const numOr = (v: any): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// WHOOP caps `limit` at 25 per page on its collection endpoints and paginates with
// next_token. There is no documented floor on how far `start` can reach, so how
// much history you get is purely a function of how many pages we walk. MAX_PAGES
// bounds that: 12 pages = up to 300 sessions, and 12 requests sits far under the
// 100 req/min rate limit.
const WHOOP_PAGE_LIMIT = 25;
const MAX_PAGES = 12;

const TOKEN_URL: Record<string, string> = {
  fitbit: 'https://api.fitbit.com/oauth2/token',
  oura: 'https://api.ouraring.com/oauth/token',
  whoop: 'https://api.prod.whoop.com/oauth/oauth2/token',
};

// Vendors disagree on how client credentials must be sent. WHOOP (Ory Hydra) is
// registered for client_secret_post and REJECTS a request that also carries an
// Authorization: Basic header, so try post-body first and fall back to Basic.
// WHOOP also requires scope=offline on the refresh call to get a NEW refresh
// token back; omit it and the next refresh has nothing to use.
async function refresh(provider: string, refreshToken: string) {
  const clientId = Deno.env.get(`${provider.toUpperCase()}_CLIENT_ID`) || '';
  const clientSecret = Deno.env.get(`${provider.toUpperCase()}_CLIENT_SECRET`) || '';
  if (!clientId || !clientSecret) return null;

  const base = () => {
    const f = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
    if (provider === 'whoop') f.set('scope', 'offline');
    return f;
  };

  const postForm = base();
  postForm.set('client_secret', clientSecret);
  const attempts = [
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: postForm },
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`) }, body: base() },
  ];

  for (const a of attempts) {
    try {
      const res = await fetch(TOKEN_URL[provider], { method: 'POST', headers: a.headers, body: a.body.toString() });
      const t = await res.json();
      if (res.ok && t?.access_token) return t;
    } catch { /* try the next auth method */ }
  }
  return null;
}

// ── Per-vendor readers → normalized shape ──────────────────────────────────
async function fitbitDay(token: string) {
  const h = { Authorization: 'Bearer ' + token };
  const d = today();
  const out: any = { activeKcal: null, steps: null, heartRateAvg: null, heartRateResting: null, workoutMins: null };
  try {
    const a = await (await fetch(`https://api.fitbit.com/1/user/-/activities/date/${d}.json`, { headers: h })).json();
    out.activeKcal = numOr(a?.summary?.activityCalories ?? a?.summary?.caloriesOut);
    out.steps = numOr(a?.summary?.steps);
  } catch { /* leave nulls */ }
  try {
    const hr = await (await fetch(`https://api.fitbit.com/1/user/-/activities/heart/date/${d}/1d.json`, { headers: h })).json();
    out.heartRateResting = numOr(hr?.['activities-heart']?.[0]?.value?.restingHeartRate);
  } catch { /* leave nulls */ }
  return out;
}

async function ouraDay(token: string) {
  const h = { Authorization: 'Bearer ' + token };
  const d = today();
  const out: any = { activeKcal: null, steps: null, heartRateAvg: null, heartRateResting: null, workoutMins: null };
  try {
    const a = await (await fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${d}&end_date=${d}`, { headers: h })).json();
    const row = a?.data?.[0];
    out.activeKcal = numOr(row?.active_calories);
    out.steps = numOr(row?.steps);
  } catch { /* leave nulls */ }
  return out;
}

async function whoopDay(token: string) {
  const h = { Authorization: 'Bearer ' + token };
  const out: any = { activeKcal: null, steps: null, heartRateAvg: null, heartRateResting: null, workoutMins: null, heartRateMax: null, zoneSeconds: null };
  // WHOOP v2. Cycle = a physiological day: energy (kilojoule) + average HR.
  try {
    const c = await (await fetch('https://api.prod.whoop.com/developer/v2/cycle?limit=1', { headers: h })).json();
    const s = c?.records?.[0]?.score;
    if (s) {
      if (Number.isFinite(Number(s.kilojoule))) out.activeKcal = Math.round(Number(s.kilojoule) / 4.184);
      out.heartRateAvg = numOr(s.average_heart_rate);
    }
  } catch { /* leave nulls */ }
  // Recovery carries resting heart rate.
  try {
    const r = await (await fetch('https://api.prod.whoop.com/developer/v2/recovery?limit=1', { headers: h })).json();
    out.heartRateResting = numOr(r?.records?.[0]?.score?.resting_heart_rate);
  } catch { /* leave nulls */ }
  // Sum today's workout durations, and roll up time-in-zone.
  //
  // WHOOP exposes NO intraday heart-rate samples, so a live HR curve is not
  // possible from this API. What it does give is per-workout zone durations —
  // the Orange-Theory number that actually matters: how long you spent in each
  // effort band.
  //
  // WHOOP's six bands map almost exactly onto the app's five (see src/lib/hr.ts):
  //   whoop zone_zero  0-50%   ─┐ folded into z1: below zone 1 is still "very
  //   whoop zone_one   50-60%  ─┘ light", and WHOOP has no separate resting band
  //   whoop zone_two   60-70%  →  z2  (app 61-70%)
  //   whoop zone_three 70-80%  →  z3  (app 71-83%)
  //   whoop zone_four  80-90%  →  z4  (app 84-91%)
  //   whoop zone_five  90-100% →  z5  (app 92-100%)
  // The previous mapping folded zone_two and zone_three together into one band,
  // which merged what the app now calls Light and Base — the two zones a client
  // most needs to tell apart. This is a straight 1:1 apart from the zero fold.
  try {
    const start = today() + 'T00:00:00.000Z';
    const w = await (await fetch(`https://api.prod.whoop.com/developer/v2/activity/workout?start=${start}&limit=${WHOOP_PAGE_LIMIT}`, { headers: h })).json();
    const recs = Array.isArray(w?.records) ? w.records : [];
    let mins = 0;
    const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    let maxHrSeen = 0;
    for (const rec of recs) {
      if (rec?.start && rec?.end) mins += Math.max(0, (Date.parse(rec.end) - Date.parse(rec.start)) / 60000);
      const zd = rec?.score?.zone_durations ?? rec?.score?.zone_duration;
      if (zd) {
        const sec = (v: any) => (Number.isFinite(Number(v)) ? Number(v) / 1000 : 0);
        zones.z1 += sec(zd.zone_zero_milli) + sec(zd.zone_one_milli);
        zones.z2 += sec(zd.zone_two_milli);
        zones.z3 += sec(zd.zone_three_milli);
        zones.z4 += sec(zd.zone_four_milli);
        zones.z5 += sec(zd.zone_five_milli);
      }
      const mh = Number(rec?.score?.max_heart_rate);
      if (Number.isFinite(mh) && mh > maxHrSeen) maxHrSeen = mh;
    }
    if (mins > 0) out.workoutMins = Math.round(mins);
    if (maxHrSeen > 0) out.heartRateMax = Math.round(maxHrSeen);
    const zTotal = Object.values(zones).reduce((a, b) => a + b, 0);
    if (zTotal > 0) out.zoneSeconds = zones;
  } catch { /* leave nulls */ }
  // WHOOP has no step counter → steps stays null.
  return out;
}

// ── Workout list (for importing individual sessions into the training log) ──
//
// WHOOP workout records carry everything a log entry needs: start, end, sport,
// strain, avg/max HR and kilojoules. wearable-day was already fetching these to
// roll up zone durations and then discarding them; this exposes them properly.
const WHOOP_SPORT: Record<string, string> = {
  '-1': 'Activity', '0': 'Running', '1': 'Cycling', '16': 'Baseball', '17': 'Basketball',
  '18': 'Rowing', '19': 'Fencing', '20': 'Field Hockey', '21': 'Football', '22': 'Golf',
  '24': 'Ice Hockey', '25': 'Lacrosse', '27': 'Rugby', '28': 'Sailing', '29': 'Skiing',
  '30': 'Soccer', '31': 'Softball', '32': 'Squash', '33': 'Swimming', '34': 'Tennis',
  '35': 'Track & Field', '36': 'Volleyball', '37': 'Water Polo', '38': 'Wrestling',
  '39': 'Boxing', '42': 'Dance', '43': 'Pilates', '44': 'Yoga', '45': 'Weightlifting',
  '47': 'Cross Country Skiing', '48': 'Functional Fitness', '52': 'Hiking/Rucking',
  '55': 'Mountain Biking', '56': 'Powerlifting', '57': 'Rock Climbing', '59': 'Paddleboarding',
  '60': 'Triathlon', '62': 'Walking', '63': 'Surfing', '64': 'Elliptical', '65': 'Stairmaster',
  '70': 'Meditation', '71': 'Other', '73': 'Diving', '74': 'Operations - Tactical',
  '82': 'Ultimate', '83': 'Climber', '84': 'Jumping Rope', '85': 'Australian Football',
  '86': 'Skateboarding', '87': 'Coaching', '88': 'Ice Bath', '89': 'Commuting',
  '90': 'Gaming', '91': 'Snowboarding', '92': 'Motocross', '93': 'Caddying',
  '94': 'Obstacle Course Racing', '95': 'Motor Racing', '96': 'HIIT', '97': 'Spin',
  '98': 'Jiu Jitsu', '99': 'Manual Labor', '100': 'Cricket', '101': 'Pickleball',
  '102': 'Inline Skating', '103': 'Box Fitness', '104': 'Spikeball', '105': 'Wheelchair Pushing',
  '106': 'Paddle Tennis', '107': 'Barre', '108': 'Stage Performance', '109': 'High Stress Work',
  '110': 'Parkour', '111': 'Gaelic Football', '112': 'Hurling/Camogie', '113': 'Circus Arts',
  '121': 'Massage Therapy', '125': 'Watching Sports', '126': 'Assault Bike', '127': 'Kickboxing',
  '128': 'Stretching', '230': 'Table Tennis', '231': 'Badminton', '232': 'Netball',
  '233': 'Sauna', '234': 'Disc Golf', '235': 'Yard Work', '236': 'Air Compression',
  '237': 'Percussive Massage', '238': 'Paintball', '239': 'Ice Skating', '240': 'Handball',
};

async function whoopWorkouts(token: string, sinceDays: number) {
  const h = { Authorization: 'Bearer ' + token };
  const start = new Date(Date.now() - Math.max(1, sinceDays) * 86400000).toISOString();
  const recs: any[] = [];
  let nextToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://api.prod.whoop.com/developer/v2/activity/workout');
    url.searchParams.set('start', start);
    url.searchParams.set('limit', String(WHOOP_PAGE_LIMIT));
    if (nextToken) url.searchParams.set('nextToken', nextToken);
    const res = await fetch(url.toString(), { headers: h });
    if (!res.ok) break;
    const data = await res.json();
    const batch = Array.isArray(data?.records) ? data.records : [];
    recs.push(...batch);
    nextToken = String(data?.next_token || '');
    if (!nextToken || batch.length < WHOOP_PAGE_LIMIT) break;
  }
  const out: any[] = [];
  for (const r of recs) {
    const a = Date.parse(r?.start);
    const b = Date.parse(r?.end);
    if (!Number.isFinite(a)) continue;
    const mins = Number.isFinite(b) && b > a ? Math.round((b - a) / 60000) : 0;
    if (mins <= 0) continue;
    const sport = String(r?.sport_name ?? WHOOP_SPORT[String(r?.sport_id)] ?? 'Workout');
    const kj = Number(r?.score?.kilojoule);
    const startIso = new Date(a).toISOString();
    out.push({
      // Stable id so re-importing the same session is a no-op.
      id: `whoop-${r?.id ?? startIso}`,
      activity: sport,
      rawActivity: sport,
      start: startIso,
      mins,
      kcal: Number.isFinite(kj) && kj > 0 ? Math.round(kj / 4.184) : null,
      distanceKm: Number.isFinite(Number(r?.score?.distance_meter)) && Number(r?.score?.distance_meter) > 0
        ? Math.round(Number(r.score.distance_meter) / 10) / 100 : null,
      source: 'whoop',
      strain: Number.isFinite(Number(r?.score?.strain)) ? Number(r.score.strain) : null,
      avgHr: numOr(r?.score?.average_heart_rate),
      maxHr: numOr(r?.score?.max_heart_rate),
    });
  }
  out.sort((x, y) => Date.parse(y.start) - Date.parse(x.start));
  return out;
}

// ── Sleep ──────────────────────────────────────────────────────────────────
//
// ⚠ EVERY FIELD NAME BELOW WAS READ OUT OF THE VENDOR'S OWN PUBLISHED
// SPECIFICATION. NONE OF IT WAS OBSERVED IN A LIVE RESPONSE, because exercising
// any of these endpoints needs a real user's OAuth token and there is no test
// account. That distinction has already cost this codebase once — the zone
// mapping in whoopDay above was written against an assumed shape and folded two
// bands into one — so it is recorded here rather than left to be guessed at
// later. The specifications used, fetched on 2026-08-29:
//
//   Oura API v2   https://cloud.ouraring.com/v2/docs
//                 (Redoc over https://cloud.ouraring.com/v2/static/json/openapi-1.37.json)
//                 GET /v2/usercollection/sleep → MultiDocumentResponse[PublicModifiedSleepModel]
//   WHOOP  v2     https://developer.whoop.com/api/
//                 (OpenAPI at https://api.prod.whoop.com/developer/doc/openapi.json)
//                 GET /v2/activity/sleep → PaginatedSleepResponse
//                 WHOOP v1 is retired; v2 is the only current version.
//   Fitbit 1.2    https://dev.fitbit.com/build/reference/web-api/sleep/get-sleep-log-by-date-range/
//                 GET /1.2/user/-/sleep/date/{start}/{end}.json
//
// What this half of the feature does NOT do is decide what a night is. It
// fetches, checks the HTTP outcome, and passes each vendor's own field names
// through untouched to the client, which owns the arithmetic and the calendar
// (see src/lib/vendorSleep.ts). The reason is timezones: a night belongs to the
// local day the person woke up on, this function runs in UTC, and every attempt
// in this repo to derive a calendar day away from the reader's clock has been a
// bug. So the server never computes a night key.
//
// The projections below exist only to keep the payload small — Oura alone
// returns per-30-second sleep phase strings and 5-minute HRV sample arrays for
// every night, which the client has no use for. They are a subset of the
// vendor's fields under the vendor's own names, never a rename.

/** Three distinguishable outcomes, never collapsed: read, dead token, failure. */
type VendorSleep =
  | { ok: true; records: any[] }
  | { ok: false; notConnected: true; reason: string }
  | { ok: false; reason: string };

// A UTC day string, used ONLY to widen a request window — never to attribute a
// night to a day. One day of slack on each end because the client asks in local
// nights and this runs in UTC, and a window computed here can otherwise stop
// one day short of the night the client is looking at. Extra records are free:
// the client keys them by night and shows only the nights it asked for.
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const SLEEP_SLACK_DAYS = 1;
function sleepWindow(sinceDays: unknown) {
  const days = Math.min(90, Math.max(1, Math.floor(Number(sinceDays)) || 7));
  const now = Date.now();
  const startMs = now - (days + SLEEP_SLACK_DAYS) * 86400000;
  const endMs = now + SLEEP_SLACK_DAYS * 86400000;
  return { startMs, endMs, startDate: utcDay(startMs), endDate: utcDay(endMs) };
}

// 401 and 403 mean the stored token no longer speaks for this user, which the
// client turns into "reconnect your device" rather than "you did not sleep".
// Any other non-2xx is a failure of ours or theirs, and the night is unknown.
const notConnected = (v: string): VendorSleep => ({ ok: false, notConnected: true, reason: `${v}_unauthorized` });

/**
 * Oura sleep periods for the window.
 *
 * `/v2/usercollection/sleep` is the per-period collection, not `daily_sleep`.
 * daily_sleep carries only a 0-100 score and its contributors — no duration at
 * all — so it cannot answer "how long did I sleep", which is the only question
 * being asked here.
 *
 * Durations are SECONDS in this API, and `total_sleep_duration` is nullable
 * while `time_in_bed` is a required field. Both are forwarded, unconverted, so
 * the client can tell a staged night from a time-in-bed one.
 */
async function ouraSleep(token: string, sinceDays: unknown): Promise<VendorSleep> {
  const h = { Authorization: 'Bearer ' + token };
  const w = sleepWindow(sinceDays);
  const records: any[] = [];
  let nextToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://api.ouraring.com/v2/usercollection/sleep');
    url.searchParams.set('start_date', w.startDate);
    url.searchParams.set('end_date', w.endDate);
    if (nextToken) url.searchParams.set('next_token', nextToken);
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: h });
    } catch {
      return { ok: false, reason: 'Oura could not be reached.' };
    }
    if (res.status === 401 || res.status === 403) return notConnected('oura');
    if (!res.ok) return { ok: false, reason: `Oura answered ${res.status}.` };
    let data: any;
    try {
      data = await res.json();
    } catch {
      return { ok: false, reason: 'Oura sent a response Repple could not read.' };
    }
    for (const r of Array.isArray(data?.data) ? data.data : []) {
      records.push({
        id: r?.id ?? null,
        day: r?.day ?? null,
        type: r?.type ?? null,
        bedtime_start: r?.bedtime_start ?? null,
        bedtime_end: r?.bedtime_end ?? null,
        total_sleep_duration: r?.total_sleep_duration ?? null,
        time_in_bed: r?.time_in_bed ?? null,
        awake_time: r?.awake_time ?? null,
        deep_sleep_duration: r?.deep_sleep_duration ?? null,
        light_sleep_duration: r?.light_sleep_duration ?? null,
        rem_sleep_duration: r?.rem_sleep_duration ?? null,
      });
    }
    nextToken = String(data?.next_token || '');
    if (!nextToken) break;
  }
  return { ok: true, records };
}

/**
 * WHOOP sleep activities for the window.
 *
 * WHOOP reports no "total asleep" figure at all. `score.stage_summary` gives
 * light, slow-wave and REM separately, in MILLISECONDS, and asleep is their
 * sum; `total_in_bed_time_milli` is the wider figure that also contains the
 * awake and no-data time. Both are forwarded so the client can keep them apart
 * rather than quietly presenting time in bed as sleep.
 *
 * `score` is absent unless `score_state` is 'SCORED' — PENDING_SCORE and
 * UNSCORABLE carry the session with no measurements — so score_state travels
 * with the record and the client refuses the ones that have nothing in them.
 */
async function whoopSleep(token: string, sinceDays: unknown): Promise<VendorSleep> {
  const h = { Authorization: 'Bearer ' + token };
  const w = sleepWindow(sinceDays);
  const records: any[] = [];
  let nextToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://api.prod.whoop.com/developer/v2/activity/sleep');
    url.searchParams.set('start', new Date(w.startMs).toISOString());
    url.searchParams.set('end', new Date(w.endMs).toISOString());
    url.searchParams.set('limit', String(WHOOP_PAGE_LIMIT));
    if (nextToken) url.searchParams.set('nextToken', nextToken);
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: h });
    } catch {
      return { ok: false, reason: 'WHOOP could not be reached.' };
    }
    if (res.status === 401 || res.status === 403) return notConnected('whoop');
    if (!res.ok) return { ok: false, reason: `WHOOP answered ${res.status}.` };
    let data: any;
    try {
      data = await res.json();
    } catch {
      return { ok: false, reason: 'WHOOP sent a response Repple could not read.' };
    }
    const batch = Array.isArray(data?.records) ? data.records : [];
    for (const r of batch) {
      const st = r?.score?.stage_summary;
      records.push({
        id: r?.id ?? null,
        start: r?.start ?? null,
        end: r?.end ?? null,
        timezone_offset: r?.timezone_offset ?? null,
        nap: r?.nap ?? null,
        score_state: r?.score_state ?? null,
        score: st
          ? {
              stage_summary: {
                total_in_bed_time_milli: st.total_in_bed_time_milli ?? null,
                total_awake_time_milli: st.total_awake_time_milli ?? null,
                total_no_data_time_milli: st.total_no_data_time_milli ?? null,
                total_light_sleep_time_milli: st.total_light_sleep_time_milli ?? null,
                total_slow_wave_sleep_time_milli: st.total_slow_wave_sleep_time_milli ?? null,
                total_rem_sleep_time_milli: st.total_rem_sleep_time_milli ?? null,
              },
            }
          : null,
      });
    }
    nextToken = String(data?.next_token || '');
    if (!nextToken || batch.length < WHOOP_PAGE_LIMIT) break;
  }
  return { ok: true, records };
}

/**
 * Fitbit sleep logs for the window.
 *
 * Version 1.2, not 1: the v1 sleep endpoints are marked deprecated and it is
 * 1.2 that carries `levels` and the stages/classic distinction. The range form
 * returns every log in one call — no pagination — and caps the span at 100
 * days, which sleepWindow is already well inside.
 *
 * Fitbit's durations are MINUTES (`minutesAsleep`, `timeInBed`), unlike the
 * other two, and `dateOfSleep` is documented as the date the log ENDED, i.e.
 * the morning the person woke. `startTime` and `endTime` are local wall-clock
 * strings with no offset on them, which is exactly why they are passed through
 * as written rather than being turned into instants here.
 */
async function fitbitSleep(token: string, sinceDays: unknown): Promise<VendorSleep> {
  const h = { Authorization: 'Bearer ' + token };
  const w = sleepWindow(sinceDays);
  let res: Response;
  try {
    res = await fetch(`https://api.fitbit.com/1.2/user/-/sleep/date/${w.startDate}/${w.endDate}.json`, { headers: h });
  } catch {
    return { ok: false, reason: 'Fitbit could not be reached.' };
  }
  if (res.status === 401 || res.status === 403) return notConnected('fitbit');
  if (!res.ok) return { ok: false, reason: `Fitbit answered ${res.status}.` };
  let data: any;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'Fitbit sent a response Repple could not read.' };
  }
  const records: any[] = [];
  for (const r of Array.isArray(data?.sleep) ? data.sleep : []) {
    records.push({
      logId: r?.logId ?? null,
      dateOfSleep: r?.dateOfSleep ?? null,
      startTime: r?.startTime ?? null,
      endTime: r?.endTime ?? null,
      type: r?.type ?? null,
      isMainSleep: r?.isMainSleep ?? null,
      minutesAsleep: r?.minutesAsleep ?? null,
      timeInBed: r?.timeInBed ?? null,
    });
  }
  return { ok: true, records };
}

async function readVendorSleep(provider: string, token: string, sinceDays: unknown): Promise<VendorSleep> {
  if (provider === 'fitbit') return await fitbitSleep(token, sinceDays);
  if (provider === 'oura') return await ouraSleep(token, sinceDays);
  if (provider === 'whoop') return await whoopSleep(token, sinceDays);
  // Garmin needs an approved partnership before any endpoint answers, so there
  // is nothing to call. 'unsupported' rather than a failure: the client must say
  // "Repple cannot read this yet", not "we could not reach your device".
  return { ok: false, reason: 'unsupported' };
}

async function readVendor(provider: string, token: string) {
  if (provider === 'fitbit') return await fitbitDay(token);
  if (provider === 'oura') return await ouraDay(token);
  if (provider === 'whoop') return await whoopDay(token);
  return null; // garmin day-mapping: add once credentials exist to test against
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const provider = String(body.provider || '');
  if (!TOKEN_URL[provider]) return json({ metrics: null });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    userId = data?.user?.id || '';
  } catch { /* ignore */ }
  if (!userId) return json({ error: 'no user' }, 401);

  const { data: row } = await service.from('wearable_tokens').select('*').eq('user_id', userId).eq('provider', provider).maybeSingle();
  // connected:false is a real signal, not just 'no data' — the client uses it to
  // stop claiming a dead connection is live.
  if (!row) return json({ metrics: null, connected: false });

  let access = row.access_token as string;
  const expired = !!row.expires_at && Date.parse(row.expires_at) < Date.now() + 60000;
  if (expired && !row.refresh_token) {
    // No refresh token was ever issued (WHOOP does this when 'offline' scope was
    // not requested). Nothing can revive this — the user must reconnect.
    return json({ metrics: null, connected: false, reason: 'expired_no_refresh_token' });
  }
  if (expired && row.refresh_token) {
    const t = await refresh(provider, row.refresh_token);
    if (!t?.access_token) return json({ metrics: null, connected: false, reason: 'refresh_failed' });
    access = t.access_token;
    await service.from('wearable_tokens').update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? row.refresh_token,
      expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', provider);
  }

  if (String(body.action || '') === 'workouts') {
    if (provider !== 'whoop') return json({ workouts: [], connected: true });
    try {
      const days = Math.min(365, Math.max(1, Number(body.sinceDays) || 14));
      const workouts = await whoopWorkouts(access, days);
      return json({ workouts, connected: true });
    } catch (_e) {
      return json({ workouts: [], connected: true, error: 'could not read workouts' });
    }
  }

  // Sleep is asked for separately from the daily roll-up, and answers with the
  // vendor's own records rather than a number. Three outcomes, deliberately
  // kept apart all the way to the screen: `sleep.ok` with records (which may be
  // an empty list — a real answer meaning nothing was recorded), `connected:
  // false` (the token is dead, so reconnect), and `sleep.ok: false` with a
  // reason (we asked and did not get an answer, so the night is unknown). The
  // recurring bug this shape exists to prevent is all three arriving as [].
  if (String(body.action || '') === 'sleep') {
    const res = await readVendorSleep(provider, access, body.sinceDays);
    if (!res.ok && (res as any).notConnected) {
      return json({ metrics: null, connected: false, reason: (res as any).reason });
    }
    return json({ sleep: res, connected: true });
  }

  const metrics = await readVendor(provider, access);
  return json({ metrics, connected: true });
});
