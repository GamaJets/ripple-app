// Supabase Edge Function: owner-metrics
// Live operational metrics for the Owner Command Center web portal.
// SECURITY MODEL:
//   • The caller must be a signed-in user whose profiles.role = 'owner'.
//   • Aggregation runs with the SERVICE ROLE *inside this function only* — the
//     service key never reaches the browser. The browser holds only the public
//     anon key and the owner's own JWT.
// Deploy:  supabase functions deploy owner-metrics
// Call:    supabase.functions.invoke('owner-metrics')  (Authorization header auto-added)
//
// Returns JSON: { ok, metrics: {...}, live: [keys that came from real data], generatedAt }
// Every metric is computed defensively — a missing table/column yields null for
// that metric (and it is omitted from `live`) rather than failing the whole call.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const DAY = 86400000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const isoDate = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ ok: false, error: 'Sign in as the owner to load live data.' }, 401);
  if (!SERVICE) return json({ ok: false, error: 'Service role not configured on the function.' }, 500);

  // 1) Identify the caller from their JWT (anon client + their bearer token).
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: ures, error: uerr } = await asUser.auth.getUser();
  if (uerr || !ures?.user) return json({ ok: false, error: 'Not signed in.' }, 401);
  const uid = ures.user.id;

  // 2) Authorize: role must be 'owner'.
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle();
  if (!prof || prof.role !== 'owner') return json({ ok: false, error: 'Owner access only.' }, 403);

  // 3) Aggregate. Each metric guarded so one missing table can't sink the rest.
  const metrics: Record<string, number | null> = {};
  const live: string[] = [];
  const set = (k: string, v: number | null) => { metrics[k] = v; if (v != null) live.push(k); };

  const count = async (table: string, build?: (q: any) => any): Promise<number | null> => {
    try {
      let q: any = admin.from(table).select('*', { count: 'exact', head: true });
      if (build) q = build(q);
      const { count: c, error } = await q;
      return error ? null : (c ?? 0);
    } catch { return null; }
  };
  const distinctCount = async (table: string, col: string, build?: (q: any) => any): Promise<number | null> => {
    try {
      let q: any = admin.from(table).select(col).limit(50000);
      if (build) q = build(q);
      const { data, error } = await q;
      if (error || !data) return null;
      return new Set(data.map((r: any) => r[col]).filter(Boolean)).size;
    } catch { return null; }
  };

  // People
  set('trainers', await count('profiles', (q) => q.eq('role', 'trainer')));
  set('clientsTotal', await count('profiles', (q) => q.eq('role', 'client')));
  set('newClients30', await count('profiles', (q) => q.eq('role', 'client').gte('created_at', iso(30 * DAY))));
  set('brands', await count('tenants'));

  // Engagement / activity
  let active = await distinctCount('workouts', 'user_id', (q) => q.gte('performed_at', iso(30 * DAY)));
  if (active == null) active = await distinctCount('workout_logs', 'client_id', (q) => q.gte('logged_at', iso(30 * DAY)));
  set('activeMembers', active);
  set('scans7', await count('scans', (q) => q.gte('taken_at', isoDate(7 * DAY))));
  let wk = await count('workouts', (q) => q.gte('performed_at', iso(7 * DAY)));
  if (wk == null) wk = await count('workout_logs', (q) => q.gte('logged_at', iso(7 * DAY)));
  set('workouts7', wk);
  set('ptSessions30', await count('sessions', (q) => q.eq('status', 'booked').gte('starts_at', iso(30 * DAY))));

  // Class fill (attended / booked) over last 30d via the analytics RPC.
  try {
    const { data: rows, error } = await admin.rpc('class_attendance_summary', { from_ts: iso(30 * DAY), to_ts: iso(0) });
    if (!error && Array.isArray(rows) && rows.length) {
      let att = 0, bkd = 0;
      for (const r of rows) { att += Number(r.attended || 0); bkd += Number(r.booked || 0); }
      set('classes30', rows.length);
      set('classFillPct', bkd > 0 ? Math.round((att / bkd) * 100) : null);
    }
  } catch { /* rpc absent → skip */ }

  // Revenue (real only if billing rows exist; otherwise omitted → portal shows sample).
  try {
    const { data: inv } = await admin.from('invoices').select('amount, status, created_at').gte('created_at', iso(30 * DAY)).limit(10000);
    if (Array.isArray(inv) && inv.length) {
      const paid = inv.filter((r: any) => (r.status ?? 'paid') === 'paid');
      const sum = paid.reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
      if (sum > 0) set('revenue30', Math.round(sum));
    }
  } catch { /* no invoices table */ }
  try {
    const { count: subs } = await admin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
    if (subs != null && subs > 0) set('activeSubscriptions', subs);
  } catch { /* no subscriptions table */ }

  return json({ ok: true, metrics, live, generatedAt: new Date().toISOString() });
});
