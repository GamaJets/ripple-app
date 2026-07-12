// Coach feedback — advice a trainer leaves on a client, shown on the client's
// dashboard. Persists to Supabase `coach_feedback` (coach writes; client reads
// their own) with a defensive in-memory fallback + demo seed. Keyed by clientId,
// which is the client's real account id once signed in.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface FeedbackItem { id: string; at: string; body: string }

interface FeedbackValue {
  getFeedback: (clientId: string) => FeedbackItem[];
  addFeedback: (clientId: string, body: string) => void;
}

const Ctx = createContext<FeedbackValue | null>(null);
let SEQ = 1;

const seed: Record<string, FeedbackItem[]> = {
  c1: [{
    id: 'f0',
    at: new Date(Date.now() - 2 * 86400000).toISOString(),
    body: 'Strong week — your squat is moving up nicely. Keep the descent controlled and hit the top of the rep range before adding weight.',
  }],
};

export function CoachFeedbackProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, FeedbackItem[]>>(() => JSON.parse(JSON.stringify(seed)));
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        // Rows where I'm the client (I read my feedback) or the coach (I manage it).
        const { data, error } = await supabase.from('coach_feedback').select('*')
          .or('client_id.eq.' + id + ',coach_id.eq.' + id)
          .order('created_at', { ascending: false });
        if (error || cancelled || !data) return;
        const m: Record<string, FeedbackItem[]> = {};
        for (const r of data as any[]) { (m[r.client_id] = m[r.client_id] || []).push({ id: String(r.id), at: r.created_at, body: r.body }); }
        if (Object.keys(m).length) setMap((prev) => ({ ...prev, ...m }));
      } catch { /* stay on seed */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const getFeedback = (clientId: string) => map[clientId] ?? [];
  const addFeedback = (clientId: string, body: string) => {
    const b = body.trim();
    if (!b) return;
    const item: FeedbackItem = { id: 'f' + SEQ++, at: new Date().toISOString(), body: b };
    setMap((m) => ({ ...m, [clientId]: [item, ...(m[clientId] ?? [])] }));
    if (USE_SUPABASE && uid) {
      try { supabase.from('coach_feedback').insert({ coach_id: uid, client_id: clientId, body: b }).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  return <Ctx.Provider value={{ getFeedback, addFeedback }}>{children}</Ctx.Provider>;
}

export function useCoachFeedback(): FeedbackValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachFeedback must be used inside <CoachFeedbackProvider>');
  return v;
}
