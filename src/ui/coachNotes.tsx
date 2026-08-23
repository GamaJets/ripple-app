// Private coach notes — trainer-only notes about a client (never shown to the
// client), distinct from client-visible feedback. Keyed by clientId. Reactive.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Note { id: string; at: string; body: string }
let SEQ = 1;

interface NotesValue { getNotes: (clientId: string) => Note[]; addNote: (clientId: string, body: string) => void; removeNote: (clientId: string, id: string) => void }
const Ctx = createContext<NotesValue | null>(null);

export function CoachNotesProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, Note[]>>({});
  const getNotes = (clientId: string) => map[clientId] ?? [];
  const addNote = (clientId: string, body: string) => { const b = body.trim(); if (!b) return; setMap((m) => ({ ...m, [clientId]: [{ id: 'n' + SEQ++, at: new Date().toISOString(), body: b }, ...(m[clientId] ?? [])] })); };
  const removeNote = (clientId: string, id: string) => setMap((m) => ({ ...m, [clientId]: (m[clientId] ?? []).filter((n) => n.id !== id) }));
  return <Ctx.Provider value={{ getNotes, addNote, removeNote }}>{children}</Ctx.Provider>;
}
export function useCoachNotes(): NotesValue { const v = useContext(Ctx); if (!v) throw new Error('useCoachNotes must be used inside <CoachNotesProvider>'); return v; }
