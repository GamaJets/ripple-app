// Promo / referral codes the owner offers trainers. Reactive so creating,
// toggling or deleting a code updates the Growth screen live. Seeded for the
// demo. Swap for a Supabase `promo_codes` table in the migration.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Promo { id: string; code: string; discountPct: number; redeemed: number; active: boolean }

let SEQ = 10;

const seed: Promo[] = [
  { id: 'p1', code: 'LAUNCH20', discountPct: 20, redeemed: 7, active: true },
  { id: 'p2', code: 'COACH50', discountPct: 50, redeemed: 3, active: false },
];

interface PromosValue {
  promos: Promo[];
  addPromo: (code: string, discountPct: number) => { ok: boolean; reason?: string };
  toggleActive: (id: string) => void;
  removePromo: (id: string) => void;
}

const Ctx = createContext<PromosValue | null>(null);

export function PromosProvider({ children }: { children: ReactNode }) {
  const [promos, setPromos] = useState<Promo[]>(() => JSON.parse(JSON.stringify(seed)));

  const addPromo: PromosValue['addPromo'] = (code, discountPct) => {
    const c = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!c) return { ok: false, reason: 'Enter a code' };
    if (promos.some((p) => p.code === c)) return { ok: false, reason: 'Code already exists' };
    setPromos((p) => [{ id: 'p' + SEQ++, code: c, discountPct, redeemed: 0, active: true }, ...p]);
    return { ok: true };
  };
  const toggleActive = (id: string) => setPromos((p) => p.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
  const removePromo = (id: string) => setPromos((p) => p.filter((x) => x.id !== id));

  return <Ctx.Provider value={{ promos, addPromo, toggleActive, removePromo }}>{children}</Ctx.Provider>;
}

export function usePromos(): PromosValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePromos must be used inside <PromosProvider>');
  return v;
}
