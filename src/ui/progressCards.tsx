// Shortcut cards for the Progress and Home tabs. Each is a small window onto a
// full screen (Trends, Records, Consistency, Watch & Devices), drawn from the
// same reads and the same helpers those screens use, and each taps through to
// it. Every figure is gated on its read: a failed or partial read is one honest
// line, an empty-but-whole read is an invitation, never a zero.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from './components';
import { Section, SectionHead, DayBars, Flag, AttentionRow, fig } from './kit';
import { sp, type as ty, numeric } from '../theme/scale';
import { useWorkoutLog } from './workoutLog';
import { useClientData } from './clientData';
import { useSettings } from './settings';
import { useNow } from './today';
import { isWhole, type LoadStatus } from './loadStatus';
import { useWearables } from './wearables';
import { useMovementName } from './catalogueTranslations';
import { importSources, useImportedIds, isLogged, readRecent, type RecentRead } from './watchImport';
import { startOfWeek } from '../lib/weekStart';
import { entryTonnage, tonnageNote, type Tonnage } from '../lib/bodyweightSets';
import { personalRecords } from '../lib/streaks';
import { bestSetLabel } from '../lib/bestSet';
import { volumeIn, liftLabel, weightShown } from '../lib/units';
import { heatmapColumns, squareCounts, squareCount } from '../lib/heatmapGrid';
import { num } from '../lib/format';

/** The four answers a read can give, as ChartShell words them, minus its
 *  one-point arm (a lift board or a grid is not a line). */
function Gate({ status, empty, emptyLine, loadingLine = 'Reading your training log…', errorLine, partialLine, children }: {
  status: LoadStatus; empty: boolean; emptyLine: string; loadingLine?: string;
  errorLine: string; partialLine: string; children: ReactNode;
}) {
  const t = useTheme();
  if (status === 'loading') return <Text style={{ ...ty.label, color: t.ink3 }}>{loadingLine}</Text>;
  if (status === 'error') return <Flag>{errorLine}</Flag>;
  if (!isWhole(status)) return <Flag tone={t.warn}>{partialLine}</Flag>;
  if (empty) return <Text style={{ ...ty.label, color: t.ink3 }}>{emptyLine}</Text>;
  return <>{children}</>;
}

const LOG_ERROR = 'We couldn’t read your training log, so nothing is drawn here. That is not a zero, and nothing has been lost.';
const LOG_PARTIAL = 'You have more training logged than we can read at once, so this is held back rather than counted over part of it.';

// ── This Week's Volume: the ten weeks app/(client)/trends.tsx charts ──────────
const VOLUME_WEEKS = 10;

export function WeeklyVolumeCard() {
  const t = useTheme();
  const router = useRouter();
  const { log, status } = useWorkoutLog();
  const { weightSeries } = useClientData();
  const wu = useSettings().weightUnit;
  const now = useNow();
  // The same buckets as trends.tsx: startOfWeek(now), seven-day windows, each
  // priced by entryTonnage against the weight on the day.
  const weeks = useMemo(() => {
    const opened = startOfWeek(now);
    const out: { day: number; t: Tonnage }[] = [];
    for (let w = VOLUME_WEEKS - 1; w >= 0; w--) {
      const start = new Date(opened); start.setDate(opened.getDate() - w * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const tt = log
        .filter((e) => { const d = new Date(e.t); return d >= start && d < end; })
        .reduce<Tonnage>((a, e) => { const x = entryTonnage(e, weightSeries); return { kg: a.kg + x.kg, unknownSets: a.unknownSets + x.unknownSets }; }, { kg: 0, unknownSets: 0 });
      out.push({ day: start.getDate(), t: tt });
    }
    return out;
  }, [log, weightSeries, now]);
  const known = isWhole(status);
  const thisWeek = weeks[weeks.length - 1];
  const shown = volumeIn(thisWeek.t.kg, wu);
  const open = () => router.push('/(client)/trends');
  return (
    <Section>
      <SectionHead title="This Week's Volume" note={known && shown != null ? `${shown.toLocaleString()} ${wu}` : undefined} onPress={open} />
      <Gate status={status} empty={!weeks.some((w) => w.t.kg > 0)}
        emptyLine="Log a workout and your week appears here."
        errorLine={LOG_ERROR} partialLine={LOG_PARTIAL}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityHint="Opens Trends">
          <DayBars
            days={weeks.map((w, i) => ({ label: String(w.day), value: volumeIn(w.t.kg, wu), tone: i === weeks.length - 1 ? 'brand' : 'teal' }))}
            spoken={`Volume lifted each week, last ${num(VOLUME_WEEKS)} weeks. This week ${shown?.toLocaleString() ?? 'unknown'} ${wu}.`} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{`Total ${wu} Lifted Each Week · Last ${num(VOLUME_WEEKS)} Weeks`}</Text>
          {tonnageNote(thisWeek.t) ? <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{tonnageNote(thisWeek.t)}</Text> : null}
        </Pressable>
      </Gate>
    </Section>
  );
}

// ── Top Lifts: the first three rows of app/(client)/records.tsx ──────────────
export function TopLiftsCard() {
  const t = useTheme();
  const router = useRouter();
  const { log, status } = useWorkoutLog();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const { textOf: movement } = useMovementName();
  // A bodyweight record is priced off the scan history; unread, it is left out
  // rather than ranked against a weigh-in that may not have applied.
  const bodyKnown = isWhole(cd.scansStatus);
  const top = useMemo(() => personalRecords(log, cd.weightSeries)
    .filter((pr) => bodyKnown || !pr.bodyweight)
    .slice(0, 3), [log, cd.weightSeries, bodyKnown]);
  const open = () => router.push('/(client)/records');
  return (
    <Section>
      <SectionHead title="Top Lifts" note="Est. 1RM" onPress={open} />
      <Gate status={status} empty={top.length === 0}
        emptyLine="Log a weighted set and your best lifts appear here."
        errorLine="We couldn’t read your training log, so your records are not shown. Nothing has been reset."
        partialLine="You have more training logged than we can read at once, so your top lifts are held back rather than ranked over part of it.">
        <Pressable onPress={open} accessibilityRole="button" accessibilityHint="Opens Records" style={{ gap: sp.sm }}>
          {top.map((pr) => {
            const set = bestSetLabel(pr, liftLabel(pr.weight, wu), pr.addedKg ? liftLabel(pr.addedKg, wu) : null);
            return (
              <View key={pr.exercise} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={2} style={{ ...ty.head, color: t.ink }}>{movement(pr.exercise)}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{set}</Text>
                </View>
                <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{fig(weightShown(pr.est1RM, wu))}{pr.est1RM != null ? ` ${wu}` : ''}</Text>
              </View>
            );
          })}
          {!bodyKnown && cd.scansStatus !== 'loading'
            ? <Text style={{ ...ty.caption, color: t.ink2 }}>Bodyweight lifts are left out because your weight history did not load.</Text>
            : null}
        </Pressable>
      </Gate>
    </Section>
  );
}

// ── Training Days: the 12-week grid app/(client)/consistency.tsx draws ───────
const GRID_WEEKS = 12;

export function TrainingDaysCard() {
  const t = useTheme();
  const router = useRouter();
  const { log, status } = useWorkoutLog();
  const now = useNow();
  const known = isWhole(status);
  const cols = useMemo(() => heatmapColumns(now, GRID_WEEKS), [now]);
  const counts = useMemo(() => squareCounts(log), [log]);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  let trained = 0;
  for (const col of cols) for (const d of col) if (d <= today && (squareCount(counts, d, known) ?? 0) > 0) trained++;
  const open = () => router.push('/(client)/consistency');
  return (
    <Section>
      <SectionHead title="Training Days" note={known ? `${num(trained)} Training ${trained === 1 ? 'Day' : 'Days'}` : undefined} onPress={open} />
      <Gate status={status} empty={trained === 0}
        emptyLine="Log a workout and your days fill in here."
        errorLine={LOG_ERROR} partialLine={LOG_PARTIAL}>
        <Pressable onPress={open} accessibilityRole="button"
          accessibilityLabel={`${num(trained)} training days in the last ${GRID_WEEKS} weeks. Open Consistency`}
          style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {cols.map((col, ci) => (
            <View key={ci} style={{ gap: 4 }}>
              {col.map((d, di) => {
                const hit = (squareCount(counts, d, known) ?? 0) > 0;
                return <View key={di} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: hit ? t.brand : t.surface3, opacity: d > today ? 0.4 : 1 }} />;
              })}
            </View>
          ))}
        </Pressable>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{`Last ${GRID_WEEKS} weeks · a filled square is a day you trained`}</Text>
      </Gate>
    </Section>
  );
}

// ── Workouts on the watch that are not in the log ────────────────────────────
// devices.tsx's own test: importSources → readRecent → isLogged, over a whole
// log and a whole read. Anything less says nothing rather than a guess; the
// import itself lives on Watch & Devices.
const WATCH_LOOKBACK_DAYS = 14;

export function WatchImportRow() {
  const router = useRouter();
  const { log, status } = useWorkoutLog();
  const { states } = useWearables();
  const { ids } = useImportedIds();
  const sources = importSources(states);
  const sourceKey = sources.map((s) => s.meta.id).join(',');
  const [read, setRead] = useState<RecentRead | null>(null);
  useEffect(() => {
    if (!sourceKey) { setRead(null); return; }
    let live = true;
    readRecent(states, WATCH_LOOKBACK_DAYS).then((r) => { if (live) setRead(r); }).catch(() => { if (live) setRead(null); });
    return () => { live = false; };
    // Keyed on which sources can be asked, not on the states object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);
  if (!read || read.reach !== 'whole' || !isWhole(status)) return null;
  const missing = read.samples.filter((sm) => !isLogged(sm, ids, log)).length;
  if (missing === 0) return null;
  const from = sources.length === 1 ? sources[0].meta.name : 'your devices';
  const go = () => router.push('/(client)/devices');
  return (
    <Section>
      <AttentionRow icon="heart"
        name={`${num(missing)} ${missing === 1 ? 'Workout' : 'Workouts'} on Your Watch Not in Your Log`}
        reason={`Found on ${from} in the last ${WATCH_LOOKBACK_DAYS} days.`}
        action={{ label: 'Import', onPress: go }}
        onPress={go} />
    </Section>
  );
}
