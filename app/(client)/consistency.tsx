// Client · Consistency. A 12-week heatmap of training days from the workout log,
// plus totals. Read-only. Profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, computation and route is preserved — the five bordered stat
// tiles became one hero figure plus a hairline-divided KPI row, and the heatmap
// lost its box.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Notice, Cta, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, grown, type as ty } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { isWhole } from '../../src/ui/loadStatus';
import { shownStreak, longestStreak, freezeBudget } from '../../src/lib/streaks';
import { heatmapDayLabel, heatmapColumnLabel, heatmapSummary } from '../../src/lib/heatmap';
import { readBoundary, rangeCoverage } from '../../src/lib/sessionHistory';
import { fmtFullDay } from '../../src/lib/format';
import { WEEK_DAYS, startOfWeek } from '../../src/lib/weekStart';
import { Icon } from '../../src/ui/Icon';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';
import { MIN_TARGET } from '../../src/lib/a11y';
// The day this screen judges against, kept live across midnight. See the
// note at `useNow()` below.
import { useNow } from '../../src/ui/today';

const WEEKS = 12;
/** The grid's rows, in the order src/lib/weekStart.ts draws a week. */
const DOW = WEEK_DAYS;

export default function Consistency() {
  const t = useTheme();
  const router = useRouter();
  const { log, status: logStatus, reload } = useWorkoutLog();
  // A failed read used to strand this screen for the whole session: the only
  // way to ask again was the Try Again button inside the failure notice, and
  // there is no such button on a screen that merely went stale. Pull to refresh
  // is the gesture people already try — see src/ui/pullToRefresh.tsx.
  const pull = usePullToRefresh(useCallback(() => { reload(); }, [reload]));
  // Under 'error' the log is empty because the read failed, not because nothing
  // was ever logged — so every figure on this screen is unknown rather than
  // zero. A broken streak is close to the worst thing this app can tell someone
  // falsely: a client who has trained every day for a month, shown "Current
  // streak 0 days" over twelve blank weeks, has no way to tell that the fault is
  // ours, and every reason to conclude the month did not count.
  // 'loading' is not 'known' either, and leaving it out of this was the whole
  // bug: `useWorkoutLog` starts at 'loading' under USE_SUPABASE, so the first
  // frame of this screen drew "Current Streak · 0 days" over twelve blank weeks
  // — the exact sentence the note above says is close to the worst thing this
  // app can tell someone — and then corrected itself once the read landed. A
  // figure that is wrong for a second is read as an answer, because it looks
  // exactly like one.
  // whole-ok: 'partial' is admitted here on purpose, and the note under this
  // line is the argument. A capped read (src/lib/rowCap.ts) holds the NEWEST
  // thousand sessions, because the provider orders `performed_at` descending
  // before it caps, so the twelve-week grid and the current streak — both of
  // which only ever look at recent days — are drawn from real, complete rows
  // and stay true under it. The figures that a prefix WOULD falsify, the
  // all-time totals, are gated on `countable` below, which is `isWhole`.
  const known = logStatus !== 'error' && logStatus !== 'loading';
  // The banner is about a FAILED read specifically. A read still in flight has
  // nothing to apologise for; it says so under the hero instead.
  const failed = logStatus === 'error';
  // …and 'partial' is not 'error', which is why `known` alone is not enough for
  // the three figures under "Totals". A truncated read (src/lib/rowCap.ts) holds
  // the NEWEST thousand sessions — the provider orders `performed_at`
  // descending before capping — so the twelve-week grid and the current streak
  // are drawn from real, complete, recent rows and stay honest under it. The
  // all-time totals are not: "Sessions 1,000" under the word "Totals" is a
  // subtotal wearing the name of a total, and "Best Streak" would nominate the
  // best of the last three months as the best there has ever been. `isWhole`
  // is false for 'partial' AND for 'loading', which also stops the first frame
  // printing three zeroes before the read has landed.
  const countable = isWhole(logStatus);

  const pad = (n: number) => String(n).padStart(2, '0');
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // EXERCISES logged per day, which is what this has always counted and is now
  // also what it is called.
  //
  // This app writes one `workouts` row per exercise, so `counts[day]` is a
  // count of movements. It was labelled "Sessions" under Totals and read out to
  // VoiceOver by `heatmapDayLabel` as "Mon 17 Aug, 7 sessions" over what was
  // one visit to the gym.
  //
  // The fix is the label rather than the arithmetic, because a session count is
  // not available: a member's real 17 August is seven rows with seven distinct
  // `performed_at` values, saved as they went. See `WeekStats.days` in
  // src/lib/streaks.ts. `Days Trained` beside it is the honest count and is
  // unchanged — it was already the number of KEYS in this map.
  const counts: Record<string, number> = {};
  for (const l of log) { const k = key(new Date(l.t)); counts[k] = (counts[k] || 0) + 1; }

  // Build a grid: columns = weeks (oldest→newest), rows = the seven days of a
  // week in DOW's order.
  // `useNow()`, copied before it is written through. The twelve-week grid below
  // is built backwards from `thisWeek`, and every square's date comes off it —
  // so a screen left open across midnight keeps drawing yesterday's grid, with
  // the "today" square in the wrong place, on the screen whose whole subject is
  // whether the member trained today. Not the frozen-at-mount shape
  // check:frozen-day catches; the other half of it, which src/ui/today.ts
  // describes: correct on every redraw, and nothing here redraws at midnight.
  //
  // `new Date(now)` because `setHours` below mutates, and `now` is state. The
  // hook call is on its own line rather than inlined into the `new Date(…)`:
  // hooks read better where a reviewer counts them.
  const now = useNow();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const thisWeek = startOfWeek(today);
  const cols: Date[][] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const colStart = new Date(thisWeek); colStart.setDate(thisWeek.getDate() - w * 7);
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) { const day = new Date(colStart); day.setDate(colStart.getDate() + d); col.push(day); }
    cols.push(col);
  }

  // ── how far back the grid is actually complete ─────────────────────────
  //
  // The claim under the totals — "The grid below is your recent weeks and is
  // complete" — was true of a whole read and only ASSUMED of a truncated one.
  // The argument for admitting 'partial' here is sound as far as it goes: the
  // provider orders `performed_at` descending before it caps, so what came back
  // is the recent end. What it does not establish is that the recent end
  // reaches twelve weeks, and src/ui/workoutLog.tsx says plainly that it may
  // not: "One row per set, not per session, so this is the fastest-growing read
  // a single client has: four sessions a week at twenty sets apiece passes a
  // thousand rows inside three months." Three months IS twelve weeks, so the
  // heaviest loggers — the ones with the most to lose from being told their
  // weeks were empty — are exactly the members whose oldest columns fall off
  // the read. Blank squares, under a sentence promising the grid is complete.
  //
  // `readBoundary`/`rangeCoverage` are the tested pair app/(client)/calendar.tsx
  // already asks this question with, so the two screens cannot answer it
  // differently about the same log.
  const gridBoundary = readBoundary(log.map((l) => ({ startsAt: l.t })), logStatus === 'partial');
  const gridFromMs = cols[0]?.[0]?.getTime() ?? today.getTime();
  const gridCoverage = rangeCoverage(gridFromMs, today.getTime() + 86_400_000, gridBoundary, logStatus);
  /** The day the grid is complete FROM, when it is not complete throughout. */
  const gridCompleteFrom = gridCoverage === 'covered' || gridBoundary.oldestISO == null
    ? null
    : new Date(gridBoundary.oldestISO);

  const totalExercises = Object.values(counts).reduce((a, n) => a + n, 0);
  const trainedDays = Object.keys(counts).length;
  const freezes = freezeBudget(log);
  // Composed here before; it agreed with Home by coincidence rather than by
  // construction. `shownStreak` derives the budget itself, so there is one
  // place where the number is decided.
  const streak = shownStreak(log);
  const best = longestStreak(log);

  // Which square the reader tapped, so the date under the grid is the one they
  // asked about. Null is the ordinary state — the grid says what it is in its
  // own summary and does not need a readout until somebody wants one.
  const [picked, setPicked] = useState<Date | null>(null);

  const cell = (d: Date) => {
    const c = counts[key(d)] || 0;
    const future = d > today;
    const bg = future ? 'transparent' : c === 0 ? t.surface2 : c === 1 ? t.brand : t.brand;
    const op = future ? 0 : c === 0 ? 1 : c === 1 ? 0.6 : 1;
    return { backgroundColor: bg, opacity: op, borderWidth: future ? 0 : hairline, borderColor: t.ring };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Last {WEEKS} weeks</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Consistency</Text>
          </View>
        </View>

        {/* Said before the hero, because everything below it is a dash until the
            log loads and the reader needs to know why rather than guess. */}
        {failed ? (
          <View style={{ marginTop: sp.lg }}>
            <Notice tone={t.warn} kicker="Consistency" title="We couldn’t read your training log"
              note="Your streak and your history are intact — this screen just can't see them right now. The blank weeks below are ours, not yours.">
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={reload} />
              </View>
            </Notice>
          </View>
        ) : null}

        {/* ── the hero: the streak the heatmap is about ─────────────────────
            `best` is all-time and follows the same rule as the totals below: on
            a truncated read it is the best of the weeks that fitted, and
            printing that as "Best 14" tells a client their best run was shorter
            than it was. The freeze budget stays — it is counted from the recent
            weeks the cap keeps. */}
        <Hero
          label="Current Streak"
          figure={known ? fig(streak) : fig(null)}
          unit={known ? (streak === 1 ? 'day' : 'days') : undefined}
          note={!known
            ? (logStatus === 'loading' ? 'Reading your training log…' : 'Not a broken streak — an unread one.')
            : !countable
            ? freezes > 0
              ? `${freezes} freeze${freezes === 1 ? '' : 's'} in reserve · best run not all read`
              : 'Best run not all read'
            : freezes > 0
            // "Best 14 · 2 freezes in reserve" — fourteen what? The other arm
            // of this same ternary says "Best 14 days", so the unit was lost on
            // exactly one of the two paths through one sentence.
            ? `Best ${best} day${best === 1 ? '' : 's'} · ${freezes} freeze${freezes === 1 ? '' : 's'} in reserve`
            : `Best ${best} day${best === 1 ? '' : 's'} · no freezes yet`}
        />

        <Rule />

        <Section>
          <SectionHead title="Totals" note={logStatus === 'partial' ? 'Not all read' : undefined} />
          {/* Three all-time totals reduced from `log`. With nothing read, three
              zeroes under the word "Totals" is a claim about the client's whole
              training history, and it is the one thing we do not have. The same
              is true of a read that came back at its row limit, which is why
              this is `countable` and the heatmap above is `known`. */}
          <KpiRow items={[
            { label: 'Exercises', value: countable ? fig(totalExercises) : fig(null) },
            { label: 'Days Trained', value: countable ? fig(trainedDays) : fig(null) },
            { label: 'Best Streak', value: countable ? fig(best) : fig(null) },
          ]} />
          {known && !countable && logStatus === 'partial' ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              You have trained more times than this screen can read in one go, so these three are
              left blank rather than added up short.
              {' '}
              {/* Only claimed where it is true. The whole point of the gate
                  above is that a figure computed from a prefix is not stated as
                  a fact, and a sentence promising a complete grid is that same
                  kind of claim about the picture underneath it. */}
              {gridCoverage === 'covered'
                ? 'The grid below is your recent weeks and is complete.'
                : gridCompleteFrom
                  ? `The grid below is complete from ${fmtFullDay(gridCompleteFrom.toISOString())} onwards — the weeks before that are older than this screen could read, so their empty squares are not days you missed.`
                  : 'The grid below may not reach all twelve weeks, so an empty square in the earliest ones is not necessarily a day you missed.'}
            </Text>
          ) : null}
        </Section>

        <Rule />

        <Section>
          {/* The grid is drawn from `counts`, which is empty until the log
              lands — so for the first frame every one of the twelve weeks is a
              blank square, which is the same claim the hero was making. It
              cannot say much in a heading, but it can say it is not finished. */}
          <SectionHead title="Training Days" note={logStatus === 'loading' ? 'Still reading' : `${WEEKS} weeks`} />
          {/* ── what the grid is, said once ──────────────────────────────
              Eighty-four squares with nothing above them and nothing spoken is
              a picture only a sighted reader can use, and only roughly: a gap
              was visible and undatable. The summary frames the whole thing, the
              month row gives the columns an axis, and every square now carries
              its own date and its own count. See src/lib/heatmap.ts. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{heatmapSummary(WEEKS, known)}</Text>
          <View style={{ flexDirection: 'row' }}>
            {/* The weekday initials. `grown` rather than a pinned 16: a fixed
                strip holding one line of text clips that line the moment the
                reader turns their text up, and this app has no ceiling on
                text size on purpose (src/theme/scale.ts). */}
            <View style={{ marginEnd: 6, paddingVertical: 2 }}>
              <View style={{ height: grown(13), marginBottom: 4 }} />
              {DOW.map((d, i) => (
                <Text key={d} accessibilityLabel={d}
                  style={{ ...ty.micro, color: t.ink3, height: 14, lineHeight: 14, marginBottom: i === DOW.length - 1 ? 0 : 4 }}>{d[0]}</Text>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {cols.map((col, ci) => {
                  const month = heatmapColumnLabel(col, ci === 0 ? null : cols[ci - 1]);
                  return (
                    <View key={ci} style={{ gap: 4 }}>
                      {/* The axis. Labelled only where the month changes, so
                          twelve columns carry three words rather than twelve. */}
                      <Text numberOfLines={1} style={{ ...ty.micro, color: t.ink3, height: grown(13), width: 14 }}>{month ?? ''}</Text>
                      {col.map((d, di) => (
                        <Pressable key={di}
                          onPress={() => setPicked(d)}
                          accessibilityRole="button"
                          accessibilityLabel={heatmapDayLabel(d, known ? (counts[key(d)] || 0) : null, today)}
                          hitSlop={2}
                          style={[{ width: 14, height: 14, borderRadius: 3 }, cell(d)]} />
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
          {/* The date of the square that was tapped. A sighted member could see
              a gap and could not tell which week it was; this is the answer to
              that, in the same words the screen reader gets. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
            <Text style={{ ...ty.caption, color: picked ? t.ink2 : t.ink3, flex: 1 }}>
              {picked ? heatmapDayLabel(picked, known ? (counts[key(picked)] || 0) : null, today) : 'Tap a square to read its date, or step through the days.'}
            </Text>
            {/* ── the other way to reach a day ────────────────────────────
                Eighty-four squares at 14pt, four points apart, are a long way
                under MIN_TARGET and cannot be brought up to it: a 44pt target
                on this grid would overlap its neighbours, and the answer to a
                control that is too small is never a control that hits the wrong
                thing. So the grid keeps its size and gains a companion — two
                full-size buttons that move the selection a day at a time, which
                is the same job done with a target anybody can hit. */}
            <Pressable accessibilityRole="button" accessibilityLabel="Previous day"
              onPress={() => setPicked((p) => { const d = new Date(p ?? today); d.setDate(d.getDate() - 1); return d; })}
              style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: t.surface2 }}>
              <Icon name={BACK_ICON} size={15} color={t.ink2} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next day"
              onPress={() => setPicked((p) => { const d = new Date(p ?? today); d.setDate(d.getDate() + 1); return d; })}
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
      </ScrollView>
    </SafeAreaView>
  );
}
