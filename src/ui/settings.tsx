// App settings — notification preferences + unit preference. Persisted. The unit
// preference is stored app-wide (screens can read it as they adopt it).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WeightUnit = 'kg' | 'lb';
interface Settings { notifPush: boolean; notifEmail: boolean; weightUnit: WeightUnit }
interface SettingsValue extends Settings { set: (patch: Partial<Settings>) => void }

const DEFAULTS: Settings = { notifPush: true, notifEmail: false, weightUnit: 'kg' };
const Ctx = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => { (async () => {
    try { const raw = await AsyncStorage.getItem('repple.settings'); if (raw) setS({ ...DEFAULTS, ...JSON.parse(raw) }); } catch {}
  })(); }, []);
  const set = (patch: Partial<Settings>) => setS((prev) => { const next = { ...prev, ...patch }; AsyncStorage.setItem('repple.settings', JSON.stringify(next)).catch(() => {}); return next; });
  return <Ctx.Provider value={{ ...s, set }}>{children}</Ctx.Provider>;
}
export function useSettings(): SettingsValue { const v = useContext(Ctx); if (!v) throw new Error('useSettings must be used inside <SettingsProvider>'); return v; }
