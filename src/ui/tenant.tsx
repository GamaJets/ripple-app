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
import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { checkTenantBrand } from '../lib/tenantBrand';
import { wholeMoney } from '../lib/coachMoney';
import type { LoadStatus } from './loadStatus';
import { classifySetCurrencyError, isCurrencyCode, readSetCurrency, type SetCurrencyOutcome, type SetCurrencyReply } from '../lib/coachCurrency';
import { useAuthRevision } from './authRevision';
import { useRecoverRead } from './readRefresh';
import { readMyProfileRow, forgetMyRows } from './myProfile';

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
 * ── what it is still FOR, and what it is NOT ──────────────────────────────
 *
 * This block used to justify the constant as "the historical denomination of
 * the operating record": every money column declared `currency text not null
 * default 'AED'`, so rows written before a gym chose a currency genuinely were
 * dirhams, and Ops could name that to an owner as a fact about their own data.
 *
 * BOTH HALVES OF THAT ARE NOW FALSE, and leaving the sentence here is worse
 * than deleting the constant would be — it is the reason a reviewer waves
 * through a hardcoded currency in front of somebody's money.
 *
 *   · supabase/parts/150 DROPPED the default on all seven money columns
 *     (gym_invoices, gym_pass_types, gym_passes, gym_payments,
 *     membership_plans, payroll_settlements, trainer_packages). They keep NOT
 *     NULL, so a write that does not name the currency now fails with 23502
 *     instead of quietly filing dirhams. Nothing defaults to AED any more.
 *
 *   · Part 150 dropped them precisely BECAUSE all seven tables were empty, and
 *     they still are. There is no body of dirham-denominated rows for this
 *     constant to name. The "history" it was said to describe does not exist.
 *
 * What part 99 actually backfilled was one column — `tenants.currency` — on
 * the tenants that existed then. That is the whole of the AED that is really
 * on record, and it is not a figure this constant denominates: those tenants
 * have a currency, so they never reach a fallback.
 *
 * currency-ok: this constant is a NAMED PLACEHOLDER, not a denomination and
 * not a fallback. Its single remaining use is app/(owner)/ops.tsx, which
 * labels the empty session-fee field with it while telling the owner in the
 * same breath that no currency is set and asking them to choose one. Nothing
 * renders an established figure through it, `gymMoney` does not touch it, and
 * `money()` has no default at all. Do not reintroduce it as a fallback, and do
 * not let any copy claim it describes what a gym's records are already in.
 */
export const GYM_CURRENCY = 'AED';

/**
 * A whole-currency amount, denominated — the owner app's one door for one.
 *
 * The gym's own figures come in MAJOR units: `tenants.session_fee` is a numeric
 * in whole currency and `payroll30For` multiplies by it, so a payroll of 6,300
 * is 6,300 dirhams, not 63. `money()` takes MINOR units, which is why this
 * function exists at all rather than five call sites reaching for whichever
 * formatter was already imported — one of which is how the console once showed
 * AED 63.00 where the gym owed AED 6,300 (see the note on `payroll30For` in
 * src/lib/gymTrainers.ts).
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
/**
 * ── THE FACTOR IS NOT A HUNDRED ───────────────────────────────────────────
 *
 * This line used to read `money(Math.round(whole * 100), currency)`: convert
 * the whole-unit figure up into minor units, hand it to the minor-unit
 * formatter, and let that divide it back down. The round trip is exact in the
 * currencies that have a hundred minor units and in no others. Sixteen have
 * none at all, so a session fee of ¥6,300 went up to 630,000 and came back as
 * "JPY 630,000" — a hundred times the gym's own figure, on its payroll screen.
 * Five have a THOUSAND, so a KWD 40 fee went up to 4,000 and came back as
 * "KWD 4.000", a tenth of it.
 *
 * There is no conversion any more. `wholeMoney` formats a whole-unit amount in
 * its own currency directly, asking `currencyDecimals` how many places that
 * money has, so nothing is multiplied and nothing is divided. Everything this
 * function promised still holds: a null amount or a missing currency renders a
 * dash, and there is no fallback currency.
 */
export const gymMoney = (whole: number | null | undefined, currency: string | null | undefined): string | null =>
  wholeMoney(whole, currency);

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
  /** Hours of notice before a class inside which the gym may charge, and what
   *  they charge. Both null until the owner states them — null is "not said",
   *  never a zero-hour window or a free cancellation. supabase/parts/2615. */
  classCancelHours: number | null;
  classCancelFee: number | null;
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
  updateTenant: (patch: Partial<Pick<Tenant, 'name' | 'brandColor' | 'sessionFee' | 'currency' | 'classCancelHours' | 'classCancelFee'>>) => Promise<boolean>;
  /**
   * The OTHER way a currency gets set, and the only one a coach has.
   *
   * `updateTenant` above is owner-only and that is correct for a gym. It is
   * also a dead end for the person it blocks hardest: `is_owner_of(t)` requires
   * `profiles.role = 'owner'`, a coach's role is 'trainer', and part 153
   * measured that every coach sits ALONE in a personal tenant. So a coach's
   * UPDATE matches zero rows, six screens withhold every money figure they
   * have, and all six tell that coach to ask a gym owner who does not exist.
   *
   * This goes through `set_my_tenant_currency()` (supabase/parts/164), which is
   * security definer and grants exactly one thing: the SOLE occupant of a
   * tenant may name its currency once, when none is set. It refuses a shared
   * tenant — that is a gym, it has an owner, and `tenants_owner_rw` decides —
   * and it refuses to CHANGE a currency, because every stored price is
   * denominated in the one that is there.
   *
   * It lives on this provider rather than in src/lib/coachCurrency.ts for two
   * reasons: every write to `tenants` in this repository goes through this
   * file, and coachCurrency.ts must not import the Supabase client or its own
   * tests stop running. The outcome vocabulary and all the wording are there.
   */
  setOwnCurrency: (code: string) => Promise<SetCurrencyOutcome>;
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
  // Forgets the shared profile read before re-running, so a refresh is a real
  // re-read rather than the answer the launch already had. A person pulling
  // down is asking the server, not asking us again.
  const refresh = useCallback(() => { forgetMyRows(); setTick((t) => t + 1); }, []);

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

        // ONE read of this row per launch, shared with the three other
        // providers that were each reading it for their own columns — and it is
        // still this provider that decides what a failure here means. See
        // src/ui/myProfile.ts; the outcome carries the error rather than a null
        // row, which is what keeps the check below able to tell "refused" from
        // "this user has no gym".
        const profOut = await readMyProfileRow(uid);
        if (cancelled) return;
        // Without this check a refused read fell through as prof = null, which
        // the tid line below reads as "this user has no gym".
        if (!profOut.ok) { reportError('tenant.load.profile', profOut.error); setStatus('error'); setLoading(false); return; }
        const prof = profOut.value;
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
          .from('tenants').select('id, name, brand_color, plan, session_fee, currency, class_cancel_hours, class_cancel_fee').eq('id', tid).maybeSingle();
        if (cancelled) return;
        if (tErr) { reportError('tenant.load.tenant', tErr); setStatus('error'); setLoading(false); return; }
        setTenant(t ? {
          id: t.id,
          name: t.name,
          brandColor: t.brand_color ?? null,
          plan: t.plan ?? null,
          sessionFee: t.session_fee == null ? null : Number(t.session_fee),
          // NaN becomes null rather than a figure a sentence would quote.
          classCancelHours: t.class_cancel_hours == null || !Number.isFinite(Number(t.class_cancel_hours))
            ? null : Number(t.class_cancel_hours),
          classCancelFee: t.class_cancel_fee == null || !Number.isFinite(Number(t.class_cancel_fee))
            ? null : Number(t.class_cancel_fee),
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
    // Null is a deliberate clear — an owner withdrawing a policy they had
    // stated — and must reach the column as null rather than being skipped.
    if (patch.classCancelHours !== undefined) row.class_cancel_hours = patch.classCancelHours;
    if (patch.classCancelFee !== undefined) row.class_cancel_fee = patch.classCancelFee;
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

  // The coach's route. See the note on `setOwnCurrency` in TenantValue.
  //
  // No local patch on success, and that is not laziness. `refresh()` re-reads
  // the row, which is the same thing the six screens that withhold money do for
  // themselves on their next mount — and a local patch here would be a second
  // copy of the answer, written by the one caller with a reason to be
  // optimistic about it. That is exactly how `updateTenant` came to report a
  // gym name saved on one device and nowhere else.
  const setOwnCurrency: TenantValue['setOwnCurrency'] = useCallback(async (code) => {
    if (!USE_SUPABASE) return 'unavailable';
    // Refused here rather than sent, because the column's own CHECK
    // (`tenants_currency_is_iso`, part 99) refuses it and a constraint
    // violation is a worse thing to show somebody than a sentence.
    if (!isCurrencyCode(code)) return 'bad-code';
    try {
      const { data, error } = await supabase.rpc('set_my_tenant_currency', { p_currency: code });
      if (error) {
        const out = classifySetCurrencyError(error as { code?: string | null; status?: number | null; message?: string | null });
        // Not reported when the function is simply not there yet: that is a
        // migration waiting to be applied, it will be true on every launch
        // until it is, and filing it as an error would bury the real ones.
        if (out !== 'unavailable') reportError('tenant.setOwnCurrency', error);
        return out;
      }
      const out = readSetCurrency(data as SetCurrencyReply | null);
      if (out === 'set') refresh();
      return out;
    } catch (e) {
      // A throw out of the fetch is nobody answering, never a refusal.
      reportError('tenant.setOwnCurrency', e);
      return 'unsent';
    }
  }, [refresh]);

  // Re-run this read when the signal comes back. Everything white-label hangs
  // off this one — the gym's name, its logo, its CURRENCY — so a failure here
  // is felt on every screen at once. src/lib/readRefresh.ts.
  useRecoverRead('tenant', status, () => { void refresh(); });

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const value = useMemo<TenantValue>(() => ({ tenant, role, loading, status, brandMismatch, refresh, updateTenant, setOwnCurrency }), [tenant, role, loading, status, brandMismatch, refresh, updateTenant, setOwnCurrency]);
  return (
    <Ctx.Provider value={value}>{children}</Ctx.Provider>
  );
}

export function useTenant(): TenantValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTenant must be used inside <TenantProvider>');
  return v;
}
