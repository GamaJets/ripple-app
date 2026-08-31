// Private coach notes — a trainer's own notes about a client, which the client
// never sees. Distinct from client-visible feedback (src/ui/feedback.tsx),
// which is written TO the client.
//
// ── What this used to be, and what it cost ─────────────────────────────────
//
// Eighteen lines of `useState` keyed by client id. The sheet in
// app/(trainer)/dashboard.tsx is headed "Private Notes (only You)" and offered
// a Save button, and Save wrote to React state. Nothing was ever sent anywhere.
// A coach typed "shoulder still bothering her, drop overhead press for a
// fortnight", tapped Save, watched the note appear under the client's name, and
// it was gone the next time the app was launched — no error, no warning, and a
// button that had behaved in every visible respect as though it had worked.
//
// That is the worst shape a persistence bug can take. A Save that fails loudly
// is an inconvenience; a Save that succeeds visibly and stores nothing teaches
// the coach to trust it, and they find out at the moment they go looking for
// something they wrote down precisely because they did not want to rely on
// remembering it.
//
// It is now supabase/parts/108-coach-notes.sql: table `coach_notes`, one policy
// (`coach_id = auth.uid()`, for all commands) and a grant to `authenticated`
// only, with `anon` explicitly revoked. So the sheet's title is now true in both
// halves — the note survives a relaunch, and only its author can read it.
//
// ── Why nothing here is optimistic ────────────────────────────────────────
//
// `addNote` awaits the insert and shows the note only once the server has taken
// it, returning the row's REAL id. The tempting alternative — put it on screen
// immediately under a locally minted id and reconcile later — reproduces the
// original bug in a smaller window: the coach sees a saved note that is not
// saved, and if the write then fails there is a row on screen with an id that
// names nothing, which `removeNote` cannot delete and the next launch will not
// show. A note appearing a fifth of a second later is not a cost worth that.
//
// On failure the caller is told `false` and keeps what the coach typed, so the
// text is still in the box to try again with. See the Save handler in
// app/(trainer)/dashboard.tsx.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface Note { id: string; at: string; body: string }

/** Ids for the local-only mode (USE_SUPABASE off), where there is no server to
 *  mint one. Never reaches the database. */
let SEQ = 1;

interface NotesValue {
  getNotes: (clientId: string) => Note[];
  /**
   * Whether these notes came back from the server.
   *
   * Under 'error' an empty list means "could not read", NOT "this coach has
   * written nothing about this client" — and the second reading is the one that
   * gets a coach to write the same note twice, or to conclude they never made
   * the observation they are half-remembering.
   */
  status: LoadStatus;
  /** True only once the note is stored. False means nothing was saved and the
   *  caller should keep the text and say so. */
  addNote: (clientId: string, body: string) => Promise<boolean>;
  /** True only once the row is gone from the server. */
  removeNote: (clientId: string, id: string) => Promise<boolean>;
}

const Ctx = createContext<NotesValue | null>(null);

export function CoachNotesProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [map, setMap] = useState<Record<string, Note[]>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // Signed out is an answer, not a failure. getUser() REJECTS with no
        // session, and a provider that mounts on the welcome screen and treats
        // that as an error latches into 'error' before anybody has signed in —
        // see src/ui/authRevision.tsx for the seventeen providers this
        // happened to.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setUid(null); setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { reportError('coachNotes.auth', authErr); setStatus('error'); return; }
        const id = auth?.user?.id ?? null;
        if (!id) { setUid(null); setStatus('ready'); return; }
        setUid(id);

        // Every note this coach has written, in one read, and grouped by client
        // here. The policy already restricts the rows to their own, so the
        // `coach_id` filter is belt-and-braces rather than the guard — but it
        // also keeps the index on (coach_id, created_at desc) in play.
        const { data, error } = await supabase
          .from('coach_notes')
          .select('id, client_id, body, created_at')
          .eq('coach_id', id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        if (error) { reportError('coachNotes.load', error); setStatus('error'); return; }

        const page = capped(data as any[] | null);
        const m: Record<string, Note[]> = {};
        for (const r of page.rows as any[]) {
          (m[String(r.client_id)] = m[String(r.client_id)] || [])
            .push({ id: String(r.id), at: r.created_at, body: r.body });
        }
        setMap(m);
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch (e) {
        if (cancelled) return;
        reportError('coachNotes.load', e);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const getNotes = (clientId: string) => map[clientId] ?? [];

  const addNote = async (clientId: string, body: string): Promise<boolean> => {
    const b = body.trim();
    if (!b) return false;

    // No backend configured: the device IS the record, so an in-memory note is
    // the honest whole of it rather than a stand-in for something missing.
    if (!USE_SUPABASE) {
      const local: Note = { id: 'local-' + SEQ++, at: new Date().toISOString(), body: b };
      setMap((m) => ({ ...m, [clientId]: [local, ...(m[clientId] ?? [])] }));
      return true;
    }
    if (!uid) return false;

    try {
      const { data, error } = await supabase
        .from('coach_notes')
        .insert({ coach_id: uid, client_id: clientId, body: b })
        .select('id, created_at')
        .single();
      if (error) { reportError('coachNotes.add', error); return false; }
      const row = data as { id: string; created_at: string } | null;
      // An insert that returns no row is not a success. PostgREST would have to
      // have taken the write and refused to hand back what it stored, and a
      // note whose id we do not know is one `removeNote` can never delete.
      if (!row?.id) { reportError('coachNotes.add', new Error('insert returned no row')); return false; }
      setMap((m) => ({
        ...m,
        [clientId]: [{ id: String(row.id), at: row.created_at, body: b }, ...(m[clientId] ?? [])],
      }));
      return true;
    } catch (e) {
      reportError('coachNotes.add', e);
      return false;
    }
  };

  const removeNote = async (clientId: string, id: string): Promise<boolean> => {
    if (!USE_SUPABASE) {
      setMap((m) => ({ ...m, [clientId]: (m[clientId] ?? []).filter((n) => n.id !== id) }));
      return true;
    }
    if (!uid) return false;

    try {
      // ── the recurring bug class in this repo ──────────────────────────────
      //
      // PostgREST does not error on a DELETE that matches nothing. Without the
      // `.select()` this returns `error: null` for a row that was never there,
      // a row belonging to another coach, and a row the policy refused — and
      // the screen removes it from the list either way. The coach believes a
      // private note about a client has been deleted; it is still on the
      // server and comes back at the next launch.
      //
      // So the COUNT is the answer, not the absence of an error.
      const { data, error } = await supabase
        .from('coach_notes')
        .delete()
        .eq('id', id)
        .eq('coach_id', uid)
        .select('id');
      if (error) { reportError('coachNotes.remove', error); return false; }
      if (!Array.isArray(data) || data.length === 0) {
        reportError('coachNotes.remove', new Error('delete matched no rows'));
        return false;
      }
      setMap((m) => ({ ...m, [clientId]: (m[clientId] ?? []).filter((n) => n.id !== id) }));
      return true;
    } catch (e) {
      reportError('coachNotes.remove', e);
      return false;
    }
  };

  return (
    <Ctx.Provider value={{ getNotes, status, addNote, removeNote }}>{children}</Ctx.Provider>
  );
}

export function useCoachNotes(): NotesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachNotes must be used inside <CoachNotesProvider>');
  return v;
}
