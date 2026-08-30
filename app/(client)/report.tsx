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
//
// TF-37: every figure here was printed with a hardcoded "kg" or "cm" — the
// tiles, the prose, and the fact list handed to the summariser, which is how a
// client reading pounds ended up being told in plain English that they were
// down three kilograms. Weight, muscle and the waist measurement now come out
// in the unit the account reads in. Body fat does not: it is a percentage, and
// a percentage does not have a unit system.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, lengthIn, lengthLabel, lengthDeltaIn, weightDeltaIn } from '../../src/lib/units';
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
  const st = useSettings();
  const wu = st.weightUnit;
  const lu = st.lengthUnit;

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
  // Both changes in the client's unit, each converted as a whole span rather
  // than as two endpoints rounded and then subtracted — 0.4 kg is 0.88 lb, and
  // rounding the two weigh-ins into pounds first can turn that into either
  // nothing or two pounds depending on where they sat inside the rounding.
  // Always finite here, so the null branch of weightDeltaIn is unreachable.
  const wDeltaShown = weightDeltaIn(wDelta, wu) ?? 0;
  const waistDShown = lengthDeltaIn(waistD, lu);

  const today = new Date();
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - 6);
  const range = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  const comp = compositionInsights(c.scans);
  const factLines = [
    `Trained ${wk.workouts} time(s) across ${wk.days} active day(s).`,
    `Volume ${(wk.volumeKg / 1000).toFixed(1)} tonnes, ~${wk.kcal} kcal.`,
    `Streak ${streak} day(s).`,
    // These lines are the summariser's only source of fact, so they carry the
    // client's own units: a model handed "82 kg" writes back "you're at 82 kg"
    // to somebody who has never used a kilogram in their life.
    hasBody ? [`Weight ${fig(weightLabel(c.weightKg, wu))} (${wDeltaShown > 0 ? '+' : ''}${wDeltaShown} ${wu} overall)`,
      c.bodyFatPct != null ? `body fat ${c.bodyFatPct}%` : null,
      c.muscleKg != null ? `muscle ${fig(weightLabel(c.muscleKg, wu))}` : null].filter(Boolean).join(', ') + '.' : '',
    waistDShown != null ? `Waist ${fig(lengthLabel(mLatest.waist, lu))} (${waistDShown > 0 ? '+' : ''}${waistDShown} ${lu}).` : '',
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
    // Gated on the CONVERTED change: a fifth of a kilogram is under half a
    // pound, and "your weight is down 0 lb" is worse than saying nothing.
    if (wDeltaShown !== 0) bits.push(`Weight is ${wDeltaShown > 0 ? 'up' : 'down'} ${Math.abs(wDeltaShown)} ${wu} overall${wDeltaShown <= 0 ? ', trending your way' : ''}.`);
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
    { label: 'Weight', value: fig(weightIn(c.weightKg, wu)), unit: wu, delta: wDeltaShown !== 0 ? `${wDeltaShown > 0 ? '+' : ''}${wDeltaShown} ${wu} overall` : 'no change', good: wDelta <= 0 },
    // hasBody only checks that a weight exists — a client can log a weight in a
    // check-in without ever having a scan, in which case body fat and muscle are
    // still unknown and used to print the 20% / 0 kg placeholders.
    { label: 'Body fat', value: c.bodyFatPct != null ? `${c.bodyFatPct}` : '—', unit: c.bodyFatPct != null ? '%' : undefined },
    { label: 'Muscle', value: fig(weightIn(c.muscleKg, wu)), unit: c.muscleKg != null ? wu : undefined },
    ...(waistDShown != null ? [{ label: 'Waist', value: fig(lengthIn(mLatest.waist, lu)), unit: lu, delta: `${waistDShown > 0 ? '+' : ''}${waistDShown} ${lu}`, good: waistD != null && waistD <= 0 }] : []),
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
            // Volume stays in tonnes for every client. It is the one figure on
            // this screen with no imperial counterpart worth printing: the
            // choices are 27,558 lb, which nobody reads, or short tons, a unit
            // src/lib/units.ts does not define and which differs from a tonne
            // by 10% — close enough to be mistaken for the same number and
            // wrong enough to matter. A tonne of bar work is understood.
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
          <Cta label="Share My Progress" onPress={() => router.push('/(client)/social')} wide />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
