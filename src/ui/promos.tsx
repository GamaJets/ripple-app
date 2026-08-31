// Promo codes a gym offers, and who has actually used one.
//
// ── What was here before ───────────────────────────────────────────────────
//
// `useState`. Nothing else. A code created on the Growth screen lived in React
// memory for the life of the process: close the app and it was gone, and no
// other device — including the owner's own second phone — ever saw it. The
// header said "Swap for a Supabase promo_codes table in the migration"; the
// table (`promos`) had existed since part 02 the whole time, unread and
// unwritten by anything.
//
// It also carried a `redeemed` number that no code path anywhere incremented.
// The screens have already stopped printing it, because a zero presented as a
// tracked metric is worse than no metric. What was missing was not the number
// but the EVENT: nothing recorded that a person had used a code, so the one
// question an owner runs a promotion to answer — did it bring anybody in —
// could not be asked.
//
// ── What it does now ───────────────────────────────────────────────────────
//
// Codes persist to `promos`, scoped to the gym by `is_owner_of(tenant_id)`.
// Redemptions are ROWS in `promo_redemptions`, one per member per code, so the
// count is derived and the owner can see who and when. The count is never
// maintained by `update … set n = n + 1`: that loses writes under concurrency,
// and it is exactly the shape this codebase has a standing rule against.
//
// LoadStatus applies. An empty list means "this gym has no codes" only under
// 'ready'; under 'error' it means the read did not answer, and the Growth
// screen must not offer to create the first code to somebody who may already
// have six.
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { useTenant } from './tenant';
import type { LoadStatus } from './loadStatus';

export interface Promo {
  id: string;
  code: string;
  discountPct: number;
  /** Rows in promo_redemptions. Derived, never a stored counter. */
  redeemed: number;
  active: boolean;
}

interface PromosValue {
  promos: Promo[];
  /** Whether `promos` is what the server holds. An empty list under 'error'
   *  means unknown, not "no codes". */
  status: LoadStatus;
  /** Resolves once the code is on the server. `ok: false` carries the reason. */
  addPromo: (code: string, discountPct: number) => Promise<{ ok: boolean; reason?: string }>;
  toggleActive: (id: string) => Promise<boolean>;
  removePromo: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PromosValue | null>(null);

export function PromosProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const { tenant } = useTenant();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const tenantId = tenant?.id ?? null;

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    if (!tenantId) return; // tenant.status says why; nothing to read against yet
    const { data, error } = await supabase
      .from('promos')
      .select('id, code, discount, active')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(capLimit());
    if (error) { setStatus('error'); return; }
    const page = capped(data);
    const rows = page.rows as { id: string; code: string; discount: number; active: boolean | null }[];

    // Counted from rows, in one request rather than one per code. A code with
    // no redemptions simply has no rows, which is a 0 we can stand behind.
    let counts = new Map<string, number>();
    let countsKnown = true;
    if (rows.length) {
      const { data: reds, error: rErr } = await supabase
        .from('promo_redemptions')
        .select('promo_id')
        .in('promo_id', rows.map((r) => r.id))
        .limit(capLimit());
      if (rErr) {
        // The codes are real and readable; only the counts are not. Reported
        // as 'partial' so the list shows and the figures render as a dash —
        // a 0 here would say "nobody used it", which is the opposite of
        // "we could not count".
        countsKnown = false;
      } else {
        const redPage = capped(reds);
        if (redPage.truncated) countsKnown = false;
        for (const r of redPage.rows as { promo_id: string }[]) {
          counts.set(r.promo_id, (counts.get(r.promo_id) ?? 0) + 1);
        }
      }
    }

    setPromos(rows.map((r) => ({
      id: String(r.id),
      code: r.code,
      discountPct: Number(r.discount) || 0,
      redeemed: countsKnown ? (counts.get(String(r.id)) ?? 0) : -1,
      active: !!r.active,
    })));
    setStatus(page.truncated || !countsKnown ? 'partial' : 'ready');
  }, [tenantId]);

  useEffect(() => { void refresh(); }, [refresh, authRev]);

  const addPromo: PromosValue['addPromo'] = useCallback(async (code, discountPct) => {
    const c = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!c) return { ok: false, reason: 'Enter a code' };
    if (promos.some((p) => p.code === c)) return { ok: false, reason: 'Code already exists' };
    if (!USE_SUPABASE || !tenantId) return { ok: false, reason: 'No gym to attach this code to.' };
    const { error } = await supabase.from('promos').insert({
      tenant_id: tenantId, code: c, discount: Math.round(discountPct), active: true,
    });
    // A code that exists at another gym is fine; one that exists at this one is
    // caught above and by the read below.
    if (error) return { ok: false, reason: 'That code could not be saved. Try again in a moment.' };
    await refresh();
    return { ok: true };
  }, [promos, tenantId, refresh]);

  const toggleActive = useCallback(async (id: string): Promise<boolean> => {
    const cur = promos.find((p) => p.id === id);
    if (!cur || !USE_SUPABASE) return false;
    // An UPDATE matching zero rows is not an error in PostgREST, so the count
    // is what is checked — the recurring bug class in this codebase.
    const { error, count } = await supabase
      .from('promos').update({ active: !cur.active }, { count: 'exact' }).eq('id', id);
    if (error || !count) return false;
    await refresh();
    return true;
  }, [promos, refresh]);

  const removePromo = useCallback(async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE) return false;
    const { error, count } = await supabase
      .from('promos').delete({ count: 'exact' }).eq('id', id);
    if (error || !count) return false;
    await refresh();
    return true;
  }, [refresh]);

  return (
    <Ctx.Provider value={{ promos, status, addPromo, toggleActive, removePromo, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePromos(): PromosValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePromos must be used inside <PromosProvider>');
  return v;
}
