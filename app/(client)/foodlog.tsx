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
import { useState, useEffect, useMemo } from 'react';
import { num } from '../../src/lib/format';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, Image, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../src/ui/components';
import { caloriesLeft, dayBurn, macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useClientData } from '../../src/ui/clientData';
import { Icon } from '../../src/ui/Icon';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
import { parseFoodText, foodAIAvailable } from '../../src/lib/foodAI';
import { searchProducts, type OffProduct } from '../../src/lib/openfoodfacts';
import { searchCommonFoods } from '../../src/lib/foods';
import { searchDishes } from '../../src/lib/restaurant';
import { mergeFoodResults } from '../../src/lib/foodSearch';
import { BarcodeSheet } from '../../src/ui/BarcodeSheet';
import { notifySuccess } from '../../src/ui/haptics';
import { useFoodLog, type FoodEntry } from '../../src/ui/foodLog';
import { readFoodEdit, foodChanged } from '../../src/lib/entryEdit';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useWearables } from '../../src/ui/wearables';
import { Rule, Section, SectionHead, Hero, Ghost, ListRow, fig } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric } from '../../src/theme/scale';

type Food = { n: string; k: number; p: number; c: number; f: number };
type Logged = Food & { via: string };
// The twelve-row FOOD_DB that used to sit here is gone, into `src/lib/foods.ts`
// as ~90 COMMON_FOODS. It held chicken breast, oats and a banana, and it was
// the ONLY answer this screen had for a food without a barcode — so "rice",
// "lentils" and "toast" all fell through it into a packaged-goods index and
// came back with somebody's brand of microwave rice or nothing at all.
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
 // null until there is a body to scale to — the 70 kg / 20% placeholder that
 // used to stand in produced a target belonging to nobody.
 const target = (cd.weightKg != null && cd.bodyFatPct != null)
  ? applyCoachAdjust(macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet }), cd.coachingMode === 'solo' ? undefined : (_adj || undefined))
  : null;

 const fl = useFoodLog();
 const [q, setQ] = useState('');
 const [nl, setNl] = useState(''); const [nlBusy, setNlBusy] = useState(false);
 // ── Search foods ────────────────────────────────────────────────────────
 //
 // One search, three sources, every row labelled with which one answered.
 //
 // This used to be `FOOD_DB.filter(...)` plus Open Food Facts: twelve generic
 // staples and a BRANDED index. Neither could answer "chicken breast" — the
 // twelve-row table because it was twelve rows, the branded index because a
 // chicken breast has no barcode. Meanwhile 41 restaurant dishes sat behind the
 // "Eating Out?" row above and were unreachable from this box, so somebody
 // logging last night's pad thai had to know a second screen existed.
 //
 // The two local tables are instant and offline. Open Food Facts is debounced
 // behind them and is allowed to fail. `mergeFoodResults` ranks and labels the
 // three; the ranking rule is written down in src/lib/foodSearch.ts.
 const [remote, setRemote] = useState<OffProduct[]>([]);
 const [searching, setSearching] = useState(false);
 // Distinct from "no matches": the lookup is free and rate-limited, and it
 // answers 503 when busy. Saying "nothing found" to that would tell somebody
 // their food does not exist because a server was throttling us.
 const [searchDown, setSearchDown] = useState(false);

 // Both local searches are pure and cheap, so they run on every keystroke —
 // they are the reason the list is never empty while the remote one is in
 // flight, and the reason it is never empty when the remote one never lands.
 const localCommon = useMemo(() => searchCommonFoods(q.trim(), 12), [q]);
 // Capped shorter than the other two on purpose: one common word matches a
 // third of the 41 dishes — "rice" alone hits six — and a search list is not a
 // menu. Left uncapped, an evening's worth of restaurant food buries the
 // branded product somebody may actually be holding.
 const localDishes = useMemo(() => (q.trim() ? searchDishes(q.trim(), 8) : []), [q]);

 useEffect(() => {
   const term = q.trim();
   // Under three characters matches half the database and is never what was meant.
   if (term.length < 3) { setRemote([]); setSearching(false); setSearchDown(false); return; }
   const ctrl = new AbortController();
   setSearching(true);
   // Debounced: this fires under a field somebody is still typing into, and a
   // request per keystroke would both rate-limit us and land out of order.
   const timer = setTimeout(() => {
     searchProducts(term, { signal: ctrl.signal }).then((res) => {
       if (ctrl.signal.aborted) return;
       setSearching(false);
       if (!res.ok) { setSearchDown(true); setRemote([]); return; }
       setSearchDown(false);
       // Stored as they came back. Naming a product after the basis its macros
       // are for is the merge's job now, so the screen and the test cannot
       // disagree about what a branded row is called.
       setRemote(res.products);
     });
   }, 350);
   return () => { ctrl.abort(); clearTimeout(timer); };
 }, [q]);

 // A failed remote search arrives here as an empty `remote` and removes nothing:
 // the local rows are still the answer, and `searchDown` says the branded half
 // is missing rather than letting a shorter list pass for the whole one.
 const results = useMemo(
   () => mergeFoodResults(q, { common: localCommon, restaurant: localDishes, branded: remote }),
   [q, localCommon, localDishes, remote],
 );

 // photo estimate modal state
 const [photoUri, setPhotoUri] = useState<string | null>(null);
 const [reading, setReading] = useState(false);
 // True when a photo was taken but no real nutrition read was possible.
 const [readFailed, setReadFailed] = useState(false);
 const [estN, setEstN] = useState(''); const [estK, setEstK] = useState(''); const [estP, setEstP] = useState(''); const [estC, setEstC] = useState(''); const [estF, setEstF] = useState('');
 const [serv, setServ] = useState(1);

 // Every write in this provider resolves true only once the row is on the
 // server, and this screen used to throw all of them away. A refused insert and
 // a stored one looked identical: the food appeared in "Logged today", ate into
 // the calories remaining, and was gone at the next launch with the day's
 // figures silently different. So a write that did not land is now said out
 // loud, in the one place that can say it.
 const warnUnsaved = (what: string) =>
  Alert.alert('Not saved',
   `${what} is on this phone only — we could not reach your food log. It is counting toward today here, but it will be gone when you next open the app.`);
 const add = async (f: Food, via: string) => {
  const saved = await fl.addFood({ name: f.n, kcal: f.k, protein: f.p, carbs: f.c, fat: f.f, via: via as any });
  if (!saved) warnUnsaved(f.n);
  return saved;
 };
 const logNL = async () => {
   const text = nl.trim(); if (!text) return;
   setNlBusy(true);
   const items = await parseFoodText(text);
   if (items && items.length) {
    // Awaited in sequence and counted, rather than fired off in a forEach: a
    // description can be four foods, and four separate "not saved" alerts
    // stacked on top of each other tells somebody nothing they can act on.
    //
    // `via: 'manual'`, not the 'ai' this used to send. `food_logs.via` carries a
    // CHECK constraint listing search / barcode / photo / manual, so every
    // insert from this box was refused by the database — and because the result
    // was discarded, the described meal appeared in the list, counted against
    // the day, and existed nowhere. A person typing here logged it by hand, so
    // manual is what it is; the reader in rowToEntry already coerces to that.
    let failed = 0;
    for (const it of items) {
     const saved = await fl.addFood({ name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, via: 'manual' });
     if (!saved) failed++;
    }
    setNlBusy(false);
    setNl('');
    if (failed) warnUnsaved(failed === items.length ? 'What you described' : `${failed} of the ${items.length} foods`);
    else notifySuccess();
    return;
   }
   setNlBusy(false);
   Alert.alert('Could not read that', foodAIAvailable() ? 'Try describing it differently, e.g. \"2 eggs, toast and a coffee\".' : 'AI food logging turns on with the AI backend.');
 };

 // ── correcting a meal already logged (TF-02) ────────────────────────────
 //
 // There was no way to fix one. A meal typed as 1200 kcal instead of 120 could
 // only be deleted and entered again, and until somebody did that it went on
 // eating the day's remaining calories — the one number this screen exists to
 // show. RLS was never in the way: `food_owner` on food_logs is an ALL policy.
 const [editing, setEditing] = useState<FoodEntry | null>(null);
 const [edN, setEdN] = useState(''); const [edK, setEdK] = useState('');
 const [edP, setEdP] = useState(''); const [edC, setEdC] = useState(''); const [edF, setEdF] = useState('');
 const [edBusy, setEdBusy] = useState(false);
 const openEdit = (fe: FoodEntry) => {
  setEditing(fe);
  setEdN(fe.name); setEdK(String(fe.kcal)); setEdP(String(fe.protein)); setEdC(String(fe.carbs)); setEdF(String(fe.fat));
 };
 const saveEdit = async () => {
  if (!editing || edBusy) return;
  const read = readFoodEdit({ name: edN, kcal: edK, protein: edP, carbs: edC, fat: edF });
  // A typo is refused rather than rounded to zero — see src/lib/entryEdit.ts.
  if (!read.ok) { Alert.alert('Check that', read.reason); return; }
  const before = { name: editing.name, kcal: editing.kcal, protein: editing.protein, carbs: editing.carbs, fat: editing.fat };
  if (!foodChanged(before, read.value)) { setEditing(null); return; }
  setEdBusy(true);
  const saved = await fl.updateFood(editing.id, read.value);
  setEdBusy(false);
  // On false the store has not moved either, so the figures behind this sheet
  // are still the ones of record. The sheet stays open with what was typed:
  // closing it would throw the correction away AND imply it had been taken.
  if (!saved) {
   Alert.alert('Not saved', 'Your correction did not reach the server, so the meal still reads as it did. Nothing has been changed on this phone either — check your connection and try again.');
   return;
  }
  setEditing(null);
  notifySuccess();
 };
 const confirmRemove = (fe: FoodEntry) => {
  Alert.alert('Remove this meal?', `${fe.name} — ${num(fe.kcal)} kcal — comes off today's log, and today's totals go back down by it.`, [
   { text: 'Cancel', style: 'cancel' },
   { text: 'Remove', style: 'destructive', onPress: async () => {
    const gone = await fl.removeFood(fe.id);
    // The meal is still on screen when this is false, which is the truth: the
    // row is still there. It used to disappear on the spot and come back at the
    // next launch with the day's calories quietly different again.
    if (!gone) Alert.alert('Not removed', `${fe.name} is still in your log — we could not reach the server to remove it. It is still counting toward today.`);
   } },
  ]);
 };

 const tot = { k: fl.consumed.kcal, p: fl.consumed.protein, c: fl.consumed.carbs, f: fl.consumed.fat };
 const wToday = useWearables().today;
 const burn = target ? dayBurn(target, wToday) : null;
 const burned = burn?.burned ?? 0;
 // Same function the Meals tab calls, so the two cannot drift apart again.
 const remK = target ? caloriesLeft(target.kcal, tot.k, burned, burn?.budgeted ?? 0, burn?.kind).net : 0;

 const fillEst = (n: string, k: number, p: number, c: number, f: number) => { setEstN(n); setEstK(String(k)); setEstP(String(p)); setEstC(String(c)); setEstF(String(f)); setReadFailed(false); setReading(false); };
 const takeMealPhoto = async (fromCamera: boolean) => {
 if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'log a meal by photo'))) return;
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

 const logPhoto = async () => {
 const k = round((parseFloat(estK) || 0) * serv), p = round((parseFloat(estP) || 0) * serv), c = round((parseFloat(estC) || 0) * serv), f = round((parseFloat(estF) || 0) * serv);
 if (!k) { Alert.alert('Add calories', 'Enter at least a calorie estimate.'); return; }
 // The sheet closes only once the meal is stored. `add` has already said if it
 // was not, and closing over that would throw away the figures somebody just
 // read off their own plate — the one thing they cannot get back by retrying.
 if (await add({ n: estN || 'Meal (photo)', k, p, c, f }, 'photo')) setPhotoUri(null);
 };

 // Nothing is scanned and nothing is logged — say so instead of inventing a hit.
 // Was `barcodeNote`: an alert that said nothing had been scanned and pointed
 // at the Meals screen. A button whose only function was to name another button.
 const [bcOpen, setBcOpen] = useState(false);

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
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
 <Ghost icon="back" onPress={() => router.back()} />
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
 <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Food Log</Text>
 </View>
 </View>

 {/* ── the hero: what is left in the day ──────────────────────────── */}
 <Hero
 label={remK >= 0 ? 'Calories Remaining' : 'Calories Over'}
 figure={fig(Math.abs(remK))}
 unit="kcal"
 note={target ? `${num(tot.k)} of ${num(target.kcal)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''}` : `${num(tot.k)} kcal eaten${burned ? ` · ${num(burned)} kcal burned` : ''} · add your weight for a target`}
 arc={target && target.kcal ? tot.k / target.kcal : undefined}
 arcLabel="of today's calories eaten"
 tone={remK < 0 ? t.crit : undefined}
 />

 <Rule />

 {/* ── macros against target ──────────────────────────────────────── */}
 <Section>
 <SectionHead title="Macros" />
 {target ? macroRow('Protein', tot.p, target.protein) : null}
 {target ? macroRow('Carbs', tot.c, target.carbs, true) : null}
 {target ? macroRow('Fat', tot.f, target.fat, true) : null}
 </Section>

 <Rule />

 {/* ── log a meal ─────────────────────────────────────────────────── */}
 <Section>
 <SectionHead title="Log a Meal" />
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
 <Pressable accessibilityLabel="Scan barcode" accessibilityRole="button" onPress={() => setBcOpen(true)}
 style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
 <Icon name="search" size={18} color={t.ink2} />
 <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Barcode</Text>
 </Pressable>
 </View>
 <ListRow icon="meals" title="Eating Out?" note="Estimate a restaurant meal" onPress={() => router.push('/(client)/restaurant')} />
 </Section>

 <Rule />

 {/* ── describe it in words ───────────────────────────────────────── */}
 <Section>
 <SectionHead title="Describe It" />
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
 <SectionHead
 title="Search Foods"
 note={!q.trim() ? undefined
   : searching ? 'searching…'
   : searchDown ? (results.length ? `${results.length} local · branded search down` : 'branded search down')
   : `${results.length} match${results.length === 1 ? '' : 'es'}`} />
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
 <Icon name="search" size={16} color={t.ink3} />
 <TextInput value={q} onChangeText={setQ} placeholder="Chicken, pad thai, a brand…" placeholderTextColor={t.ink3}
 style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: 11 }} />
 </View>
 {/* Why every row carries a source. A Common or Restaurant figure is a typical
     value for the portion named, not a measurement of the food in front of
     this person; a Branded figure is the product's own label. Rendering the
     two identically is how a generic average comes to be read as somebody's
     own packet, so the difference is said once here and shown on each row. */}
 <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>
 Common and restaurant figures are typical portions, not a measurement of yours.
 A branded row is the product's own label — use it when there is one.
 </Text>
 {q.trim().length > 0 && q.trim().length < 3 ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>Keep typing — three letters or more.</Text>
 ) : null}
 {/* Said whether or not local rows came back. The old version showed this only
     when the list was empty, so a throttled branded search with a couple of
     common foods behind it looked like the whole answer. A shorter list is not
     allowed to pass for a complete one. */}
 {q.trim().length >= 3 && !searching && searchDown ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>
 {results.length
   ? "Branded products could not be reached just now, so these are the common foods and restaurant dishes only. Scan the barcode for a packet's own figures."
   : 'Food search could not be reached just now — this says nothing about whether the food is in there. Scan the barcode or describe it below in the meantime.'}
 </Text>
 ) : null}
 {q.trim().length >= 3 && !searching && !searchDown && results.length === 0 ? (
 <Text style={{ ...ty.label, color: t.ink3, paddingTop: sp.md }}>
 Nothing found. Try the brand name, scan the barcode, or describe it below.
 </Text>
 ) : null}
 {results.map((r, i) => (
 <View key={r.key}>
 {i > 0 ? <Rule /> : null}
 <Pressable onPress={() => { add({ n: r.name, k: r.kcal, p: r.protein, c: r.carbs, f: r.fat }, 'search'); setQ(''); }}
 accessibilityRole="button" accessibilityLabel={`Log ${r.name} — ${r.label}`}
 style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <View style={{ flex: 1 }}>
 <Text style={{ ...ty.body, color: t.ink }} numberOfLines={2}>{r.name}</Text>
 <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }}>{r.label}</Text>
 </View>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(r.kcal)} kcal</Text>
 <Icon name="plus" size={16} color={t.brand} />
 </Pressable>
 </View>
 ))}
 </Section>

 <Rule />

 {/* ── today's entries, or an honest empty state ──────────────────── */}
 <Section>
 <SectionHead title="Logged Today" note={`${tot.k} kcal`} />
 {fl.entries.length === 0 ? (
 <Text style={{ ...ty.label, color: t.ink3 }}>Nothing logged yet today.</Text>
 ) : (<>
 <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xs }}>Tap a meal to correct what it was worth.</Text>
 {fl.entries.map((fe, i) => (
 <View key={fe.id}>
 {i > 0 ? <Rule /> : null}
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
 <Pressable onPress={() => openEdit(fe)} accessibilityRole="button" accessibilityLabel={'Edit ' + fe.name} style={{ flex: 1 }}>
 <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{fe.name}</Text>
 <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{num(fe.kcal)} kcal · P{fe.protein} C{fe.carbs} F{fe.fat}</Text>
 </Pressable>
 <Pressable onPress={() => openEdit(fe)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Edit ' + fe.name}>
 <Icon name="pencil" size={15} color={t.ink3} />
 </Pressable>
 <Pressable onPress={() => confirmRemove(fe)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + fe.name}>
 <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
 </Pressable>
 </View>
 </View>
 ))}
 </>)}
 </Section>

 </ScrollView>

 {/* ── photo → estimate sheet ───────────────────────────────────────── */}
 <Modal visible={photoUri != null} transparent animationType="slide" onRequestClose={() => setPhotoUri(null)}>
   <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
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
    </KeyboardAvoidingView>
 </Modal>
 {/* ── correct a logged meal ────────────────────────────────────────── */}
 <Modal visible={editing != null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
   <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
 <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setEditing(null)} accessibilityRole="button" accessibilityLabel="Close" />
 <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
 <Text style={{ ...ty.title, color: t.ink }}>Correct This Meal</Text>
 <Pressable onPress={() => setEditing(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
 <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
 </Pressable>
 </View>
 <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
 Today's totals and the calories you have left follow this straight away. It stays on today — correcting a meal does not move it to another day.
 </Text>
 <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Meal name</Text>
 <TextInput value={edN} onChangeText={setEdN} placeholder="What was it?" placeholderTextColor={t.ink3} style={{ ...field, marginBottom: sp.md }} />
 <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
 {[['kcal', edK, setEdK], ['P', edP, setEdP], ['C', edC, setEdC], ['F', edF, setEdF]].map(([lbl, val, set]: any) => (
 <View key={lbl} style={{ flex: 1 }}>
 <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>{lbl}</Text>
 <TextInput value={val} onChangeText={set} keyboardType="numeric" style={{ ...field, ...numeric, paddingHorizontal: 10 }} />
 </View>
 ))}
 </View>
 <Pressable onPress={saveEdit} disabled={edBusy} accessibilityRole="button"
 style={{ backgroundColor: edBusy ? t.surface2 : t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
 {edBusy ? <ActivityIndicator color={t.ink2} /> : <Text style={{ ...ty.body, fontWeight: '600', color: t.brandInk }}>Save the correction</Text>}
 </Pressable>
 {/* Deleting is here as well as in the list, because "this was not a meal at
     all" is the correction somebody arrives at while they have the sheet
     open, and the confirm is the same one either way. */}
 <Pressable onPress={() => { const fe = editing; setEditing(null); if (fe) confirmRemove(fe); }} accessibilityRole="button"
 style={{ paddingVertical: sp.md, alignItems: 'center', marginTop: sp.xs }}>
 <Text style={{ ...ty.label, fontWeight: '500', color: t.crit }}>Remove this meal</Text>
 </Pressable>
 </View>
   </KeyboardAvoidingView>
 </Modal>
 <BarcodeSheet visible={bcOpen} onClose={() => setBcOpen(false)}
   onLogged={async (f) => { if (!(await fl.addFood({ ...f, via: 'barcode' }))) warnUnsaved(f.name); }} />
 </SafeAreaView>
 );
}
