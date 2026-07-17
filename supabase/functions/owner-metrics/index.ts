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
  const series: Record<string, any> = {};
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

  // Class fill (attended / booked) over last 30d via the analytics RPC — totals + breakdowns.
  try {
    const { data: rows, error } = await admin.rpc('class_attendance_summary', { from_ts: iso(30 * DAY), to_ts: iso(0) });
    if (!error && Array.isArray(rows) && rows.length) {
      let att = 0, bkd = 0;
      const byBranch: Record<string, { a: number; b: number }> = {};
      const byKind: Record<string, { a: number; b: number }> = {};
      for (const r of rows) {
        const a = Number(r.attended || 0), b = Number(r.booked || 0);
        att += a; bkd += b;
        const br = (r.branch || '—'); (byBranch[br] ||= { a: 0, b: 0 }); byBranch[br].a += a; byBranch[br].b += b;
        const kd = (r.kind || r.title || 'Class'); (byKind[kd] ||= { a: 0, b: 0 }); byKind[kd].a += a; byKind[kd].b += b;
      }
      set('classes30', rows.length);
      set('classFillPct', bkd > 0 ? Math.round((att / bkd) * 100) : null);
      const toBars = (m: Record<string, { a: number; b: number }>) =>
        Object.entries(m).map(([k, v]) => [k, v.b > 0 ? Math.round((v.a / v.b) * 100) : 0]).sort((x: any, y: any) => y[1] - x[1]);
      series.byBranch = toBars(byBranch);
      series.byKind = toBars(byKind);
    }
  } catch { /* rpc absent → skip */ }

  // New-member trend: client sign-ups per calendar month, last 12 months.
  try {
    const { data } = await admin.from('profiles').select('created_at').eq('role', 'client').gte('created_at', iso(365 * DAY)).limit(50000);
    if (Array.isArray(data) && data.length) {
      const now = new Date();
      const months: string[] = [];
      for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.toISOString().slice(0, 7)); }
      const counts: Record<string, number> = {}; months.forEach((m) => { counts[m] = 0; });
      data.forEach((r: any) => { const m = String(r.created_at).slice(0, 7); if (m in counts) counts[m]++; });
      series.signupTrend = { labels: months, counts: months.map((m) => counts[m]) };
    }
  } catch { /* no profiles trend */ }

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

  // ── Names helper (id -> full_name) ────────────────────────────────────────
  const namesFor = async (ids: string[]): Promise<Record<string, string>> => {
    const m: Record<string, string> = {};
    if (!ids.length) return m;
    try { const { data } = await admin.from('profiles').select('id, full_name').in('id', ids.slice(0, 500)); (data || []).forEach((p: any) => { m[p.id] = p.full_name || 'Member'; }); } catch { /* ignore */ }
    return m;
  };

  // Recent members (last 8 client sign-ups) with visit count + active flag.
  try {
    const { data: rm } = await admin.from('profiles').select('id, full_name, created_at').eq('role', 'client').order('created_at', { ascending: false }).limit(8);
    if (Array.isArray(rm) && rm.length) {
      const ids = rm.map((r: any) => r.id);
      const visits: Record<string, number> = {}, lastAct: Record<string, number> = {};
      try {
        const { data: w } = await admin.from('workouts').select('user_id, performed_at').in('user_id', ids);
        (w || []).forEach((x: any) => { visits[x.user_id] = (visits[x.user_id] || 0) + 1; const t = Date.parse(x.performed_at); if (!lastAct[x.user_id] || t > lastAct[x.user_id]) lastAct[x.user_id] = t; });
      } catch { /* ignore */ }
      series.recentMembers = rm.map((r: any) => ({ name: r.full_name || 'Member', joined: String(r.created_at).slice(0, 10), visits: visits[r.id] || 0, active: lastAct[r.id] ? (Date.now() - lastAct[r.id] < 30 * DAY) : false }));
    }
  } catch { /* ignore */ }

  // Trainer roster with client counts.
  try {
    const { data: tr } = await admin.from('profiles').select('id, full_name').eq('role', 'trainer').limit(100);
    if (Array.isArray(tr) && tr.length) {
      const counts: Record<string, number> = {};
      try { const { data: cl } = await admin.from('clients').select('trainer_id'); (cl || []).forEach((c: any) => { if (c.trainer_id) counts[c.trainer_id] = (counts[c.trainer_id] || 0) + 1; }); } catch { /* ignore */ }
      series.trainersList = tr.map((t: any) => ({ name: t.full_name || 'Trainer', clients: counts[t.id] || 0 }));
    }
  } catch { /* ignore */ }

  // Live activity feed — newest workouts, scans and sign-ups, merged by time.
  try {
    const acts: { who: string; at: number; kind: string }[] = [];
    try { const { data: w } = await admin.from('workouts').select('user_id, performed_at').order('performed_at', { ascending: false }).limit(6); (w || []).forEach((x: any) => acts.push({ who: x.user_id, at: Date.parse(x.performed_at), kind: 'workout' })); } catch { /* ignore */ }
    try { const { data: sc } = await admin.from('scans').select('client_id, created_at, taken_at').order('created_at', { ascending: false }).limit(6); (sc || []).forEach((x: any) => acts.push({ who: x.client_id, at: Date.parse(x.created_at || x.taken_at), kind: 'scan' })); } catch { /* ignore */ }
    try { const { data: nj } = await admin.from('profiles').select('id, created_at').eq('role', 'client').order('created_at', { ascending: false }).limit(6); (nj || []).forEach((x: any) => acts.push({ who: x.id, at: Date.parse(x.created_at), kind: 'join' })); } catch { /* ignore */ }
    const valid = acts.filter((a) => isFinite(a.at));
    if (valid.length) {
      valid.sort((a, b) => b.at - a.at);
      const top = valid.slice(0, 8);
      const nm = await namesFor([...new Set(top.map((a) => a.who))]);
      const label: Record<string, string> = { workout: 'logged a workout', scan: 'new InBody scan', join: 'joined' };
      series.recentActivity = top.map((a) => ({ text: (nm[a.who] || 'Member') + ' · ' + label[a.kind], at: new Date(a.at).toISOString() }));
    }
  } catch { /* ignore */ }

  // Cohort retention heatmap — % of each join-month cohort active in later months.
  try {
    const { data: cs } = await admin.from('profiles').select('id, created_at').eq('role', 'client').gte('created_at', iso(190 * DAY)).limit(2000);
    if (Array.isArray(cs) && cs.length) {
      const ids = cs.map((c: any) => c.id);
      const act: Record<string, Set<string>> = {};
      const addAct = (id: string, ts: string) => { const mo = String(ts).slice(0, 7); (act[id] ||= new Set<string>()).add(mo); };
      try { const { data: w } = await admin.from('workouts').select('user_id, performed_at').in('user_id', ids).limit(50000); (w || []).forEach((x: any) => addAct(x.user_id, x.performed_at)); } catch { /* ignore */ }
      try { const { data: ci } = await admin.from('check_ins').select('user_id, at').in('user_id', ids).limit(50000); (ci || []).forEach((x: any) => addAct(x.user_id, x.at)); } catch { /* ignore */ }
      const now = new Date();
      const cohMonths: string[] = [];
      for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); cohMonths.push(d.toISOString().slice(0, 7)); }
      const monthIndex = (m: string) => { const [y, mm] = m.split('-').map(Number); return y * 12 + (mm - 1); };
      const lastIdx = monthIndex(cohMonths[cohMonths.length - 1]);
      const labels: string[] = [], sizes: number[] = [], matrix: number[][] = [];
      for (const cm of cohMonths) {
        const members = cs.filter((c: any) => String(c.created_at).slice(0, 7) === cm);
        if (!members.length) continue;
        const base = monthIndex(cm), maxK = lastIdx - base;
        const row: number[] = [];
        for (let k = 0; k <= maxK; k++) {
          if (k === 0) { row.push(100); continue; }
          const targetIdx = base + k; let activeN = 0;
          for (const mem of members) { const set = act[mem.id]; if (set) { let hit = false; set.forEach((am) => { if (monthIndex(am) === targetIdx) hit = true; }); if (hit) activeN++; } }
          row.push(Math.round((activeN / members.length) * 100));
        }
        labels.push(cm); sizes.push(members.length); matrix.push(row);
      }
      if (matrix.length) series.cohorts = { labels, sizes, matrix };
    }
  } catch { /* ignore */ }

  // Attendance buckets + at-risk members (flight risk) — real from workouts.
  try {
    const { data: allc } = await admin.from('profiles').select('id, full_name').eq('role', 'client').limit(1000);
    if (Array.isArray(allc) && allc.length) {
      const cid = allc.map((c: any) => c.id);
      const nameMap: Record<string, string> = {}; allc.forEach((c: any) => { nameMap[c.id] = c.full_name || 'Member'; });
      const visits: Record<string, number> = {}, last: Record<string, number> = {};
      try {
        const { data: w } = await admin.from('workouts').select('user_id, performed_at').in('user_id', cid).limit(50000);
        (w || []).forEach((x: any) => { const t = Date.parse(x.performed_at); if (isFinite(t)) { if (t >= Date.now() - 30 * DAY) visits[x.user_id] = (visits[x.user_id] || 0) + 1; if (!last[x.user_id] || t > last[x.user_id]) last[x.user_id] = t; } });
      } catch { /* ignore */ }
      let b12 = 0, b611 = 0, b25 = 0, b01 = 0;
      cid.forEach((id: string) => { const v = visits[id] || 0; if (v >= 12) b12++; else if (v >= 6) b611++; else if (v >= 2) b25++; else b01++; });
      const tot = cid.length || 1;
      series.attendanceBuckets = [
        ['12+ visits', Math.round((b12 / tot) * 100), '#3ddc97'],
        ['6–11 visits', Math.round((b611 / tot) * 100)],
        ['2–5 visits', Math.round((b25 / tot) * 100), '#f2c85a'],
        ['0–1 visits', Math.round((b01 / tot) * 100), '#ff6f61'],
      ];
      series.atRisk = cid.map((id: string) => ({ name: nameMap[id], last: last[id] || 0 }))
        .sort((a: any, b: any) => a.last - b.last).slice(0, 5)
        .map((r: any) => ({ name: r.name, days: r.last ? Math.round((Date.now() - r.last) / DAY) : null }));
    }
  } catch { /* ignore */ }

  return json({ ok: true, metrics, series, live, generatedAt: new Date().toISOString() });
});
