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
  /** The same write, with the sentence saying why it did not land.
   *
   *  A bulk assign is twelve of these at once and has to report on each one by
   *  name — "8 of 12 saved" tells a coach something is wrong and nothing about
   *  which four or what to do. See src/lib/bulkActions.ts. */
  assignProgramTo: (clientId: string, program: Program) => Promise<{ ok: boolean; why: string | null }>;
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
  /**
   * Put a programme on one client, and say what happened.
   *
   * ── Why the row count, and not `error` ─────────────────────────────────
   *
   * The same reasoning `clearProgram` below already carries, arriving here
   * because a BULK assign made it matter twelve times per tap. `!error` was
   * this function's whole test of success, and a PostgREST write that matches
   * no rows is not an error: it comes back 204 with `error` null, and the
   * screen above announced "they'll see it on their Train tab".
   *
   * The refusal is real and it is not exotic. `assigned_programs_coach_rw` is
   * `coach_id = auth.uid() AND is_my_client(client_id)`, and `is_my_client`
   * looks in `clients` — so a client the coach added BY HAND has no row for it
   * to find, and every one of them fails this check. A coach whose book is
   * half hand-added and half linked taps Assign on twelve people and gets
   * twelve writes of which six do nothing.
   *
   * `writeFailure` is what turns the three outcomes — refused, matched
   * nothing, nobody counted — into one sentence for the coach, and it treats a
   * MISSING count as a failure rather than a pass, which is what stops a
   * future edit dropping `{ count: 'exact' }` and silently re-admitting all of
   * this.
   *
   * The local map is still written FIRST, because the screen has to respond to
   * the tap — and it is put back if the write does not land. See below.
   */
  const assignProgramTo = async (clientId: string, program: Program): Promise<{ ok: boolean; why: string | null }> => {
    // ── and why a failed write is PUT BACK ───────────────────────────────
    //
    // The optimistic entry is written first so the screen responds to the tap,
    // and it used to be left there whatever happened. That was already a small
    // lie — a coach's own device showed a client on a programme the server had
    // refused — and a bulk assign turns it into a load-bearing one, because
    // `getProgram` is what the overwrite confirmation counts. Leave a failed
    // write in the map and the retry's confirmation says "9 of these 12 are on
    // a programme now" about people whose programme never landed, which is the
    // screen reading its own guess back to the coach as a fact.
    const previous = programs[clientId] ?? null;
    const putBack = () => setPrograms((p) => {
      const n = { ...p };
      if (previous) n[clientId] = previous; else delete n[clientId];
      return n;
    });
    setPrograms((p) => ({ ...p, [clientId]: program }));
    if (!USE_SUPABASE || !uid) {
      putBack();
      return { ok: false, why: 'This programme was not saved — the app could not confirm who you are signed in as, so nothing was sent to the server.' };
    }
    try {
      const r = await supabase.from('assigned_programs')
        .upsert({ client_id: clientId, coach_id: uid, program }, { onConflict: 'client_id', count: 'exact' });
      const why = writeFailure('That programme', r);
      if (why) {
        reportError('assignedPrograms.assignProgram', new Error(why), { clientId });
        putBack();
        // The generic sentence names the outcome; this names the cause the
        // coach can actually do something about. `is_my_client` looks in
        // `clients`, so a client the coach typed into Add Client fails it every
        // time — proved live against phgfwzpkkwdysftlgkoq, where the same
        // fan-out wrote 1 row for the linked client and was refused 42501 for
        // the hand-added one beside it.
        return { ok: false, why: `${why} Clients you added by hand have no Train tab until they join.` };
      }
      return { ok: true, why: null };
    } catch (e) {
      reportError('assignedPrograms.assignProgram', e, { clientId });
      putBack();
      return { ok: false, why: 'That programme did not reach the server, so nothing has changed for them.' };
    }
  };
  const assignProgram = async (clientId: string, program: Program): Promise<boolean> =>
    (await assignProgramTo(clientId, program)).ok;
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
    <Ctx.Provider value={{ programs, getProgram, status, assignProgram, assignProgramTo, clearProgram }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssignedPrograms(): AssignedProgramsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssignedPrograms must be used inside <AssignedProgramsProvider>');
  return v;
}
