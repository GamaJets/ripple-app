// Client · Lifting tools. Three self-contained calculators: 1RM estimator,
// barbell plate math, and a macro quick reference. No backend, pure local state.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same three tabs, same maths, same hooks in the same
// order — the three bordered panels became hairline-separated sections and the
// estimated 1RM became the screen's one hero figure. Every number on this screen
// is computed from what the user typed; nothing is stored or invented.
//
// Also fixed: "Closest loadable" was printed in the reserved warn colour. Status
// colours never colour text — it is now ink text with a coloured mark beside it.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

function OneRM({ t }: { t: Theme }) {
 const [w, setW] = useState('60');
 const [r, setR] = useState('5');
 const weight = parseFloat(w) || 0, reps = parseInt(r, 10) || 0;
 const oneRm = weight && reps ? Math.round(weight * (1 + reps / 30)) : 0;
 const pcts = [100, 95, 90, 85, 80, 75, 70];
 const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1, textAlign: 'center' } as const;
 return (
 <View>
 <Section>
 <SectionHead title="Your best set" />
 <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
 <TextInput value={w} onChangeText={setW} keyboardType="numeric" style={inp} placeholder="kg" placeholderTextColor={t.ink3} accessibilityLabel="Weight in kilograms" />
 <Text style={{ ...ty.label, color: t.ink3 }}>kg ×</Text>
 <TextInput value={r} onChangeText={setR} keyboardType="numeric" style={inp} placeholder="reps" placeholderTextColor={t.ink3} accessibilityLabel="Repetitions" />
 <Text style={{ ...ty.label, color: t.ink3 }}>reps</Text>
 </View>
 </Section>

 <Hero label="Estimated 1RM · Epley" figure={String(oneRm)} unit="kg"
 note={oneRm ? `From ${weight} kg × ${reps} reps` : 'Enter a weight and rep count.'} />

 {oneRm > 0 ? (<>
 <Rule />
 <Section>
 <SectionHead title="Training percentages" />
 {pcts.map((p, i) => (
 <View key={p}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.md }}>
 <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{p}%</Text>
 <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{Math.round((oneRm * p) / 100)} kg</Text>
 </View>
 </View>
 ))}
 </Section>
 </>) : null}
 </View>
 );
}

function PlateCalc({ t }: { t: Theme }) {
 const [target, setTarget] = useState('100');
 const [bar, setBar] = useState(20);
 const total = parseFloat(target) || 0;
 const perSide = Math.max(0, (total - bar) / 2);
 const plates: number[] = [];
 let rem = perSide;
 for (const p of PLATES) { while (rem >= p - 1e-9) { plates.push(p); rem = +(rem - p).toFixed(3); } }
 const achievable = +(bar + plates.reduce((a, p) => a + p, 0) * 2).toFixed(2);
 const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1, textAlign: 'center' } as const;
 return (
 <View>
 <Section>
 <SectionHead title="Load the bar" />
 <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
 <TextInput value={target} onChangeText={setTarget} keyboardType="numeric" style={inp} placeholder="total kg" placeholderTextColor={t.ink3} accessibilityLabel="Target total in kilograms" />
 <Text style={{ ...ty.label, color: t.ink3 }}>bar</Text>
 {[20, 15].map((b) => {
 const on = bar === b;
 return (
 <Pressable key={b} onPress={() => setBar(b)} accessibilityRole="button" accessibilityState={{ selected: on }}
 style={{ paddingHorizontal: sp.md, paddingVertical: 11, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
 <Text style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{b}kg</Text>
 </Pressable>
 );
 })}
 </View>
 </Section>

 <Rule />

 <Section>
 <SectionHead title="Per side" />
 <KpiRow items={[
 { label: 'Each side', value: String(perSide), unit: 'kg' },
 { label: 'Plates a side', value: String(plates.length) },
 { label: 'Loadable total', value: String(achievable), unit: 'kg' },
 ]} />
 </Section>

 {plates.length ? (<>
 <Rule />
 <Section>
 <SectionHead title="Load, heaviest first" />
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
 {plates.map((p, i) => (
 <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
 <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink }}>{p}</Text>
 </View>
 ))}
 </View>
 {achievable !== total ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
 <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
 <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>Closest loadable: {achievable} kg</Text>
 </View>
 ) : (
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Loads exactly.</Text>
 )}
 </Section>
 </>) : (
 <Section>
 <Text style={{ ...ty.label, color: t.ink3 }}>Just the bar ({bar} kg).</Text>
 </Section>
 )}
 </View>
 );
}

function MacroRef({ t }: { t: Theme }) {
 // A reference table — the textbook energy values of each macronutrient, not
 // anything measured about this client.
 const rows = [['Protein', '4 kcal/g', 'Muscle repair · 1.8–2.2 g/kg lean mass'], ['Carbs', '4 kcal/g', 'Training fuel · fill remaining calories'], ['Fat', '9 kcal/g', 'Hormones · ~0.8–1 g/kg bodyweight'], ['Fibre', '~2 kcal/g', 'Aim 25–35 g/day'], ['Alcohol', '7 kcal/g', 'No nutritional value']];
 return (
 <Section>
 <SectionHead title="Macro reference" />
 {rows.map(([k, cal, note], i) => (
 <View key={k}>
 {i > 0 ? <Rule /> : null}
 <View style={{ paddingVertical: sp.md }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{k}</Text>
 <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{cal}</Text>
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text>
 </View>
 </View>
 ))}
 </Section>
 );
}

export default function Tools() {
 const t = useTheme();
 const router = useRouter();
 const [tab, setTab] = useState<'1rm' | 'plates' | 'macros'>('1rm');
 const G = layout.gutter;
 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Calculators for the gym floor</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Lifting tools</Text>
 </View>
 </View>

 <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
 {([['1rm', '1RM'], ['plates', 'Plates'], ['macros', 'Macros']] as const).map(([k, label]) => {
 const on = tab === k;
 return (
 <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
 style={{ flex: 1, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
 <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
 </Pressable>
 );
 })}
 </View>

 {tab === '1rm' ? <OneRM t={t} /> : tab === 'plates' ? <PlateCalc t={t} /> : <MacroRef t={t} />}
 </ScrollView>
 </SafeAreaView>
 );
}
