// Shared training-session store — a single source of truth for the coach and
// client portals so a slot the coach opens shows up as bookable for the client,
// a booking shows on the coach's calendar, and a cancellation re-offers the slot.
// Persists to Supabase `sessions` (RLS: trainer owns; client reads open slots and
// their own; book/cancel/approve via RPC) with a defensive in-memory fallback and
// a booking reminder. Client approvals are merged in from `session_approvals`.
//
// approveSession already refuses to lie — it updates local state only after the
// RPC accepts, with a comment saying why. Everything around it did not:
//
//   · the hydrate returned early on `error`, on `!data`, and on `!data.length`,
//     all down the same path. An empty calendar meant either "no sessions
//     booked" or "we could not read them", and the coach's schedule and the
//     client's upcoming-session card both stated the first.
//   · addSession / bookSession / releaseSession / removeSession were all
//     fire-and-forget with empty rejection handlers. A booking that the server
//     refused still drew on the calendar AND scheduled the client a local "your
//     session starts in 1 hour" notification, so they were reminded to attend a
//     session that did not exist.
//
// addSession's `{ ok }` shape is untouched — screens destructure it — but it now
// also carries `saved`, a promise that resolves to whether the row reached the
// server.
import { createContext, useContext, useEffect, useState } from 'react';
import { overlaps } from '../lib/booking';
import type { TrainingSession } from '../lib/types';
import { scheduleLocal } from './pushNotifications';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

interface SessionsValue {
  sessions: TrainingSession[];
  /** Whether `sessions` is the server's calendar. Under 'error' an empty list
   *  means it could not be read, not that nothing is booked. */
  status: LoadStatus;
  /** Add a slot. Rejected (ok:false) if it overlaps an existing session — no
   *  double-booking. `saved` (present only when ok) resolves true once the slot
   *  is on the server, where clients can actually see and book it. */
  addSession: (s: TrainingSession) => { ok: boolean; saved?: Promise<boolean> };
  /** Resolves true only when the booking reached the server. False means the
   *  slot shows as booked on this device alone — and the reminder that was just
   *  scheduled is for a session nobody else knows about. */
  bookSession: (id: string, clientId: string) => Promise<boolean>;
  /** Cancel → slot returns to available and is flagged re-offered. Resolves
   *  true only when the server accepted it; false means the client is still
   *  booked in and the coach's screen is the only thing that says otherwise. */
  releaseSession: (id: string) => Promise<boolean>;
  /** Resolves true only when the row was actually deleted server-side. */
  removeSession: (id: string) => Promise<boolean>;
  /** Client confirms a delivered session, with an optional comment for the trainer.
   *  Goes through the `approve_session` RPC — a client has no write access to
   *  `sessions` or `session_approvals` directly. */
  approveSession: (id: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
}

const rowToSession = (r: any): TrainingSession => ({
  id: String(r.id), trainerId: r.trainer_id, clientId: r.client_id,
  startsAt: r.starts_at, durationMin: r.duration_min, status: r.status, released: !!r.released,
});

const Ctx = createContext<SessionsValue | null>(null);

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
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
        const { data, error } = await supabase.from('sessions').select('*').order('starts_at', { ascending: true });
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        // A confirmed empty calendar is a real answer and now reports itself as
        // one, instead of returning down the same path as a failed read.
        if (!data || !data.length) { setSessions([]); setStatus('ready'); return; }
        let rows = data.map(rowToSession);
        // Approvals live in their own table (see supabase/session-approvals.sql).
        // A failure here must not cost us the sessions themselves — the screen is
        // still usable without knowing what has been approved.
        try {
          // no-error-ok: an unread approval leaves the session showing as not-yet-approved, which is what it shows before anyone approves it; the sessions themselves are the point of this screen
          const { data: appr } = await supabase.from('session_approvals').select('session_id, approved_at, note');
          if (appr?.length) {
            const byId = new Map(appr.map((a: any) => [String(a.session_id), a]));
            rows = rows.map((r) => {
              const a = byId.get(r.id);
              return a ? { ...r, approvedAt: a.approved_at, approvalNote: a.note ?? null } : r;
            });
          }
        } catch { /* sessions still load */ }
        if (cancelled) return;
        setSessions(rows);
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const addSession: SessionsValue['addSession'] = (s) => {
    if (overlaps(s.startsAt, s.durationMin, sessions)) return { ok: false };
    const entry = { ...s, trainerId: uid ?? s.trainerId };
    setSessions((p) => [...p, entry]);
    if (!USE_SUPABASE || !uid) return { ok: true, saved: Promise.resolve(false) };
    const saved = (async (): Promise<boolean> => {
      try {
        // `.then(({ data }) => …, () => {})` never read `error`, so a slot the
        // server refused was drawn on the coach's calendar as an open session a
        // client could book — and no client could ever see it.
        const { data, error } = await supabase.from('sessions')
          .insert({ trainer_id: uid, client_id: s.clientId ?? null, starts_at: s.startsAt, duration_min: s.durationMin, status: s.status, released: s.released })
          .select().single();
        if (error || !data) return false;
        setSessions((p) => p.map((x) => (x.id === entry.id ? rowToSession(data) : x)));
        return true;
      } catch { return false; }
    })();
    return { ok: true, saved };
  };

  const bookSession: SessionsValue['bookSession'] = async (id, clientId) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'booked', clientId, released: false } : x)));
    const s = sessions.find((x) => x.id === id);
    if (s && s.startsAt) {
      const start = new Date(s.startsAt);
      scheduleLocal('Session in 1 hour', 'Your training session starts at ' + start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.', new Date(start.getTime() - 60 * 60 * 1000));
    }
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.rpc('book_session', { p_session: id });
      return !error;
    } catch { return false; }
  };

  const releaseSession: SessionsValue['releaseSession'] = async (id) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'available', clientId: null, released: true } : x)));
    if (!USE_SUPABASE) return false;
    // Trainer path (RLS-owned direct update) or client path (RPC) — the one the
    // caller is allowed to do takes effect. Both were fired and neither result
    // looked at, so "neither was allowed" was indistinguishable from success.
    // An update the policy filters out is not an error in Postgrest, it just
    // changes zero rows, so the returned rows are what has to be counted.
    try {
      const { data, error } = await supabase.from('sessions').update({ status: 'available', client_id: null, released: true }).eq('id', id).select('id');
      if (!error && data && data.length) return true;
    } catch { /* fall through to the client-side RPC */ }
    try {
      const { error } = await supabase.rpc('cancel_session', { p_session: id });
      return !error;
    } catch { return false; }
  };

  const removeSession: SessionsValue['removeSession'] = async (id) => {
    setSessions((p) => p.filter((x) => x.id !== id));
    if (!USE_SUPABASE) return false;
    try {
      // Same reason as above: a delete the policy filters out reports no error
      // and removes nothing, leaving the session to reappear on next launch.
      const { data, error } = await supabase.from('sessions').delete().eq('id', id).select('id');
      return !error && !!data && data.length > 0;
    } catch { return false; }
  };

  const approveSession: SessionsValue['approveSession'] = async (id, note) => {
    const trimmed = (note || '').trim();
    if (!USE_SUPABASE) return { ok: false, error: 'Not signed in to the server.' };
    try {
      const { error } = await supabase.rpc('approve_session', { p_session: id, p_note: trimmed || null });
      if (error) return { ok: false, error: error.message };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not reach the server.' };
    }
    // Only after the server accepted it — an approval that exists on this phone
    // and nowhere else is exactly the bug this replaced.
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, approvedAt: new Date().toISOString(), approvalNote: trimmed || null } : x)));
    return { ok: true };
  };

  return <Ctx.Provider value={{ sessions, status, addSession, bookSession, releaseSession, removeSession, approveSession }}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessions must be used inside <SessionsProvider>');
  return v;
}
