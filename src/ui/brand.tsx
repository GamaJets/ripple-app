// White-label brand identity — the app name shown across the product. The brand
// COLOUR is handled by the theme accent (useThemeControls().setAccent); this
// provider carries the tenant's app name. Persisted so it survives restarts.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BrandValue { appName: string; setAppName: (n: string) => void }

const Ctx = createContext<BrandValue | null>(null);

export function BrandProvider({ children }: { children: ReactNode }) {
  const [appName, setAppNameState] = useState('Repple');
  useEffect(() => { (async () => {
    try { const n = await AsyncStorage.getItem('repple.appName'); if (n) setAppNameState(n); } catch {}
  })(); }, []);
  const setAppName = (n: string) => {
    setAppNameState(n);
    AsyncStorage.setItem('repple.appName', n.trim() || 'Repple').catch(() => {});
  };
  return <Ctx.Provider value={{ appName, setAppName }}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBrand must be used inside <BrandProvider>');
  return v;
}
