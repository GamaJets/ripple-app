// Client · Rest & deload planner. Reads the training log to gauge fatigue and
// recommend rest days / a deload week, with simple recovery actions. Pure logic
// (deloadCheck + weekStats), OTA-safe.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { deloadCheck } from '../../src/lib/training';
import { weekStats } from '../../src/lib/streaks';

export default function RestDay() {
  const t = useTheme();
  const router = useRouter();
  const { log } = useWorkoutLog();

  const info = useMemo(() => {
    const dl = deloadCheck(log);
    const wk = weekStats(log);
    const trainedToday = log.some((e) => new Date(e.t).toDateString() === new Date().toDateString());
    // Suggest a rest day if 3+ of the last 7 days trained and today already trained,
    // or if a deload is due.
    const restToday = dl.due || (wk.days >= 4 && trainedToday);
    return { dl, wk, trainedToday, restToday };
  }, [log]);

  const { dl, wk, restToday } = info;
  const tone = dl.due ? t.s3 : restToday ? t.warn : t.brand;
  const headline = dl.due ? 'Time for a deload week' : restToday ? 'Take a rest day' : 'You are well recovered';
  const body = dl.due
    ? dl.reason
    : restToday
    ? `You've trained ${wk.days} of the last 7 days. A rest day now protects your progress and lowers injury risk.`
    : `${wk.days} training day${wk.days === 1 ? '' : 's'} this week. You have room to train — keep listening to your body.`;

  const restActions = [
    { icon: 'water', label: 'Hydrate & refuel', note: 'Protein + carbs to rebuild.' },
    { icon: 'moon', label: 'Prioritise sleep', note: '7–9 hours is where you adapt.' },
    { icon: 'heart', label: 'Easy movement', note: 'A walk or light mobility, not a session.' },
  ] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Rest & deload</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Recovery is where training pays off. Here's what your log suggests.</Text>

        <View style={{ backgroundColor: t.surface, borderColor: tone, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name={dl.due ? 'moon' : restToday ? 'water' : 'flame'} size={22} color={tone} /></View>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800', flex: 1 }}>{headline}</Text>
          </View>
          <Text style={{ color: t.ink2, fontSize: 13.5, lineHeight: 20 }}>{body}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
          {[['This week', `${wk.days} days`], ['Hard weeks', `${dl.hardWeeks}`], ['Volume', `${(wk.volumeKg / 1000).toFixed(1)}t`]].map(([l, v]) => (
            <View key={l} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 13 }}>
              <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{v}</Text>
              <Text style={{ color: t.ink3, fontSize: 11, marginTop: 2 }}>{l}</Text>
            </View>
          ))}
        </View>

        {dl.due ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 16 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 6 }}>How to deload</Text>
            <Text style={{ color: t.ink2, fontSize: 13.5, lineHeight: 20 }}>Keep training, but cut volume to ~60%: fewer sets, or ~10% lighter weights, staying well shy of failure. One easier week lets fatigue clear so you come back stronger.</Text>
          </View>
        ) : null}

        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>On a rest day</Text>
        {restActions.map((a) => (
          <View key={a.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 8 }}>
            <Icon name={a.icon} size={20} color={t.brand} />
            <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{a.label}</Text><Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{a.note}</Text></View>
          </View>
        ))}

        <Pressable onPress={() => router.push('/(client)/recovery')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Open recovery tools</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
