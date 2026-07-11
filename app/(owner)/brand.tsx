// Owner · White-label studio. Picking a colour or editing the name applies the
// brand LIVE across the entire app (theme accent + app name), and persists it.
// This is the core white-label selling point: rebrand the whole product.
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { useBrand } from '../../src/ui/brand';

const COLORS = ['#2dd4bf', '#f59e0b', '#a855f7', '#ef4444', '#3b82f6', '#ec4899', '#84cc16', '#0ea5e9', '#14b8a6'];

export default function OwnerBrand() {
  const t = useTheme();
  const { accent, setAccent } = useThemeControls();
  const { appName, setAppName } = useBrand();
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>White-label studio</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Rebrand the whole app — changes apply live and persist</Text>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>App name</Text>
          <TextInput value={appName} onChangeText={setAppName} placeholder="Your brand" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 14 }]} />
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Primary colour</Text>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <Pressable key={c} onPress={() => setAccent(c)} accessibilityLabel={`Brand colour ${c}`} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c, borderWidth: accent.toLowerCase() === c.toLowerCase() ? 3 : 0, borderColor: t.ink, alignItems: 'center', justifyContent: 'center' }}>
                {accent.toLowerCase() === c.toLowerCase() ? <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
          <Text style={{ color: t.ink3, fontSize: 12, marginTop: 12 }}>Tap a colour — the whole app recolours instantly. Your choice is saved automatically.</Text>
        </View>

        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Live preview</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: t.surface2, borderBottomWidth: 1, borderBottomColor: t.ring }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: t.brandInk, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brandInk }} /></View>
            </View>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{appName}</Text>
          </View>
          <View style={{ padding: 16 }}>
            <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 14, marginBottom: 12 }}><Text style={{ color: t.ink3, fontSize: 12 }}>Daily target</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize' }}>1,980<Text style={{ fontSize: 12, color: t.ink3 }}> kcal</Text></Text></View>
            <View style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Start today's workout</Text></View>
          </View>
        </View>

        <Pressable onPress={() => { setAccent('#2dd4bf'); setAppName('Repple'); Alert.alert('Reset', 'Branding restored to Repple defaults.'); }} style={{ marginTop: 14, alignSelf: 'flex-start', paddingVertical: 8 }}>
          <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Reset to default branding</Text>
        </Pressable>

        <Text style={{ color: t.ink3, fontSize: 12, marginTop: 8 }}>On Studio plans each trainer gets this panel for their own client app — their logo, colours, and domain. You keep the platform fee.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
