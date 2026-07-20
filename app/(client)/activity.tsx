// Client · Activity (Phase 3-adjacent, no push dependency). A unified, time-sorted
// feed built from the reactive stores: workouts, PRs, streak milestones, check-ins,
// bookings and coach messages. Reachable from the profile hub.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useCheckIns } from '../../src/ui/checkins';
import { useSessions } from '../../src/ui/sessions';
import { currentStreak, isNewPR, streakMilestone } from '../../src/lib/streaks';
import { MOCK_MESSAGES } from '../../src/lib/mockData';

const CLIENT_ID = 'c1';

interface Event { at: string; icon: string; title: string; sub: string; route?: string }

function timeAgo(iso: string) {
 const ms = Date.now() - Date.parse(iso);
 const mins = Math.round(ms / 60000);
 if (mins < 1) return 'just now';
 if (mins < 60) return `${mins}m ago`;
 const hrs = Math.round(mins / 60);
 if (hrs < 24) return `${hrs}h ago`;
 const days = Math.round(hrs / 24);
 return days === 1 ? 'yesterday' : `${days}d ago`;
}
function timeLabel(iso: string) {
 const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
 return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${h}${ap}`;
}

export default function Activity() {
 const t = useTheme();
 const router = useRouter();
 const [open, setOpen] = useState<number | null>(null);
 const { log } = useWorkoutLog();
 const { checkins } = useCheckIns();
 const { sessions } = useSessions();

 const events: Event[] = [];

 // Workouts + PR flags
 for (const e of log) {
 const pr = isNewPR(log, e);
 if (e.sets) {
 events.push({ at: e.t, icon: pr ? 'trophy' : 'dumbbell', title: pr ? `New PR — ${e.exercise}` : `Logged ${e.exercise}`, sub: e.sets.map((s) => `${s[0]}×${s[1]}kg`).join(' · '), route: pr ? '/(client)/records' : '/(client)/trends' });
 } else if (e.cardio) {
 events.push({ at: e.t, icon: 'heart', title: `Logged ${e.exercise}`, sub: [`${e.cardio.mins} min`, e.cardio.dist > 0 ? `${e.cardio.dist} ${e.cardio.unit}` : null, e.cardio.watts && e.cardio.watts > 0 ? `${e.cardio.watts} W` : null].filter(Boolean).join(' · '), route: '/(client)/trends' });
 }
 }
 // Streak milestone (as of now)
 const streak = currentStreak(log);
 const milestone = streakMilestone(streak);
 if (milestone) events.push({ at: new Date().toISOString(), icon: 'flame', title: 'Streak milestone', sub: milestone, route: '/(client)/achievements' });
 // Check-ins
 for (const c of checkins) events.push({ at: c.at, icon: 'pencil', title: 'Weekly check-in sent', sub: `${c.weightKg} kg · energy ${c.energy}/5 · sleep ${c.sleep}/5`, route: '/(client)/checkin' });
 // My sessions
 for (const s of sessions) {
 if (s.status === 'booked' && s.clientId === CLIENT_ID) events.push({ at: s.startsAt, icon: 'calendar', title: 'Session booked', sub: `${timeLabel(s.startsAt)} · ${s.durationMin} min`, route: '/(client)/bookings' });
 }
 // Coach messages
 for (const m of MOCK_MESSAGES) if (m.sender === 'coach') events.push({ at: m.createdAt, icon: 'message', title: 'Message from your coach', sub: m.body, route: '/(client)/messages' });

 events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
 const feed = events.slice(0, 40);

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Activity</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Everything happening across your training</Text>

 {feed.length === 0 ? (
 <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 24, alignItems: 'center' }}>
 <View style={{ marginBottom: 8 }}><Icon name="bell" size={30} color={t.ink3} /></View>
 <Text style={{ color: t.ink3, fontSize: 14, textAlign: 'center' }}>Nothing yet — log a workout or send a check-in to get started.</Text>
 </View>
 ) : feed.map((e, i) => {
 const isOpen = open === i;
 return (
 <Pressable key={i} onPress={() => setOpen(isOpen ? null : i)} accessibilityRole="button" accessibilityLabel={`${e.title}. ${e.sub}. ${isOpen ? 'Collapse' : 'Tap to expand'}`} style={{ flexDirection: 'row', gap: 14, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: isOpen ? t.brand : t.ring, padding: 14, marginBottom: 9 }}>
 <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name={e.icon as any} size={18} color={t.brand} /></View>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{e.title}</Text>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }} numberOfLines={isOpen ? undefined : 2}>{e.sub}</Text>
 {isOpen ? (
 <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: t.ring, paddingTop: 8 }}>
 <Text style={{ color: t.ink3, fontSize: 11.5 }}>{timeLabel(e.at)}</Text>
 {e.route ? (
 <Pressable onPress={() => router.push(e.route as any)} accessibilityRole="button" accessibilityLabel={'Open details for ' + e.title} style={{ alignSelf: 'flex-start', marginTop: 8, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}>
 <Text style={{ color: t.brand, fontWeight: '800', fontSize: 12 }}>View details ›</Text>
 </Pressable>
 ) : null}
 </View>
 ) : null}
 </View>
 <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
 <Text style={{ color: t.ink3, fontSize: 11 }}>{timeAgo(e.at)}</Text>
 <Text style={{ color: isOpen ? t.brand : t.ink3, fontSize: 15, marginTop: 6 }}>{isOpen ? '⌃' : '›'}</Text>
 </View>
 </Pressable>
 );
 })}
 </ScrollView>
 </SafeAreaView>
 );
}
