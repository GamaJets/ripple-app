// Explore — searchable directory of every client feature, grouped by area.
// Anything in the app is reachable here in two taps. Driven by the shared
// feature registry so it stays in sync with the tabs and the Me hub.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { CLIENT_FEATURES, AREA_LABEL, searchFeatures, type FeatureArea } from '../../src/lib/features';

const ORDER: FeatureArea[] = ['train', 'meals', 'progress', 'me'];

export default function Explore() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const solo = cd.coachingMode === 'solo';
    const base = CLIENT_FEATURES.filter((f) => !(solo && f.soloHide));
    return searchFeatures(base, q);
  }, [q, cd.coachingMode]);

  const grouped = ORDER
    .map((area) => ({ area, items: list.filter((f) => f.area === area) }))
    .filter((g) => g.items.length > 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', marginBottom: 12 }}>Explore</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, marginBottom: 16 }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search features…" placeholderTextColor={t.ink3} autoCapitalize="none" style={{ flex: 1, color: t.ink, paddingVertical: 12, fontSize: 15 }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Text style={{ color: t.ink3, fontSize: 16, fontWeight: '800' }}>×</Text></Pressable> : null}
        </View>

        {grouped.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Icon name="search" size={26} color={t.ink3} />
            <Text style={{ color: t.ink3, fontSize: 14, marginTop: 10 }}>No features match “{q}”.</Text>
          </View>
        ) : grouped.map((g) => (
          <View key={g.area} style={{ marginBottom: 18 }}>
            <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>{AREA_LABEL[g.area]}</Text>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring }}>
              {g.items.map((h, i) => (
                <Pressable key={h.key} onPress={() => router.push(h.route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
                  <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={h.icon} size={16} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{h.label}</Text>
                    <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{h.note}</Text>
                  </View>
                  <Text style={{ color: t.ink3, fontSize: 18 }}>›</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
