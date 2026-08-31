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
//
// But "has no tenant" and "we could not read the tenant" both arrived as
// `tenant: null, loading: false`. Neither of the two reads below destructured
// `error` — `const { data: prof } = …` and `const { data: t } = …` — and
// supabase-js resolves rather than throwing, so a refused read gave `prof =
// null`, which the next line treats as "this user has no tenant_id" and returns
// down the happy path. Every owner screen then told a gym owner they do not
// belong to a gym, and `role` came back null so some of them offered to set one
// up. `status` distinguishes the two.
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { money } from '../lib/gymRecord';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

/**
 * The currency this gym's books are kept in.
 *
 * There is no `tenants.currency` column — see 01-schema.sql, which gives a
 * tenant a name, a brand colour, a plan and a `session_fee numeric` and stops
 * there. So the currency is not something the owner has told us and it cannot
 * be read per gym; it is a property of the operating record itself. Every money
 * column in that record declares it: `currency text not null default 'AED'` in
 * membership_plans, gym_payments, pass_types, guest_passes and payroll
 * settlements, and `money()` in src/lib/gymRecord.ts defaults to the same. The
 * Members screen already prints the gym's recurring revenue through that
 * default, so 'AED' is what the database has been recording all along.
 *
 * It is named once, here, because it was not. Financials and Class Analytics
 * typed 'AED' by hand, Revenue and Trainers typed '$', and all four were
 * reading the SAME `tenants.session_fee` — so tabbing from Revenue to
 * Financials in a demo showed one gym's takings in two currencies, with nothing
 * on either screen to say which one was the mistake.
 *
 * When a gym that is not billed in dirhams signs up this becomes a column and a
 * setting. Until then it is one constant, stated where anyone changing it can
 * see what it is a copy of.
 */
export const GYM_CURRENCY = 'AED';

/**
 * A whole-currency amount as money() renders it — the owner app's one formatter.
 *
 * The gym's own figures come in MAJOR units: `tenants.session_fee` is a numeric
 * in whole currency and `payroll30For` multiplies by it, so a payroll of 6,300
 * is 6,300 dirhams, not 63. `money()` takes MINOR units, so the conversion
 * belongs here rather than at five call sites — one of which is how the console
 * once showed AED 63.00 where the gym owed AED 6,300 (see the note on
 * `payroll30For` in src/lib/gymTrainers.ts).
 *
 * Null in, null out, exactly as `money()` does it: a caller must not be handed
 * "AED 0.00" for an amount nobody has established. Pair it with `fig()` to draw
 * the dash.
 */
export const gymMoney = (whole: number | null | undefined): string | null =>
  whole == null || !Number.isFinite(whole) ? null : money(Math.round(whole * 100), GYM_CURRENCY);

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
  /** Whether `tenant` and `role` are the database's answer. Under 'error' a
   *  null tenant means we could not find out, NOT that the user has no gym —
   *  no screen should offer to create one on the strength of it. */
  status: LoadStatus;
  refresh: () => void;
  /** Owner-only; RLS enforces it. Returns false when the write is rejected. */
  updateTenant: (patch: Partial<Pick<Tenant, 'name' | 'brandColor' | 'sessionFee'>>) => Promise<boolean>;
}

const Ctx = createContext<TenantValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!USE_SUPABASE) { setLoading(false); setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setStatus('loading');
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        // Signed out is not a failed read of the tenant — there is simply no
        // user to have one. getUser() rejects with no session, which latched
        // this at 'error' on the first tick and it never ran again.
        if (!sess?.session) { setTenant(null); setStatus('ready'); setLoading(false); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { reportError('tenant.load.auth', authErr); setStatus('error'); setLoading(false); return; }
        const uid = auth?.user?.id;
        // Signed out: no tenant, and that is a fact rather than a failure.
        if (!uid) { setTenant(null); setRole(null); setStatus('ready'); setLoading(false); return; }

        const { data: prof, error: profErr } = await supabase
          .from('profiles').select('role, tenant_id').eq('id', uid).maybeSingle();
        if (cancelled) return;
        // Without this check a refused read fell through as prof = null, which
        // the tid line below reads as "this user has no gym".
        if (profErr) { reportError('tenant.load.profile', profErr); setStatus('error'); setLoading(false); return; }
        setRole(prof?.role ?? null);

        const tid = prof?.tenant_id ?? null;
        if (!tid) { setTenant(null); setStatus('ready'); setLoading(false); return; }

        const { data: t, error: tErr } = await supabase
          .from('tenants').select('id, name, brand_color, plan, session_fee').eq('id', tid).maybeSingle();
        if (cancelled) return;
        if (tErr) { reportError('tenant.load.tenant', tErr); setStatus('error'); setLoading(false); return; }
        setTenant(t ? {
          id: t.id,
          name: t.name,
          brandColor: t.brand_color ?? null,
          plan: t.plan ?? null,
          sessionFee: t.session_fee == null ? null : Number(t.session_fee),
        } : null);
        setStatus('ready');
      } catch (e) {
        reportError('tenant.load', e);
        if (!cancelled) { setTenant(null); setStatus('error'); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tick, authRev]);

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
    <Ctx.Provider value={{ tenant, role, loading, status, refresh, updateTenant }}>{children}</Ctx.Provider>
  );
}

export function useTenant(): TenantValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTenant must be used inside <TenantProvider>');
  return v;
}
