// Client · Daily Habits & Water (Phase 7). Check off habits and log water; the
// water goal auto-completes the water habit. Reachable from the profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, handler and accessibility role is preserved — the three
// bordered blocks became one hero figure and two hairline-separated sections.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useHabits } from '../../src/ui/habits';

export default function Habits() {
  const t = useTheme();
  const router = useRouter();
  const h = useHabits();
  const pct = Math.round((h.doneCount / h.habits.length) * 100);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Small wins, every day</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Daily habits</Text>
          </View>
        </View>

        {/* ── the hero: today, in one number ──────────────────────────────── */}
        <Hero
          label="Today's progress"
          figure={fig(pct)}
          unit="%"
          arc={pct / 100}
          note={`${h.doneCount} of ${h.habits.length} habits done`}
        />

        <Rule />

        {/* ── water ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Water" note={`${h.water} / ${h.waterGoal} glasses`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.lg }}>
            {Array.from({ length: h.waterGoal }).map((_, i) => (
              <View key={i} style={{ width: 24, height: 32, borderRadius: radius.sm, borderWidth: hairline, borderColor: i < h.water ? t.brand : t.ring, backgroundColor: i < h.water ? t.brand : 'transparent', opacity: i < h.water ? 0.9 : 1 }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
            <Pressable accessibilityLabel="Remove a glass of water" accessibilityRole="button" onPress={h.removeWater}
              style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="minus" size={16} color={t.ink2} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Cta label="Add a glass" wide onPress={h.addWater} />
            </View>
          </View>
        </Section>

        <Rule />

        {/* ── checklist ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Checklist" note={`${h.doneCount} done`} />
          {h.habits.map((hb, hi) => (
            <View key={hb.id}>
              {hi > 0 ? <Rule /> : null}
              <Pressable
                onPress={() => h.toggleHabit(hb.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hb.done }}
                accessibilityLabel={hb.label}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
              >
                <View style={{ width: 24, height: 24, borderRadius: radius.pill, borderWidth: hb.done ? 0 : hairline, borderColor: t.ring, backgroundColor: hb.done ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {hb.done ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                </View>
                <Text style={{ flex: 1, ...ty.body, fontWeight: '500', color: hb.done ? t.ink : t.ink2 }}>{hb.label}</Text>
              </Pressable>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
