// Somebody's own consistency: the streak, the totals, and twelve weeks of
// training days as a grid.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(client)/consistency.tsx has drawn this for members since the client app
// was written. A coach who trains had no equivalent anywhere — `shownStreak`,
// `longestStreak` and the heatmap helpers had no importer under app/(trainer)
// before this.
//
// ── Built on the client hook, because that is the rule ─────────────────────
//
// The log is whatever the mounting screen passes from `useWorkoutLog()`, which
// reads `user_id = auth.uid()`. In the coach app that is the coach, so every
// square here is their own training and can never be a client's. Trainers
// self-track; nothing in this product promotes a client path into a trainer
// one, and nothing here consults the roster.
//
// ── The one sentence this panel must never say by accident ─────────────────
//
// "You did not train." A blank square drawn because the log could not be read
// looks exactly like a blank square drawn because somebody rested, and telling
// a person who trained every day for a month that they trained on none of it is
// close to the worst thing this app can get wrong — they have no way to tell
// the fault is ours, and every reason to conclude the month did not count.
//
// So the grid is fed through `squareCount` (src/lib/heatmapGrid.ts), which
// returns NULL for an unread log, and `heatmapDayLabel` (src/lib/heatmap.ts)
// turns that null into "not read" rather than "nothing logged". Neither
// decision is made in this file.
//
// ── Why 'partial' is admitted to the grid and refused by the totals ────────
//
// A capped read (src/lib/rowCap.ts) holds the NEWEST rows — the provider orders
// `performed_at` descending before it caps — so the recent twelve weeks and the
// current streak are drawn from real, complete rows and stay true under it. The
// ALL-TIME totals are not: "Exercises 1,000" under the word "Totals" is a
// subtotal wearing a total's name, and "Best Streak" would nominate the best of
// the last three months as the best there has ever been. `isWhole` is the gate
// for those three and `known` for the grid.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, KpiRow, Rule, fig } from './kit';
import { sp, radius, hairline, grown, type as ty } from '../theme/scale';
import { Icon } from './Icon';
import { isWhole, type LoadStatus } from './loadStatus';
import { shownStreak, longestStreak, freezeBudget } from '../lib/streaks';
import { heatmapDayLabel, heatmapColumnLabel, heatmapSummary } from '../lib/heatmap';
import { heatmapColumns, squareCounts, squareCount } from '../lib/heatmapGrid';
import { WEEK_DAYS } from '../lib/weekStart';
import { MIN_TARGET } from '../lib/a11y';
import { BACK_ICON, FORWARD_ICON } from './direction';
import { num } from '../lib/format';
import type { WorkoutEntry } from '../lib/mockData';

/** How many weeks the grid draws. Twelve is a training quarter, which is the
 *  span "have I been consistent?" is actually asked over. */
const WEEKS = 12;

export function OwnConsistencyPanel({ log, status, nowMs }: {
  /** The signed-in person's own workout log. Null under 'error'. */
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  /**
   * The instant "today" is taken from, passed in from the mounting screen's
   * `useNow()`. Never `Date.now()` in the render body: this panel lives on a
   * route registered `href: null`, so it mounts once and is never torn down,
   * and a grid whose today was fixed at mount keeps drawing yesterday's squares
   * — on the panel whose whole subject is whether somebody trained today.
   */
  nowMs: number;
}) {
  const t = useTheme();
  const rows = useMemo(() => log ?? [], [log]);
  // 'loading' is not 'known' either, and leaving it out is the whole bug:
  // `useWorkoutLog` starts at 'loading', so the first frame would draw "Current
  // Streak 0" over twelve blank weeks and then correct itself. A figure that is
  // wrong for a second is read as an answer, because it looks exactly like one.
  //
  // whole-ok: 'partial' is admitted here ON PURPOSE and nothing counted is
  // gated on it. A capped read (src/lib/rowCap.ts) holds the NEWEST thousand
  // rows — src/ui/workoutLog.tsx orders `performed_at` descending before it caps
  // — so the twelve-week grid and the current streak, both of which only ever
  // look at recent days, are drawn from real and complete rows and stay true
  // under it. Every figure a prefix WOULD falsify — the all-time totals and the
  // best streak — is gated on `countable` below, which is `isWhole`. Using
  // `isWhole` here instead would blank a truthful grid.
  const known = status !== 'error' && status !== 'loading';
  // …and 'partial' is not 'error'. See the header for why the grid takes it and
  // the totals do not.
  const countable = isWhole(status);

  const today = useMemo(() => {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [nowMs]);
  const cols = useMemo(() => heatmapColumns(today, WEEKS), [today]);
  const counts = useMemo(() => squareCounts(rows), [rows]);

  const totalExercises = Object.values(counts).reduce((a, n) => a + n, 0);
  const trainedDays = Object.keys(counts).length;
  const freezes = freezeBudget(rows);
  // `shownStreak` derives the freeze budget itself, so there is ONE place that
  // decides what the streak is. Composing it here from `currentStreakFrozen` and
  // `freezeBudget` would agree with every other screen by coincidence rather
  // than by construction.
  const streak = shownStreak(rows, nowMs);
  const best = longestStreak(rows);

  // Which square was tapped, so the readout under the grid is the day somebody
  // asked about. Null is the ordinary state — the grid has its own summary and
  // needs no readout until it is wanted.
  const [picked, setPicked] = useState<Date | null>(null);

  const cell = (d: Date) => {
    const c = squareCount(counts, d, known);
    const future = d.getTime() > today.getTime();
    return {
      backgroundColor: future ? 'transparent' : c ? t.brand : t.surface2,
      opacity: future ? 0 : c === 1 ? 0.6 : 1,
      borderWidth: future ? 0 : hairline,
      borderColor: t.ring,
    };
  };

  return (
    <View>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
        Days you logged training of your own. A square is a day; nothing on it is about a client.
      </Text>

      <Section>
        <KpiRow items={[
          {
            label: 'Current Streak',
            value: known ? fig(streak) : fig(null),
            unit: known ? (streak === 1 ? 'day' : 'days') : undefined,
          },
          { label: 'Best Streak', value: countable ? fig(best) : fig(null) },
          { label: 'Days Trained', value: countable ? fig(trainedDays) : fig(null) },
          { label: 'Exercises', value: countable ? fig(totalExercises) : fig(null) },
        ]} />
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
          {!known
            ? (status === 'loading'
              ? 'Reading your training log…'
              : 'Not a broken streak, an unread one. Nothing has been reset.')
            : !countable
              ? 'You have logged more than this can read in one go, so the three all-time figures are left blank rather than added up short. The streak and the grid are drawn from your most recent weeks and are real.'
              : freezes > 0
                ? `${num(freezes)} rest ${freezes === 1 ? 'day' : 'days'} in reserve before a gap breaks the run.`
                : 'No rest days in reserve yet. Those are earned by training.'}
        </Text>
      </Section>

      <Rule />

      <Section>
        <SectionHead title="Training Days" note={status === 'loading' ? 'still reading' : `${WEEKS} weeks`} />
        {/* Eighty-four squares with nothing above them and nothing spoken is a
            picture only a sighted reader can use, and only roughly: a gap is
            visible and undatable. The summary frames the whole thing, the month
            row gives the columns an axis, and every square carries its own date
            and its own count. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{heatmapSummary(WEEKS, known)}</Text>
        <View style={{ flexDirection: 'row' }}>
          {/* The weekday initials. `grown` rather than a pinned height: React
              Native scales fontSize with the reader's text setting and never
              scales a fixed box, so a 14pt strip holding one line of text clips
              that line the moment somebody turns their text up. */}
          <View style={{ marginEnd: 6, paddingVertical: 2 }}>
            <View style={{ height: grown(13), marginBottom: 4 }} />
            {WEEK_DAYS.map((d, i) => (
              <Text key={d} accessibilityLabel={d}
                style={{ ...ty.micro, color: t.ink3, height: grown(14), lineHeight: 14, marginBottom: i === WEEK_DAYS.length - 1 ? 0 : 4 }}>
                {d[0]}
              </Text>
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {cols.map((col, ci) => {
                // Labelled only where the month CHANGES, so twelve columns
                // carry three words rather than twelve.
                const month = heatmapColumnLabel(col, ci === 0 ? null : cols[ci - 1]);
                return (
                  <View key={col[0].getTime()} style={{ gap: 4 }}>
                    <Text numberOfLines={1} style={{ ...ty.micro, color: t.ink3, height: grown(13), width: 14 }}>
                      {month ?? ''}
                    </Text>
                    {col.map((d) => (
                      <Pressable key={d.getTime()} onPress={() => setPicked(d)}
                        accessibilityRole="button"
                        accessibilityLabel={heatmapDayLabel(d, squareCount(counts, d, known), today)}
                        hitSlop={2}
                        style={[{ width: 14, height: 14, borderRadius: 3 }, cell(d)]} />
                    ))}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
          <Text style={{ ...ty.caption, color: picked ? t.ink2 : t.ink3, flex: 1 }}>
            {picked
              ? heatmapDayLabel(picked, squareCount(counts, picked, known), today)
              : 'Tap a square to read its date, or step through the days.'}
          </Text>
          {/* ── the other way to reach a day ──────────────────────────────
              Eighty-four squares at 14pt, four points apart, are a long way
              under MIN_TARGET and cannot be brought up to it: a 44pt target on
              this grid would overlap its neighbours, and the answer to a
              control that is too small is never a control that hits the wrong
              thing. So the grid keeps its size and gains a companion — two
              full-size buttons that move the selection a day at a time. */}
          <Pressable accessibilityRole="button" accessibilityLabel="Previous day"
            onPress={() => setPicked((p) => { const d = new Date((p ?? today).getTime()); d.setDate(d.getDate() - 1); return d; })}
            style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: t.surface2 }}>
            <Icon name={BACK_ICON} size={15} color={t.ink2} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next day"
            onPress={() => setPicked((p) => { const d = new Date((p ?? today).getTime()); d.setDate(d.getDate() + 1); return d; })}
            style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: t.surface2 }}>
            <Icon name={FORWARD_ICON} size={15} color={t.ink2} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Less</Text>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring }} />
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.brand, opacity: 0.6 }} />
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.brand }} />
          <Text style={{ ...ty.caption, color: t.ink3 }}>More</Text>
        </View>
      </Section>
    </View>
  );
}
