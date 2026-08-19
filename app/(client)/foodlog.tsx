// Client · Food Log — search the food database, describe a meal in words, or
// photograph a plate; everything lands against today's targets.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every hook (same order), conditional branch, alert and
// route from the previous version is preserved — the four bordered boxes became
// hairline-separated sections and "calories remaining" became the screen's one
// hero figure instead of a 40px number fighting a 10px bar.
//
// Removed as fabricated data: a `BARCODE` constant —
//   const BARCODE = { n: 'Protein Bar (barcode)', k: 210, p: 20, c: 21, f: 7 };
// — which the "Barcode" button logged straight into the client's diary while
// alerting "Barcode Scanned". No barcode was ever read and no product was ever
// looked up: every scan produced the same invented protein bar. The button now
// says nothing was logged and points at the real Open Food Facts lookup.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../src/ui/components';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useClientData } from '../../src/ui/clientData';
import { Icon } from '../../src/ui/Icon';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
import { parseFoodText, foodAIAvailable } from '../../src/lib/foodAI';
import { notifySuccess } from '../../src/ui/haptics';
import { useFoodLog } from '../../src/ui/foodLog';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useWearables } from '../../src/ui/wearables';
import { Rule, Section, SectionHead, Hero, Ghost, ListRow } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';

type Food = { n: string; k: number; p: number; c: number; f: number };
type Logged = Food & { via: string };
// A reference food table — a lookup vocabulary the client searches, not a record
// of anything they ate. Nothing here is logged until they tap it.
const FOOD_DB: Food[] = [
 { n: 'Chicken Breast (150g)', k: 250, p: 47, c: 0, f: 5 }, { n: 'Greek Yogurt (200g)', k: 130, p: 20, c: 9, f: 4 },
 { n: 'Banana', k: 105, p: 1, c: 27, f: 0 }, { n: 'Oats (60g)', k: 230, p: 8, c: 40, f: 5 },
 { n: 'Salmon Fillet (160g)', k: 300, p: 34, c: 0, f: 18 }, { n: 'White Rice (1 cup)', k: 205, p: 4, c: 45, f: 0 },
 { n: 'Whey Shake', k: 160, p: 30, c: 5, f: 2 }, { n: 'Avocado (half)', k: 160, p: 2, c: 9, f: 15 },
 { n: 'Eggs (2)', k: 140, p: 12, c: 1, f: 10 }, { n: 'Almonds (30g)', k: 175, p: 6, c: 6, f: 15 },
 { n: 'Sweet Potato (200g)', k: 180, p: 4, c: 41, f: 0 }, { n: 'Broccoli (150g)', k: 51, p: 4, c: 10, f: 0 },
];
// No baseline estimate. This used to be
//   const PHOTO_GUESS: Food = { n: 'Meal (photo estimate)', k: 520, p: 40, c: 50, f: 16 };
// filled in after a simulated 900ms "Reading Your Meal…" delay whenever the vision
// backend was unavailable — so photographing any plate produced the same invented
// 520 kcal, shown to the client as an AI reading of their own food. When there is no
// real read, the fields stay empty and the UI says so.
const round = (n: number) => Math.round(n);

export default function FoodLog() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const _adj = useCoachNutrition().get(cd.id);
 const target = applyCoachAdjust(macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet }), cd.coachingMode === 'solo' ? undefined : (_adj || undefined));

 const fl = useFoodLog();
 const [q, setQ] = useState('');
 const [nl, setNl] = useState(''); const [nlBusy, setNlBusy] = useState(false);
 const results = q ? FOOD_DB.filter((f) => f.n.toLowerCase().includes(q.toLowerCase())) : [];

 // photo estimate modal state
 const [photoUri, setPhotoUri] = useState<string | null>(null);
 const [reading, setReading] = useState(false);
 // True when a photo was taken but no real nutrition read was possible.
 const [readFailed, setReadFailed] = useState(false);
 const [estN, setEstN] = useState(''); const [estK, setEstK] = useState(''); const [estP, setEstP] = useState(''); const [estC, setEstC] = useState(''); const [estF, setEstF] = useState('');
 const [serv, setServ] = useState(1);

 const add = (f: Food, via: string) => fl.addFood({ name: f.n, kcal: f.k, protein: f.p, carbs: f.c, fat: f.f, via: via as any });
 const logNL = async () => {
   const text = nl.trim(); if (!text) return;
   setNlBusy(true);
   const items = await parseFoodText(text);
   setNlBusy(false);
   if (items && items.length) { items.forEach((it) => add({ n: it.name, k: it.kcal, p: it.protein, c: it.carbs, f: it.fat }, 'ai')); setNl(''); notifySuccess(); }
   else { Alert.alert('Could not read that', foodAIAvailable() ? 'Try describing it differently, e.g. \"2 eggs, toast and a coffee\".' : 'AI food logging turns on with the AI backend.'); }
 };
 // removal handled via fl.removeFood(id) in the list below

 const tot = { k: fl.consumed.kcal, p: fl.consumed.protein, c: fl.consumed.carbs, f: fl.consumed.fat };
 const burned = useWearables().today.activeKcal || 0;
 const remK = (target.kcal + burned) - tot.k;

 const fillEst = (n: string, k: number, p: number, c: number, f: number) => { setEstN(n); setEstK(String(k)); setEstP(String(p)); setEstC(String(c)); setEstF(String(f)); setReadFailed(false); setReading(false); };
 const takeMealPhoto = async (fromCamera: boolean) => {
 const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
 if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your photos') + ' to log a meal by photo.'); return; }
 const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
 if (res.canceled || !res.assets?.[0]) return;
 const asset = res.assets[0];
 setPhotoUri(asset.uri);
 setReading(true); setReadFailed(false); setServ(1);
 // Real vision read when the backend is live; otherwise an editable estimate.
 if (visionAvailable() && asset.base64) {
 let mb = asset.base64;
 try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) mb = mm.base64; } catch {}
 const r = await analyzeMeal(mb, 'image/jpeg');
 if (r) { fillEst(r.name, r.kcal, r.protein, r.carbs, r.fat); return; }
 }
 // No real read available — do not invent one. Blank the fields and switch the
 // sheet's copy to "enter it yourself" rather than claiming an AI estimate.
 setEstN(''); setEstK(''); setEstP(''); setEstC(''); setEstF('');
 setReadFailed(true); setReading(false);
 };

 const logPhoto = () => {
 const k = round((parseFloat(estK) || 0) * serv), p = round((parseFloat(estP) || 0) * serv), c = round((parseFloat(estC) || 0) * serv), f = round((parseFloat(estF) || 0) * serv);
 if (!k) { Alert.alert('Add calories', 'Enter at least a calorie estimate.'); return; }
 add({ n: estN || 'Meal (photo)', k, p, c, f }, 'photo');
 setPhotoUri(null);
 };

 // Nothing is scanned and nothing is logged — say so instead of inventing a hit.
 const barcodeNote = () => Alert.alert('No barcode was scanned', 'Nothing was logged. A real barcode lookup lives on the Meals screen, under "Log what you ate" → Barcode — it reads the product from Open Food Facts.');

 const macroRow = (label: string, cur: number, tg: number, dim?: boolean) => {
 const rem = tg - cur;
 const pct = Math.max(0, Math.min(100, Math.round((cur / (tg || 1)) * 100)));
 return (
 <View key={label} style={{ marginTop: sp.md }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
 <Text style={{ ...ty.caption, color: t.ink2 }}>{label}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{cur} / {tg}g · {rem >= 0 ? `${rem}g left` : `${-rem}g over`}</Text>
 </View>
 <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
 <View style={{ height: 3, borderRadius: 2, width: `${pct}%`, backgroundColor: rem < 0 ? t.crit : t.brand, opacity: dim && rem >= 0 ? 0.45 : 1 }} />
 </View>
 </View>
 );
 };

 const G = layout.gutter;
 const field = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Food log</Text>
 </View>
 </View>

 {/* ── the hero: what is left in the day ──────────────────────────── */}
 <Hero
 label={remK >= 0 ? 'Calories remaining' : 'Calories over'}
 figure={String(Math.abs(remK))}
 unit="kcal"
 note={`${tot.k} of ${target.kcal} kcal eaten${burned ? ` · ${burned} kcal burned` : ''}`}
 arc={target.kcal ? tot.k / target.kcal : 0}
 tone={remK < 0 ? t.crit : undefined}
 />

 <Rule />

 {/* ── macros against target ──────────────────────────────────────── */}
 <Section>
 <SectionHead title="Macros" />
 {macroRow('Protein', tot.p, target.protein)}
 {macroRow('Carbs', tot.c, target.carbs, true)}
 {macroRow('Fat', tot.f, target.fat, true)}
 </Section>

 <Rule />

 {/* ── log a meal ─────────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Log a meal" />
 <View style={{ flexDirection: 'row', gap: sp.sm }}>
 <Pressable accessibilityLabel="Take a meal photo" accessibilityRole="button" onPress={() => takeMealPhoto(true)}
 style={{ flex: 1, backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="camera" size={18} color={t.brandInk} />
 <Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>Photo</Text>
 </Pressable>
 <Pressable accessibilityLabel="Add meal photo from library" accessibilityRole="button" onPress={() => takeMealPhoto(false)}
 style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="plus" size={18} color={t.ink2} />
 <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Upload</Text>
 </Pressable>
 <Pressable accessibilityLabel="Scan barcode" accessibilityRole="button" onPress={barcodeNote}
 style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="search" size={18} color={t.ink2} />
 <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Barcode</Text>
 </Pressable>
 </View>
 <ListRow icon="meals" title="Eating out?" note="Estimate a restaurant meal" onPress={() => router.push('/(client)/restaurant')} />
 </Section>

 <Rule />

 {/* ── describe it in words ───────────────────────────────────────── */}
 <Section>
 <SectionHead title="Describe it" />
 <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 6 }}>In your own words — the AI reads it into macros</Text>
 <View style={{ flexDirection: 'row', gap: sp.sm }}>
 <TextInput value={nl} onChangeText={setNl} placeholder='"chicken burrito & a coke"' placeholderTextColor={t.ink3} onSubmitEditing={logNL} returnKeyType="done"
 style={{ ...field, flex: 1 }} />
 <Pressable onPress={logNL} disabled={nlBusy || !nl.trim()}
 style={{ backgroundColor: nl.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
 {nlBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, fontWeight: '600', color: nl.trim() ? t.brandInk : t.ink3 }}>Log</Text>}
 </Pressable>
 </View>
 </Section>

 <Rule />

 {/* ── search the food table ──────────────────────────────────────── */}
 <Section>
 <SectionHead title="Search foods" note={q ? `${results.length} match${results.length === 1 ? '' : 'es'}` : undefined} />
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
 <Icon name="search" size={16} color={t.ink3} />
 <TextInput value={q} onChangeText={setQ} placeholder="Chicken, oats, banana…" placeholderTextColor={t.ink3}
 style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: 11 }} />
 </View>
 {results.map((f, i) => (
 <View key={f.n}>
 {i > 0 ? <Rule /> : null}
 <Pressable onPress={() => { add(f, 'search'); setQ(''); }} accessibilityRole="button" accessibilityLabel={'Log ' + f.n}
 style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <Text style={{ ...ty.body, color: t.ink, flex: 1 }}>{f.n}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{f.k} kcal</Text>
 <Icon name="plus" size={16} color={t.brand} />
 </Pressable>
 </View>
 ))}
 </Section>

 <Rule />

 {/* ── today's entries, or an honest empty state ──────────────────── */}
 <Section>
 <SectionHead title="Logged today" note={`${tot.k} kcal`} />
 {fl.entries.length === 0 ? (
 <Text style={{ ...ty.label, color: t.ink3 }}>Nothing logged yet today.</Text>
 ) : fl.entries.map((fe, i) => (
 <View key={fe.id}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{fe.name}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{fe.kcal} kcal · P{fe.protein} C{fe.carbs} F{fe.fat}</Text>
 </View>
 <Pressable onPress={() => fl.removeFood(fe.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + fe.name}>
 <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
 </Pressable>
 </View>
 </View>
 ))}
 </Section>

 </ScrollView>

 {/* ── photo → estimate sheet ───────────────────────────────────────── */}
 <Modal visible={photoUri != null} transparent animationType="slide" onRequestClose={() => setPhotoUri(null)}>
 <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPhotoUri(null)} />
 <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
 <Text style={{ ...ty.title, color: t.ink }}>{reading ? 'Reading Your Meal…' : readFailed ? 'Enter This Meal' : 'Confirm & Log'}</Text>
 <Pressable onPress={() => setPhotoUri(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
 <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
 </Pressable>
 </View>
 {photoUri ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: 150, borderRadius: radius.md, backgroundColor: t.surface2, marginBottom: sp.md }} resizeMode="cover" /> : null}
 {reading ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm }}>
 <ActivityIndicator color={t.brand} />
 <Text style={{ ...ty.label, color: t.ink3 }}>Estimating calories and macros…</Text>
 </View>
 ) : (
 <>
 <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>{readFailed ? "Photo reading isn't available yet, so nothing was estimated from your picture — enter the calories and macros and they'll be logged against this photo." : 'AI estimate from your photo — adjust anything before logging.'}</Text>
 <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Meal name</Text>
 <TextInput value={estN} onChangeText={setEstN} placeholder="What was it?" placeholderTextColor={t.ink3} style={{ ...field, marginBottom: sp.md }} />
 <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
 {[['kcal', estK, setEstK], ['P', estP, setEstP], ['C', estC, setEstC], ['F', estF, setEstF]].map(([lbl, val, set]: any) => (
 <View key={lbl} style={{ flex: 1 }}>
 <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>{lbl}</Text>
 <TextInput value={val} onChangeText={set} keyboardType="numeric" style={{ ...field, ...numeric, paddingHorizontal: 10 }} />
 </View>
 ))}
 </View>
 <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Portion</Text>
 <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
 {[0.5, 1, 1.5, 2].map((s) => {
 const on = serv === s;
 return (
 <Pressable key={s} onPress={() => setServ(s)} accessibilityRole="button" accessibilityState={{ selected: on }}
 style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
 <Text style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{s === 1 ? '1×' : s + '×'}</Text>
 </Pressable>
 );
 })}
 </View>
 <Pressable onPress={logPhoto} accessibilityRole="button"
 style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
 <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>Log {round((parseFloat(estK) || 0) * serv)} kcal</Text>
 </Pressable>
 </>
 )}
 </View>
 </Modal>
 </SafeAreaView>
 );
}
