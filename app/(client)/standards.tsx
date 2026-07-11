// Client · Strength Standards. Grades the client's best estimated 1RM on the big
// lifts against bodyweight multiples (approximate, unisex). Reads PRs + weight.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { personalRecords } from '../../src/lib/streaks';

const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const LIFTS: { name: string; match: string[]; mult: number[] }[] = [
  { name: 'Squat', match: ['squat'], mult: [0.75, 1.25, 1.5, 2.0, 2.5] },
  { name: 'Bench Press', match: ['bench'], mult: [0.5, 0.75, 1.0, 1.5, 2.0] },
  { name: 'Deadlift', match: ['deadlift'], mult: [1.0, 1.5, 2.0, 2.5, 3.0] },
  { name: 'Overhead Press', match: ['overhead', 'shoulder press', 'ohp'], mult: [0.35, 0.55, 0.7, 0.9, 1.1] },
  { name: 'Row', match: ['row'], mult: [0.5, 0.75, 1.0, 1.25, 1.5] },
];

function levelFor(ratio: number, mult: number[]) {
  let lvl = -1;
  for (let i = 0; i < mult.length; i++) if (ratio >= mult[i]) lvl = i;
  return lvl; // -1 = below beginner
}

export default function Standards() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log } = useWorkoutLog();
  const prs = personalRecords(log);
  const bw = c.weightKg;

  const rows = LIFTS.map((lift) => {
    const best = prs
      .filter((p) => lift.match.some((m) => p.exercise.toLowerCase().includes(m)))
      .reduce((mx, p) => Math.max(mx, p.est1RM), 0);
    const ratio = best && bw ? best / bw : 0;
    const lvl = best ? levelFor(ratio, lift.mult) : -2;
    const nextTarget = lvl >= 0 && lvl < LEVELS.length - 1 ? Math.round(lift.mult[lvl + 1] * bw) : null;
    return { lift, best, ratio, lvl, nextTarget };
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Strength Standards</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Your best lifts vs bodyweight ({bw} kg) · approximate</Text>

        {rows.map(({ lift, best, ratio, lvl, nextTarget }) => (
          <View key={lift.name} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{lift.name}</Text>
              {best ? <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>{best} kg <Text style={{ color: t.ink3, fontSize: 12 }}>({ratio.toFixed(2)}×)</Text></Text> : <Text style={{ color: t.ink3, fontSize: 13 }}>No data</Text>}
            </View>
            {lvl >= -1 ? (
              <View>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {LEVELS.map((L, i) => (
                    <View key={L} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i <= lvl ? t.brand : t.surface3 }} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: lvl >= 0 ? t.brand : t.ink3, fontSize: 13, fontWeight: '800' }}>{lvl >= 0 ? LEVELS[lvl] : 'Getting started'}</Text>
                  {nextTarget ? <Text style={{ color: t.ink3, fontSize: 12 }}>Next: {LEVELS[lvl + 1]} @ {nextTarget} kg</Text> : lvl === LEVELS.length - 1 ? <Text style={{ color: t.s3, fontSize: 12, fontWeight: '700' }}>Elite 🏅</Text> : null}
                </View>
              </View>
            ) : (
              <Text style={{ color: t.ink3, fontSize: 13 }}>Log this lift to see your level.</Text>
            )}
          </View>
        ))}
        <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 6 }}>Standards are general guidelines and vary by age, sex & training history.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
