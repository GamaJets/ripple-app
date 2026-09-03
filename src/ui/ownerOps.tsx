// Owner operations — the support inbox. Reactive for ticket resolution.
//
// Starts empty. These lists were previously seeded with fabricated trainers,
// support tickets and activity ("Daniel Reyes", "Sara Lindqvist", promo
// redemptions), which shipped in the production bundle and showed up in a real
// owner's portal as if they were real people and real events.
import { createContext, useMemo, useRef, useCallback, useContext, useState, type ReactNode } from 'react';

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
  // ── Why the implementations below are handed out through a ref ────────────
  //
  // This provider used to publish an inline object literal, so `useOwnerOps`
  // returned a different value on every render — and every function on it was a
  // different function again. The consumer that writes the obvious thing,
  // `useFocusEffect(useCallback(() => { x.resolveTicket(); }, [x]))`, then builds a
  // machine that cannot stop: the effect re-runs when its callback's identity
  // changes, the call re-runs the fetch, the fetch ends in a setState, the
  // provider re-renders, and both identities are new again. src/ui/roster.tsx
  // documents that at length and is the pattern this follows.
  //
  // The wrappers are created once and read the current implementations out of a
  // ref, so they are stable for the life of the provider while still closing
  // over this render's state. Freezing the implementations themselves in a
  // `useCallback` would freeze that state with them, which is the same bug one
  // level down.
  const impl = useRef({ resolveTicket });
  impl.current = { resolveTicket };
  const resolveTicketStable = useCallback((...a: Parameters<typeof resolveTicket>) => impl.current.resolveTicket(...a), []);
  const value = useMemo<OpsValue>(() => ({ tickets, resolveTicket: resolveTicketStable, openTickets }), [tickets, resolveTicketStable, openTickets]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useOwnerOps(): OpsValue { const v = useContext(Ctx); if (!v) throw new Error('useOwnerOps must be used inside <OwnerOpsProvider>'); return v; }
