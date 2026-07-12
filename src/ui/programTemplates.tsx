// Program template library — a coach builds a weekly program once, saves it as a
// template, then assigns it to many clients (bulk assign). Persists to Supabase
// `program_templates` (coach_id, id, name, program jsonb) with an in-memory
// fallback + seed templates so the library is never empty. Pure JS → OTA.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildProgram, type Program } from '../lib/programs';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface ProgramTemplate { id: string; name: string; program: Program }

let SEQ = 1;
const mkId = () => 'tpl_' + Date.now().toString(36) + '_' + (SEQ++);

// Seed a small starter library from the built-in program generator so a new
// coach has something to assign on day one.
function seed(): ProgramTemplate[] {
  const mk = (name: string, p: Program): ProgramTemplate => ({ id: 'seed_' + name.toLowerCase().replace(/[^a-z]+/g, '-'), name, program: { ...p, title: name } });
  return [
    mk('Push · Pull · Legs', buildProgram('muscle', 28)),
    mk('Fat-loss Circuit', buildProgram('fatloss', 30)),
    mk('Tone & Sculpt', buildProgram('tone', 26)),
  ];
}

interface TemplatesValue {
  templates: ProgramTemplate[];
  saveTemplate: (name: string, program: Program) => void;
  removeTemplate: (id: string) => void;
}

const Ctx = createContext<TemplatesValue | null>(null);

export function ProgramTemplatesProvider({ children }: { children: ReactNode }) {
  const [templates, setTemplates] = useState<ProgramTemplate[]>(() => seed());
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data, error } = await supabase.from('program_templates').select('id, name, program').eq('coach_id', id).order('created_at', { ascending: true });
        if (error || cancelled || !data) return;
        const real: ProgramTemplate[] = data.filter((r: any) => r.program).map((r: any) => ({ id: r.id, name: r.name, program: r.program as Program }));
        // Show the coach's own saved templates first, then the seed starters.
        if (real.length) setTemplates((p) => [...real, ...p.filter((x) => x.id.startsWith('seed_'))]);
      } catch { /* stay on seed */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveTemplate = (name: string, program: Program) => {
    const nm = name.trim() || 'Untitled template';
    const id = mkId();
    const tpl: ProgramTemplate = { id, name: nm, program: { ...program, title: program.title || nm } };
    setTemplates((p) => [tpl, ...p]);
    if (USE_SUPABASE && uid) {
      try { supabase.from('program_templates').insert({ id, coach_id: uid, name: nm, program: tpl.program }).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const removeTemplate = (id: string) => {
    setTemplates((p) => p.filter((x) => x.id !== id));
    if (USE_SUPABASE && uid && !id.startsWith('seed_')) {
      try { supabase.from('program_templates').delete().eq('coach_id', uid).eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const value = useMemo(() => ({ templates, saveTemplate, removeTemplate }), [templates, uid]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgramTemplates(): TemplatesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProgramTemplates must be used inside <ProgramTemplatesProvider>');
  return v;
}
