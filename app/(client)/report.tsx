// Client · Weekly Report. A shareable summary that pulls the week together —
// training volume & streak, weight change, and measurement change — from the
// existing reactive stores. Read-only; reached from the profile hub.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useMeasurements } from '../../src/ui/measurements';
import { useCheckIns } from '../../src/ui/checkins';
import { currentStreak, weekStats, personalRecords, streakMilestone } from '../../src/lib/streaks';

function Metric({ t, label, value, delta, deltaGood }: { t: Theme; label: string; value: string; delta?: string; deltaGood?: boolean }) {
 return (
 <View style={{ flex: 1, minWidth: 100, backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
 <Text style={{ color: t.ink3, fontSize: 12 }}>{label}</Text>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', marginTop: 3 }}>{value}</Text>
 {delta ? <Text style={{ color: deltaGood ? t.brand : t.ink3, fontSize: 12, fontWeight: '700', marginTop: 2 }}>{delta}</Text> : null}
 </View>
 );
}

export default function WeeklyReport() {
 const t = useTheme();
 const router = useRouter();
 const c = useClientData();
 const { log } = useWorkoutLog();
 const { entries } = useMeasurements();
 const { latest: checkIn } = useCheckIns();

 const wk = weekStats(log);
 const streak = currentStreak(log);
 const milestone = streakMilestone(streak);
 const prs = personalRecords(log);

 const wSeries = c.weightSeries;
 const wDelta = wSeries.length > 1 ? +(wSeries[wSeries.length - 1].v - wSeries[0].v).toFixed(1) : 0;

 const mLatest = entries[0];
 const mPrev = entries[1];
 const waistD = mLatest && mPrev && mLatest.waist != null && mPrev.waist != null ? +(mLatest.waist - mPrev.waist).toFixed(1) : null;

 const today = new Date();
 const weekStart = new Date(today); weekStart.setDate(today.getDate() - 6);
 const range = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Weekly Report</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>{c.name.split(' ')[0]} · {range}</Text>

 {milestone ? (
 <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 }}>
 <Text style={{ color: t.brand, fontWeight: '800', fontSize: 14 }}> {milestone}</Text>
 </View>
 ) : null}

 <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Training</Text>
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
 <Metric t={t} label="Workouts" value={String(wk.workouts)} delta={`${wk.days} active day${wk.days === 1 ? '' : 's'}`} />
 <Metric t={t} label="Volume" value={`${(wk.volumeKg / 1000).toFixed(1)}t`} delta={` ${wk.kcal.toLocaleString()} kcal`} />
 <Metric t={t} label="Streak" value={`${streak}`} delta={streak === 1 ? 'day' : 'days'} deltaGood={streak > 0} />
 <Metric t={t} label="PRs on record" value={String(prs.length)} delta="all-time" />
 </View>

 <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Body</Text>
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
 <Metric t={t} label="Weight" value={`${c.weightKg} kg`} delta={wDelta !== 0 ? `${wDelta > 0 ? '+' : ''}${wDelta} kg overall` : 'no change'} deltaGood={wDelta <= 0} />
 <Metric t={t} label="Body fat" value={`${c.bodyFatPct}%`} />
 <Metric t={t} label="Muscle" value={`${c.muscleKg} kg`} />
 {waistD != null ? <Metric t={t} label="Waist" value={`${mLatest.waist} cm`} delta={`${waistD > 0 ? '+' : ''}${waistD} cm`} deltaGood={waistD <= 0} /> : null}
 </View>

 {checkIn ? (
 <View>
 <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Latest check-in</Text>
 <View style={{ backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 18 }}>
 <Text style={{ color: t.ink2, fontSize: 13 }}>Energy {checkIn.energy}/5 · sleep {checkIn.sleep}/5 · mood {checkIn.mood}/5 · adherence {checkIn.adherence}/5</Text>
 {checkIn.note ? <Text style={{ color: t.ink3, fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>“{checkIn.note}”</Text> : null}
 </View>
 </View>
 ) : null}

 <Pressable onPress={() => router.push('/(client)/social')} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}> Share my progress</Text>
 </Pressable>
 </ScrollView>
 </SafeAreaView>
 );
}
