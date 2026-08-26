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
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

export interface FeedbackItem { id: string; at: string; body: string }

interface FeedbackValue {
  getFeedback: (clientId: string) => FeedbackItem[];
  /** Whether the notes were read from the server. Under 'error' an empty list
   *  means unknown, not "your coach hasn't written anything". */
  status: LoadStatus;
  /** Resolves true only once the note is on the server, where the client will
   *  actually read it. False means the coach wrote it to their own screen. */
  addFeedback: (clientId: string, body: string) => Promise<boolean>;
}

const Ctx = createContext<FeedbackValue | null>(null);
let SEQ = 1;

export function CoachFeedbackProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, FeedbackItem[]>>({});
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
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // Rows where I'm the client (I read my feedback) or the coach (I manage it).
        const { data, error } = await supabase.from('coach_feedback').select('*')
          .or('client_id.eq.' + id + ',coach_id.eq.' + id)
          .order('created_at', { ascending: false });
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const m: Record<string, FeedbackItem[]> = {};
        for (const r of ((data ?? []) as any[])) { (m[r.client_id] = m[r.client_id] || []).push({ id: String(r.id), at: r.created_at, body: r.body }); }
        if (Object.keys(m).length) setMap((prev) => ({ ...prev, ...m }));
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const getFeedback = (clientId: string) => map[clientId] ?? [];
  const addFeedback = async (clientId: string, body: string): Promise<boolean> => {
    const b = body.trim();
    if (!b) return false;
    const item: FeedbackItem = { id: 'f' + SEQ++, at: new Date().toISOString(), body: b };
    setMap((m) => ({ ...m, [clientId]: [item, ...(m[clientId] ?? [])] }));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('coach_feedback').insert({ coach_id: uid, client_id: clientId, body: b });
      return !error;
    } catch { return false; }
  };

  return <Ctx.Provider value={{ getFeedback, status, addFeedback }}>{children}</Ctx.Provider>;
}

export function useCoachFeedback(): FeedbackValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachFeedback must be used inside <CoachFeedbackProvider>');
  return v;
}
