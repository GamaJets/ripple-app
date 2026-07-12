// AI Coach — a chat that knows the client's stats, goal, program & targets.
// Powered by the coach-chat edge function; graceful canned reply until deployed.
import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { macrosFor } from '../../src/lib/nutrition';
import { buildProgram } from '../../src/lib/programs';
import { askCoach, coachAvailable, type ChatMsg } from '../../src/lib/coach';

const SUGGESTIONS = ['What should I eat post-workout?', "I'm sore today — should I still train?", 'Am I on track for my goal?', 'Give me a quick high-protein snack'];

export default function Coach() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const coachProgram = useAssignedPrograms().getProgram(cd.id);
 const macros = macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });
 const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
 const context = {
 name: cd.name, goal: cd.goal, diet: cd.diet, weightKg: Math.round(cd.weightKg * 10) / 10,
 bodyFatPct: cd.bodyFatPct, muscleKg: cd.muscleKg, mealsPerDay: cd.mealsPerDay,
 kcal: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat,
 programTitle: program.title, programFocus: program.focus.join(', '),
 };

 const [msgs, setMsgs] = useState<ChatMsg[]>([
 { role: 'assistant', content: `Hi ${cd.name.split(' ')[0]} I'm your Repple coach. I know your plan, targets, and latest numbers — ask me anything about training or nutrition.` },
 ]);
 const [input, setInput] = useState('');
 const [busy, setBusy] = useState(false);
 const scroller = useRef<ScrollView>(null);

 const send = async (text: string) => {
 const q = text.trim();
 if (!q || busy) return;
 const history: ChatMsg[] = [...msgs, { role: 'user', content: q }];
 setMsgs(history); setInput(''); setBusy(true);
 setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
 const reply = await askCoach(history.filter((m) => m.role === 'user' || m.role === 'assistant'), context);
 setBusy(false);
 setMsgs((m) => [...m, { role: 'assistant', content: reply ?? (coachAvailable() ? "I hit a snag reaching the coach service — try again in a moment." : "The AI coach turns on once your team deploys the coach-chat function and enables AI features. Until then, here's a tip: hit your protein target first — it protects muscle and keeps you full.") }]);
 setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.ring }}>
 <Pressable onPress={() => router.back()}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹</Text></Pressable>
 <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkle" size={17} color={t.brandInk} /></View>
 <View><Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>AI Coach</Text><Text style={{ color: t.ink3, fontSize: 11 }}>Knows your plan &amp; numbers</Text></View>
 </View>

 <ScrollView ref={scroller} contentContainerStyle={{ padding: 16, paddingBottom: 8 }}>
 {msgs.map((m, i) => (
 <View key={i} style={{ flexDirection: 'row', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
 <View style={{ maxWidth: '82%', backgroundColor: m.role === 'user' ? t.brand : t.surface, borderWidth: m.role === 'user' ? 0 : 1, borderColor: t.ring, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
 <Text style={{ color: m.role === 'user' ? t.brandInk : t.ink, fontSize: 14.5, lineHeight: 20 }}>{m.content}</Text>
 </View>
 </View>
 ))}
 {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}><ActivityIndicator color={t.brand} size="small" /><Text style={{ color: t.ink3, fontSize: 12 }}>Coach is thinking…</Text></View> : null}
 {msgs.length <= 1 ? (
 <View style={{ marginTop: 10, gap: 8 }}>
 {SUGGESTIONS.map((s) => (
 <Pressable key={s} onPress={() => send(s)} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 }}>
 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{s}</Text>
 </Pressable>
 ))}
 </View>
 ) : null}
 </ScrollView>

 <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: t.ring, alignItems: 'flex-end' }}>
 <TextInput value={input} onChangeText={setInput} placeholder="Ask your coach…" placeholderTextColor={t.ink3} multiline
 style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15, maxHeight: 120 }} />
 <Pressable onPress={() => send(input)} disabled={!input.trim() || busy} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: input.trim() && !busy ? t.brand : t.surface3, alignItems: 'center', justifyContent: 'center' }}>
 <Text style={{ color: t.brandInk, fontWeight: '900', fontSize: 18 }}>↑</Text>
 </Pressable>
 </View>
 </KeyboardAvoidingView>
 </SafeAreaView>
 );
}
