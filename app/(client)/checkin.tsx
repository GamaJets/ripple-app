// Client · Weekly Check-in (Phase 7). Rate the week and log weight; it goes to
// your coach and updates your tracked weight. Reachable from the profile hub.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useCheckIns } from '../../src/ui/checkins';

const SCALE = ['', '', '', '', ''];

function Rating({ t, label, value, onChange }: { t: Theme; label: string; value: number; onChange: (v: number) => void }) {
 return (
 <View style={{ marginBottom: 18 }}>
 <Text style={{ color: t.ink2, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>{label}</Text>
 <View style={{ flexDirection: 'row', gap: 8 }}>
 {[1, 2, 3, 4, 5].map((n) => (
 <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button" accessibilityLabel={`${label}: ${n} of 5`} accessibilityState={{ selected: value === n }}
 style={{ flex: 1, aspectRatio: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: value === n ? t.brand : t.surface2, borderWidth: 1, borderColor: value === n ? t.brand : t.ring }}>
 <Text style={{ fontSize: 22 }}>{SCALE[n - 1]}</Text>
 </Pressable>
 ))}
 </View>
 </View>
 );
}

export default function CheckIn() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const ci = useCheckIns();

 const [weight, setWeight] = useState(String(Math.round(cd.weightKg * 10) / 10));
 const [energy, setEnergy] = useState(4);
 const [sleep, setSleep] = useState(3);
 const [mood, setMood] = useState(4);
 const [adherence, setAdherence] = useState(4);
 const [note, setNote] = useState('');

 const submit = () => {
 const w = parseFloat(weight) || cd.weightKg;
 if (w > 20 && w < 400) cd.setWeightKg(w);
 ci.addCheckIn({ weightKg: w, energy, sleep, mood, adherence, note: note.trim() });
 Alert.alert('Check-in sent ', 'Your coach can see this week\'s check-in and your weight has been updated.', [{ text: 'Done', onPress: () => router.back() }]);
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
 <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
 <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
 </Pressable>
 <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Weekly Check-in</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 20 }}>A quick pulse for your coach — takes 30 seconds.</Text>

 <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Current Weight (kg)</Text>
 <TextInput value={weight} onChangeText={setWeight} keyboardType="numeric" placeholderTextColor={t.ink3} accessibilityLabel="Current weight in kilograms"
 style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, marginBottom: 22 }} />

 <Rating t={t} label="Energy this week" value={energy} onChange={setEnergy} />
 <Rating t={t} label="Sleep quality" value={sleep} onChange={setSleep} />
 <Rating t={t} label="Mood" value={mood} onChange={setMood} />
 <Rating t={t} label="Plan adherence" value={adherence} onChange={setAdherence} />

 <Text style={{ color: t.ink2, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Anything for your coach?</Text>
 <TextInput value={note} onChangeText={setNote} placeholder="Wins, struggles, questions…" placeholderTextColor={t.ink3} multiline accessibilityLabel="Note for your coach"
 style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, minHeight: 100, textAlignVertical: 'top', marginBottom: 22 }} />

 <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Send check-in" style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Send Check-in</Text>
 </Pressable>

 {ci.latest ? (
 <View style={{ marginTop: 24, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
 <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Last Check-in</Text>
 <Text style={{ color: t.ink2, fontSize: 13 }}>{new Date(ci.latest.at).toLocaleDateString()} · {ci.latest.weightKg} kg · energy {ci.latest.energy}/5 · sleep {ci.latest.sleep}/5</Text>
 {ci.latest.note ? <Text style={{ color: t.ink3, fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>“{ci.latest.note}”</Text> : null}
 </View>
 ) : null}
 </ScrollView>
 </SafeAreaView>
 );
}
