// Explore — searchable directory for the trainer portal. Reaches every
// destination in two taps. Driven by the shared feature registry.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero: a search screen has no live number to lead with
// — the field is the point, so it sits directly under the title, the one big
// bordered box around the results is gone and every result is a `<ListRow>`.
// Routes still come only from TRAINER_NAV; nothing is hardcoded here.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { ListRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { TRAINER_NAV, searchNav } from '../../src/lib/features';

export default function Explore() {
  const t = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const list = useMemo(() => searchNav(TRAINER_NAV, q), [q]);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Trainer portal</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Explore</Text>
          </View>
        </View>

        {/* ── the field is the screen ────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginTop: sp.lg, marginBottom: sp.sm }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={t.ink3} autoCapitalize="none"
            style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
        </View>

        {list.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Icon name="search" size={26} color={t.ink3} />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Nothing matches “{q}”.</Text>
          </View>
        ) : (
          <View>
            {list.map((h) => (
              <ListRow key={h.key} icon={h.icon} title={h.label} note={h.note} onPress={() => router.push(h.route as any)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
