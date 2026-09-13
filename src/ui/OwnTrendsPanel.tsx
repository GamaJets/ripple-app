// Somebody's own training, graphed: ten weeks of tonnage, and one movement's
// estimated max over the days it was actually done.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(client)/trends.tsx has drawn both of these for members since the client
// app was written. The coach app had neither: a coach whose own bench has moved
// fifteen kilograms over a training block had no screen anywhere that said so.
//
// ── Built on the client hooks ──────────────────────────────────────────────
//
// The log is whatever the mounting screen passes from `useWorkoutLog()`, which
// reads `user_id = auth.uid()` and is therefore the signed-in coach's own
// training and never a client's. Trainers self-track; there is no
// client→trainer promotion anywhere in this product, and nothing here consults
// the roster.
//
// ── Why the arithmetic is in kilograms and only the printing converts ──────
//
// A chart drawn from converted values has a different SHAPE for a pounds
// reader, because rounding happens per point. So every sum below stays in the
// kilograms the log is stored in and the conversion happens at the edge, in
// src/lib/units.ts — and a CHANGE converts as a change (`weightDeltaIn`), not
// as two converted values subtracted.
//
// ── Three things this deliberately refuses to plot ─────────────────────────
//
// A HOLD is a duration and a lift is a mass. `est1RM(load, seconds)` reads a
// 45-second plank as a 220 kg lift and presses every real lift on the chart
// into the bottom pixel; `isTimedSet` is skipped for that reason and holds are
// left to the records board, which reads them in seconds.
//
// A BODYWEIGHT SET with no weigh-in behind it has no known load. `setLoadKg`
// answers null and this charts a GAP, not a zero — a zero is an estimated max
// of nothing, and a member who has never been weighed had every day of their
// training charted at the floor.
//
// An UNREAD log is not a week of no training. Every figure beside the chart is
// gated on `isWhole`, so a truncated read cannot nominate the best of three
// months as somebody's best week ever.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, KpiRow, Spark, fig } from './kit';
import { sp, radius, type as ty } from '../theme/scale';
import { isWhole, type LoadStatus } from './loadStatus';
import { est1RM } from '../lib/streaks';
import { entryTonnage, setLoadKg, tonnageNote, type BodyweightHistory, type Tonnage } from '../lib/bodyweightSets';
import { isTimedSet } from '../lib/timedSets';
import { liftedMovements } from '../lib/holdTrend';
import { volumeIn, est1RMIn, weightDeltaIn, convertedNote, type WeightUnit } from '../lib/units';
import { deltaLabel } from '../lib/deltaLabel';
import { startOfWeek } from '../lib/weekStart';
import { dayKeyOf } from '../lib/entryEdit';
import { fmtAxisDay, num } from '../lib/format';
import { useMovementName } from './catalogueTranslations';
import type { WorkoutEntry } from '../lib/mockData';

/** How many weeks the tonnage chart draws. Ten is a training block plus a bit,
 *  which is the span somebody asks "is this working?" over. */
const WEEKS = 10;
/** How many days of one movement the line draws. A line through forty points on
 *  a phone is a smudge — and the figures beside it are computed over EVERYTHING
 *  read, not over the twelve drawn, which is a distinction the client screen
 *  once got wrong and printed "Sessions 12" to a lifter with forty. */
const CHART_DAYS = 12;
/** How many movement chips are offered. */
const CHIPS = 24;

/** The best estimated max inside one entry, or null when nothing in it can be
 *  priced. Null and not 0: zero is a figure, and a gap in a line is the honest
 *  drawing of a day whose load nobody knows. */
function bestOf(e: WorkoutEntry, history: BodyweightHistory): number | null {
  const rows = e.sets || [];
  let best: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    // A stopwatch is not a rep count. See the header.
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

export function OwnTrendsPanel({ log, status, weights, unit, nowMs }: {
  /** The signed-in person's own workout log. Null under 'error' — a stale array
   *  charted as this week is a picture of a week that may not be this one. */
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  weights: BodyweightHistory;
  unit: WeightUnit;
  /**
   * The instant the ten weeks end. Passed in from the mounting screen's
   * `useNow()` and never read here as `Date.now()`: this panel lives on a route
   * registered `href: null`, so it mounts once and is never torn down, and a
   * "last ten weeks" whose boundaries were computed at mount stops moving the
   * day it was first opened. A phone left open across a Saturday night then
   * shows last week's tonnage under the words "This Week".
   */
  nowMs: number;
}) {
  const t = useTheme();
  const { textOf: movement } = useMovementName();
  const rows = useMemo(() => log ?? [], [log]);
  const known = isWhole(status);
  const note = convertedNote(unit);

  // Weekly tonnage, oldest week first. `nowMs` is a dependency rather than a
  // clock read inside the memo: without it the recomputation a new week asks
  // for never happens.
  const weeks = useMemo(() => {
    const opened = startOfWeek(new Date(nowMs));
    const out: { iso: string; label: string; kg: number; unpriced: number; days: number }[] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const start = new Date(opened.getTime());
      start.setDate(opened.getDate() - w * 7);
      const end = new Date(start.getTime());
      end.setDate(start.getDate() + 7);
      const inWk = rows.filter((e) => {
        const ms = Date.parse(e.t);
        return Number.isFinite(ms) && ms >= start.getTime() && ms < end.getTime();
      });
      // A DAY is the unit of a training day, not a row: this app writes one row
      // per movement, so a single gym visit is seven rows and counting rows
      // would report seven sessions.
      const days = new Set(inWk.map((e) => dayKeyOf(e.t)).filter(Boolean)).size;
      // The unpriced count travels WITH the tonnage rather than beside it. A
      // week of pull-ups done by somebody who has never been weighed has real
      // work in it and no load to put on that work, and a bare sum states the
      // shortfall as a smaller number rather than as an unknown.
      const sum = inWk.reduce<Tonnage>((a, e) => {
        const x = entryTonnage(e, weights);
        return { kg: a.kg + x.kg, unknownSets: a.unknownSets + x.unknownSets };
      }, { kg: 0, unknownSets: 0 });
      // Built from LOCAL getters, never from a string a `new Date()` could
      // reinterpret as UTC midnight — and `fmtAxisDay` writes the day and the
      // short month in the reader's own language and order, because "12/8" is
      // twelve August in London and 8 December in Chicago.
      const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      out.push({
        iso,
        label: fmtAxisDay(start.getFullYear(), start.getMonth(), start.getDate()),
        kg: sum.kg, unpriced: sum.unknownSets, days,
      });
    }
    return out;
  }, [rows, weights, nowMs]);

  const thisWeek = weeks[weeks.length - 1] ?? null;
  const bestWeek = weeks.reduce<typeof weeks[number] | null>(
    (a, w) => (a == null || w.kg > a.kg ? w : a), null);
  const weekNote = thisWeek
    ? tonnageNote({ kg: thisWeek.kg, unknownSets: thisWeek.unpriced })
    : null;

  /* ── one movement, over the days it was done ─────────────────────────── */

  // Movements that were LIFTED. A plank chip on a chart captioned "estimated
  // max" leads only to a gap, which is worse than no chip at all.
  const names = useMemo(() => liftedMovements(rows).slice(0, CHIPS), [rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const name = picked && names.includes(picked) ? picked : names[0] ?? null;

  // One point per DAY, not per row. Three sets of bench saved, a walk, then two
  // more is two rows on one afternoon — and a double tap on Save is four. Three
  // points stacked on one Tuesday is a picture of a plateau drawn out of a
  // double tap.
  const allDays = useMemo(() => {
    if (!name) return [] as { day: string; v: number | null }[];
    const byDay = new Map<string, number | null>();
    for (const e of rows) {
      if (e.exercise !== name || !e.sets?.length) continue;
      // An entry whose timestamp will not parse is dropped rather than filed
      // under today: inventing a training day out of a parsing failure is the
      // defect src/lib/ownTraining.ts documents, and it charted as a point at
      // the Unix epoch before.
      const day = dayKeyOf(e.t);
      if (!day) continue;
      const v = bestOf(e, weights);
      const cur = byDay.get(day);
      // The day's best READABLE max. `Math.max` over a null coerces it to zero
      // and hands the day a max of nothing — the afternoon somebody did their
      // squats and then a plank would chart at the plank.
      byDay.set(day, cur == null ? v : v == null ? cur : Math.max(cur, v));
    }
    // `YYYY-MM-DD` sorted as a STRING. It is a bare date with no instant
    // attached and parsing it as UTC is the defect src/lib/localDate.ts exists
    // for; string order and date order are the same for this shape.
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, v }));
  }, [rows, name, weights]);

  const series = useMemo(() => allDays.slice(-CHART_DAYS), [allDays]);
  const readable = useMemo(
    () => series.filter((s): s is { day: string; v: number } => s.v != null), [series]);
  const allReadable = useMemo(
    () => allDays.filter((s): s is { day: string; v: number } => s.v != null), [allDays]);
  // Over everything read, not over the twelve on the chart — and said as such
  // in the note, because "Best" over a window nobody named is how a lifter with
  // forty sessions was shown the best of their last quarter.
  const best = allReadable.length ? Math.max(...allReadable.map((s) => s.v)) : null;
  const first = readable.length ? readable[0].v : null;
  const last = readable.length ? readable[readable.length - 1].v : null;
  // A CHANGE converts as a change. `weightDeltaIn` is the difference between
  // this and subtracting two converted figures, and it is what stops a move too
  // small to show in the reader's unit printing as a signed zero.
  const moved = first != null && last != null ? weightDeltaIn(last - first, unit) : null;

  return (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
        Your own training over time. Every figure here is worked out from what you logged — nothing
        is a target and nothing is a judgement.
      </Text>

      {status === 'error' ? (
        <Text style={{ ...ty.body, color: t.ink2 }}>
          Your training log could not be read, so there is nothing honest to chart. Your history is
          intact — this cannot see it right now.
        </Text>
      ) : status === 'loading' ? (
        <Text style={{ ...ty.body, color: t.ink3 }}>Reading your log…</Text>
      ) : (<>
        <Section>
          <SectionHead title="Weekly Volume" note={`${WEEKS} weeks`} />
          {/* The chart is drawn under 'partial' and the FIGURES are not. A
              truncated read holds the newest rows, so the recent weeks it draws
              are real — but "best week" over a prefix nominates the best of
              what fitted as the best there has ever been. */}
          {/* Converted AT THE EDGE, one point at a time, and the unit carries
              its own leading space because `Spark` writes the figure and the
              unit straight together. Handing it kilograms under the word "lb"
              is the exact defect src/lib/units.ts exists to prevent: a wrong
              number wearing a right label. */}
          <Spark data={weeks.map((w) => volumeIn(w.kg, unit))} labels={weeks.map((w) => w.iso)} unit={` ${unit}`} />
          <KpiRow items={[
            {
              label: 'This Week',
              value: known && thisWeek ? num(volumeIn(thisWeek.kg, unit)) : fig(null),
              unit: known && thisWeek ? unit : undefined,
            },
            {
              label: 'Best Week',
              value: known && bestWeek ? num(volumeIn(bestWeek.kg, unit)) : fig(null),
              unit: known && bestWeek ? unit : undefined,
            },
            { label: 'Days This Week', value: known && thisWeek ? fig(thisWeek.days) : fig(null) },
          ]} />
          {!known ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
              Your log came back short, so these would be totals over part of it rather than over
              the weeks they name. The shape of the chart is still real.
            </Text>
          ) : weekNote ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{weekNote}</Text>
          ) : bestWeek ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Best week began {bestWeek.label}.
            </Text>
          ) : null}
          {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{note}</Text> : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Lift by Lift" note={name ? `last ${CHART_DAYS} days logged` : undefined} />
          {names.length ? (<>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.sm }}>
              {names.map((n) => {
                const on = n === name;
                return (
                  <Pressable key={n} onPress={() => setPicked(n)}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={`Chart ${movement(n)}`}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>
                      {movement(n)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Spark data={series.map((s) => (s.v == null ? null : est1RMIn(s.v, unit)))}
              labels={series.map((s) => s.day)} unit={` ${unit}`} />
            <KpiRow items={[
              { label: 'Latest', value: fig(est1RMIn(last, unit)), unit: last != null ? unit : undefined },
              { label: 'Best Read', value: fig(est1RMIn(best, unit)), unit: best != null ? unit : undefined },
              { label: 'Days Charted', value: fig(readable.length) },
            ]} />
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
              {/* `deltaLabel` and not a hand-rolled sign. A change of nothing is
                  neither direction, and every screen that wrote its own
                  `x <= 0 ? '−' : '+'` eventually congratulated somebody for a
                  movement that did not happen. */}
              {deltaLabel(moved, {
                unit,
                // Named, or explicitly null. `since` is required on purpose so
                // that a delta with no stated baseline is a decision rather
                // than an omission — and with fewer than two readable days
                // there is no baseline to name.
                since: readable.length > 1 ? 'your first charted day' : null,
                noBaseline: 'Not enough logged days of this lift to show a change yet.',
                noChange: 'No change',
              })}
              {allReadable.length > readable.length
                ? ` · Best Read is over all ${num(allReadable.length)} days of this lift that were read, not just the ${num(readable.length)} on the chart.`
                : ''}
            </Text>
            {/* A day whose load could not be priced is a GAP in the line, and a
                reader looking at a broken line deserves to know why rather than
                assume the app dropped it. */}
            {series.length > readable.length ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Some days have no point: the sets on them were at your own bodyweight and there was
                no weigh-in on or before that day to price them against.
              </Text>
            ) : null}
          </>) : (
            <Text style={{ ...ty.body, color: t.ink2 }}>
              No lifted sets of your own to chart yet. Log a set with a weight on it and this fills.
            </Text>
          )}
        </Section>
      </>)}
    </View>
  );
}
