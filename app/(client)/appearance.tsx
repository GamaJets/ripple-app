// Appearance — pick one of 10 palettes. Applies live app-wide and persists.
// Available to clients and trainers.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';

export default function Appearance() {
  const t = useTheme();
  const router = useRouter();
  const { palette, setPalette, palettes } = useThemeControls();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="back" size={18} color={t.brand} /><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15, marginLeft: 2 }}>Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Appearance</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Pick a colour theme — applies instantly across the app.</Text>

        {palettes.map((p) => {
          const on = p.key === palette;
          const th = p.theme;
          return (
            <Pressable key={p.key} onPress={() => setPalette(p.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surface, borderRadius: 16, borderWidth: on ? 2 : 1, borderColor: on ? t.brand : t.ring, padding: 14, marginBottom: 10 }}>
              {/* mini theme swatch */}
              <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: th.bg, borderWidth: 1, borderColor: th.ring, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-end' }}>
                <View style={{ flex: 1, height: '55%', backgroundColor: th.surface }} />
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: th.brand, margin: 5 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{p.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{p.light ? 'Light theme' : 'Dark theme'}</Text>
              </View>
              {on ? <Icon name="check" size={20} color={t.brand} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
