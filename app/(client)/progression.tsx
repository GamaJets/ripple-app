// Client · Progression. Auto-generated next-session targets from your logged
// lifts using double-progression (add load when you clear the top of the range,
// otherwise chase reps). Read-only guidance — you still log what you actually do.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: one bordered card per
// exercise (each with a second bordered box nested inside it) became hairline
// rows carrying a <KpiRow>, and the action tag no longer prints itself in a
// reserved status colour — the status is a coloured mark beside ink text.
// A list of equal-weight targets is a list, so this screen leads with no hero.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { suggestProgression, type ProgressAction } from '../../src/lib/progression';
import { Rule, Section, SectionHead, KpiRow, Notice, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';

const META: Record<ProgressAction, { label: string; icon: string; color: (t: any) => string }> = {
  increase: { label: 'Add load', icon: 'trending', color: (t) => t.brand },
  reps: { label: 'Chase reps', icon: 'plus', color: (t) => t.good ?? t.brand },
  hold: { label: 'Hold', icon: 'minus', color: (t) => t.warn },
  deload: { label: 'Ease back', icon: 'swap', color: (t) => t.crit },
};

export default function Progression() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus, reload } = useWorkoutLog();
  const tips = suggestProgression(log);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>From your logged lifts</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Next-session targets</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {/* This screen prescribes a load in kilograms, and every target is
            anchored to the most recent set it can see. With the read failed
            that anchor is either missing entirely — "log a few weighted sets",
            said to someone who has logged hundreds — or it is whatever this
            phone happened to be holding, which is not the same thing as the
            last set the client actually did. Both need saying before anyone
            loads a bar off the numbers below. */}
        {logStatus === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Targets" title="We couldn’t read your training log"
              note={tips.length
                ? 'The targets below come from what this phone had before the read failed, so they may not include your last session. Check them against what you actually lifted.'
                : 'Targets are worked out from your logged lifts, and we couldn’t read them. This is not a sign you haven’t lifted.'}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try again" wide onPress={reload} />
              </View>
            </Notice>
          </Section>
        ) : null}

        {tips.length === 0 ? (
          logStatus === 'error' ? null : logStatus === 'loading' ? (
            <Section>
              <Text style={{ ...ty.body, color: t.ink3 }}>Working out your targets…</Text>
            </Section>
          ) : (
          <Section>
            <SectionHead title="No targets yet" />
            <Text style={{ ...ty.body, color: t.ink2 }}>Log a few weighted sets and your progression targets will appear here.</Text>
            <View style={{ height: sp.lg }} />
            <View style={{ alignSelf: 'flex-start' }}>
              <Cta label="Log a workout" onPress={() => router.push('/(client)/workouts')} />
            </View>
          </Section>
          )
        ) : (
          <Section>
            <SectionHead title="Aim for these next time" note={`${tips.length} lift${tips.length === 1 ? '' : 's'}`} />
            {tips.map((tip, i) => {
              const m = META[tip.action];
              const c = m.color(t);
              const bump = tip.nextWeight - tip.lastWeight;
              return (
                <View key={tip.exercise} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={m.icon as any} size={17} color={c} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{tip.exercise}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Last: {tip.lastWeight}kg × {tip.lastReps}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
                      <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>{m.label}</Text>
                    </View>
                  </View>
                  <View style={{ height: sp.md }} />
                  <KpiRow items={[
                    {
                      label: 'Target load', value: fig(tip.nextWeight), unit: 'kg',
                      good: bump >= 0,
                      delta: bump !== 0 ? `${bump > 0 ? '+' : '−'}${Math.abs(bump)} kg` : 'same weight',
                    },
                    { label: 'Target reps', value: fig(tip.nextReps) },
                  ]} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{tip.rationale}</Text>
                </View>
              );
            })}
          </Section>
        )}

        {tips.length > 0 ? (<>
          <Rule />
          <Section>
            <Text style={{ ...ty.caption, color: t.ink3 }}>Double-progression: clear the top of the rep range on every working set, then the weight goes up and reps reset. These are guidance — log what you actually lift.</Text>
          </Section>
        </>) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
