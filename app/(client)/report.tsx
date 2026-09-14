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
import { num, num1, fmtDay } from '../../src/lib/format';
import { startOfWeek } from '../../src/lib/weekStart';
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
import { BACK_ICON } from '../../src/ui/direction';

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
  // The fourth read, named like the other three rather than spelled out at the
  // two places that happened to remember it.
  //
  // ── the one health fact that was not gated on its own read ───────────────
  //
  // Every other line in `healthTagged` below asks first whether the read
  // behind it landed whole: the body line on `hasBody` (which is `bodyWhole &&
  // …`), the waist line on `mWhole` through `mLatest`, composition and balance
  // on `isWhole(c.scansStatus)` through `comp`. The check-in line asked only
  // whether a check-in existed — and `useCheckIns` deliberately KEEPS its
  // cached history when a refresh fails (src/ui/checkins.tsx: "offline: the
  // cached history stands, and now says so"), setting 'error' and returning.
  //
  // So under a failed check-ins read the screen still had a `checkIn` object,
  // and it went into the fact list — the summariser's ONLY source — as
  // "Check-in energy 2/5, sleep 2/5…" beside "Week of 8 Sep – 14 Sep", with no
  // date on it and nothing saying it might be a month old. The model writes
  // that back in the second person as this week's, on the document the member
  // sends to their coach. The fallback narrative a hundred lines down already
  // guards the same fact with `isWhole(ciStatus) && checkIn`; the model's copy
  // of it did not, which is the half that travels.
  //
  // ── and why the gate is "did it land", not `isWhole` ─────────────────────
  //
  // Two flags, because the two questions are different here and folding them
  // would withhold a fact that is perfectly good.
  //
  // `ciWhole` is `isWhole` and gates the REPORT's "from what loaded" caption,
  // which is a claim about the whole set.
  //
  // `ciLanded` gates the one check-in FACT, and admits 'partial' on purpose.
  // `useCheckIns` reads newest-first and caps (`order('at', { ascending:
  // false })` … `limit(capLimit())`), so a truncated page loses the OLDEST
  // rows and its first row is still the newest one there is. `latestSent` is
  // that row. This is not a count, a sum or an average over a prefix — the
  // three things src/ui/loadStatus.ts forbids under 'partial' — it is a single
  // row a truncated read is fully able to supply, and the same argument
  // `programmeChoiceState` makes in src/lib/injuryGate.ts: a truncated read
  // did land.
  //
  // What neither admits is 'error' and 'loading', where the object on screen
  // is a cache or nothing at all.
  const ciWhole = isWhole(ciStatus);
  const ciLanded = ciStatus === 'ready' || ciStatus === 'partial';
  // What the report as a whole can stand behind. A weekly summary assembled
  // from four reads is only as complete as its worst one, and the narrative
  // draws on all four at once.
  const reportWhole = trainingWhole && bodyWhole && mWhole && ciWhole;
  const st = useSettings();
  const wu = st.weightUnit;
  const lu = st.lengthUnit;


  // The figure this screen prints AND the figure it hands the model that
  // writes the summary. Both were the raw chain, so the report contradicted
  // the ring on Home and the model was told a streak the app had already told
  // the member was longer.
  const streak = shownStreak(log);
  // Gated, like every other streak statement on this page — and it was the one
  // that was not. `useWorkoutLog` does not clear `log` when a refresh fails: it
  // sets 'error' and returns, leaving the cached and queued entries in place.
  // So an ungated milestone printed "23-day streak — unstoppable! 🔥" in a
  // Notice at the top of the report, directly above a hero of dashes and the
  // sentence "We could not read your training this week, so this summary leaves
  // it out" — a celebration of a run that may already have broken, on the
  // document a member sends to their coach. The same expression is refused to
  // the model on line 226 and to the fallback narrative on line 280 for exactly
  // this reason, and app/(client)/activity.tsx already writes it as
  // `prsKnown ? streakMilestone(streak) : null`.
  const milestone = trainingWhole ? streakMilestone(streak) : null;
  const prs = personalRecords(log, c.weightSeries);

  const wSeries = c.weightSeries;
  const wDelta = wSeries.length > 1 ? +(wSeries[wSeries.length - 1].v - wSeries[0].v).toFixed(1) : 0;
  // Only report a body if the client has actually recorded one — AND if we were
  // able to read what they recorded. An empty `weightSeries` under a failed
  // profile read is not a client who has never been weighed.
  const hasBody = bodyWhole && wSeries.length > 0;

  // ── "no change" was said about a member who has been weighed ONCE ──────
  //
  // `wDelta` is `wSeries.length > 1 ? last − first : 0`, and `hasBody` above
  // asks only that the series is not empty. So a member with exactly one
  // weigh-in had a delta of 0, and `deltaLabel(…, { noChange: 'no change' })`
  // turned that into the WORDS "no change overall" — in the Weight row of the
  // Body block, and in the fact list that is the summariser's only source. The
  // model then writes it back to them in the second person, on a document they
  // send to their coach: your weight is holding steady, about a member whose
  // weight has never been compared to anything.
  //
  // Nothing had changed because nothing had been measured twice. A zero is a
  // measurement and this is not one — it is the arithmetic of a series with one
  // point in it. The figure itself is fine and still printed; it is the CHANGE
  // that is not known, and it now says so and says why.
  const wChangeKnown = hasBody && wSeries.length > 1;

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
  // ── the same seven days the rest of the app calls "this week" ──────────
  //
  // This was `today - 6 days`, a ROLLING window, while Home's goal ring, its
  // tiles and its WeekDots all use `thisWeekStats`, which counts from
  // `startOfWeek`. The two coincide on Saturdays and on no other day.
  //
  // What that looked like: trained Thursday, Friday, Saturday and Monday, read
  // on a Wednesday. Home said "1 of 4 this week". This report's hero said 4,
  // and the fact list handed to the model that writes the summary said
  // "Trained on 4 day(s) this week." One member, one training log, two
  // numbers, and the second one is the one their coach reads.
  //
  // The calendar week wins, for a reason beyond consistency: Home's goal is
  // `planDays.length`, the number of days the PROGRAMME runs in a week, and a
  // programme week is a calendar week. A rolling seven days cannot be compared
  // against it at all — and `startOfWeek` honours the member's own configured
  // week start, which a rolling window silently ignores.
  const weekStart = startOfWeek(today);
  const range = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const wk = statsSince(log, weekStart.getTime(), c.weightSeries);
  // Whether the latest check-in falls inside the week this report is headed
  // with. `Date.parse` of `check_ins.at` is right here and not the bare-date
  // trap: `at` is a timestamptz, an INSTANT, and `weekStart` is a local Date —
  // two instants compared as instants. The bare `YYYY-MM-DD` rule is about
  // date-only columns, and this is not one.
  const checkInAtMs = checkIn ? Date.parse(checkIn.at) : NaN;
  const checkInInWeek = Number.isFinite(checkInAtMs) && checkInAtMs >= weekStart.getTime();
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
  // ── and the same shape one column over, which nothing names ───────────
  //
  // `statsSince` sums energy as `kcal += e.kcal ?? 0` (src/lib/streaks.ts), and
  // `WeekStats` carries no companion to `unpricedSets` for it. So an entry with
  // no energy figure contributes a zero to the week's total exactly the way an
  // unpriced bodyweight set used to contribute a zero to its tonnage — and a
  // week where NOTHING carries one totals "~0 kcal", which went to the model as
  // a fact about how hard somebody trained.
  //
  // Counted here rather than in `statsSince`, which belongs to another lane:
  // the same window, over the same log, asking the one question the aggregate
  // does not answer. Gated on `trainingWhole`, so this counts over a set that
  // was read in full — a filter over a short list would answer a different
  // question in the same words.
  const weekEntries = trainingWhole ? log.filter((e) => Date.parse(e.t) >= weekStart.getTime()) : [];
  const kcalGaps = weekEntries.filter((e) => e.kcal == null).length;
  const kcalKnownFor = weekEntries.length - kcalGaps;

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
    // ── the counts below are counts over a set that was READ ───────────
    //
    // Said in the facts and not only asserted in the code. Every count here is
    // gated on `trainingWhole`, so the log behind it landed in full — but the
    // model is handed the figures and not the gate, and a bare "Trained on 0
    // day(s)" is indistinguishable to it from the 0 a failed read produces.
    // That is the defect scripts/check-ask-prompt.mjs exists for, arriving as
    // prose instead of as a field: "nobody had been assessed and the model was
    // told nobody is at risk". One line establishes the set for all four.
    trainingWhole ? 'Their training log for these seven days was read in full, so the counts below are complete — a zero among them is a measured zero and not a gap.' : '',
    trainingWhole ? `Trained on ${wk.days} day(s) this week.` : '',
    trainingWhole ? `Volume ${num1(wk.volumeKg / 1000)} tonnes.` : '',
    // Energy, on the same footing as the tonnage beside it and for the same
    // reason. Three arms, because "~0 kcal" over a week that carries no energy
    // figures at all is not a small number, it is the absence of every number.
    trainingWhole && weekEntries.length > 0 && kcalKnownFor === 0
      ? `Energy burned this week is not known — none of the ${num(weekEntries.length)} exercise(s) logged carries an energy figure. Do not state a calorie figure for their week and do not call it an easy one.`
      : '',
    trainingWhole && kcalKnownFor > 0 ? `~${num(wk.kcal)} kcal.` : '',
    trainingWhole && kcalKnownFor > 0 && kcalGaps > 0
      ? `That kcal figure covers only ${num(kcalKnownFor)} of the ${num(weekEntries.length)} exercise(s) logged this week; the other ${num(kcalGaps)} carry no energy figure, so it is a floor and not a total.`
      : '',
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
    // The change is stated only where a change has been MEASURED. See
    // `wChangeKnown`: one weigh-in is not a change of nought, and "no change"
    // is the reassuring absence the gate's Rule A is written about — a string
    // opening with an absence word, in a field naming no unknown, about
    // somebody nothing has been compared for.
    { kind: 'body', line: hasBody ? [`Weight ${fig(weightLabel(c.weightKg, wu))} (${wChangeKnown
      ? `${deltaLabel(wDeltaShown, { since: null, unit: wu, noChange: 'no change' })} overall`
      : 'overall change not known — there is one weigh-in on record and nothing to measure a change against, so do not say their weight is steady or that it has moved'})`,
      c.bodyFatPct != null ? `body fat ${c.bodyFatPct}%` : null,
      c.muscleKg != null ? `muscle ${fig(weightLabel(c.muscleKg, wu))}` : null].filter(Boolean).join(', ') + '.' : '' },
    { kind: 'waist', line: waistDShown != null && mLatest ? `Waist ${fig(lengthLabel(mLatest.waist, lu))} (${deltaLabel(waistDShown, { since: null, unit: lu, noChange: 'no change' })} since the previous tape reading).` : '' },
    // `ciLanded &&`, for the reason argued where that flag is declared: a
    // cached check-in under a FAILED read is not this week's news, and there is
    // no date on this line for the model to notice that with. A truncated read
    // is admitted — its newest row is still the newest row.
    // DATED, and the date is not decoration.
    //
    // `latestSent` is the most recent check-in there has ever been, not the
    // most recent one inside the week this report is headed with. Every other
    // line in these two lists is bounded — `wk` counts from `weekStart`, the
    // waist delta says "since the previous tape reading", the weight delta says
    // "overall" — and this one arrived beside "Week of 8 Sep – 14 Sep" carrying
    // nothing at all. A summariser handed an undated fact among dated ones
    // writes it into the same sentence as the rest, so a check-in from three
    // weeks ago was described to the member, in the second person, as this
    // week's mood and this week's sleep.
    //
    // Whoop and Oura both refuse this shape: nothing derived is shown without
    // the window it was derived over. Saying when costs one clause and it is
    // the clause that makes the fact true.
    { kind: 'checkin', line: ciLanded && checkIn ? `Their most recent check-in, ${fmtDay(checkIn.at)}${checkInInWeek ? ' (this week)' : ' — BEFORE the week above, so do not describe it as this week\u2019s'}: energy ${checkIn.energy}/5, sleep ${checkIn.sleep}/5, mood ${checkIn.mood}/5, adherence ${checkIn.adherence}/5.` : '' },
    // ── a health read that did not land is SAID, not left as a silence ───
    //
    // The fitness half has told the model in as many words since its own
    // repair — "Their training log could not be read this week. Do not say they
    // did not train" — and the health half said nothing at all. A failed
    // profile read, a failed tape read, a failed check-in read and a failed
    // scan read each produced the empty string, and `reportHealthLines` dropped
    // it, so the model saw a SHORTER LIST and no author for the shortness.
    //
    // That is the argument WITHHELD_FACTS_INSTRUCTION is built on in
    // src/lib/coachShare.ts — "silence is not an instruction … the withheld
    // lines are simply absent, and absence has no author" — and it holds
    // identically here, except that a withholding is the member's decision and
    // this is a read that failed. A summariser handed weight and waist and no
    // scan writes the scan sentence anyway, because that is what a weekly
    // summary looks like in every text it has read.
    //
    // `not known` and not `unknown`: the member-side spelling, the one the gate
    // documents at NAMED_UNKNOWN_RE for this side of the app.
    //
    // These carry the kind they are about, so `REPORT_SHARE_BULLETS` still
    // describes the payload — a line saying a figure could not be read
    // discloses less than the figure, never more.
    { kind: 'body', line: bodyWhole ? '' : 'not known — their weight, body fat and muscle could not be read this week, so no body figure is among these facts. Do not say they have not been weighed, and do not estimate one.' },
    { kind: 'body', line: bodyWhole && wSeries.length === 0 ? 'not known — this member has no weigh-in on record at all, so there is no weight, body fat or muscle figure to speak about. Do not estimate one and do not treat it as a lapse.' : '' },
    { kind: 'waist', line: mWhole ? '' : 'not known — their tape measurements could not be read this week. Do not say they have not measured and do not comment on their waist.' },
    { kind: 'checkin', line: ciLanded ? '' : 'not known — their check-ins could not be read this week, so no energy, sleep, mood or adherence score is among these facts. Do not say they skipped a check-in.' },
    { kind: 'composition', line: isWhole(c.scansStatus) ? '' : 'not known — their body-composition scans could not be read this week. Do not say nothing is improving, and do not name anything to watch.' },
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
      : `You trained on ${wk.days} day${wk.days === 1 ? '' : 's'} this week, moving ${num1(wk.volumeKg / 1000)} tonnes of volume.`);
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
    if (ciLanded && checkIn && checkIn.adherence <= 3) bits.push(`Your last check-in put adherence at ${checkIn.adherence}/5 — worth refocusing next week.`);
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
    // `'no change'` was printed for a member weighed once — see `wChangeKnown`.
    // The figure is theirs and stays; the caption says what the app actually
    // knows about how it has moved, which so far is nothing.
    { label: 'Weight', value: fig(weightIn(c.weightKg, wu)), unit: wu,
      delta: !wChangeKnown ? 'one weigh-in so far'
        : deltaMoved(wDeltaShown) ? `${deltaLabel(wDeltaShown, { since: null, unit: wu })} overall` : 'no change',
      good: wChangeKnown && movementIsProgress(wDeltaShown, c.goal, 'weight') },
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
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
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
            { label: 'Volume', value: num1(wk.volumeKg / 1000), unit: 't', delta: `${wk.kcal.toLocaleString()} kcal` },
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
              {/* Dated on screen too. "Latest Check-in" over four scores
                  says nothing about whether they are this week's, and this is
                  the block a member reads as the week's summary of how they
                  felt. `fmtDay` is the app's own resolver (src/lib/locale.ts);
                  `at` is a timestamp, so it carries its own instant. */}
              <SectionHead title="Latest Check-in" note={checkIn.at ? fmtDay(checkIn.at) : undefined} />
              {!checkInInWeek && Number.isFinite(checkInAtMs) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                  From before the week above, so it is not a reading of this week.
                </Text>
              ) : null}
              <Text style={{ ...ty.body, color: t.ink2 }}>Energy {checkIn.energy}/5 · Sleep {checkIn.sleep}/5 · Mood {checkIn.mood}/5 · Adherence {checkIn.adherence}/5</Text>
              {checkIn.note ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 6, fontStyle: 'italic' }}>“{checkIn.note}”</Text> : null}
              {/* Still shown, and said to be what it is. `useCheckIns` keeps the
                  cached history when a refresh fails — correctly, it is the
                  member's own record — and its own note says the point of the
                  status is that the screen "says so". This screen showed the
                  cached row under the heading "Latest" and said nothing, so a
                  failed read rendered as a current answer. The line goes no
                  further than the screen: the fact handed to the summariser is
                  withheld outright under the same condition, because a model
                  cannot be shown a caption. */}
              {!ciLanded ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {ciStatus === 'loading'
                    ? 'Reading your check-ins…'
                    : 'We couldn’t reach your check-ins just now, so this is the last one this phone had — there may be a newer one. It is left out of the summary above rather than described as this week’s.'}
                </Text>
              ) : null}
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
