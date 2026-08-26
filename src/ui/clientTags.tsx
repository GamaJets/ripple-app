// Client tagging for the coach — attach custom labels ("new", "comp prep",
// "high-touch", "paused"…) to any client and filter the roster by them. Persists
// to Supabase `client_tags` (coach_id, client_id, tag) with an in-memory
// fallback + demo seed, so it works signed-in or in demo mode.
//
// Tags are used to AIM things. The broadcast screen sends a message to everyone
// carrying a tag; the roster filter narrows a coach's list by one. So a failed
// read here does not merely hide labels — it silently changes who a broadcast
// reaches. A coach picking "comp prep" over an unread tag map sends to nobody,
// or to a subset, and the screen reports it sent. `status` is what lets the
// broadcast screen refuse to target a segment it could not actually read.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

interface TagsValue {
  tagsFor: (clientId: string) => string[];
  allTags: string[];
  /** Whether the tag map is the server's. Under 'error' `allTags` is a subset
   *  of unknown size, and any audience derived from it is incomplete. */
  status: LoadStatus;
  /** Resolves true only when the tag is stored server-side, where the coach's
   *  other devices and the broadcast audience query can see it. */
  addTag: (clientId: string, tag: string) => Promise<boolean>;
  /** Resolves true only when the tag was actually removed. A refused delete
   *  means the client is still in that audience on the server. */
  removeTag: (clientId: string, tag: string) => Promise<boolean>;
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
        const { data, error } = await supabase.from('client_tags').select('client_id, tag').eq('coach_id', id);
        if (cancelled) return;
        // `error || !data` returned down the same path as a coach who has
        // tagged nobody, and `allTags` came out empty either way.
        if (error) { setStatus('error'); return; }
        const next: Record<string, string[]> = {};
        (data ?? []).forEach((r: any) => { (next[r.client_id] ||= []).push(r.tag); });
        // Merge real tags over the demo seed (real wins for overlapping clients).
        if (Object.keys(next).length) setMap((p) => ({ ...p, ...next }));
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const addTag = async (clientId: string, raw: string): Promise<boolean> => {
    const tag = norm(raw); if (!tag) return false;
    setMap((p) => {
      const cur = p[clientId] || [];
      if (cur.includes(tag)) return p;
      return { ...p, [clientId]: [...cur, tag] };
    });
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('client_tags').insert({ coach_id: uid, client_id: clientId, tag });
      return !error;
    } catch { return false; }
  };

  const removeTag = async (clientId: string, raw: string): Promise<boolean> => {
    const tag = norm(raw);
    setMap((p) => ({ ...p, [clientId]: (p[clientId] || []).filter((x) => x !== tag) }));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('client_tags').delete().eq('coach_id', uid).eq('client_id', clientId).eq('tag', tag);
      return !error;
    } catch { return false; }
  };

  const allTags = useMemo(() => {
    const s = new Set<string>();
    Object.values(map).forEach((arr) => arr.forEach((x) => s.add(x)));
    return Array.from(s).sort();
  }, [map]);

  const tagsFor = (clientId: string) => map[clientId] || [];

  return <Ctx.Provider value={{ tagsFor, allTags, status, addTag, removeTag }}>{children}</Ctx.Provider>;
}

export function useClientTags(): TagsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientTags must be used inside <ClientTagsProvider>');
  return v;
}
