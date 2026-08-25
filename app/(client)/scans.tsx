// Client · Progress — InBody body composition: the latest scan, the metrics it
// carries, the weight trend and progress photos. The full add-scan flow
// (camera/upload + OCR + date wheel + manual entry + history) lives in a bottom
// sheet, unchanged.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: body fat is the
// screen's one hero figure, the three bordered stat boxes became a hairline
// KpiRow, six stacked cards became hairline-separated sections with a single
// card spent on the thing you can act on, and the Georgia serif header is gone.
//
// Also removed: the three fake progress-photo frames labelled "Week 1 /
// Progress / Now" that pretended to be photos the client had taken. With no
// photos there is now an honest empty state.
import { useState } from 'react';
import { View, Text, Pressable, Image, TextInput, ScrollView, Modal, Alert, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { macrosFor } from '../../src/lib/nutrition';
import { progressDoc, shareDoc } from '../../src/lib/exportShare';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import { Rule, Section, SectionHead, Hero, KpiRow, ActionCard, Cta, Ghost, Spark, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { analyzeInBody, analyzePhysique, visionAvailable, lastVisionError, type PhysiqueVision } from '../../src/lib/vision';
import { metricTrends, compositionInsights, METRIC_GROUPS, type ScanMetrics } from '../../src/lib/inbodyMetrics';
import { focusToGroups, recommendedExercises } from '../../src/lib/focus';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_H = 42, VISIBLE = 5;
const YEARS = Array.from({ length: 8 }, (_, i) => 2019 + i);
const daysIn = (m: number, y: number) => new Date(y, m + 1, 0).getDate();

// The OCR key is NOT in the app. It used to be
//   const OCR_KEY = process.env.EXPO_PUBLIC_OCR_API_KEY || 'helloworld';
// which had two faults: the EXPO_PUBLIC_ prefix inlines a value into the JS
// bundle at build time, so the key shipped readable to anyone who unpacked the
// app; and it was never actually set, so every scan ever made used the literal
// fallback 'helloworld' — OCR.space's shared public demo key, globally rate
// limited to a handful of requests. That is why scanning failed at random.
//
// The read now goes through the `ocr-scan` edge function, which holds the key as
// a Supabase secret. Parsing stays here, where the InBody-specific rules live.
function parseInBody(text: string): { weight?: string; bf?: string; muscle?: string; ok: boolean } {
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
}

/** Send the image to the edge function and parse whatever text comes back. */
async function ocrInBody(b64?: string): Promise<{ weight?: string; bf?: string; muscle?: string; ok: boolean; error?: string }> {
  if (!b64) return { ok: false, error: 'No image to read.' };
  try {
    const { data, error } = await supabase.functions.invoke('ocr-scan', { body: { imageBase64: b64 } });
    if (error) { reportError('scans.ocr', error); return { ok: false, error: 'Could not reach the scanning service.' }; }
    if (!data?.ok) return { ok: false, error: typeof data?.error === 'string' ? data.error : undefined };
    return parseInBody(String(data.text || ''));
  } catch (e) {
    reportError('scans.ocr', e);
    return { ok: false, error: 'Could not reach the scanning service.' };
  }
}

function Wheel({ items, index, onChange, t }: { items: string[]; index: number; onChange: (i: number) => void; t: Theme }) {
  return (
    <View style={{ flex: 1, height: ITEM_H * VISIBLE }}>
      <ScrollView showsVerticalScrollIndicator={false} snapToInterval={ITEM_H} decelerationRate="fast" contentOffset={{ x: 0, y: index * ITEM_H }}
        onMomentumScrollEnd={(e) => onChange(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H))))}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {items.map((it, i) => (<View key={i} style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}><Text style={i === index ? { ...value(20), color: t.ink } : { ...ty.body, ...numeric, color: t.ink3 }}>{it}</Text></View>))}
      </ScrollView>
    </View>
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
      const r = await ocrInBody(b64);
      setReading(false);
      if (r.ok) { if (r.weight) setWt(r.weight); if (r.bf) setBf(r.bf); if (r.muscle) setSm(r.muscle);
        setOcrMsg('Read from your scan: ' + [r.weight ? 'weight ' + r.weight : '', r.bf ? 'body fat ' + r.bf + '%' : '', r.muscle ? 'muscle ' + r.muscle : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
      } else { setOcrMsg((r.error || 'Could not read automatically' + (lastVisionError ? ' — ' + lastVisionError : '')) + ' Please type the numbers in.'); }
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
    // Only meaningful when there was a previous body to compare against.
    const before = (cd.weightKg != null && cd.bodyFatPct != null)
      ? macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet })
      : null;
    const after = macrosFor({ weightKg: w, bodyFatPct: f, activity: cd.activity, goal: cd.goal, diet: cd.diet });
    const pw = cd.weightKg, pf = cd.bodyFatPct;
    cd.addScan({ id: 's' + Date.now(), takenAt: newISO, weightKg: w, bodyFatPct: f, skeletalMuscleKg: m, source: scanMx ? 'InBody (OCR)' : 'InBody (manual)', image: img || undefined, metrics: scanMx ?? undefined });
    setImg(null); setWt(''); setBf(''); setSm(''); setScanMx(null); setShowAdd(false);
    if (!isNewest) {
      Alert.alert('Scan saved to history', 'This scan is dated ' + fmt(newISO) + ', earlier than your most recent scan (' + fmt(curLatestISO) + '). It\'s added to your progress tracking and graphs — but your meal plan stays on your most recent scan. Only a newer scan re-tunes your plan.');
      return;
    }
    if (!before) {
      Alert.alert('Scan saved', 'Your first measurements are in — daily targets are now ' + after.kcal + ' kcal / ' + after.protein + 'g protein, and your meal plan is built from them.');
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
  // Presentation-only helpers: the hero's movement line and a shared "how long ago".
  const bfMove = (prev && cd.bodyFatPct != null) ? +(cd.bodyFatPct - prev.bodyFatPct).toFixed(1) : null;
  const ago = daysAgo === 0 ? 'today' : daysAgo + ' days ago';

  const input = { flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>InBody · body composition</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Progress</Text>
          </View>
          <Ghost icon="share" onPress={shareProgress} />
        </View>

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <Hero
          label="Body fat"
          figure={cd.bodyFatPct != null ? String(cd.bodyFatPct) : '—'}
          unit={cd.bodyFatPct != null ? '%' : undefined}
          note={latest && bfMove !== null
            ? `${bfMove <= 0 ? '−' : '+'}${Math.abs(bfMove)}% since your previous scan · scanned ${ago}`
            : latest
            ? `First InBody scan · ${ago}`
            : 'No scans yet — add your InBody report to start tracking.'}
          onPress={() => router.push('/(client)/measurements')}
        />

        <Rule />

        {/* ── the one card: the scan you can act on ───────────────────────── */}
        <Section>
          <ActionCard
            title={latest ? 'Latest InBody scan' : 'Add your first InBody scan'}
            note={latest
              ? `${latest.weightKg} kg · ${latest.bodyFatPct}% BF · ${ago}`
              : 'Snap or upload your report — the numbers are read for you.'}
            cta={latest ? 'Add scan' : 'Start'}
            onPress={() => setShowAdd(true)}
          />
        </Section>

        <Rule />

        {/* ── body ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Body" note="Measurements" onPress={() => router.push('/(client)/measurements')} />
          <KpiRow
            onPress={(k) => { if (k.route) router.push(k.route as any); }}
            items={[
              { label: 'Weight', value: cd.weightKg != null ? String(cd.weightKg) : '—', unit: cd.weightKg != null ? 'kg' : undefined, route: '/(client)/measurements', good: !prev || (cd.weightKg != null && cd.weightKg <= prev.weightKg), delta: (cd.weightKg != null ? dlt(cd.weightKg, prev?.weightKg, 'kg') : null) ?? undefined },
              { label: 'Muscle', value: cd.muscleKg != null ? String(cd.muscleKg) : '—', unit: cd.muscleKg != null ? 'kg' : undefined, route: '/(client)/measurements', good: !prev || (cd.muscleKg != null && cd.muscleKg >= prev.skeletalMuscleKg), delta: (cd.muscleKg != null ? dlt(cd.muscleKg, prev?.skeletalMuscleKg, 'kg') : null) ?? undefined },
              { label: 'Scans', value: fig(scans.length), delta: latest ? `last ${ago}` : undefined },
            ]}
          />
        </Section>

        <Rule />

        {/* ── weight trend ───────────────────────────────────────────────── */}
        <Section>
          {wsv.length > 1 ? (<>
            <SectionHead title={`Weight · ${wsv.length} check-ins`}
              note={wDelta !== null ? `${wDelta > 0 ? '+' : wDelta < 0 ? '−' : ''}${Math.abs(wDelta)} kg` : undefined}
              onPress={() => router.push('/(client)/measurements')} />
            <Spark data={wsv} />
          </>) : (<>
            <SectionHead title="Weight" note="Measurements" onPress={() => router.push('/(client)/measurements')} />
            <Text style={{ ...ty.label, color: t.ink3 }}>No weight history yet — the trend charts from your second check-in.</Text>
          </>)}
        </Section>

        <Rule />

        {/* ── progress photos ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Progress photos" note={photos.length > 0 ? `${photos.length} saved` : undefined} />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
            <View style={{ flex: 1 }}><Ghost label="Upload" onPress={() => addPhoto(false)} /></View>
            <View style={{ flex: 1 }}><Ghost label="Photo" onPress={() => addPhoto(true)} /></View>
            <View style={{ flex: 1 }}><Cta label="AI check" wide onPress={() => physiqueCheck(false)} /></View>
          </View>
          {photos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No photos yet — add one from your camera or library, then tap two to compare before → after.
            </Text>
          ) : (
            <View>
              {cmp.length === 2 ? (() => {
                const a = photos[cmp[0]], b = photos[cmp[1]];
                const older = Date.parse(a.at) <= Date.parse(b.at) ? a : b;
                const newer = older === a ? b : a;
                const days = Math.abs(Math.round((Date.parse(newer.at) - Date.parse(older.at)) / 86400000));
                const pair: [string, { uri: string; at: string }][] = [['Before', older], ['After', newer]];
                return (
                  <View style={{ marginBottom: sp.lg }}>
                    <View style={{ flexDirection: 'row', gap: sp.md }}>
                      {pair.map(([label, ph]) => (
                        <View key={label} style={{ flex: 1 }}>
                          <Image source={{ uri: ph.uri }} style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: t.surface2 }} />
                          <Text style={{ ...ty.label, fontWeight: '500', color: t.ink, marginTop: 6 }}>{label}</Text>
                          <Text style={{ ...ty.caption, color: t.ink3 }}>{new Date(ph.at).toLocaleDateString()}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>{days === 0 ? 'Same day' : `${days} day${days === 1 ? '' : 's'} apart`}</Text>
                  </View>
                );
              })() : (
                <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>Tap two photos to compare before → after.</Text>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.md }}>
                {photos.map((p, i) => {
                  const selIdx = cmp.indexOf(i);
                  return (
                    <Pressable key={i} onPress={() => toggleCmp(i)}>
                      <View style={{ borderRadius: radius.md, borderWidth: selIdx >= 0 ? 2 : 0, borderColor: t.brand, overflow: 'hidden' }}>
                        <Image source={{ uri: p.uri }} style={{ width: 110, height: 150, backgroundColor: t.surface2 }} />
                        {selIdx >= 0 ? <View style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>{selIdx + 1}</Text></View> : null}
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, textAlign: 'center' }}>{new Date(p.at).toLocaleDateString()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </Section>

        {/* ── body composition, metric by metric ──────────────────────────── */}
        {mByGroup.length > 0 && (<>
          <Rule />
          <Section>
            <SectionHead title="Body composition" note="Latest vs previous" />
            {(mInsights.improving.length > 0 || mInsights.watch.length > 0 || mInsights.balance.length > 0) && (
              <View style={{ marginBottom: sp.lg }}>
                {mInsights.improving.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand, marginTop: 6 }} />
                    <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}><Text style={{ fontWeight: '500', color: t.ink }}>Improving  </Text>{mInsights.improving.join('  ·  ')}</Text>
                  </View>
                ) : null}
                {mInsights.watch.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, marginTop: 6 }} />
                    <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}><Text style={{ fontWeight: '500', color: t.ink }}>Watch  </Text>{mInsights.watch.join('  ·  ')}</Text>
                  </View>
                ) : null}
                {mInsights.balance.map((b, i) => <Text key={i} style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{b}</Text>)}
              </View>
            )}
            {mByGroup.map((grp) => (
              <View key={grp.group} style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{grp.group}</Text>
                {grp.items.map((it) => (
                  <View key={String(it.def.key)}>
                    <Pressable onPress={() => { if (it.series.length >= 2) setMxOpen(mxOpen === String(it.def.key) ? null : String(it.def.key)); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                      <Text style={{ ...ty.label, color: t.ink2 }}>{it.def.label}{it.series.length >= 2 ? (mxOpen === String(it.def.key) ? '  ▴' : '  ▾') : ''}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                        <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink }}>{it.latest} {it.def.unit}</Text>
                        {it.delta != null && it.delta !== 0 ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 52, justifyContent: 'flex-end' }}>
                            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: it.good == null ? t.ink3 : it.good ? t.brand : t.warn }} />
                            <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{it.delta > 0 ? '+' : ''}{it.delta}</Text>
                          </View>
                        ) : (
                          <Text style={{ ...ty.caption, color: t.ink3, minWidth: 52, textAlign: 'right' }}>—</Text>
                        )}
                      </View>
                    </Pressable>
                    {mxOpen === String(it.def.key) && it.series.length >= 2 ? (
                      <View style={{ paddingVertical: sp.sm }}><Spark data={it.series} h={54} /></View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </Section>
        </>)}

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <SectionHead title="Go deeper" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingRight: G }}>
            {([['chart', 'Report', '/(client)/report'], ['trending', 'Composition', '/(client)/body-trends'], ['trophy', 'Records', '/(client)/records'], ['flame', 'Consistency', '/(client)/consistency'], ['chart', 'Standards', '/(client)/standards'], ['ruler', 'Measurements', '/(client)/measurements'], ['target', 'Goal', '/(client)/goal']] as const).map(([ic, label, route]) => (
              <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                <Icon name={ic} size={14} color={t.ink2} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Section>
      </ScrollView>

      {/* Add / view scans sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowAdd(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.xs }}>
              <Text style={{ ...ty.title, color: t.ink }}>Add an InBody scan</Text>
              <Ghost label="Close" onPress={() => setShowAdd(false)} />
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>Snap or upload your report, pick the scan date, enter the numbers.</Text>
            <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
              <Pressable accessibilityLabel="Take a progress photo" accessibilityRole="button" onPress={() => pick(true)} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.md, paddingVertical: sp.lg, alignItems: 'center', gap: 5 }}><Icon name="camera" size={22} color={t.ink} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Take photo</Text></Pressable>
              <Pressable accessibilityLabel="Add photo from library" accessibilityRole="button" onPress={() => pick(false)} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.md, paddingVertical: sp.lg, alignItems: 'center', gap: 5 }}><Icon name="plus" size={22} color={t.ink} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Upload scan</Text></Pressable>
            </View>
            {img && (
              <View style={{ marginBottom: sp.md }}>
                <Image source={{ uri: img }} style={{ width: '100%', height: 180, borderRadius: radius.md, backgroundColor: t.surface2 }} resizeMode="cover" />
                {reading ? <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, marginTop: 6 }}>Reading your scan…</Text> : <Text style={{ ...ty.caption, color: ocrMsg && ocrMsg.startsWith('Read') ? t.ink2 : t.ink3, marginTop: 6 }}>{ocrMsg || 'Scan attached — reading the numbers…'}</Text>}
              </View>
            )}
            <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Scan date</Text>
            <Pressable onPress={() => setShowDate(true)} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{scanDateLabel()}</Text><Icon name="calendar" size={15} color={t.ink3} />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              <TextInput value={wt} onChangeText={setWt} keyboardType="numeric" placeholder="Weight kg" placeholderTextColor={t.ink3} style={input} />
              <TextInput value={bf} onChangeText={setBf} keyboardType="numeric" placeholder="Body fat %" placeholderTextColor={t.ink3} style={input} />
              <TextInput value={sm} onChangeText={setSm} keyboardType="numeric" placeholder="Muscle kg" placeholderTextColor={t.ink3} style={input} />
            </View>
            <Cta label="Save scan & update profile" wide onPress={saveScan} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: sp.xl, marginBottom: sp.sm }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Scan history</Text><Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{scans.length} scans</Text>
            </View>
            {scans.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No scans yet.</Text> : null}
            {[...chrono].reverse().map((s, i, arr) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderBottomWidth: i < arr.length - 1 ? hairline : 0, borderBottomColor: t.ring }}>
                {s.image ? <Image source={{ uri: s.image }} style={{ width: 40, height: 40, borderRadius: radius.sm }} /> : <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={16} color={t.ink3} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{s.weightKg} kg · {s.bodyFatPct}% BF</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{fmt(s.takenAt)} · {s.source}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
              </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDate} transparent animationType="slide" onRequestClose={() => setShowDate(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowDate(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}> </Text>
            <Text style={{ ...ty.head, color: t.ink }}>Scan date</Text>
            <Pressable onPress={() => setShowDate(false)} hitSlop={8}><Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>Done</Text></Pressable>
          </View>
          <View style={{ position: 'relative' }}>
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H, borderRadius: radius.sm, backgroundColor: t.surface2 }} />
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
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <Text style={{ ...ty.title, color: t.ink }}>{physBusy ? 'Analyzing…' : 'AI physique read'}</Text>
            <Ghost label="Close" onPress={() => setPhysOpen(false)} />
          </View>
          {physBusy ? (
            <Text style={{ ...ty.body, color: t.ink3, paddingVertical: sp.lg }}>Reading your photo for body composition and focus areas…</Text>
          ) : phys ? (
            <View>
              {phys.bodyFatPct != null ? (
                <View style={{ marginBottom: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>Estimated body fat</Text>
                  <Text style={{ ...value(30), color: t.ink, marginTop: 2 }}>{phys.bodyFatPct}%</Text>
                </View>
              ) : null}
              {phys.notes ? <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{phys.notes}</Text> : null}
              {phys.focusAreas.length > 0 ? (
                <View>
                  <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Focus next on</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {phys.focusAreas.map((a) => (<View key={a} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: sp.sm }}><Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{a}</Text></View>))}
                  </View>
                  {recommendedExercises(focusToGroups(phys.focusAreas)).length > 0 ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Recommended moves · tap to watch form</Text>
                      {recommendedExercises(focusToGroups(phys.focusAreas)).map((ex) => (
                        <Pressable key={ex.name} onPress={() => Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent('how to ' + ex.name + ' proper form'))} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                          <View style={{ flex: 1 }}><Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{ex.name}</Text><Text style={{ ...ty.caption, color: t.ink3 }}>{ex.group}</Text></View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="play" size={14} color={t.brand} /><Text style={{ ...ty.label, color: t.ink2 }}>Watch demo</Text></View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {focusToGroups(phys.focusAreas).length > 0 ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Cta label="Emphasise these in my plan" wide onPress={() => { cd.setFocusAreas(focusToGroups(phys.focusAreas)); setPhysOpen(false); Alert.alert('Plan updated', 'Your Train tab now emphasises ' + focusToGroups(phys.focusAreas).join(', ') + ' — those exercises are tagged and prioritised until your next photo.'); }} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>AI estimate for training guidance only — not medical advice.</Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
