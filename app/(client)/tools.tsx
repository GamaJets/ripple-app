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
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Field, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import {
  liftingMacros, rangeLabel,
  PROTEIN_G_PER_KG_LEAN, FAT_G_PER_KG_BODYWEIGHT,
} from '../../src/lib/liftingMacros';
import { useSettings } from '../../src/ui/settings';
import {
  readLift, liftIn, liftLabel, est1RMIn, weightIn, weightLabel, convertedNote, plain,
  type WeightUnit,
} from '../../src/lib/units';
import { est1RM } from '../../src/lib/streaks';
import { BARS, loadBar } from '../../src/lib/plateMath';

function OneRM({ t, wu }: { t: Theme; wu: WeightUnit }) {
 // Empty, not "60". A prefilled number on a screen that used to assume
 // kilograms is the defect in miniature: the same 60 means two different loads
 // to two clients, and the one who reads in pounds has no way to tell which it
 // was taken as. Nothing is shown until something is typed into a labelled box.
 const [w, setW] = useState('');
 const [r, setR] = useState('5');
 // The typed load makes the same trip to kilograms that a logged set makes, and
 // through the same reader — so "225" here and "225" in the workout log are the
 // same load, and text that is not a number is refused rather than quietly
 // becoming 0 and estimating a one-rep max from it.
 const read = readLift(w, wu);
 const kg = read.ok ? read.kg : null;
 const reps = parseInt(r, 10) || 0;
 // Epley, computed on the record's own kilograms and through the very function
 // History's personal records use. The formula does not care about units, but
 // WHICH figure it is applied to does: estimating in pounds and converting the
 // answer would put this screen a pound or two away from the PR list for the
 // same set, and two screens disagreeing about one lift is how a client learns
 // not to trust either.
 const oneRmKg = kg && reps ? est1RM(kg, reps) : 0;
 // `?? 0` only for the empty case: est1RMIn returns null when it is handed
 // nothing, which is exactly when there is no estimate to show.
 const oneRm = est1RMIn(oneRmKg || null, wu) ?? 0;
 const pcts = [100, 95, 90, 85, 80, 75, 70];
 const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1, textAlign: 'center' } as const;
 return (
 <View>
 <Section>
 <SectionHead title="Your Best Set" />
 {/* The unit was in a placeholder and in a bare "kg ×" beside the box, and
     the placeholder is drawn only while the field is EMPTY. So the moment a
     load was typed the screen stopped saying what it was reading, and it was
     reading kilograms whatever the client had chosen. Field's label stays. */}
 <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
 <Field label="Weight" hint={wu} a11y={`Weight in ${wu === 'lb' ? 'pounds' : 'kilograms'}`}>
 <TextInput value={w} onChangeText={setW} keyboardType="numeric" style={inp} placeholder={wu} placeholderTextColor={t.ink3} />
 </Field>
 <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>×</Text>
 <Field label="Reps">
 <TextInput value={r} onChangeText={setR} keyboardType="numeric" style={inp} placeholder="reps" placeholderTextColor={t.ink3} />
 </Field>
 </View>
 </Section>

 {/* A refused load says so where the answer would have been, rather than
     leaving the last good estimate on screen next to a number it was not
     computed from. */}
 <Hero label="Estimated 1RM · Epley" figure={fig(oneRm || null)} unit={wu}
 note={!read.ok ? read.reason : oneRm ? `From ${liftLabel(kg, wu)} × ${reps} reps` : 'Enter a weight and rep count.'} />

 {oneRm > 0 ? (<>
 <Rule />
 <Section>
 <SectionHead title="Training Percentages" />
 {pcts.map((p, i) => (
 <View key={p}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.md }}>
 <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{p}%</Text>
 {/* Each percentage is taken off the KILOGRAM estimate and read out once,
     rather than off the already-converted figure — so the 100% row is the
     hero to the pound rather than a pound away from it. */}
 <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>{fig(est1RMIn((oneRmKg * p) / 100, wu))} {wu}</Text>
 </View>
 </View>
 ))}
 </Section>
 </>) : null}
 </View>
 );
}

function PlateCalc({ t, wu }: { t: Theme; wu: WeightUnit }) {
 // Empty rather than "100", for the reason the 1RM box is: a prefilled number
 // on a screen that assumed kilograms means one thing to the client who chose
 // them and something 2.2 times heavier to the client who did not.
 const [target, setTarget] = useState('');
 // WHICH bar, not how heavy. The rack changes with the unit, and a bar held as
 // the number 20 would survive a flip to pounds as a "20 lb bar" — a bar no gym
 // owns. src/lib/plateMath.ts says why the imperial pair is 45 and 35 rather
 // than the metric pair converted to 44.09 and 33.07.
 const [barIdx, setBarIdx] = useState(0);
 const bars = BARS[wu];
 const bar = bars[Math.min(barIdx, bars.length - 1)];
 // The typed target makes the same trip to kilograms and back that a logged set
 // makes, so this screen and the workout log agree on what "225 lb" is before a
 // single plate is chosen — and a target that is not a number is refused, in the
 // unit it was typed in, instead of becoming 0 and loading an empty bar.
 const read = readLift(target, wu);
 const asked = read.ok ? liftIn(read.kg, wu) : null;
 const load = loadBar(asked, bar, wu);
 const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, flex: 1, textAlign: 'center' } as const;
 return (
 <View>
 <Section>
 <SectionHead title="Load the Bar" />
 {/* "total kg" was a placeholder, so the one number on this screen you type
     rather than read lost its unit as soon as it had a value — and the two
     bar buttons beside it are both labelled in kg, which makes a bare figure
     next to them read like a third one. Both now name the client's own unit. */}
 <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
 <Field label="Target total" hint={wu}>
 <TextInput value={target} onChangeText={setTarget} keyboardType="numeric" style={inp} placeholder={wu} placeholderTextColor={t.ink3} />
 </Field>
 <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>bar</Text>
 {bars.map((b, i) => {
 const on = i === barIdx;
 return (
 <Pressable key={b} onPress={() => setBarIdx(i)} accessibilityRole="button" accessibilityState={{ selected: on }}
 style={{ paddingHorizontal: sp.md, paddingVertical: 11, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
 <Text style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{b} {wu}</Text>
 </Pressable>
 );
 })}
 </View>
 </Section>

 <Rule />

 {load ? (<>
 <Section>
 <SectionHead title="Per Side" />
 {/* "Each Side" is what the PLATES BELOW weigh, not half the gap between the
     target and the bar. The two differ whenever the rack cannot make the
     number asked for, and the old screen printed the second one — 41.5 a
     side over a list of plates adding to 41.25, under a loadable total of
     102.5. Three figures that cannot all be true. */}
 <KpiRow items={[
 { label: 'Each Side', value: fig(load.perSide), unit: wu },
 { label: 'Plates a Side', value: fig(load.plates.length) },
 { label: 'Loadable Total', value: fig(load.total), unit: wu },
 ]} />
 </Section>

 {load.plates.length ? (<>
 <Rule />
 <Section>
 <SectionHead title="Load, Heaviest First" note={`${wu} a side`} />
 <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
 {load.plates.map((p, i) => (
 <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
 <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink }}>{p}</Text>
 </View>
 ))}
 </View>
 {!load.exact ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
 <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
 <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>Closest loadable: {plain(load.total)} {wu}</Text>
 </View>
 ) : (
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Loads exactly.</Text>
 )}
 </Section>
 </>) : (
 <Section>
 <Text style={{ ...ty.label, color: t.ink3 }}>Just the bar ({bar} {wu}).</Text>
 </Section>
 )}
 </>) : (
 <Section>
 {/* Three different silences, and none of them may look like an answer: a
     refusal, an empty box, and a target lighter than the bar itself. The
     old screen answered all three with a bar loaded to 0. */}
 <Text style={{ ...ty.label, color: t.ink3 }}>
 {!read.ok
 ? read.reason
 : asked == null
 ? 'Enter the total you want on the bar, the bar included.'
 : `${plain(asked)} ${wu} is lighter than the ${bar} ${wu} bar on its own.`}
 </Text>
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

function MacroRef({ t, wu }: { t: Theme; wu: WeightUnit }) {
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
 {/* The client's own bodyweight, read out the way every other screen reads
     it. It was printed in kilograms here whatever they had chosen, which is
     the same figure their profile shows in pounds — two numbers for one
     body, and no way to tell which the grams below were worked out from. */}
 <KpiRow items={[
 { label: 'Bodyweight', value: fig(weightIn(c.weightKg, wu)), unit: wu },
 { label: 'Body Fat', value: fig(c.bodyFatPct), unit: '%' },
 { label: 'Lean Mass', value: fig(weightIn(m.leanMassKg, wu)), unit: wu },
 ]} />
 {convertedNote(wu) ? (
 <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{convertedNote(wu)}</Text>
 ) : null}
 </Section>

 <Rule />

 <Section>
 <SectionHead title="Your Daily Targets" />
 {/* The working stays in kilograms even for a pounds reader, and deliberately.
     The guideline itself is published per kilogram — there is no "2 g per lb"
     rule to quote, and inventing one by dividing would put a number on screen
     that no source stands behind. The grams are the same grams either way; the
     figures above are the ones that had to follow the client's unit, and the
     converted note there is what stops "64 kg" here reading as a discrepancy. */}
 <TargetRow t={t} name="Protein" grams={rangeLabel(m.protein)}
 from={`${PROTEIN_G_PER_KG_LEAN.low}–${PROTEIN_G_PER_KG_LEAN.high} g per kg of your ${fig(weightLabel(m.leanMassKg, 'kg'))} lean mass`} />
 <Rule />
 {/* Fat is the one taken off TOTAL bodyweight. It is the distinction the
 table draws and the one that gets lost when somebody does this in
 their head at the rack. */}
 <TargetRow t={t} name="Fat" grams={rangeLabel(m.fat)}
 from={`${FAT_G_PER_KG_BODYWEIGHT.low}–${FAT_G_PER_KG_BODYWEIGHT.high} g per kg of your ${fig(weightLabel(c.weightKg, 'kg'))} bodyweight`} />
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
 // The unit every other screen in the app reads weights in. This one ignored
 // it: a client who thinks in pounds typed 225, the 1RM tab took it as 225 kg,
 // and the plate tab answered with a metric rack on a 20 kg bar.
 //
 // ── What this screen can and cannot know ─────────────────────────────────
 //
 // It cannot tell a client who CHOSE kilograms from one who has never been
 // asked. `clients.weight_unit` is NULL until somebody taps the setting, and
 // src/ui/settings.tsx resolves that NULL to the app default before this hook
 // hands anything over — so there is no null arriving here to honour, and a
 // second read of that column from the gym floor would only move the guess
 // somewhere else.
 //
 // What this screen can do is stop the assumption being SILENT, which is what
 // made the wrong answer wrong. Every box names its unit in a label that stays,
 // every figure carries it, and the line under the tabs says which unit the
 // tools are working in and leads to the one place it is chosen. A client who
 // reads in pounds finds out before they type, not after they load the bar.
 const wu = useSettings().weightUnit;
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

 {/* Which unit these calculators are working in, said out loud and always —
     including to the client who has never chosen one and is therefore being
     shown the app's default. It is one tap from here to the setting, because a
     client standing at a rack being told the wrong unit needs to change it now,
     not find their way to Profile → Settings first. */}
 <Pressable onPress={() => router.push('/(client)/settings')} accessibilityRole="button"
 accessibilityLabel={`Working in ${wu === 'lb' ? 'pounds' : 'kilograms'}. Change your weight unit in Settings.`}
 hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
 style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md }}>
 <Text style={{ ...ty.caption, color: t.ink3 }}>
 Working in {wu === 'lb' ? 'pounds' : 'kilograms'} · Change
 </Text>
 </Pressable>

 {tab === '1rm' ? <OneRM t={t} wu={wu} /> : tab === 'plates' ? <PlateCalc t={t} wu={wu} /> : <MacroRef t={t} wu={wu} />}
 </ScrollView>
 </SafeAreaView>
 );
}
