// wearable-day — returns today's normalized metrics for a connected cloud vendor.
// Reads the stored token, refreshes it if expired, calls the vendor API, and maps
// the response to { activeKcal, steps, heartRateAvg, heartRateResting, workoutMins }.
// Defensive: any missing field comes back null; never throws to the client.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const today = () => new Date().toISOString().slice(0, 10);
const numOr = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

const TOKEN_URL: Record<string, string> = {
  fitbit: 'https://api.fitbit.com/oauth2/token',
  oura: 'https://api.ouraring.com/oauth/token',
  whoop: 'https://api.prod.whoop.com/oauth/oauth2/token',
};

async function refresh(provider: string, refreshToken: string) {
  const clientId = Deno.env.get(`${provider.toUpperCase()}_CLIENT_ID`) || '';
  const clientSecret = Deno.env.get(`${provider.toUpperCase()}_CLIENT_SECRET`) || '';
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
  const res = await fetch(TOKEN_URL[provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`) },
    body: form.toString(),
  });
  const t = await res.json();
  if (!res.ok || !t.access_token) return null;
  return t;
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

async function readVendor(provider: string, token: string) {
  if (provider === 'fitbit') return await fitbitDay(token);
  if (provider === 'oura') return await ouraDay(token);
  return null; // whoop/garmin day-mapping: add once credentials exist to test against
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
  if (!row) return json({ metrics: null });

  let access = row.access_token as string;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now() + 60000 && row.refresh_token) {
    const t = await refresh(provider, row.refresh_token);
    if (t?.access_token) {
      access = t.access_token;
      await service.from('wearable_tokens').update({
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? row.refresh_token,
        expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('provider', provider);
    }
  }

  const metrics = await readVendor(provider, access);
  return json({ metrics });
});
