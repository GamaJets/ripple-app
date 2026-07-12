// Client · Recovery & Wellness. Hydration tracker, sleep log, mobility routines,
// and rest-day guidance. Profile hub.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWellness } from '../../src/ui/wellness';

const MOBILITY = [
 { name: 'Full-body warm-up', dur: '6 min', moves: ['Leg swings ×10/side', 'World’s greatest stretch ×5/side', 'Cat-cow ×10', 'Band pull-aparts ×15', 'Bodyweight squats ×10'] },
 { name: 'Hip & lower-body', dur: '5 min', moves: ['90/90 hip switch ×8', 'Couch stretch 45s/side', 'Ankle rocks ×12/side', 'Glute bridge ×15'] },
 { name: 'Shoulders & upper', dur: '5 min', moves: ['Wall slides ×12', 'Thread the needle ×6/side', 'Doorway pec stretch 30s', 'Scapular push-ups ×12'] },
];

export default function Recovery() {
 const t = useTheme();
 const router = useRouter();
 const { cups, goalCups, addCup, removeCup, sleep, addSleep } = useWellness();
 const [hrs, setHrs] = useState('7.5');
 const [q, setQ] = useState(4);
 const [openRoutine, setOpenRoutine] = useState<number | null>(0);

 const avgSleep = sleep.length ? (sleep.reduce((a, s) => a + s.hours, 0) / sleep.length).toFixed(1) : '—';
 const pct = Math.min(100, Math.round((cups / goalCups) * 100));

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Recovery</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Hydration, sleep & mobility</Text>

 {/* Hydration */}
 <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 14 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
 <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}> Hydration</Text>
 <Text style={{ color: t.ink3, fontSize: 13 }}>{cups} / {goalCups} cups</Text>
 </View>
 <View style={{ height: 12, borderRadius: 6, backgroundColor: t.surface3, overflow: 'hidden', marginBottom: 12 }}>
 <View style={{ height: 12, borderRadius: 6, backgroundColor: t.s1, width: `${pct}%` }} />
 </View>
 <View style={{ flexDirection: 'row', gap: 10 }}>
 <Pressable onPress={removeCup} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>−</Text></Pressable>
 <Pressable onPress={addCup} style={{ flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>＋ Add a cup</Text></Pressable>
 </View>
 </View>

 {/* Sleep */}
 <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 14 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
 <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}> Sleep</Text>
 <Text style={{ color: t.ink3, fontSize: 13 }}>avg {avgSleep} h</Text>
 </View>
 <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 }}>
 <TextInput value={hrs} onChangeText={setHrs} keyboardType="numeric" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, width: 80, textAlign: 'center' }} />
 <Text style={{ color: t.ink3, fontSize: 13 }}>hrs · quality</Text>
 {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} onPress={() => setQ(n)}><Text style={{ fontSize: 20, opacity: n <= q ? 1 : 0.3 }}></Text></Pressable>)}
 </View>
 <Pressable onPress={() => addSleep(parseFloat(hrs) || 0, q)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 12 }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Log sleep</Text></Pressable>
 {sleep.slice(0, 4).map((sx) => (
 <View key={sx.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.ring }}>
 <Text style={{ color: t.ink3, fontSize: 13 }}>{new Date(sx.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>{sx.hours} h · {''.repeat(sx.quality)}</Text>
 </View>
 ))}
 </View>

 {/* Mobility routines */}
 <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Mobility & warm-ups</Text>
 {MOBILITY.map((r, i) => {
 const open = openRoutine === i;
 return (
 <View key={r.name} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, marginBottom: 9, overflow: 'hidden' }}>
 <Pressable onPress={() => setOpenRoutine(open ? null : i)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 }}>
 <View><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{r.name}</Text><Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{r.dur}</Text></View>
 <Text style={{ color: t.ink3, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
 </Pressable>
 {open ? (
 <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
 {r.moves.map((m) => <Text key={m} style={{ color: t.ink2, fontSize: 13, marginTop: 5 }}>· {m}</Text>)}
 </View>
 ) : null}
 </View>
 );
 })}

 {/* Rest-day guidance */}
 <View style={{ backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginTop: 8 }}>
 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, marginBottom: 6 }}> Rest-day guidance</Text>
 <Text style={{ color: t.ink3, fontSize: 13, lineHeight: 19 }}>Aim for 1–2 rest days a week. Deload every 4–6 weeks (drop ~40% volume) to let strength catch up. Light walking, mobility, and 7–9 h sleep beat total inactivity for recovery.</Text>
 </View>
 </ScrollView>
 </SafeAreaView>
 );
}
