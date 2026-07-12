// Coach-assigned training programs — clientId → Program. Persists to Supabase
// `assigned_programs` (coach writes; client reads own) with an in-memory
// fallback. When set, the client's Train tab uses it over the auto program.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Program } from '../lib/programs';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

interface AssignedProgramsValue {
  programs: Record<string, Program>;
  getProgram: (clientId: string) => Program | null;
  assignProgram: (clientId: string, program: Program) => void;
  clearProgram: (clientId: string) => void;
}

const Ctx = createContext<AssignedProgramsValue | null>(null);

export function AssignedProgramsProvider({ children }: { children: ReactNode }) {
  const [programs, setPrograms] = useState<Record<string, Program>>({});
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data } = await supabase.from('assigned_programs').select('*').or('client_id.eq.' + id + ',coach_id.eq.' + id);
        if (cancelled || !data) return;
        const m: Record<string, Program> = {};
        for (const r of data as any[]) { if (r.program) m[r.client_id] = r.program as Program; }
        if (Object.keys(m).length) setPrograms((prev) => ({ ...prev, ...m }));
      } catch { /* stay in-memory */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const getProgram = (clientId: string) => programs[clientId] ?? null;
  const assignProgram = (clientId: string, program: Program) => {
    setPrograms((p) => ({ ...p, [clientId]: program }));
    if (USE_SUPABASE && uid) { try { supabase.from('assigned_programs').upsert({ client_id: clientId, coach_id: uid, program }, { onConflict: 'client_id' }).then(() => {}, () => {}); } catch { /* ignore */ } }
  };
  const clearProgram = (clientId: string) => {
    setPrograms((p) => { const n = { ...p }; delete n[clientId]; return n; });
    if (USE_SUPABASE && uid) { try { supabase.from('assigned_programs').delete().eq('client_id', clientId).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  return (
    <Ctx.Provider value={{ programs, getProgram, assignProgram, clearProgram }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssignedPrograms(): AssignedProgramsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssignedPrograms must be used inside <AssignedProgramsProvider>');
  return v;
}
