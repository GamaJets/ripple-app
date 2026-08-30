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
// Progress / Now" that pretended to be photos the client had taken.
//
// PROGRESS PHOTOS ARE NOW REAL. They used to live in `useState` — no upload,
// no bucket, no row — so they were gone the moment this screen unmounted, and
// the header could only honestly say "N on screen". Every photo now goes to
// the private `photos` bucket under the member's own uid and gets a row in
// `progress_photos`; the list is read back oldest-first with signed URLs. See
// src/lib/progressPhotos.ts for the layout and the delete rules, and
// supabase/parts/45-progress-photos.sql for the policies behind them.
//
// The label reads "N saved" now, and it is true. The three states it can be in
// — not loaded, loaded and empty, loaded with photos — each render differently
// on purpose: a screen that shows "no photos yet" while it is still asking is
// telling somebody their history is gone.
//
// TF-37: this screen both reads and WRITES weights, and did neither in the
// client's unit. The three-box entry sheet said "Weight kg" and "Muscle kg" and
// put whatever was typed straight into the scan row, so a client transcribing a
// report in pounds recorded a body twice their own — and this row is the one the
// meal plan re-tunes from, so the error left immediately in their calorie
// target. Entry now converts, the boxes say which unit they want, the OCR fills
// them in that unit, and every figure printed back — including the "your stats
// updated" message — reads in it too. Body fat stays a percentage throughout.
//
// One table is deliberately NOT converted; see the note above the
// metric-by-metric section further down.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Image, TextInput, ScrollView, Modal, Alert, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, weightDeltaIn, plain, convertedNote } from '../../src/lib/units';
import { macrosFor } from '../../src/lib/nutrition';
import { progressDoc, progressCsv, progressSummary, progressSpanLabel, shareDoc, shareText, shareTextFile, pdfExportAvailable, fileShareBlocker, type ProgressRow } from '../../src/lib/exportShare';
// Where each body figure came from, when it was measured, and how stale that
// makes it. This screen and app/(client)/body-trends.tsx were showing different
// numbers under the same word because one read the derived current body and the
// other re-derived its own from the scans alone; they now read the same series
// through the same module, and each figure says which instrument produced it.
// See the header of src/lib/bodyFigures.ts for the full account.
import { bodyReadings, latestBodyReading, measuredNote, stalenessNote, mixedSourceNote, readingsLabel, dayLabel as bodyDayLabel, agoLabel, todayISO, type BodyReading } from '../../src/lib/bodyFigures';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import { Rule, Section, SectionHead, Hero, KpiRow, ActionCard, Cta, Ghost, Spark, fig, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { analyzeInBody, analyzePhysique, visionAvailable, lastVisionError, type PhysiqueVision } from '../../src/lib/vision';
import { metricTrends, compositionInsights, METRIC_GROUPS, type ScanMetrics } from '../../src/lib/inbodyMetrics';
import { focusToGroups, recommendedExercises } from '../../src/lib/focus';
import { listProgressPhotos, uploadProgressPhoto, deleteProgressPhoto, comparePair, photosNote, missingFileCount, type ProgressPhoto } from '../../src/lib/progressPhotos';
import { fetchMyCoach, fetchMyShares, sharePhoto, unsharePhoto, shareStateOf, shareLabel, sharedNote, sendBlocker, revokeCaveat, type ShareGrant, type CoachRef } from '../../src/lib/photoShare';
import { compareRows, compareBasis, readingText, deltaText, spanLabel, COMPARE_DISCLAIMER } from '../../src/lib/photoCompare';

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
  const wu = useSettings().weightUnit;
  const { appName } = useBrand();
  // ── sharing and exporting this record ──────────────────────────────────
  //
  // TF-21 asked of the button in the header: "what gets sent and in what
  // format?" It was an unlabelled share icon that produced a PDF, or produced
  // plain text instead without saying so on a build with no expo-print, and
  // there was no way to find out which except by sending it to somebody. The
  // format is now named before anything leaves the phone, and only formats
  // this build can actually produce are offered — a button reading "PDF" on a
  // device that cannot make one is the same lie in a smaller place.
  //
  // TF-25 and TF-33 asked for Instagram, WhatsApp, TikTok and the rest. Every
  // option below ends at the OS share sheet, which lists all of them plus the
  // client's coach in Messages or Mail, and stays correct as those apps change.
  const exportRows = (): ProgressRow[] => [...cd.scans]
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
    .map((sc) => ({
      // The stored calendar day, not `new Date(...).toLocaleDateString()`,
      // which resolved a bare `YYYY-MM-DD` to UTC midnight and dated every
      // scan a day early for anyone west of Greenwich. Formatting for display
      // happens inside the export, timezone-safely.
      date: String(sc.takenAt).slice(0, 10),
      weightKg: Number.isFinite(sc.weightKg) ? sc.weightKg : null,
      bodyFatPct: Number.isFinite(sc.bodyFatPct) ? sc.bodyFatPct : null,
      muscleKg: sc.skeletalMuscleKg,
    }));

  // The report and the summary are read by a person, so they go out in the
  // client's own unit (TF-37) — a pounds reader was sending a coach, or a
  // story, a metric document about their own body. The CSV is parsed by a
  // machine and deliberately stays in kilograms; src/lib/progressExport.ts
  // argues that at PROGRESS_CSV_HEADER, and the dialog below says so before
  // anybody sends one.
  const sendPdf = async () => { const rows = exportRows(); const { html, text } = progressDoc(cd.name, rows, appName, t.brand, wu); await shareDoc(html, text, 'My progress'); };
  const sendCsv = async () => { await shareTextFile(progressCsv(exportRows()), 'my-progress.csv', 'text/csv', 'My progress'); };
  const sendSummary = async () => { await shareText(progressSummary(cd.name, exportRows(), appName, wu), 'My progress'); };

  const shareProgress = () => {
    const rows = exportRows();
    // An empty export is a claim, not an absence: a PDF with no rows tells a
    // coach this client has recorded nothing rather than that the app had
    // nothing to send. Nothing goes out until there is something in it.
    if (!rows.length) {
      Alert.alert(
        cd.scansStatus === 'error' ? 'Your scans could not be read' : 'Nothing to send yet',
        cd.scansStatus === 'error'
          ? 'Sending now would show your coach an empty record, which is not the same as an empty history. Try again once the screen has loaded your scans.'
          : 'Add a body scan first, and your report, spreadsheet and summary will all have something in them.',
      );
      return;
    }
    const pdf = pdfExportAvailable();
    // A pounds reader is told which of the three is not in pounds, and told it
    // here rather than left to spot it in a column of numbers after the fact.
    // The columns are named `weight_kg` inside the file for the same reason.
    const csvUnit = wu === 'lb' ? ' Figures in kg, as the column names say — a spreadsheet is read by another app, so the columns stay in one fixed unit.' : '';
    // TF build 35, "Why can't it share it?": this line used to end
    // "(this build cannot attach a file)", which named no cause and gave the
    // client nothing to do about it. `fileShareBlocker()` returns the actual
    // reason and the actual remedy — the file share is missing a native module
    // that only a new release can carry, and saying "update the app" is a
    // sentence somebody can act on where a parenthetical apology is not.
    const blocker = fileShareBlocker();
    const csvLine = (blocker
      ? 'Spreadsheet — the same rows, sent as text you can paste into a spreadsheet. ' + blocker
      : 'Spreadsheet — a .csv file, one row per scan, for a coach or another app to import.') + csvUnit;
    const options: { text: string; onPress?: () => void; style?: 'cancel' }[] = [];
    if (pdf) options.push({ text: 'PDF report', onPress: () => { void sendPdf(); } });
    options.push({ text: 'Spreadsheet (CSV)', onPress: () => { void sendCsv(); } });
    options.push({ text: 'Short summary', onPress: () => { void sendSummary(); } });
    // Android's dialog has three button slots and React Native keeps only the
    // first three, so a fourth row does not fail loudly — it disappears. The
    // one that would disappear is this Cancel. The dialog is dismissable there
    // by tapping away or pressing back, so it is left off deliberately rather
    // than shipped as a button that exists on one platform and not the other.
    if (Platform.OS !== 'android' || options.length < 3) options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(
      'Share your progress',
      `${progressSpanLabel(rows)}.\n\n`
      // The PDF is not offered on a build that cannot make one, and until now
      // it was not MENTIONED either — so a client who had been told the app
      // exports a report found two options where three were promised and no
      // word about the third. Silence about a missing feature reads as the
      // feature having been taken away. Said once, and only while it is true.
      + (pdf
        ? 'PDF report — a one-page document with every scan and the change since your first.\n'
        : 'PDF report — not in this version of the app. It arrives with the next release; the two below work now.\n')
      + csvLine + '\n'
      + 'Short summary — a few lines of text for a message, a story or a post.\n\n'
      + `Whichever you pick opens your phone's share sheet, so it can go to your coach, Instagram, WhatsApp, anywhere. ${appName} posts nothing on its own.`,
      options,
    );
  };
  const scans = cd.scans;
  const [img, setImg] = useState<string | null>(null);
  const [wt, setWt] = useState(''); const [bf, setBf] = useState(''); const [sm, setSm] = useState('');
  // A figure that arrived in kilograms — from the vision reader, from the OCR
  // text, from anywhere — put into a box that is labelled in the client's unit.
  // Without this the reader would fill "Weight lb" with a kilogram and the
  // client would either save it or "correct" it to something else again.
  const fieldFromKg = (kg: number | null | undefined) => {
    const v = weightIn(kg, wu);
    return v == null ? '' : plain(v);
  };
  // Said under the entry boxes when the client reads in pounds: their InBody
  // sheet prints kilograms, and without a word about it the two look like a
  // disagreement rather than one reading said twice. Null in metric.
  const weightNote = convertedNote(wu);
  // `null` is "not asked yet, or the ask failed" — never "you have none".
  // `[]` is "asked, and there are none". They render differently below.
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [photosErr, setPhotosErr] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // ── who can see these ──────────────────────────────────────────────────
  // `shares === null` is "we have not been told", and it stays null when the
  // read FAILS as well as before it starts. It must never fall to [] on an
  // error: [] means "your coach can see none of these", which is the one
  // reassurance this screen is not allowed to invent. Every badge below reads
  // this through shareStateOf(), which renders unknown as an em-dash.
  const [shares, setShares] = useState<ShareGrant[] | null>(null);
  const [coach, setCoach] = useState<CoachRef | null>(null);
  const [sharesErr, setSharesErr] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [phys, setPhys] = useState<PhysiqueVision | null>(null);
  const [physBusy, setPhysBusy] = useState(false);
  const [physOpen, setPhysOpen] = useState(false);
  // Selection is by photo id, not list index: the list is re-read from the
  // server after every save and delete, and an index would quietly come to
  // mean a different photo.
  const [cmp, setCmp] = useState<string[]>([]);
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
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a scan'))) return;
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
          if (v.weightKg != null) setWt(fieldFromKg(v.weightKg));
          // Body fat comes back a percentage and goes in as one.
          if (v.bodyFatPct != null) setBf(String(v.bodyFatPct));
          if (v.skeletalMuscleKg != null) setSm(fieldFromKg(v.skeletalMuscleKg));
          if (v.takenAt) { const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.takenAt); if (dm) { const yi = YEARS.indexOf(parseInt(dm[1], 10)); const mo = parseInt(dm[2], 10) - 1; const dd = parseInt(dm[3], 10) - 1; if (yi >= 0 && mo >= 0 && mo <= 11 && dd >= 0) { setDY(yi); setDM(mo); setDD(dd); } } }
          setOcrMsg('Read from your scan: ' + [v.weightKg != null ? 'weight ' + weightLabel(v.weightKg, wu) : '', v.bodyFatPct != null ? 'body fat ' + v.bodyFatPct + '%' : '', v.skeletalMuscleKg != null ? 'muscle ' + weightLabel(v.skeletalMuscleKg, wu) : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
          return;
        }
      }
      const r = await ocrInBody(b64);
      setReading(false);
      // The text reader scrapes an InBody sheet, and an InBody sheet is printed
      // in kilograms — so what it hands back is metric no matter what the boxes
      // it is filling are labelled.
      if (r.ok) {
        const rw = r.weight ? fieldFromKg(parseFloat(r.weight)) : '';
        const rm = r.muscle ? fieldFromKg(parseFloat(r.muscle)) : '';
        if (rw) setWt(rw); if (r.bf) setBf(r.bf); if (rm) setSm(rm);
        setOcrMsg('Read from your scan: ' + [rw ? 'weight ' + rw + ' ' + wu : '', r.bf ? 'body fat ' + r.bf + '%' : '', rm ? 'muscle ' + rm + ' ' + wu : ''].filter(Boolean).join(' · ') + '. Tap a field to correct.');
      } else { setOcrMsg((r.error || 'Could not read automatically' + (lastVisionError ? ' — ' + lastVisionError : '')) + ' Please type the numbers in.'); }
    }
  };
  const saveScan = () => {
    // The two weights come back as the kilograms the scan row stores, whatever
    // unit they were typed in. This is the write that used to file a client's
    // 180 lb as 180 kg — and because the newest scan re-tunes the meal plan,
    // the wrong body was in their calorie target before they left the sheet.
    // Body fat is read as typed: it is a percentage in every unit system.
    const w = weightToKg(wt, wu) ?? 0, f = parseFloat(bf) || 0;
    // Blank means the report did not give one, NOT zero. `parseFloat(sm) || 0`
    // wrote a 0 kg muscle reading for every client who filled in only the two
    // figures the form insists on.
    const mNum = weightToKg(sm, wu);
    const m = sm.trim() && mNum != null && mNum > 0 ? mNum : null;
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
      // Both weights are read out in the client's unit — each is a reading in
      // its own right, so each converts as a value rather than the pair being
      // treated as one span.
      ? 'Your stats updated (weight ' + weightIn(pw, wu) + '→' + weightIn(w, wu) + wu + ', body fat ' + pf + '%→' + f + '%), so your daily targets adjusted: ' + sign(dK) + ' kcal (now ' + after.kcal + '), protein ' + sign(dP) + 'g (now ' + after.protein + 'g). Your meal plan regenerated to match.'
      : 'Added to your history and charts. Targets are essentially unchanged (' + after.kcal + ' kcal / ' + after.protein + 'g protein).');
  };
  // ── progress photos ────────────────────────────────────────────────────
  // A failed read leaves `photos` at null, NOT at []. Showing "no photos yet"
  // to somebody whose photos merely failed to load is telling them their
  // history is gone, and that is the one wrong answer this section can give.
  const loadPhotos = useCallback(async () => {
    try {
      const list = await listProgressPhotos();
      setPhotos(list);
      setPhotosErr(null);
    } catch (e) {
      reportError('scans.photos.load', e);
      setPhotos(null);
      setPhotosErr('Could not load your photos just now.');
    }
  }, []);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  /** Who your coach is, and exactly which photos they can open. Both together,
   *  because the send control needs both and a half-answer would offer a Send
   *  button the database then refuses. A failure leaves `shares` at null and
   *  puts a sentence on screen — it never resolves to "none shared". */
  const loadShares = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([fetchMyCoach(), fetchMyShares()]);
      setCoach(c);
      setShares(g);
      setSharesErr(null);
    } catch (e) {
      reportError('scans.photos.shares', e);
      setShares(null);
      setSharesErr('Could not check what your coach can see just now.');
    }
  }, []);
  useEffect(() => { loadShares(); }, [loadShares]);

  /** Upload + record. Re-reads the list rather than guessing at it, so the
   *  screen only ever shows photos the server has confirmed it holds. */
  const savePhoto = async (uri: string): Promise<boolean> => {
    setPhotoBusy(true);
    try {
      // Normalise to JPEG before it goes up. The library can hand back HEIC or
      // PNG, and the object is stored as image/jpeg with a .jpg key — calling a
      // HEIC a JPEG is the kind of small lie that surfaces months later as a
      // photo that will not render. Resizing also keeps the upload sane on a
      // phone connection. If the conversion fails we send the original rather
      // than lose the photo.
      let out = uri;
      try {
        const mm = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
        if (mm.uri) out = mm.uri;
      } catch (e) { reportError('scans.photos.convert', e); }
      await uploadProgressPhoto(out);
      setCmp([]);
      await loadPhotos();
      return true;
    } catch (e) {
      reportError('scans.photos.upload', e);
      Alert.alert('Not saved', 'That photo could not be saved, so it is not in your progress yet. The original in your camera roll is untouched — try again in a moment.');
      return false;
    } finally { setPhotoBusy(false); }
  };

  const physiqueCheck = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a scan'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const asset = res.assets[0];
    // The photo you hand the AI is a progress photo. It is saved the same way
    // as any other, and told the same truth about whether it worked.
    await savePhoto(asset.uri);
    if (!visionAvailable() || !asset.base64) { Alert.alert('AI not on yet', 'Physique analysis turns on with the AI backend.'); return; }
    setPhys(null); setPhysOpen(true); setPhysBusy(true);
    let pb = asset.base64;
    try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) pb = mm.base64; } catch {}
    const r = await analyzePhysique(pb, 'image/jpeg');
    setPhysBusy(false);
    if (r) setPhys(r); else { setPhysOpen(false); Alert.alert('Could not analyze', 'Try a clearer, well-lit full-body photo.'); }
  };

  const addPhoto = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'add a scan'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (!res.canceled && res.assets && res.assets[0]) await savePhoto(res.assets[0].uri);
  };

  const removePhoto = (p: ProgressPhoto) => {
    const sentToCoach = shareStateOf(p.id, shares) === 'sent';
    Alert.alert('Delete this photo?', (sentToCoach
        ? 'Your coach was sent this one — deleting it takes it back from them as well. '
        : '')
      + 'The picture is deleted from storage and removed from your progress. This cannot be undone — your camera roll is not touched.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setPhotoBusy(true);
        try {
          await deleteProgressPhoto(p);
          setCmp((c) => c.filter((x) => x !== p.id));
          await loadPhotos();
          // The grant is removed by the database (the row cascades with the
          // photo), but this screen must not go on drawing a "Sent to coach"
          // badge for a photo that no longer exists. Re-read rather than
          // assume what the cascade did.
          await loadShares();
        } catch (e) {
          reportError('scans.photos.delete', e);
          // The file comes off storage BEFORE the row, so a failure here means
          // nothing was removed. Say exactly that rather than "something went
          // wrong" — the difference is whether the photo is still there.
          Alert.alert('Still there', 'That photo could not be deleted, so nothing was removed. Try again in a moment.');
        } finally { setPhotoBusy(false); }
      } },
    ]);
  };

  /** Send ONE photo. The confirmation says "this one photo, and only this one"
   *  because that is the whole promise of the feature, and it is a promise the
   *  database keeps: a later photo has no grant row and nothing writes one. */
  const sendToCoach = (p: ProgressPhoto) => {
    const blocked = sendBlocker(p, coach, shares);
    if (blocked) { Alert.alert('Not sent', blocked); return; }
    const c = coach!;
    const who = c.name || 'your coach';
    Alert.alert(`Send this photo to ${who}?`,
      `They will be able to open this one photo, and only this one. Photos you add later are not sent. You can take it back whenever you like.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setShareBusy(true);
        try {
          // The grant comes back FROM the server. Nothing here says "sent"
          // on the strength of a request that was never confirmed.
          const g = await sharePhoto(p.id, c.id);
          setShares((s) => (s === null ? [g] : [g, ...s.filter((x) => x.photoId !== g.photoId)]));
          Alert.alert('Sent', `${who} can now open this photo. It is listed under "Your coach can see" below until you take it back.`);
        } catch (e) {
          reportError('scans.photos.share', e);
          Alert.alert('Not sent', `That photo was not sent, so ${who} still cannot see it. Nothing about your photos has changed. Try again in a moment.`);
          await loadShares();
        } finally { setShareBusy(false); }
      } },
    ]);
  };

  /** Take one back. Deleting the grant closes the row and the file together —
   *  revokeCaveat() is the one thing it cannot reach, said out loud. */
  const takeBackFromCoach = (p: ProgressPhoto) => {
    const c = coach;
    if (!c) return;
    const who = c.name || 'your coach';
    Alert.alert('Take this photo back?', `${who} will no longer be able to open it. ${revokeCaveat()}`, [
      { text: 'Leave it', style: 'cancel' },
      { text: 'Take it back', style: 'destructive', onPress: async () => {
        setShareBusy(true);
        try {
          await unsharePhoto(p.id, c.id);
          setShares((s) => (s === null ? null : s.filter((x) => x.photoId !== p.id)));
        } catch (e) {
          reportError('scans.photos.unshare', e);
          Alert.alert('Still shared', `That photo was not withdrawn, so ${who} can still see it. Try again in a moment.`);
          await loadShares();
        } finally { setShareBusy(false); }
      } },
    ]);
  };

  /** Long press on a photo. One sheet, so "who can see this" and "delete this"
   *  are the same gesture and neither can be missed. */
  const photoActions = (p: ProgressPhoto) => {
    const state = shareStateOf(p.id, shares);
    const when = new Date(p.takenAt).toLocaleDateString();
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (state === 'sent') buttons.push({ text: 'Take back from coach', onPress: () => takeBackFromCoach(p) });
    else if (state === 'private') buttons.push({ text: 'Send to coach', onPress: () => sendToCoach(p) });
    buttons.push({ text: 'Delete photo', style: 'destructive', onPress: () => removePhoto(p) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(`Photo from ${when}`,
      state === 'sent' ? 'Your coach can open this one.'
      : state === 'private' ? 'Only you can see this one.'
      : 'We could not check whether your coach can see this one, so nothing is offered that depends on knowing.',
      buttons);
  };

  const toggleCmp = (id: string) => setCmp((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 2 ? [c[1], id] : [...c, id]));

  const chrono = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const latest = chrono[chrono.length - 1];
  const wsv = cd.weightSeries.map((x) => x.v);
  const mTrends = metricTrends(cd.scans);
  const mInsights = compositionInsights(cd.scans);
  const mByGroup = METRIC_GROUPS.map((g) => ({ group: g, items: mTrends.filter((x) => x.def.group === g) })).filter((g) => g.items.length > 0);
  const wDelta = wsv.length > 1 ? +(wsv[wsv.length - 1] - wsv[0]).toFixed(1) : null;
  const wDeltaShown = weightDeltaIn(wDelta, wu);
  // `scans.taken_at` is a bare postgres DATE, and this used to be
  // `new Date(iso)` — UTC midnight, which is the previous day for every client
  // west of Greenwich, so a scan taken on the 1st was captioned "31/7" in New
  // York and dated correctly in Dubai. Read through localDate instead, which is
  // what the rest of the app already does with this column.
  const fmt = bodyDayLabel;
  const today = todayISO();

  // ── where each figure came from, and when ────────────────────────────────
  //
  // TF build 35: "Progress numbers say something different than the numbers on
  // the body page this needs to be synced." They did. This screen showed
  // `cd.weightKg`, which is the most recent of {a weigh-in logged on the
  // check-in screen, the newest InBody scan}; body-trends.tsx re-derived its
  // own figure from `cd.scans` alone and so always showed the scan. Both now
  // read the same published series through the same module, so the current
  // figure is the same value by construction — and each one says which
  // instrument measured it, which is the half that stops the remaining, real
  // differences of DATE from reading as a contradiction.
  const scanCount = cd.scans.length;
  const wReads = bodyReadings(cd.weightSeries, scanCount);
  const bfReads = bodyReadings(cd.bodyFatSeries, scanCount);
  const mReads = bodyReadings(cd.muscleSeries, scanCount);
  // Each metric is compared against its OWN previous reading. This screen used
  // to compare everything against the second-newest SCAN — including figures
  // that were not scans, and including muscle, whose previous reading is often
  // several scans back because not every scan records it.
  const priorOf = (r: BodyReading[]) => (r.length > 1 ? r[r.length - 2] : null);
  const wNow = latestBodyReading(cd.weightSeries, scanCount);
  const bfNow = latestBodyReading(cd.bodyFatSeries, scanCount);
  // Deliberately the newest scan that RECORDED muscle, rather than
  // `cd.muscleKg`, which is the newest scan's muscle and therefore null
  // whenever that one scan happened not to report it. A gym scale reports
  // weight and body fat and no skeletal muscle at all, so that null is common —
  // and a dash where a real, dated reading exists is as much a wrong answer as
  // a zero. It is only safe to reach back like this because the figure now
  // carries its own date; without one it would be last month's muscle presented
  // as today's.
  const mNow = latestBodyReading(cd.muscleSeries, scanCount);
  const wWas = priorOf(wReads), bfWas = priorOf(bfReads), mWas = priorOf(mReads);
  // The same weight series in the client's unit, converted point by point
  // because each point is a reading rather than a change. Taken from `wReads`
  // rather than from the raw series so the chart and the date labels beside it
  // are the same list — a point dropped from one and not the other would put
  // every date on the wrong reading.
  const wsvShown = wReads.map((r) => weightIn(r.value, wu)).filter((v): v is number => v != null);
  // Said once above the row rather than three times inside it, and only when
  // the figures genuinely have different dates or different instruments behind
  // them — a client whose every number came off one scan is told nothing.
  const bodyMixNote = mixedSourceNote([wNow, bfNow, mNow]);
  // A change between two stored weights, in the client's unit. The subtraction
  // happens in kilograms and `weightDeltaIn` converts the span once: rounding
  // each of the two readings into whole pounds first and subtracting those
  // would let half a pound of rounding at each end report a real 0.4 kg change
  // as nothing, or as two pounds. The arrow is taken from the stored change so
  // a loss too small to move a whole pound still points down rather than
  // arguing with itself.
  const dlt = (cur: number, was: number | undefined) => {
    if (was == null) return null;
    const d = +(cur - was).toFixed(1);
    const shown = weightDeltaIn(d, wu);
    // Unreachable from two real readings. A dash if it ever is reachable —
    // this figure is printed under a unit label, and falling back to the
    // stored kilograms would put the wrong unit on a real number.
    if (shown == null) return null;
    return `${d < 0 ? '▼' : d > 0 ? '▲' : ''} ${Math.abs(shown)} ${wu}`.trim();
  };
  // The hero's movement line, measured between the two most recent body-fat
  // READINGS rather than between the current figure and the second-newest scan.
  // The old line subtracted `prev.bodyFatPct` — a scan two steps back — from
  // whatever `cd.bodyFatPct` currently was, and then captioned the result
  // "since your previous scan". When the current figure came from a logged
  // weigh-in that sentence named the wrong instrument, the wrong two readings
  // and the wrong interval, all at once.
  const bfMove = (bfNow && bfWas) ? +(bfNow.value - bfWas.value).toFixed(1) : null;
  // How long ago the newest SCAN was — used only where the subject really is
  // the scan itself. Every figure below carries its own date instead.
  const ago = latest ? (agoLabel(latest.takenAt, today) ?? 'on an unreadable date') : null;

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
          {/* Labelled, not a bare icon: TF-21 was written by somebody who
              could not tell what the icon would do until they had done it. */}
          <Ghost icon="share" label="Share" onPress={shareProgress} />
        </View>

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <Hero
          label="Body fat"
          figure={bfNow ? String(bfNow.value) : '—'}
          unit={bfNow ? '%' : undefined}
          // The date is not an ornament under the hero: this is the figure the
          // whole screen leads with, and until build 35 it carried a caption
          // that said "scanned N days ago" whatever had actually measured it.
          // `measuredNote` names the instrument, the day and the age, in that
          // order, and the movement clause names the day it is measured FROM
          // rather than saying "your previous scan" and hoping.
          note={bfNow
            ? (bfMove !== null && bfWas
                ? `${bfMove <= 0 ? '−' : '+'}${Math.abs(bfMove)}% since ${bodyDayLabel(bfWas.at)} · `
                : 'First reading · ') + measuredNote(bfNow, today)
            : 'No scans yet — add your InBody report to start tracking.'}
          onPress={() => router.push('/(client)/body-trends')}
        />
        {/* Where a figure is stale, how stale — said under the figure itself,
            because the client is the only person who can judge whether a scan
            from eleven weeks ago still describes them, and they can only judge
            it if they are given the eleven weeks. */}
        {stalenessNote(bfNow, today) ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{stalenessNote(bfNow, today)}</Text>
        ) : null}

        <Rule />

        {/* ── the one card: the scan you can act on ───────────────────────── */}
        <Section>
          <ActionCard
            title={latest ? 'Latest InBody scan' : 'Add your first InBody scan'}
            // The scan's OWN figures and the scan's OWN date. This card is the
            // one place on the screen whose subject really is the scan, so it
            // may differ from the Weight tile below — and it now says the date
            // out loud so that difference reads as two measurements on two days
            // rather than as the app contradicting itself.
            note={latest
              ? `${fig(weightLabel(latest.weightKg, wu))} · ${latest.bodyFatPct}% BF · ${bodyDayLabel(latest.takenAt)}${ago ? ` · ${ago}` : ''}`
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
              { label: 'Weight', value: fig(weightIn(wNow?.value, wu)), unit: wNow ? wu : undefined, route: '/(client)/body-trends', good: !wWas || (!!wNow && wNow.value <= wWas.value), delta: (wNow && wWas ? dlt(wNow.value, wWas.value) : null) ?? undefined },
              { label: 'Muscle', value: fig(weightIn(mNow?.value, wu)), unit: mNow ? wu : undefined, route: '/(client)/body-trends', good: !mWas || (!!mNow && mNow.value >= mWas.value), delta: (mNow && mWas ? dlt(mNow.value, mWas.value) : null) ?? undefined },
              { label: 'Scans', value: fig(scans.length), delta: ago ?? undefined },
            ]}
          />
          {/* "Need to see the dates the weight was measured as well." Here they
              are, one line per figure, naming the instrument as well as the day
              — because the two can be different instruments, and that is the
              whole of why this screen and the composition screen looked as
              though they disagreed. */}
          <View style={{ marginTop: sp.md }}>
            <Text style={{ ...ty.caption, color: t.ink3 }}>Weight · {measuredNote(wNow, today)}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Muscle · {mNow ? measuredNote(mNow, today) : 'no scan has recorded skeletal muscle yet.'}</Text>
            {bodyMixNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{bodyMixNote}</Text> : null}
            {stalenessNote(wNow, today) ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{stalenessNote(wNow, today)}</Text> : null}
          </View>
        </Section>

        <Rule />

        {/* ── weight trend ───────────────────────────────────────────────── */}
        <Section>
          {wsv.length > 1 ? (<>
            {/* "N check-ins" was wrong in both directions — most of these points
                are InBody scans, and the ones that are not are weigh-ins.
                `readingsLabel` counts each kind and names it. */}
            <SectionHead title={`Weight · ${readingsLabel(wReads)}`}
              note={wDeltaShown !== null ? `${wDeltaShown > 0 ? '+' : wDeltaShown < 0 ? '−' : ''}${Math.abs(wDeltaShown)} ${wu}` : undefined}
              onPress={() => router.push('/(client)/body-trends')} />
            {/* `labels` is what puts a DATE on the readout when the client
                touches the line. Without it the chart answered "what did I
                weigh" and refused to answer "when", which is exactly what the
                third report asked for. Spark reads a bare date safely. */}
            <Spark data={wsvShown} unit={` ${wu}`} labels={wReads.map((r) => r.at)} />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              First {bodyDayLabel(wReads[0].at)} · latest {measuredNote(wNow, today)}
            </Text>
          </>) : (<>
            <SectionHead title="Weight" note="Measurements" onPress={() => router.push('/(client)/measurements')} />
            <Text style={{ ...ty.label, color: t.ink3 }}>No weight history yet — the trend charts from your second check-in.</Text>
          </>)}
        </Section>

        <Rule />

        {/* ── progress photos ────────────────────────────────────────────── */}
        <Section>
          {/* "N saved" is now the truth: every one of these is a file in the
              private `photos` bucket and a row in `progress_photos`. The note
              is deliberately absent while the list is still loading and while
              it is genuinely empty — in both of those the body below says
              which, and a note reading "0 saved" would collapse them into one. */}
          <SectionHead title="Progress photos" note={photosNote(photos) ?? undefined} />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
            <View style={{ flex: 1 }}><Ghost label="Upload" onPress={() => { if (!photoBusy) addPhoto(false); }} /></View>
            <View style={{ flex: 1 }}><Ghost label="Photo" onPress={() => { if (!photoBusy) addPhoto(true); }} /></View>
            <View style={{ flex: 1 }}><Cta label="AI check" wide disabled={photoBusy} onPress={() => physiqueCheck(false)} /></View>
          </View>
          {photoBusy ? <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, marginBottom: sp.md }}>Saving to your account…</Text> : null}
          {shareBusy ? <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, marginBottom: sp.md }}>Updating what your coach can see…</Text> : null}

          {/* ── who can see these ───────────────────────────────────────────
              The standing answer, always on screen, never inferred. Four
              distinct renders and not one of them is a guess:
                · the read failed        — say so, and offer to try again
                · the read has not landed — say that instead of "none"
                · no coach linked        — there is nobody it could be shared with
                · N sent                 — and exactly which ones, by date
              "Could not check" and "none shared" look nothing alike on purpose:
              one is reassurance, the other is the absence of it. */}
          <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.md, marginBottom: sp.lg }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 4 }}>Your coach can see{sharedNote(shares) ? ' · ' + sharedNote(shares) : ''}</Text>
            {sharesErr ? (
              <View>
                <Flag tone={t.warn}>
                  {sharesErr} Nothing has changed either way — this screen just could not read the list, so it will not tell you these are private.
                </Flag>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}><Ghost label="Try again" onPress={loadShares} /></View>
              </View>
            ) : shares === null ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>Checking what your coach can see…</Text>
            ) : !coach ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                You have no coach linked, so none of these has been sent to anybody and there is nobody to send one to.
              </Text>
            ) : shares.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                {fig(coach.name)} cannot see any of your photos. Press and hold one to send it — one photo at a time, and only the one you pick.
              </Text>
            ) : (
              <View>
                <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.sm }}>
                  {fig(coach.name)} can open {shares.length === 1 ? 'this one' : `these ${shares.length}`}, and nothing else:
                </Text>
                {shares.map((g) => {
                  const p = photos?.find((x) => x.id === g.photoId) ?? null;
                  return (
                    <View key={g.photoId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
                      {/* A grant whose photo is not in the loaded list is not
                          silently dropped: the coach can still see it, so it is
                          named by the date it was sent. */}
                      <Text style={{ ...ty.label, color: t.ink }}>
                        {p ? new Date(p.takenAt).toLocaleDateString() : 'A photo not in the list above'}
                      </Text>
                      <Pressable onPress={() => { if (p && !shareBusy) takeBackFromCoach(p); }} hitSlop={8} disabled={!p || shareBusy}>
                        <Text style={{ ...ty.caption, fontWeight: '600', color: p ? t.brand : t.ink3 }}>Take back</Text>
                      </Pressable>
                    </View>
                  );
                })}
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{revokeCaveat()}</Text>
              </View>
            )}
          </View>

          {photos === null ? (
            photosErr ? (
              <View>
                <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                  {photosErr} Nothing has been deleted — this screen only failed to read the list, so it cannot tell you what is there.
                </Text>
                <View style={{ alignSelf: 'flex-start' }}><Ghost label="Try again" onPress={loadPhotos} /></View>
              </View>
            ) : (
              <Text style={{ ...ty.label, color: t.ink3 }}>Loading your photos…</Text>
            )
          ) : photos.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No photos yet — add one from your camera or library. They are saved privately to your account,
              so they are here on any device you sign in to. Your coach cannot see any of them: the only way
              they ever see one is if you send that one photo, and you can take it back afterwards.
              Tap two to compare before → after; press and hold one for the options.
            </Text>
          ) : (
            <View>
              {(() => {
                const sel = comparePair(photos, cmp);
                if (!sel) return (
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>Tap two photos to compare before → after. Press and hold one to send it to your coach, or delete it.</Text>
                );
                const pair: [string, ProgressPhoto][] = [['Before', sel.before], ['After', sel.after]];
                return (
                  <View style={{ marginBottom: sp.lg }}>
                    <View style={{ flexDirection: 'row', gap: sp.md }}>
                      {pair.map(([label, ph]) => (
                        <View key={label} style={{ flex: 1 }}>
                          {ph.url ? (
                            <Image source={{ uri: ph.url }} style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: t.surface2 }} />
                          ) : (
                            <View style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.md }}>
                              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Picture unavailable</Text>
                            </View>
                          )}
                          <Text style={{ ...ty.label, fontWeight: '500', color: t.ink, marginTop: 6 }}>{label}</Text>
                          <Text style={{ ...ty.caption, color: t.ink3 }}>{new Date(ph.takenAt).toLocaleDateString()}</Text>
                          {/* The badge is repeated here and not left to the
                              strip below. These are photographs of somebody's
                              body shown four times the size, and this is where
                              a person actually looks: "can my coach see this
                              one?" must not be a question you have to scroll
                              down and re-find the thumbnail to answer. Same
                              three states as the strip, same em-dash when the
                              grants have not been read. */}
                          <Text style={{ ...ty.caption, fontWeight: '500', color: shareStateOf(ph.id, shares) === 'sent' ? t.brand : t.ink3 }}>{shareLabel(shareStateOf(ph.id, shares))}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>{spanLabel(sel.days)}</Text>

                    {/* ── the readings from those two days ─────────────────
                        TF-23 asks to see two photos "with their dates and the
                        readings from those days". The readings are the InBody
                        scan recorded on each photo's own calendar day and
                        nothing else — src/lib/photoCompare.ts explains at
                        length why it is not the photo row's own weight_kg
                        column (always null: savePhoto uploads with no opts)
                        and why "same day" is not a string slice.

                        The Change column is the difference between two SCANS
                        that both exist. It is not, and cannot be, anything
                        read off the pictures: a row whose either side was not
                        measured shows a dash there, and COMPARE_DISCLAIMER
                        says so in words underneath. */}
                    {cd.scansStatus === 'error' ? (
                      // Not a table of dashes. A dash means "there was no scan
                      // that day", and saying that when the app merely failed
                      // to read the list would be inventing the tidier answer.
                      <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                        Your scans could not be read just now, so no figures are shown beside these photos. The photos and their dates above are unaffected.
                      </Flag>
                    ) : cd.scansStatus === 'loading' ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Reading the scans from those days…</Text>
                    ) : (() => {
                      const rows = compareRows(sel.before.takenAt, sel.after.takenAt, scans, wu);
                      return (
                        <View style={{ marginTop: sp.lg }}>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingBottom: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                            <Text style={{ ...ty.micro, color: t.ink3, flex: 1.3 }}>Reading</Text>
                            <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'right' }}>Before</Text>
                            <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'right' }}>After</Text>
                            <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'right' }}>Change</Text>
                          </View>
                          {rows.map((r) => (
                            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                              <Text style={{ ...ty.label, color: t.ink2, flex: 1.3 }}>{r.label}</Text>
                              {/* An unmeasured cell is t.ink3 as well as an
                                  em-dash: it must not sit in the same weight
                                  as a figure somebody actually recorded. */}
                              <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: r.before === null ? t.ink3 : t.ink, flex: 1, textAlign: 'right' }}>{readingText(r.before, r.unit)}</Text>
                              <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: r.after === null ? t.ink3 : t.ink, flex: 1, textAlign: 'right' }}>{readingText(r.after, r.unit)}</Text>
                              <Text style={{ ...ty.label, ...numeric, color: r.delta === null ? t.ink3 : t.ink2, flex: 1, textAlign: 'right' }}>{deltaText(r.delta, r.unit)}</Text>
                            </View>
                          ))}
                          {/* Which days were scanned, named. A blank column
                              with no sentence beside it reads as a failure of
                              the app rather than as a day off the machine. */}
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{compareBasis(rows)}</Text>
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{COMPARE_DISCLAIMER}</Text>
                        </View>
                      );
                    })()}
                  </View>
                );
              })()}
              {/* Oldest first, left to right — the strip reads as time passing,
                  which is the whole point of keeping them. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.md }}>
                {photos.map((p) => {
                  const selIdx = cmp.indexOf(p.id);
                  const shState = shareStateOf(p.id, shares);
                  return (
                    <Pressable key={p.id} onPress={() => toggleCmp(p.id)} onLongPress={() => photoActions(p)} delayLongPress={400}
                      accessibilityRole="button"
                      accessibilityLabel={`Progress photo from ${new Date(p.takenAt).toLocaleDateString()} · ${shState === 'sent' ? 'sent to your coach' : shState === 'private' ? 'only you can see it' : 'not known whether your coach can see it'}`}
                      accessibilityHint="Tap to compare, press and hold to send it to your coach or delete it">
                      <View style={{ borderRadius: radius.md, borderWidth: selIdx >= 0 ? 2 : 0, borderColor: t.brand, overflow: 'hidden' }}>
                        {p.url ? (
                          <Image source={{ uri: p.url }} style={{ width: 110, height: 150, backgroundColor: t.surface2 }} />
                        ) : (
                          // The row is here and the file is not. Show the gap
                          // rather than a blank frame that looks like a photo
                          // still loading, or nothing at all.
                          <View style={{ width: 110, height: 150, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.sm }}>
                            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Picture{'\n'}unavailable</Text>
                          </View>
                        )}
                        {selIdx >= 0 ? <View style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>{selIdx + 1}</Text></View> : null}
                        {/* Every photo carries its own answer to "can my coach
                            see this?" — including the honest non-answer. The
                            badge is on the picture, not in a list somewhere
                            else, so the question is never open while you look
                            at one. */}
                        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                          <Text style={{ ...ty.caption, fontWeight: '500', textAlign: 'center', color: shState === 'sent' ? t.brand : '#fff' }}>{shareLabel(shState)}</Text>
                        </View>
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, textAlign: 'center' }}>{new Date(p.takenAt).toLocaleDateString()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {(missingFileCount(photos) ?? 0) > 0 ? (
                <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                  {missingFileCount(photos) === 1 ? 'One of these has no picture behind it any more.' : `${missingFileCount(photos)} of these have no picture behind them any more.`} Press and hold to clear it.
                </Flag>
              ) : null}
            </View>
          )}
        </Section>

        {/* ── body composition, metric by metric ──────────────────────────── */}
        {mByGroup.length > 0 && (<>
          <Rule />
          <Section>
            {/* Deliberately left in the units the InBody sheet itself printed.
                This table is a transcription of a report the client is holding,
                and it mixes kilograms with litres, kcal, points and a visceral
                fat "level" — and its segmental lean masses are carried to two
                decimals, a grain of 0.01 kg that whole pounds (the honest grain
                for a body weight, see src/lib/units.ts) cannot represent at all.
                Converting these would need a second, finer rule for pounds than
                the rest of the app uses, and two rules for the same unit is how
                a client ends up seeing the same reading two ways. */}
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
              <TextInput value={wt} onChangeText={setWt} keyboardType="numeric" placeholder={`Weight ${wu}`} placeholderTextColor={t.ink3}
                accessibilityLabel={wu === 'kg' ? 'Weight in kilograms' : 'Weight in pounds'} style={input} />
              <TextInput value={bf} onChangeText={setBf} keyboardType="numeric" placeholder="Body fat %" placeholderTextColor={t.ink3}
                accessibilityLabel="Body fat percentage" style={input} />
              <TextInput value={sm} onChangeText={setSm} keyboardType="numeric" placeholder={`Muscle ${wu}`} placeholderTextColor={t.ink3}
                accessibilityLabel={wu === 'kg' ? 'Skeletal muscle in kilograms' : 'Skeletal muscle in pounds'} style={input} />
            </View>
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: -sp.md, marginBottom: sp.lg }}>{weightNote}</Text> : null}
            <Cta label="Save scan & update profile" wide onPress={saveScan} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: sp.xl, marginBottom: sp.sm }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Scan history</Text><Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{scans.length} scans</Text>
            </View>
            {scans.length === 0 ? <Text style={{ ...ty.label, color: t.ink3 }}>No scans yet.</Text> : null}
            {[...chrono].reverse().map((s, i, arr) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderBottomWidth: i < arr.length - 1 ? hairline : 0, borderBottomColor: t.ring }}>
                {s.image ? <Image source={{ uri: s.image }} style={{ width: 40, height: 40, borderRadius: radius.sm }} /> : <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={16} color={t.ink3} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{fig(weightLabel(s.weightKg, wu))} · {s.bodyFatPct}% BF</Text>
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
