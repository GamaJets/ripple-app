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
import { useState, useEffect } from 'react';
import { askCoach, coachAvailable } from '../../src/lib/coach';

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

 const factLines = [
 `Trained ${wk.workouts} time(s) across ${wk.days} active day(s).`,
 `Volume ${(wk.volumeKg / 1000).toFixed(1)} tonnes, ~${wk.kcal} kcal.`,
 `Streak ${streak} day(s).`,
 `Weight ${c.weightKg} kg (${wDelta > 0 ? '+' : ''}${wDelta} kg overall), body fat ${c.bodyFatPct}%, muscle ${c.muscleKg} kg.`,
 waistD != null ? `Waist ${mLatest.waist} cm (${waistD > 0 ? '+' : ''}${waistD} cm).` : '',
 checkIn ? `Check-in energy ${checkIn.energy}/5, sleep ${checkIn.sleep}/5, mood ${checkIn.mood}/5, adherence ${checkIn.adherence}/5.` : '',
 ].filter(Boolean);
 const fallbackNarrative = (() => {
 const bits: string[] = [];
 if (wk.workouts > 0) bits.push(`You trained ${wk.workouts} time${wk.workouts === 1 ? '' : 's'} over ${wk.days} day${wk.days === 1 ? '' : 's'}, moving ${(wk.volumeKg / 1000).toFixed(1)} tonnes of volume.`);
 else bits.push('No logged workouts this week — a fresh chance to get one on the board.');
 if (streak > 0) bits.push(`Your streak is at ${streak} day${streak === 1 ? '' : 's'} — keep it alive.`);
 if (wDelta !== 0) bits.push(`Weight is ${wDelta > 0 ? 'up' : 'down'} ${Math.abs(wDelta)} kg overall${wDelta <= 0 ? ', trending your way' : ''}.`);
 if (checkIn && checkIn.adherence <= 3) bits.push(`Your last check-in put adherence at ${checkIn.adherence}/5 — worth refocusing next week.`);
 return bits.join(' ');
 })();
 const [narrative, setNarrative] = useState(fallbackNarrative);
 useEffect(() => {
 let alive = true;
 setNarrative(fallbackNarrative);
 if (!coachAvailable()) return;
 (async () => {
 const reply = await askCoach(
 [{ role: 'user', content: 'Write a warm, concise 2-3 sentence weekly summary for this client from the facts below. Speak directly to them ("you"), name the biggest win and one focus for next week. No preamble, no lists.\n\n' + factLines.join('\n') }],
 { week: range, name: c.name }
 );
 if (alive && reply && reply.trim()) setNarrative(reply.trim());
 })();
 return () => { alive = false; };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [wk.workouts, wk.days, streak, wDelta, range]);

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

 {narrative ? (
 <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 16 }}>
 <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Your week in a nutshell</Text>
 <Text style={{ color: t.ink2, fontSize: 14.5, lineHeight: 21 }}>{narrative}</Text>
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
