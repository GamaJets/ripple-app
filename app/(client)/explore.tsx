// Client · Explore — searchable directory of every client feature, grouped by
// area. Anything in the app is reachable here in two taps. Driven by the shared
// feature registry so it stays in sync with the tabs and the Me hub.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`), matching the owner portal's Explore. No hero: a search
// screen has no live number to lead with — the field is the point, so it sits
// directly under the title and every result is a `<ListRow>` rather than a
// hand-rolled row inside one big bordered box. Routes still come only from
// CLIENT_FEATURES; nothing is hardcoded here.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { CLIENT_FEATURES, AREA_LABEL, searchFeatures, type FeatureArea } from '../../src/lib/features';
import { Rule, Section, SectionHead, ListRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';

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

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Everything, in two taps</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Explore</Text>
          </View>
        </View>

        {/* ── the field is the screen ────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginTop: sp.lg }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search features…" placeholderTextColor={t.ink3} autoCapitalize="none"
            style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
        </View>

        {grouped.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Icon name="search" size={26} color={t.ink3} />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Nothing matches “{q}”.</Text>
          </View>
        ) : grouped.map((g, gi) => (
          <View key={g.area}>
            {gi > 0 ? <Rule /> : null}
            <Section>
              <SectionHead title={AREA_LABEL[g.area]} />
              {g.items.map((h) => (
                <ListRow key={h.key} icon={h.icon} title={h.label} note={h.note} onPress={() => router.push(h.route as any)} />
              ))}
            </Section>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
