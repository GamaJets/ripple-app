// Client · Rest & deload planner. Reads the training log to gauge fatigue and
// recommend rest days / a deload week, with simple recovery actions. Pure logic
// (deloadCheck + weekStats), OTA-safe.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, computation, conditional and route is preserved — the tone
// that used to colour a bordered headline card is now a Notice's mark, so the
// status colour never lands on the text itself.
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { deloadCheck } from '../../src/lib/training';
import { weekStats } from '../../src/lib/streaks';

export default function RestDay() {
  const t = useTheme();
  const router = useRouter();
  const { log } = useWorkoutLog();

  const info = useMemo(() => {
    const dl = deloadCheck(log);
    const wk = weekStats(log);
    const trainedToday = log.some((e) => new Date(e.t).toDateString() === new Date().toDateString());
    // Suggest a rest day if 3+ of the last 7 days trained and today already trained,
    // or if a deload is due.
    const restToday = dl.due || (wk.days >= 4 && trainedToday);
    return { dl, wk, trainedToday, restToday };
  }, [log]);

  const { dl, wk, restToday } = info;
  const tone = dl.due ? t.s3 : restToday ? t.warn : t.brand;
  const headline = dl.due ? 'Time for a deload week' : restToday ? 'Take a rest day' : 'You are well recovered';
  const body = dl.due
    ? dl.reason
    : restToday
    ? `You've trained ${wk.days} of the last 7 days. A rest day now protects your progress and lowers injury risk.`
    : `${wk.days} training day${wk.days === 1 ? '' : 's'} this week. You have room to train — keep listening to your body.`;

  const restActions = [
    { icon: 'water', label: 'Hydrate & refuel', note: 'Protein + carbs to rebuild.' },
    { icon: 'moon', label: 'Prioritise sleep', note: '7–9 hours is where you adapt.' },
    { icon: 'heart', label: 'Easy movement', note: 'A walk or light mobility, not a session.' },
  ] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What your log suggests</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Rest & deload</Text>
          </View>
        </View>

        {/* ── the call, above the hero ────────────────────────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          <Notice tone={tone} kicker="Recovery" title={headline} note={body} />
        </View>

        {/* ── the hero: how loaded this week already is ───────────────────── */}
        <Hero
          label="Trained this week"
          figure={fig(wk.days)}
          unit={wk.days === 1 ? 'day' : 'days'}
          arc={wk.days / 7}
          tone={tone}
          note={`${dl.hardWeeks} consecutive hard week${dl.hardWeeks === 1 ? '' : 's'} behind you`}
        />

        <Rule />

        <Section>
          <SectionHead title="Load" />
          <KpiRow items={[
            { label: 'Hard weeks', value: fig(dl.hardWeeks) },
            { label: 'Volume this week', value: (wk.volumeKg / 1000).toFixed(1), unit: 't' },
          ]} />
        </Section>

        {dl.due ? (<>
          <Rule />
          <Section>
            <SectionHead title="How to deload" />
            <Text style={{ ...ty.body, color: t.ink2 }}>Keep training, but cut volume to ~60%: fewer sets, or ~10% lighter weights, staying well shy of failure. One easier week lets fatigue clear so you come back stronger.</Text>
          </Section>
        </>) : null}

        <Rule />

        <Section>
          <SectionHead title="On a rest day" />
          {restActions.map((a, ai) => (
            <View key={a.label}>
              {ai > 0 ? <Rule /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <Icon name={a.icon} size={18} color={t.ink2} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{a.label}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{a.note}</Text>
                </View>
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        <Section>
          <Cta label="Open recovery tools" wide onPress={() => router.push('/(client)/recovery')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
