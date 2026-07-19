// Progress — matches the mockup: serif header, stat cards with deltas, weight
// trend, progress-photo row, "Latest InBody scan" card. Full add-scan flow (camera/
// upload + OCR + date wheel + manual entry + history) lives in a bottom sheet.
import { useState } from 'react';
import { View, Text, Pressable, Image, TextInput, ScrollView, Modal, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { macrosFor } from '../../src/lib/nutrition';
import { progressDoc, shareDoc } from '../../src/lib/exportShare';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import { TrendChart } from '../../src/ui/Chart';
import { Icon } from '../../src/ui/Icon';
import { analyzeInBody, analyzePhysique, visionAvailable, lastVisionError, type PhysiqueVision } from '../../src/lib/vision';
import { metricTrends, compositionInsights, METRIC_GROUPS, type ScanMetrics } from '../../src/lib/inbodyMetrics';
import { focusToGroups, recommendedExercises } from '../../src/lib/focus';

const SERIF = 'Georgia';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_H = 42, VISIBLE = 5;
const YEARS = Array.from({ length: 8 }, (_, i) => 2019 + i);
const daysIn = (m: number, y: number) => new Date(y, m + 1, 0).getDate();

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

function StatCard({ t, label, value, unit, delta, good, onPress }: { t: Theme; label: string; value: string; unit: string; delta: string | null; good: boolean; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 13 }}>
      <Text style={{ color: t.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginTop: 3 }}>{value}<Text style={{ fontSize: 11, fontWeight: '600', color: t.ink3 }}> {unit}</Text></Text>
      {delta ? <Text style={{ color: good ? t.brand : t.ink3, fontSize: 11, fontWeight: '700', marginTop: 1 }}>{delta}</Text> : <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>—</Text>}
    </Pressable>
  );
}

function Spark({ t, data, times, w = 250, h = 54 }: { t: Theme; data: number[]; times?: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  // Position points by real elapsed time when timestamps are supplied, so unevenly
  // spaced weigh-ins read truthfully; otherwise fall back to even index spacing.
  const useT = !!times && times.length === data.length;
  const t0 = useT ? Math.min(...(times as number[])) : 0;
  const tspan = useT ? (Math.max(...(times as number[])) - t0) || 1 : 1;
  const xAt = (i: number) => (useT ? (((times as number[])[i] - t0) / tspan) * w : (i / (data.length - 1)) * w);
  const pts = data.map((v, i) => `${xAt(i)},${h - ((v - min) / rng) * (h - 8) - 4}`).join(' ');
  const lx = xAt(data.length - 1), ly = h - ((data[data.length - 1] - min) / rng) * (h - 8) - 4;
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <Polyline points={pts} fill="none" stroke={t.brand} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={lx} cy={ly} r={3.5} fill={t.brand} />
    </Svg>
  );
}

export default function Scans() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const { appName } = useBrand();
  const shareProgress = async () => {
    const rows = [...cd.scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)).map((sc) => ({ date: new Date(sc.takenAt).toLocaleDateString(), weightKg: sc.weightKg, bodyFatPct: sc.bodyFatPct, muscleKg: sc.skeletalMuscleKg }));
    const { html, text } = progressDoc(cd.name, rows, appName, t.brand);
    await shareDoc(html, text, 'Progress');
  };
  const scans = cd.scans;
  const [img, setImg] = useState<string | null>(null);
  const [wt, setWt] = useState(''); const [bf, setBf] = useState(''); const [sm, setSm] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; at: string }[]>([]);
  const [phys, setPhys] = useState<PhysiqueVision | null>(null);
  const [physBusy, setPhysBusy] = useState(false);
  const [physOpen, setPhysOpen] = useState(false);
  const [cmp, setCmp] = useState<number[]>([]);
  const [reading, setReading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState<string | null>(null);
  const [mxOpen, setMxOpen] = useState<string | null>(null);
  const [scanMx, setScanMx] = useState<ScanMetrics | null>(null);
  const [showAdd, setShowAdd] = useState(false);
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
      const asset = res.assets[0]; const uri = asset.uri; setImg(uri); setReading(true); setOcrMsg(null); setScanMx(null);
      let b64 = asset.base64 || undefined;
      try { const mm = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) b64 = mm.base64; } catch { /* fall back to original */ }
      if (visionAvailable() && b64) {
        const v = await analyzeInBody(b64, 'image/jpeg');
        if (v && (v.weightKg != null || v.bodyFatPct != null || v.skeletalMuscleKg != null)) {
          setReading(false);
          setScanMx(v.metrics ?? null);
          if (v.weightKg != null) setWt(String(v.weightKg));
          if (v.bodyFatPct != null) setBf(String(v.bodyFatPct));
          if (v.skeletalMuscleKg != null) setSm(String(v.skeletalMuscleKg));
          if (v.takenAt) { const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.takenAt); if (dm) { const yi = YEARS.indexOf(parseInt(dm[1], 10)); const mo = parseInt(dm[2], 10) - 1; const dd = parseInt(dm[3], 10) - 1; if (yi >= 0 && mo >= 0 && mo <= 11 && dd >= 0) { setDY(yi); setDM(mo); setDD(dd); } } }
          setOcrMsg('Read from your scan: ' + [v.weightKg != null ? 'weight ' + v.weightKg : '', v.bodyFatPct != null ? 'body fat ' + v.bodyFatPct + '%' : '', v.skeletalMuscleKg != null ? 'muscle ' + v.skeletalMuscleKg : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
          return;
        }
      }
      const r = await ocrInBody(uri);
      setReading(false);
      if (r.ok) { if (r.weight) setWt(r.weight); if (r.bf) setBf(r.bf); if (r.muscle) setSm(r.muscle);
        setOcrMsg('Read from your scan: ' + [r.weight ? 'weight ' + r.weight : '', r.bf ? 'body fat ' + r.bf + '%' : '', r.muscle ? 'muscle ' + r.muscle : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
      } else { setOcrMsg('Could not read automatically' + (lastVisionError ? ' — ' + lastVisionError : '') + '. Please type the numbers in.'); }
    }
  };
  const saveScan = () => {
    const w = parseFloat(wt) || 0, f = parseFloat(bf) || 0, m = parseFloat(sm) || 0;
    if (!w || !f) { Alert.alert('Add the numbers', 'Enter at least weight and body-fat % from your InBody report.'); return; }
    const newISO = scanDateISO();
    // The meal plan follows your MOST RECENT-dated scan only. A back-dated scan is
    // stored for history/graphs but must not re-tune the plan.
    const curLatestISO = cd.scans.length ? cd.scans[cd.scans.length - 1].takenAt.slice(0, 10) : '';
    const isNewest = !curLatestISO || newISO >= curLatestISO;
    const before = macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });
    const after = macrosFor({ weightKg: w, bodyFatPct: f, activity: cd.activity, goal: cd.goal, diet: cd.diet });
    const pw = cd.weightKg, pf = cd.bodyFatPct;
    cd.addScan({ id: 's' + Date.now(), takenAt: newISO, weightKg: w, bodyFatPct: f, skeletalMuscleKg: m, source: scanMx ? 'InBody (OCR)' : 'InBody (manual)', image: img || undefined, metrics: scanMx ?? undefined });
    setImg(null); setWt(''); setBf(''); setSm(''); setScanMx(null); setShowAdd(false);
    if (!isNewest) {
      Alert.alert('Scan saved to history', 'This scan is dated ' + fmt(newISO) + ', earlier than your most recent scan (' + fmt(curLatestISO) + '). It\'s added to your progress tracking and graphs — but your meal plan stays on your most recent scan. Only a newer scan re-tunes your plan.');
      return;
    }
    const dK = after.kcal - before.kcal, dP = after.protein - before.protein;
    const sign = (x: number) => (x > 0 ? '+' + x : String(x));
    const changed = Math.abs(dK) >= 5 || Math.abs(dP) >= 2;
    Alert.alert(changed ? 'Scan saved — plan auto-tuned' : 'Scan saved', changed
      ? 'Your stats updated (weight ' + pw + '→' + w + 'kg, body fat ' + pf + '%→' + f + '%), so your daily targets adjusted: ' + sign(dK) + ' kcal (now ' + after.kcal + '), protein ' + sign(dP) + 'g (now ' + after.protein + 'g). Your meal plan regenerated to match.'
      : 'Added to your history and charts. Targets are essentially unchanged (' + after.kcal + ' kcal / ' + after.protein + 'g protein).');
  };
  const physiqueCheck = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow ' + (fromCamera ? 'camera' : 'photo library') + ' access.'); return; }
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const asset = res.assets[0];
    setPhotos((p) => [{ uri: asset.uri, at: new Date().toISOString() }, ...p]); setCmp([]);
    if (!visionAvailable() || !asset.base64) { Alert.alert('AI not on yet', 'Physique analysis turns on with the AI backend.'); return; }
    setPhys(null); setPhysOpen(true); setPhysBusy(true);
    let pb = asset.base64;
    try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) pb = mm.base64; } catch {}
    const r = await analyzePhysique(pb, 'image/jpeg');
    setPhysBusy(false);
    if (r) setPhys(r); else { setPhysOpen(false); Alert.alert('Could not analyze', 'Try a clearer, well-lit full-body photo.'); }
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
  const prev = chrono.length > 1 ? chrono[chrono.length - 2] : null;
  const wsv = cd.weightSeries.map((x) => x.v);
  const mTrends = metricTrends(cd.scans);
  const mInsights = compositionInsights(cd.scans);
  const mByGroup = METRIC_GROUPS.map((g) => ({ group: g, items: mTrends.filter((x) => x.def.group === g) })).filter((g) => g.items.length > 0);
  const wDelta = wsv.length > 1 ? +(wsv[wsv.length - 1] - wsv[0]).toFixed(1) : null;
  const fmt = (iso: string) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };
  const daysAgo = latest ? Math.max(0, Math.round((Date.now() - Date.parse(latest.takenAt)) / 86400000)) : 0;
  const dlt = (cur: number, was: number | undefined, unit: string) => (was == null ? null : `${cur - was < 0 ? '▼' : cur - was > 0 ? '▲' : ''} ${Math.abs(+(cur - was).toFixed(1))} ${unit}`.trim());

  const input = { flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 12 }}>
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: SERIF }}>Progress</Text>
          <Pressable onPress={shareProgress} accessibilityLabel="Share progress" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}><Icon name="share" size={16} color={t.ink2} /></Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
          {([['chart', 'Report', '/(client)/report'], ['trending', 'Composition', '/(client)/body-trends'], ['trophy', 'Records', '/(client)/records'], ['flame', 'Consistency', '/(client)/consistency'], ['chart', 'Standards', '/(client)/standards'], ['ruler', 'Measurements', '/(client)/measurements'], ['target', 'Goal', '/(client)/goal']] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* stat cards with deltas */}
        <View style={{ flexDirection: 'row', gap: 9, marginBottom: 12 }}>
          <StatCard t={t} label="Weight" value={String(cd.weightKg)} unit="kg" delta={dlt(cd.weightKg, prev?.weightKg, 'kg')} good={!prev || cd.weightKg <= prev.weightKg} onPress={() => router.push('/(client)/measurements')} />
          <StatCard t={t} label="Body fat" value={String(cd.bodyFatPct)} unit="%" delta={dlt(cd.bodyFatPct, prev?.bodyFatPct, '')} good={!prev || cd.bodyFatPct <= prev.bodyFatPct} onPress={() => router.push('/(client)/measurements')} />
          <StatCard t={t} label="Muscle" value={String(cd.muscleKg)} unit="kg" delta={dlt(cd.muscleKg, prev?.skeletalMuscleKg, 'kg')} good={!prev || cd.muscleKg >= prev.skeletalMuscleKg} onPress={() => router.push('/(client)/measurements')} />
        </View>

        {/* weight trend */}
        <Pressable onPress={() => router.push('/(client)/measurements')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: t.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>Weight · {wsv.length} check-ins</Text>
            {wDelta !== null ? <Text style={{ color: t.brand, fontSize: 11, fontWeight: '700' }}>{wDelta > 0 ? '+' : ''}{wDelta} kg</Text> : null}
          </View>
          <Spark t={t} data={wsv} times={cd.weightSeries.map((x) => Date.parse(x.t))} />
        </Pressable>

        {/* progress photos */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Progress photos</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => addPhoto(false)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Upload</Text></Pressable>
              <Pressable onPress={() => addPhoto(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Photo</Text></Pressable>
              <Pressable onPress={() => physiqueCheck(false)} style={{ backgroundColor: t.brand, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>AI check</Text></Pressable>
            </View>
          </View>
          {photos.length === 0 ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['Week 1', 'Progress', 'Now'].map((lbl) => (
                <View key={lbl} style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: 12, borderWidth: 1, borderColor: t.ring, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8 }}>
                  <Icon name="camera" size={18} color={t.ink3} /><Text style={{ color: t.ink3, fontSize: 10, marginTop: 4 }}>{lbl}</Text>
                </View>
              ))}
            </View>
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

        {mByGroup.length > 0 && (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Body composition</Text>
            <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1, marginBottom: 12 }}>From your InBody scans · latest vs previous</Text>
            {(mInsights.improving.length > 0 || mInsights.watch.length > 0 || mInsights.balance.length > 0) && (
              <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 14 }}>
                {mInsights.improving.length > 0 ? <Text style={{ color: t.ink2, fontSize: 12.5, lineHeight: 19 }}><Text style={{ color: t.brand, fontWeight: '800' }}>Improving  </Text>{mInsights.improving.join('  ·  ')}</Text> : null}
                {mInsights.watch.length > 0 ? <Text style={{ color: t.ink2, fontSize: 12.5, lineHeight: 19, marginTop: 4 }}><Text style={{ color: t.warn, fontWeight: '800' }}>Watch  </Text>{mInsights.watch.join('  ·  ')}</Text> : null}
                {mInsights.balance.map((b, i) => <Text key={i} style={{ color: t.ink3, fontSize: 12, lineHeight: 18, marginTop: 4 }}>{b}</Text>)}
              </View>
            )}
            {mByGroup.map((grp) => (
              <View key={grp.group} style={{ marginBottom: 8 }}>
                <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>{grp.group}</Text>
                {grp.items.map((it) => (
                  <View key={String(it.def.key)}>
                    <Pressable onPress={() => { if (it.series.length >= 2) setMxOpen(mxOpen === String(it.def.key) ? null : String(it.def.key)); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                      <Text style={{ color: t.ink2, fontSize: 13 }}>{it.def.label}{it.series.length >= 2 ? (mxOpen === String(it.def.key) ? '  ▴' : '  ▾') : ''}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{it.latest} {it.def.unit}</Text>
                        {it.delta != null && it.delta !== 0 ? (
                          <Text style={{ color: it.good == null ? t.ink3 : it.good ? t.brand : t.warn, fontSize: 12, fontWeight: '700', minWidth: 46, textAlign: 'right' }}>{it.delta > 0 ? '+' : ''}{it.delta}</Text>
                        ) : (
                          <Text style={{ color: t.ink3, fontSize: 12, minWidth: 46, textAlign: 'right' }}>—</Text>
                        )}
                      </View>
                    </Pressable>
                    {mxOpen === String(it.def.key) && it.series.length >= 2 ? (
                      <View style={{ paddingVertical: 8 }}><Spark t={t} data={it.series} h={44} /></View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* latest InBody scan card */}
        <Pressable onPress={() => setShowAdd(true)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chart" size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{latest ? 'Latest InBody scan' : 'Add your first InBody scan'}</Text>
            <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>{latest ? `${latest.weightKg} kg · ${latest.bodyFatPct}% BF · ${daysAgo === 0 ? 'today' : daysAgo + ' days ago'} · tap to add/view` : 'Snap or upload your report — tap to start'}</Text>
          </View>
          <Icon name="chevron" size={18} color={t.ink3} />
        </Pressable>
      </ScrollView>

      {/* Add / view scans sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowAdd(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '700', fontFamily: SERIF }}>Add an InBody scan</Text>
              <Pressable onPress={() => setShowAdd(false)}><Text style={{ color: t.brand, fontSize: 15, fontWeight: '800' }}>Close</Text></Pressable>
            </View>
            <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Snap or upload your report, pick the scan date, enter the numbers.</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <Pressable accessibilityLabel="Take a progress photo" accessibilityRole="button" onPress={() => pick(true)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 5 }}><Icon name="camera" size={22} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Take photo</Text></Pressable>
              <Pressable accessibilityLabel="Add photo from library" accessibilityRole="button" onPress={() => pick(false)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 5 }}><Icon name="plus" size={22} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Upload scan</Text></Pressable>
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
              <TextInput value={wt} onChangeText={setWt} keyboardType="numeric" placeholder="Weight kg" placeholderTextColor={t.ink3} style={input} />
              <TextInput value={bf} onChangeText={setBf} keyboardType="numeric" placeholder="Body fat %" placeholderTextColor={t.ink3} style={input} />
              <TextInput value={sm} onChangeText={setSm} keyboardType="numeric" placeholder="Muscle kg" placeholderTextColor={t.ink3} style={input} />
            </View>
            <Pressable onPress={saveScan} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 18 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save scan & update profile</Text></Pressable>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>Scan history</Text><Text style={{ color: t.ink3, fontSize: 12 }}>{scans.length} scans</Text>
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
          </ScrollView>
        </View>
      </Modal>

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
      <Modal visible={physOpen} transparent animationType="slide" onRequestClose={() => setPhysOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setPhysOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{physBusy ? 'Analyzing…' : 'AI physique read'}</Text>
            <Pressable onPress={() => setPhysOpen(false)}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Close</Text></Pressable>
          </View>
          {physBusy ? (
            <Text style={{ color: t.ink3, fontSize: 14, paddingVertical: 14 }}>Reading your photo for body composition and focus areas…</Text>
          ) : phys ? (
            <View>
              {phys.bodyFatPct != null ? (
                <View style={{ backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
                  <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Estimated body fat</Text>
                  <Text style={{ color: t.ink, fontSize: 30, fontWeight: '900', marginTop: 2 }}>{phys.bodyFatPct}%</Text>
                </View>
              ) : null}
              {phys.notes ? <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 21, marginBottom: 14 }}>{phys.notes}</Text> : null}
              {phys.focusAreas.length > 0 ? (
                <View>
                  <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Focus next on</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {phys.focusAreas.map((a) => (<View key={a} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>{a}</Text></View>))}
                  </View>
                  {recommendedExercises(focusToGroups(phys.focusAreas)).length > 0 ? (
                    <View style={{ marginTop: 16 }}>
                      <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Recommended moves · tap to watch form</Text>
                      {recommendedExercises(focusToGroups(phys.focusAreas)).map((ex) => (
                        <Pressable key={ex.name} onPress={() => Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent('how to ' + ex.name + ' proper form'))} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 }}>
                          <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{ex.name}</Text><Text style={{ color: t.ink3, fontSize: 11.5 }}>{ex.group}</Text></View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="play" size={14} color={t.brand} /><Text style={{ color: t.brand, fontWeight: '700', fontSize: 13 }}>Watch demo</Text></View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {focusToGroups(phys.focusAreas).length > 0 ? (
                    <Pressable onPress={() => { cd.setFocusAreas(focusToGroups(phys.focusAreas)); setPhysOpen(false); Alert.alert('Plan updated', 'Your Train tab now emphasises ' + focusToGroups(phys.focusAreas).join(', ') + ' — those exercises are tagged and prioritised until your next photo.'); }} style={{ marginTop: 14, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                      <Icon name="target" size={16} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Emphasise these in my plan</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <Text style={{ color: t.ink3, fontSize: 11, marginTop: 16 }}>AI estimate for training guidance only — not medical advice.</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
