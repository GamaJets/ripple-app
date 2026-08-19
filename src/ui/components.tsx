// Shared UI primitives + the live theme. The theme is one of 10 palettes
// (Elevated Teal default), selectable by client & trainer. An optional accent
// override sits on top for owner white-labelling. Both persist.
import { ReactNode, createContext, useContext, useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { paletteByKey, brandInkFor, DEFAULT_PALETTE, PALETTES, teal, type Theme, type PaletteMeta } from '../theme/tokens';
import { Icon } from './Icon';
// `value` is aliased to `figure` so it can't shadow <Tile/>'s `value` prop.
import { sp, layout, radius, hairline, type as ty, value as figure } from '../theme/scale';

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
      <ScrollView contentContainerStyle={{ padding: layout.gutter }}>
        <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>{title}</Text>
        {subtitle ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>{subtitle}</Text> : <View style={{ height: sp.md }} />}
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
      <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink3, textTransform: 'capitalize' }}>{label}</Text>
      <Text style={{ ...figure(24), color: t.ink, marginTop: 4 }}>
        {value}{unit ? <Text style={{ ...ty.label, color: t.ink3 }}> {unit}</Text> : null}
      </Text>
      {foot ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{foot}</Text> : null}
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
      <Text style={{ ...ty.label, fontWeight: '600', color: primary ? t.brandInk : t.ink }}>{label}</Text>
    </Pressable>
  );
}

// Password input with a tappable eye toggle so people can check what they
// typed before submitting. `style` should be the same object used for
// sibling TextInputs (e.g. the local `inp` style) — its marginBottom (if any)
// is lifted onto the wrapping View so the eye button stays vertically
// centered on the input itself, not the input+margin box.
export function PasswordField({
  value, onChangeText, placeholder, style, accessibilityLabel, autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  style?: Record<string, any>;
  accessibilityLabel?: string;
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const [visible, setVisible] = useState(false);
  const { marginBottom, ...fieldStyle } = style || {};
  return (
    <View style={{ marginBottom: marginBottom ?? 0 }}>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.ink3}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          style={[fieldStyle, { paddingRight: 44 }]}
          accessibilityLabel={accessibilityLabel}
          autoFocus={autoFocus}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          hitSlop={10}
          style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={20} color={t.ink3} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: hairline, borderRadius: radius.md, padding: sp.lg, marginBottom: sp.md },
  tile: { flex: 1, borderWidth: hairline, borderRadius: radius.md, padding: sp.lg },
  row: { flexDirection: 'row', gap: sp.md, marginBottom: sp.md },
  btn: { paddingHorizontal: sp.lg, paddingVertical: 9, borderRadius: radius.sm, borderWidth: hairline, alignItems: 'center' },
});
