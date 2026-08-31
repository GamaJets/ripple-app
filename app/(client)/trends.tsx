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
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { isWhole } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { volumeIn, est1RMIn, weightDeltaIn, convertedNote } from '../../src/lib/units';
import { est1RM } from '../../src/lib/streaks';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Spark, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';

const WEEKS = 10;

function mondayOf(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); const back = (x.getDay() + 6) % 7; x.setDate(x.getDate() - back); return x; }
function volumeOf(e: WorkoutEntry): number { return (e.sets || []).reduce((a, s) => a + (s[0] || 0) * (s[1] || 0), 0); }
function bestOf(e: WorkoutEntry): number { return (e.sets || []).reduce((m, s) => Math.max(m, est1RM(s[1] || 0, s[0] || 0)), 0); }

export default function Trends() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus } = useWorkoutLog();
  // Every figure on this screen is a lifted load or a sum of them, and the
  // tester's report was about exactly these: "Don't have choice of units for
  // exercise / weights being used." The arithmetic below stays in the
  // kilograms the log is stored in — a chart drawn from converted values would
  // have a different shape for a pounds reader — and only the printed figures
  // convert, at the edge, in src/lib/units.ts.
  const wu = useSettings().weightUnit;
  const unitNote = convertedNote(wu);
  // Under 'error' the log is empty because it could not be read, so every
  // tonnage below reduces to zero and gets printed with a thousands separator
  // and a unit — the full costume of a measured figure. "Best week" is the
  // sharpest of them: it is the maximum over the ten weeks that loaded, so a
  // partial read quietly nominates the wrong week as the client's best ever.
  // The comment above named 'partial' and the guard did not exclude it, so the
  // sentence describing the bug shipped alongside the bug. `isWhole` is the
  // gate loadStatus.ts asks for and is false for 'partial' and 'loading' both.
  const logKnown = isWhole(logStatus);

  // Weekly training volume (last 10 weeks, oldest → newest).
  const weeks = useMemo(() => {
    const thisMon = mondayOf(new Date());
    const out: { label: string; iso: string; vol: number; sessions: number }[] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const start = new Date(thisMon); start.setDate(thisMon.getDate() - w * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const inWk = log.filter((e) => { const d = new Date(e.t); return d >= start && d < end; });
      const days = new Set(inWk.map((e) => new Date(e.t).toDateString()));
      // `label` is the terse "12/8" the Best Week chip has always shown;
      // `iso` is the same Monday as data, for the chart axis to format. Built
      // from local getters, never from a string, so the week a member is
      // standing in is the week they are shown — see src/lib/localDate.ts.
      const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      out.push({ label: `${start.getDate()}/${start.getMonth() + 1}`, iso, vol: inWk.reduce((a, e) => a + volumeOf(e), 0), sessions: days.size });
    }
    return out;
  }, [log]);
  const maxVol = Math.max(1, ...weeks.map((w) => w.vol));

  // Exercises that have logged sets (skip pure cardio) → trend of best est-1RM.
  const exercises = useMemo(() => {
    const names: string[] = [];
    for (const e of log) { if (e.sets && e.sets.length && !names.includes(e.exercise)) names.push(e.exercise); }
    return names.slice(0, 24);
  }, [log]);
  const [sel, setSel] = useState<string | null>(null);
  const selName = sel || exercises[0] || null;

  const series = useMemo(() => {
    if (!selName) return [] as { t: string; v: number }[];
    return log.filter((e) => e.exercise === selName && e.sets && e.sets.length)
      .map((e) => ({ t: e.t, v: bestOf(e) }))
      .sort((a, b) => +new Date(a.t) - +new Date(b.t))
      .slice(-12);
  }, [log, selName]);
  const maxE = Math.max(1, ...series.map((s) => s.v));
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
  const anyVolume = weeks.some((w) => w.vol > 0);
  const bestWeek = weeks.reduce((m, w) => (w.vol > m.vol ? w : m), weeks[0]);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>See your training move over time</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Trends</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── the hero: this week's tonnage ──────────────────────────────── */}
        <Hero
          label="Lifted This Week"
          figure={logKnown ? fig(volumeIn(thisWeek.vol, wu)?.toLocaleString()) : fig(null)}
          unit={logKnown ? wu : undefined}
          note={logStatus === 'loading' ? 'Reading your training log…' : logStatus === 'partial' ? 'More logged than this screen can read at once, so the weekly figures would be short.' : !logKnown ? 'We couldn’t read your training log — this is not a week with nothing in it.'
            : thisWeek.sessions
            ? `${thisWeek.sessions} training day${thisWeek.sessions === 1 ? '' : 's'} since Monday`
            : 'No sessions logged this week yet.'}
        />

        {/* Said once, under the hero, rather than beside each figure: a pounds
            reader is reading kilograms converted, and their coach's console is
            not, so the two disagreeing is worth explaining before it is seen. */}
        {unitNote ? <Text style={{ ...ty.caption, color: t.ink3 }}>{unitNote}</Text> : null}

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
              {logKnown
                ? 'No training volume logged yet — the trend charts as soon as you log a set.'
                : 'We couldn’t read your training log, so there is nothing to chart here yet. Your history is intact.'}
            </Text>
          )}
          <View style={{ height: sp.lg }} />
          <KpiRow items={[
            { label: 'This Week', value: logKnown ? fig(volumeIn(thisWeek.vol, wu)?.toLocaleString()) : fig(null), unit: logKnown ? wu : undefined },
            { label: 'Training Days', value: logKnown ? fig(thisWeek.sessions) : fig(null) },
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
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingRight: G }}>
                {exercises.map((n) => {
                  const on = n === selName;
                  return (
                    <Pressable key={n} onPress={() => setSel(n)}
                      style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.caption, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }} numberOfLines={1}>{n}</Text>
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
                      label: 'Est. 1RM', value: fig(est1RMIn(last, wu)), unit: wu,
                      good: delta >= 0,
                      delta: series.length >= 2 && deltaShown != null ? `${deltaShown >= 0 ? '+' : '−'}${Math.abs(deltaShown)} ${wu}` : undefined,
                    },
                    { label: 'Best', value: fig(est1RMIn(maxE, wu)), unit: wu },
                    { label: 'Sessions', value: fig(series.length) },
                  ]} />
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
      </ScrollView>
    </SafeAreaView>
  );
}
