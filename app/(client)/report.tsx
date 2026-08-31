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
import { num } from '../../src/lib/format';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, lengthIn, lengthLabel, lengthDeltaIn, weightDeltaIn } from '../../src/lib/units';
import { deltaLabel, deltaMoved, movementIsProgress } from '../../src/lib/deltaLabel';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useMeasurements } from '../../src/ui/measurements';
import { useCheckIns } from '../../src/ui/checkins';
import { currentStreak, weekStats, personalRecords, streakMilestone } from '../../src/lib/streaks';
import { useState, useEffect } from 'react';
import { askCoach, coachAvailable } from '../../src/lib/coach';
import { compositionInsights } from '../../src/lib/inbodyMetrics';
import { isWhole } from '../../src/ui/loadStatus';

export default function WeeklyReport() {
  const t = useTheme();
  const router = useRouter();
  // Four providers, every one of which reports a LoadStatus, and this screen
  // read none of them.
  //
  // It is the worst place in the client app for that, because the figures do
  // not stop at the screen: `factLines` below is the ONLY source of fact handed
  // to the summariser, and the model writes it back to the member in the second
  // person. So a failed workout read produced, in warm prose signed by their
  // coach's app, "No logged workouts this week — a fresh chance to get one on
  // the board" to somebody who trained four times. And a failed scan read
  // produced "No weigh-ins or scans yet" under the heading Body.
  //
  // Every figure here is a weekly or lifetime aggregate, so the gate is
  // `isWhole` throughout: 'partial' is a prefix and 'loading' is nothing yet.
  const c = useClientData();
  const { log, status: logStatus } = useWorkoutLog();
  const { entries, status: mStatus } = useMeasurements();
  // `latestSent`, not `latest`. A weekly report is a summary of what the coach
  // can see, and `latest` may be a check-in still sitting on this phone with no
  // signal — reporting it as part of the record would tell the client their
  // coach has read something nobody has sent.
  const { latestSent: checkIn, status: ciStatus } = useCheckIns();
  const trainingWhole = isWhole(logStatus);
  const bodyWhole = isWhole(c.status);
  const mWhole = isWhole(mStatus);
  // What the report as a whole can stand behind. A weekly summary assembled
  // from four reads is only as complete as its worst one, and the narrative
  // draws on all four at once.
  const reportWhole = trainingWhole && bodyWhole && mWhole && isWhole(ciStatus);
  const st = useSettings();
  const wu = st.weightUnit;
  const lu = st.lengthUnit;

  const wk = weekStats(log);
  const streak = currentStreak(log);
  const milestone = streakMilestone(streak);
  const prs = personalRecords(log);

  const wSeries = c.weightSeries;
  const wDelta = wSeries.length > 1 ? +(wSeries[wSeries.length - 1].v - wSeries[0].v).toFixed(1) : 0;
  // Only report a body if the client has actually recorded one — AND if we were
  // able to read what they recorded. An empty `weightSeries` under a failed
  // profile read is not a client who has never been weighed.
  const hasBody = bodyWhole && wSeries.length > 0;

  const mLatest = mWhole ? entries[0] : undefined;
  const mPrev = mWhole ? entries[1] : undefined;
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

  const comp = compositionInsights(isWhole(c.scansStatus) ? c.scans : []);
  // Facts only. A line built from a read that did not land whole is not a
  // weaker fact, it is a false one — and this list is the model's only input,
  // so anything left out of it simply is not spoken about, which is the
  // outcome we want.
  const factLines = [
    trainingWhole ? `Trained ${wk.workouts} time(s) across ${wk.days} active day(s).` : '',
    trainingWhole ? `Volume ${(wk.volumeKg / 1000).toFixed(1)} tonnes, ~${num(wk.kcal)} kcal.` : '',
    trainingWhole ? `Streak ${streak} day(s).` : '',
    // Said to the model in as many words, so it does not fill the silence with
    // a guess about a quiet week.
    trainingWhole ? '' : 'Their training log could not be read this week. Do not say they did not train, do not mention a streak, and do not comment on volume.',
    // These lines are the summariser's only source of fact, so they carry the
    // client's own units: a model handed "82 kg" writes back "you're at 82 kg"
    // to somebody who has never used a kilogram in their life.
    // Through deltaLabel: an unchanged weight used to be stated to the model as
    // "(0 kg overall)", which is a change of zero rather than the absence of
    // one, and the model writes back about it as though something happened.
    hasBody ? [`Weight ${fig(weightLabel(c.weightKg, wu))} (${deltaLabel(wDeltaShown, { since: null, unit: wu, noChange: 'no change' })} overall)`,
      c.bodyFatPct != null ? `body fat ${c.bodyFatPct}%` : null,
      c.muscleKg != null ? `muscle ${fig(weightLabel(c.muscleKg, wu))}` : null].filter(Boolean).join(', ') + '.' : '',
    waistDShown != null && mLatest ? `Waist ${fig(lengthLabel(mLatest.waist, lu))} (${deltaLabel(waistDShown, { since: null, unit: lu, noChange: 'no change' })} since the previous tape reading).` : '',
    checkIn ? `Check-in energy ${checkIn.energy}/5, sleep ${checkIn.sleep}/5, mood ${checkIn.mood}/5, adherence ${checkIn.adherence}/5.` : '',
    comp.improving.length ? `Body composition improving: ${comp.improving.join(', ')}.` : '',
    comp.watch.length ? `Body composition to watch: ${comp.watch.join(', ')}.` : '',
    comp.balance.length ? comp.balance.join(' ') : '',
  ].filter(Boolean);
  const fallbackNarrative = (() => {
    const bits: string[] = [];
    // "No logged workouts this week" was printed for a failed read as readily
    // as for a quiet week, and it is the sentence a member is most likely to
    // believe and least able to check.
    if (!trainingWhole) bits.push(logStatus === 'loading'
      ? 'Reading your week…'
      : 'We could not read your training this week, so this summary leaves it out. It is not a week with nothing in it.');
    else if (wk.workouts > 0) bits.push(`You trained ${wk.workouts} time${wk.workouts === 1 ? '' : 's'} over ${wk.days} day${wk.days === 1 ? '' : 's'}, moving ${(wk.volumeKg / 1000).toFixed(1)} tonnes of volume.`);
    else bits.push('No logged workouts this week — a fresh chance to get one on the board.');
    if (trainingWhole && streak > 0) bits.push(`Your streak is at ${streak} day${streak === 1 ? '' : 's'} — keep it alive.`);
    // Gated on the CONVERTED change: a fifth of a kilogram is under half a
    // pound, and "your weight is down 0 lb" is worse than saying nothing.
    // ", trending your way" was appended to every downward move. It is the one
    // clause here that makes a judgement rather than a statement, and it made
    // the same one for a member training to gain as for a member training to
    // lose — congratulating somebody for moving away from their own goal. It is
    // now asked of their goal, and left off entirely where the goal has no
    // opinion.
    if (bodyWhole && deltaMoved(wDeltaShown)) bits.push(`Weight is ${wDeltaShown > 0 ? 'up' : 'down'} ${Math.abs(wDeltaShown)} ${wu} overall${movementIsProgress(wDeltaShown, c.goal, 'weight') ? ', trending your way' : ''}.`);
    if (comp.improving.length) bits.push(`On composition, ${comp.improving.slice(0, 2).join(' and ')} moved the right way.`);
    else if (comp.watch.length) bits.push(`Keep an eye on ${comp.watch.slice(0, 2).join(' and ')} from your latest scan.`);
    if (isWhole(ciStatus) && checkIn && checkIn.adherence <= 3) bits.push(`Your last check-in put adherence at ${checkIn.adherence}/5 — worth refocusing next week.`);
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
    // `good: wDelta <= 0` said that down is better whoever is reading it. A
    // member training to Build Muscle was shown the accent dot — this row's
    // "well done" — for losing the weight they are working to put on.
    { label: 'Weight', value: fig(weightIn(c.weightKg, wu)), unit: wu, delta: deltaMoved(wDeltaShown) ? `${deltaLabel(wDeltaShown, { since: null, unit: wu })} overall` : 'no change', good: movementIsProgress(wDeltaShown, c.goal, 'weight') },
    // hasBody only checks that a weight exists — a client can log a weight in a
    // check-in without ever having a scan, in which case body fat and muscle are
    // still unknown and used to print the 20% / 0 kg placeholders.
    { label: 'Body Fat', value: c.bodyFatPct != null ? `${c.bodyFatPct}` : '—', unit: c.bodyFatPct != null ? '%' : undefined },
    { label: 'Muscle', value: fig(weightIn(c.muscleKg, wu)), unit: c.muscleKg != null ? wu : undefined },
    ...(waistDShown != null && mLatest ? [{ label: 'Waist', value: fig(lengthIn(mLatest.waist, lu)), unit: lu, delta: deltaMoved(waistDShown) ? deltaLabel(waistDShown, { since: null, unit: lu }) : 'no change', good: movementIsProgress(waistDShown, c.goal, 'girth') }] : []),
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

        {/* The whole hero is a count over the week's log. A dash and a
            sentence, not a zero — "Trained This Week: 0" is the single most
            demoralising thing this app can put in front of somebody who did. */}
        <Hero label="Trained This Week" figure={trainingWhole ? fig(wk.workouts) : fig(null)}
          unit={trainingWhole ? (wk.workouts === 1 ? 'session' : 'sessions') : undefined}
          note={trainingWhole
            ? `${wk.days} active day${wk.days === 1 ? '' : 's'}${streak > 0 ? ` · ${streak}-day streak` : ''}`
            : logStatus === 'loading' ? 'Reading your training log…'
            : logStatus === 'partial' ? 'More logged than this screen can read in one go, so a week counted from it would be short.'
            : 'We couldn’t read your training log. This is not a week with nothing in it.'} />

        <Rule />

        <Section>
          <SectionHead title="Training" />
          <KpiRow items={trainingWhole ? [
            // Volume stays in tonnes for every client. It is the one figure on
            // this screen with no imperial counterpart worth printing: the
            // choices are 27,558 lb, which nobody reads, or short tons, a unit
            // src/lib/units.ts does not define and which differs from a tonne
            // by 10% — close enough to be mistaken for the same number and
            // wrong enough to matter. A tonne of bar work is understood.
            { label: 'Volume', value: `${(wk.volumeKg / 1000).toFixed(1)}`, unit: 't', delta: `${wk.kcal.toLocaleString()} kcal` },
            { label: 'Streak', value: `${streak}`, unit: streak === 1 ? 'day' : 'days', delta: streak > 0 ? 'running' : 'not started', good: streak > 0 },
            { label: 'PRs on Record', value: fig(prs.length), delta: 'all-time' },
          ] : [
            { label: 'Volume', value: fig(null), unit: 't' },
            { label: 'Streak', value: fig(null) },
            { label: 'PRs on Record', value: fig(null), delta: 'not read' },
          ]} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Body" />
          {hasBody ? (
            <KpiRow items={bodyItems} />
          ) : (
            // "No weigh-ins or scans yet" is a claim about the member's record,
            // and `hasBody` is false equally when the profile read failed.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {c.status === 'loading' ? 'Reading your measurements…'
                : !bodyWhole ? 'We couldn’t read your weigh-ins and scans, so there is nothing to report here. They are on your record.'
                : 'No weigh-ins or scans yet — log one and this fills in.'}
            </Text>
          )}
        </Section>

        {narrative ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Your week in a nutshell" note={reportWhole ? undefined : 'from what loaded'} />
              <Text style={{ ...ty.body, color: t.ink2 }}>{narrative}</Text>
            </Section>
          </View>
        ) : null}

        {checkIn ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Latest Check-in" />
              <Text style={{ ...ty.body, color: t.ink2 }}>Energy {checkIn.energy}/5 · Sleep {checkIn.sleep}/5 · Mood {checkIn.mood}/5 · Adherence {checkIn.adherence}/5</Text>
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
