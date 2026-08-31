// Coach-assigned training programs — clientId → Program. Persists to Supabase
// `assigned_programs` (coach writes; client reads own) with an in-memory
// fallback. When set, the client's Train tab uses it over the auto program.
//
// The write side already refuses to lie (see assignProgram). The READ side had
// the mirror-image bug: when the select failed, `programs` stayed `{}` and
// getProgram returned null — the same null it returns when a coach genuinely has
// not assigned anything. The client's Train tab then quietly built the generic
// auto program and presented it as their plan, so a client on a bespoke program
// trained the wrong session and had no way to tell. `status` separates "your
// coach has not assigned you a program" from "we could not find out".
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Program } from '../lib/programs';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { writeFailure } from '../lib/wroteRows';
import { reportError } from '../lib/reportError';

interface AssignedProgramsValue {
  programs: Record<string, Program>;
  getProgram: (clientId: string) => Program | null;
  /** Whether `programs` is what the server holds. Under 'error' a null from
   *  getProgram means "unknown", not "none assigned". */
  status: LoadStatus;
  /** Resolves true only when the assignment reached the server. Three screens
   *  told the coach "they'll see it on their Train tab" off a fire-and-forget
   *  upsert whose rejection handler was empty, and which was skipped entirely
   *  when uid was still null. */
  assignProgram: (clientId: string, program: Program) => Promise<boolean>;
  /** Resolves true only when the removal reached the server. A clear that was
   *  refused leaves the client still training the old program while the coach's
   *  screen shows it gone. */
  clearProgram: (clientId: string) => Promise<boolean>;
}

const Ctx = createContext<AssignedProgramsValue | null>(null);

export function AssignedProgramsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [programs, setPrograms] = useState<Record<string, Program>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

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
        const id = auth?.user?.id;
        // Signed out — nobody has been assigned anything, which is true rather
        // than unknown.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // `error` was previously discarded entirely: `const { data } = await …`.
        // A refused read handed back data === null, which read as "no
        // assignments" at every call site.
        // One row per client for a coach, so it scales with the roster and needs
        // the roster's ceiling. Ordered on client_id because there is no other
        // stable key here and an unordered cap lets the server return a
        // different thousand each launch — a coach would see a client's
        // programme appear on Monday and be gone on Tuesday.
        const { data, error } = await supabase.from('assigned_programs').select('*')
          .or('client_id.eq.' + id + ',coach_id.eq.' + id)
          .order('client_id', { ascending: true }).limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        const m: Record<string, Program> = {};
        for (const r of page.rows as any[]) { if (r.program) m[r.client_id] = r.program as Program; }
        if (Object.keys(m).length) setPrograms((prev) => ({ ...prev, ...m }));
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { setStatus('error'); /* stay in-memory, but say the read failed */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const getProgram = (clientId: string) => programs[clientId] ?? null;
  const assignProgram = async (clientId: string, program: Program): Promise<boolean> => {
    setPrograms((p) => ({ ...p, [clientId]: program }));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('assigned_programs').upsert({ client_id: clientId, coach_id: uid, program }, { onConflict: 'client_id' });
      return !error;
    } catch { return false; }
  };
  /**
   * Take a client off their coach-assigned programme.
   *
   * ── Why the row count, and not `error` ─────────────────────────────────
   *
   * `assigned_programs_coach_rw` is
   * `coach_id = auth.uid() AND is_my_client(client_id)`. A DELETE that fails
   * either half matches zero rows, and PostgREST answers 204 with `error`
   * null — so `!error` was true for a delete that removed nothing, and
   * builder.tsx's `revert` announced "Reverted to auto" over a client who is
   * still training the programme their coach believes they took away.
   *
   * This is not a second-gym problem. There is ONE row per client
   * (`onConflict: 'client_id'`), so it carries whichever coach last wrote it.
   * When a client moves from coach A to coach B, coach B is their coach and
   * the row is still coach A's — proved live against phgfwzpkkwdysftlgkoq by
   * seeding exactly that: coach B could not even SELECT the programme their
   * own client is following, and the DELETE affected 0 rows and raised
   * nothing. Coach A's identical delete affected 1, so the count only ever
   * rejects a write that genuinely did not happen.
   *
   * The local map is still cleared first, and that stays: the screen has to
   * respond to the tap. `false` is what stops the screen ANNOUNCING it, and
   * builder.tsx already handles it correctly.
   */
  const clearProgram = async (clientId: string): Promise<boolean> => {
    setPrograms((p) => { const n = { ...p }; delete n[clientId]; return n; });
    if (!USE_SUPABASE || !uid) return false;
    try {
      const r = await supabase.from('assigned_programs').delete({ count: 'exact' }).eq('client_id', clientId);
      const why = writeFailure('That programme', r);
      if (why) { reportError('assignedPrograms.clearProgram', new Error(why), { clientId }); return false; }
      return true;
    } catch { return false; }
  };

  return (
    <Ctx.Provider value={{ programs, getProgram, status, assignProgram, clearProgram }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssignedPrograms(): AssignedProgramsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssignedPrograms must be used inside <AssignedProgramsProvider>');
  return v;
}
