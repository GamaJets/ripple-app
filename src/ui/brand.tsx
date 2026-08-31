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
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VARIANT, VARIANT_LABEL } from '../lib/variant';

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
    try { const n = await AsyncStorage.getItem(KEY); if (n) setAppNameState(n); } catch {}
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
  return <Ctx.Provider value={{ appName, adoptGymName, setAppName }}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBrand must be used inside <BrandProvider>');
  return v;
}
