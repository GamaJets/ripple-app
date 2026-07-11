// Owner · White-label Studio. Set the app name and pick the primary palette
// (one of 10). Applies live app-wide and persists. Optional custom accent too.
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { useBrand } from '../../src/ui/brand';
import { Icon } from '../../src/ui/Icon';

export default function OwnerBrand() {
  const t = useTheme();
  const { palette, setPalette, palettes, setAccent } = useThemeControls();
  const { appName, setAppName } = useBrand();
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>White-label Studio</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Rebrand the whole app — applies live and persists</Text>

        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 14 }}>
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>App name</Text>
          <TextInput value={appName} onChangeText={setAppName} placeholder="Your brand" placeholderTextColor={t.ink3} style={inp} />
        </View>

        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>Primary palette</Text>
        <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Tap a colour — the whole app rethemes instantly.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          {palettes.map((p) => {
            const on = p.key === palette;
            return (
              <Pressable key={p.key} onPress={() => { setAccent(null); setPalette(p.key); }} accessibilityLabel={p.name} style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: p.theme.bg, borderWidth: on ? 3 : 1, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.theme.brand }} />
                {on ? <View style={{ position: 'absolute', bottom: 3, right: 3 }}><Icon name="check" size={13} color={t.brand} /></View> : null}
              </Pressable>
            );
          })}
        </View>
        <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 18 }}>Current: {palettes.find((p) => p.key === palette)?.name}</Text>

        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>Live preview</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: t.surface2, borderBottomWidth: 1, borderBottomColor: t.ring }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: t.brand }} />
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{appName}</Text>
          </View>
          <View style={{ padding: 16 }}>
            <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 14, marginBottom: 12 }}><Text style={{ color: t.ink3, fontSize: 12 }}>Daily target</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800' }}>1,980<Text style={{ fontSize: 12, color: t.ink3 }}> kcal</Text></Text></View>
            <View style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Start today's workout</Text></View>
          </View>
        </View>

        <Pressable onPress={() => { setAccent(null); setPalette('teal'); setAppName('Repple'); Alert.alert('Reset', 'Branding restored to Repple defaults.'); }} style={{ marginTop: 14, alignSelf: 'flex-start', paddingVertical: 8 }}>
          <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Reset to default branding</Text>
        </Pressable>

        <Text style={{ color: t.ink3, fontSize: 12, marginTop: 10 }}>On Studio plans each trainer gets this panel for their own client app — their logo, colours, and domain. You keep the platform fee.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
