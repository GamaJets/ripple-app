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
  const { log, status: logStatus } = useWorkoutLog();
  // Everything on this screen is inferred from the log, and an unread log infers
  // beautifully: no sessions means no fatigue, so `deloadCheck` comes back clear,
  // `restToday` comes back false, and the screen told a client who had trained
  // six days straight that they were "well recovered" with "room to train". That
  // is not a display bug — it is training advice manufactured out of a failed
  // read, on the one screen whose whole job is to tell someone to stop.
  const known = logStatus !== 'error';

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
  const tone = !known ? t.warn : dl.due ? t.s3 : restToday ? t.warn : t.brand;
  // "You are well recovered" was a claim this screen is not entitled to make.
  // Everything here is inferred from the TRAINING LOG: it knows how much you
  // have trained and nothing else. Home's Readiness is a different measure —
  // sleep, hydration and load together — so a person who had not trained but
  // had slept badly was told "well recovered" here and "under-recovered" there,
  // on the same morning. Both figures were right; the word was wrong.
  //
  // Narrowed to what the log can actually support: room to train, by volume.
  const headline = !known ? 'We couldn’t read your training log' : dl.due ? 'Time for a deload week' : restToday ? 'Take a rest day' : 'You have room to train';
  const body = !known
    ? 'This screen works entirely from what you have logged, and we could not read it. Nothing here is a judgement about your recovery — read it as blank, not as a green light to train.'
    : dl.due
    ? dl.reason
    : restToday
    ? `You've trained ${wk.days} of the last 7 days. A rest day now protects your progress and lowers injury risk.`
    : `${wk.days} training day${wk.days === 1 ? '' : 's'} this week — that is light by volume alone. This reads your training log only, not your sleep or hydration; Readiness on Home weighs those together.`;

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
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>When to Rest</Text>
          </View>
        </View>

        {/* ── the call, above the hero ────────────────────────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          <Notice tone={tone} kicker="Recovery" title={headline} note={body} />
        </View>

        {/* ── the hero: how loaded this week already is ───────────────────── */}
        <Hero
          label="Trained This Week"
          figure={known ? fig(wk.days) : fig(null)}
          unit={known ? (wk.days === 1 ? 'day' : 'days') : undefined}
          arc={known ? wk.days / 7 : undefined}
          tone={tone}
          note={known ? `${dl.hardWeeks} consecutive hard week${dl.hardWeeks === 1 ? '' : 's'} behind you` : 'Nothing read — an empty ring here is not an empty week.'}
        />

        <Rule />

        <Section>
          <SectionHead title="Load" />
          <KpiRow items={[
            { label: 'Hard weeks', value: known ? fig(dl.hardWeeks) : fig(null) },
            // `(0/1000).toFixed(1)` is "0.0" — a tonnage printed to one decimal
            // place, which reads as measured rather than as absent.
            { label: 'Volume this week', value: known ? (wk.volumeKg / 1000).toFixed(1) : fig(null), unit: known ? 't' : undefined },
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

        {/* TF-20 gave this screen somewhere to send people. It has always been
            able to say "take a rest day" or "time for a deload week" and then
            leave the client to remember it: the advice arrived on the day it was
            already too late to arrange. A rest day and a deload day are two of
            the four types the calendar now takes, so the recommendation above
            can be turned into a mark on a date.

            Worded as planning, and only as planning. Marking Thursday a rest day
            is not the same as having rested, and this screen — which reads the
            training log and nothing else — would be the last place that should
            blur the two. */}
        <Section>
          <SectionHead title="Plan it in" />
          <Text style={{ ...ty.body, color: t.ink2 }}>
            {dl.due
              ? 'A deload is a week, not a mood — mark the days on your calendar and the plan is there when you get to them.'
              : 'Pick the day now rather than deciding on the morning. Marking a rest day on your calendar records what you intend; what you actually do still comes from your training log.'}
          </Text>
          <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
            <Ghost label="Plan a Day" icon="calendar" onPress={() => router.push('/(client)/calendar')} />
          </View>
        </Section>

        <Rule />

        <Section>
          <Cta label="Open Recovery Tools" wide onPress={() => router.push('/(client)/recovery')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
