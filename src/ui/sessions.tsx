// Shared training-session store — a single source of truth for the coach and
// client portals so a slot the coach opens shows up as bookable for the client,
// a booking shows on the coach's calendar, and a cancellation re-offers the slot.
// Lives at the app root so it survives navigation between the (trainer) and
// (client) route groups.
import { createContext, useContext, useState } from 'react';
import { MOCK_SESSIONS } from '../lib/mockData';
import { overlaps } from '../lib/booking';
import type { TrainingSession } from '../lib/types';
import { scheduleLocal } from './pushNotifications';

interface SessionsValue {
  sessions: TrainingSession[];
  /** Add a slot. Rejected (ok:false) if it overlaps an existing session — no double-booking. */
  addSession: (s: TrainingSession) => { ok: boolean };
  bookSession: (id: string, clientId: string) => void;
  /** Cancel → slot returns to available and is flagged re-offered. */
  releaseSession: (id: string) => void;
  removeSession: (id: string) => void;
}

const Ctx = createContext<SessionsValue | null>(null);

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<TrainingSession[]>(() => JSON.parse(JSON.stringify(MOCK_SESSIONS)));

  const addSession: SessionsValue['addSession'] = (s) => {
    if (overlaps(s.startsAt, s.durationMin, sessions)) return { ok: false };
    setSessions((p) => [...p, s]);
    return { ok: true };
  };
  const bookSession: SessionsValue['bookSession'] = (id, clientId) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'booked', clientId, released: false } : x)));
    const s = sessions.find((x) => x.id === id);
    if (s && s.startsAt) {
      const start = new Date(s.startsAt);
      const remind = new Date(start.getTime() - 60 * 60 * 1000);
      scheduleLocal('Session in 1 hour', 'Your training session starts at ' + start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.', remind);
    }
  };
  const releaseSession: SessionsValue['releaseSession'] = (id) =>
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'available', clientId: null, released: true } : x)));
  const removeSession: SessionsValue['removeSession'] = (id) =>
    setSessions((p) => p.filter((x) => x.id !== id));

  return <Ctx.Provider value={{ sessions, addSession, bookSession, releaseSession, removeSession }}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessions must be used inside <SessionsProvider>');
  return v;
}
