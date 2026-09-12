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
import { useClientData } from '../../src/ui/clientData';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Spark, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { startOfWeek } from '../../src/lib/weekStart';
import { fmtAxisDay } from '../../src/lib/format';
// The local calendar day of an instant, so one movement done twice in an
// afternoon is one point on the trend rather than two.
import { dayKeyOf } from '../../src/lib/entryEdit';
import { BACK_ICON } from '../../src/ui/direction';
import { useMovementName } from '../../src/ui/catalogueTranslations';

const WEEKS = 10;

// Tonnage and best estimated max now go through src/lib/bodyweightSets.ts,
// which is what lets a pull-up onto these charts. Both used to read a set's
// second number as the load, and on a bodyweight set that number is zero — so
// a member who trains on rings charted a flat run of zeros across ten weeks
// and was told they had logged no volume at all.
function bestOf(e: WorkoutEntry, history: BodyweightHistory): number {
  return (e.sets || []).reduce((m, s, i) => {
    const load = setLoadKg(e, i, s, history, e.t);
    return load != null && s[0] ? Math.max(m, est1RM(load, s[0])) : m;
  }, 0);
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
  const exercises = useMemo(() => movements.slice(0, 24), [movements]);
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
    if (!selName) return [] as { t: string; v: number }[];
    const byDay = new Map<string, { t: string; v: number }>();
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
        v: Math.max(cur.v, v),
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
  // Over everything read, not over the twelve on the chart.
  const maxE = Math.max(1, ...allSessions.map((s) => s.v));
  const first = series.length ? series[0].v : 0;
  const last = series.length ? series[series.length - 1].v : 0;
  const delta = last - first;
  // The span, converted once. Null only if the series is empty, which the
  // `series.length >= 2` guard below already excludes — so the KPI is never
  // handed a stand-in zero for a change nobody measured.
  const deltaShown = weightDeltaIn(delta, wu);

  // Presentation-only: this week is the last bucket; a flat run of zeros is not
  // a trend, so the chart only draws once something has actually been lifted.
  const thisWeek = weeks[weeks.length - 1];
  const weekNote = tonnageNote({ kg: thisWeek.vol, unknownSets: thisWeek.unpriced });
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>See your training move over time</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Trends</Text>
          </View>
        </View>

        {/* ── the hero: this week's tonnage ──────────────────────────────── */}
        <Hero
          label="Lifted This Week"
          figure={logKnown ? fig(volumeIn(thisWeek.vol, wu)?.toLocaleString()) : fig(null)}
          unit={logKnown ? wu : undefined}
          note={logStatus === 'loading' ? 'Reading your training log…' : logStatus === 'partial' ? 'More logged than this screen can read at once, so the weekly figures would be short.' : !logKnown ? 'We couldn’t read your training log — this is not a week with nothing in it.'
            : thisWeek.days
            ? `${thisWeek.days} training day${thisWeek.days === 1 ? '' : 's'} this week`
            : 'Nothing logged this week yet.'}
        />

        {/* Said once, under the hero, rather than beside each figure: a pounds
            reader is reading kilograms converted, and their coach's console is
            not, so the two disagreeing is worth explaining before it is seen. */}
        {unitNote ? <Text style={{ ...ty.caption, color: t.ink3 }}>{unitNote}</Text> : null}
        {/* And said whenever the tonnage above is short. A bodyweight set whose
            load nobody has recorded is real training that cannot be weighed,
            and a hero figure printed over it without this is understating the
            week while looking exactly like a measurement. */}
        {logKnown && weekNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{weekNote}</Text> : null}

        <Rule />

        {/* ── weekly volume ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title={`Weekly volume · last ${WEEKS} weeks`} note={`Total ${wu} lifted`} />
          {anyVolume ? (
            /* The week each column belongs to. Ten bars of tonnage with no
               dates under them told a member the shape of their training and
               not when any of it happened. */
            /* Converted, because the readout now carries a unit. `w.vol` is
               kilograms; labelling it "lb" without passing it through
               volumeIn would put the reader's unit on somebody else's number,
               which is the one thing the units module exists to prevent. The
               KpiRow beside it converts the same way. */
            <Spark data={weeks.map((w) => volumeIn(w.vol, wu))} labels={weeks.map((w) => w.iso)} unit={` ${wu}`} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
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
          <View style={{ height: sp.lg }} />
          <KpiRow items={[
            { label: 'This Week', value: logKnown ? fig(volumeIn(thisWeek.vol, wu)?.toLocaleString()) : fig(null), unit: logKnown ? wu : undefined },
            { label: 'Training Days', value: logKnown ? fig(thisWeek.days) : fig(null) },
            { label: 'Best Week', value: logKnown ? fig(volumeIn(bestWeek.vol, wu)?.toLocaleString()) : fig(null), unit: logKnown ? wu : undefined, delta: logKnown && anyVolume ? `w/c ${bestWeek.label}` : undefined },
          ]} />
        </Section>

        <Rule />

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
                      <Text style={{ ...ty.caption, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }} numberOfLines={1}>{movement(n)}</Text>
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
                      label: 'Est. 1RM', value: logKnown ? fig(est1RMIn(last, wu)) : fig(null), unit: logKnown ? wu : undefined,
                      // `deltaShown >= 0` put a plus on an unchanged 1RM, and
                      // `delta >= 0` gave that same nothing the accent dot the
                      // row uses to mean "you moved the right way". Both now
                      // ask the figure that is printed, which has its own arm
                      // for nothing. The day the session series starts is named
                      // rather than left to be inferred from the chart below.
                      good: logKnown && deltaMoved(deltaShown) ? deltaSign(deltaShown) === '+' : undefined,
                      delta: logKnown && series.length >= 2 && deltaMoved(deltaShown)
                        ? deltaLabel(deltaShown, { since: shortDayLabel(series[0].t), unit: wu })
                        : logKnown ? undefined : 'not all read',
                    },
                    { label: 'Best', value: logKnown ? fig(est1RMIn(maxE, wu)) : fig(null), unit: logKnown ? wu : undefined },
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
                    <Spark data={series.map((s) => s.v)} labels={series.map((s) => s.t)} />
                  </>) : null}
                </>
              ) : (
                <Text style={{ ...ty.label, color: t.ink3 }}>No sets logged for this exercise yet.</Text>
              )}
            </>
          )}
        </Section>

        <Rule />

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
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{movement(v.exercise)}</Text>
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
                  <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>{ACTION_LABEL[v.action]}</Text>
                </View>
                );
              })}
              {verdicts.length > shownVerdicts.length ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Your {shownVerdicts.length} heaviest lifts. The other {verdicts.length - shownVerdicts.length} read
                  the same way and are all on Targets.
                </Text>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Each line reads your most recent session of that lift and nothing before it, so it says where
                that day landed rather than where the lift is heading. One session is not a direction and two
                are not either — the chart above is where a movement over time is drawn.
              </Text>
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
