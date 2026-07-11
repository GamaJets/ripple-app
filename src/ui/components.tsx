// Shared UI primitives + the live theme. The theme is one of 10 palettes
// (Elevated Teal default), selectable by client & trainer. An optional accent
// override sits on top for owner white-labelling. Both persist.
import { ReactNode, createContext, useContext, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { paletteByKey, brandInkFor, DEFAULT_PALETTE, PALETTES, teal, type Theme, type PaletteMeta } from '../theme/tokens';

interface ThemeControls {
  palette: string; setPalette: (k: string) => void;
  accent: string | null; setAccent: (c: string | null) => void;
  palettes: PaletteMeta[]; theme: Theme;
}
const ThemeCtx = createContext<ThemeControls | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<string>(DEFAULT_PALETTE);
  const [accent, setAccentState] = useState<string | null>(null);
  useEffect(() => { (async () => {
    try {
      const p = await AsyncStorage.getItem('repple.palette');
      const a = await AsyncStorage.getItem('repple.accent.v2');
      if (p) setPaletteState(p);
      if (a) setAccentState(a);
    } catch {}
  })(); }, []);
  const setPalette = (k: string) => { setPaletteState(k); setAccentState(null); AsyncStorage.setItem('repple.palette', k).catch(() => {}); AsyncStorage.removeItem('repple.accent.v2').catch(() => {}); };
  const setAccent = (c: string | null) => {
    setAccentState(c);
    if (c) AsyncStorage.setItem('repple.accent.v2', c).catch(() => {});
    else AsyncStorage.removeItem('repple.accent.v2').catch(() => {});
  };
  const base = paletteByKey(palette);
  const theme: Theme = accent ? { ...base, brand: accent, brandInk: brandInkFor(accent) } : base;
  return <ThemeCtx.Provider value={{ palette, setPalette, accent, setAccent, palettes: PALETTES, theme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  const c = useContext(ThemeCtx);
  return c ? c.theme : teal;
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
  return <View style={[s.card, { backgroundColor: tint ? t.surface2 : t.surface, borderColor: t.ring }]}>{children}</View>;
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
