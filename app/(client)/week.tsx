// Client · This Week. The week's training plan at a glance — each day's planned
// focus (coach or auto program) and whether it's been logged. Profile hub.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { buildProgram } from '../../src/lib/programs';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ThisWeek() {
 const t = useTheme();
 const router = useRouter();
 const c = useClientData();
 const coachProgram = useAssignedPrograms().getProgram(c.id);
 const { log } = useWorkoutLog();
 const program = coachProgram ?? buildProgram(c.goal, c.bodyFatPct);

 const jsToMon = (new Date().getDay() + 6) % 7;
 const monday = new Date(); monday.setDate(monday.getDate() - jsToMon); monday.setHours(0, 0, 0, 0);
 const pad = (n: number) => String(n).padStart(2, '0');
 const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
 const logged = new Set(log.map((l) => dstr(new Date(l.t))));

 const trainingDays = program.days.length;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>This Week</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>{program.title}{coachProgram ? ' · coach plan' : ''}</Text>

 {WEEK.map((label, i) => {
 const date = new Date(monday); date.setDate(monday.getDate() + i);
 const workout = program.days[i % trainingDays];
 const isToday = i === jsToMon;
 const done = logged.has(dstr(date));
 return (
 <Pressable key={label} onPress={() => router.push('/(client)/workouts')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: isToday ? t.brand : t.ring, padding: 14, marginBottom: 9 }}>
 <View style={{ width: 46, alignItems: 'center' }}>
 <Text style={{ color: isToday ? t.brand : t.ink3, fontSize: 12, fontWeight: '700' }}>{label}</Text>
 <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{date.getDate()}</Text>
 </View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' }}>{workout.focus}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{workout.exercises.length} exercises{workout.cardio ? ` · ${workout.cardio}` : ''}</Text>
 </View>
 {done ? <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}> done</Text> : isToday ? <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>today</Text> : <Text style={{ color: t.ink3, fontSize: 18 }}>›</Text>}
 </Pressable>
 );
 })}

 <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 14, marginTop: 8 }}>
 <Text style={{ color: t.ink3, fontSize: 13 }}>This program runs {trainingDays} training day{trainingDays === 1 ? '' : 's'} a week. Tap any day to open Train and log it.</Text>
 </View>
 </ScrollView>
 </SafeAreaView>
 );
}
