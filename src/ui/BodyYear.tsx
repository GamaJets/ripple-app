// The year, on the body side.
//
// src/lib/longView.ts opens by observing that every progress screen in this app
// is a slice or a snapshot, and then gives the TRAINING side its year: months of
// tonnage, a lifetime total, an arc from the first month to the last. The body
// side kept only snapshots — the latest scan, the one before it, two days the
// member picked on Compare — so the question people actually ask about their
// own body ("how far have I come?") had no screen anywhere.
//
// This is the panel for it. The arithmetic is in src/lib/bodyLongView.ts, pure
// and tested under plain node; everything here is presentation, the read status,
// and the conversion at the edge.
//
// ── Three things it will not do ───────────────────────────────────────────
//
// · Draw over a read it does not trust. A year assembled from a truncated scan
//   list is a subtotal of somebody's history wearing a history's clothes, so
//   `isWhole` gates the whole panel and each failing status gets its own
//   sentence. See src/ui/loadStatus.ts.
// · Fill a hole. An unmeasured month is null all the way through, <Spark> draws
//   a null as a GAP, and the axis keeps the month's slot so the dates under the
//   line stay under their own points.
// · Convert twice. The arithmetic is in the unit the reading is stored in; a
//   VALUE converts point by point through `weightIn` and a CHANGE converts as a
//   change through `weightDeltaIn` — subtracting two separately rounded pound
//   figures is the defect src/lib/units.ts exists to prevent, and at ±1 lb of
//   rounding at each end it can turn an unchanged year into two pounds of
//   progress.
import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, KpiRow, Spark, fig } from './kit';
import { sp, radius, type as ty } from '../theme/scale';
import { isWhole, type LoadStatus } from './loadStatus';
import { weightIn, weightDeltaIn, type WeightUnit } from '../lib/units';
import { deltaLabel, movementIsProgress, type BodyMetric as GoalMetric } from '../lib/deltaLabel';
import type { Goal } from '../lib/types';
import type { ScanReading } from '../lib/photoCompare';
import {
  bodyMonthlyHistory, bodyArc, bodyHistoryNote, bodyStage, metricOf, measuredMonths,
  monthsSinceMeasured, type BodyMetric,
} from '../lib/bodyLongView';

/** The three a scan reports, in the order the body screens already list them. */
const METRICS: { key: BodyMetric; label: string; goal: GoalMetric }[] = [
  { key: 'weightKg', label: 'Weight', goal: 'weight' },
  { key: 'bodyFatPct', label: 'Body Fat', goal: 'bodyFat' },
  { key: 'muscleKg', label: 'Muscle', goal: 'muscle' },
];

/** Body fat is a percentage in every unit system; the two masses follow the
 *  reader's own preference. */
const unitOf = (m: BodyMetric, wu: WeightUnit): string => (m === 'bodyFatPct' ? '%' : wu);

/** A stored figure in the reader's own unit. Body fat passes through untouched
 *  — converting a percentage is how a body-fat reading once came to be printed
 *  in pounds. */
const valueIn = (v: number | null, m: BodyMetric, wu: WeightUnit): number | null =>
  v == null ? null : m === 'bodyFatPct' ? v : weightIn(v, wu);

/** A CHANGE in the reader's own unit — converted as a span, never as the
 *  difference of two converted ends. */
const changeIn = (v: number | null, m: BodyMetric, wu: WeightUnit): number | null =>
  v == null ? null : m === 'bodyFatPct' ? v : weightDeltaIn(v, wu);

export function BodyYear({ scans, status, unit, goal, now }: {
  scans: readonly ScanReading[];
  /** The status of the SCAN read specifically — `scansStatus`, not the
   *  provider's combined one. A failed profile read leaves the goal unknown and
   *  the direction unsaid; it does not make the readings themselves doubtful. */
  status: LoadStatus;
  unit: WeightUnit;
  /** The member's own goal, or null where it is not known — a failed profile
   *  read, or a member who has not set one. Null means the panel says nothing
   *  about whether a change was the right way: losing weight is progress for
   *  one person and a problem for another, and congratulating somebody for
   *  moving away from their own goal is worse than staying quiet. */
  goal: Goal | null;
  /** Injectable so the window's end is a value and not a clock read inside a
   *  memo — see the note on `useNow` in src/ui/today.ts. */
  now: number;
}) {
  const t = useTheme();
  const [metric, setMetric] = useState<BodyMetric>('weightKg');
  const known = isWhole(status);

  // Built whatever the status, and DRAWN only when it is whole. Computing it
  // behind the guard would put a hook behind a condition; gating the render is
  // the half that matters.
  const cells = useMemo(() => bodyMonthlyHistory(scans, now), [scans, now]);
  const stage = useMemo(() => bodyStage(scans, now), [scans, now]);
  const note = useMemo(() => bodyHistoryNote(scans, now), [scans, now]);
  const arc = useMemo(() => bodyArc(cells, metric), [cells, metric]);
  const have = useMemo(() => measuredMonths(cells, metric), [cells, metric]);
  const quiet = monthsSinceMeasured(cells);

  const m = METRICS.find((x) => x.key === metric) ?? METRICS[0];
  const u = unitOf(metric, unit);
  const shown = changeIn(arc ? arc.delta : null, metric, unit);
  // Which way is good for THIS member, on THIS metric — or undefined where the
  // question has no answer, which the KpiRow draws as a neutral mark.
  const good = movementIsProgress(shown, goal, m.goal);

  if (!known) {
    return (
      <Section>
        <SectionHead title="Your Year" />
        <Text style={{ ...ty.label, color: t.ink3 }}>
          {status === 'loading'
            ? 'Reading your weigh-ins…'
            : status === 'partial'
            ? 'You have more weigh-ins than this screen can read in one go, so there is no honest year to draw over them. Nothing is missing from your record.'
            : 'We couldn’t read your weigh-ins, so the year below cannot be drawn. This is not a year with nothing in it.'}
        </Text>
      </Section>
    );
  }

  if (!cells.length) {
    return (
      <Section>
        <SectionHead title="Your Year" />
        <Text style={{ ...ty.label, color: t.ink3 }}>
          No weigh-ins yet. Record your weight on the Progress tab and this page starts keeping the months for you.
        </Text>
      </Section>
    );
  }

  return (
    <Section>
      {/* The count is of MONTHS WITH A READING, not of the window — a member
          who measured twice in a year has two, and saying "12 months" over that
          would describe the frame rather than the history. */}
      <SectionHead title="Your Year" note={`${cells.length} month${cells.length === 1 ? '' : 's'}`} />
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{note}</Text>

      {/* A history two weeks old is not a year, and a year-shaped frame drawn
          over it is a picture of failure for somebody who has done nothing
          wrong. `stageOf` makes that call for the training page too, so the two
          cannot disagree about when a history is long enough to draw. */}
      {stage === 'starting' ? null : (<>
        <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
          {METRICS.map((x) => {
            const on = x.key === metric;
            return (
              <Pressable key={x.key} onPress={() => setMetric(x.key)}
                accessibilityRole="button" accessibilityLabel={x.label} accessibilityState={{ selected: on }}
                style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                <Text style={{ ...ty.caption, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{x.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <KpiRow items={[
          // "Then" and "Now" are the first and last months that carry THIS
          // metric, not the first and last months of the window: a member who
          // moved from a bathroom scale to an InBody has months with a weight
          // and no muscle in them, and a muscle figure dated to one of those
          // would be a reading nobody took.
          { label: 'Then', value: fig(valueIn(arc ? arc.from : null, metric, unit)), unit: arc ? u : undefined },
          { label: 'Now', value: fig(valueIn(arc ? arc.to : have.length ? metricOf(have[have.length - 1], metric) : null, metric, unit)), unit: have.length ? u : undefined },
          {
            label: 'Change',
            value: fig(shown),
            unit: shown != null ? u : undefined,
            good,
            // Through `deltaLabel`, which owns the arm for a change too small
            // to print — "No change over 11 months", never "−0 lb".
            delta: deltaLabel(shown, {
              unit: u,
              since: arc ? `over ${arc.months} month${arc.months === 1 ? '' : 's'}` : null,
              noBaseline: 'One reading so far',
            }),
          },
        ]} />

        {have.length >= 2 ? (<>
          <View style={{ height: sp.lg }} />
          {/* Every month of the window, including the unmeasured ones, which
              arrive as null and are drawn as gaps. Filtering them out would
              close the line over the hole and — worse — slide every remaining
              point onto the wrong month, because the axis underneath is drawn
              from the same array. */}
          <Spark
            data={cells.map((c) => valueIn(metricOf(c, metric), metric, unit))}
            labels={cells.map((c) => c.key)}
            unit={u === '%' ? '%' : ` ${u}`}
          />
        </>) : (
          <Text style={{ ...ty.label, color: t.ink3 }}>
            {have.length === 1
              ? `One month has a ${m.label.toLowerCase()} reading so far. The line draws from the second.`
              : `No ${m.label.toLowerCase()} reading in any of these months. A bathroom scale reports weight and body fat and no muscle figure at all.`}
          </Text>
        )}

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          Each month is its last reading, so a month with three weigh-ins shows the one you finished it on. A month with none is a gap in the line rather than a figure; nothing is assumed about a month you did not measure.
        </Text>
        {quiet != null && quiet > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
            {quiet === 1
              ? 'Nothing recorded since last month.'
              : `Nothing recorded for ${quiet} months.`} The line picks up again the next time you weigh in.
          </Text>
        ) : null}
      </>)}
    </Section>
  );
}
