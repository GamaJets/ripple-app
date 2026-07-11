// Coach announcements — a broadcast the trainer sends to all their clients.
// Clients see the latest on their dashboard. Reactive, seeded for the demo.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Announcement { id: string; at: string; body: string }
let SEQ = 1;
const seed: Announcement[] = [
  { id: 'a0', at: new Date(Date.now() - 1 * 86400000).toISOString(), body: 'New week, new PRs 💪 Gym reformer class added Thursdays 6pm — book from your calendar.' },
];

interface AnnValue { announcements: Announcement[]; latest: Announcement | null; addAnnouncement: (body: string) => void }
const Ctx = createContext<AnnValue | null>(null);

export function AnnouncementsProvider({ children }: { children: ReactNode }) {
  const [announcements, setAnns] = useState<Announcement[]>(() => JSON.parse(JSON.stringify(seed)));
  const addAnnouncement = (body: string) => { const b = body.trim(); if (!b) return; setAnns((p) => [{ id: 'a' + SEQ++, at: new Date().toISOString(), body: b }, ...p]); };
  return <Ctx.Provider value={{ announcements, latest: announcements[0] ?? null, addAnnouncement }}>{children}</Ctx.Provider>;
}
export function useAnnouncements(): AnnValue { const v = useContext(Ctx); if (!v) throw new Error('useAnnouncements must be used inside <AnnouncementsProvider>'); return v; }
