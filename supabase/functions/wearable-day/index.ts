// wearable-day — returns today's normalized metrics for a connected cloud vendor.
// Reads the stored token, refreshes it if expired, calls the vendor API, and maps
// the response to { activeKcal, steps, heartRateAvg, heartRateResting, workoutMins }.
// Defensive: any missing field comes back null; never throws to the client.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const today = () => new Date().toISOString().slice(0, 10);
const numOr = (v: any): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

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
  // possible from this API. What it does give is per-workout zone durations, which
  // is the Orange-Theory-style number that actually matters: how long you spent in
  // each effort band. WHOOP uses 6 bands (0-50/50-60/60-70/70-80/80-90/90-100% of
  // max HR); this app models 5 (rest <50, warmup 50-65, aerobic 65-80, threshold
  // 80-90, max >=90). zone_two (60-70%) straddles warmup and aerobic and is
  // assigned to aerobic — the only approximation in the mapping.
  try {
    const start = today() + 'T00:00:00.000Z';
    const w = await (await fetch(`https://api.prod.whoop.com/developer/v2/activity/workout?start=${start}&limit=25`, { headers: h })).json();
    const recs = Array.isArray(w?.records) ? w.records : [];
    let mins = 0;
    const zones = { rest: 0, warmup: 0, aerobic: 0, threshold: 0, max: 0 };
    let maxHrSeen = 0;
    for (const rec of recs) {
      if (rec?.start && rec?.end) mins += Math.max(0, (Date.parse(rec.end) - Date.parse(rec.start)) / 60000);
      const zd = rec?.score?.zone_durations ?? rec?.score?.zone_duration;
      if (zd) {
        const sec = (v: any) => (Number.isFinite(Number(v)) ? Number(v) / 1000 : 0);
        zones.rest      += sec(zd.zone_zero_milli);
        zones.warmup    += sec(zd.zone_one_milli);
        zones.aerobic   += sec(zd.zone_two_milli) + sec(zd.zone_three_milli);
        zones.threshold += sec(zd.zone_four_milli);
        zones.max       += sec(zd.zone_five_milli);
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

  const metrics = await readVendor(provider, access);
  return json({ metrics, connected: true });
});
