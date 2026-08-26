// Program template library — a coach builds a weekly program once, saves it as a
// template, then assigns it to many clients (bulk assign). Persists to Supabase
// `program_templates` (coach_id, id, name, program jsonb) with an in-memory
// fallback + seed templates so the library is never empty. Pure JS → OTA.
//
// "Never empty" is the problem this file had. Because three seed starters are
// always present, a failed read of `program_templates` produced a library that
// looked perfectly healthy — three templates, none of them the coach's. A coach
// who had built and saved a dozen programs opened the library, saw only the
// starters, and had no reason to think anything had failed; the obvious
// conclusion is that their work is gone. `status` distinguishes "these three
// starters are all you have saved" from "we could not read what you saved".
//
// The writes had the mirror problem: both were fire-and-forget with empty
// rejection handlers, so a template rejected by the server sat in the list for
// the rest of the session and vanished on the next launch.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildProgram, type Program } from '../lib/programs';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

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
  /** Whether the coach's own saved templates could be read. Under 'error' the
   *  list holds the built-in starters only because the read failed — it is not
   *  a statement that the coach has saved nothing. */
  status: LoadStatus;
  /** Resolves true only once the template is on the server and will be there
   *  after a relaunch and on the coach's other devices. */
  saveTemplate: (name: string, program: Program) => Promise<boolean>;
  /** Resolves true only when the template was actually deleted. Deleting a
   *  built-in starter is local by design and resolves true. */
  removeTemplate: (id: string) => Promise<boolean>;
}

const Ctx = createContext<TemplatesValue | null>(null);

export function ProgramTemplatesProvider({ children }: { children: ReactNode }) {
  const [templates, setTemplates] = useState<ProgramTemplate[]>(() => seed());
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        // Signed out: the starters really are the whole library.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        const { data, error } = await supabase.from('program_templates').select('id, name, program').eq('coach_id', id).order('created_at', { ascending: true });
        if (cancelled) return;
        // `error || !data` used to return down the same path as a coach who has
        // simply not saved anything, leaving the seed starters standing in for
        // their library with nothing to mark the difference.
        if (error) { setStatus('error'); return; }
        const real: ProgramTemplate[] = (data ?? []).filter((r: any) => r.program).map((r: any) => ({ id: r.id, name: r.name, program: r.program as Program }));
        // Show the coach's own saved templates first, then the seed starters.
        if (real.length) setTemplates((p) => [...real, ...p.filter((x) => x.id.startsWith('seed_'))]);
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveTemplate = async (name: string, program: Program): Promise<boolean> => {
    const nm = name.trim() || 'Untitled template';
    const id = mkId();
    const tpl: ProgramTemplate = { id, name: nm, program: { ...program, title: program.title || nm } };
    setTemplates((p) => [tpl, ...p]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('program_templates').insert({ id, coach_id: uid, name: nm, program: tpl.program });
      return !error;
    } catch { return false; }
  };

  const removeTemplate = async (id: string): Promise<boolean> => {
    setTemplates((p) => p.filter((x) => x.id !== id));
    // A built-in starter exists only in this bundle; hiding it locally IS the
    // whole removal, so this is a real success rather than a swallowed failure.
    if (id.startsWith('seed_')) return true;
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('program_templates').delete().eq('coach_id', uid).eq('id', id);
      return !error;
    } catch { return false; }
  };

  const value = useMemo(() => ({ templates, status, saveTemplate, removeTemplate }), [templates, status, uid]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgramTemplates(): TemplatesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProgramTemplates must be used inside <ProgramTemplatesProvider>');
  return v;
}
