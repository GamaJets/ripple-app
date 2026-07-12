// Client · Achievements (Phase 7). Badges derived from the reactive workout log:
// streaks, total sessions, PRs, cardio, volume. Earned badges glow; locked show
// what to do next. Reachable from the profile hub and the dashboard streak card.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { longestStreak, personalRecords } from '../../src/lib/streaks';

export default function Achievements() {
 const t = useTheme();
 const router = useRouter();
 const { log } = useWorkoutLog();

 const totalWorkouts = log.length;
 const best = longestStreak(log);
 const prs = personalRecords(log).length;
 const hasCardio = log.some((e) => e.cardio);
 const totalVolume = log.reduce((a, e) => a + (e.sets ? e.sets.reduce((x, [r, w]) => x + (r || 0) * (w || 0), 0) : 0), 0);

 const badges: { icon: string; title: string; desc: string; earned: boolean }[] = [
 { icon: '', title: 'First Rep', desc: 'Log your first workout', earned: totalWorkouts >= 1 },
 { icon: '', title: 'On a Roll', desc: '3-day streak', earned: best >= 3 },
 { icon: '', title: 'Week Warrior', desc: '7-day streak', earned: best >= 7 },
 { icon: '', title: 'Two Weeks Strong', desc: '14-day streak', earned: best >= 14 },
 { icon: '', title: 'Unstoppable', desc: '30-day streak', earned: best >= 30 },
 { icon: '', title: 'Ten Sessions', desc: 'Log 10 workouts', earned: totalWorkouts >= 10 },
 { icon: '', title: 'Fifty Club', desc: 'Log 50 workouts', earned: totalWorkouts >= 50 },
 { icon: '', title: 'Record Breaker', desc: 'Set a personal record', earned: prs >= 1 },
 { icon: '', title: 'PR Machine', desc: '5 personal records', earned: prs >= 5 },
 { icon: '', title: 'Cardio Kick', desc: 'Log a cardio session', earned: hasCardio },
 { icon: '', title: 'One Tonne', desc: 'Lift 1,000 kg total volume', earned: totalVolume >= 1000 },
 { icon: '', title: 'Ten Tonnes', desc: 'Lift 10,000 kg total volume', earned: totalVolume >= 10000 },
 ];
 const earnedCount = badges.filter((b) => b.earned).length;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Achievements</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>{earnedCount} of {badges.length} unlocked</Text>

 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
 {badges.map((b) => (
 <View
 key={b.title}
 accessibilityLabel={`${b.title}, ${b.earned ? 'unlocked' : 'locked'}. ${b.desc}`}
 style={{ width: '47%', backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: b.earned ? t.brand : t.ring, padding: 16, alignItems: 'center', opacity: b.earned ? 1 : 0.5 }}
 >
 <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: b.earned ? 'rgba(45,212,191,0.15)' : t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
 <Text style={{ fontSize: 28 }}>{b.earned ? b.icon : ''}</Text>
 </View>
 <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14, textAlign: 'center' }}>{b.title}</Text>
 <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 3 }}>{b.desc}</Text>
 </View>
 ))}
 </View>
 </ScrollView>
 </SafeAreaView>
 );
}
