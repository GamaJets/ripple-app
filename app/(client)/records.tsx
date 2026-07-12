// Client · Personal Records. The full PR board (the dashboard shows only the top
// three) — every lift's best estimated 1RM, sorted, with the set that set it.
// Read-only from the workout log via personalRecords().
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { personalRecords } from '../../src/lib/streaks';

export default function Records() {
 const t = useTheme();
 const router = useRouter();
 const { log } = useWorkoutLog();
 const prs = [...personalRecords(log)].sort((a, b) => b.est1RM - a.est1RM);

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Personal Records</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Your best estimated 1-rep max per lift</Text>

 {prs.length === 0 ? (
 <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 24, alignItems: 'center' }}>
 <View style={{ marginBottom: 8 }}><Icon name="trophy" size={30} color={t.ink3} /></View>
 <Text style={{ color: t.ink3, fontSize: 14, textAlign: 'center' }}>No records yet — log a strength workout to set your first PR.</Text>
 </View>
 ) : prs.map((pr, i) => (
 <View key={pr.exercise} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: i === 0 ? t.brand : t.ring, padding: 15, marginBottom: 9 }}>
 <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: i === 0 ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
 <Text style={{ color: i === 0 ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 14 }}>{i + 1}</Text>
 </View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{pr.exercise}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>Best set {pr.weight} kg × {pr.reps} · {new Date(pr.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
 </View>
 <View style={{ alignItems: 'flex-end' }}>
 <Text style={{ color: t.brand, fontWeight: '800', fontSize: 17 }}>{pr.est1RM}</Text>
 <Text style={{ color: t.ink3, fontSize: 10 }}>est 1RM</Text>
 </View>
 </View>
 ))}
 </ScrollView>
 </SafeAreaView>
 );
}
