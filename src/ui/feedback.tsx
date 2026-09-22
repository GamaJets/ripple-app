// Coach feedback — advice a trainer leaves on a client, shown on the client's
// dashboard. Persists to Supabase `coach_feedback` (coach writes; client reads
// their own) with an in-memory fallback that starts empty. Keyed by clientId,
// which is the client's real account id once signed in.
//
// getFeedback() returning [] rendered on the client's dashboard as "no advice
// from your coach yet". A failed read produced exactly the same [], so a client
// whose coach had written them three notes was told their coach had said
// nothing — and on the other side the coach saw their own notes vanish from the
// client detail and wrote them again.
import { createContext, useCallback, useMemo, useRef, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';

export interface FeedbackItem { id: string; at: string; body: string }

interface FeedbackValue {
  getFeedback: (clientId: string) => FeedbackItem[];
  /** Whether the notes were read from the server. Under 'error' an empty list
   *  means unknown, not "your coach hasn't written anything". */
  status: LoadStatus;
  /** Resolves true only once the note is on the server, where the client will
   *  actually read it. False means the coach wrote it to their own screen. */
  addFeedback: (clientId: string, body: string) => Promise<boolean>;
  /** Read the feedback again. Under 'error' an empty list means unknown, and
   *  a coach who reads it as "I have written nothing" writes it twice. */
  reload: () => void;
}

const Ctx = createContext<FeedbackValue | null>(null);
let SEQ = 1;

export function CoachFeedbackProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [map, setMap] = useState<Record<string, FeedbackItem[]>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // Bumped by `reload`, beside `authRev` in the read below.
  const [nonce, setNonce] = useState(0);

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
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // Rows where I'm the client (I read my feedback) or the coach (I manage it).
        const { data, error } = await supabase.from('coach_feedback').select('*')
          .or('client_id.eq.' + id + ',coach_id.eq.' + id)
          // Every note a coach has ever written to anyone, in one read. Newest
          // first was already the order and is the right end to keep — but it
          // was unbounded, and at the ceiling a client opening their feedback
          // would have found their coach's older notes simply absent.
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        const m: Record<string, FeedbackItem[]> = {};
        for (const r of (page.rows as any[])) { (m[r.client_id] = m[r.client_id] || []).push({ id: String(r.id), at: r.created_at, body: r.body }); }
        if (Object.keys(m).length) setMap((prev) => ({ ...prev, ...m }));
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev, nonce]);

  /** The read MERGES into the map rather than replacing it, so an entry
   *  written optimistically while a refresh was in flight is not dropped by
   *  the answer to a query that was sent before it. */
  const reload = useCallback(() => {
    if (USE_SUPABASE) setStatus('loading');
    setNonce((n) => n + 1);
  }, []);

  const getFeedback = (clientId: string) => map[clientId] ?? [];
  /**
   * Written to the server FIRST, and put on screen only once it is there.
   *
   * This used to do the opposite: `setMap` with a locally minted id, and then
   * `return false` on all three of the paths that mean the client will never
   * see it — no backend, no signed-in coach, refused insert. The coach was left
   * looking at their own note in their own list, sitting under the client's
   * name, with nothing anywhere saying it had gone nowhere. Even once the
   * caller reads this boolean, an optimistic row would still be the wrong shape
   * here: it would leave a note on screen bearing an id that names no row, so
   * the list itself would go on asserting a delivery that did not happen until
   * the next launch quietly dropped it. src/ui/coachNotes.tsx made the same
   * change for the same reason and this now matches it.
   */
  const addFeedback = async (clientId: string, body: string): Promise<boolean> => {
    const b = body.trim();
    if (!b) return false;
    // No backend configured: this device IS the record, so an in-memory note is
    // the whole honest answer rather than a stand-in for a write that failed.
    if (!USE_SUPABASE) {
      const local: FeedbackItem = { id: 'local-f' + SEQ++, at: new Date().toISOString(), body: b };
      setMap((m) => ({ ...m, [clientId]: [local, ...(m[clientId] ?? [])] }));
      return true;
    }
    if (!uid) return false;
    try {
      const { data, error } = await supabase.from('coach_feedback')
        .insert({ coach_id: uid, client_id: clientId, body: b })
        .select('id, created_at').single();
      if (error) return false;
      const row = data as { id: string; created_at: string } | null;
      // An insert that hands back no row is not a success — the note's real id
      // is what the client's copy is keyed on, and we do not have it.
      if (!row?.id) return false;
      setMap((m) => ({ ...m, [clientId]: [{ id: String(row.id), at: row.created_at, body: b }, ...(m[clientId] ?? [])] }));
      return true;
    } catch { return false; }
  };

  // ── Why the implementations below are handed out through a ref ────────────
  //
  // This provider used to publish an inline object literal, so `useCoachFeedback`
  // returned a different value on every render — and every function on it was a
  // different function again. The consumer that writes the obvious thing,
  // `useFocusEffect(useCallback(() => { x.getFeedback(); }, [x]))`, then builds a
  // machine that cannot stop: the effect re-runs when its callback's identity
  // changes, the call re-runs the fetch, the fetch ends in a setState, the
  // provider re-renders, and both identities are new again. src/ui/roster.tsx
  // documents that at length and is the pattern this follows.
  //
  // The wrappers are created once and read the current implementations out of a
  // ref, so they are stable for the life of the provider while still closing
  // over this render's state. Freezing the implementations themselves in a
  // `useCallback` would freeze that state with them, which is the same bug one
  // level down.
  const impl = useRef({ getFeedback, addFeedback });
  impl.current = { getFeedback, addFeedback };
  const getFeedbackStable = useCallback((...a: Parameters<typeof getFeedback>) => impl.current.getFeedback(...a), []);
  const addFeedbackStable = useCallback((...a: Parameters<typeof addFeedback>) => impl.current.addFeedback(...a), []);
  const value = useMemo<FeedbackValue>(() => ({ getFeedback: getFeedbackStable, status, addFeedback: addFeedbackStable, reload }), [getFeedbackStable, status, addFeedbackStable, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoachFeedback(): FeedbackValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachFeedback must be used inside <CoachFeedbackProvider>');
  return v;
}
