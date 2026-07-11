// Coach-assigned training programs — a reactive store mapping clientId → Program.
// When a trainer assigns a program in the builder, the client's Train tab uses it
// instead of the auto-generated one. Lives at the app root so both portals share
// it. Seeded empty: every client starts on their auto program until a coach
// personalises it. Swap for Supabase (programs table) in the data migration.
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Program } from '../lib/programs';

interface AssignedProgramsValue {
  programs: Record<string, Program>;
  getProgram: (clientId: string) => Program | null;
  assignProgram: (clientId: string, program: Program) => void;
  clearProgram: (clientId: string) => void;
}

const Ctx = createContext<AssignedProgramsValue | null>(null);

export function AssignedProgramsProvider({ children }: { children: ReactNode }) {
  const [programs, setPrograms] = useState<Record<string, Program>>({});

  const getProgram = (clientId: string) => programs[clientId] ?? null;
  const assignProgram = (clientId: string, program: Program) =>
    setPrograms((p) => ({ ...p, [clientId]: program }));
  const clearProgram = (clientId: string) =>
    setPrograms((p) => { const n = { ...p }; delete n[clientId]; return n; });

  return (
    <Ctx.Provider value={{ programs, getProgram, assignProgram, clearProgram }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssignedPrograms(): AssignedProgramsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssignedPrograms must be used inside <AssignedProgramsProvider>');
  return v;
}
