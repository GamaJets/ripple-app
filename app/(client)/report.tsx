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
//
// ── What this screen was sending, and to whom ─────────────────────────────
//
// The summary under "Your week in a nutshell" is not written here. It is
// written by a language model: `askCoach` posted the fact list, through the
// coach-chat edge function, to api.anthropic.com — on every open, before the
// member had touched anything. That fact list is the member's weight, their
// body fat, their skeletal muscle, their waist measurement, their check-in
// (energy, SLEEP, mood, adherence) and what their InBody scans show moving.
// The context object alongside it carried `name: c.name`, so all of it arrived
// attached to the person it is about.
//
// Nothing on this screen said any of that. There was no consent line, no way to
// use the report without sending it, and no "not medical advice" under a
// paragraph a model had written about somebody's body and their sleep — while
// the Injuries screen and the Injury Document screen both carry that
// disclaimer.
//
// The mechanism was already built and tested for app/(client)/coach.tsx, so
// this screen now uses it: `useCoachShare` for the answer, `shareableFacts` for
// the prose and `askCoachForMember` for the context object. Two things about
// the shape of it are specific to this screen and are argued where they happen,
// below — why the facts are split into two arrays rather than filtered by key,
// and why the disclaimer is gated on who wrote the paragraph.
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { num } from '../../src/lib/format';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Notice, Flag, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, lengthIn, lengthLabel, lengthDeltaIn, weightDeltaIn } from '../../src/lib/units';
import { deltaLabel, deltaMoved, movementIsProgress } from '../../src/lib/deltaLabel';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useMeasurements } from '../../src/ui/measurements';
import { useCheckIns } from '../../src/ui/checkins';
import { currentStreak, weekStats, personalRecords, streakMilestone } from '../../src/lib/streaks';
import { useState, useEffect } from 'react';
import { askCoachForMember, coachAvailable } from '../../src/lib/coach';
// The member's own answer about their health details, and the two functions
// that make it mean something: `shareableFacts` decides which of this screen's
// facts may be written into the prompt, and `askCoachForMember` filters the
// context object. See src/lib/coachShare.ts for the whole argument.
import { useCoachShare } from '../../src/ui/coachShare';
import {
  shareableFacts, ALWAYS_SENT, SENT_WITH_PERMISSION, NEVER_SENT, WHERE_IT_GOES,
  CONSENT_TITLE, CONSENT_BODY, WITHHELD_NOTE, NOT_MEDICAL_ADVICE,
} from '../../src/lib/coachShare';
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

  const wk = weekStats(log, Date.now(), c.weightSeries);
  const streak = currentStreak(log);
  const milestone = streakMilestone(streak);
  const prs = personalRecords(log, c.weightSeries);

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
  // The member's answer about their health details, read from the device once.
  // 'unknown' while that read is in flight and 'unasked' when it came back
  // empty; nothing is sent on either. See src/ui/coachShare.tsx.
  const { consent, answer } = useCoachShare();
  // Whether AI features are on at all. Read once and used twice: it gates the
  // ask, and it gates the consent question — asking somebody's permission to
  // send figures to a model this build cannot reach is a question with no
  // consequence, and a consent screen that appears for no reason teaches people
  // to tap through consent screens.
  const aiOn = coachAvailable();
  // Facts only, in TWO piles, and which pile a line goes in decides whether it
  // leaves the phone at all.
  //
  // ── Why the allowlist alone does not cover this screen ──────────────────
  //
  // `shareableContext` in src/lib/coachShare.ts filters a context OBJECT by
  // key, and on app/(client)/coach.tsx that is the whole protection, because
  // every figure that screen sends is a field of that object. This screen is
  // not shaped like that and cannot be: a weekly summary is written from a list
  // of English sentences, and the edge function's system prompt has no template
  // for a tape reading, a check-in or a body-composition movement. Those facts
  // travel in the MESSAGE, which the allowlist never sees.
  //
  // So a single joined string handed to `askCoachForMember` would have its
  // context object faithfully filtered — of a week and nothing else — while the
  // member's weight, body fat, muscle, waist, sleep rating and scan movements
  // went to api.anthropic.com in the prompt underneath it. `shareableFacts`
  // takes the two piles separately and decides; this screen cannot join them
  // itself, which is the point.
  //
  // A line built from a read that did not land whole is not a weaker fact, it
  // is a false one — and these lists are the model's only input, so anything
  // left out simply is not spoken about, which is the outcome we want.
  const trainingFacts = [
    trainingWhole ? `Trained ${wk.workouts} time(s) across ${wk.days} active day(s).` : '',
    trainingWhole ? `Volume ${(wk.volumeKg / 1000).toFixed(1)} tonnes, ~${num(wk.kcal)} kcal.` : '',
    trainingWhole ? `Streak ${streak} day(s).` : '',
    // Said to the model in as many words, so it does not fill the silence with
    // a guess about a quiet week.
    trainingWhole ? '' : 'Their training log could not be read this week. Do not say they did not train, do not mention a streak, and do not comment on volume.',
  ].filter(Boolean);
  // Every line below is a measurement of a person, so every line below waits
  // for a yes. Four kinds, and none of them is more obviously health data than
  // the others once it is written into a prompt:
  //
  //   · weight, body fat and skeletal muscle — HEALTH_KEYS names all three.
  //   · the waist reading — a girth measurement of a body. Nothing in the
  //     key lists covered it before this screen, because the chat never sent
  //     one; it belongs beside the scan figures and not beside the volume.
  //   · the check-in — energy, SLEEP, mood and adherence, self-reported. Sleep
  //     alone puts it here, and splitting adherence out to send on its own
  //     would break one sentence into two for no gain the member can see.
  //   · the composition insights — derived from InBody scans, which is
  //     visceral fat, lean mass and a left/right limb imbalance in a friendlier
  //     wording. COACH_CLIENT_HEALTH names those fields for the coach's side of
  //     the same door.
  const healthFacts = [
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
  // One string, so the effect below can depend on the FACTS rather than on a
  // hand-picked five of the values behind them. An array literal is a new
  // object on every render and would re-ask the model on every render; the
  // joined text only changes when something it says has changed.
  //
  // Null while the answer is 'unknown' or 'unasked', and that null is the gate:
  // there is no prompt to send, so the effect below has nothing to send, and a
  // member who has not answered has nothing posted about them at all — not even
  // the training half.
  const factText = shareableFacts(trainingFacts, healthFacts, consent);
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
  // Whether any of the five reads behind this page is still in flight. Not the
  // same question as `reportWhole`: a read that FAILED has finished, and the
  // report is written from what did land plus the lines above that tell the
  // model in as many words what it must not claim.
  const stillReading = logStatus === 'loading' || c.status === 'loading' || mStatus === 'loading'
    || ciStatus === 'loading' || c.scansStatus === 'loading';

  // The paragraph AND who wrote it. One piece of state rather than two, because
  // the disclaimer under it answers to the provenance and a text that had drifted
  // out of step with its own flag would put "not medical advice" under a
  // sentence this phone composed, or leave it off one a model did.
  const [narrative, setNarrative] = useState({ text: fallbackNarrative, ai: false });
  // Whether the "what leaves your phone" list is expanded. Collapsed once the
  // answer is given so the report is the screen; one tap away forever, because
  // a disclosure somebody can only read once is a disclosure they cannot check.
  const [showsDetail, setShowsDetail] = useState(false);
  // The deps used to be `[wk.workouts, wk.days, streak, wDelta, range]`, and
  // `narrative` is seeded from the FIRST render's `fallbackNarrative` — which,
  // while the training log is loading, is the literal string "Reading your
  // week…". For a member with nothing logged in the trailing seven days and
  // fewer than two points in their weight series, all five of those deps are 0
  // and stay 0 as the reads land: nothing in the list changes, so the effect
  // never runs a second time and that sentence is the whole report, for the
  // whole session. The same silence swallowed the failure wording underneath
  // it, and `askCoach` was asked once, from the loading-state facts, and never
  // asked again once the real ones arrived.
  //
  // So the effect now depends on the two strings it actually renders and sends
  // — both plain strings, compared by value, so a render that changes nothing
  // re-asks nothing — plus the loading flag, because the last read to settle
  // may leave both strings identical and the model still has to be asked.
  useEffect(() => {
    let alive = true;
    setNarrative({ text: fallbackNarrative, ai: false });
    // Nothing is asked of the model while a read is still in flight: it would
    // be answering about a week it has only been told half of, and the reply
    // is written back to the member in the second person as fact.
    //
    // And nothing at all is asked while `factText` is null. That is the whole
    // of the consent gate on the sending side: null is 'unknown' (the stored
    // answer has not been read off this device yet) or 'unasked' (there is no
    // answer to read), and on either of those the member keeps the paragraph
    // this phone wrote and no request is made. The screen still works; it
    // simply works locally.
    if (stillReading || factText == null || !aiOn) return;
    (async () => {
      // `askCoachForMember`, not `askCoach`. The older call sends the context
      // object through untouched, which is how `name: c.name` used to travel —
      // the member's own name, on a payload of their weight, body fat, muscle,
      // waist, sleep rating and scan movements, which is what turns a set of
      // figures into a named medical record. The name is simply gone: the model
      // never needed it (this screen greets them from `c.name` on the phone and
      // always did), and the allowlist would drop it now even if somebody put
      // it back.
      const res = await askCoachForMember(
        [{ role: 'user', content: 'Write a warm, concise 2-3 sentence weekly summary for this client from the facts below. Speak directly to them ("you"), name the biggest win and one focus for next week. No preamble, no lists.\n\n' + factText }],
        { week: range },
        consent,
      );
      if (alive && res.ok && res.reply.trim()) setNarrative({ text: res.reply.trim(), ai: true });
    })();
    return () => { alive = false; };
    // `c.name` is deliberately not a dependency any more: it is no longer part
    // of anything this effect sends, and leaving it here would re-ask the model
    // when a member edited their profile.
  }, [fallbackNarrative, factText, stillReading, range, consent, aiOn]);

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

  /* ── the list of exactly what goes, and what does not ─────────────────────
     Rendered from the arrays in src/lib/coachShare.ts rather than typed here,
     so it cannot drift from the code that decides what is actually sent. A list
     somebody has read and agreed to, that no longer describes the code, is
     worse than no list — they have been told something false and have now
     consented to it. The AI Coach screen renders the same three arrays; the
     arrays describe the feature, so a member who answers here has been shown
     everything the answer covers, including the parts the chat sends and this
     screen does not. */
  const Bullets = ({ head, items, tone }: { head: string; items: string[]; tone: string }) => (
    <View style={{ marginTop: sp.md }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{head}</Text>
      {items.map((line) => (
        <View key={line} style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xs }}>
          <Text style={{ ...ty.label, color: tone }}>•</Text>
          <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{line}</Text>
        </View>
      ))}
    </View>
  );

  const Disclosure = () => (
    <View>
      <Bullets head="Always sent when a summary is written" items={ALWAYS_SENT} tone={t.ink3} />
      <Bullets head="Only sent if you say yes" items={SENT_WITH_PERMISSION} tone={t.brand} />
      <Bullets head="Never sent" items={NEVER_SENT} tone={t.ink3} />
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{WHERE_IT_GOES}</Text>
    </View>
  );

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

        {narrative.text ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title="Your week in a nutshell" note={reportWhole ? undefined : 'from what loaded'} />
              <Text style={{ ...ty.body, color: t.ink2 }}>{narrative.text}</Text>

              {/* The same disclaimer the Injuries screen and the Injury
                  Document screen carry, in the same words, on a paragraph a
                  model wrote about somebody's body and their sleep.

                  Gated on `narrative.ai` because it is a statement about THAT
                  paragraph. The fallback underneath it is composed on this
                  phone out of the member's own record and never left the
                  device, and putting a warning about AI advice under it would
                  train people to read the warning as decoration — which is how
                  a disclaimer stops working on the screen where it matters. */}
              {narrative.ai ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{NOT_MEDICAL_ADVICE}</Text>
              ) : null}

              {/* ── the question, before anything is sent ──────────────────
                  This screen posted the member's weight, body fat, muscle,
                  waist, check-in and body-composition scan movements to a
                  language model — under their NAME — every time it opened,
                  with nothing on it saying so and no way to decline. Now
                  nothing leaves the phone until this has an answer, and the
                  paragraph above is the one this phone wrote until it does. */}
              {!aiOn ? null : consent === 'unknown' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                  <ActivityIndicator color={t.brand} size="small" />
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Checking what you asked us to share…</Text>
                </View>
              ) : consent === 'unasked' ? (
                <View style={{ marginTop: sp.md }}>
                  <Notice tone={t.brand} kicker="Your data" title={CONSENT_TITLE} note={CONSENT_BODY}>
                    <Disclosure />
                  </Notice>
                  <Notice tone={t.s3} kicker="Guidance only" title="Not medical advice" note={NOT_MEDICAL_ADVICE} />
                  <View style={{ marginTop: sp.lg, gap: sp.sm }}>
                    <Cta label="Yes, Use My Numbers" onPress={() => answer('yes')} wide />
                    {/* A Cta and not a Ghost, for the reason the coach screen
                        gives: both answers are real answers and the report is
                        written either way, so rendering the decline as a
                        whisper beside a solid Yes would be pressure dressed up
                        as hierarchy. */}
                    <Cta label="No, Keep Them Private" onPress={() => answer('no')} tone={t.surface2} wide />
                  </View>
                  {/* Said before they choose. The cost of the safer answer is
                      not "less personalised" — it is a summary that cannot see
                      an injury. */}
                  <Flag tone={t.warn} style={{ marginTop: sp.md }}>{WITHHELD_NOTE}</Flag>
                </View>
              ) : (
                /* An answer given once and then buried is how a consent stops
                   being one. This row states which of the two is in force, in
                   the same breath as the way to change it. */
                <View style={{ marginTop: sp.lg, borderTopWidth: hairline, borderTopColor: t.ring, paddingTop: sp.md }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {consent === 'yes'
                      ? 'This summary was written from your training and from your body, tape, check-in and scans. Your name never leaves your phone.'
                      : 'This summary was written from your training alone — your body, tape, check-in and scans stayed on this phone, because you asked. Your name never leaves it either.'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center' }}>
                    <Ghost label={showsDetail ? 'Hide the Detail' : 'What Gets Sent'} onPress={() => setShowsDetail((v) => !v)} />
                    <Ghost label={consent === 'yes' ? 'Turn It Off' : 'Turn It On'}
                      onPress={() => answer(consent === 'yes' ? 'no' : 'yes')} />
                  </View>
                  {showsDetail ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Disclosure />
                      {consent === 'no' ? (
                        <Flag tone={t.warn} style={{ marginTop: sp.md }}>{WITHHELD_NOTE}</Flag>
                      ) : null}
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{NOT_MEDICAL_ADVICE}</Text>
                    </View>
                  ) : null}
                </View>
              )}
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
