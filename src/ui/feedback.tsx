// Coach feedback — advice a trainer leaves on a client, shown on the client's
// dashboard. Reactive so a note the coach sends appears for the client
// immediately. Keyed by clientId; seeded with one example for the demo client.
// Swap for a Supabase `coach_feedback` table in the data migration.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface FeedbackItem { id: string; at: string; body: string }

interface FeedbackValue {
  getFeedback: (clientId: string) => FeedbackItem[];
  addFeedback: (clientId: string, body: string) => void;
}

const Ctx = createContext<FeedbackValue | null>(null);
let SEQ = 1;

const seed: Record<string, FeedbackItem[]> = {
  c1: [{
    id: 'f0',
    at: new Date(Date.now() - 2 * 86400000).toISOString(),
    body: 'Strong week — your squat is moving up nicely. Keep the descent controlled and hit the top of the rep range before adding weight.',
  }],
};

export function CoachFeedbackProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, FeedbackItem[]>>(() => JSON.parse(JSON.stringify(seed)));

  const getFeedback = (clientId: string) => map[clientId] ?? [];
  const addFeedback = (clientId: string, body: string) => {
    const b = body.trim();
    if (!b) return;
    const item: FeedbackItem = { id: 'f' + SEQ++, at: new Date().toISOString(), body: b };
    setMap((m) => ({ ...m, [clientId]: [item, ...(m[clientId] ?? [])] }));
  };

  return <Ctx.Provider value={{ getFeedback, addFeedback }}>{children}</Ctx.Provider>;
}

export function useCoachFeedback(): FeedbackValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachFeedback must be used inside <CoachFeedbackProvider>');
  return v;
}
