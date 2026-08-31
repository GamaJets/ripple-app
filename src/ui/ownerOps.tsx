// Owner operations — the support inbox. Reactive for ticket resolution.
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
//
// The announcement store is gone rather than left in place, and for the same
// reason `activity` above was: nothing reads it any more, and a store nothing
// reads is one the next screen picks up believing it works.
//
// It was a `useState` here and a button in app/(owner)/ops.tsx whose own
// confirmation admitted the truth — "Saved to this device only — announcements
// do not reach trainers yet" — while `announcements` sat in the schema with
// policies written for exactly that broadcast and no writer anywhere. A gym
// closing on Monday had no way to say so. The owner's notices now go through
// src/ui/announcements.tsx, which writes the real row and fans it out to every
// member's notifications; keeping this beside it would give the next person a
// second, silent way to post one.
export interface Ticket { id: string; from: string; subject: string; body: string; resolved: boolean }

const seedTickets: Ticket[] = [];

interface OpsValue {
  tickets: Ticket[]; resolveTicket: (id: string) => void;
  openTickets: number;
}
const Ctx = createContext<OpsValue | null>(null);

export function OwnerOpsProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>(() => JSON.parse(JSON.stringify(seedTickets)));
  const resolveTicket = (id: string) => setTickets((p) => p.map((x) => (x.id === id ? { ...x, resolved: true } : x)));
  const openTickets = tickets.filter((x) => !x.resolved).length;
  return <Ctx.Provider value={{ tickets, resolveTicket, openTickets }}>{children}</Ctx.Provider>;
}
export function useOwnerOps(): OpsValue { const v = useContext(Ctx); if (!v) throw new Error('useOwnerOps must be used inside <OwnerOpsProvider>'); return v; }
