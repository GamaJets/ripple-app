// Client · Daily Habits & Water (Phase 7). Check off habits and log water; the
// water goal auto-completes the water habit. Reachable from the profile hub.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useHabits } from '../../src/ui/habits';

export default function Habits() {
  const t = useTheme();
  const router = useRouter();
  const h = useHabits();
  const pct = Math.round((h.doneCount / h.habits.length) * 100);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Daily Habits</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Small wins, every day — {h.doneCount}/{h.habits.length} done</Text>

        {/* Progress ring-ish bar */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>Today's Progress</Text>
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 20 }}>{pct}%</Text>
          </View>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: t.brand, width: (pct || 0) + '%' }} />
          </View>
        </View>

        {/* Water tracker */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>💧 Water</Text>
            <Text style={{ color: t.ink3, fontSize: 13, fontWeight: '600' }}>{h.water} / {h.waterGoal} glasses</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {Array.from({ length: h.waterGoal }).map((_, i) => (
              <View key={i} style={{ width: 26, height: 34, borderRadius: 6, borderWidth: 1.5, borderColor: i < h.water ? t.brand : t.ring, backgroundColor: i < h.water ? 'rgba(45,212,191,0.2)' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, opacity: i < h.water ? 1 : 0.25 }}>💧</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={h.removeWater} accessibilityRole="button" accessibilityLabel="Remove a glass of water" style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: t.ink2, fontWeight: '800', fontSize: 16 }}>−</Text>
            </Pressable>
            <Pressable onPress={h.addWater} accessibilityRole="button" accessibilityLabel="Add a glass of water" style={{ flex: 2, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>＋ Add a glass</Text>
            </Pressable>
          </View>
        </View>

        {/* Habit checklist */}
        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 10 }}>Checklist</Text>
        {h.habits.map((hb) => (
          <Pressable
            key={hb.id}
            onPress={() => h.toggleHabit(hb.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: hb.done }}
            accessibilityLabel={hb.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: hb.done ? t.brand : t.ring, padding: 15, marginBottom: 9 }}
          >
            <Text style={{ fontSize: 22 }}>{hb.icon}</Text>
            <Text style={{ flex: 1, color: t.ink, fontWeight: '700', fontSize: 15 }}>{hb.label}</Text>
            <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: hb.done ? t.brand : t.ring, backgroundColor: hb.done ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {hb.done ? <Text style={{ color: t.brandInk, fontWeight: '900', fontSize: 14 }}>✓</Text> : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
