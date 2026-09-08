// Client · Rest & deload planner. Reads the training log to gauge fatigue and
// recommend rest days / a deload week, with simple recovery actions. Pure logic
// (deloadCheck + weekStats + restAdvice), OTA-safe.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, computation, conditional and route is preserved — the tone
// that used to colour a bordered headline card is now a Notice's mark, so the
// status colour never lands on the text itself.
//
// ── The recovery data this screen had and never looked at ─────────────────
//
// Everything below used to be inferred from the training log and nothing else,
// which is a count of sessions. `src/ui/readiness.ts` is the one derivation the
// home screen, the AI coach and the Recovery screen all read their readiness
// from — sleep, the device's own recovery verdict, hydration and short-term
// load, gated correctly at every step — and the screen whose entire job is to
// say "stop" was the only screen in the client app that never called it. A
// member three nights into four hours' sleep who had trained twice this week
// was told they had room to train, on a screen holding a figure that said
// otherwise.
//
// `restAdvice` in src/lib/restAdvice.ts is where the two are folded together,
// and its header carries the argument, including the three words that are still
// refused here: this screen does not say "recovered", "ready" or "fresh" about
// a body, and it prints neither `readiness.label` ('Well Recovered') nor
// `readiness.tip` ('Great day to push') for that reason. It says what was
// measured, over how many nights, and — when there is no figure — which of the
// four silences it is.
import { useMemo, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Flag, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { deloadCheck } from '../../src/lib/training';
import { weekStats, thisWeekStats } from '../../src/lib/streaks';
import { volumeHeadline } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { useToday } from '../../src/ui/today';
import { dayKeyOf } from '../../src/lib/entryEdit';
import { BACK_ICON, END_ALIGN } from '../../src/ui/direction';
// The shared readiness derivation, never a fourth hand-rolled copy of it. Three
// screens assembled this out of five providers and drifted from each other in
// two separate ways that shipped; see the header of src/ui/readiness.ts.
import { useReadiness, READINESS_NIGHTS } from '../../src/ui/readiness';
import { readinessMadeOf } from '../../src/lib/readiness';
import { restAdvice, restReadinessRead } from '../../src/lib/restAdvice';
import { useWearables } from '../../src/ui/wearables';
import { useDeviceSleep } from '../../src/ui/deviceSleep';
import { useWellness } from '../../src/ui/wellness';
import { useHabits } from '../../src/ui/habits';
import { connectedProviders } from '../../src/lib/wearables/sleep';

export default function RestDay() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  // Whether today is a rest day, and what was trained around it, is read off
  // the training log. It is no longer the ONLY server read behind this screen:
  // readiness below draws on device sleep, the typed sleep log, the water count
  // and the wearable roll-up, and the pull gesture has to move all of them.
  //
  // app/(client)/dashboard.tsx states why in as many words: "A home screen that
  // refreshes a third of itself under one gesture is worse than one that
  // refreshes nothing, because the parts that did not move now look confirmed."
  // A rest-day screen that refreshed the log and left a stale readiness figure
  // beside it would be that failure on the screen it costs most.
  const wearables = useWearables();
  const deviceSleep = useDeviceSleep();
  const { reload: reloadWellness } = useWellness();
  const { reload: reloadHabits } = useHabits();
  const pull = usePullToRefresh(useCallback(() => {
    reloadLog(); deviceSleep.refresh(); reloadWellness(); reloadHabits(); wearables.syncAll();
  }, [reloadLog, deviceSleep, reloadWellness, reloadHabits, wearables]));
  // The log half of this screen is inferred from the log, and an unread log
  // infers beautifully: no sessions means no fatigue, so `deloadCheck` comes
  // back clear, the rest rule comes back false, and the screen told a client who
  // had trained six days straight that they were "well recovered" with "room to
  // train". That is not a display bug — it is training advice manufactured out
  // of a failed read, on the one screen whose whole job is to tell someone to
  // stop. It is also the standing argument for the readiness block further down:
  // a screen that will invent an answer out of one absent read is a screen that
  // should be looking at every measurement it has, and this one had a readiness
  // figure available the whole time and never asked for it.
  // `isWhole`, so 'partial' and 'loading' are both excluded. This screen tells
  // somebody whether to train today, and both of those states make it invent
  // the answer: a truncated read (src/lib/rowCap.ts) hands `deloadCheck` a
  // prefix and it counts consecutive hard weeks over a window that has a wall
  // at the far end, and 'loading' printed "You have room to train — 0 training
  // days this week" on the first frame, before anything had been read at all.
  const known = isWhole(logStatus);
  const wu = useSettings().weightUnit;

  // The clock is a DEPENDENCY, not a value captured at mount. This is the one
  // screen in the app whose entire output answers "should I train today", and
  // the memo below had `[log]` alone — so a phone left on it, or backgrounded
  // and resumed the next morning, went on saying "take a rest day, you've
  // trained 5 of the last 7 days" on a day the member had not trained at all.
  // It was answering yesterday's question. `useToday` re-reads at the next
  // local midnight and on every return to the foreground.
  const today = useToday();

  const info = useMemo(() => {
    const dl = deloadCheck(log);
    // ── two windows, because there are two questions ──────────────────
    //
    // `wk` is a ROLLING seven days and stays that way: the rest suggestion
    // below asks "how much have you done lately", and lately does not reset on
    // a Sunday — a member who trained Thursday, Friday and Saturday is as tired
    // on Sunday morning as they were on Saturday night, and a window that
    // emptied at midnight would tell them to go again.
    //
    // `cal` is the CALENDAR week, and it is what the "Volume This Week" figure
    // below is captioned as. That figure was coming off `wk`, so it silently
    // included work from the previous week and disagreed with the same phrase
    // on Home, This Week and Trends. See src/lib/weekStart.ts.
    const wk = weekStats(log);
    const cal = thisWeekStats(log);
    // Compared as local day KEYS rather than through `toDateString`, so the
    // day being asked about is the day the member is actually in.
    const trainedToday = log.some((e) => dayKeyOf(e.t) === today);
    return { dl, wk, cal, trainedToday };
  }, [log, today]);

  const { dl, wk, cal, trainedToday } = info;
  // Tonnes for a metric reader, pounds for an imperial one. See volumeHeadline.
  // Off `cal`, the calendar week, because the label under it says "This Week".
  // The rest suggestion above still reads `wk`, which is the rolling window it
  // was written for.
  const vol = volumeHeadline(cal.volumeKg, wu);

  // ── the recovery half ────────────────────────────────────────────────────
  //
  // Read, never recomputed. `useReadiness` already applies every gate this
  // screen would otherwise have to reimplement — device nights before typed
  // ones, a null training load rather than a zero, `isWhole` on the water read
  // — and two of those gates have shipped as bugs on one screen while being
  // correct on another. A fourth hand-rolled copy here would be the fourth
  // chance to disagree about one number.
  const rv = useReadiness();
  // Whether a watch is connected at all, and NULL until the provider has
  // looked. `states` is empty on the first frames, and reading that emptiness
  // as "no device is connected" is the defect src/ui/wearables.tsx records: it
  // told a client with a live WHOOP token exactly that. The two sentences at
  // stake here are "nothing is connected" and "your device has recorded
  // nothing yet", and saying either one wrongly invents a fault or a device.
  const deviceKnown = Object.keys(wearables.states).length > 0;
  const deviceConnected = deviceKnown ? connectedProviders(wearables.states).length > 0 : null;
  const read = restReadinessRead({
    score: rv.readiness?.score ?? null,
    nights: rv.sleep.nights.length,
    windowNights: READINESS_NIGHTS,
    status: rv.breakdown.status,
    absence: rv.breakdown.absence,
    madeOf: rv.readiness ? readinessMadeOf(rv.readiness) : '',
    deviceConnected,
    logStatus,
  });

  // "You are well recovered" was a claim this screen is not entitled to make,
  // and it still is not. What changed is the OTHER half of that sentence: the
  // screen used to add "this reads your training log only, not your sleep or
  // hydration; Readiness on Home weighs those together" — which was true, and
  // was a screen telling a member that the figure which would have answered
  // their question lives somewhere else. It is now weighed here, by the same
  // derivation Home uses, and the words below are still the log's and the
  // measurement's rather than a verdict on a body. See src/lib/restAdvice.ts.
  const advice = restAdvice({
    logStatus,
    deloadDue: dl.due,
    deloadReason: dl.reason,
    weekDays: wk.days,
    trainedToday,
    readiness: read,
  });
  const { headline, body } = advice;
  const tone = advice.call === 'unknown' ? t.warn
    : advice.call === 'deload' ? t.s3
    : advice.call === 'rest' ? t.warn
    : t.brand;

  const restActions = [
    { icon: 'water', label: 'Hydrate & Refuel', note: 'Protein + carbs to rebuild.' },
    { icon: 'moon', label: 'Prioritise Sleep', note: '7–9 hours is where you adapt.' },
    { icon: 'heart', label: 'Easy Movement', note: 'A walk or light mobility, not a session.' },
  ] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            {/* Not "What your log suggests" any more, because it is no longer
                only the log. The kicker is the first thing a member reads and
                it has to describe the evidence the sentence below it was
                actually built from. */}
            <Text style={{ ...ty.micro, color: t.ink3 }}>What your log and your nights suggest</Text>
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
          arcLabel="of the week trained"
          tone={tone}
          note={known ? `${dl.hardWeeks} consecutive hard week${dl.hardWeeks === 1 ? '' : 's'} behind you` : logStatus === 'loading' ? 'Still reading — an empty ring here is not an empty week.' : 'Nothing this screen can count — an empty ring here is not an empty week.'}
        />

        <Rule />

        <Section>
          <SectionHead title="Load" />
          <KpiRow items={[
            { label: 'Hard Weeks', value: known ? fig(dl.hardWeeks) : fig(null) },
            // `(0/1000).toFixed(1)` is "0.0" — a tonnage printed to one decimal
            // place, which reads as measured rather than as absent.
            //
            // And it was a TONNAGE for everybody. This screen never asked what
            // unit the member reads in, so a pounds reader was handed a metric
            // tonne with no note — the one conversion `volumeHeadline` exists
            // to make, for the reason written on it: the tonne has no imperial
            // counterpart safe to print, so an imperial reader gets the pounds.
            { label: 'Volume This Week', value: known ? fig(vol?.figure.toLocaleString()) : fig(null), unit: known && vol ? vol.unit : undefined },
          ]} />
        </Section>

        <Rule />

        {/* ── what the recovery figure is, and which silence it is ───────────

            The score is the home screen's, taken apart rather than restated.
            Three things are on this block and each of them is here because the
            figure alone cannot say it:

              · the SCORE, as a figure and never as a word. `readiness.label`
                is 'Well Recovered' and `readiness.tip` is "Great day to push",
                and neither appears anywhere on this screen — see the header,
                and src/lib/muscleRecovery.ts for the argument in full.
              · what it is MADE OF and over how many nights. An 83 from one
                night and an 83 from three are different claims that look
                identical, which is the whole reason `readinessMadeOf` exists;
                the span is added here because a rest-day decision turns on it.
              · which SILENCE it is, when there is no figure. Nothing
                connected, a read that failed, a device that has recorded
                nothing yet — three states that render as one dash and ask the
                member for three different things.

            The rows below are `breakdown.lines`, unchanged from the ones the
            Recovery screen draws, because a member comparing the two screens
            for an explanation of one number must not find two explanations. */}
        <Section>
          <SectionHead title="Recovery Signals" note={read.state === 'scored' ? 'Same figure as Home' : undefined} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
            <Text style={{ ...value(30), ...numeric, color: read.score != null ? t.ink : t.ink3 }}>
              {fig(read.score)}
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3 }}>out of 100</Text>
          </View>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{read.note}</Text>

          {rv.breakdown.lines.map((l) => (
            // Title and detail as one accessibility stop. "Sleep" and "7h 30m a
            // night over 2 of the last 3 nights" are one fact, and a swipe
            // between them makes the caveat optional to hear.
            <View key={l.key} accessible accessibilityLabel={`${l.title}. ${l.detail}`}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: sp.md, paddingVertical: sp.sm, marginTop: sp.sm, borderTopWidth: hairline, borderTopColor: t.ring }}>
              <Text style={{ ...ty.caption, color: t.ink2 }}>{l.title}</Text>
              <Text style={{ ...ty.caption, color: l.state === 'scored' ? t.ink2 : t.ink3, flex: 1, textAlign: END_ALIGN }}>
                {l.detail}
              </Text>
            </View>
          ))}

          {/* Named devices, not "a device": the fix for a WHOOP that stopped
              answering is on the Devices screen under the word WHOOP. Only
              shown where something may actually be missing — `mayBeMissing` is
              false for a member who owns no watch, and a standing warning
              about a device they do not have is how a warning stops being
              read on the days it means something. */}
          {read.mayBeMissing ? rv.breakdown.caveats.map((c) => (
            <Flag key={c} tone={t.warn} style={{ marginTop: sp.md }}>{c}</Flag>
          )) : null}
        </Section>

        {dl.due ? (<>
          <Rule />
          <Section>
            <SectionHead title="How to Deload" />
            <Text style={{ ...ty.body, color: t.ink2 }}>Keep training, but cut volume to ~60%: fewer sets, or ~10% lighter weights, staying well shy of failure. One easier week lets fatigue clear so you come back stronger.</Text>
          </Section>
        </>) : null}

        <Rule />

        <Section>
          <SectionHead title="On a Rest Day" />
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
            is not the same as having rested, and this screen — which reads what
            was logged and what was measured — would be the last place that should
            blur the two. */}
        <Section>
          <SectionHead title="Plan It In" />
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
