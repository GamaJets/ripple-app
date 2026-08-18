// Shared training-session store — a single source of truth for the coach and
// client portals so a slot the coach opens shows up as bookable for the client,
// a booking shows on the coach's calendar, and a cancellation re-offers the slot.
// Persists to Supabase `sessions` (RLS: trainer owns; client reads coach's slots;
// book/cancel via RPC) with a defensive in-memory fallback + booking reminder.
import { createContext, useContext, useEffect, useState } from 'react';
import { overlaps } from '../lib/booking';
import type { TrainingSession } from '../lib/types';
import { scheduleLocal } from './pushNotifications';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

interface SessionsValue {
  sessions: TrainingSession[];
  /** Add a slot. Rejected (ok:false) if it overlaps an existing session — no double-booking. */
  addSession: (s: TrainingSession) => { ok: boolean };
  bookSession: (id: string, clientId: string) => void;
  /** Cancel → slot returns to available and is flagged re-offered. */
  releaseSession: (id: string) => void;
  removeSession: (id: string) => void;
}

const rowToSession = (r: any): TrainingSession => ({
  id: String(r.id), trainerId: r.trainer_id, clientId: r.client_id,
  startsAt: r.starts_at, durationMin: r.duration_min, status: r.status, released: !!r.released,
});

const Ctx = createContext<SessionsValue | null>(null);

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data, error } = await supabase.from('sessions').select('*').order('starts_at', { ascending: true });
        if (error || cancelled || !data) return;
        if (data.length) setSessions(data.map(rowToSession));
      } catch { /* stay on mock */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const addSession: SessionsValue['addSession'] = (s) => {
    if (overlaps(s.startsAt, s.durationMin, sessions)) return { ok: false };
    const entry = { ...s, trainerId: uid ?? s.trainerId };
    setSessions((p) => [...p, entry]);
    if (USE_SUPABASE && uid) {
      try {
        supabase.from('sessions')
          .insert({ trainer_id: uid, client_id: s.clientId ?? null, starts_at: s.startsAt, duration_min: s.durationMin, status: s.status, released: s.released })
          .select().single()
          .then(({ data }) => { if (data) setSessions((p) => p.map((x) => (x.id === entry.id ? rowToSession(data) : x))); }, () => {});
      } catch { /* keep optimistic */ }
    }
    return { ok: true };
  };

  const bookSession: SessionsValue['bookSession'] = (id, clientId) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'booked', clientId, released: false } : x)));
    const s = sessions.find((x) => x.id === id);
    if (s && s.startsAt) {
      const start = new Date(s.startsAt);
      scheduleLocal('Session in 1 hour', 'Your training session starts at ' + start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.', new Date(start.getTime() - 60 * 60 * 1000));
    }
    if (USE_SUPABASE && uid) { try { supabase.rpc('book_session', { p_session: id }).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  const releaseSession: SessionsValue['releaseSession'] = (id) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'available', clientId: null, released: true } : x)));
    if (USE_SUPABASE) {
      // trainer path (RLS-owned direct update) or client path (RPC) — the one the caller is allowed to do takes effect.
      try { supabase.from('sessions').update({ status: 'available', client_id: null, released: true }).eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ }
      try { supabase.rpc('cancel_session', { p_session: id }).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const removeSession: SessionsValue['removeSession'] = (id) => {
    setSessions((p) => p.filter((x) => x.id !== id));
    if (USE_SUPABASE) { try { supabase.from('sessions').delete().eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  return <Ctx.Provider value={{ sessions, addSession, bookSession, releaseSession, removeSession }}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessions must be used inside <SessionsProvider>');
  return v;
}
