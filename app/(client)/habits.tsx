// Client · Daily Habits & Water (Phase 7). Check off habits and log water; the
// water goal auto-completes the water habit. Reachable from the profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, handler and accessibility role is preserved — the three
// bordered blocks became one hero figure and two hairline-separated sections.
//
// ── TF-31 ───────────────────────────────────────────────────────────────────
//
// The checklist is derived now (src/lib/checklist.ts), so it varies in length
// and can legitimately be empty. Two things on this screen assumed it could not
// be:
//
//   · `Math.round((doneCount / habits.length) * 100)` divided by zero and put
//     the result straight into the one big number on the screen: "NaN%", over
//     an arc drawn from NaN. donePercent returns null instead and the Hero
//     shows a dash, which is what `fig` is for.
//   · "0 of 0 habits done" over an empty list read as a day with nothing asked
//     of you. Under `status === 'error'` that is exactly the lie the provider's
//     header is about, so the empty state and the notice below say which of the
//     two it is before the client draws a conclusion about their own day.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useHabits } from '../../src/ui/habits';
import { donePercent } from '../../src/lib/checklist';

export default function Habits() {
  const t = useTheme();
  const router = useRouter();
  const h = useHabits();
  // null when there is nothing on the list. Not 0 — nought per cent is a claim
  // that the client did none of the things asked of them today.
  const pct = donePercent(h.doneCount, h.habits.length);
  const unknown = h.status === 'error';

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
          unit={pct == null ? undefined : '%'}
          arc={pct == null ? undefined : pct / 100}
          note={pct == null
            ? (unknown ? 'We could not load today’s list' : 'Nothing on today’s list yet')
            : `${h.doneCount} of ${h.habits.length} done`}
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
          <SectionHead title="Checklist" note={h.habits.length ? `${h.doneCount} done` : undefined} />

          {/* The list is built from this person's own plan and targets, which is
              the question TF-31 asked outright. Saying so costs one line and
              stops the next tester having to ask. */}
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            Built from your plan, your targets and anything your coach adds.
          </Text>

          {/* A refused read leaves rows off the list. Naming that is the whole
              point of `status` — an unticked (or absent) habit under 'error'
              means unknown, and the coach's dashboard reads the same rows. */}
          {unknown ? (
            <Notice tone={t.warn} kicker="Checklist" title="Some of today’s list is missing"
              note="We couldn’t read your targets or your ticks just now, so anything below may be short a line — and an empty circle here doesn’t mean you skipped it." />
          ) : null}

          {/* A target the app does not have is not a row. Where the client can
              go and supply it, the list says so instead of quietly shrinking. */}
          {h.gaps.map((g) => (
            <View key={g.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}>
              <View style={{ width: 24, height: 24, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring, borderStyle: 'dashed' }} />
              <Text style={{ flex: 1, ...ty.label, color: t.ink3 }}>{g.note}</Text>
            </View>
          ))}

          {h.habits.length === 0 && !unknown && h.gaps.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>
              Nothing on today’s list. Rest days and un-set targets both look like this — set a goal or ask your coach for one.
            </Text>
          ) : null}

          {h.habits.map((hb, hi) => (
            <View key={hb.id}>
              {hi > 0 || h.gaps.length ? <Rule /> : null}
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
                <Text style={{ ...ty.body, color: t.ink2 }}>{hb.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: hb.done ? t.ink : t.ink2 }}>{hb.label}</Text>
                  {/* Only the coach-set rows are attributed. "From your targets"
                      under a line that already reads "Hit 152 g protein" is
                      noise; "your coach asked for this" is not. */}
                  {hb.source === 'coach' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Set by your coach</Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
