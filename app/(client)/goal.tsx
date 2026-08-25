// Client · Goal Tracker. Set a target weight + date; see progress from your
// starting weight and a projection from your actual weekly trend. Profile hub.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): the
// bordered progress panel became a <Hero> (current weight, ring = progress)
// over a hairline-divided <KpiRow>, and the projection is a section rather
// than another box.
//
// Honesty fix: GoalTrackerProvider used to default every account to a 64 kg
// target nobody had chosen, so this screen opened showing "Target 64 kg", a
// filled progress bar and a projected finish date invented from it. The
// default is now 0 = not set, and the panel is gated on the client having both
// a target and at least one recorded weight.
import { useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useGoalTracker } from '../../src/ui/goalTracker';

export default function Goal() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { target, setTarget } = useGoalTracker();
  const [input, setInput] = useState('');

  const series = c.weightSeries;
  // 0 when there is no weight on record. Every figure derived from it is behind
  // `hasWeight` below, so the zero never reaches the screen — it just keeps the
  // arithmetic total.
  const current = c.weightKg ?? 0;
  const start = series.length ? series[0].v : current;
  const tgt = target.targetWeightKg;
  const hasTarget = tgt > 0;
  const hasWeight = series.length > 0;

  // Progress from start → target (works for loss or gain).
  const span = tgt - start;
  const done = current - start;
  const pct = span !== 0 ? Math.max(0, Math.min(100, Math.round((done / span) * 100))) : 0;
  const remaining = +(tgt - current).toFixed(1);

  // Trend projection: weekly rate from the weight series.
  let projection: string | null = null;
  if (series.length > 1 && hasTarget) {
    const first = series[0], last = series[series.length - 1];
    const days = (Date.parse(last.t) - Date.parse(first.t)) / 86400000;
    const weeklyRate = days > 0 ? (last.v - first.v) / (days / 7) : 0;
    if (weeklyRate !== 0 && Math.sign(tgt - current) === Math.sign(weeklyRate)) {
      const weeks = Math.abs((tgt - current) / weeklyRate);
      const eta = new Date(Date.now() + weeks * 7 * 86400000);
      projection = `At your current pace (${weeklyRate > 0 ? '+' : ''}${weeklyRate.toFixed(2)} kg/wk) you'll hit ${tgt} kg around ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    } else if (Math.abs(remaining) < 0.1) {
      projection = 'You’ve reached your target — set a new one!';
    } else {
      projection = 'Your recent trend isn’t moving toward this target yet. Keep going, or adjust the goal.';
    }
  }

  const targetDate = new Date(target.targetDateISO);
  const daysToDate = Math.round((targetDate.getTime() - Date.now()) / 86400000);

  const saveWeight = () => {
    const n = parseFloat(input);
    if (isNaN(n) || n <= 0) { Alert.alert('Enter a weight', 'Type your target weight in kg.'); return; }
    setTarget({ targetWeightKg: n });
    setInput('');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Progress</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Goal Tracker</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Your target weight & projected finish</Text>

        {hasTarget && hasWeight ? (
          <View>
            <Hero label="Now" figure={String(current)} unit="kg" arc={pct / 100}
              note={`${pct}% of the way · ${Math.abs(remaining)} kg to go`} />
            <Rule />
            <Section>
              <KpiRow items={[
                { label: 'Start', value: String(start), unit: 'kg' },
                { label: 'Target', value: String(tgt), unit: 'kg' },
                { label: 'Target date', value: targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), delta: daysToDate > 0 ? `${daysToDate} days` : 'passed', good: daysToDate > 0 },
              ]} />
            </Section>
          </View>
        ) : (
          <Section>
            <Text style={{ ...ty.body, color: t.ink3 }}>
              {!hasWeight
                ? 'No weigh-ins yet — log your weight in a check-in or a scan and your progress appears here.'
                : 'No target weight set yet. Set one below and this tracks the gap for you.'}
            </Text>
          </Section>
        )}

        {projection ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Projection" />
              <Text style={{ ...ty.body, color: t.ink2 }}>{projection}</Text>
            </Section>
          </View>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="Target weight" note="kg" />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <TextInput value={input} onChangeText={setInput} keyboardType="numeric" placeholder={hasTarget ? String(tgt) : 'kg'} placeholderTextColor={t.ink3} accessibilityLabel="Target weight in kilograms"
              style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
            <Cta label="Save" onPress={saveWeight} />
          </View>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Target date" />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {[['4 wks', 28], ['8 wks', 56], ['12 wks', 84], ['16 wks', 112]].map(([label, days]) => (
              <Pressable key={label as string} onPress={() => setTarget({ targetDateISO: new Date(Date.now() + (days as number) * 86400000).toISOString() })}
                style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center', backgroundColor: t.surface2 }}>
                <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{label as string}</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
