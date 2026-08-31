// Owner operations — announcements to trainers and a support inbox. Reactive
// for announcements + ticket resolution.
//
// Starts empty. These lists were previously seeded with fabricated trainers,
// support tickets and activity ("Daniel Reyes", "Sara Lindqvist", promo
// redemptions), which shipped in the production bundle and showed up in a real
// owner's portal as if they were real people and real events.
import { createContext, useContext, useState, type ReactNode } from 'react';

// The activity log is gone rather than left empty.
//
// `activity` was a module-level `ActivityEvent[]` initialised to `[]` and never
// assigned to by anything — the events it was built for ("moved to Pro",
// "suspended") went when this stopped being a subscription console, and no
// replacement writes to it. Handed to a screen it is indistinguishable from a
// feed that is working and has nothing in it, which is exactly how the Ops
// Activity tab came to promise an owner that "trials, plan changes and
// suspensions land here as they happen" over an array with no writer.
//
// A real feed means a table and rows in it, not this shape restored. Kept out
// of the context so the next screen cannot pick it up and make the promise
// again by accident.
export interface OpsAnnouncement { id: string; at: string; body: string }
export interface Ticket { id: string; from: string; subject: string; body: string; resolved: boolean }

let SEQ = 1;
const seedAnns: OpsAnnouncement[] = [];
const seedTickets: Ticket[] = [];

interface OpsValue {
  anns: OpsAnnouncement[]; addAnn: (body: string) => void;
  tickets: Ticket[]; resolveTicket: (id: string) => void;
  openTickets: number;
}
const Ctx = createContext<OpsValue | null>(null);

export function OwnerOpsProvider({ children }: { children: ReactNode }) {
  const [anns, setAnns] = useState<OpsAnnouncement[]>(() => JSON.parse(JSON.stringify(seedAnns)));
  const [tickets, setTickets] = useState<Ticket[]>(() => JSON.parse(JSON.stringify(seedTickets)));
  const addAnn = (body: string) => { const b = body.trim(); if (!b) return; setAnns((p) => [{ id: 'oa' + SEQ++, at: new Date().toISOString(), body: b }, ...p]); };
  const resolveTicket = (id: string) => setTickets((p) => p.map((x) => (x.id === id ? { ...x, resolved: true } : x)));
  const openTickets = tickets.filter((x) => !x.resolved).length;
  return <Ctx.Provider value={{ anns, addAnn, tickets, resolveTicket, openTickets }}>{children}</Ctx.Provider>;
}
export function useOwnerOps(): OpsValue { const v = useContext(Ctx); if (!v) throw new Error('useOwnerOps must be used inside <OwnerOpsProvider>'); return v; }
