// Shared UI primitives + the live theme (accent colour + light/dark/auto).
import { ReactNode, createContext, useContext, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dark, light, brandInkFor, type Theme } from '../theme/tokens';

export type ThemeMode = 'dark' | 'light' | 'auto';
interface ThemeControls { mode: ThemeMode; accent: string; setMode: (m: ThemeMode) => void; setAccent: (c: string) => void; theme: Theme }
const ThemeCtx = createContext<ThemeControls | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const sys = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [accent, setAccentState] = useState<string>(dark.brand);
  useEffect(() => { (async () => {
    try { const m = await AsyncStorage.getItem('repple.themeMode'); const a = await AsyncStorage.getItem('repple.accent'); if (m) setModeState(m as ThemeMode); if (a) setAccentState(a); } catch {}
  })(); }, []);
  const setMode = (m: ThemeMode) => { setModeState(m); AsyncStorage.setItem('repple.themeMode', m).catch(() => {}); };
  const setAccent = (c: string) => { setAccentState(c); AsyncStorage.setItem('repple.accent', c).catch(() => {}); };
  const isDark = mode === 'auto' ? sys !== 'light' : mode === 'dark';
  const base = isDark ? dark : light;
  const theme: Theme = { ...base, brand: accent, brandInk: brandInkFor(accent) };
  return <ThemeCtx.Provider value={{ mode, accent, setMode, setAccent, theme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  const c = useContext(ThemeCtx);
  return c ? c.theme : dark;
}
export function useThemeControls(): ThemeControls {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error('useThemeControls must be used inside <AppThemeProvider>');
  return c;
}

export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 18 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '700', textTransform: 'capitalize' }}>{title}</Text>
        {subtitle ? <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>{subtitle}</Text> : <View style={{ height: 12 }} />}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, tint }: { children: ReactNode; tint?: boolean }) {
  const t = useTheme();
  return (
    <View style={[s.card, { backgroundColor: tint ? t.surface2 : t.surface, borderColor: t.ring }]}>{children}</View>
  );
}

export function Tile({ label, value, unit, foot }: { label: string; value: string; unit?: string; foot?: string }) {
  const t = useTheme();
  return (
    <View style={[s.tile, { backgroundColor: t.surface, borderColor: t.ring }]}>
      <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 24, fontWeight: '700', marginTop: 4 }}>
        {value}{unit ? <Text style={{ color: t.ink3, fontSize: 13 }}> {unit}</Text> : null}
      </Text>
      {foot ? <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{foot}</Text> : null}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export function Btn({ label, onPress, primary }: { label: string; onPress?: () => void; primary?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[s.btn, { backgroundColor: primary ? t.brand : t.surface2, borderColor: t.ring }]}>
      <Text style={{ color: primary ? t.brandInk : t.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 15 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, borderWidth: 1, alignItems: 'center' },
});
