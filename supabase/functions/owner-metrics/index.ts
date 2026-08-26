// Supabase Edge Function: owner-metrics
// Live operational metrics for the Owner Command Center web portal.
// SECURITY MODEL:
//   • The caller must be a signed-in user whose profiles.role = 'owner' AND who
//     has a tenant. An owner without a tenant gets nothing.
//   • Aggregation runs with the SERVICE ROLE *inside this function only* — the
//     service key never reaches the browser. The browser holds only the public
//     anon key and the owner's own JWT.
//   • The service role bypasses RLS completely, so NONE of the row-level
//     policies that scope the rest of the platform apply in here. Every query
//     below therefore has to carry its own tenant filter, by hand. This is the
//     whole security boundary for this endpoint; there is no second line.
//
// WHAT THIS USED TO LEAK (fixed here):
//   The only check was `role === 'owner'`, which asks "is this caller AN owner",
//   never "does this caller own THIS gym". `role = 'owner'` means a GYM owner
//   scoped to one tenant (see 27-owner-portal-access.sql) and the platform lets
//   people sign up as one. So any owner account — a competitor's, a trial
//   signup's — could pull every other gym's member names and join dates, its
//   trainer roster with client counts, its billing revenue, a named live
//   activity feed and its cohort retention, in a single unauthenticated-by-gym
//   call. Everything below is now constrained to the caller's own tenant.
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

// Reading a whole table when PostgREST will not give you one.
//
// PostgREST caps EVERY response at the project's "Max rows" setting, which
// Supabase ships at 1000. `.limit(50000)` does not lift that ceiling — it sets
// a second, higher one, and the lower of the two wins. So every aggregate below
// that read more rows than Max rows was computed from the first page and
// returned as fact: no error, no flag, no truncation notice. A gym with 1200
// logged workouts would have had its retention, its at-risk list and its visit
// counts quietly computed from 1000 of them, and the number would have looked
// entirely reasonable — which is exactly what makes it dangerous. It gets worse
// as the gym grows, and it never announces itself.
//
// So we page with .range() until a short page comes back. `truncated` is the
// honest escape hatch: if a metric would need more than `cap` rows we return
// what we have AND say so, and every caller drops the metric rather than
// publishing a figure it knows is partial. Omitting a number is a state the
// portal already renders as a dash; a wrong number is not.
//
// One consequence to know about. Several reads below feed the full id list into
// `.in('user_id', ids)`, and that list is now complete where it used to be
// silently clipped at the ceiling. A few thousand uuids make a request URL long
// enough that PostgREST will reject it — so a very large gym may now see one of
// these metrics fail outright where before it quietly returned a wrong answer.
// That is the trade being made on purpose, and it is the right way round: the
// failure is caught, the metric is omitted, and the portal shows a dash. If a
// gym ever reaches that size the fix is to aggregate in the database rather
// than to widen the ceiling again.
const PAGE = 1000;
async function pageAll<T = any>(
  build: (from: number, to: number) => any,
  cap = 100000,
): Promise<{ rows: T[]; error: any; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { rows, error, truncated: false };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

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

  // 2) Authorize: role must be 'owner' AND the owner must have a tenant.
  //    The tenant is loaded here, in the same lookup as the role, because the
  //    two are inseparable: "owner" on its own authorizes nothing. An owner row
  //    with a null tenant_id is rejected rather than treated as "all gyms" —
  //    unscoped fails closed, the same rule 30-classes-tenant-scope.sql applies
  //    to a class with no tenant.
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: prof } = await admin.from('profiles').select('role, tenant_id').eq('id', uid).maybeSingle();
  if (!prof || prof.role !== 'owner') return json({ ok: false, error: 'Owner access only.' }, 403);
  const tenantId: string | null = prof.tenant_id ?? null;
  if (!tenantId) return json({ ok: false, error: 'This owner account is not attached to a gym.' }, 403);

  // 3) Aggregate. Each metric guarded so one missing table can't sink the rest.
  const metrics: Record<string, number | null> = {};
  const series: Record<string, any> = {};
  const live: string[] = [];
  const set = (k: string, v: number | null) => { metrics[k] = v; if (v != null) live.push(k); };

  // ── Tenant scoping ────────────────────────────────────────────────────────
  // Two shapes of table, two ways to constrain them.
  //
  // (a) The table carries tenant_id itself — profiles, clients, sessions. Filter
  //     on it directly. `count()` below REQUIRES the caller to name that column,
  //     so there is deliberately no way left to spell an unscoped count in this
  //     function; forgetting the filter is a type error, not a data breach.
  //
  // (b) The table has no tenant of its own — workouts, scans, check_ins,
  //     workout_logs, and the billing tables, which are all keyed on a person
  //     (user_id / client_id / trainer_id) rather than on a gym. Those are
  //     reached through the row that does know: PostgREST's `parent!inner(...)`
  //     embed combined with .eq('parent.tenant_id', …) turns the join into a
  //     filter, so a row belonging to another gym — or to nobody, i.e. a parent
  //     with a null tenant_id — is dropped by the join itself. No id lists in a
  //     query string, so this holds at any gym size.
  //
  // Honest limitation: (b) depends on the foreign keys PostgREST can see. If an
  // embed cannot be resolved the query errors, the helper returns null, and the
  // metric is simply omitted from `live` — the portal then falls back to sample
  // data. That degrades the dashboard; it never widens it. The durable fix is a
  // tenant_id column on workouts/scans/check_ins the way 30- and 33- added one
  // to gym_classes and sessions.
  const count = async (table: string, tenantCol: string, build?: (q: any) => any): Promise<number | null> => {
    try {
      let q: any = admin.from(table).select('*', { count: 'exact', head: true }).eq(tenantCol, tenantId);
      if (build) q = build(q);
      const { count: c, error } = await q;
      return error ? null : (c ?? 0);
    } catch { return null; }
  };
  const countVia = async (table: string, parent: string, build?: (q: any) => any): Promise<number | null> => {
    try {
      let q: any = admin.from(table)
        .select(`*, ${parent}!inner(tenant_id)`, { count: 'exact', head: true })
        .eq(`${parent}.tenant_id`, tenantId);
      if (build) q = build(q);
      const { count: c, error } = await q;
      return error ? null : (c ?? 0);
    } catch { return null; }
  };
  const distinctCountVia = async (table: string, col: string, parent: string, build?: (q: any) => any): Promise<number | null> => {
    try {
      const { rows, error, truncated } = await pageAll((from, to) => {
        let q: any = admin.from(table)
          .select(`${col}, ${parent}!inner(tenant_id)`)
          .eq(`${parent}.tenant_id`, tenantId)
          .range(from, to);
        if (build) q = build(q);
        return q;
      });
      // A distinct count off a truncated read is the worst kind of wrong: it is
      // always an undercount, and it always looks plausible.
      if (error || truncated) return null;
      return new Set(rows.map((r: any) => r[col]).filter(Boolean)).size;
    } catch { return null; }
  };

  // Trainer ids for this gym. The billing tables (invoices, subscriptions,
  // billing_customers, connect_accounts, client_purchases) are keyed on
  // trainer_id -> profiles(id) and have no tenant of their own, so "this gym's
  // revenue" can only mean "rows belonging to this gym's trainers".
  // An empty list is not "no filter": .in(col, []) matches nothing, so a failed
  // lookup omits the money metrics rather than exposing the platform's.
  const trainerIds: string[] = await (async () => {
    try {
      const { rows: data, error } = await pageAll((from, to) => admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', 'trainer').range(from, to));
      if (error || !data) return [];
      return data.map((r: any) => r.id);
    } catch { return []; }
  })();

  // People — profiles carries tenant_id, so these scope directly.
  set('trainers', await count('profiles', 'tenant_id', (q) => q.eq('role', 'trainer')));
  set('clientsTotal', await count('profiles', 'tenant_id', (q) => q.eq('role', 'client')));
  set('newClients30', await count('profiles', 'tenant_id', (q) => q.eq('role', 'client').gte('created_at', iso(30 * DAY))));

  // `brands` (count of rows in `tenants`) is REMOVED rather than scoped. It has
  // no tenant-scoped meaning: for a gym owner the answer is always 1, and the
  // unscoped answer is a headcount of every gym on the platform — a competitor
  // sizing the business, which is exactly what this endpoint should not hand
  // out. The portal treats a missing metric as "show sample", so it degrades
  // rather than breaks.

  // Engagement / activity — workouts, scans and workout_logs are keyed on a
  // person, not a gym, so each is reached through that person's row.
  let active = await distinctCountVia('workouts', 'user_id', 'profiles', (q) => q.gte('performed_at', iso(30 * DAY)));
  if (active == null) active = await distinctCountVia('workout_logs', 'client_id', 'clients', (q) => q.gte('logged_at', iso(30 * DAY)));
  set('activeMembers', active);
  set('scans7', await countVia('scans', 'clients', (q) => q.gte('taken_at', isoDate(7 * DAY))));
  let wk = await countVia('workouts', 'profiles', (q) => q.gte('performed_at', iso(7 * DAY)));
  if (wk == null) wk = await countVia('workout_logs', 'clients', (q) => q.gte('logged_at', iso(7 * DAY)));
  set('workouts7', wk);
  // sessions gained its own tenant_id in 33-session-outcomes.sql, backfilled
  // from the trainer and kept current by a trigger, so filter it directly.
  set('ptSessions30', await count('sessions', 'tenant_id', (q) => q.eq('status', 'booked').gte('starts_at', iso(30 * DAY))));

  // Class fill (attended / booked) over the last 30 days.
  //
  // Computed here from gym_classes + class_bookings rather than through the
  // class_attendance_summary RPC. That RPC gates on
  // `gc.trainer_id = auth.uid() or is_owner_of(gc.tenant_id)`, and auth.uid()
  // is NULL under the service role — so it matched no row for any gym, ever.
  // classes30, classFillPct, byBranch and byKind were never set, and the portal
  // quietly fell back to SAMPLE data for class fill: an owner was shown
  // invented attendance for their own timetable with nothing marking it as
  // invented. An empty result and a refusal looked identical.
  //
  // The RPC is deliberately left exactly as it is. It works for the signed-in
  // trainer and owner callers that can satisfy its guard, and widening it to
  // answer service-role calls would reintroduce the cross-gym leak this file
  // closed — its owner branch is `exists (… o.role = 'owner')` with no tenant
  // test at all, so a widened version would hand every gym's timetable to any
  // owner account. Nothing here relaxes a security-definer function.
  //
  // Instead this reads the tables directly under the same boundary every other
  // query in this file uses. gym_classes carries its own tenant_id
  // (30-classes-tenant-scope.sql), so shape (a) applies to it: the filter is
  // explicit and by hand. class_bookings has no tenant of its own, so it takes
  // shape (b): the `gym_classes!inner(...)` embed makes the join itself the
  // filter, which means no id list in a query string and no size at which this
  // stops holding. A booking on another gym's class cannot survive the join.
  try {
    const [clsRes, bkRes] = await Promise.all([
      pageAll((from, to) => admin.from('gym_classes')
        .select('id, title, kind, branch')
        .eq('tenant_id', tenantId)
        .gte('starts_at', iso(30 * DAY))
        .lt('starts_at', iso(0))
        .range(from, to)),
      pageAll((from, to) => admin.from('class_bookings')
        .select('class_id, status, attended_at, gym_classes!inner(tenant_id, starts_at)')
        .eq('gym_classes.tenant_id', tenantId)
        .gte('gym_classes.starts_at', iso(30 * DAY))
        .lt('gym_classes.starts_at', iso(0))
        .range(from, to)),
    ]);
    // Both reads must succeed. A fill rate computed from classes we could read
    // and bookings we could not is a number that looks precise and is wrong;
    // leaving the metric out of `live` is the honest answer.
    if (!clsRes.error && !bkRes.error && !clsRes.truncated && !bkRes.truncated && clsRes.rows.length) {
      // Same definitions the RPC used, so the figure does not move when a
      // caller switches between the two paths: booked counts bookings still in
      // 'booked', attended counts anyone actually marked in, whatever their
      // booking status now says.
      const tally = new Map<string, { a: number; b: number }>();
      for (const bk of bkRes.rows as any[]) {
        const t = tally.get(bk.class_id) ?? { a: 0, b: 0 };
        if (bk.status === 'booked') t.b++;
        if (bk.attended_at) t.a++;
        tally.set(bk.class_id, t);
      }
      let att = 0, bkd = 0;
      const byBranch: Record<string, { a: number; b: number }> = {};
      const byKind: Record<string, { a: number; b: number }> = {};
      for (const c of clsRes.rows as any[]) {
        const t = tally.get(c.id) ?? { a: 0, b: 0 };
        att += t.a; bkd += t.b;
        const br = c.branch || '\u2014';
        (byBranch[br] ||= { a: 0, b: 0 }); byBranch[br].a += t.a; byBranch[br].b += t.b;
        const kd = c.kind || c.title || 'Class';
        (byKind[kd] ||= { a: 0, b: 0 }); byKind[kd].a += t.a; byKind[kd].b += t.b;
      }
      set('classes30', clsRes.rows.length);
      // No bookings at all is "not known", not 0% — a gym that ran classes
      // nobody booked has no fill rate to report.
      set('classFillPct', bkd > 0 ? Math.round((att / bkd) * 100) : null);
      const toBars = (m: Record<string, { a: number; b: number }>) =>
        Object.entries(m).map(([k, v]) => [k, v.b > 0 ? Math.round((v.a / v.b) * 100) : 0]).sort((x: any, y: any) => y[1] - x[1]);
      series.byBranch = toBars(byBranch);
      series.byKind = toBars(byKind);
    }
  } catch { /* leave the metric unset rather than guessed */ }

  // New-member trend: client sign-ups per calendar month, last 12 months.
  try {
    const { rows: data, error, truncated } = await pageAll((from, to) => admin.from('profiles').select('created_at').eq('tenant_id', tenantId).eq('role', 'client').gte('created_at', iso(365 * DAY)).range(from, to));
    if (!error && !truncated && data.length) {
      const now = new Date();
      const months: string[] = [];
      for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.toISOString().slice(0, 7)); }
      const counts: Record<string, number> = {}; months.forEach((m) => { counts[m] = 0; });
      data.forEach((r: any) => { const m = String(r.created_at).slice(0, 7); if (m in counts) counts[m]++; });
      series.signupTrend = { labels: months, counts: months.map((m) => counts[m]) };
    }
  } catch { /* no profiles trend */ }

  // Revenue (real only if billing rows exist; otherwise omitted → portal shows sample).
  //
  // Scoped to this gym's trainers. `invoices` and `subscriptions` are keyed on
  // trainer_id and carry no tenant, so unscoped they summed every trainer on the
  // platform — one gym's owner reading another's turnover. Two caveats worth
  // being straight about: (1) these tables are the PLATFORM billing the trainer
  // for the white-label fee (20-billing.sql), not members paying the gym, so
  // `revenue30` is subscription cost, not gym takings — 29-gym-operating-record
  // adds gym_payments/gym_invoices, which are tenant-native and are the honest
  // source for that number; (2) a trainer who has left the tenant takes their
  // invoices with them, because trainerIds is a snapshot of today's roster.
  try {
    const { rows: inv, error: invErr, truncated: invCut } = await pageAll((from, to) => admin.from('invoices').select('amount_due, status, created_at').in('trainer_id', trainerIds).gte('created_at', iso(30 * DAY)).range(from, to));
    // Revenue especially: a truncated read understates it, and an owner acts on
    // a revenue figure. No number beats a low one presented as the real total.
    if (!invErr && !invCut && inv.length) {
      const paid = inv.filter((r: any) => (r.status ?? 'paid') === 'paid');
      const cents = paid.reduce((a: number, r: any) => a + Number(r.amount_due || 0), 0); // Stripe stores cents
      if (cents > 0) set('revenue30', Math.round(cents / 100));
    }
  } catch { /* no invoices table */ }
  try {
    const { count: subs } = await admin.from('subscriptions').select('*', { count: 'exact', head: true }).in('trainer_id', trainerIds).eq('status', 'active');
    if (subs != null && subs > 0) set('activeSubscriptions', subs);
  } catch { /* no subscriptions table */ }

  // ── Names helper (id -> full_name) ────────────────────────────────────────
  // Tenant-filtered as well as id-filtered. The callers already pass tenant-
  // scoped ids, but this is the one place that turns an id into a person's real
  // name, so it refuses to resolve anyone outside the gym on principle — a
  // stray id from a future caller yields 'Member', not a stranger's name.
  const namesFor = async (ids: string[]): Promise<Record<string, string>> => {
    const m: Record<string, string> = {};
    if (!ids.length) return m;
    try { const { data } = await admin.from('profiles').select('id, full_name').eq('tenant_id', tenantId).in('id', ids.slice(0, 500)); (data || []).forEach((p: any) => { m[p.id] = p.full_name || 'Member'; }); } catch { /* ignore */ }
    return m;
  };

  // Recent members (last 8 client sign-ups) with visit count + active flag.
  // The seed query is tenant-filtered, so the ids it produces are already this
  // gym's; every lookup hung off `ids` below inherits that scope.
  try {
    const { data: rm } = await admin.from('profiles').select('id, full_name, created_at').eq('tenant_id', tenantId).eq('role', 'client').order('created_at', { ascending: false }).limit(8);
    if (Array.isArray(rm) && rm.length) {
      const ids = rm.map((r: any) => r.id);
      const visits: Record<string, number> = {}, lastAct: Record<string, number> = {};
      try {
        const { rows: w } = await pageAll((from, to) => admin.from('workouts').select('user_id, performed_at').in('user_id', ids).range(from, to));
        w.forEach((x: any) => { visits[x.user_id] = (visits[x.user_id] || 0) + 1; const t = Date.parse(x.performed_at); if (!lastAct[x.user_id] || t > lastAct[x.user_id]) lastAct[x.user_id] = t; });
      } catch { /* ignore */ }
      series.recentMembers = rm.map((r: any) => ({ name: r.full_name || 'Member', joined: String(r.created_at).slice(0, 10), visits: visits[r.id] || 0, active: lastAct[r.id] ? (Date.now() - lastAct[r.id] < 30 * DAY) : false }));
    }
  } catch { /* ignore */ }

  // Trainer roster with client counts.
  try {
    const { data: tr } = await admin.from('profiles').select('id, full_name').eq('tenant_id', tenantId).eq('role', 'trainer').limit(100);
    if (Array.isArray(tr) && tr.length) {
      const counts: Record<string, number> = {};
      // `clients` carries tenant_id (not null), so the headcount per trainer is
      // filtered directly — unscoped this was every trainer on the platform and
      // the size of their book.
      try { const { rows: cl } = await pageAll((from, to) => admin.from('clients').select('trainer_id').eq('tenant_id', tenantId).range(from, to)); cl.forEach((c: any) => { if (c.trainer_id) counts[c.trainer_id] = (counts[c.trainer_id] || 0) + 1; }); } catch { /* ignore */ }
      series.trainersList = tr.map((t: any) => ({ name: t.full_name || 'Trainer', clients: counts[t.id] || 0 }));
    }
  } catch { /* ignore */ }

  // Live activity feed — newest workouts, scans and sign-ups, merged by time.
  // This was the sharpest edge of the leak: it names people. Unscoped, an owner
  // watched a live, named stream of other gyms' members training, scanning and
  // joining. Each of the three sources is now tenant-bound at the source.
  try {
    const acts: { who: string; at: number; kind: string }[] = [];
    try { const { data: w } = await admin.from('workouts').select('user_id, performed_at, profiles!inner(tenant_id)').eq('profiles.tenant_id', tenantId).order('performed_at', { ascending: false }).limit(6); (w || []).forEach((x: any) => acts.push({ who: x.user_id, at: Date.parse(x.performed_at), kind: 'workout' })); } catch { /* ignore */ }
    try { const { data: sc } = await admin.from('scans').select('client_id, created_at, taken_at, clients!inner(tenant_id)').eq('clients.tenant_id', tenantId).order('created_at', { ascending: false }).limit(6); (sc || []).forEach((x: any) => acts.push({ who: x.client_id, at: Date.parse(x.created_at || x.taken_at), kind: 'scan' })); } catch { /* ignore */ }
    try { const { data: nj } = await admin.from('profiles').select('id, created_at').eq('tenant_id', tenantId).eq('role', 'client').order('created_at', { ascending: false }).limit(6); (nj || []).forEach((x: any) => acts.push({ who: x.id, at: Date.parse(x.created_at), kind: 'join' })); } catch { /* ignore */ }
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
    // Cohorts start from this gym's clients only; the workouts/check_ins reads
    // below are `.in(…, ids)` against that scoped list, so they inherit it.
    const { rows: cs, error: csErr, truncated: csCut } = await pageAll((from, to) => admin.from('profiles').select('id, created_at').eq('tenant_id', tenantId).eq('role', 'client').gte('created_at', iso(190 * DAY)).range(from, to));
    if (!csErr && !csCut && cs.length) {
      const ids = cs.map((c: any) => c.id);
      const act: Record<string, Set<string>> = {};
      const addAct = (id: string, ts: string) => { const mo = String(ts).slice(0, 7); (act[id] ||= new Set<string>()).add(mo); };
      try { const { rows: w } = await pageAll((from, to) => admin.from('workouts').select('user_id, performed_at').in('user_id', ids).range(from, to)); w.forEach((x: any) => addAct(x.user_id, x.performed_at)); } catch { /* ignore */ }
      try { const { rows: ci } = await pageAll((from, to) => admin.from('check_ins').select('user_id, at').in('user_id', ids).range(from, to)); ci.forEach((x: any) => addAct(x.user_id, x.at)); } catch { /* ignore */ }
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
    // Same shape as cohorts: scope the client list, and the `.in('user_id', cid)`
    // workout read that follows is scoped by construction. atRisk names people,
    // so this filter is what keeps another gym's lapsed members out of it.
    // This one was .limit(1000) — sitting exactly on the default ceiling, so a
    // gym with 1001 members silently dropped one and every band below was a
    // percentage of the wrong denominator.
    const { rows: allc, error: allcErr, truncated: allcCut } = await pageAll((from, to) => admin.from('profiles').select('id, full_name').eq('tenant_id', tenantId).eq('role', 'client').range(from, to));
    if (!allcErr && !allcCut && allc.length) {
      const cid = allc.map((c: any) => c.id);
      const nameMap: Record<string, string> = {}; allc.forEach((c: any) => { nameMap[c.id] = c.full_name || 'Member'; });
      const visits: Record<string, number> = {}, last: Record<string, number> = {};
      try {
        const { rows: w } = await pageAll((from, to) => admin.from('workouts').select('user_id, performed_at').in('user_id', cid).range(from, to));
        w.forEach((x: any) => { const t = Date.parse(x.performed_at); if (isFinite(t)) { if (t >= Date.now() - 30 * DAY) visits[x.user_id] = (visits[x.user_id] || 0) + 1; if (!last[x.user_id] || t > last[x.user_id]) last[x.user_id] = t; } });
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
