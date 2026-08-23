// The signed-in user's tenant — the gym.
//
// `profiles.role = 'owner'` means a gym owner, scoped to one tenant. Every owner
// screen needs the same three things: which tenant, what it is called, and the
// session fee its payroll is calculated from. Before this, each call site
// re-queried `profiles.tenant_id` by hand and the brand name lived only in
// AsyncStorage on one device.
//
// Nothing here invents a value. If the tenant row has not loaded, or the user
// has no tenant, the fields are null and the screens say so rather than
// rendering a plausible default.
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';

export interface Tenant {
  id: string;
  name: string;
  brandColor: string | null;
  plan: string | null;
  /** What one delivered session is worth. Payroll is counted against this. */
  sessionFee: number | null;
}

interface TenantValue {
  tenant: Tenant | null;
  /** The signed-in user's role, as the database has it. */
  role: string | null;
  loading: boolean;
  refresh: () => void;
  /** Owner-only; RLS enforces it. Returns false when the write is rejected. */
  updateTenant: (patch: Partial<Pick<Tenant, 'name' | 'brandColor' | 'sessionFee'>>) => Promise<boolean>;
}

const Ctx = createContext<TenantValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!USE_SUPABASE) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) { if (!cancelled) { setTenant(null); setRole(null); setLoading(false); } return; }

        const { data: prof } = await supabase
          .from('profiles').select('role, tenant_id').eq('id', uid).maybeSingle();
        if (cancelled) return;
        setRole(prof?.role ?? null);

        const tid = prof?.tenant_id ?? null;
        if (!tid) { setTenant(null); setLoading(false); return; }

        const { data: t } = await supabase
          .from('tenants').select('id, name, brand_color, plan, session_fee').eq('id', tid).maybeSingle();
        if (cancelled) return;
        setTenant(t ? {
          id: t.id,
          name: t.name,
          brandColor: t.brand_color ?? null,
          plan: t.plan ?? null,
          sessionFee: t.session_fee == null ? null : Number(t.session_fee),
        } : null);
      } catch (e) {
        reportError('tenant.load', e);
        if (!cancelled) setTenant(null);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const updateTenant: TenantValue['updateTenant'] = useCallback(async (patch) => {
    if (!USE_SUPABASE || !tenant) return false;
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.brandColor !== undefined) row.brand_color = patch.brandColor;
    if (patch.sessionFee !== undefined) row.session_fee = patch.sessionFee;
    if (!Object.keys(row).length) return true;
    try {
      const { error } = await supabase.from('tenants').update(row).eq('id', tenant.id);
      if (error) return false;
      setTenant({ ...tenant, ...patch } as Tenant);
      return true;
    } catch (e) { reportError('tenant.update', e); return false; }
  }, [tenant]);

  return (
    <Ctx.Provider value={{ tenant, role, loading, refresh, updateTenant }}>{children}</Ctx.Provider>
  );
}

export function useTenant(): TenantValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTenant must be used inside <TenantProvider>');
  return v;
}
