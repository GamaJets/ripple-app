// Owner operations — announcements to trainers, a support inbox, and a
// platform activity log. Reactive for announcements + ticket resolution; the
// activity log is seeded read-only. Swap for Supabase later.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface OpsAnnouncement { id: string; at: string; body: string }
export interface Ticket { id: string; from: string; subject: string; body: string; resolved: boolean }
export interface ActivityEvent { id: string; at: string; icon: string; text: string }

let SEQ = 1;
const seedAnns: OpsAnnouncement[] = [
  { id: 'oa0', at: new Date(Date.now() - 3 * 86400000).toISOString(), body: 'v2.1 is live: white-label colours now apply instantly. Update your app to see it.' },
];
const seedTickets: Ticket[] = [
  { id: 'tk1', from: 'Sara Lindqvist', subject: 'Bulk-import clients?', body: 'Can I upload a CSV of my 14 clients instead of adding them one by one?', resolved: false },
  { id: 'tk2', from: 'Marcus Cole', subject: 'Payout timing', body: 'When do session fees land in my account after a client pays?', resolved: false },
  { id: 'tk3', from: 'Daniel Reyes', subject: 'Custom domain', body: 'Studio plan mentions a custom domain — how do I set that up?', resolved: true },
];
const seedActivity: ActivityEvent[] = [
  { id: 'ae1', at: new Date(Date.now() - 2 * 3600000).toISOString(), icon: '🧑‍🏫', text: 'Aisha Rahman started a Pro trial' },
  { id: 'ae2', at: new Date(Date.now() - 8 * 3600000).toISOString(), icon: '💳', text: 'Sara Lindqvist renewed Studio ($249)' },
  { id: 'ae3', at: new Date(Date.now() - 26 * 3600000).toISOString(), icon: '👥', text: 'Daniel Reyes added 2 new clients' },
  { id: 'ae4', at: new Date(Date.now() - 50 * 3600000).toISOString(), icon: '🎨', text: 'Marcus Cole updated their brand colour' },
  { id: 'ae5', at: new Date(Date.now() - 72 * 3600000).toISOString(), icon: '🎟️', text: 'Promo LAUNCH20 redeemed (2×)' },
];

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
