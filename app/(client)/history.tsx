// Client · History — the long view. Months and years, not weeks.
//
// Every other progress screen in this app is a slice or a snapshot: Trends
// graphs ten weeks, Consistency draws twelve, Week shows this week, Records
// shows the current best with no sense of how it was reached. The longest
// window anywhere was ten weeks, so a member who has trained for a year could
// not see that year — and "how far have I actually come?" is the single
// question that keeps somebody training.
//
// The arithmetic is in `src/lib/longView.ts`, pure and framework-free so it can
// be tested under plain node. This file does two things the library cannot: it
// READS, and it RENDERS. Both have their own honesty problems.
//
// ── The read ───────────────────────────────────────────────────────────────
//
// This screen runs its own query instead of leaning on <WorkoutLogProvider>.
// The provider hands out `log: WorkoutEntry[]` and nothing else, so a failed
// hydrate is indistinguishable from an empty account — and on THIS screen that
// is the worst possible bug: telling a member with a year of training that they
// have no history. So the three states are kept apart here:
//
//   loading   we have not been told yet          → "Reading your history…"
//   ready     the read landed (rows may be none) → the page, or an honest empty
//   failed    the read broke                     → say so, and offer a retry
//
// supabase-js RESOLVES on a database error — `{ data: null, error }` — so the
// promise not rejecting proves nothing. `.error` is checked explicitly on both
// queries below. Six real bugs in this codebase came from missing exactly that.
//
// With no backend (USE_SUPABASE off) the provider's in-memory log IS the whole
// history, and there is nothing to fail, so that branch is 'ready' immediately.
//
// ── The render ─────────────────────────────────────────────────────────────
//
// The charts are hand-authored SVG, no library, and each carries an
// accessibility label that reads out its actual values — including which months
// have nothing in them, because that is a value too.
//
// A month with no training draws NO BAR. Not a bar of height zero: the app does
// not know that nobody trained in March, only that nothing was logged in March,
// and a zero-height bar is a measurement claim. For the same reason the monthly
// chart is bars rather than a line — a polyline from February to May paints ink
// across two months nobody trained and invents a trajectory through them.
import { useState, useCallback, useRef, type ReactNode } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Cta, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import {
  monthlyHistory, monthLabel, yearRows, peakVolume, intensity, bestMonth, trainedMonths,
  gaps, longestGap, monthsSinceLast, historySpan, stageOf, historyNote, lifetimeTotals,
  prTimeline, volumeArc, tonnes, MAX_MONTHS, MONTH_LABELS,
  type MonthCell, type YearRow,
} from '../../src/lib/longView';

/* ── the read ─────────────────────────────────────────────────────────────
 * Three states, never two. See the header.
 */
type Load =
  | { state: 'loading' }
  | { state: 'ready'; log: WorkoutEntry[] }
  | { state: 'failed'; reason: string };

/* ── charts ───────────────────────────────────────────────────────────────
 * Hand-authored SVG. Both of these speak their own values out loud, and both
 * distinguish "nothing logged" from "nothing lifted" from "not your history".
 */

/** How one month reads aloud, and in the legend. */
function describeMonth(c: MonthCell): string {
  if (!c.trained) return 'no sessions logged';
  if (c.volumeKg == null) return 'trained, no weights logged';
  return `${c.volumeKg.toLocaleString()} kg over ${c.sessions} session${c.sessions === 1 ? '' : 's'}`;
}

/**
 * Monthly tonnage. Bars, deliberately: see the header on why this is not a line.
 * An untrained month gets a short mark ON the baseline — visible, so the break
 * is not silently skipped over, but carrying no height, so it makes no claim.
 */
function MonthBars({ cells, t }: { cells: MonthCell[]; t: Theme }) {
  const peak = peakVolume(cells);
  const W = 320, H = 112, top = 10, base = H - 10;
  const slot = W / Math.max(1, cells.length);
  const barW = Math.max(3, Math.min(24, slot * 0.62));
  const label = 'Training volume by month. '
    + cells.map((c) => `${monthLabel(c.key)}, ${describeMonth(c)}`).join('. ') + '.';
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      accessible accessibilityRole="image" accessibilityLabel={label}>
      <Line x1={0} y1={base} x2={W} y2={base} stroke={t.ring} strokeWidth={1} />
      {cells.map((c, i) => {
        const x = i * slot + slot / 2 - barW / 2;
        if (!c.trained) {
          // A month with nothing logged. No bar — a zero-height bar is a
          // measurement, and there is no measurement here.
          return <Line key={c.key} x1={x} y1={base + 4} x2={x + barW} y2={base + 4}
            stroke={t.ink3} strokeWidth={2} opacity={0.45} />;
        }
        if (c.volumeKg == null || peak == null || peak <= 0) {
          // Trained, but nothing weighted — a cardio month. Present, no height.
          return <Rect key={c.key} x={x} y={base - 3} width={barW} height={3} fill={t.brand} opacity={0.35} />;
        }
        const h = Math.max(2, (c.volumeKg / peak) * (base - top));
        return <Rect key={c.key} x={x} y={base - h} width={barW} height={h}
          fill={t.brand} opacity={c.volumeKg === peak ? 1 : 0.6} />;
      })}
    </Svg>
  );
}

/**
 * The shape of a year. Twelve slots a row, one row a calendar year.
 *
 *   filled   trained — darker is heavier
 *   hollow   inside your history, nothing logged: a real break
 *   blank    outside your history — before your first session, or not yet
 *
 * That third state is the one that matters for somebody new. A blank slot is
 * not a month they failed to train; it is a month before they started, and
 * drawing it as an empty box would be eleven accusations on a beginner's page.
 */
function YearGrid({ rows, peak, t }: { rows: YearRow[]; peak: number | null; t: Theme }) {
  const CELL = 17, GAP = 4;
  const W = 12 * CELL + 11 * GAP;
  const xOf = (m: number) => m * (CELL + GAP);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <View style={{ width: 32 }} />
        <View style={{ flex: 1 }}>
          <Svg width="100%" height={12} viewBox={`0 0 ${W} 12`} preserveAspectRatio="xMinYMid meet">
            {MONTH_LABELS.map((m, i) => (
              <SvgText key={m} x={xOf(i) + CELL / 2} y={9} fontSize={9} fill={t.ink3} textAnchor="middle">
                {m[0]}
              </SvgText>
            ))}
          </Svg>
        </View>
      </View>
      {rows.map((row) => {
        const spoken = `${row.year}. ` + row.cells
          .map((c, m) => (c ? `${MONTH_LABELS[m]}, ${describeMonth(c)}` : null))
          .filter(Boolean).join('. ') + '.';
        return (
          <View key={row.year} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
            <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 32 }}>{row.year}</Text>
            <View style={{ flex: 1 }}>
              <Svg width="100%" height={CELL} viewBox={`0 0 ${W} ${CELL}`} preserveAspectRatio="xMinYMid meet"
                accessible accessibilityRole="image" accessibilityLabel={spoken}>
                {row.cells.map((c, m) => {
                  if (!c) return null;                       // outside your history — draw nothing
                  if (!c.trained) {
                    return <Rect key={m} x={xOf(m)} y={0} width={CELL} height={CELL} rx={4}
                      fill="none" stroke={t.ring} strokeWidth={1} />;
                  }
                  const i = intensity(c, peak);
                  return <Rect key={m} x={xOf(m)} y={0} width={CELL} height={CELL} rx={4}
                    fill={t.brand} opacity={0.25 + 0.75 * (i ?? 0)} />;
                })}
              </Svg>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Filled / hollow / blank, said in words so the colours are never the only cue. */
function GridLegend({ t }: { t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.md, marginTop: sp.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: t.brand }} />
        <Text style={{ ...ty.caption, color: t.ink3 }}>Trained</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 11, height: 11, borderRadius: 3, borderWidth: hairline, borderColor: t.ring }} />
        <Text style={{ ...ty.caption, color: t.ink3 }}>Nothing logged</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 11, height: 11 }} />
        <Text style={{ ...ty.caption, color: t.ink3 }}>Before you started</Text>
      </View>
    </View>
  );
}

export default function History() {
  const t = useTheme();
  const router = useRouter();
  const { log: localLog } = useWorkoutLog();

  // Read through a ref so the fetch is not re-created (and re-run) every time
  // the shared log changes underneath the screen.
  const localRef = useRef(localLog);
  localRef.current = localLog;

  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const read = useCallback(async () => {
    setLoad({ state: 'loading' });
    if (!USE_SUPABASE) { setLoad({ state: 'ready', log: localRef.current }); return; }
    try {
      // supabase-js resolves on failure. Check `.error`, on both calls.
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        reportError('history.auth', authErr);
        setLoad({ state: 'failed', reason: 'We could not confirm who you are signed in as.' });
        return;
      }
      const uid = auth?.user?.id;
      if (!uid) {
        setLoad({ state: 'failed', reason: 'You are not signed in, so there is no history to read.' });
        return;
      }
      const { data, error } = await supabase
        .from('workouts').select('*').eq('user_id', uid).order('performed_at', { ascending: true });
      if (error) {
        reportError('history.read', error);
        setLoad({ state: 'failed', reason: 'Your training history could not be read.' });
        return;
      }
      // No rows is a genuinely empty history. It is not a failure, and it is
      // not the same render as one.
      setLoad({ state: 'ready', log: ((data ?? []) as WorkoutRow[]).map(rowToEntry) });
    } catch (e) {
      reportError('history.read', e);
      setLoad({ state: 'failed', reason: 'Your training history could not be read.' });
    }
  }, []);

  // On focus, not once on mount.
  //
  // This screen deliberately runs its own query rather than reading the shared
  // provider (see the header), which means it holds a snapshot: correct when it
  // was taken, and stale from the moment anything else changes a workout. Now
  // that a client can correct an entry from Train's calendar — TF-02 — that is
  // no longer theoretical. Somebody fixing 8 reps to 10 and coming straight
  // back here would have been shown the tonnage, the best month and the PR
  // timeline of the figure they had just corrected, with nothing to say why.
  //
  // A stack screen is not unmounted when you navigate away from it, so the
  // mount effect this replaces would not have run again for the rest of the
  // session. Re-reading on focus costs one query per visit and is the only way
  // the long view keeps agreeing with the log it is drawn from.
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const G = layout.gutter;
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>How far you have come</Text>
        <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Your history</Text>
      </View>
      <Ghost icon="back" onPress={() => router.back()} />
    </View>
  );
  const frame = (children: ReactNode) => (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {header}
        {children}
      </ScrollView>
    </SafeAreaView>
  );

  /* ── 1 of 3: still asking ─────────────────────────────────────────────── */
  if (load.state === 'loading') {
    return frame(
      <><Rule /><Section>
        <Text style={{ ...ty.label, color: t.ink3 }}>Reading your history…</Text>
      </Section></>
    );
  }

  /* ── 2 of 3: the read broke ───────────────────────────────────────────── */
  if (load.state === 'failed') {
    return frame(
      <><Rule /><Section>
        <SectionHead title="Could not read your history" />
        <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>
          {load.reason} Nothing has been lost — this screen only failed to read what is there, so it
          cannot tell you what is in it either way.
        </Text>
        <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try again" onPress={read} /></View>
      </Section></>
    );
  }

  /* ── 3 of 3: the read landed ──────────────────────────────────────────── */
  const log = load.log;
  const span = historySpan(log);
  const stage = stageOf(span);

  if (stage === 'empty' || !span) {
    return frame(
      <><Rule /><Section>
        <SectionHead title="Nothing logged yet" />
        <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>
          {historyNote(log)} Log one session and this page starts keeping the score for you —
          month by month, for as long as you train.
        </Text>
        <Cta label="Log a workout" wide onPress={() => router.push('/(client)/workouts')} />
      </Section></>
    );
  }

  const cells = monthlyHistory(log);
  const life = lifetimeTotals(log)!;
  const peak = peakVolume(cells);
  const best = bestMonth(cells);
  const active = trainedMonths(cells).length;
  const breaks = gaps(cells);
  const worstGap = longestGap(cells);
  const quiet = monthsSinceLast(cells) ?? 0;
  const arc = volumeArc(cells);
  const records = prTimeline(log).slice().reverse().slice(0, 12);
  const rows = yearRows(cells);
  const earlier = span.months - cells.length;      // months clipped by MAX_MONTHS
  const dstr = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return frame(<>
    {/* ── the hero: everything you have ever lifted ───────────────────────── */}
    <Hero
      label={`Lifted since ${monthLabel(cells[0].key)}`}
      figure={fig(tonnes(life.volumeKg)?.toLocaleString())}
      unit="tonnes"
      note={historyNote(log)}
    />

    <Rule />

    {/* ── the shape of it ────────────────────────────────────────────────── */}
    <Section>
      {stage === 'starting' ? (<>
        {/* A short history gets no year grid. Eleven blank months around one
            thin bar is a picture of failure drawn for somebody who has done
            nothing wrong — so this says what is actually true instead. */}
        <SectionHead title="The start of your history" note={`Day ${span.days}`} />
        <Text style={{ ...ty.body, color: t.ink2 }}>
          You started on {dstr(span.firstAt)} and have trained on {fig(life.days)} day
          {life.days === 1 ? '' : 's'} since. There is not a year to look at yet — there will be,
          and this page is where it goes.
        </Text>
      </>) : (<>
        <SectionHead title="Your years" note={`${active} month${active === 1 ? '' : 's'} trained`} />
        <YearGrid rows={rows} peak={peak} t={t} />
        <GridLegend t={t} />
      </>)}
    </Section>

    <Rule />

    {/* ── month by month ─────────────────────────────────────────────────── */}
    <Section>
      <SectionHead title="Month by month" note="Total kg lifted" />
      {peak != null ? (<>
        <MonthBars cells={cells} t={t} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{monthLabel(cells[0].key)}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{monthLabel(cells[cells.length - 1].key)}</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
          A month with nothing logged carries a mark on the line and no bar — the app knows you
          logged nothing, not that you lifted nothing.
        </Text>
      </>) : (
        <Text style={{ ...ty.label, color: t.ink3 }}>
          No weighted sets on record yet, so there is no tonnage to chart. Cardio and bodyweight
          sessions still count towards the months above.
        </Text>
      )}
      <View style={{ height: sp.lg }} />
      <KpiRow items={[
        { label: 'Sessions', value: fig(life.sessions), delta: `${fig(life.days)} day${life.days === 1 ? '' : 's'}` },
        { label: 'Best month', value: fig(best?.volumeKg?.toLocaleString()), unit: best?.volumeKg != null ? 'kg' : undefined, delta: best ? monthLabel(best.key) : undefined },
        { label: 'Lifts', value: fig(life.lifts), delta: 'with weights' },
      ]} />
      {earlier > 0 ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          Showing the last {MAX_MONTHS} months. {earlier} earlier month{earlier === 1 ? '' : 's'} of
          history {earlier === 1 ? 'is' : 'are'} on record but not charted here.
        </Text>
      ) : null}
    </Section>

    {/* ── then and now ───────────────────────────────────────────────────── */}
    {arc ? (<>
      <Rule />
      <Section>
        <SectionHead title="Then and now" note={`${arc.months} months apart`} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>{monthLabel(arc.fromKey)}</Text>
            <Text style={{ ...value(22), color: t.ink, marginTop: 4 }}>{arc.fromVolumeKg.toLocaleString()}</Text>
            <Text style={{ ...ty.caption, color: t.ink3 }}>kg</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>{monthLabel(arc.toKey)}</Text>
            <Text style={{ ...value(22), color: t.ink, marginTop: 4 }}>{arc.toVolumeKg.toLocaleString()}</Text>
            <Text style={{ ...ty.caption, color: t.ink3 }}>kg</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>Change</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: arc.deltaKg >= 0 ? t.brand : t.ink3 }} />
              <Text style={{ ...value(22), color: t.ink }}>{fig(arc.pct)}</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>%</Text>
            </View>
          </View>
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          Your first month with weights on it against your most recent one. Months in between are
          on the chart above, gaps and all.
        </Text>
      </Section>
    </>) : null}

    {/* ── the breaks, kept ───────────────────────────────────────────────── */}
    {(breaks.length > 0 || quiet > 0) ? (<>
      <Rule />
      <Section>
        <SectionHead title="Breaks" note={worstGap ? `Longest ${worstGap.months} month${worstGap.months === 1 ? '' : 's'}` : undefined} />
        {breaks.map((g) => (
          <View key={g.afterKey} style={{ paddingVertical: sp.sm }}>
            <Text style={{ ...ty.body, color: t.ink2 }}>
              Nothing logged for {g.months} month{g.months === 1 ? '' : 's'} after {monthLabel(g.afterKey)} —
              and you came back in {monthLabel(g.returnKey)}.
            </Text>
          </View>
        ))}
        {quiet > 0 ? (
          <View style={{ paddingVertical: sp.sm }}>
            <Text style={{ ...ty.body, color: t.ink2 }}>
              Nothing logged since {monthLabel(cells[cells.length - 1 - quiet].key)}, {quiet} month
              {quiet === 1 ? '' : 's'} ago. That one is still open — everything above is still yours.
            </Text>
          </View>
        ) : null}
        {breaks.length > 0 && quiet === 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Every one of these ended with you starting again.
          </Text>
        ) : null}
      </Section>
    </>) : null}

    {/* ── personal bests over time, not just the current best ────────────── */}
    <Rule />
    <Section>
      <SectionHead title="Personal bests over time" note={records.length ? 'Newest first' : undefined} />
      {records.length === 0 ? (
        <Text style={{ ...ty.label, color: t.ink3 }}>
          No records set yet — the first weighted set you log becomes one.
        </Text>
      ) : records.map((m, i) => (
        <View key={`${m.exercise}-${m.at}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{m.exercise}</Text>
            <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
              {m.weight} kg × {m.reps} · {dstr(m.at)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ ...value(17), color: t.ink }}>{fig(m.est1RM)}</Text>
            {/* prev is null for a first-ever record. "+93 kg" there would be an
                improvement over a best that never existed. */}
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              {m.prev != null ? `+${m.est1RM - m.prev} kg on your last best` : 'first on record'}
            </Text>
          </View>
        </View>
      ))}
    </Section>
  </>);
}
