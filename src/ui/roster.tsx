// Shared client roster for the trainer portal — reactive so the coach can add or
// remove clients and the change flows to the Clients list and the Schedule's
// client picker. Seeded from the mock roster; swap for Supabase later.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { ROSTER, type RosterClient } from '../lib/trainerMock';

let SEQ = 900;

interface RosterValue {
  roster: RosterClient[];
  addClient: (name: string, goal: string, mode?: 'online' | 'inperson') => void;
  removeClient: (id: string) => void;
}

const Ctx = createContext<RosterValue | null>(null);

export function RosterProvider({ children }: { children: ReactNode }) {
  const [roster, setRoster] = useState<RosterClient[]>(() => JSON.parse(JSON.stringify(ROSTER)));
  const addClient = (name: string, goal: string, mode: 'online' | 'inperson' = 'online') => {
    const n = name.trim();
    if (!n) return;
    setRoster((p) => [...p, { id: `c${SEQ++}`, name: n, goal, weightDelta: 0, adherence: 100, lastActive: 'just added', next: '—', unread: 0, mode }]);
  };
  const removeClient = (id: string) => setRoster((p) => p.filter((c) => c.id !== id));
  return <Ctx.Provider value={{ roster, addClient, removeClient }}>{children}</Ctx.Provider>;
}

export function useRoster(): RosterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRoster must be used inside <RosterProvider>');
  return v;
}
