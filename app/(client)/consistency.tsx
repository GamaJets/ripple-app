// Client · Consistency. A 12-week heatmap of training days from the workout log,
// plus totals. Read-only. Profile hub.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { currentStreak, longestStreak } from '../../src/lib/streaks';

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
  const streak = currentStreak(log);
  const best = longestStreak(log);

  const cell = (d: Date) => {
    const c = counts[key(d)] || 0;
    const future = d > today;
    const bg = future ? 'transparent' : c === 0 ? t.surface2 : c === 1 ? t.brand : t.brand;
    const op = future ? 0 : c === 0 ? 1 : c === 1 ? 0.6 : 1;
    return { backgroundColor: bg, opacity: op, borderWidth: future ? 0 : 1, borderColor: t.ring };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Consistency</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Last {WEEKS} weeks of training</Text>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
          {[['Sessions', String(totalSessions)], ['Days trained', String(trainedDays)], ['Streak', String(streak)], ['Best', String(best)]].map(([l, v]) => (
            <View key={l} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 18 }}>{v}</Text>
              <Text style={{ color: t.ink3, fontSize: 10, marginTop: 2 }}>{l}</Text>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ justifyContent: 'space-between', marginRight: 6, paddingVertical: 2 }}>
              {DOW.map((d) => <Text key={d} style={{ color: t.ink3, fontSize: 9, height: 16 }}>{d[0]}</Text>)}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <Text style={{ color: t.ink3, fontSize: 11 }}>Less</Text>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }} />
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.brand, opacity: 0.6 }} />
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.brand }} />
            <Text style={{ color: t.ink3, fontSize: 11 }}>More</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
