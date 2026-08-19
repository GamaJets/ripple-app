// Client tagging for the coach — attach custom labels ("new", "comp prep",
// "high-touch", "paused"…) to any client and filter the roster by them. Persists
// to Supabase `client_tags` (coach_id, client_id, tag) with an in-memory
// fallback + demo seed, so it works signed-in or in demo mode.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

interface TagsValue {
  tagsFor: (clientId: string) => string[];
  allTags: string[];
  addTag: (clientId: string, tag: string) => void;
  removeTag: (clientId: string, tag: string) => void;
}

// No seed. This used to be
//   { c1: ['comp prep', 'high-touch'], c2: ['new'], c4: ['paused'] }
// merged unconditionally into `allTags`, so every real coach saw four segments
// they had never created — rendered as selectable chips on the broadcast screen,
// where each one matched zero recipients. The ids are the mock clients that were
// deleted from the roster long ago.
const SEED: Record<string, string[]> = {};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);

const Ctx = createContext<TagsValue | null>(null);

export function ClientTagsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, string[]>>(() => JSON.parse(JSON.stringify(SEED)));
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data, error } = await supabase.from('client_tags').select('client_id, tag').eq('coach_id', id);
        if (error || cancelled || !data) return;
        const next: Record<string, string[]> = {};
        data.forEach((r: any) => { (next[r.client_id] ||= []).push(r.tag); });
        // Merge real tags over the demo seed (real wins for overlapping clients).
        if (Object.keys(next).length) setMap((p) => ({ ...p, ...next }));
      } catch { /* stay on seed */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const addTag = (clientId: string, raw: string) => {
    const tag = norm(raw); if (!tag) return;
    setMap((p) => {
      const cur = p[clientId] || [];
      if (cur.includes(tag)) return p;
      return { ...p, [clientId]: [...cur, tag] };
    });
    if (USE_SUPABASE && uid) {
      try { supabase.from('client_tags').insert({ coach_id: uid, client_id: clientId, tag }).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const removeTag = (clientId: string, raw: string) => {
    const tag = norm(raw);
    setMap((p) => ({ ...p, [clientId]: (p[clientId] || []).filter((x) => x !== tag) }));
    if (USE_SUPABASE && uid) {
      try { supabase.from('client_tags').delete().eq('coach_id', uid).eq('client_id', clientId).eq('tag', tag).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const allTags = useMemo(() => {
    const s = new Set<string>();
    Object.values(map).forEach((arr) => arr.forEach((x) => s.add(x)));
    return Array.from(s).sort();
  }, [map]);

  const tagsFor = (clientId: string) => map[clientId] || [];

  return <Ctx.Provider value={{ tagsFor, allTags, addTag, removeTag }}>{children}</Ctx.Provider>;
}

export function useClientTags(): TagsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientTags must be used inside <ClientTagsProvider>');
  return v;
}
