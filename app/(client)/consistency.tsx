// Client · Consistency. A 12-week heatmap of training days from the workout log,
// plus totals. Read-only. Profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Every provider, computation and route is preserved — the five bordered stat
// tiles became one hero figure plus a hairline-divided KPI row, and the heatmap
// lost its box.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { currentStreak, longestStreak, freezeBudget, currentStreakFrozen } from '../../src/lib/streaks';

const WEEKS = 12;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Consistency() {
  const t = useTheme();
  const router = useRouter();
  const { log } = useWorkoutLog();

  const pad = (n: number) => String(n).padStart(2, '0');
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const counts: Record<string, number> = {};
  for (const l of log) { const k = key(new Date(l.t)); counts[k] = (counts[k] || 0) + 1; }

  // Build a grid: columns = weeks (oldest→newest), rows = Mon..Sun.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const jsToMon = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - jsToMon);
  const cols: Date[][] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const colStart = new Date(thisMonday); colStart.setDate(thisMonday.getDate() - w * 7);
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) { const day = new Date(colStart); day.setDate(colStart.getDate() + d); col.push(day); }
    cols.push(col);
  }

  const totalSessions = Object.values(counts).reduce((a, n) => a + n, 0);
  const trainedDays = Object.keys(counts).length;
  const freezes = freezeBudget(log);
  const streak = currentStreakFrozen(log, freezes).streak;
  const best = longestStreak(log);

  const cell = (d: Date) => {
    const c = counts[key(d)] || 0;
    const future = d > today;
    const bg = future ? 'transparent' : c === 0 ? t.surface2 : c === 1 ? t.brand : t.brand;
    const op = future ? 0 : c === 0 ? 1 : c === 1 ? 0.6 : 1;
    return { backgroundColor: bg, opacity: op, borderWidth: future ? 0 : hairline, borderColor: t.ring };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Last {WEEKS} weeks</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Consistency</Text>
          </View>
        </View>

        {/* ── the hero: the streak the heatmap is about ───────────────────── */}
        <Hero
          label="Current streak"
          figure={fig(streak)}
          unit={streak === 1 ? 'day' : 'days'}
          note={freezes > 0
            ? `Best ${best} · ${freezes} freeze${freezes === 1 ? '' : 's'} in reserve`
            : `Best ${best} day${best === 1 ? '' : 's'} · no freezes yet`}
        />

        <Rule />

        <Section>
          <SectionHead title="Totals" />
          <KpiRow items={[
            { label: 'Sessions', value: fig(totalSessions) },
            { label: 'Days trained', value: fig(trainedDays) },
            { label: 'Best streak', value: fig(best) },
          ]} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Training days" note={`${WEEKS} weeks`} />
          <View style={{ flexDirection: 'row' }}>
            <View style={{ justifyContent: 'space-between', marginRight: 6, paddingVertical: 2 }}>
              {DOW.map((d) => <Text key={d} style={{ ...ty.micro, color: t.ink3, height: 16 }}>{d[0]}</Text>)}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {cols.map((col, ci) => (
                  <View key={ci} style={{ gap: 4 }}>
                    {col.map((d, di) => <View key={di} style={[{ width: 14, height: 14, borderRadius: 3 }, cell(d)]} />)}
                  </View>
                ))}
              </View>
            </ScrollView>
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
