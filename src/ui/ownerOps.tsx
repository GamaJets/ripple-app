// Owner operations — announcements to trainers, a support inbox, and a
// platform activity log. Reactive for announcements + ticket resolution.
//
// Starts empty. These lists were previously seeded with fabricated trainers,
// support tickets and activity ("Daniel Reyes", "Sara Lindqvist", promo
// redemptions), which shipped in the production bundle and showed up in a real
// owner's portal as if they were real people and real events.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface OpsAnnouncement { id: string; at: string; body: string }
export interface Ticket { id: string; from: string; subject: string; body: string; resolved: boolean }
export interface ActivityEvent { id: string; at: string; icon: string; text: string }

let SEQ = 1;
const seedAnns: OpsAnnouncement[] = [];
const seedTickets: Ticket[] = [];
const seedActivity: ActivityEvent[] = [];

interface OpsValue {
  anns: OpsAnnouncement[]; addAnn: (body: string) => void;
  tickets: Ticket[]; resolveTicket: (id: string) => void;
  activity: ActivityEvent[];
  openTickets: number;
}
const Ctx = createContext<OpsValue | null>(null);

export function OwnerOpsProvider({ children }: { children: ReactNode }) {
  const [anns, setAnns] = useState<OpsAnnouncement[]>(() => JSON.parse(JSON.stringify(seedAnns)));
  const [tickets, setTickets] = useState<Ticket[]>(() => JSON.parse(JSON.stringify(seedTickets)));
  const addAnn = (body: string) => { const b = body.trim(); if (!b) return; setAnns((p) => [{ id: 'oa' + SEQ++, at: new Date().toISOString(), body: b }, ...p]); };
  const resolveTicket = (id: string) => setTickets((p) => p.map((x) => (x.id === id ? { ...x, resolved: true } : x)));
  const openTickets = tickets.filter((x) => !x.resolved).length;
  return <Ctx.Provider value={{ anns, addAnn, tickets, resolveTicket, activity: seedActivity, openTickets }}>{children}</Ctx.Provider>;
}
export function useOwnerOps(): OpsValue { const v = useContext(Ctx); if (!v) throw new Error('useOwnerOps must be used inside <OwnerOpsProvider>'); return v; }
