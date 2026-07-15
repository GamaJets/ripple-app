// Client · Progression. Auto-generated next-session targets from your logged
// lifts using double-progression (add load when you clear the top of the range,
// otherwise chase reps). Read-only guidance — you still log what you actually do.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { suggestProgression, type ProgressAction } from '../../src/lib/progression';

const META: Record<ProgressAction, { label: string; icon: string; color: (t: any) => string }> = {
  increase: { label: 'Add load', icon: 'trending', color: (t) => t.brand },
  reps: { label: 'Chase reps', icon: 'plus', color: (t) => t.good ?? t.brand },
  hold: { label: 'Hold', icon: 'minus', color: (t) => t.warn },
  deload: { label: 'Ease back', icon: 'swap', color: (t) => t.crit },
};

export default function Progression() {
  const t = useTheme();
  const router = useRouter();
  const { log } = useWorkoutLog();
  const tips = suggestProgression(log);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Next-session targets</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Smart progression from your logged lifts. Aim for these next time.</Text>

        {tips.length === 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center' }}>
            <Icon name="trending" size={26} color={t.ink3} />
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 15, marginTop: 10 }}>No targets yet</Text>
            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 4 }}>Log a few weighted sets and your progression targets will appear here.</Text>
            <Pressable onPress={() => router.push('/(client)/workouts')} style={{ backgroundColor: t.brand, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 11, marginTop: 14 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Log a workout</Text>
            </Pressable>
          </View>
        ) : tips.map((tip) => {
          const m = META[tip.action];
          const c = m.color(t);
          const bump = tip.nextWeight - tip.lastWeight;
          return (
            <View key={tip.exercise} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={m.icon as any} size={19} color={c} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, textTransform: 'capitalize' }}>{tip.exercise}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>Last: {tip.lastWeight}kg × {tip.lastReps}</Text>
                </View>
                <View style={{ backgroundColor: c + '22', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4 }}>
                  <Text style={{ color: c, fontWeight: '800', fontSize: 11 }}>{m.label}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12 }}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 20 }}>{tip.nextWeight}<Text style={{ fontSize: 12, color: t.ink3 }}>kg</Text></Text>
                  {bump !== 0 ? <Text style={{ color: bump > 0 ? t.brand : t.crit, fontSize: 11, fontWeight: '700' }}>{bump > 0 ? '+' + bump : bump}kg</Text> : <Text style={{ color: t.ink3, fontSize: 11 }}>same</Text>}
                </View>
                <View style={{ width: 1, height: 32, backgroundColor: t.ring }} />
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 20 }}>{tip.nextReps}</Text>
                  <Text style={{ color: t.ink3, fontSize: 11 }}>reps</Text>
                </View>
              </View>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 10, lineHeight: 17 }}>{tip.rationale}</Text>
            </View>
          );
        })}

        {tips.length > 0 ? (
          <Text style={{ color: t.ink3, fontSize: 11, marginTop: 6, lineHeight: 16 }}>Double-progression: clear the top of the rep range on every working set, then the weight goes up and reps reset. These are guidance — log what you actually lift.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
