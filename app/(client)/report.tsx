// Client · Weekly Report. A shareable summary that pulls the week together —
// training volume & streak, weight change, and measurement change — from the
// existing reactive stores. Read-only; reached from the profile hub.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): the grid
// of eight bordered metric tiles became one <Hero> (the week's sessions) plus
// hairline-divided <KpiRow>s, and the milestone banner became a <Notice>.
//
// Honesty fix: the Body block used to print `weightKg` / `bodyFatPct` /
// `muscleKg` unconditionally. With no scan and no logged weigh-in those read
// 70 kg / 20% / 0 kg — the placeholder fallbacks inside ClientDataProvider,
// rendered as if they were the client's measurements, and fed to the AI
// summariser as fact. The block (and its fact line) is now gated on the client
// actually having a weight series, with an honest empty state instead.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useMeasurements } from '../../src/ui/measurements';
import { useCheckIns } from '../../src/ui/checkins';
import { currentStreak, weekStats, personalRecords, streakMilestone } from '../../src/lib/streaks';
import { useState, useEffect } from 'react';
import { askCoach, coachAvailable } from '../../src/lib/coach';
import { compositionInsights } from '../../src/lib/inbodyMetrics';

export default function WeeklyReport() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log } = useWorkoutLog();
  const { entries } = useMeasurements();
  const { latest: checkIn } = useCheckIns();

  const wk = weekStats(log);
  const streak = currentStreak(log);
  const milestone = streakMilestone(streak);
  const prs = personalRecords(log);

  const wSeries = c.weightSeries;
  const wDelta = wSeries.length > 1 ? +(wSeries[wSeries.length - 1].v - wSeries[0].v).toFixed(1) : 0;
  // Only report a body if the client has actually recorded one.
  const hasBody = wSeries.length > 0;

  const mLatest = entries[0];
  const mPrev = entries[1];
  const waistD = mLatest && mPrev && mLatest.waist != null && mPrev.waist != null ? +(mLatest.waist - mPrev.waist).toFixed(1) : null;

  const today = new Date();
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - 6);
  const range = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  const comp = compositionInsights(c.scans);
  const factLines = [
    `Trained ${wk.workouts} time(s) across ${wk.days} active day(s).`,
    `Volume ${(wk.volumeKg / 1000).toFixed(1)} tonnes, ~${wk.kcal} kcal.`,
    `Streak ${streak} day(s).`,
    hasBody ? [`Weight ${c.weightKg} kg (${wDelta > 0 ? '+' : ''}${wDelta} kg overall)`,
      c.bodyFatPct != null ? `body fat ${c.bodyFatPct}%` : null,
      c.muscleKg != null ? `muscle ${c.muscleKg} kg` : null].filter(Boolean).join(', ') + '.' : '',
    waistD != null ? `Waist ${mLatest.waist} cm (${waistD > 0 ? '+' : ''}${waistD} cm).` : '',
    checkIn ? `Check-in energy ${checkIn.energy}/5, sleep ${checkIn.sleep}/5, mood ${checkIn.mood}/5, adherence ${checkIn.adherence}/5.` : '',
    comp.improving.length ? `Body composition improving: ${comp.improving.join(', ')}.` : '',
    comp.watch.length ? `Body composition to watch: ${comp.watch.join(', ')}.` : '',
    comp.balance.length ? comp.balance.join(' ') : '',
  ].filter(Boolean);
  const fallbackNarrative = (() => {
    const bits: string[] = [];
    if (wk.workouts > 0) bits.push(`You trained ${wk.workouts} time${wk.workouts === 1 ? '' : 's'} over ${wk.days} day${wk.days === 1 ? '' : 's'}, moving ${(wk.volumeKg / 1000).toFixed(1)} tonnes of volume.`);
    else bits.push('No logged workouts this week — a fresh chance to get one on the board.');
    if (streak > 0) bits.push(`Your streak is at ${streak} day${streak === 1 ? '' : 's'} — keep it alive.`);
    if (wDelta !== 0) bits.push(`Weight is ${wDelta > 0 ? 'up' : 'down'} ${Math.abs(wDelta)} kg overall${wDelta <= 0 ? ', trending your way' : ''}.`);
    if (comp.improving.length) bits.push(`On composition, ${comp.improving.slice(0, 2).join(' and ')} moved the right way.`);
    else if (comp.watch.length) bits.push(`Keep an eye on ${comp.watch.slice(0, 2).join(' and ')} from your latest scan.`);
    if (checkIn && checkIn.adherence <= 3) bits.push(`Your last check-in put adherence at ${checkIn.adherence}/5 — worth refocusing next week.`);
    return bits.join(' ');
  })();
  const [narrative, setNarrative] = useState(fallbackNarrative);
  useEffect(() => {
    let alive = true;
    setNarrative(fallbackNarrative);
    if (!coachAvailable()) return;
    (async () => {
      const reply = await askCoach(
        [{ role: 'user', content: 'Write a warm, concise 2-3 sentence weekly summary for this client from the facts below. Speak directly to them ("you"), name the biggest win and one focus for next week. No preamble, no lists.\n\n' + factLines.join('\n') }],
        { week: range, name: c.name }
      );
      if (alive && reply && reply.trim()) setNarrative(reply.trim());
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wk.workouts, wk.days, streak, wDelta, range]);

  const bodyItems = [
    { label: 'Weight', value: `${c.weightKg}`, unit: 'kg', delta: wDelta !== 0 ? `${wDelta > 0 ? '+' : ''}${wDelta} kg overall` : 'no change', good: wDelta <= 0 },
    // hasBody only checks that a weight exists — a client can log a weight in a
    // check-in without ever having a scan, in which case body fat and muscle are
    // still unknown and used to print the 20% / 0 kg placeholders.
    { label: 'Body fat', value: c.bodyFatPct != null ? `${c.bodyFatPct}` : '—', unit: c.bodyFatPct != null ? '%' : undefined },
    { label: 'Muscle', value: c.muscleKg != null ? `${c.muscleKg}` : '—', unit: c.muscleKg != null ? 'kg' : undefined },
    ...(waistD != null ? [{ label: 'Waist', value: `${mLatest.waist}`, unit: 'cm', delta: `${waistD > 0 ? '+' : ''}${waistD} cm`, good: waistD <= 0 }] : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{c.name ? `${c.name.split(' ')[0]} · ${range}` : range}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Weekly Report</Text>
          </View>
        </View>

        {milestone ? (
          <View style={{ marginTop: sp.lg }}>
            <Notice kicker="Milestone" title={milestone} />
          </View>
        ) : null}

        <Hero label="Trained this week" figure={fig(wk.workouts)} unit={wk.workouts === 1 ? 'session' : 'sessions'}
          note={`${wk.days} active day${wk.days === 1 ? '' : 's'}${streak > 0 ? ` · ${streak}-day streak` : ''}`} />

        <Rule />

        <Section>
          <SectionHead title="Training" />
          <KpiRow items={[
            { label: 'Volume', value: `${(wk.volumeKg / 1000).toFixed(1)}`, unit: 't', delta: `${wk.kcal.toLocaleString()} kcal` },
            { label: 'Streak', value: `${streak}`, unit: streak === 1 ? 'day' : 'days', delta: streak > 0 ? 'running' : 'not started', good: streak > 0 },
            { label: 'PRs on record', value: fig(prs.length), delta: 'all-time' },
          ]} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Body" />
          {hasBody ? (
            <KpiRow items={bodyItems} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>No weigh-ins or scans yet — log one and this fills in.</Text>
          )}
        </Section>

        {narrative ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Your week in a nutshell" />
              <Text style={{ ...ty.body, color: t.ink2 }}>{narrative}</Text>
            </Section>
          </View>
        ) : null}

        {checkIn ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Latest check-in" />
              <Text style={{ ...ty.body, color: t.ink2 }}>Energy {checkIn.energy}/5 · sleep {checkIn.sleep}/5 · mood {checkIn.mood}/5 · adherence {checkIn.adherence}/5</Text>
              {checkIn.note ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, fontStyle: 'italic' }}>“{checkIn.note}”</Text> : null}
            </Section>
          </View>
        ) : null}

        <Rule />

        <View style={{ marginTop: layout.section }}>
          <Cta label="Share my progress" onPress={() => router.push('/(client)/social')} wide />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
