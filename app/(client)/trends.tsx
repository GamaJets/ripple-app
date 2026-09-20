// Client · Trends. Graphs the workout log so members can SEE progress over time:
// weekly training volume (tonnage) for the last 10 weeks, and a per-exercise
// estimated-1RM trend. Read-only — every figure is derived from the log.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: this week's
// tonnage is the screen's one hero figure, the two hand-rolled View-bar charts
// became <Spark> trends with a KpiRow carrying the numbers they annotated, the
// 8.5px labels are gone, and the est-1RM delta no longer paints itself in a
// reserved status colour — it carries a coloured mark beside ink text.
import { useMemo, useState, useCallback } from 'react';
import { trainIntent } from '../../src/lib/trainIntent';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useNow } from '../../src/ui/today';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { volumeIn, est1RMIn, weightDeltaIn, liftLabel, convertedNote } from '../../src/lib/units';
// The verdict this app already produces for every lift, and the two vocabularies
// it is read out in. See the section at the bottom of this screen for why the
// verdict is a reading of ONE session and is never worded as a trend.
import { suggestProgression, ACTION_LABEL, ACTION_READING } from '../../src/lib/progression';
import { temperByReadiness } from '../../src/lib/readyProgression';
import { useReadiness } from '../../src/ui/readiness';
import { deltaLabel, deltaMoved, deltaSign } from '../../src/lib/deltaLabel';
import { shortDayLabel } from '../../src/lib/bodyFigures';
import { est1RM } from '../../src/lib/streaks';
import { entryTonnage, setLoadKg, tonnageNote, type BodyweightHistory, type Tonnage } from '../../src/lib/bodyweightSets';
// A hold is not a lift, and this screen is where that stopped being true. See
// src/lib/holdTrend.ts: `bestOf` below fed seconds to Epley, so a plank drew an
// "estimated 1-rep max" out of a stopwatch on the same axis as a bench press.
import { isTimedSet, holdLabel } from '../../src/lib/timedSets';
import { holdSeries, heldMovements, liftedMovements, holdChangeSecs, holdLoadNote } from '../../src/lib/holdTrend';
import { useClientData } from '../../src/ui/clientData';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { Section, SectionHead, PageHead, KpiRow, Ghost, Spark, fig, TonedChip, Expandable } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, elevation, font } from '../../src/theme/scale';
import { startOfWeek } from '../../src/lib/weekStart';
import { fmtAxisDay } from '../../src/lib/format';
// The local calendar day of an instant, so one movement done twice in an
// afternoon is one point on the trend rather than two.
import { dayKeyOf } from '../../src/lib/entryEdit';
import { useMovementName } from '../../src/ui/catalogueTranslations';

const WEEKS = 10;

// Tonnage and best estimated max now go through src/lib/bodyweightSets.ts,
// which is what lets a pull-up onto these charts. Both used to read a set's
// second number as the load, and on a bodyweight set that number is zero — so
// a member who trains on rings charted a flat run of zeros across ten weeks
// and was told they had logged no volume at all.
// ── and a hold is not a lift, which this reduced over anyway ──────────────
//
// `setLoadKg` knows about bodyweight and knows nothing about holds, so on a
// timed set this ran `est1RM(load, s[0])` where `s[0]` is SECONDS. An 88 kg
// member's 45-second plank charted as est1RM(88, 45) ≈ 220 kg — a strength
// figure computed from a stopwatch, plotted under the words "Estimated 1-rep
// max" and tall enough to press every real lift on the chart into the bottom
// pixel. src/lib/timedSets.ts refuses this arithmetic in as many words, and
// tonnage, the rep board and the progression rule all skip holds already. This
// was the one place that did not.
//
// ── null, because zero is a figure ────────────────────────────────────────
//
// It returned 0 for an entry it could not read, and 0 is an estimated one-rep
// max of nothing. A member who does pull-ups and has never been weighed has no
// priceable set anywhere (src/lib/bodyweightSets.ts), so every day of their
// training charted at zero and the KPI beside it printed "0 kg". Null is the
// honest answer and <Spark> draws it as a gap — the day stays on the axis, the
// line breaks across it, and no figure is invented for it.
function bestOf(e: WorkoutEntry, history: BodyweightHistory): number | null {
  const rows = e.sets || [];
  let best: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (isTimedSet(e, i)) continue;
    const reps = rows[i][0];
    if (!reps) continue;
    const load = setLoadKg(e, i, rows[i], history, e.t);
    if (load == null) continue;
    const v = est1RM(load, reps);
    if (best == null || v > best) best = v;
  }
  return best;
}

export default function Trends() {
  const t = useTheme();
  // The reader's own language for the movement, English where the catalogue
  // has no translation. The stored name is untouched — it is the identity.
  const { textOf: movement } = useMovementName();
  const router = useRouter();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  // Every figure on this screen is a lifted load or a sum of them, and the
  // tester's report was about exactly these: "Don't have choice of units for
  // exercise / weights being used." The arithmetic below stays in the
  // kilograms the log is stored in — a chart drawn from converted values would
  // have a different shape for a pounds reader — and only the printed figures
  // convert, at the edge, in src/lib/units.ts.
  const wu = useSettings().weightUnit;
  const unitNote = convertedNote(wu);
  // The member's weight over time, used to price a bodyweight set at what they
  // weighed ON OR BEFORE the day of it. Never today's figure carried backwards:
  // this is a ten-week chart, and a chart whose past redraws itself every time
  // somebody steps on a scale is not a record of anything.
  const cd = useClientData();
  const { weightSeries } = cd;
  // The volume and frequency curves come from the log; the weight curve drawn
  // beside them comes from the scan history. Two reads, both asked again.
  const pull = usePullToRefresh(useCallback(() => { reloadLog(); cd.reload(); }, [reloadLog, cd.reload]));
  // Under 'error' the log is empty because it could not be read, so every
  // tonnage below reduces to zero and gets printed with a thousands separator
  // and a unit — the full costume of a measured figure. "Best week" is the
  // sharpest of them: it is the maximum over the ten weeks that loaded, so a
  // partial read quietly nominates the wrong week as the client's best ever.
  // The comment above named 'partial' and the guard did not exclude it, so the
  // sentence describing the bug shipped alongside the bug. `isWhole` is the
  // gate loadStatus.ts asks for and is false for 'partial' and 'loading' both.
  const logKnown = isWhole(logStatus);

  // ── the ten weeks are anchored to today, and today moves ───────────────
  //
  // `startOfWeek()` defaults to `Date.now()`, and it used to be read inside a
  // memo keyed on `[log, weightSeries]` — the two READS. So the bucket
  // boundaries were pinned to whenever those last changed, which on a screen
  // nobody is touching is whenever it first mounted. src/ui/today.ts: "Nothing
  // in these apps unmounts a screen when the phone is pocketed … backgrounding
  // the app does not tear them down at all."
  //
  // A phone left open across a Saturday night therefore showed last week's
  // tonnage under the words "Lifted This Week", nominated a "Best Week" out of
  // a ten-week window that had stopped moving, and left a Sunday session logged
  // on another device outside every bucket. app/(client)/consistency.tsx solved
  // exactly this with `useNow` and wrote down why; this screen was not given
  // the same treatment.
  const now = useNow();

  // Weekly training volume (last 10 weeks, oldest → newest).
  const weeks = useMemo(() => {
    const weekOpened = startOfWeek(now);
    // `days`, and named that way on purpose: the value is `days.size`, the label
    // beside it is "Training Days", and calling the field `sessions` was how the
    // same figure got read as a session count on three other screens.
    const out: { label: string; iso: string; vol: number; unpriced: number; days: number }[] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const start = new Date(weekOpened); start.setDate(weekOpened.getDate() - w * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const inWk = log.filter((e) => { const d = new Date(e.t); return d >= start && d < end; });
      const days = new Set(inWk.map((e) => new Date(e.t).toDateString()));
      // `label` is the Best Week chip's "w/c …", and it was the terse "12/8" —
      // twelve August to a member in London and unreadable to one in Chicago,
      // where 12/8 is 8 December. Same defect as the four booking screens'
      // `${d.getDate()}/${d.getMonth() + 1}`, on the one figure this screen
      // asks a member to remember. `fmtAxisDay` is the shared renderer for a
      // day and a short month in the reader's own language and order, and it
      // takes the PARTS as numbers, so there is no string for `new Date()` to
      // reinterpret as UTC midnight.
      //
      // `iso` is that same opening day as data, for the chart axis to format. Both
      // are built from local getters, never from a string, so the week a member is
      // standing in is the week they are shown — see src/lib/localDate.ts.
      const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      // The unpriced count travels with the tonnage, not beside it. A week of
      // pull-ups done by somebody who has never been weighed has real work in
      // it and no load to put on that work, and a bare `vol` would state the
      // shortfall as a smaller number rather than as an unknown.
      const t = inWk.reduce<Tonnage>((a, e) => { const x = entryTonnage(e, weightSeries); return { kg: a.kg + x.kg, unknownSets: a.unknownSets + x.unknownSets }; }, { kg: 0, unknownSets: 0 });
      out.push({ label: fmtAxisDay(start.getFullYear(), start.getMonth(), start.getDate()), iso, vol: t.kg, unpriced: t.unknownSets, days: days.size });
    }
    return out;
    // `now` is a dependency, not a value read past the memo: without it the
    // recomputation that a new day asks for never happens.
  }, [log, weightSeries, now]);
  const maxVol = Math.max(1, ...weeks.map((w) => w.vol));

  // Every movement in the log with sets on it (skip pure cardio). Unsliced,
  // because the "Lift by Lift" section below has to name the movements that got
  // no verdict — and a list capped at 24 for a row of chips would have made
  // that a lie about the 25th.
  const movements = useMemo(() => {
    const names: string[] = [];
    for (const e of log) { if (e.sets && e.sets.length && !names.includes(e.exercise)) names.push(e.exercise); }
    return names;
  }, [log]);
  // → trend of best est-1RM. The chip row is what the 24 is for.
  //
  // Movements that were LIFTED, not every movement in the log. A member whose
  // only isometric work is a plank got a "Plank" chip on a chart captioned
  // "Estimated 1-rep max", and tapping it drew the stopwatch arithmetic `bestOf`
  // above now refuses — a chip that leads only to a gap is worse than no chip.
  // The holds have their own chart below, in their own units.
  const exercises = useMemo(() => liftedMovements(log).slice(0, 24), [log]);
  const [sel, setSel] = useState<string | null>(null);
  const selName = sel || exercises[0] || null;

  // Every OUTING of this movement that was read, oldest first. The `.slice`
  // that used to end this build is now on the CHART only.
  //
  // ── the day is the unit, not the row ────────────────────────────────────
  //
  // This mapped one point per LOG ENTRY, and a movement is written as one entry
  // each time it is saved: a member who logs three sets of bench, walks away and
  // comes back for two more has two rows on one afternoon, and a double tap on
  // Save has four. So "Sessions 12" was a count of saves rather than of
  // sessions, "Best" was unaffected but the LINE was three points stacked on a
  // single Tuesday — src/lib/exerciseHistory.ts calls that exact shape "a
  // picture of a plateau drawn out of a double tap", and folds by day for it.
  // The best estimated max of the day is that day's point, which is the same
  // rule `bestOf` already applies inside one entry.
  const allSessions = useMemo(() => {
    if (!selName) return [] as { t: string; v: number | null }[];
    const byDay = new Map<string, { t: string; v: number | null }>();
    for (const e of log) {
      if (e.exercise !== selName || !e.sets || !e.sets.length) continue;
      // Null when the timestamp will not parse. Such an entry is dropped rather
      // than filed under today — inventing a training day out of a parsing
      // failure is the defect src/lib/ownTraining.ts documents — and it charted
      // as a point at the Unix epoch before.
      const day = dayKeyOf(e.t);
      if (!day) continue;
      const v = bestOf(e, weightSeries);
      const cur = byDay.get(day);
      // The day's best, and the LATEST instant of it, so the axis label reads
      // as the day rather than as whichever save happened to win.
      if (!cur) byDay.set(day, { t: e.t, v });
      else byDay.set(day, {
        t: Date.parse(e.t) > Date.parse(cur.t) ? e.t : cur.t,
        // The best READABLE max of the day. `Math.max` over a null would have
        // coerced it to zero and handed the day a max of nothing — the
        // afternoon a member did their squats and then a plank would have
        // charted at the plank.
        v: cur.v == null ? v : v == null ? cur.v : Math.max(cur.v, v),
      });
    }
    return [...byDay.values()].sort((a, b) => +new Date(a.t) - +new Date(b.t));
  }, [log, selName, weightSeries]);
  // How many points the sparkline draws. Twelve is a chart decision — a line
  // through forty points on a phone is a smudge — and it was silently a
  // FIGURE decision too: "Sessions" printed the length of the sliced array and
  // "Best" was the best of those twelve, so a lifter with forty logged bench
  // sessions was told "Sessions 12" and shown a personal best that was only the
  // best of the last quarter of their training. Neither line named the window.
  const CHART_SESSIONS = 12;
  const series = useMemo(() => allSessions.slice(-CHART_SESSIONS), [allSessions]);
  // ── the days that produced a reading, out of the days on the axis ───────
  //
  // A day with no readable estimated max is a gap in the line (see `bestOf`),
  // and every figure beside the chart has to be computed over the readings
  // rather than over the slots. `Math.max(1, ...)` used to do this job and did
  // it by floor: a member with no priceable set anywhere got a "Best" of 1 kg,
  // which is a figure nobody lifted printed as if somebody had.
  const readable = useMemo(() => series.filter((s): s is { t: string; v: number } => s.v != null), [series]);
  // Over everything read, not over the twelve on the chart.
  const allReadable = useMemo(() => allSessions.filter((s): s is { t: string; v: number } => s.v != null), [allSessions]);
  const maxE = allReadable.length ? Math.max(...allReadable.map((s) => s.v)) : null;
  const first = readable.length ? readable[0].v : null;
  const last = readable.length ? readable[readable.length - 1].v : null;
  // The span, converted once, and null when either end of it was never
  // measured. It was `last - first` over two stand-in zeros, so a movement with
  // no priceable set reported a change of nothing as though it had been weighed.
  const deltaShown = first != null && last != null ? weightDeltaIn(last - first, wu) : null;

  // ── the other quantity, on its own axis ────────────────────────────────
  //
  // A hold is a duration and a lift is a mass, and nothing above may compare
  // them — see `bestOf`. What was missing is the other half of that: having
  // taken planks and dead hangs off every chart they do not belong on, the app
  // never gave them one they do. `holdRecords` on Records is a BOARD — one row,
  // one best, the day it happened — so a member whose hang has gone from twenty
  // seconds to seventy across four months reads a single "1:10" and nothing
  // that says it moved.
  //
  // Its own chips, its own selection and its own seconds. Deliberately not a
  // second line on the chart above: two units on one axis is the bug, drawn.
  const holdNames = useMemo(() => heldMovements(log).slice(0, 24), [log]);
  const [holdSel, setHoldSel] = useState<string | null>(null);
  const holdName = holdSel || holdNames[0] || null;
  const allHolds = useMemo(() => (holdName ? holdSeries(log, holdName) : []), [log, holdName]);
  // The same twelve-point window as the strength chart, and the same duty to
  // say so when the figures beside it count more days than the line draws.
  const holds = useMemo(() => allHolds.slice(-CHART_SESSIONS), [allHolds]);
  const holdBest = allHolds.length ? Math.max(...allHolds.map((p) => p.secs)) : null;
  const holdNow = holds.length ? holds[holds.length - 1].secs : null;
  // Seconds, and no conversion anywhere: a second is a second in both units,
  // which is exactly why a hold may not be drawn against a load. Null when
  // there is only one day, because one hold is not a direction of travel.
  const holdMoved = holdChangeSecs(holds);
  const holdNote = holdLoadNote(holds);

  // Presentation-only: this week is the last bucket; a flat run of zeros is not
  // a trend, so the chart only draws once something has actually been lifted.
  const thisWeek = weeks[weeks.length - 1];
  const weekNote = tonnageNote({ kg: thisWeek.vol, unknownSets: thisWeek.unpriced });
  /** The sentence under this week's figure: the days trained, or which of the
   *  three ways the log could not answer. A short read is never "a quiet
   *  week". */
  const weekLine = logStatus === 'loading' ? 'Reading your training log…'
    : logStatus === 'partial' ? 'More logged than this screen can read at once, so the weekly figures would be short.'
    : !logKnown ? 'We couldn’t read your training log — this is not a week with nothing in it.'
    : thisWeek.days
    ? `${thisWeek.days} training day${thisWeek.days === 1 ? '' : 's'} this week`
    : 'Nothing logged this week yet.';
  const anyVolume = weeks.some((w) => w.vol > 0);
  const bestWeek = weeks.reduce((m, w) => (w.vol > m.vol ? w : m), weeks[0]);

  // ── which lift is where ──────────────────────────────────────────────────
  //
  // The chart above says the week's tonnage moved and never says which movement
  // moved it. `suggestProgression` in src/lib/progression.ts has answered that
  // per lift since it was written and nothing on this screen had ever asked it.
  //
  // What it answers, exactly: `latestByExercise` keeps the MOST RECENT logged
  // entry for each movement and reads that one entry. So a verdict is a reading
  // of one session — the top-weight sets of it against a rep range — and it is
  // not a direction of travel, however much a screen called Trends wants it to
  // be. Nothing below is allowed to word it as one.
  // Today's readiness, read once for the whole list. Null when there is no
  // reading at all — no device, no sleep logged, or a read that failed — and
  // `temperByReadiness` then leaves every line exactly as the progression rule
  // wrote it and says nothing, because an app that cannot measure readiness
  // must not imply that it did.
  const { readiness } = useReadiness();
  const verdicts = useMemo(() => suggestProgression(log, wu), [log, wu]);
  // Six, because this is a summary and Targets is the list. Named as a count
  // with the rest said out loud rather than trailing off: a lift that drops
  // silently off the end of a list reads as a lift that is fine.
  const VERDICTS_SHOWN = 6;
  const shownVerdicts = verdicts.slice(0, VERDICTS_SHOWN);
  // Movements with sets on them that got no verdict at all. `liftedSets` in
  // src/lib/progression.ts keeps only sets with BOTH reps and a load on them,
  // and drops holds outright — so a pull-up done by somebody who has never been
  // weighed, a plank and a bodyweight squat all fall out of the answer above.
  // They are real training and the rule simply has nothing to say about them,
  // which is not the same thing as a lift that is going fine.
  const noVerdict = useMemo(
    () => movements.filter((n) => !verdicts.some((v) => v.exercise === n)),
    [movements, verdicts],
  );
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board's pushed-page head: back, the title centred. */}
        <PageHead title="Trends" />

        {/* ── THE HERO: this week's tonnage over the ten weeks behind it ─────
            One tinted card, as the approved Progress mockup draws its figure:
            the number, the sentence that qualifies it, and the chart it is the
            last point of. They were two cards — a figure, then a chart with the
            same figure repeated under it — and a reader had to join them. */}
        <View style={{ backgroundColor: t.brandSoft, borderRadius: radius.xl, padding: 18, marginTop: 14, ...elevation.card }}>
          {/* Label, figure, unit and sentence are one fact, and one stop. */}
          <View accessible accessibilityLabel={['Lifted This Week', [logKnown ? fig(volumeIn(thisWeek.vol, wu)?.toLocaleString()) : fig(null), logKnown ? wu : undefined].filter(Boolean).join(' '), weekLine].filter(Boolean).join(', ')}>
            <Text style={{ ...ty.micro, color: t.ink2 }}>Lifted This Week</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              {/* Shrunk to fit and never wrapped: a figure broken across two lines
                  is a figure read wrong. */}
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.35}
                style={{ ...ty.hero, ...numeric, color: t.ink, flexShrink: 1 }}>{logKnown ? fig(volumeIn(thisWeek.vol, wu)?.toLocaleString()) : fig(null)}</Text>
              {logKnown ? (
                <Text numberOfLines={1} style={{ ...ty.section, ...font('600', 'display'), color: t.ink2, marginStart: 6, flexShrink: 0 }}>{wu}</Text>
              ) : null}
            </View>
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{weekLine}</Text>
          </View>
          {/* And said whenever the tonnage above is short. A bodyweight set
              whose load nobody has recorded is real training that cannot be
              weighed, and a figure printed over it without this is understating
              the week while looking exactly like a measurement. */}
          {logKnown && weekNote ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{weekNote}</Text> : null}

          <View style={{ marginTop: sp.md }}>
          {anyVolume ? (
            /* The week each column belongs to. Ten bars of tonnage with no
               dates under them told a member the shape of their training and
               not when any of it happened. */
            /* Converted, because the readout now carries a unit. `w.vol` is
               kilograms; labelling it "lb" without passing it through
               volumeIn would put the reader's unit on somebody else's number,
               which is the one thing the units module exists to prevent. The
               tiles under the card convert the same way. */
            <Spark area data={weeks.map((w) => volumeIn(w.vol, wu))} labels={weeks.map((w) => w.iso)} unit={` ${wu}`} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {/* Four arms, matching the Strength Trend block below, which has
                  had them all along. `logKnown` is `isWhole(logStatus)`, so it
                  is false while the FIRST read is still in flight — and this
                  screen therefore opened, on every launch, by telling every
                  member that their training log could not be read. It is also
                  false under 'partial', where the log very much was read. Two
                  sections on one screen, one telling the truth about the same
                  status and one not. */}
              {logKnown
                ? 'No training volume logged yet — the trend charts as soon as you log a set.'
                : logStatus === 'loading' ? 'Reading your training log…'
                : logStatus === 'partial' ? 'More logged sets than this screen can read at once, so there is no honest ten-week total to chart over them.'
                : 'We couldn’t read your training log, so there is nothing to chart here yet. Your history is intact.'}
            </Text>
          )}
          </View>
          {anyVolume ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{`Total ${wu} lifted · last ${WEEKS} weeks`}</Text> : null}
          {/* Said once, under the chart, rather than beside each figure: a
              pounds reader is reading kilograms converted, and their coach's
              console is not, so the two disagreeing is worth explaining before
              it is seen. */}
          {unitNote ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{unitNote}</Text> : null}
          {/* The one Ghost this screen already has points at Targets, which is
              no use to a member with nothing logged. Only on the `logKnown`
              arm — the other three are a read in flight, a read that was cut
              short, and a read that failed, and none of them is answered by
              logging another set. */}
          {!anyVolume && logKnown ? (
            <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
              <Ghost label="Log a Workout" onPress={() => router.push(trainIntent('/(client)/workouts') as any)} />
            </View>
          ) : null}
        </View>

        {/* ── three figures with the ten weeks behind each ──────────────────
            On the ground under the hero. Every one is a figure over the WHOLE
            log, so every one is a dash — and its trend an empty strip — under
            a read that was not whole: "best week" over the part that came back
            is the best of a sample. This week's tonnage is not repeated here;
            the hero is it. */}
        <KpiRow tiles items={[
          { label: 'Training Days', tone: 'blue', value: logKnown ? fig(thisWeek.days) : fig(null),
            trend: logKnown ? weeks.map((w) => w.days) : [] },
          { label: logKnown && anyVolume ? `Best Week · w/c ${bestWeek.label}` : 'Best Week', tone: 'orange',
            value: logKnown ? fig(volumeIn(bestWeek.vol, wu)?.toLocaleString()) : fig(null), unit: logKnown ? wu : undefined,
            trend: logKnown ? weeks.map((w) => volumeIn(w.vol, wu)) : [] },
          { label: `Weeks Trained of ${WEEKS}`, tone: 'purple', value: logKnown ? fig(weeks.filter((w) => w.days > 0).length) : fig(null) , trend: [] },
        ]} />

        {/* ── per-exercise est-1RM ───────────────────────────────────────── */}
        <Section>
          <SectionHead title="Strength Trend" note="Estimated 1-rep max" />
          {exercises.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {logKnown ? 'Log a few sets and your strength trend shows up here.' : logStatus === 'loading' ? 'Reading your logged sets…' : logStatus === 'partial' ? 'More logged sets than this screen can read at once, so there is no honest trend to draw over them.' : 'We couldn’t read your logged sets, so there is no strength trend to draw.'}
            </Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingEnd: G }}>
                {exercises.map((n) => {
                  const on = n === selName;
                  return (
                    // Which movement the chart below is OF, said rather than
                    // only coloured. Every figure under this row — the trend,
                    // the delta, the best set — is about the chip that is lit,
                    // and a member who cannot see the fill was reading numbers
                    // with no subject attached to them.
                    // The chip READS in the reader's language and the selection
                    // stays keyed on `n`, the English name the log is written
                    // under — see useMovementName in src/ui/catalogueTranslations.
                    <Pressable key={n} onPress={() => setSel(n)}
                      accessibilityRole="button" accessibilityLabel={movement(n)} accessibilityState={{ selected: on }}
                      style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.caption, ...font(on ? '600' : '500'), color: on ? t.brandInk : t.ink2 }} numberOfLines={1}>{movement(n)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={{ height: sp.lg }} />
              {series.length >= 1 ? (
                <>
                  <KpiRow items={[
                    {
                      // The change is `weightDeltaIn`, not the difference of the
                      // two converted ends. Both ends are estimates already
                      // rounded to whole kilograms, so subtracting their rounded
                      // pound readings lets a pound of rounding at each end move
                      // the answer — an unchanged 1RM could report a pound of
                      // progress, and a genuine 2.5 kg gain could read as 5 lb
                      // one session and 6 lb the next.
                      // Gated like the volume row above it. Under 'partial'
                      // `series` is whatever fitted in the read, so the count,
                      // the maximum and the baseline day are all figures over
                      // an unknown fraction of the member's training — and the
                      // "since" date is not when they started, it is where the
                      // read stopped.
                      label: 'Est. 1RM', value: logKnown && last != null ? fig(est1RMIn(last, wu)) : fig(null), unit: logKnown && last != null ? wu : undefined,
                      // `deltaShown >= 0` put a plus on an unchanged 1RM, and
                      // `delta >= 0` gave that same nothing the accent dot the
                      // row uses to mean "you moved the right way". Both now
                      // ask the figure that is printed, which has its own arm
                      // for nothing. The day the session series starts is named
                      // rather than left to be inferred from the chart below.
                      // `since` is the first day that produced a READING, not
                      // the first slot on the chart: a line that opens with a
                      // gap was dating its own change from a day it has no
                      // figure for.
                      good: logKnown && deltaShown != null && deltaMoved(deltaShown) ? deltaSign(deltaShown) === '+' : undefined,
                      delta: logKnown && readable.length >= 2 && deltaShown != null && deltaMoved(deltaShown)
                        ? deltaLabel(deltaShown, { since: shortDayLabel(readable[0].t), unit: wu })
                        : logKnown ? undefined : 'not all read',
                    },
                    { label: 'Best', value: logKnown && maxE != null ? fig(est1RMIn(maxE, wu)) : fig(null), unit: logKnown && maxE != null ? wu : undefined },
                    // Days this movement was trained — see the fold in
                    // `allSessions`, which keys a Map by `dayKeyOf(e.t)` and
                    // keeps one point per day. Counted per row it read
                    // "Sessions 12" over eight afternoons; folded by day it
                    // still SAID "Sessions", which is the same false claim with
                    // the arithmetic already fixed underneath it. The label is
                    // what was left. This file argues the point itself 270
                    // lines above — "calling the field `sessions` was how the
                    // same figure got read as a session count on three other
                    // screens" — and src/lib/streaks.ts settles it: a session
                    // count cannot be derived from this data at all, because
                    // one visit is saved as it goes and produces seven rows
                    // with seven distinct timestamps. Days is what is provable.
                    { label: 'Days Trained', value: logKnown ? fig(allSessions.length) : fig(null) },
                  ]} />
                  {/* Said only when the chart is showing less than the two
                      figures above it count. Without it the line and the
                      numbers describe two different spans of training and
                      nothing on the screen says so. */}
                  {logKnown && allSessions.length > series.length ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      Best and Days Trained count all {allSessions.length} days you trained this movement. The chart below draws the last {series.length}.
                    </Text>
                  ) : null}
                  {series.length >= 2 ? (<>
                    <View style={{ height: sp.lg }} />
                    {/* The hand-rolled end labels that used to sit here are
                        gone: <Spark> draws its own axis from the same dates it
                        plots. They also ran `new Date(s.t).getDate()` over a
                        bare 'YYYY-MM-DD', which is UTC midnight read through a
                        local getter — so west of Greenwich the first and last
                        sessions were both reported a day early. */}
                    <Spark area tone="blue" data={series.map((s) => s.v)} labels={series.map((s) => s.t)} />
                  </>) : null}
                  {/* A break in the line is a day this rule could not price,
                      and an unexplained hole reads as a day off. It is not:
                      it is a day whose sets were all at a bodyweight nobody
                      has recorded — the one thing the member can actually do
                      something about. */}
                  {logKnown && readable.length < series.length ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      The line breaks where a day had no set this rule could price — a set done at your own
                      bodyweight needs a weight on record for that day. Those days are still on the axis.
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={{ ...ty.label, color: t.ink3 }}>No sets logged for this exercise yet.</Text>
              )}
            </>
          )}
        </Section>

        {/* ── how long you held it ───────────────────────────────────────
            A chart of its own, in seconds, and never a line on the one above.

            The app has prescribed holds since `buildProgram` was written, has
            accepted them since src/lib/timedSets.ts, and refuses — correctly —
            to price one as tonnage or as an estimated max. Records prints the
            longest ever. Nothing anywhere drew the one thing isometric training
            actually gives you, which is that the number goes up.

            Three things this section is careful about:

            · The axis is seconds and carries nothing else. A 60-second hold
              with a plate is a harder 60 seconds than a bare one and it is
              plotted at the same height, so `holdLoadNote` says so rather than
              folding the plate into the duration.
            · "Best" is the best HOLD, compared against holds. It is never put
              beside the est-1RM above, and the two are not summed, ranked or
              differenced anywhere on this screen.
            · The figures are gated on `logKnown` like every other figure here.
              A longest-ever over a truncated read is a subtotal wearing a
              record's clothes. */}
        {holdNames.length ? (<>
          <Section>
            <SectionHead title="Hold Trend" note="Time held" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingEnd: G }}>
              {holdNames.map((n) => {
                const on = n === holdName;
                return (
                  // Reads in the member's language, keyed on the English name
                  // the log is written under — the same rule as the chip row
                  // above it.
                  <Pressable key={n} onPress={() => setHoldSel(n)}
                    accessibilityRole="button" accessibilityLabel={movement(n)} accessibilityState={{ selected: on }}
                    style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                    <Text style={{ ...ty.caption, ...font(on ? '600' : '500'), color: on ? t.brandInk : t.ink2 }} numberOfLines={1}>{movement(n)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ height: sp.lg }} />
            <KpiRow items={[
              {
                // ── the label, and what the figure under it actually is ──
                //
                // This read "Longest Held" and printed `holdNow`, which is
                // `holds[holds.length - 1].secs` — the LATEST day's hold. The
                // longest is the KPI immediately to its right, labelled
                // "Best", so a member whose plank has gone 70 s → 45 s → 30 s
                // read "Longest Held 0:30" beside "Best 1:10" — one row, two
                // figures, and the smaller of them claiming to be the larger.
                //
                // The figure is the right one to lead with and the delta under
                // it settles which: `holdChangeSecs` is first → last, so it
                // measures to THIS value and to no other. The name of the
                // column was what was wrong, and it is the name that changed —
                // the same pairing the strength row above already uses, where
                // "Est. 1RM" is the latest and "Best" is the maximum.
                label: 'Last Hold',
                value: logKnown && holdNow != null ? holdLabel(holdNow) : fig(null),
                // Through `deltaLabel`, not a hand-rolled sign — it owns the
                // arm for nothing moved ("No change since 4 May", never "+0 s")
                // and takes the day measured FROM as a required field.
                // Whole seconds: `decimals: 0`, because the log stores a hold as
                // a whole second and a tenth here would be a place finer than
                // the record it came from.
                good: logKnown && deltaMoved(holdMoved, 0) ? deltaSign(holdMoved, 0) === '+' : undefined,
                delta: logKnown && holds.length >= 2
                  ? deltaLabel(holdMoved, { since: shortDayLabel(holds[0].t), unit: 's', decimals: 0 })
                  : logKnown ? undefined : 'not all read',
              },
              { label: 'Best', value: logKnown && holdBest != null ? holdLabel(holdBest) : fig(null) },
              { label: 'Days Held', value: logKnown ? fig(allHolds.length) : fig(null) },
            ]} />
            {logKnown && allHolds.length > holds.length ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Best and Days Held count all {allHolds.length} days you held this movement. The chart below draws the last {holds.length}.
              </Text>
            ) : null}
            {holds.length >= 2 ? (<>
              <View style={{ height: sp.lg }} />
              {/* Seconds, stated as seconds. <Spark> draws its own axis from
                  the same days it plots, so the dates under the line are the
                  days of the holds above them rather than a hand-rolled row
                  that has to be kept in step. */}
              <Spark area tone="purple" data={holds.map((p) => p.secs)} labels={holds.map((p) => p.day)} unit=" s" />
            </>) : null}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {holds.length < 2
                ? 'One day so far. Log this hold again and the line draws.'
                : 'Your longest hold of each day. A hold is time, not weight, so it is never added to the tonnage above or read as an estimated max.'}
            </Text>
            {holdNote ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{holdNote}</Text>
            ) : null}
          </Section>
        </>) : null}


        {/* ── which lift is where ─────────────────────────────────────────
            The two charts above say the tonnage moved and never say which
            movement moved it. This does — off `suggestProgression`, which has
            produced exactly this reading per lift since it was written and
            which nothing on this screen had ever called.

            Three things it is careful not to say, each of them a sentence the
            data does not support:

            · Not a trend. The rule reads ONE session per movement, so every
              line here describes a day. "Stalled" and "plateaued" are claims
              about a run of sessions and none of them is available here — the
              wording is `ACTION_READING`, which is written in the past tense
              about that single session on purpose.
            · Not a total. Under a truncated read the log holds the newest
              sessions (workoutLog orders `performed_at` descending), so every
              verdict below is drawn from a real latest session — but a movement
              trained only before the cut is absent altogether, which makes the
              LIST a floor even though each line on it is whole.
            · Not silent about what it skipped. A movement whose sets carry no
              load gets no verdict, and it is named rather than dropped. */}
        <Section>
          {/* A description of the ordering rather than a claim about the data,
              so it is true under every read state that has rows to order. */}
          <SectionHead title="Lift by Lift" note={verdicts.length ? 'Heaviest first' : undefined} />
          {/* Four arms, and each of the two bad ones splits again on whether
              there are rows underneath it. `useWorkoutLog` does not clear `log`
              on a failed refresh, so "there is nothing to read" printed above a
              list of lifts is the contradiction app/(client)/progression.tsx
              already had to write its way out of — it names what the rows ARE
              instead. Same answer here. */}
          {!logKnown ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: verdicts.length ? sp.md : 0 }}>
              {logStatus === 'loading'
                ? verdicts.length
                  ? 'Still reading your training log — these are the lifts it was already holding, so your last session may not be in them yet.'
                  : 'Reading your training log…'
                : logStatus === 'partial'
                ? 'More logged sets than this screen can read at once. The log comes back newest first, so each line below is drawn from a real last session — but a movement you last trained before the read stopped is not on the list at all, which makes this at least what you have been training rather than all of it.'
                : verdicts.length
                ? 'We couldn’t read your training log, so the lines below come from what this phone was already holding and may not include your last session.'
                : 'We couldn’t read your training log, so there is nothing to read lift by lift. This is not a record with nothing in it.'}
            </Text>
          ) : null}
          {verdicts.length === 0 ? (
            logKnown ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Nothing here yet — this reads your last session of each lift, and it needs a set with a
                weight on it to read.
              </Text>
            ) : null
          ) : (
            <>
              {shownVerdicts.map((raw, i) => {
                /* ── today's readiness, against what the plan was going to ask
                     for ────────────────────────────────────────────────────
                     `temperByReadiness` may only ever make a suggestion
                     GENTLER. A high score is not evidence anybody can lift
                     more — it is four signals about sleep, a wearable's own
                     verdict, water and recent load, none of which measures
                     strength — so a good day changes nothing here and the
                     line reads exactly as `suggestProgression` wrote it.
                     When it does change, the reason is printed under it:
                     a suggestion that quietly differs from the rule that made
                     it is indistinguishable from a broken rule. */
                const { tip: v, note } = temperByReadiness(raw, readiness, liftLabel(raw.lastWeight, wu));
                return (
                <View key={v.exercise}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flex: 1 }}>
                    {/* The chip row above reads in the member's language and
                        keys on the English name; the same rule here. */}
                    <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }}>{movement(v.exercise)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {shortDayLabel(v.at)} · {fig(liftLabel(v.lastWeight, wu))} × {v.lastReps}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {ACTION_READING[v.action]}
                    </Text>
                    {note ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{note}</Text>
                    ) : null}
                  </View>
                  {/* The rule's word as a chip. The same four tones Targets draws
                      them in: green adds load, amber takes it off, blue and
                      grey leave the bar alone —
                      and the word is the reading; the colour only finds it. */}
                  <TonedChip label={ACTION_LABEL[v.action]} tone={v.action === 'increase' ? 'brand' : v.action === 'reps' ? 'blue' : v.action === 'deload' ? 'amber' : 'neutral'} />
                </View>
                );
              })}
              {verdicts.length > shownVerdicts.length ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Your {shownVerdicts.length} heaviest lifts. The other {verdicts.length - shownVerdicts.length} read
                  the same way and are all on Targets.
                </Text>
              ) : null}
              <View style={{ marginTop: sp.md }}>
                <Expandable title="How to Read This">
                  <Text style={{ ...ty.caption, color: t.ink3, }}>
                    Each line reads your most recent session of that lift and nothing before it, so it says where
                    that day landed rather than where the lift is heading. One session is not a direction and two
                    are not either — the chart above is where a movement over time is drawn.
                  </Text>
                </Expandable>
              </View>
            </>
          )}
          {/* Said whether or not there were verdicts, and gated on the read
              like everything else: naming what got no reading is a statement
              about the member's log, and a log that did not finish loading
              cannot support one. */}
          {logKnown && noVerdict.length ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              No reading for {noVerdict.slice(0, 4).map(movement).join(', ')}
              {noVerdict.length > 4 ? `, and ${noVerdict.length - 4} more` : ''}. This rule works from the
              weight on the bar, and a set done at your own bodyweight or held for time does not carry one —
              so there is nothing here to read, which is not the same as nothing to worry about.
            </Text>
          ) : null}
          {/* Not gated on the read. The screen that turns these readings into a
              load on a bar is worth reaching from here in every state that has
              a reading in it, and it carries its own notice about a read that
              did not finish. */}
          {verdicts.length ? (
            <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
              <Ghost label="See Your Targets" onPress={() => router.push('/(client)/progression')} />
            </View>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
