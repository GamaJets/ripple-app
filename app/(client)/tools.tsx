// Client · Lifting tools. Three tabs for the gym floor: 1RM estimator, barbell
// plate math, and the macro targets those lifts are fed by.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same three tabs, same maths, same hooks in the same
// order — the three bordered panels became hairline-separated sections and the
// estimated 1RM became the screen's one hero figure.
//
// Also fixed: "Closest loadable" was printed in the reserved warn colour. Status
// colours never colour text — it is now ink text with a coloured mark beside it.
//
// ── TF-15: the Macros tab was a page of homework ───────────────────────────
//
// The first two tabs answer a question you are holding a barbell while asking.
// The third printed a textbook table — "1.8–2.2 g/kg lean mass", "~0.8–1 g/kg
// bodyweight" — and left the reader to find their lean mass, work out the
// multiplication, and do it on figures this app is already holding. That is why
// it was the tab nobody opened, and the fix is not another calculator: it is the
// same two lines of guidance resolved against this client's own recorded weight
// and body fat, with the table kept underneath as the working.
//
// The rest of the screen still computes only from what the user types. This tab
// is the one that reads: it takes the client's weight and body fat from
// `clientData` and NOTHING else, and when either is missing it says so and
// offers the way to record them. It never fills in a body — that fallback (70 kg
// / 20%) is exactly what `clientData` was changed to stop handing out.
import { useState, useEffect } from 'react';
import { num } from '../../src/lib/format';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import {
  liftingMacros, rangeLabel,
  PROTEIN_G_PER_KG_LEAN, FAT_G_PER_KG_BODYWEIGHT,
} from '../../src/lib/liftingMacros';

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
 <SectionHead title="Your Best Set" />
 <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
 <TextInput value={w} onChangeText={setW} keyboardType="numeric" style={inp} placeholder="kg" placeholderTextColor={t.ink3} accessibilityLabel="Weight in kilograms" />
 <Text style={{ ...ty.label, color: t.ink3 }}>kg ×</Text>
 <TextInput value={r} onChangeText={setR} keyboardType="numeric" style={inp} placeholder="reps" placeholderTextColor={t.ink3} accessibilityLabel="Repetitions" />
 <Text style={{ ...ty.label, color: t.ink3 }}>reps</Text>
 </View>
 </Section>

 <Hero label="Estimated 1RM · Epley" figure={fig(oneRm)} unit="kg"
 note={oneRm ? `From ${weight} kg × ${reps} reps` : 'Enter a weight and rep count.'} />

 {oneRm > 0 ? (<>
 <Rule />
 <Section>
 <SectionHead title="Training Percentages" />
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
 <SectionHead title="Load the Bar" />
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
 <SectionHead title="Per Side" />
 <KpiRow items={[
 { label: 'Each Side', value: fig(perSide), unit: 'kg' },
 { label: 'Plates a Side', value: fig(plates.length) },
 { label: 'Loadable Total', value: fig(achievable), unit: 'kg' },
 ]} />
 </Section>

 {plates.length ? (<>
 <Rule />
 <Section>
 <SectionHead title="Load, Heaviest First" />
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

/** One worked target: the grams, and the line of the table it came from. */
function TargetRow({ t, name, grams, from }: { t: Theme; name: string; grams: string; from: string }) {
 return (
 <View style={{ paddingVertical: sp.md }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{name}</Text>
 <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{grams}</Text>
 </View>
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{from}</Text>
 </View>
 );
}

function MacroRef({ t }: { t: Theme }) {
 const c = useClientData();
 const router = useRouter();
 // The client's own two figures and nothing else. Null all the way through when
 // either is absent — see src/lib/liftingMacros.ts for why there is no default.
 const m = liftingMacros(c.weightKg, c.bodyFatPct, c.mealsPerDay);
 // The energy values are the textbook's and are true of everyone; only the two
 // g/kg lines are per-person, and those are now worked out above rather than
 // left as an instruction. The table stays as the working behind them.
 const rows = [['Protein', '4 kcal/g', 'Muscle repair · 1.8–2.2 g/kg lean mass'], ['Carbs', '4 kcal/g', 'Training fuel · fill remaining calories'], ['Fat', '9 kcal/g', 'Hormones · ~0.8–1 g/kg bodyweight'], ['Fibre', '~2 kcal/g', 'Aim 25–35 g/day'], ['Alcohol', '7 kcal/g', 'No nutritional value']];
 return (
 <View>
 {m ? (<>
 <Section>
 <SectionHead title="Your Figures" note="Your latest scan or measurement" />
 <KpiRow items={[
 { label: 'Bodyweight', value: fig(c.weightKg), unit: 'kg' },
 { label: 'Body Fat', value: fig(c.bodyFatPct), unit: '%' },
 { label: 'Lean Mass', value: fig(m.leanMassKg), unit: 'kg' },
 ]} />
 </Section>

 <Rule />

 <Section>
 <SectionHead title="Your Daily Targets" />
 <TargetRow t={t} name="Protein" grams={rangeLabel(m.protein)}
 from={`${PROTEIN_G_PER_KG_LEAN.low}–${PROTEIN_G_PER_KG_LEAN.high} g per kg of your ${fig(m.leanMassKg)} kg lean mass`} />
 <Rule />
 {/* Fat is the one taken off TOTAL bodyweight. It is the distinction the
 table draws and the one that gets lost when somebody does this in
 their head at the rack. */}
 <TargetRow t={t} name="Fat" grams={rangeLabel(m.fat)}
 from={`${FAT_G_PER_KG_BODYWEIGHT.low}–${FAT_G_PER_KG_BODYWEIGHT.high} g per kg of your ${fig(c.weightKg)} kg bodyweight`} />
 {m.proteinPerMeal ? (<>
 <Rule />
 <TargetRow t={t} name="Protein a meal" grams={rangeLabel(m.proteinPerMeal)}
 from={`The day's protein across your ${c.mealsPerDay} meals`} />
 </>) : null}
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
 No carbohydrate figure here: carbs fill whatever calories are left once protein and fat are set, and that depends on the goal your meal plan is built to.
 </Text>
 <View style={{ marginTop: sp.lg }}>
 <Cta label="Open Your Meal Plan" wide onPress={() => router.push('/(client)/nutrition')} />
 </View>
 </Section>
 </>) : (
 <Section>
 <SectionHead title="Your Daily Targets" />
 {/* Three different silences, and they must not read alike: a refused
 read is not "you have never been measured", and neither is a read
 still in flight. Only the third offers the way to fix it. */}
 <Text style={{ ...ty.label, color: t.ink3 }}>
 {c.status === 'loading'
 ? 'Reading your measurements…'
 : c.status === 'error'
 ? 'We could not read your weight and body fat, so these are not worked out. They are still on your record — we just cannot see them right now.'
 : 'These are worked out from your weight and body fat, and there is nothing on record yet to work them out from.'}
 </Text>
 {c.status === 'ready' ? (
 <View style={{ marginTop: sp.lg }}>
 <Cta label="Add Your Measurements" wide onPress={() => router.push('/(client)/scans')} />
 </View>
 ) : null}
 </Section>
 )}

 <Rule />

 <Section>
 <SectionHead title="Macro Reference" note={m ? 'Where those figures come from' : undefined} />
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
 </View>
 );
}

export default function Tools() {
 const t = useTheme();
 const router = useRouter();
 // A caller can name the tab. Meals links here for the macro reference, and
 // landing that reader on the 1RM estimator is how "why is tapping macros
 // sending you to lifting tools?" got reported — the destination was right and
 // the tab was not, which reads as being sent somewhere unrelated.
 //
 // ── Why the param needs an effect and not just an initial value ───────────
 //
 // Reading `wanted` into useState looked like the whole fix and was not. This
 // screen is a Tabs.Screen (href: null), so it MOUNTS ONCE and stays mounted
 // for the life of the app — a useState initialiser runs on that first mount
 // and never again. Anybody who had already opened Lifting Tools once, by any
 // route, had `tab` sitting at '1rm' already, and every later
 // `push({ tab: 'macros' })` changed the URL and nothing else. Reported a
 // second time, correctly, as still landing on 1RM.
 const { tab: wanted } = useLocalSearchParams<{ tab?: string }>();
 const [tab, setTab] = useState<'1rm' | 'plates' | 'macros'>(
   wanted === 'macros' || wanted === 'plates' || wanted === '1rm' ? wanted : '1rm',
 );
 // Consumed and then cleared, which is what makes a REPEAT visit work. Left in
 // place, the param stays 'macros'; the client taps 1RM, comes back through the
 // same shortcut, and this effect sees no change to react to — so the screen
 // would honour the link exactly once per app launch. Clearing it returns
 // `wanted` to undefined, so the next tap is a real transition again.
 //
 // An absent param deliberately does nothing: arriving here from anywhere else
 // must leave the client on whichever tab they last chose, not haul them back.
 useEffect(() => {
   if (wanted !== 'macros' && wanted !== 'plates' && wanted !== '1rm') return;
   setTab(wanted);
   router.setParams({ tab: undefined });
 }, [wanted]);
 const G = layout.gutter;
 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Calculators for the gym floor</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Lifting Tools</Text>
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
