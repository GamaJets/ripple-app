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
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { writeFailure } from '../lib/wroteRows';
import { reportError } from '../lib/reportError';

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
  /** The same write, with the sentence saying why it did not land.
   *
   *  A coach's template library is the thing they build their business out of,
   *  and "Saved on this device only" is not a diagnosis — it is what the
   *  builder had to say for every failure alike, including the ones the coach
   *  could act on. See src/lib/wroteRows.ts. */
  saveTemplateTo: (name: string, program: Program) => Promise<{ ok: boolean; why: string | null }>;
  /** Resolves true only when the template was actually deleted. */
  removeTemplate: (id: string) => Promise<boolean>;
  /** The same delete, with the sentence saying why it did not happen.
   *
   *  The row does NOT leave the list until the server has said it is gone. See
   *  the function itself for why an optimistic delete here is worse than a slow
   *  one. */
  removeTemplateFrom: (id: string) => Promise<{ ok: boolean; why: string | null }>;
  /** Whether this template is one of the three built into the bundle. A
   *  starter cannot be deleted — see `removeTemplateFrom` — and a screen needs
   *  to know that before it draws a control that would fail. */
  isStarter: (id: string) => boolean;
}

const Ctx = createContext<TemplatesValue | null>(null);

export function ProgramTemplatesProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [templates, setTemplates] = useState<ProgramTemplate[]>(() => seed());
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
        // Signed out: the starters really are the whole library.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // Newest-first rather than the oldest-first this was, because the cap
        // decides which end is kept and a coach's most recent templates are the
        // ones they are working from. The list is rebuilt in that order below,
        // which is also the order the picker should show them in.
        const { data, error } = await supabase.from('program_templates')
          .select('id, name, program').eq('coach_id', id)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        // `error || !data` used to return down the same path as a coach who has
        // simply not saved anything, leaving the seed starters standing in for
        // their library with nothing to mark the difference.
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        const real: ProgramTemplate[] = page.rows.filter((r: any) => r.program).map((r: any) => ({ id: r.id, name: r.name, program: r.program as Program }));
        // Show the coach's own saved templates first, then the seed starters.
        if (real.length) setTemplates((p) => [...real, ...p.filter((x) => x.id.startsWith('seed_'))]);
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  /**
   * Who is signed in, asked at the moment of the write.
   *
   * `uid` is state, set by the effect above once its own reads have come back.
   * Every write here refused outright while it was still null — so a coach who
   * opened the builder, laid out a week and hit Save before that effect
   * finished was told their template was "saved on this device only" and lost
   * it at the next launch, with nothing wrong on the server and nothing to
   * retry. The state is still preferred, because it is already there; this only
   * covers the window before it arrives.
   */
  const writerId = async (): Promise<string | null> => {
    if (uid) return uid;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      const id = data?.user?.id ?? null;
      if (id) setUid(id);
      return id;
    } catch { return null; }
  };

  /**
   * Put a template in the coach's library, and say what happened.
   *
   * ── Why the row is counted, and not merely un-errored ──────────────────
   *
   * This returned `!error`, and the house rule it broke is the one in
   * src/lib/wroteRows.ts: a PostgREST write that matches no row is not an
   * error. The insert is guarded by `program_templates_self`
   * (`coach_id = auth.uid()`), which was proved live against
   * phgfwzpkkwdysftlgkoq — a second coach's identical insert is refused 42501
   * and their DELETE of the first coach's template affects zero rows and
   * raises nothing at all. So the delete below was the live hole: it reported
   * success for a template that is still there.
   *
   * `.select('id')` makes the insert hand back the row it wrote, which is the
   * only evidence that survives to the next launch — and it is that relaunch
   * the coach is being promised. A library that exists until the app restarts
   * is the bug the user reported as needing templates "saved in the app".
   */
  const saveTemplateTo = async (name: string, program: Program): Promise<{ ok: boolean; why: string | null }> => {
    const nm = name.trim() || 'Untitled template';
    const id = mkId();
    const tpl: ProgramTemplate = { id, name: nm, program: { ...program, title: program.title || nm } };
    // Written locally first so the library responds to the tap, and taken back
    // out when the write does not land — a template sitting in the list that
    // the server refused is the coach's only evidence that their work was
    // kept, and it is evidence this app invented.
    setTemplates((p) => [tpl, ...p]);
    const drop = () => setTemplates((p) => p.filter((x) => x.id !== id));
    if (!USE_SUPABASE) return { ok: true, why: null };
    const me = await writerId();
    if (!me) {
      drop();
      return { ok: false, why: 'The app could not confirm who you are signed in as, so nothing was sent to the server.' };
    }
    try {
      const { data, error } = await supabase.from('program_templates')
        .insert({ id, coach_id: me, name: nm, program: tpl.program }).select('id');
      if (error) { reportError('programTemplates.save', error, { id }); drop(); return { ok: false, why: 'The server refused it.' }; }
      if (!data || !data.length) {
        reportError('programTemplates.save', new Error('template insert returned no row'), { id });
        drop();
        return { ok: false, why: 'The server accepted the request and stored no row, so there is nothing to come back to.' };
      }
      return { ok: true, why: null };
    } catch (e) { reportError('programTemplates.save', e, { id }); drop(); return { ok: false, why: 'It did not reach the server.' }; }
  };
  const saveTemplate = async (name: string, program: Program): Promise<boolean> =>
    (await saveTemplateTo(name, program)).ok;

  const isStarter = (id: string) => id.startsWith('seed_');

  /**
   * Delete one of the coach's own templates.
   *
   * ── Why the row does not leave the list first ─────────────────────────────
   *
   * Everything else in this file writes optimistically and puts the change back
   * on failure, because the screen has to answer the tap. A delete is the one
   * case where that is the wrong trade: the row disappearing IS the coach's
   * evidence that it worked, so an optimistic delete followed by a quiet
   * restore reads as a successful delete with a glitch — and a refused one
   * reads as a successful delete full stop, until the template reappears at the
   * next launch. So nothing is removed here until the server has counted the
   * row, and a failed delete leaves the template exactly where it was.
   *
   * ── Why the count, and not `error` ────────────────────────────────────────
   *
   * A PostgREST DELETE that matches no rows is not an error: it returns 204
   * with `error` null, and so does a delete that RLS filtered out. The two are
   * indistinguishable over the wire, which is what src/lib/wroteRows.ts exists
   * for. Proved live against phgfwzpkkwdysftlgkoq inside a rolled-back
   * transaction: a second coach's DELETE of this coach's template affected 0
   * rows and raised nothing at all, their SELECT of it returned 0 rows, and
   * their INSERT under this coach's id was refused 42501. The owning coach's
   * identical DELETE affected 1. So the count only ever rejects a delete that
   * genuinely did not happen.
   *
   * ── And what a delete does NOT touch ──────────────────────────────────────
   *
   * No foreign key anywhere in this database points at `program_templates` —
   * read off `pg_constraint` live, the result was empty. A programme assigned
   * from a template is a jsonb COPY in `assigned_programs`, with no reference
   * back, so deleting the stencil cannot reach a client who is training from
   * it, and `workouts` — keyed by user and date — cannot be reached from either.
   */
  const removeTemplateFrom = async (id: string): Promise<{ ok: boolean; why: string | null }> => {
    // ── Why a starter cannot be deleted ─────────────────────────────────────
    //
    // The three starters are compiled into the bundle by `seed()` above, so
    // "deleting" one only hides it until the next launch, when it is back. This
    // used to remove it from the list and return true — a success the app could
    // not keep, and one that undid itself overnight with no explanation. Worse,
    // it is the only way to reach an EMPTY library from a full one, and a coach
    // who cleared the picker had no route back to the starters at all.
    if (isStarter(id)) {
      return {
        ok: false,
        why: 'This is one of the three starters built into the app rather than a template you saved, so there is nothing on the server to delete. It would be back next time you opened the app.',
      };
    }
    if (!USE_SUPABASE) {
      setTemplates((p) => p.filter((x) => x.id !== id));
      return { ok: true, why: null };
    }
    const me = await writerId();
    if (!me) return { ok: false, why: 'The app could not confirm who you are signed in as, so nothing was sent to the server.' };
    try {
      const r = await supabase.from('program_templates').delete({ count: 'exact' })
        .eq('coach_id', me).eq('id', id);
      const why = writeFailure('That template', r);
      if (why) { reportError('programTemplates.remove', new Error(why), { id }); return { ok: false, why }; }
      // Only now. The server has counted the row.
      setTemplates((p) => p.filter((x) => x.id !== id));
      return { ok: true, why: null };
    } catch (e) {
      reportError('programTemplates.remove', e, { id });
      return { ok: false, why: 'That delete did not reach the server, so the template is still in your library.' };
    }
  };
  const removeTemplate = async (id: string): Promise<boolean> => (await removeTemplateFrom(id)).ok;

  const value = useMemo(() => ({ templates, status, saveTemplate, saveTemplateTo, removeTemplate, removeTemplateFrom, isStarter }), [templates, status, uid]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgramTemplates(): TemplatesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProgramTemplates must be used inside <ProgramTemplatesProvider>');
  return v;
}
