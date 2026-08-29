// Shared client roster for the trainer portal — reactive so the coach can add or
// remove clients and the change flows to the Clients list and the Schedule's
// client picker.
//
// ── An empty roster is the most expensive lie in this app ──────────────────
//
// A trainer opening the Clients tab and seeing nothing concludes one of two
// things: that they have not linked anyone yet, or — far worse, and this has
// happened — that their clients are gone. The old code made those
// indistinguishable. Every read here discarded its error:
//
//   · `const { data: mc } = await supabase.from('coach_clients')…` — no `error`
//     at all. The catch it sits in cannot fire, because supabase-js resolves
//     with `{ data: null, error }` rather than throwing, so a refused read left
//     `manual` as `[]` and every manually added client simply disappeared.
//   · `if (error || !cls || !cls.length) { … return; }` folded a failed read and
//     an empty table into one branch.
//   · the outer `catch { /* stay on demo roster */ }` swallowed the rest.
//
// The reads still degrade the same way — a coach with no signal keeps whatever
// loaded — but `status` now says whether the list on screen is the server's
// answer or the absence of one, so the Clients tab can stop asserting "no
// clients yet" over a failure.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RosterClient } from '../lib/trainerMock';
import { readCoachedMode, modeForDb, type CoachedMode } from '../lib/types';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

let SEQ = 900;
const MODE_KEY = 'repple.clientModes';

interface RosterValue {
  roster: RosterClient[];
  /** Whether `roster` is the server's answer. Under 'error' an empty roster
   *  means the list could not be read, NOT that the coach has no clients. */
  status: LoadStatus;
  /** Resolves true only when the client row reached `coach_clients` and will
   *  survive a relaunch. False means it exists on this phone only. */
  addClient: (name: string, goal: string, mode?: CoachedMode) => Promise<boolean>;
  /** Resolves true only when the row was actually deleted on the server. A
   *  refused delete leaves the client on the roster after the next launch. */
  removeClient: (id: string) => Promise<boolean>;
  /** Resolves true only when the classification was stored server-side. It is
   *  always kept on this device, so false means "this phone only", not "lost". */
  setClientMode: (id: string, mode: CoachedMode) => Promise<boolean>;
}

const Ctx = createContext<RosterValue | null>(null);

export function RosterProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [roster, setRoster] = useState<RosterClient[]>([]);
  // Trainer-set delivery overrides (persisted). Real DB clients default to
  // 'online'; this lets the coach classify each so the roster filter works for
  // them. It carries a second job now: every `mode` column is CHECK-constrained
  // to ('online','inperson'), so a client the coach marks Hybrid is STORED as
  // 'inperson' (modeForDb) and would read back as In-person on the next launch.
  // The override is what holds the coach's real answer until the constraints
  // are widened — on this device, which is where they classified them.
  const [modeOverrides, setModeOverrides] = useState<Record<string, CoachedMode>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  useEffect(() => { (async () => { try { const raw = await AsyncStorage.getItem(MODE_KEY); if (raw) setModeOverrides(JSON.parse(raw)); } catch { /* local classification only; the roster itself is unaffected */ } })(); }, []);

  // A real signed-in coach sees ONLY their linked clients (clean slate if none);
  // a guest/demo (no session) sees the sample roster so the portal isn't empty to explore.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const uid = auth?.user?.id;
        if (!uid) { setRoster([]); setStatus('ready'); return; }
        setUid(uid);
        // Both halves of the roster are load-bearing, so a failure in either one
        // means the list on screen is incomplete and must not be presented as
        // the whole roster.
        let partialFailure = false;
        // Coach-created (manual) clients — durable in coach_clients (session-9 SQL).
        let manual: RosterClient[] = [];
        try {
          const { data: mc, error: mcErr } = await supabase.from('coach_clients').select('id, name, goal, mode, created_at').eq('trainer_id', uid).order('created_at', { ascending: true });
          // A table that does not exist yet is a deployment state, not a data
          // fact — either way the coach's manual clients are missing from what
          // they are about to be shown.
          if (mcErr) partialFailure = true;
          manual = (mc || []).map((r: any) => ({ id: r.id, name: r.name, goal: r.goal || 'General', weightDelta: null, adherence: null, lastActive: 'added by you', next: '—', unread: 0, mode: readCoachedMode(r.mode), joinedAt: r.created_at ?? null }));
        } catch { partialFailure = true; }
        const { data: cls, error } = await supabase.from('clients').select('id, goal, diet, meals_per_day, avoid, mode').eq('trainer_id', uid);
        // When each linked client joined THIS coach's book. `clients` has no
        // created_at of its own, and the account's own creation date is the
        // wrong question anyway — somebody can have trained for a year before
        // switching coach. coaching_relationships is when this book started.
        const joined: Record<string, string> = {};
        try {
          // no-error-ok: a join date we cannot read stays null and renders '—'; the client is listed either way
          const { data: rel } = await supabase
            .from('coaching_relationships').select('client_id, created_at').eq('coach_id', uid);
          (rel || []).forEach((r: any) => { if (r.created_at) joined[r.client_id] = r.created_at; });
        } catch { /* a missing join date is null, never a guessed one */ }
        if (cancelled) return;
        // Split apart what used to be one branch. A refused read is 'error'
        // whatever else we managed to load; an empty table with the manual list
        // intact is a real, complete answer.
        if (error) { if (manual.length) setRoster(manual); setStatus('error'); return; }
        if (!cls || !cls.length) { setRoster(manual); setStatus(partialFailure ? 'error' : 'ready'); return; }
        const ids = cls.map((c: any) => c.id);
        const names: Record<string, string> = {};
        try {
          // no-error-ok: a name we cannot read falls back to 'Client'; the person is still on the roster
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
          (profs || []).forEach((p: any) => { names[p.id] = p.full_name || 'Client'; });
        } catch { /* a missing name falls back to 'Client'; the client is still listed */ }
        // Real per-client stats (best-effort; RLS lets a trainer read linked clients' rows).
        // These are decorations on a row that exists either way, so a failure
        // here degrades a figure rather than hiding a person — it does not move
        // the roster into 'error'.
        const ago = (t: number) => { const sec = Math.max(0, Math.round((Date.now() - t) / 1000)); if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + 'm ago'; if (sec < 86400) return Math.round(sec / 3600) + 'h ago'; return Math.round(sec / 86400) + 'd ago'; };
        const st: Record<string, { wDelta: number | null; adh: number | null; last: number; mx?: any }> = {};
        // wDelta starts null, not 0. It only becomes a number when two scans
        // exist to subtract, and a client with one scan has no delta yet.
        ids.forEach((id: string) => { st[id] = { wDelta: null, adh: null, last: 0 }; });
        try {
          const { data: sc, error: scErr } = await supabase.from('scans').select('client_id, weight_kg, taken_at, metrics').in('client_id', ids).order('taken_at', { ascending: true });
          // supabase-js resolves on a database error, so the catch below never
          // saw the failure that actually happens. Without this, a refused read
          // left every client reading "no activity yet" — which is a claim
          // about the client, and a coach acts on it by chasing them.
          if (scErr) partialFailure = true;
          const byC: Record<string, { w: number; t: number; m: any }[]> = {};
          (sc || []).forEach((r: any) => { (byC[r.client_id] = byC[r.client_id] || []).push({ w: Number(r.weight_kg), t: Date.parse(r.taken_at), m: r.metrics }); });
          for (const id of ids) { const arr = byC[id]; if (arr && arr.length) { st[id].wDelta = arr.length > 1 ? Math.round((arr[arr.length - 1].w - arr[0].w) * 10) / 10 : null; st[id].last = Math.max(st[id].last, arr[arr.length - 1].t); for (let k = arr.length - 1; k >= 0; k--) { if (arr[k].m) { st[id].mx = arr[k].m; break; } } } }
        } catch { /* stats decorate a row that is listed regardless */ }
        try {
          const { data: wo, error: woErr } = await supabase.from('workouts').select('user_id, performed_at').in('user_id', ids).order('performed_at', { ascending: false });
          if (woErr) partialFailure = true;
          (wo || []).forEach((r: any) => { if (st[r.user_id]) st[r.user_id].last = Math.max(st[r.user_id].last, Date.parse(r.performed_at)); });
        } catch { /* as above */ }
        try {
          const { data: ci, error: ciErr } = await supabase.from('check_ins').select('user_id, at, adherence').in('user_id', ids).order('at', { ascending: false });
          if (ciErr) partialFailure = true;
          const seen = new Set<string>();
          (ci || []).forEach((r: any) => { if (st[r.user_id]) { st[r.user_id].last = Math.max(st[r.user_id].last, Date.parse(r.at)); if (!seen.has(r.user_id) && typeof r.adherence === 'number') { seen.add(r.user_id); // check_ins.adherence is a 1-5 self-rating (see the Rating control on the client check-in screen), but every trainer surface renders this field as a PERCENTAGE and atRiskClient() flags anything under 80. Passing it through raw meant a client who rated themselves 4/5 showed as '4% adherence' and was flagged at risk. Convert.
            st[r.user_id].adh = Math.round((Math.max(1, Math.min(5, r.adherence)) / 5) * 100); } } });
        } catch { /* as above */ }
        const goalMap: Record<string, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };
        const real: RosterClient[] = cls.map((c: any) => { const sc = st[c.id]; return { id: c.id, name: names[c.id] || 'Client', goal: goalMap[c.goal] || 'General', weightDelta: sc.wDelta, adherence: sc.adh != null ? sc.adh : null, lastActive: sc.last ? ago(sc.last) : 'no activity yet', next: '—', unread: 0, mode: readCoachedMode(c.mode), metrics: sc.mx ?? undefined, diet: c.diet ?? undefined, mealsPerDay: c.meals_per_day ?? undefined, avoid: Array.isArray(c.avoid) ? c.avoid : undefined, joinedAt: joined[c.id] ?? null }; });
        if (!cancelled) { setRoster([...real, ...manual]); setStatus(partialFailure ? 'error' : 'ready'); }
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev]);
  /** Keep the coach's answer on this device. Persisted, because the server can
   *  only hold the narrowed one until the CHECK constraints are widened. */
  const rememberMode = (id: string, mode: CoachedMode) => {
    setModeOverrides((p) => { const next = { ...p, [id]: mode }; try { AsyncStorage.setItem(MODE_KEY, JSON.stringify(next)); } catch { /* the override still applies this session */ } return next; });
  };
  const addClient = async (name: string, goal: string, mode: CoachedMode = 'online'): Promise<boolean> => {
    const n = name.trim();
    if (!n) return false;
    const localId = `c${SEQ++}`;
    setRoster((p) => [...p, { id: localId, name: n, goal, weightDelta: null, adherence: null, lastActive: 'just added', next: '—', unread: 0, mode, joinedAt: new Date().toISOString() }]);
    // Durable: persist to coach_clients so the roster survives restarts/devices.
    if (!USE_SUPABASE || !uid) return false;
    try {
      // Narrowed on the way out — the column will not take 'hybrid' — and
      // recorded in full below so the roster still shows what the coach chose.
      const { data, error } = await supabase.from('coach_clients').insert({ trainer_id: uid, name: n, goal, mode: modeForDb(mode) }).select('id').single();
      const sid = data?.id;
      if (error || !sid) return false;
      setRoster((p) => p.map((c) => (c.id === localId ? { ...c, id: sid } : c)));
      // Against the SERVER id, now that there is one: the insert narrowed
      // 'hybrid' to 'inperson', and without this the client the coach just
      // classified as Hybrid comes back as In-person on the next launch.
      rememberMode(sid, mode);
      return true;
    } catch { return false; }
  };
  const removeClient = async (id: string): Promise<boolean> => {
    setRoster((p) => p.filter((c) => c.id !== id));
    // A local id (no dashes) never reached the server, so removing it locally is
    // the whole of the removal and genuinely succeeded.
    if (!USE_SUPABASE || !id.includes('-')) return true;
    try {
      const { error } = await supabase.from('coach_clients').delete().eq('id', id);
      return !error;
    } catch { return false; }
  };
  const setClientMode = async (id: string, mode: CoachedMode): Promise<boolean> => {
    rememberMode(id, mode);
    // Durably persist to Supabase so the classification follows the client across
    // devices and feeds owner analytics (RLS: a trainer may update their own clients).
    if (!USE_SUPABASE) return false;
    // The id belongs to exactly one of these two tables, so the other update
    // matches nothing. An update that matches nothing is NOT an error in
    // Postgrest — it succeeds having changed zero rows — which is why both of
    // these could "succeed" while the classification was stored nowhere.
    // Counting the returned rows is the only way to tell.
    try {
      const { data, error } = await supabase.from('clients').update({ mode: modeForDb(mode) }).eq('id', id).select('id');
      if (!error && data && data.length) return true;
    } catch { /* fall through to the coach_clients attempt */ }
    try {
      const { data, error } = await supabase.from('coach_clients').update({ mode: modeForDb(mode) }).eq('id', id).select('id');
      return !error && !!data && data.length > 0;
    } catch { return false; }
  };
  // Apply overrides on top of whatever mode the roster came with.
  const shown = Object.keys(modeOverrides).length ? roster.map((c) => (modeOverrides[c.id] ? { ...c, mode: modeOverrides[c.id] } : c)) : roster;
  return <Ctx.Provider value={{ roster: shown, status, addClient, removeClient, setClientMode }}>{children}</Ctx.Provider>;
}

export function useRoster(): RosterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoster must be used inside <RosterProvider>');
  return v;
}
