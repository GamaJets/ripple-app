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
import { shownStreak, statsSince, personalRecords, streakMilestone } from '../../src/lib/streaks';
// The one sentence that goes under a tonnage the app knows to be short. Five
// other client screens print it — history, trends and the workout runner — and
// this one printed the figure bare. See src/lib/bodyweightSets.ts.
import { tonnageNote } from '../../src/lib/bodyweightSets';
import { useState, useEffect, useCallback } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { askAboutMyWeek, coachAvailable } from '../../src/lib/coach';
import { REPORT_SHARE_BULLETS, reportHealthLines, type ReportHealthFact } from '../../src/lib/reportShare';
import { useCoachShare } from '../../src/ui/coachShare';
import {
  NEVER_SENT, WHERE_IT_GOES, NOT_MEDICAL_ADVICE,
  REPORT_CONSENT_TITLE, REPORT_CONSENT_BODY, REPORT_WITHHELD_NOTE,
} from '../../src/lib/coachShare';
import { compositionInsights } from '../../src/lib/inbodyMetrics';
import { isWhole } from '../../src/ui/loadStatus';
// The day this screen judges against, kept live across midnight. See the
// note at `useNow()` below.
import { useNow } from '../../src/ui/today';

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
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const { entries, status: mStatus, reload: reloadMeasurements } = useMeasurements();
  // `latestSent`, not `latest`. A weekly report is a summary of what the coach
  // can see, and `latest` may be a check-in still sitting on this phone with no
  // signal — reporting it as part of the record would tell the client their
  // coach has read something nobody has sent.
  const { latestSent: checkIn, status: ciStatus, reload: reloadCheckins } = useCheckIns();
  // Four reads make this report and `reportWhole` below is only as good as the
  // worst of them, so the gesture asks for all four rather than leaving the
  // report assembled from three fresh sources and one that failed.
  const pull = usePullToRefresh(useCallback(() => {
    c.reload(); reloadLog(); reloadMeasurements(); reloadCheckins();
  }, [c.reload, reloadLog, reloadMeasurements, reloadCheckins]));
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


  // The figure this screen prints AND the figure it hands the model that
  // writes the summary. Both were the raw chain, so the report contradicted
  // the ring on Home and the model was told a streak the app had already told
  // the member was longer.
  const streak = shownStreak(log);
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

  // `useNow()` and not a bare `new Date()`. This is not the frozen-at-mount
  // shape check:frozen-day looks for — a render-body `new Date()` is right
  // every time this redraws — it is the other half of the same problem, which
  // src/ui/today.ts states: it is only right at the moment something else
  // happens to redraw, and this screen sits still while it is read.
  //
  // `range` is the date span printed on a weekly report the member SENDS to
  // their coach. Left open overnight, the report goes out headed with a window
  // that ended yesterday, over facts that were gathered for it — a document
  // whose own dates are wrong about what it covers. `useNow` re-settles at
  // local midnight, on foreground, and on focus, which is the moment a member
  // comes back to this tab to send it.
  const today = useNow();
  // Local midnight of the first day NAMED in the range, not the same
  // time-of-day seven days back.
  //
  // ── the header and the figures were about different weeks ────────────
  //
  // `range` is seven whole calendar days — `today − 6` through today — and it
  // is printed as "Week of …" at the top of a document the member SENDS to
  // their coach. The figures under it came from `weekStats`, which is a rolling
  // 168 hours ending at the instant of reading. So a session logged at 08:00 on
  // the first day of the stated range fell out of the totals the moment the
  // report was opened after 08:00 today — a document whose own header is wrong
  // about what it covers, and whose facts go on to a language model that writes
  // the summary from them.
  //
  // Counting from midnight makes the sentence true: the window the report
  // states and the window it counts are now the same seven days.
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const range = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const wk = statsSince(log, weekStart.getTime(), c.weightSeries);
  // ── the tonnage that needed no failed read to be wrong ────────────────
  //
  // `statsSince` returns `unpricedSets` alongside `volumeKg` and its doc says
  // in as many words that "a screen that prints the tonnage without checking
  // this is stating a total over a set it knows to be short". This screen
  // printed `wk.volumeKg` in the KPI row, in the fallback prose, and in the
  // fact list handed to the model, and checked it in none of the three.
  //
  // The failure needs nothing to go wrong: a member nobody has ever weighed has
  // an empty `weightSeries`, so a week of pull-ups and dips has no load to
  // price and the report reads "Volume 0.0 t" over a paragraph saying they
  // moved 0.0 tonnes — about a week they trained hard. The note names how many
  // sets are missing and what to do about it, in the same words history.tsx,
  // trends.tsx and workouts.tsx already use.
  const volNote = tonnageNote({ kg: wk.volumeKg, unknownSets: wk.unpricedSets });

  const comp = compositionInsights(isWhole(c.scansStatus) ? c.scans : []);
  // Facts only. A line built from a read that did not land whole is not a
  // weaker fact, it is a false one — and these lists are the model's only
  // input, so anything left out of them simply is not spoken about, which is
  // the outcome we want.
  //
  // ── the two piles, and why this list is split ────────────────────────
  //
  // This screen posted every line below to a language model with the member's
  // NAME beside it and no consent question anywhere on it. The name is gone —
  // app/(client)/coach.tsx removed it from its own payload because "the model
  // was told 'Name: Sarah Whitfield' and then handed her weight, her body fat,
  // her sleep", and this call was putting it back as the second field — and the
  // health half now goes only if the member has said it may.
  //
  // The allowlist in src/lib/coachShare.ts filters a context OBJECT, and the
  // sensitive part of this screen is prose in the message. So the partition is
  // over the fact lines, and it is applied in `weeklyFacts` rather than here,
  // where a later edit to this list cannot skip it.
  const fitnessFacts = [
    `Week of ${range}.`,
    // DAYS, not `wk.workouts`. That is one log entry per EXERCISE, so this
    // line told the model — and through it the coach this document is sent to
    // — "Trained 7 time(s) across 1 active day(s)" about a single Monday of
    // seven movements. It says days now rather than a session count because
    // this app cannot count sessions: see the note on `WeekStats.days` in
    // src/lib/streaks.ts for the production rows that settle it.
    trainingWhole ? `Trained on ${wk.days} day(s) this week.` : '',
    trainingWhole ? `Volume ${(wk.volumeKg / 1000).toFixed(1)} tonnes, ~${num(wk.kcal)} kcal.` : '',
    // Said to the model too, for the same reason the caveats above and below
    // are: the fact lines are its only source, so a tonnage handed over bare is
    // one it will describe as the whole of their week's work.
    trainingWhole && volNote
      ? `That tonnage leaves out ${wk.unpricedSets} bodyweight set(s) whose load is not recorded, so it is a floor and not a total. Do not call it their whole week's work.`
      : '',
    trainingWhole ? `Streak ${streak} day(s).` : '',
    // Said to the model in as many words, so it does not fill the silence with
    // a guess about a quiet week.
    trainingWhole ? '' : 'Their training log could not be read this week. Do not say they did not train, do not mention a streak, and do not comment on volume.',
  ].filter(Boolean);

  // Everything measured about their body. Weight, body fat, muscle, girths,
  // sleep and recovery — the same set `HEALTH_KEYS` gates on the AI Coach.
  // TAGGED, and that is the point. Each line carries the kind of thing it is,
  // the bullets the member agrees to are derived from the same list of kinds
  // in src/lib/reportShare.ts, and a sixth kind without a sixth bullet does not
  // compile. The three bullets that used to be typed into the render below had
  // already drifted from this array: the body-composition scan and the
  // left/right limb finding went to the model and were named nowhere.
  const healthTagged: ReportHealthFact[] = [
    // These lines are the summariser's only source of fact, so they carry the
    // client's own units: a model handed "82 kg" writes back "you're at 82 kg"
    // to somebody who has never used a kilogram in their life.
    // Through deltaLabel: an unchanged weight used to be stated to the model as
    // "(0 kg overall)", which is a change of zero rather than the absence of
    // one, and the model writes back about it as though something happened.
    { kind: 'body', line: hasBody ? [`Weight ${fig(weightLabel(c.weightKg, wu))} (${deltaLabel(wDeltaShown, { since: null, unit: wu, noChange: 'no change' })} overall)`,
      c.bodyFatPct != null ? `body fat ${c.bodyFatPct}%` : null,
      c.muscleKg != null ? `muscle ${fig(weightLabel(c.muscleKg, wu))}` : null].filter(Boolean).join(', ') + '.' : '' },
    { kind: 'waist', line: waistDShown != null && mLatest ? `Waist ${fig(lengthLabel(mLatest.waist, lu))} (${deltaLabel(waistDShown, { since: null, unit: lu, noChange: 'no change' })} since the previous tape reading).` : '' },
    { kind: 'checkin', line: checkIn ? `Check-in energy ${checkIn.energy}/5, sleep ${checkIn.sleep}/5, mood ${checkIn.mood}/5, adherence ${checkIn.adherence}/5.` : '' },
    { kind: 'composition', line: comp.improving.length ? `Body composition improving: ${comp.improving.join(', ')}.` : '' },
    { kind: 'composition', line: comp.watch.length ? `Body composition to watch: ${comp.watch.join(', ')}.` : '' },
    { kind: 'balance', line: comp.balance.length ? comp.balance.join(' ') : '' },
  ];
  const healthFacts = reportHealthLines(healthTagged);
  // One string per pile, so the effect below can depend on the FACTS rather
  // than on a hand-picked five of the values behind them. An array literal is a
  // new object on every render and would re-ask the model on every render; the
  // joined text only changes when something it says has changed.
  const fitnessText = fitnessFacts.join('\n');
  const healthText = healthFacts.join('\n');
  const fallbackNarrative = (() => {
    const bits: string[] = [];
    // "No logged workouts this week" was printed for a failed read as readily
    // as for a quiet week, and it is the sentence a member is most likely to
    // believe and least able to check.
    if (!trainingWhole) bits.push(logStatus === 'loading'
      ? 'Reading your week…'
      : 'We could not read your training this week, so this summary leaves it out. It is not a week with nothing in it.');
    // The tonnage clause is dropped, not dashed, when the week holds sets the
    // app could not price: "moving 0.0 tonnes of volume" was the sentence a
    // never-weighed member read about a week of pull-ups and dips. The count of
    // sessions and active days is unaffected — those are facts — and the note
    // underneath the KPI row says which sets are missing and why.
    else if (wk.days > 0) bits.push(volNote
      ? `You trained on ${wk.days} day${wk.days === 1 ? '' : 's'} this week.`
      : `You trained on ${wk.days} day${wk.days === 1 ? '' : 's'} this week, moving ${(wk.volumeKg / 1000).toFixed(1)} tonnes of volume.`);
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

  // The member's answer about sending their body measurements to a model. The
  // same hook, the same key and the same stored answer the AI Coach screen uses
  // — asked once, honoured on both screens.
  const { consent, answer } = useCoachShare();

  const [narrative, setNarrative] = useState(fallbackNarrative);
  // Who wrote the paragraph that is on the screen right now.
  //
  // ── the disclaimer was under the wrong paragraph ─────────────────────
  //
  // `NOT_MEDICAL_ADVICE` was rendered in one place: the 'unasked' branch, under
  // the consent question. So the member who said NO thanks got it, and the
  // member who said YES — the one whose weight, body fat, sleep and recovery
  // had just been posted to a language model, and who is reading a paragraph
  // that model wrote about their body — got nothing under it at all. The
  // disclaimer appeared only before anybody had agreed to anything, which is
  // exactly the wrong way round.
  //
  // ── and why it is not simply always on ───────────────────────────────
  //
  // Because `narrative` is TWO different things wearing the same style.
  // `fallbackNarrative` a few lines up is composed here, on the device, out of
  // counts this screen already prints — no model, no network, nothing asked of
  // anybody. It is what a member sees while the reads are in flight, when the
  // AI build flag is off, before they answer, and whenever the call fails.
  //
  // A medical disclaimer under that paragraph is decoration: it is on the
  // screen at times when nothing on the screen could have been invented,
  // including every single render for every member of a build with the coach
  // turned off. Warnings that are always there are read once and then never
  // again, and the one render where this sentence has to be read is the one
  // where a third party has just written about somebody's body. So it is
  // gated on provenance, and this is the flag that carries it.
  const [fromModel, setFromModel] = useState(false);
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
    setNarrative(fallbackNarrative);
    // Back to locally composed, on every run of this effect. The facts changed,
    // so whatever the model last said is now about a different week — and the
    // paragraph reverting without the flag reverting with it would leave the
    // disclaimer under a sentence this device wrote.
    setFromModel(false);
    // Nothing is asked of the model while a read is still in flight: it would
    // be answering about a week it has only been told half of, and the reply
    // is written back to the member in the second person as fact.
    if (stillReading || !coachAvailable()) return;
    // …and nothing at all until the member has answered. 'unknown' is the
    // window before their stored answer has been read and 'unasked' is a
    // question still to put; `askAboutMyWeek` refuses on both, and the guard
    // here only saves a round trip. The gate that matters is in the library.
    if (consent !== 'yes' && consent !== 'no') return;
    (async () => {
      const res = await askAboutMyWeek({ fitness: fitnessFacts, health: healthFacts }, consent);
      // The two setters move together and only here. This is the one branch in
      // the file where the words on the screen came from somewhere other than
      // this file, and it is the only one that raises the flag.
      if (alive && res.ok && res.reply.trim()) { setNarrative(res.reply.trim()); setFromModel(true); }
    })();
    return () => { alive = false; };
    // `fitnessText` and `healthText` rather than the arrays: an array literal
    // is a new object on every render and would re-ask the model on every one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackNarrative, fitnessText, healthText, stillReading, consent]);

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

  /**
   * The paragraph, and the disclaimer that belongs to it.
   *
   * One function rather than the same JSX in the two branches below, because
   * the pairing is the whole fix: the two branches render the same `narrative`
   * and it would take one edit to either of them for a model-written paragraph
   * to lose its disclaimer again. Written as a plain call and not a component
   * so it does not remount the text — and therefore does not interrupt a screen
   * reader — every time this screen redraws.
   *
   * `top` because the consent branch has the question above it and needs the
   * paragraph pushed clear of the buttons; the answered branch starts here.
   */
  const narrativeBlock = (top: number) => (narrative ? (
    <View style={{ marginTop: top }}>
      <Text style={{ ...ty.body, color: t.ink2 }}>{narrative}</Text>
      {/* Only under prose a language model wrote. See `fromModel` above for
          why an always-on warning under a paragraph this device composed is
          worse than none: it is on screen at the moments nothing could have
          been invented, and a warning that is always there is not read. */}
      {fromModel ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{NOT_MEDICAL_ADVICE}</Text>
      ) : null}
    </View>
  ) : null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
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
        {/* DAYS. This was `wk.workouts`, which is log ENTRIES, one per
            exercise: a member who trained once and logged seven movements read
            "7 sessions" directly above a note saying "1 active day" — two
            numbers from the same data, on the same card, disagreeing, in a
            document they send to their coach.
            A session count is not available to fix it with; see
            `WeekStats.days` in src/lib/streaks.ts. The note underneath carries
            the exercise count instead, which is a fact. */}
        <Hero label="Trained This Week" figure={trainingWhole ? fig(wk.days) : fig(null)}
          unit={trainingWhole ? (wk.days === 1 ? 'day' : 'days') : undefined}
          note={trainingWhole
            ? `${wk.workouts} exercise${wk.workouts === 1 ? '' : 's'} logged${streak > 0 ? ` · ${streak}-day streak` : ''}`
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
            // ── the board this count is taken over needs TWO reads ────────
            //
            // `personalRecords` skips any set whose `setLoadKg` comes back
            // null, and that is every bodyweight set when the weight history is
            // empty or short — the series is built from the scans plus the
            // member's own logged weight, which is exactly what `c.status`
            // (worstStatus of profile and scans) answers for. `bodyWhole` sat
            // one line below `trainingWhole` and was already applied to `comp`
            // and to the Body block; this count was gated on the log alone.
            //
            // So a member with nine records — five barbell, four calisthenic —
            // whose scans read failed while their log came back whole was told
            // "PRs on Record: 4", all-time, on a document they send to their
            // coach. app/(client)/records.tsx carries a written notice for this
            // same case; the line under this row is its short form.
            { label: 'PRs on Record', value: bodyWhole ? fig(prs.length) : fig(null), delta: bodyWhole ? 'all-time' : 'not read' },
          ] : [
            { label: 'Volume', value: fig(null), unit: 't' },
            { label: 'Streak', value: fig(null) },
            { label: 'PRs on Record', value: fig(null), delta: 'not read' },
          ]} />
          {/* Under the figure, not instead of it. The tonnage that came back is
              real; what it is missing is sets nobody could price. */}
          {trainingWhole && volNote ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{volNote}</Text>
          ) : null}
          {trainingWhole && !bodyWhole ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              {c.status === 'loading'
                ? 'Reading your weight history, so the PR count is not counted yet.'
                : c.status === 'partial'
                  ? 'You have more on your record than this screen can read at once, so your PR count is left blank rather than counted over part of it. Nothing has been reset.'
                  : 'Pull-ups, dips and press-ups are priced against what you weighed on the day, and that history could not be read — so a count of your records would be short by every one of them. It is left blank rather than stated wrong, and nothing has been reset.'}
            </Text>
          ) : null}
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

        {/* ── the paragraph a third party writes ─────────────────────────
            This screen posted the week's fact list — weight, body fat, muscle,
            girths, sleep, check-ins — to a language model with the member's
            NAME beside it, under a consent question they were never asked, on a
            screen they opened to read a summary. The AI Coach screen had
            already been through this: it asks once, it says exactly what goes
            and what never does, and it works either way.

            Same question, same stored answer, same hook. A member who has
            already answered on the Coach screen is not asked again here. */}
        <View>
          <Rule />
          <Section>
            <SectionHead title="Your week in a nutshell" note={reportWhole ? undefined : 'from what loaded'} />
            {coachAvailable() && consent === 'unknown' ? (
              <Text style={{ ...ty.caption, color: t.ink3 }}>Checking what you asked us to share…</Text>
            ) : coachAvailable() && consent === 'unasked' ? (
              <View>
                <Notice tone={t.brand} kicker="Your data" title={REPORT_CONSENT_TITLE} note={REPORT_CONSENT_BODY}>
                  {/* Rendered from src/lib/reportShare.ts (the "sent" half) and
                      src/lib/coachShare.ts (the "never" half) rather than typed
                      here, so the list cannot drift from what is actually sent.
                      A list somebody has read and agreed to that no longer
                      describes the code is worse than no list — and this comment
                      once sat directly over three bullets typed in by hand,
                      which had drifted: the body-composition scan and a
                      left/right limb finding went too, named nowhere. The
                      bullets now come off the same tagged kinds the payload is
                      built from, so a new fact line without a bullet does not
                      compile. */}
                  <View style={{ marginTop: sp.md }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Only sent if you say yes</Text>
                    {REPORT_SHARE_BULLETS.map((x) => (
                      <View key={x} style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xs }}>
                        <Text style={{ ...ty.label, color: t.brand }}>•</Text>
                        <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{x}</Text>
                      </View>
                    ))}
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>Never sent</Text>
                    {NEVER_SENT.map((x) => (
                      <View key={x} style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xs }}>
                        <Text style={{ ...ty.label, color: t.ink3 }}>•</Text>
                        <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{x}</Text>
                      </View>
                    ))}
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{WHERE_IT_GOES}</Text>
                  </View>
                </Notice>
                <View style={{ marginTop: sp.lg, gap: sp.sm }}>
                  <Cta label="Yes, Use My Numbers" onPress={() => answer('yes')} wide />
                  {/* A Cta and not a Ghost. Both answers are real answers and
                      the report is written either way, so rendering the decline
                      as a whisper beside a solid Yes would be pressure dressed
                      up as hierarchy. */}
                  <Cta label="No, Keep Them Private" onPress={() => answer('no')} tone={t.surface2} wide />
                </View>
                {/* The disclaimer used to be printed here, unconditionally,
                    and ONLY here — above a paragraph that in this branch is
                    always the locally composed fallback, because nobody has
                    answered yet and `askAboutMyWeek` refuses on 'unasked'. It
                    now travels with the paragraph it is about. */}
                {narrativeBlock(sp.lg)}
              </View>
            ) : (
              <>
                {narrativeBlock(0)}
                {/* An answer given once and then buried is how a consent stops
                    being one. It is changeable here, on the screen it governs. */}
                {coachAvailable() && (consent === 'yes' || consent === 'no') ? (
                  <View style={{ marginTop: sp.lg }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      {consent === 'yes'
                        ? 'Your body measurements, your tape readings and your check-ins are being sent so this paragraph can mention them.'
                        : REPORT_WITHHELD_NOTE}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: sp.md }}>
                      <Ghost label={consent === 'yes' ? 'Turn It Off' : 'Turn It On'}
                        onPress={() => answer(consent === 'yes' ? 'no' : 'yes')} />
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </Section>
        </View>

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
