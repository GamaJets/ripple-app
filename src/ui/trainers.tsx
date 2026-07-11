// Platform trainers — the owner's roster of paying trainers. Reactive so adding,
// re-planning, suspending or removing a trainer updates the Trainers screen and
// the Overview MRR live. Seeded from ownerMock. Revenue is derived from the plan
// price; suspended trainers don't count toward MRR. Swap for Supabase later.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { TRAINERS, PLANS } from '../lib/ownerMock';

export type TrainerStatus = 'active' | 'trial' | 'suspended';
export interface PlatformTrainerX {
  id: string; name: string; plan: string; clients: number; mrr: number;
  status: TrainerStatus; since: string;
}

export function planPrice(plan: string): number {
  return PLANS.find((p) => p.name === plan)?.price ?? 0;
}
function monthLabel(): string {
  const d = new Date();
  return d.toLocaleString(undefined, { month: 'short' }) + ' ' + d.getFullYear();
}

let SEQ = 100;

interface TrainersValue {
  trainers: PlatformTrainerX[];
  activeMrr: number;
  addTrainer: (name: string, plan: string) => void;
  removeTrainer: (id: string) => void;
  setPlan: (id: string, plan: string) => void;
  toggleSuspend: (id: string) => void;
}

const Ctx = createContext<TrainersValue | null>(null);

export function PlatformTrainersProvider({ children }: { children: ReactNode }) {
  const [trainers, setTrainers] = useState<PlatformTrainerX[]>(() => JSON.parse(JSON.stringify(TRAINERS)));

  const addTrainer = (name: string, plan: string) => {
    const n = name.trim();
    if (!n) return;
    setTrainers((p) => [...p, { id: 't' + SEQ++, name: n, plan, clients: 0, mrr: planPrice(plan), status: 'trial', since: monthLabel() }]);
  };
  const removeTrainer = (id: string) => setTrainers((p) => p.filter((x) => x.id !== id));
  const setPlan = (id: string, plan: string) =>
    setTrainers((p) => p.map((x) => (x.id === id ? { ...x, plan, mrr: planPrice(plan) } : x)));
  const toggleSuspend = (id: string) =>
    setTrainers((p) => p.map((x) => (x.id === id ? { ...x, status: x.status === 'suspended' ? 'active' : 'suspended' } : x)));

  const activeMrr = trainers.reduce((a, x) => a + (x.status === 'suspended' ? 0 : x.mrr), 0);

  return (
    <Ctx.Provider value={{ trainers, activeMrr, addTrainer, removeTrainer, setPlan, toggleSuspend }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePlatformTrainers(): TrainersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlatformTrainers must be used inside <PlatformTrainersProvider>');
  return v;
}
