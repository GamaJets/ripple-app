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
import { Rule, Section, SectionHead, ListRow, PageHead } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';

const ORDER: FeatureArea[] = ['train', 'meals', 'progress', 'me'];

export default function Explore() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const [q, setQ] = useState('');

  const solo = cd.coachingMode === 'solo';
  const list = useMemo(() => {
    const base = CLIENT_FEATURES.filter((f) => !(solo && f.soloHide));
    return searchFeatures(base, q);
  }, [q, solo]);

  // ── what "Nothing matches" was saying, and why it was not true ───────────
  //
  // Five features carry `soloHide`, and a self-managed member never sees them:
  // Book a Session, Ask for a Time, Standing Appointments, Weekly Check-in and
  // Messages. That is right — they are all things you do WITH a coach, and a
  // member who has none cannot do any of them.
  //
  // What was wrong is what the screen then said. This is the app's only search,
  // and a solo member who typed "messages", or "book", or "check in", was told
  // "Nothing matches" — a sentence that asserts the feature does not exist. It
  // does exist; it is one coach away. So somebody who had been messaging a
  // coach last month, or who is deciding whether coaching is worth paying for,
  // was given a flatly false answer by the one screen whose whole job is
  // answering "does this app do X".
  //
  // The hidden set is searched SEPARATELY and named rather than shown. Listing
  // the rows would be worse than hiding them: tapping Messages with no coach
  // opens a thread with nobody in it. A sentence can say the true thing —
  // these exist, this is what they need — and the way to get one is one tap
  // from here, which is the answer the member was actually looking for.
  const hiddenHits = useMemo(
    () => (solo && q.trim() ? searchFeatures(CLIENT_FEATURES.filter((f) => f.soloHide), q) : []),
    [q, solo],
  );

  const grouped = ORDER
    .map((area) => ({ area, items: list.filter((f) => f.area === area) }))
    .filter((g) => g.items.length > 0);

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <PageHead title="Explore" subtitle="Everything, in two taps" />

        {/* ── the field is the screen ────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginTop: sp.lg }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search features…" placeholderTextColor={t.ink3} autoCapitalize="none"
            accessibilityLabel="Search features"
            style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
        </View>

        {grouped.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
            <Icon name="search" size={26} color={t.ink3} />
            {/* Only when there is genuinely nothing. A match in the hidden set
                is not nothing, and saying so would be the false answer. */}
            {hiddenHits.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Nothing matches “{q}”.</Text>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>
                Nothing you can open matches “{q}”.
              </Text>
            )}
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

        {/* Under the results rather than instead of them: one word can match
            both sets. "session" finds Sessions to Approve, which a solo member
            can open, and Book a Session, which they cannot. */}
        {hiddenHits.length ? (
          <View style={{ marginTop: sp.lg }}>
            <Rule />
            <Section>
              <SectionHead title="Needs a coach" />
              <Text style={{ ...ty.label, color: t.ink3 }}>
                {hiddenHits.map((f) => f.label).join(', ')} {hiddenHits.length === 1 ? 'is part of this app' : 'are part of this app'}, but {hiddenHits.length === 1 ? 'it is' : 'they are'} something you do with a coach. You are set to training yourself, so {hiddenHits.length === 1 ? 'it is' : 'they are'} hidden rather than missing.
              </Text>
              <ListRow icon="people" title="Find a Trainer" note="Have a code from your coach? Enter it here"
                onPress={() => router.push('/(client)/trainers')} />
            </Section>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
