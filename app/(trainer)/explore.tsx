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
import { Icon, type IconName } from '../../src/ui/Icon';
import { ListRow, PageHead, Section, IconPlate, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty } from '../../src/theme/scale';
import { TRAINER_NAV, searchNav } from '../../src/lib/features';

/** A plate colour per icon, following the meanings the app already spends
 *  these hues on: messages and people blue, the calendar purple, money and
 *  charts the accent, training orange, nutrition and wellbeing teal and pink.
 *  An icon not listed takes the accent. */
const ICON_TONE: Partial<Record<IconName, Tone>> = {
  message: 'blue', chat: 'blue', people: 'blue', me: 'blue',
  calendar: 'purple', clock: 'purple', video: 'purple', play: 'purple',
  dumbbell: 'orange', train: 'orange', flame: 'orange', trophy: 'amber', bell: 'amber',
  meals: 'teal', water: 'teal', heart: 'pink', sparkle: 'pink', palette: 'pink',
  settings: 'neutral', lock: 'neutral', info: 'neutral', search: 'neutral',
};

export default function Explore() {
  const t = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const list = useMemo(() => searchNav(TRAINER_NAV, q), [q]);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <PageHead title="Explore" subtitle="Trainer portal" />

        {/* ── the field is the screen ────────────────────────────────────── */}
        {/* The pill the board draws every search in — the same shape Clients
            and Meals take. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: 50, backgroundColor: t.surface, ...elevation.card, borderRadius: radius.pill, paddingHorizontal: sp.lg, marginTop: sp.lg, marginBottom: sp.sm }}>
          <Icon name="search" size={17} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={t.ink3} autoCapitalize="none" accessibilityLabel="Search" returnKeyType="search"
            style={{ flex: 1, ...ty.label, color: t.ink, paddingVertical: 0 }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
        </View>

        {list.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <IconPlate icon="search" tone="neutral" size={56} />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Nothing matches “{q}”.</Text>
          </View>
        ) : (
          // One card of toned rows. The colour is the ICON's, so the same
          // destination wears the same plate here as on Profile and Settings:
          // it names a kind of screen, and the title beside it names the screen.
          <Section style={{ marginTop: 0 }}>
            {list.map((h) => (
              <ListRow key={h.key} icon={h.icon} tone={ICON_TONE[h.icon] ?? 'brand'} title={h.label} note={h.note} onPress={() => router.push(h.route as any)} />
            ))}
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
