// Shared client roster for the trainer portal — reactive so the coach can add or
// remove clients and the change flows to the Clients list and the Schedule's
// client picker. Seeded from the mock roster; swap for Supabase later.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ROSTER, type RosterClient } from '../lib/trainerMock';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

let SEQ = 900;

interface RosterValue {
  roster: RosterClient[];
  addClient: (name: string, goal: string, mode?: 'online' | 'inperson') => void;
  removeClient: (id: string) => void;
}

const Ctx = createContext<RosterValue | null>(null);

export function RosterProvider({ children }: { children: ReactNode }) {
  const [roster, setRoster] = useState<RosterClient[]>(() => (USE_SUPABASE ? [] : JSON.parse(JSON.stringify(ROSTER))));

  // A real signed-in coach sees ONLY their linked clients (clean slate if none);
  // a guest/demo (no session) sees the sample roster so the portal isn't empty to explore.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (cancelled) return;
        if (!uid) { setRoster(JSON.parse(JSON.stringify(ROSTER))); return; }
        const { data: cls, error } = await supabase.from('clients').select('id, goal, diet, meals_per_day').eq('trainer_id', uid);
        if (error || !cls || !cls.length || cancelled) return;
        const ids = cls.map((c: any) => c.id);
        const names: Record<string, string> = {};
        try {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
          (profs || []).forEach((p: any) => { names[p.id] = p.full_name || 'Client'; });
        } catch { /* names optional */ }
        // Real per-client stats (best-effort; RLS lets a trainer read linked clients' rows).
        const ago = (t: number) => { const sec = Math.max(0, Math.round((Date.now() - t) / 1000)); if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + 'm ago'; if (sec < 86400) return Math.round(sec / 3600) + 'h ago'; return Math.round(sec / 86400) + 'd ago'; };
        const st: Record<string, { wDelta: number; adh: number | null; last: number; mx?: any }> = {};
        ids.forEach((id: string) => { st[id] = { wDelta: 0, adh: null, last: 0 }; });
        try {
          const { data: sc } = await supabase.from('scans').select('client_id, weight_kg, taken_at, metrics').in('client_id', ids).order('taken_at', { ascending: true });
          const byC: Record<string, { w: number; t: number; m: any }[]> = {};
          (sc || []).forEach((r: any) => { (byC[r.client_id] = byC[r.client_id] || []).push({ w: Number(r.weight_kg), t: Date.parse(r.taken_at), m: r.metrics }); });
          for (const id of ids) { const arr = byC[id]; if (arr && arr.length) { st[id].wDelta = Math.round((arr[arr.length - 1].w - arr[0].w) * 10) / 10; st[id].last = Math.max(st[id].last, arr[arr.length - 1].t); for (let k = arr.length - 1; k >= 0; k--) { if (arr[k].m) { st[id].mx = arr[k].m; break; } } } }
        } catch { /* ignore */ }
        try {
          const { data: wo } = await supabase.from('workouts').select('user_id, performed_at').in('user_id', ids).order('performed_at', { ascending: false });
          (wo || []).forEach((r: any) => { if (st[r.user_id]) st[r.user_id].last = Math.max(st[r.user_id].last, Date.parse(r.performed_at)); });
        } catch { /* ignore */ }
        try {
          const { data: ci } = await supabase.from('check_ins').select('user_id, at, adherence').in('user_id', ids).order('at', { ascending: false });
          const seen = new Set<string>();
          (ci || []).forEach((r: any) => { if (st[r.user_id]) { st[r.user_id].last = Math.max(st[r.user_id].last, Date.parse(r.at)); if (!seen.has(r.user_id) && typeof r.adherence === 'number') { seen.add(r.user_id); st[r.user_id].adh = r.adherence; } } });
        } catch { /* ignore */ }
        const goalMap: Record<string, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };
        const real: RosterClient[] = cls.map((c: any) => { const sc = st[c.id]; return { id: c.id, name: names[c.id] || 'Client', goal: goalMap[c.goal] || 'General', weightDelta: sc.wDelta, adherence: sc.adh != null ? sc.adh : 100, lastActive: sc.last ? ago(sc.last) : 'recently', next: '—', unread: 0, mode: 'online' as const, metrics: sc.mx ?? undefined, diet: c.diet ?? undefined, mealsPerDay: c.meals_per_day ?? undefined }; });
        if (!cancelled) setRoster(real);
      } catch { /* stay on demo roster */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const addClient = (name: string, goal: string, mode: 'online' | 'inperson' = 'online') => {
    const n = name.trim();
    if (!n) return;
    setRoster((p) => [...p, { id: `c${SEQ++}`, name: n, goal, weightDelta: 0, adherence: 100, lastActive: 'just added', next: '—', unread: 0, mode }]);
  };
  const removeClient = (id: string) => setRoster((p) => p.filter((c) => c.id !== id));
  return <Ctx.Provider value={{ roster, addClient, removeClient }}>{children}</Ctx.Provider>;
}

export function useRoster(): RosterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoster must be used inside <RosterProvider>');
  return v;
}
