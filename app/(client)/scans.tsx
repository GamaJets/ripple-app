// Progress — InBody scans (camera/upload + scan date + manual entry) + photos + charts.
import { useState } from 'react';
import { View, Text, Pressable, Image, TextInput, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useRouter } from 'expo-router';
import { TrendChart } from '../../src/ui/Chart';
import { Icon } from '../../src/ui/Icon';
import { analyzeInBody, visionAvailable } from '../../src/lib/vision';

type Scan = { id: string; takenAt: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number; source: string; image?: string };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_H = 42, VISIBLE = 5;
const YEARS = Array.from({ length: 8 }, (_, i) => 2019 + i); // 2019..2026
const daysIn = (m: number, y: number) => new Date(y, m + 1, 0).getDate();

// ── Real OCR via OCR.space (free tier). Auto-fills the scan fields from the photo.
// Reliable vision-AI extraction is added on the backend later; this is the quick version.
const OCR_KEY = process.env.EXPO_PUBLIC_OCR_API_KEY || 'helloworld';
async function ocrInBody(uri: string): Promise<{ weight?: string; bf?: string; muscle?: string; ok: boolean }> {
  try {
    const form: any = new FormData();
    form.append('apikey', OCR_KEY);
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('file', { uri, name: 'scan.jpg', type: 'image/jpeg' } as any);
    const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
    const json: any = await res.json();
    const text: string = (json && json.ParsedResults && json.ParsedResults[0] && json.ParsedResults[0].ParsedText) || '';
    if (!text) return { ok: false };
    const lines = text.split(/\r?\n/);
    const numsIn = (str: string) => (str.match(/\d{1,3}(?:\.\d)?/g) || []).map(Number);
    let weight: string | undefined, bf: string | undefined, muscle: string | undefined;
    for (const ln of lines) {
      const low = ln.toLowerCase();
      if (bf === undefined && (low.includes('pbf') || low.includes('percent body fat'))) { const n = numsIn(ln).find((x) => x >= 3 && x <= 70); if (n !== undefined) bf = String(n); }
      if (muscle === undefined && (low.includes('smm') || low.includes('skeletal muscle'))) { const n = numsIn(ln).find((x) => x >= 10 && x <= 80); if (n !== undefined) muscle = String(n); }
      if (weight === undefined && low.includes('weight') && !low.includes('target') && !low.includes('control') && !low.includes('ideal') && !low.includes('over') && !low.includes('under')) { const cand = numsIn(ln).filter((x) => x >= 35 && x <= 250); if (cand.length) weight = String(cand[cand.length - 1]); }
    }
    if (bf === undefined) { const m = text.match(/PBF[^0-9]{0,12}(\d{1,2}(?:\.\d)?)/i); if (m) bf = m[1]; }
    if (muscle === undefined) { const m = text.match(/SMM[^0-9]{0,12}(\d{1,2}(?:\.\d)?)/i); if (m) muscle = m[1]; }
    return { weight, bf, muscle, ok: !!(weight || bf || muscle) };
  } catch (e) { return { ok: false }; }
}

function Wheel({ items, index, onChange, t }: { items: string[]; index: number; onChange: (i: number) => void; t: Theme }) {
  return (
    <View style={{ flex: 1, height: ITEM_H * VISIBLE }}>
      <ScrollView showsVerticalScrollIndicator={false} snapToInterval={ITEM_H} decelerationRate="fast" contentOffset={{ x: 0, y: index * ITEM_H }}
        onMomentumScrollEnd={(e) => onChange(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H))))}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}>
        {items.map((it, i) => (<View key={i} style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: i === index ? t.ink : t.ink3, fontSize: i === index ? 20 : 16, fontWeight: i === index ? '800' : '400' }}>{it}</Text></View>))}
      </ScrollView>
    </View>
  );
}

function Stat({ t, label, value, unit, tint }: { t: Theme; label: string; value: string; unit: string; tint?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: tint ? t.brand : t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
      <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 12, fontWeight: '600', opacity: tint ? 0.8 : 1 }}>{label}</Text>
      <Text style={{ color: tint ? t.brandInk : t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>{value}<Text style={{ fontSize: 12, fontWeight: '600', opacity: 0.7 }}> {unit}</Text></Text>
    </View>
  );
}

export default function Scans() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const scans = cd.scans;
  const [img, setImg] = useState<string | null>(null);
  const [wt, setWt] = useState(''); const [bf, setBf] = useState(''); const [sm, setSm] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; at: string }[]>([]);
  const [cmp, setCmp] = useState<number[]>([]);
  const [reading, setReading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  const now = new Date();
  const [dD, setDD] = useState(now.getDate() - 1);
  const [dM, setDM] = useState(now.getMonth());
  const [dY, setDY] = useState(Math.max(0, YEARS.indexOf(now.getFullYear())));
  const [showDate, setShowDate] = useState(false);

  const scanDateISO = () => { const y = YEARS[dY]; const maxd = daysIn(dM, y); const dd = Math.min(dD, maxd - 1) + 1; return `${y}-${String(dM + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; };
  const scanDateLabel = () => { const y = YEARS[dY]; const maxd = daysIn(dM, y); return `${Math.min(dD, maxd - 1) + 1} ${MONTHS[dM]} ${y}`; };

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your photos') + ' to add a scan.'); return; }
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
    if (!res.canceled && res.assets && res.assets[0]) {
      const asset = res.assets[0]; const uri = asset.uri; setImg(uri); setReading(true); setOcrMsg(null);
      // Accurate vision read when enabled; otherwise interim OCR.
      if (visionAvailable() && asset.base64) {
        const v = await analyzeInBody(asset.base64);
        if (v && (v.weightKg != null || v.bodyFatPct != null || v.skeletalMuscleKg != null)) {
          setReading(false);
          if (v.weightKg != null) setWt(String(v.weightKg));
          if (v.bodyFatPct != null) setBf(String(v.bodyFatPct));
          if (v.skeletalMuscleKg != null) setSm(String(v.skeletalMuscleKg));
          setOcrMsg('Read from your scan: ' + [v.weightKg != null ? 'weight ' + v.weightKg : '', v.bodyFatPct != null ? 'body fat ' + v.bodyFatPct + '%' : '', v.skeletalMuscleKg != null ? 'muscle ' + v.skeletalMuscleKg : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
          return;
        }
      }
      const r = await ocrInBody(uri);
      setReading(false);
      if (r.ok) { if (r.weight) setWt(r.weight); if (r.bf) setBf(r.bf); if (r.muscle) setSm(r.muscle);
        setOcrMsg('Read from your scan: ' + [r.weight ? 'weight ' + r.weight : '', r.bf ? 'body fat ' + r.bf + '%' : '', r.muscle ? 'muscle ' + r.muscle : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
      } else { setOcrMsg('Could not read the numbers automatically — please type them in.'); }
    }
  };
  const saveScan = () => {
    const w = parseFloat(wt) || 0, f = parseFloat(bf) || 0, m = parseFloat(sm) || 0;
    if (!w || !f) { Alert.alert('Add the numbers', 'Enter at least weight and body-fat % from your InBody report.'); return; }
    cd.addScan({ id: 's' + Date.now(), takenAt: scanDateISO(), weightKg: w, bodyFatPct: f, skeletalMuscleKg: m, source: 'InBody (manual)', image: img || undefined });
    setImg(null); setWt(''); setBf(''); setSm('');
    Alert.alert('Scan saved', 'Added to your history and charts for ' + scanDateLabel() + '.');
  };
  const addPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow ' + (fromCamera ? 'camera' : 'photo library') + ' access to add a progress photo.'); return; }
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (!res.canceled && res.assets && res.assets[0]) { setPhotos((p) => [{ uri: res.assets[0].uri, at: new Date().toISOString() }, ...p]); setCmp([]); }
  };
  const toggleCmp = (i: number) => setCmp((c) => (c.includes(i) ? c.filter((x) => x !== i) : c.length >= 2 ? [c[1], i] : [...c, i]));

  const chrono = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const latest = chrono[chrono.length - 1];
  const bfs = chrono.map((s) => s.bodyFatPct);
  const min = Math.min(...bfs), max = Math.max(...bfs);
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const fmt = (iso: string) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Progress</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>InBody scans, photos &amp; body trends</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 18 }}>
          {([['chart','Report','/(client)/report'],['ruler','Measurements','/(client)/measurements'],['trophy','Records','/(client)/records'],['flame','Consistency','/(client)/consistency'],['chart','Standards','/(client)/standards'],['target','Goal','/(client)/goal']] as const).map(([ic,label,route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
          <Stat t={t} label="Weight" value={String(latest.weightKg)} unit="kg" tint />
          <Stat t={t} label="Body fat" value={String(latest.bodyFatPct)} unit="%" />
          <Stat t={t} label="Muscle" value={String(latest.skeletalMuscleKg)} unit="kg" />
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 4 }}>Add an InBody scan</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Snap or upload your report, pick the scan date, enter the numbers.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <Pressable onPress={() => pick(true)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 5 }}><Icon name="camera" size={22} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Take photo</Text></Pressable>
            <Pressable onPress={() => pick(false)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 5 }}><Icon name="plus" size={22} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Upload scan</Text></Pressable>
          </View>
          {img && (
            <View style={{ marginBottom: 12 }}>
              <Image source={{ uri: img }} style={{ width: '100%', height: 180, borderRadius: 12, backgroundColor: t.surface2 }} resizeMode="cover" />
              {reading ? <Text style={{ color: t.brand, fontSize: 12, marginTop: 6, fontWeight: '600' }}>Reading your scan…</Text> : <Text style={{ color: ocrMsg && ocrMsg.startsWith('Read') ? t.brand : t.ink3, fontSize: 11, marginTop: 6 }}>{ocrMsg || 'Scan attached — reading the numbers…'}</Text>}
            </View>
          )}
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Scan date</Text>
          <Pressable onPress={() => setShowDate(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>{scanDateLabel()}</Text><Icon name="calendar" size={15} color={t.ink3} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TextInput value={wt} onChangeText={setWt} keyboardType="numeric" placeholder="Weight kg" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 }} />
            <TextInput value={bf} onChangeText={setBf} keyboardType="numeric" placeholder="Body fat %" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 }} />
            <TextInput value={sm} onChangeText={setSm} keyboardType="numeric" placeholder="Muscle kg" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 }} />
          </View>
          <Pressable onPress={saveScan} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save scan &amp; update profile</Text></Pressable>
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 10 }}>Body-Fat Trend</Text>
          <TrendChart data={cd.bodyFatSeries} unit="%" color={t.s5} goodDown height={150} />
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize' }}>Scan history</Text><Text style={{ color: t.ink3, fontSize: 12 }}>{scans.length} scans</Text>
          </View>
          {[...chrono].reverse().map((s, i, arr) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: t.ring }}>
              {s.image ? <Image source={{ uri: s.image }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={16} color={t.ink3} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '600', fontSize: 14 }}>{s.weightKg} kg · {s.bodyFatPct}% BF</Text>
                <Text style={{ color: t.ink3, fontSize: 11 }}>{fmt(s.takenAt)} · {s.source}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize' }}>Progress Photos</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => addPhoto(false)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Upload</Text></Pressable>
              <Pressable onPress={() => addPhoto(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Photo</Text></Pressable>
            </View>
          </View>
          {photos.length === 0 ? (
            <Text style={{ color: t.ink3, fontSize: 13 }}>No photos yet. Add your first progress photo — once you have two, tap them to see a before → after comparison.</Text>
          ) : (
            <View>
              {cmp.length === 2 ? (() => {
                const a = photos[cmp[0]], b = photos[cmp[1]];
                const older = Date.parse(a.at) <= Date.parse(b.at) ? a : b;
                const newer = older === a ? b : a;
                const days = Math.abs(Math.round((Date.parse(newer.at) - Date.parse(older.at)) / 86400000));
                const pair: [string, { uri: string; at: string }][] = [['Before', older], ['After', newer]];
                return (
                  <View style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {pair.map(([label, ph]) => (
                        <View key={label} style={{ flex: 1 }}>
                          <Image source={{ uri: ph.uri }} style={{ width: '100%', height: 220, borderRadius: 12, backgroundColor: t.surface2 }} />
                          <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{label}</Text>
                          <Text style={{ color: t.ink3, fontSize: 11 }}>{new Date(ph.at).toLocaleDateString()}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={{ color: t.brand, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 8 }}>{days === 0 ? 'Same day' : `${days} day${days === 1 ? '' : 's'} apart`}</Text>
                  </View>
                );
              })() : (
                <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 10 }}>Tap two photos to compare before → after.</Text>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {photos.map((p, i) => {
                  const selIdx = cmp.indexOf(i);
                  return (
                    <Pressable key={i} onPress={() => toggleCmp(i)}>
                      <View style={{ borderRadius: 12, borderWidth: selIdx >= 0 ? 2 : 0, borderColor: t.brand, overflow: 'hidden' }}>
                        <Image source={{ uri: p.uri }} style={{ width: 110, height: 150, backgroundColor: t.surface2 }} />
                        {selIdx >= 0 ? <View style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontSize: 11, fontWeight: '800' }}>{selIdx + 1}</Text></View> : null}
                      </View>
                      <Text style={{ color: t.ink3, fontSize: 10, marginTop: 4, textAlign: 'center' }}>{new Date(p.at).toLocaleDateString()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={showDate} transparent animationType="slide" onRequestClose={() => setShowDate(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowDate(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: t.ink3, fontSize: 16, fontWeight: '600' }}> </Text>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>Scan date</Text>
            <Pressable onPress={() => setShowDate(false)}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Done</Text></Pressable>
          </View>
          <View style={{ position: 'relative' }}>
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H, borderRadius: 10, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }} />
            <View style={{ flexDirection: 'row' }}>
              <Wheel items={Array.from({ length: daysIn(dM, YEARS[dY]) }, (_, i) => String(i + 1))} index={Math.min(dD, daysIn(dM, YEARS[dY]) - 1)} onChange={setDD} t={t} />
              <Wheel items={MONTHS} index={dM} onChange={setDM} t={t} />
              <Wheel items={YEARS.map(String)} index={dY} onChange={setDY} t={t} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
