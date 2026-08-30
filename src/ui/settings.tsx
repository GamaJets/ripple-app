// App settings — notification preferences + unit preferences.
//
// ── The unit preference used to be a device setting ────────────────────────
//
// Everything here lived in AsyncStorage under 'repple.settings' and nowhere
// else. For the two notification toggles that is arguable — push permission is
// a property of a handset. For units it is not: which unit a client reads in is
// a property of the client, and keeping it on the device meant a reinstall or a
// second handset silently put their weight back into kilograms. Unlike a lost
// notification toggle, that one changes what every figure on screen SAYS — a
// client who thinks in pounds opens the app on a new phone and appears to have
// lost 100 kg overnight. TF-37.
//
// So weightUnit and lengthUnit now follow the account (clients.weight_unit /
// clients.length_unit, part 61), with AsyncStorage kept as the cache that makes
// the first paint right and as the only store when there is no session or the
// backend is off. The notification toggles are deliberately left device-local.
//
// ── The push is gated on the read ──────────────────────────────────────────
//
// `synced` exists for the bug documented at length in clientData.tsx: a
// provider that pushes its state to the server before it has read the server's
// state overwrites the user's real answer with a constructed default, on every
// launch, forever. Nothing is written here until the row for this uid has come
// back — and if that read FAILS, nothing is ever written for that session,
// because a failed read is not permission to assume the server has nothing.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import type { WeightUnit, LengthUnit } from '../lib/units';

// Re-exported because every client screen has imported the weight unit from
// here since before there was a units module, and the shape of the union is
// not this provider's to own — src/lib/units.ts owns it, next to the
// conversions that depend on it.
export type { WeightUnit, LengthUnit };

interface Settings { notifPush: boolean; notifEmail: boolean; weightUnit: WeightUnit; lengthUnit: LengthUnit }
interface SettingsValue extends Settings {
  set: (patch: Partial<Settings>) => void;
  /** True once the account's own preference has been read (or there was never
   *  going to be one — no session, backend off). Screens that want to avoid a
   *  visible flip from kg to lb on launch can wait on it; most do not need to,
   *  because the AsyncStorage cache usually already holds the right answer. */
  unitsLoaded: boolean;
}

// Metric, because Repple is a UAE product and the UAE is metric — as is every
// country the app is sold into except the United States. The imperial option
// exists because a large share of the UAE's residents are American and British
// expats who think in pounds, not because the default is in doubt.
//
// This default is the APP's, and it stays out of the database: clients.weight_unit
// is NULL for anybody who has not chosen, which is what lets this line change
// later without overwriting the choice of everybody who deliberately picked kg.
// See supabase/parts/61-unit-preference.sql.
const DEFAULTS: Settings = { notifPush: true, notifEmail: false, weightUnit: 'kg', lengthUnit: 'cm' };
const Ctx = createContext<SettingsValue | null>(null);

const isWeightUnit = (v: unknown): v is WeightUnit => v === 'kg' || v === 'lb';
const isLengthUnit = (v: unknown): v is LengthUnit => v === 'cm' || v === 'in';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const rev = useAuthRevision();
  const [unitsLoaded, setUnitsLoaded] = useState(!USE_SUPABASE);
  // Which uid this provider may write to, and only once its row has been read.
  // A ref rather than state because `set` is called from an event handler that
  // must see the current value, not the one from the render it was created in.
  const writable = useRef<string | null>(null);
  /** Which table this account's units live in. `clients` for a client;
   *  `profiles` for a coach or owner, who has no clients row. Set by the read
   *  so the write cannot go somewhere the read never looked. */
  const unitHome = useRef<'clients' | 'profiles'>('clients');
  const latest = useRef<Settings>(s);
  latest.current = s;

  // The device cache: what makes the first paint right rather than making
  // everybody watch their weight change units a second after launch.
  useEffect(() => { (async () => {
    try {
      const raw = await AsyncStorage.getItem('repple.settings');
      if (raw) setS((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
  })(); }, []);

  // The account's answer, which wins over the cache when there is one. Keyed on
  // the auth revision, not on mount: providers that read on mount alone ran
  // before anybody had signed in and were never asked again — see authRevision.tsx.
  useEffect(() => {
    if (!USE_SUPABASE) { setUnitsLoaded(true); return; }
    let cancelled = false;
    writable.current = null;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        // Signed out: the device cache is the whole story, and there is nothing
        // to push to. Not an error state.
        if (!uid) { if (!cancelled) setUnitsLoaded(true); return; }
        const { data, error } = await supabase
          .from('clients').select('weight_unit, length_unit').eq('id', uid).maybeSingle();
        if (cancelled) return;
        if (error) {
          // The read failed. Leave `writable` null so nothing is pushed for the
          // rest of this session: the client may well have chosen pounds on
          // another device, and publishing this device's default over it is
          // precisely the failure this guard exists for.
          reportError('settings.units.read', error);
          setUnitsLoaded(true);
          return;
        }
        // maybeSingle rather than single: a trainer or owner signed into the
        // same build has no `clients` row, and that is an absence, not a fault
        // to report.
        //
        // It used to mean they kept a DEVICE-LOCAL preference — which survived
        // a relaunch, not a reinstall, and never followed them to a second
        // phone. In practice every coach was pinned to kilograms. profiles
        // carries the same two columns now (part 82) precisely because it is
        // the one table an account has whatever its role, so the fallback is a
        // real account-level answer rather than a handset's.
        let row: { weight_unit?: unknown; length_unit?: unknown } | null = data ?? null;
        let home: 'clients' | 'profiles' = 'clients';
        if (!row) {
          const { data: prof, error: profErr } = await supabase
            .from('profiles').select('weight_unit, length_unit').eq('id', uid).maybeSingle();
          if (cancelled) return;
          if (profErr) {
            // Same reasoning as the clients read above: a failed read leaves
            // `writable` null so this device publishes nothing over a choice
            // made elsewhere.
            reportError('settings.units.read', profErr);
            setUnitsLoaded(true);
            return;
          }
          row = prof ?? null;
          home = 'profiles';
        }
        unitHome.current = home;
        if (row) {
          const patch: Partial<Settings> = {};
          if (isWeightUnit(row.weight_unit)) patch.weightUnit = row.weight_unit;
          if (isLengthUnit(row.length_unit)) patch.lengthUnit = row.length_unit;
          // NULL columns mean "never chosen" and deliberately do NOT overwrite
          // what this device already had — a client who set pounds before this
          // shipped keeps pounds, and the next tap writes it to their account.
          if (Object.keys(patch).length) setS((prev) => ({ ...prev, ...patch }));
        }
        writable.current = uid;
        setUnitsLoaded(true);
      } catch (e) {
        if (cancelled) return;
        reportError('settings.units.read', e);
        setUnitsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [rev]);

  const set = (patch: Partial<Settings>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setS(next);
    AsyncStorage.setItem('repple.settings', JSON.stringify(next)).catch(() => {});
    // Only the unit columns go up. The notification toggles stay on the device
    // because push permission genuinely is a property of this handset.
    const uid = writable.current;
    if (!uid || (patch.weightUnit === undefined && patch.lengthUnit === undefined)) return;
    const row: Record<string, string> = {};
    if (patch.weightUnit !== undefined) row.weight_unit = next.weightUnit;
    if (patch.lengthUnit !== undefined) row.length_unit = next.lengthUnit;
    // Written back to whichever table the read found the account in, so a
    // coach's choice lands somewhere durable and a client's keeps landing
    // where every other screen already reads it from.
    supabase.from(unitHome.current).update(row).eq('id', uid)
      .then(({ error }) => { if (error) reportError('settings.units.write', error); },
            (e: unknown) => reportError('settings.units.write', e));
  };

  return <Ctx.Provider value={{ ...s, set, unitsLoaded }}>{children}</Ctx.Provider>;
}
export function useSettings(): SettingsValue { const v = useContext(Ctx); if (!v) throw new Error('useSettings must be used inside <SettingsProvider>'); return v; }
