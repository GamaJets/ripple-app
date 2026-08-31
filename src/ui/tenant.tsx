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
import { checkTenantBrand } from '../lib/tenantBrand';
import { money } from '../lib/gymRecord';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

/**
 * What the EXISTING rows in the gym operating record were recorded as — and
 * emphatically NOT a currency to render a figure in.
 *
 * ── it stopped being a fallback ───────────────────────────────────────────
 *
 * This used to be the fallback `gymMoney` reached for when the gym had not
 * named its own currency, and `money()` in src/lib/gymRecord.ts had the same
 * value baked in as a parameter default. Between them, every owner screen
 * printed dirhams at a gym that had never chosen them — with no error, nothing
 * to notice, and a result that reads as considered rather than as a missing
 * setting. Two call sites wrote it to disk. `tenants.currency` is nullable ON
 * PURPOSE and its own comment in setup.sql says the rule: NULL means the gym
 * has not set one — render a dash and ask, never assume.
 *
 * So `gymMoney` no longer touches this, `money()` has no default at all, and
 * an unknown currency is a withheld figure everywhere.
 *
 * ── what it is still FOR ──────────────────────────────────────────────────
 *
 * Every money column in the operating record declares `currency text not null
 * default 'AED'` — membership_plans, gym_payments, pass_types, guest_passes,
 * payroll settlements — and part 99 backfilled the existing tenants to it. So
 * rows written before a gym set its currency genuinely ARE denominated in this,
 * and Ops says so in as many words when it offers the setting: an owner
 * switching to GBP needs to know the history is in dirhams and this changes
 * only what is written from here on.
 *
 * That is its one legitimate use: naming what the record already holds, in
 * prose, to an owner deciding something. Never as the currency of a figure.
 *
 * currency-ok: this constant IS the historical denomination of the operating
 * record — every money column declares `default 'AED'` and part 99 backfilled
 * to it — and Ops quotes it to an owner as a fact about their existing rows.
 * It is a named piece of history, not a fallback: nothing renders a figure
 * through it any more, and `money()` no longer has a default at all.
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
 * ── TWO reasons this returns null, and they are the same dash ─────────────
 *
 * No AMOUNT: nobody has established the figure. This was always true — a
 * caller must not be handed "AED 0.00" for something unknown.
 *
 * No CURRENCY: the gym has not set one. This is new, and it is the point of
 * the change. `currency || GYM_CURRENCY` used to sit on this line, so six owner
 * screens quietly printed dirhams at gyms that had never chosen them. A wrong
 * currency in front of a number is a different amount, and unlike a dash it
 * does not prompt anybody to go and fix the setting. Pass `tenant.currency`
 * and pass it honestly — `?? null`, never `|| GYM_CURRENCY`.
 *
 * Callers pair this with `fig()` to draw the dash. A caller INTERPOLATING the
 * result into a sentence must branch on null first: `${gymMoney(...)}` renders
 * the four characters "null" into owner-facing copy, which is the one outcome
 * worse than a wrong currency.
 */
export const gymMoney = (whole: number | null | undefined, currency: string | null | undefined): string | null =>
  whole == null || !Number.isFinite(whole) ? null : money(Math.round(whole * 100), currency);

export interface Tenant {
  id: string;
  name: string;
  brandColor: string | null;
  plan: string | null;
  /**
   * What one delivered session is worth, in `currency`. Payroll is counted
   * against this.
   *
   * Null means the gym has not set one, and until part 118 that was
   * unreachable: the column was `not null default 75`, so every gym in the live
   * database held a 75 nobody had chosen and every screen spent it as though
   * somebody had. Ops now offers the control the copy has always pointed at.
   */
  sessionFee: number | null;
  /**
   * ISO 4217, from `tenants.currency` (part 99). Null means the gym has not
   * told us: render a dash and say so. Do NOT fall back to GYM_CURRENCY —
   * that advice was in this comment and six screens took it, which is how a
   * white-label product printed dirhams at gyms that had never chosen them.
   * A figure whose currency is unknown is withheld, not guessed.
   */
  currency: string | null;
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
  /**
   * Set when this gym belongs to a DIFFERENT brand than the app showing it.
   *
   * This provider used to resolve a tenant from `profiles.tenant_id` and stop
   * there, which is fine while one brand exists and wrong the moment two do: a
   * Brand A account opening Brand B's app was handed Brand A's gym, its
   * members and its takings, rendered under Brand B's name, with nothing at any
   * layer noting the swap.
   *
   * The REFUSAL lives in src/ui/auth.tsx, which signs a mismatched account out
   * before any screen mounts, so in normal running this stays null. It is here
   * for the window that survives that: a session already open when the brand
   * column is first populated, or one whose guard came back 'unknown' because
   * the RPC was unreachable at sign-in and reachable now.
   *
   * Null does NOT mean the brands match — it also covers "not asked yet" and
   * "could not find out", both of which are treated as no objection on purpose
   * (see src/lib/tenantBrand.ts on why this fails open). Read it as "a mismatch
   * has been confirmed", never as "this tenant has been cleared".
   */
  brandMismatch: string | null;
  refresh: () => void;
  /** Owner-only; RLS enforces it. Returns false when the write is rejected. */
  updateTenant: (patch: Partial<Pick<Tenant, 'name' | 'brandColor' | 'sessionFee' | 'currency'>>) => Promise<boolean>;
}

const Ctx = createContext<TenantValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [brandMismatch, setBrandMismatch] = useState<string | null>(null);
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
        if (!sess?.session) { setTenant(null); setBrandMismatch(null); setStatus('ready'); setLoading(false); return; }
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

        // Whose gym is this, and is it ours to be showing? Asked through an
        // RPC rather than by selecting `tenants.brand` below, for two reasons:
        // the SELECT policies on `tenants` do not cover a plain member reading
        // their own row (they get an empty set and no error), and selecting a
        // column that does not exist yet would turn every owner's tenant read
        // into an 'error' on the day this ships and the day part 101 is
        // applied are not the same day. A verdict of 'unknown' — including the
        // whole period before that part is applied — leaves this null and
        // changes nothing.
        const verdict = await checkTenantBrand();
        if (cancelled) return;
        setBrandMismatch(verdict.kind === 'mismatch' ? verdict.message : null);

        const tid = prof?.tenant_id ?? null;
        if (!tid) { setTenant(null); setStatus('ready'); setLoading(false); return; }

        const { data: t, error: tErr } = await supabase
          .from('tenants').select('id, name, brand_color, plan, session_fee, currency').eq('id', tid).maybeSingle();
        if (cancelled) return;
        if (tErr) { reportError('tenant.load.tenant', tErr); setStatus('error'); setLoading(false); return; }
        setTenant(t ? {
          id: t.id,
          name: t.name,
          brandColor: t.brand_color ?? null,
          plan: t.plan ?? null,
          sessionFee: t.session_fee == null ? null : Number(t.session_fee),
          currency: t.currency ?? null,
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

  // Owner-only, and the row count is the proof of it.
  //
  // This used to be `const { error } = await …update(…)` and `if (error) return
  // false`. RLS does not raise on a refused UPDATE — `tenants_owner_rw` is a
  // USING clause, so a caller who is not the owner of that row simply matches
  // nothing and PostgREST answers 204 with no error at all. Every caller then
  // read `true`, the local state was patched to the value that had NOT been
  // written, and the screen showed a gym name, brand colour or session fee that
  // existed on that one device and nowhere else — until the next reload put the
  // old value back with no explanation. Verified against the live database: an
  // owner updating their own tenant touches 1 row, the same statement aimed at
  // another gym touches 0 and returns no error.
  //
  // `.select('id')` makes the answer countable. Owners can SELECT their own
  // tenant under the same policy, so a successful write always returns its row.
  const updateTenant: TenantValue['updateTenant'] = useCallback(async (patch) => {
    if (!USE_SUPABASE || !tenant) return false;
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.brandColor !== undefined) row.brand_color = patch.brandColor;
    if (patch.sessionFee !== undefined) row.session_fee = patch.sessionFee;
    // Currency was excluded from this type, and `updateTenant` is the ONLY
    // write to `tenants` in the repository — so nothing anywhere could set a
    // gym's currency. `provision_profile` inserts none and part 99 added no
    // default, which means every gym created since then has `currency = NULL`
    // permanently, and half a dozen screens tell its owner "an owner sets it in
    // the gym settings" over a control that did not exist. Its coaches cannot
    // price a package at all.
    if (patch.currency !== undefined) row.currency = patch.currency;
    if (!Object.keys(row).length) return true;
    try {
      const { data, error } = await supabase.from('tenants').update(row).eq('id', tenant.id).select('id');
      if (error) { reportError('tenant.update', error); return false; }
      if (!data || data.length !== 1) return false;
      setTenant({ ...tenant, ...patch } as Tenant);
      return true;
    } catch (e) { reportError('tenant.update', e); return false; }
  }, [tenant]);

  return (
    <Ctx.Provider value={{ tenant, role, loading, status, brandMismatch, refresh, updateTenant }}>{children}</Ctx.Provider>
  );
}

export function useTenant(): TenantValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTenant must be used inside <TenantProvider>');
  return v;
}
