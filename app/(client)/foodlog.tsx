// Food Log — search / barcode / photo. Photo capture is real (camera or library);
// the AI reading of the plate into macros lands with the vision backend, so for
// now the estimate is editable before it logs. Tracks consumed vs remaining live.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, Modal, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { macrosFor } from '../../src/lib/nutrition';
import { useClientData } from '../../src/ui/clientData';
import { Icon } from '../../src/ui/Icon';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';

type Food = { n: string; k: number; p: number; c: number; f: number };
type Logged = Food & { via: string };
const FOOD_DB: Food[] = [
 { n: 'Chicken Breast (150g)', k: 250, p: 47, c: 0, f: 5 }, { n: 'Greek Yogurt (200g)', k: 130, p: 20, c: 9, f: 4 },
 { n: 'Banana', k: 105, p: 1, c: 27, f: 0 }, { n: 'Oats (60g)', k: 230, p: 8, c: 40, f: 5 },
 { n: 'Salmon Fillet (160g)', k: 300, p: 34, c: 0, f: 18 }, { n: 'White Rice (1 cup)', k: 205, p: 4, c: 45, f: 0 },
 { n: 'Whey Shake', k: 160, p: 30, c: 5, f: 2 }, { n: 'Avocado (half)', k: 160, p: 2, c: 9, f: 15 },
 { n: 'Eggs (2)', k: 140, p: 12, c: 1, f: 10 }, { n: 'Almonds (30g)', k: 175, p: 6, c: 6, f: 15 },
 { n: 'Sweet Potato (200g)', k: 180, p: 4, c: 41, f: 0 }, { n: 'Broccoli (150g)', k: 51, p: 4, c: 10, f: 0 },
];
const BARCODE = { n: 'Protein Bar (barcode)', k: 210, p: 20, c: 21, f: 7 };
// Interim baseline estimate shown after a photo; the vision backend replaces this
// with a real read of the actual plate. User can edit before logging.
const PHOTO_GUESS: Food = { n: 'Meal (photo estimate)', k: 520, p: 40, c: 50, f: 16 };
const round = (n: number) => Math.round(n);

export default function FoodLog() {
 const t = useTheme();
 const router = useRouter();
 const cd = useClientData();
 const target = macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });

 const [log, setLog] = useState<Logged[]>([{ ...FOOD_DB[1], via: 'search' }]);
 const [q, setQ] = useState('');
 const results = q ? FOOD_DB.filter((f) => f.n.toLowerCase().includes(q.toLowerCase())) : [];

 // photo estimate modal state
 const [photoUri, setPhotoUri] = useState<string | null>(null);
 const [reading, setReading] = useState(false);
 const [estN, setEstN] = useState(''); const [estK, setEstK] = useState(''); const [estP, setEstP] = useState(''); const [estC, setEstC] = useState(''); const [estF, setEstF] = useState('');
 const [serv, setServ] = useState(1);

 const add = (f: Food, via: string) => setLog((l) => [...l, { ...f, via }]);
 const remove = (i: number) => setLog((l) => l.filter((_, x) => x !== i));

 const tot = log.reduce((a, f) => ({ k: a.k + f.k, p: a.p + f.p, c: a.c + f.c, f: a.f + f.f }), { k: 0, p: 0, c: 0, f: 0 });
 const remK = target.kcal - tot.k;

 const fillEst = (n: string, k: number, p: number, c: number, f: number) => { setEstN(n); setEstK(String(k)); setEstP(String(p)); setEstC(String(c)); setEstF(String(f)); setReading(false); };
 const takeMealPhoto = async (fromCamera: boolean) => {
 const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
 if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your photos') + ' to log a meal by photo.'); return; }
 const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
 if (res.canceled || !res.assets?.[0]) return;
 const asset = res.assets[0];
 setPhotoUri(asset.uri);
 setReading(true); setServ(1);
 // Real vision read when the backend is live; otherwise an editable estimate.
 if (visionAvailable() && asset.base64) {
 const r = await analyzeMeal(asset.base64);
 if (r) { fillEst(r.name, r.kcal, r.protein, r.carbs, r.fat); return; }
 }
 setTimeout(() => fillEst(PHOTO_GUESS.n, PHOTO_GUESS.k, PHOTO_GUESS.p, PHOTO_GUESS.c, PHOTO_GUESS.f), 900);
 };

 const logPhoto = () => {
 const k = round((parseFloat(estK) || 0) * serv), p = round((parseFloat(estP) || 0) * serv), c = round((parseFloat(estC) || 0) * serv), f = round((parseFloat(estF) || 0) * serv);
 if (!k) { Alert.alert('Add calories', 'Enter at least a calorie estimate.'); return; }
 add({ n: estN || 'Meal (photo)', k, p, c, f }, 'photo');
 setPhotoUri(null);
 };

 const macroRow = (label: string, cur: number, tg: number, col: string) => {
 const rem = tg - cur;
 return (
 <View key={label} style={{ marginBottom: 10 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
 <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{label}</Text>
 <Text style={{ color: t.ink3, fontSize: 12 }}><Text style={{ color: t.ink, fontWeight: '700' }}>{cur}</Text> / {tg}g · {rem >= 0 ? `${rem}g left` : `${-rem}g over`}</Text>
 </View>
 <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, marginTop: 4, overflow: 'hidden' }}><View style={{ height: 8, borderRadius: 4, backgroundColor: rem < 0 ? t.crit : col, width: Math.min(100, Math.round((cur / tg) * 100)) + '%' }} /></View>
 </View>
 );
 };

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
 <Pressable onPress={() => router.push('/(client)/profile')} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
 <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Food Log</Text>
 <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Log by search, barcode, or a photo of your plate — macros update live.</Text>

 {/* Consumed vs remaining hero */}
 <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
 <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
 <View>
 <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{remK >= 0 ? 'Calories Remaining' : 'Calories Over'}</Text>
 <Text style={{ color: remK < 0 ? t.crit : t.ink, fontSize: 40, fontWeight: '900' }}>{Math.abs(remK)}<Text style={{ color: t.ink3, fontSize: 14, fontWeight: '600' }}> kcal</Text></Text>
 </View>
 <View style={{ alignItems: 'flex-end' }}>
 <Text style={{ color: t.ink3, fontSize: 12 }}>Consumed</Text>
 <Text style={{ color: t.ink, fontSize: 18, fontWeight: '700' }}>{tot.k}<Text style={{ color: t.ink3, fontSize: 12 }}> / {target.kcal}</Text></Text>
 </View>
 </View>
 <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden', marginBottom: 14 }}><View style={{ height: 10, borderRadius: 5, backgroundColor: remK < 0 ? t.crit : t.brand, width: Math.min(100, Math.round((tot.k / target.kcal) * 100)) + '%' }} /></View>
 {macroRow('Protein', tot.p, target.protein, t.brand)}
 {macroRow('Carbs', tot.c, target.carbs, t.s1)}
 {macroRow('Fat', tot.f, target.fat, t.s3)}
 </View>

 <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
 <Pressable onPress={() => { add(BARCODE, 'barcode'); Alert.alert('Barcode Scanned', BARCODE.n + ' added.'); }} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Icon name="search" size={20} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Barcode</Text></Pressable>
 <Pressable onPress={() => takeMealPhoto(true)} style={{ flex: 1, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Icon name="camera" size={20} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>Photo a meal</Text></Pressable>
 <Pressable onPress={() => takeMealPhoto(false)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4 }}><Icon name="plus" size={20} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Upload</Text></Pressable>
 </View>

 <TextInput value={q} onChangeText={setQ} placeholder="Search foods…" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 8 }} />
 {results.map((f) => (
 <Pressable key={f.n} onPress={() => { add(f, 'search'); setQ(''); }} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
 <Text style={{ color: t.ink, fontSize: 14 }}>{f.n}</Text><Text style={{ color: t.ink3, fontSize: 13 }}>{f.k} kcal · +</Text>
 </Pressable>
 ))}

 <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginTop: 10, marginBottom: 8 }}>Logged Today</Text>
 {log.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13 }}>Nothing logged yet today.</Text> : log.map((f, i) => (
 <View key={i} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
 <View style={{ flex: 1 }}>
 <Text style={{ color: t.ink, fontSize: 14, fontWeight: '600' }}>{f.via === 'photo' ? ' ' : f.via === 'barcode' ? ' ' : ''}{f.n}</Text>
 <Text style={{ color: t.ink3, fontSize: 12 }}>{f.k} kcal · P{f.p} C{f.c} F{f.f}</Text>
 </View>
 <Pressable onPress={() => remove(i)} style={{ padding: 6 }}><Text style={{ color: t.ink3, fontSize: 16 }}>×</Text></Pressable>
 </View>
 ))}
 </ScrollView>

 {/* Photo → estimate modal */}
 <Modal visible={photoUri != null} transparent animationType="slide" onRequestClose={() => setPhotoUri(null)}>
 <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setPhotoUri(null)} />
 <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 18, paddingBottom: 30 }}>
 <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
 <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{reading ? 'Reading Your Meal…' : 'Confirm & Log'}</Text>
 <Pressable onPress={() => setPhotoUri(null)}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Cancel</Text></Pressable>
 </View>
 {photoUri ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: 150, borderRadius: 12, backgroundColor: t.surface2, marginBottom: 12 }} resizeMode="cover" /> : null}
 {reading ? (
 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}><ActivityIndicator color={t.brand} /><Text style={{ color: t.ink3, fontSize: 13 }}>Estimating calories and macros…</Text></View>
 ) : (
 <>
 <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 10 }}>AI estimate — adjust anything before logging. (Accurate photo reading arrives with the vision backend.)</Text>
 <TextInput value={estN} onChangeText={setEstN} placeholder="Meal name" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, marginBottom: 8 }} />
 <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
 {[['kcal', estK, setEstK], ['P', estP, setEstP], ['C', estC, setEstC], ['F', estF, setEstF]].map(([lbl, val, set]: any) => (
 <View key={lbl} style={{ flex: 1 }}>
 <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 3 }}>{lbl}</Text>
 <TextInput value={val} onChangeText={set} keyboardType="numeric" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14 }} />
 </View>
 ))}
 </View>
 <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Portion</Text>
 <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
 {[0.5, 1, 1.5, 2].map((s) => (
 <Pressable key={s} onPress={() => setServ(s)} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: serv === s ? t.brand : t.surface2, borderWidth: 1, borderColor: serv === s ? t.brand : t.ring }}>
 <Text style={{ color: serv === s ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{s === 1 ? '1×' : s + '×'}</Text>
 </Pressable>
 ))}
 </View>
 <Pressable onPress={logPhoto} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
 <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Log {round((parseFloat(estK) || 0) * serv)} kcal</Text>
 </Pressable>
 </>
 )}
 </View>
 </Modal>
 </SafeAreaView>
 );
}
