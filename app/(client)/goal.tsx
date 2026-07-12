// Client · Goal Tracker. Set a target weight + date; see progress from your
// starting weight and a projection from your actual weekly trend. Profile hub.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useGoalTracker } from '../../src/ui/goalTracker';

export default function Goal() {
 const t = useTheme();
 const router = useRouter();
 const c = useClientData();
 const { target, setTarget } = useGoalTracker();
 const [input, setInput] = useState('');

 const series = c.weightSeries;
 const current = c.weightKg;
 const start = series.length ? series[0].v : current;
 const tgt = target.targetWeightKg;

 // Progress from start → target (works for loss or gain).
 const span = tgt - start;
 const done = current - start;
 const pct = span !== 0 ? Math.max(0, Math.min(100, Math.round((done / span) * 100))) : 0;
 const remaining = +(tgt - current).toFixed(1);

 // Trend projection: weekly rate from the weight series.
 let projection: string | null = null;
 if (series.length > 1) {
 const first = series[0], last = series[series.length - 1];
 const days = (Date.parse(last.t) - Date.parse(first.t)) / 86400000;
 const weeklyRate = days > 0 ? (last.v - first.v) / (days / 7) : 0;
 if (weeklyRate !== 0 && Math.sign(tgt - current) === Math.sign(weeklyRate)) {
 const weeks = Math.abs((tgt - current) / weeklyRate);
 const eta = new Date(Date.now() + weeks * 7 * 86400000);
 projection = `At your current pace (${weeklyRate > 0 ? '+' : ''}${weeklyRate.toFixed(2)} kg/wk) you'll hit ${tgt} kg around ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`;
 } else if (Math.abs(remaining) < 0.1) {
 projection = 'You’ve reached your target — set a new one!';
 } else {
 projection = 'Your recent trend isn’t moving toward this target yet. Keep going, or adjust the goal.';
 }
 }

 const targetDate = new Date(target.targetDateISO);
 const daysToDate = Math.round((targetDate.getTime() - Date.now()) / 86400000);

 const saveWeight = () => {
 const n = parseFloat(input);
 if (isNaN(n) || n <= 0) { Alert.alert('Enter a weight', 'Type your target weight in kg.'); return; }
 setTarget({ targetWeightKg: n });
 setInput('');
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Goal Tracker</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Your target weight & projected finish</Text>

 <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
 <View><Text style={{ color: t.ink3, fontSize: 12 }}>Start</Text><Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{start} kg</Text></View>
 <View style={{ alignItems: 'center' }}><Text style={{ color: t.ink3, fontSize: 12 }}>Now</Text><Text style={{ color: t.brand, fontSize: 20, fontWeight: '800' }}>{current} kg</Text></View>
 <View style={{ alignItems: 'flex-end' }}><Text style={{ color: t.ink3, fontSize: 12 }}>Target</Text><Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{tgt} kg</Text></View>
 </View>
 <View style={{ height: 12, borderRadius: 6, backgroundColor: t.surface3, overflow: 'hidden' }}>
 <View style={{ height: 12, borderRadius: 6, backgroundColor: t.brand, width: `${pct}%` }} />
 </View>
 <Text style={{ color: t.ink3, fontSize: 12, marginTop: 8 }}>{pct}% of the way · {Math.abs(remaining)} kg to go · target date {targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ({daysToDate > 0 ? `${daysToDate} days` : 'passed'})</Text>
 </View>

 {projection ? (
 <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 }}>
 <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}> Projection</Text>
 <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20 }}>{projection}</Text>
 </View>
 ) : null}

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>Update target weight (kg)</Text>
 <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
 <TextInput value={input} onChangeText={setInput} keyboardType="numeric" placeholder={`${tgt}`} placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }} />
 <Pressable onPress={saveWeight} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Save</Text></Pressable>
 </View>

 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>Target date</Text>
 <View style={{ flexDirection: 'row', gap: 8 }}>
 {[['4 wks', 28], ['8 wks', 56], ['12 wks', 84], ['16 wks', 112]].map(([label, days]) => (
 <Pressable key={label as string} onPress={() => setTarget({ targetDateISO: new Date(Date.now() + (days as number) * 86400000).toISOString() })} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}>
 <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>{label as string}</Text>
 </Pressable>
 ))}
 </View>
 </ScrollView>
 </SafeAreaView>
 );
}
