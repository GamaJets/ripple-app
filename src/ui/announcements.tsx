// Coach announcements — a broadcast the trainer sends to all their clients.
// Clients see the latest on their dashboard.
//
// The seed is empty. It used to contain a fabricated message ("New week, new
// PRs 💪 Gym reformer class added Thursdays 6pm — book from your calendar"),
// timestamped a day ago, shown under a "From your coach" heading with an unread
// dot. No trainer wrote it and no such class existed. Because clientData
// defaults coachingMode to 'online', it reached every client, including those
// with no coach at all.
//
// Note this store is in-memory only: a trainer's real announcement does not
// reach any other device. That is a separate gap, tracked, and no longer
// papered over by a fake one.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Announcement { id: string; at: string; body: string }
let SEQ = 1;
const seed: Announcement[] = [];

interface AnnValue { announcements: Announcement[]; latest: Announcement | null; addAnnouncement: (body: string) => void }
const Ctx = createContext<AnnValue | null>(null);

export function AnnouncementsProvider({ children }: { children: ReactNode }) {
  const [announcements, setAnns] = useState<Announcement[]>(() => JSON.parse(JSON.stringify(seed)));
  const addAnnouncement = (body: string) => { const b = body.trim(); if (!b) return; setAnns((p) => [{ id: 'a' + SEQ++, at: new Date().toISOString(), body: b }, ...p]); };
  return <Ctx.Provider value={{ announcements, latest: announcements[0] ?? null, addAnnouncement }}>{children}</Ctx.Provider>;
}
export function useAnnouncements(): AnnValue { const v = useContext(Ctx); if (!v) throw new Error('useAnnouncements must be used inside <AnnouncementsProvider>'); return v; }
