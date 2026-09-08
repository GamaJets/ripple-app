// White-label brand identity — the app name shown across the product.
//
// ── What this is, after the gym became the source of truth ─────────────────
//
// The gym's identity lives in `tenants`: `name` and `brand_color`, one row, one
// answer for every device any owner signs in on. Nothing wrote to either. This
// provider kept the name in AsyncStorage and the colour was only ever the theme
// accent, also in AsyncStorage — so two owners of the same gym, on two phones,
// each had their own private branding of it, and `tenants.name` sat holding the
// provisioning placeholder ("Tim's space") that nobody had chosen.
//
// The WRITE now goes to `tenants`, through `updateTenant()` in src/ui/tenant.tsx
// — see app/(owner)/brand.tsx, which is the screen that does it. This provider
// no longer owns the answer; it caches it for the one place the answer cannot
// be read.
//
// ── Why the write is not in here ───────────────────────────────────────────
//
// Because there would then be two copies of `tenants.name` in the app — this
// one and TenantProvider's — and they can disagree. Part 101 makes the same
// argument about `profiles.brand` and reaches the same conclusion: two copies
// of one fact drift, and the drift is silent. TenantProvider already reads the
// row, already writes it, and already knows when the read FAILED, which is the
// distinction the whole of src/ui/loadStatus.ts exists to keep. A second reader
// here would have to re-derive all of it and could still be a version behind.
//
// It is also not reachable from here: <BrandProvider> sits OUTSIDE
// <TenantProvider> in app/_layout.tsx, so `useTenant()` would throw. Reordering
// them is a change to a file this one has no business touching, and would not
// fix the duplication anyway.
//
// ── What is left, and why it is still device-local ─────────────────────────
//
// `appName` is drawn on welcome, sign-in, forgot-password and phone-signin —
// screens shown when NOBODY IS SIGNED IN. There is no session, so there is no
// tenant, so there is nothing to read: a cached copy is the only thing that can
// answer, and AsyncStorage is where it belongs. `adoptGymName` is how the gym's
// real name gets into that cache once somebody has signed in and an owner
// screen has read it.
import { createContext, useMemo, useRef, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VARIANT, VARIANT_LABEL } from '../lib/variant';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';

interface BrandValue {
  appName: string;
  /**
   * Take the gym's own name, as `tenants.name` has it, and remember it on this
   * device — for the signed-out screens, which cannot read it.
   *
   * Null and blank are IGNORED rather than treated as a clear. Null is what a
   * failed tenant read leaves behind, and overwriting a good cached name with
   * it would replace the gym's name with "Repple Studio" because the network
   * was down for a second.
   */
  adoptGymName: (n: string | null | undefined) => void;
  /**
   * Set the label on THIS DEVICE only. Not a rename: the gym's name is
   * `tenants.name`, written through `updateTenant()`. Kept for the signed-out
   * case and for resetting the cache.
   */
  setAppName: (n: string) => void;
}

const Ctx = createContext<BrandValue | null>(null);

const KEY = 'repple.appName';

export function BrandProvider({ children }: { children: ReactNode }) {
  // Defaults to THIS app's name, not the family name. Repple Coach that
  // introduces itself as "Repple" reads like the wrong download.
  const [appName, setAppNameState] = useState(VARIANT_LABEL[VARIANT]);
  useEffect(() => { (async () => {
    // A cache, not the record. The gym's real name is `tenants.name` and
    // `adoptGymName` writes it back here on every launch that reaches the
    // server, so a read that fails leaves this app calling itself by the
    // build's own name for one launch and correcting itself on the next. There
    // is nothing to say to the member and nothing to withhold: the fallback IS
    // a true name for this app. It is still worth a trace, because the same
    // failure repeating is the difference between a flat battery and a device
    // whose storage has stopped answering.
    try { const n = await AsyncStorage.getItem(KEY); if (n) setAppNameState(n); } catch (e) { reportError('brand.cachedName', e); }
  })(); }, []);
  const setAppName = (n: string) => {
    const v = n.trim() || VARIANT_LABEL[VARIANT];
    setAppNameState(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
  };
  const adoptGymName = (n: string | null | undefined) => {
    const v = (n ?? '').trim();
    if (!v) return;
    setAppNameState(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
  };

  // ── the member's own gym, adopted for the member ────────────────────────
  //
  // `adoptGymName` existed and its only callers were on app/(owner)/brand.tsx,
  // a screen no member opens. So every member of every white-label gym read the
  // BUILD's name — on the full-screen barcode they hold up at the turnstile,
  // and in the three-letter prefix of the member number derived from it
  // (`memberPrefix`, src/lib/membership.ts). "Repple ID REP-4417", on the two
  // screens a member actually shows to staff.
  //
  // `my_gym_name()` (supabase/parts/962) answers only about the caller and only
  // when their tenant is somebody's GYM — a personal workspace named "Tim's
  // space" returns null, because renaming the app after the member would be
  // worse than the defect. Anything else — the function not applied yet, no
  // session, a refusal, no answer — leaves the cached name exactly as it was,
  // which is what `adoptGymName` already does with a blank.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    const ask = async () => {
      try {
        const { data, error } = await supabase.rpc('my_gym_name');
        // no-error-ok: this is a name, not a fact anything is computed from.
        // A gym that could not be read keeps whatever this device last knew.
        if (cancelled || error) return;
        const n = typeof data === 'string' ? data : null;
        if (n) adoptGymName(n);
      } catch { /* same reason */ }
    };
    void ask();
    // Signing in is when the answer first becomes available: the provider mounts
    // on the welcome screen, before there is a session to ask about.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) void ask();
    });
    return () => { cancelled = true; sub?.subscription?.unsubscribe?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Why the implementations below are handed out through a ref ────────────
  //
  // This provider used to publish an inline object literal, so `useBrand`
  // returned a different value on every render — and every function on it was a
  // different function again. The consumer that writes the obvious thing,
  // `useFocusEffect(useCallback(() => { x.adoptGymName(); }, [x]))`, then builds a
  // machine that cannot stop: the effect re-runs when its callback's identity
  // changes, the call re-runs the fetch, the fetch ends in a setState, the
  // provider re-renders, and both identities are new again. src/ui/roster.tsx
  // documents that at length and is the pattern this follows.
  //
  // The wrappers are created once and read the current implementations out of a
  // ref, so they are stable for the life of the provider while still closing
  // over this render's state. Freezing the implementations themselves in a
  // `useCallback` would freeze that state with them, which is the same bug one
  // level down.
  const impl = useRef({ adoptGymName, setAppName });
  impl.current = { adoptGymName, setAppName };
  const adoptGymNameStable = useCallback((...a: Parameters<typeof adoptGymName>) => impl.current.adoptGymName(...a), []);
  const setAppNameStable = useCallback((...a: Parameters<typeof setAppName>) => impl.current.setAppName(...a), []);
  const value = useMemo<BrandValue>(() => ({ appName, adoptGymName: adoptGymNameStable, setAppName: setAppNameStable }), [appName, adoptGymNameStable, setAppNameStable]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBrand must be used inside <BrandProvider>');
  return v;
}
