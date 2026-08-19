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

  const metrics = await readVendor(provider, access);
  return json({ metrics, connected: true });
});
