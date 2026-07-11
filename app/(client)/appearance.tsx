// Appearance — theme mode + accent colour, with a live preview.
// (Repple ships dark-first; a full runtime theme provider lands with the
// backend phase — this screen captures the client's preference now.)
import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { brandInkFor } from '../../src/theme/tokens';

const ACCENTS = ['#2dd4bf', '#3987e5', '#9085e9', '#e66767', '#199e70', '#c98500', '#e6579a'];
const MODES = [
  { id: 'dark', label: 'Dark', ico: '🌙' },
  { id: 'light', label: 'Light', ico: '☀️' },
  { id: 'auto', label: 'Auto', ico: '🌗' },
];

export default function Appearance() {
  const t = useTheme();
  const router = useRouter();
  const { mode, accent, setMode, setAccent } = useThemeControls();
  const [saved, setSaved] = useState(false);
  const accentInk = brandInkFor(accent);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}><Text style={{ color: t.ink3, fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Appearance</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Make Repple yours — pick a theme and accent colour.</Text>

        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>Theme</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          {MODES.map((m) => (
            <Pressable key={m.id} onPress={() => setMode(m.id as any)}
              style={{ flex: 1, backgroundColor: t.surface, borderRadius: 14, borderWidth: 2, borderColor: mode === m.id ? accent : t.ring, padding: 16, alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 24 }}>{m.ico}</Text>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>{m.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>Accent colour</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
          {ACCENTS.map((c) => (
            <Pressable key={c} onPress={() => setAccent(c)}
              style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: c, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: accent === c ? t.ink : 'transparent' }}>
              {accent === c ? <Text style={{ color: brandInkFor(c), fontWeight: '900', fontSize: 18 }}>✓</Text> : null}
            </Pressable>
          ))}
        </View>

        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>Preview</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: accent }} />
            <View>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>Today’s workout</Text>
              <Text style={{ color: t.ink3, fontSize: 12 }}>Push · 4 exercises</Text>
            </View>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, marginBottom: 8, overflow: 'hidden' }}>
            <View style={{ width: '68%', height: 8, backgroundColor: accent }} />
          </View>
          <Pressable style={{ backgroundColor: accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: accentInk, fontWeight: '800', fontSize: 14 }}>Primary button</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => { setSaved(true); setTimeout(() => setSaved(false), 1800); }}
          style={{ backgroundColor: saved ? t.surface2 : accent, borderWidth: 1, borderColor: saved ? t.ring : accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: saved ? t.ink : accentInk, fontWeight: '800', fontSize: 15 }}>{saved ? '✓ Preference saved' : 'Save appearance'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
