// Scan a QR/code on a gym machine → identify the exercise + muscle group → log it.
// If the machine's code is just an asset serial (many gyms), we can't name it from
// the code, so we ask the member to pick the machine from a searchable catalogue —
// that way the screen always shows a real exercise + target muscle. Cardio machines
// (rower, ski-erg, bike…) log duration / distance / avg watts / calories instead of
// reps & weight, and we're explicit about where the calorie number comes from.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: five bordered
// boxes became hairline-separated sections, the camera-permission prompt became
// the one Notice (it is the only thing here needing a decision), and this is a
// form, so it leads with no hero.
//
// Also removed: the `m * 8` calorie fallback. With no entered calories and no
// average watts there is nothing to derive a number from, so the old code
// invented 8 kcal per minute and saved it to the log as if the machine had
// reported it — while the copy right above it promised the estimate came from
// watts. Now the entry simply carries no calorie figure.
import { useMemo, useState } from 'react';
import { BRAND } from '../../src/lib/brands';
import { num } from '../../src/lib/format';
import { View, Text, Pressable, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { tapLight } from '../../src/ui/haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { analyzeMachine, visionAvailable } from '../../src/lib/vision';
import { mayAnalyzePhoto, PHOTO_SENT, PHOTO_NOT_SENT, PHOTO_DESTINATION } from '../../src/lib/photoAI';
import { usePhotoAI } from '../../src/ui/photoAI';
import { MACHINES, identifyMachine, looksLikeSerial, type MachineDef } from '../../src/lib/machines';
import { recallMachine, rememberMachine } from '../../src/lib/machineMemory';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, Field } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { liftLabel, readLift, readNumber } from '../../src/lib/units';
import { readHold, holdLabel } from '../../src/lib/timedSets';
import { hitSlopFor } from '../../src/lib/a11y';

// "km", "m" and "mi" are three glyphs a screen reader says as themselves — and
// "mi" spoken aloud is not a word. The distance toggle says the whole thing.
const UNIT_SPOKEN: Record<string, string> = { km: 'kilometres', m: 'metres', mi: 'miles' };

// Pull a human label out of whatever the QR encodes (JSON, query param, URL slug).
function parseMachine(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  try { const o = JSON.parse(s); if (o && (o.exercise || o.machine || o.name)) return String(o.exercise || o.machine || o.name); } catch { /* not json */ }
  const m = s.match(/[?&](?:exercise|machine|name)=([^&]+)/i);
  if (m) { try { return decodeURIComponent(m[1]).replace(/\+/g, ' '); } catch { return m[1]; } }
  if (/^https?:\/\//i.test(s)) { const seg = s.split('?')[0].split('/').filter(Boolean).pop(); if (seg) { try { return decodeURIComponent(seg).replace(/[-_]/g, ' '); } catch { return seg; } } }
  return s;
}

export default function ScanMachine() {
  // See app/(client)/library.tsx: the logged load is stored in kilograms and
  // read out in whatever unit this member reads in.
  const wu = useSettings().weightUnit;
  const t = useTheme();
  const router = useRouter();
  const { logWorkouts } = useWorkoutLog();
  const [permission, requestPermission] = useCameraPermissions();
  // The camera permission above is about the hardware. This is about where the
  // frame goes, which is a different question with a different answer, and for
  // a long time only the first one was ever put — see src/lib/photoAI.ts.
  const photoAI = usePhotoAI('machine');
  const [askPhoto, setAskPhoto] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [rawCode, setRawCode] = useState('');
  const [exercise, setExercise] = useState('');
  const [group, setGroup] = useState('');
  const [cardio, setCardio] = useState(false);
  const [needsPick, setNeedsPick] = useState(false);
  const [recalled, setRecalled] = useState(false);
  const [reading, setReading] = useState(false);
  const [q, setQ] = useState('');
  // strength
  const [reps, setReps] = useState('');
  const [kg, setKg] = useState('');
  // `bw` and `timed` per set, which this screen did not carry at all — the two
  // flags every other load-entry point in the app writes. A member standing at
  // an assisted-dip machine or a plank timer either typed 0 into the load box,
  // which nothing downstream can tell from a barbell lift whose load was
  // omitted, or typed the seconds into the reps box, which prices a hold as
  // repetitions. This is the screen used AT the machine, so it is the one most
  // likely to produce both.
  const [sets, setSets] = useState<{ reps: number; kg: number; bw: boolean; timed: boolean }[]>([]);
  // How the next set is being entered. Sticky between adds, because sets come
  // in threes and fours and re-tapping "hold" for each one is how somebody ends
  // up with a plank logged as reps.
  const [bwSet, setBwSet] = useState(false);
  const [timedSet, setTimedSet] = useState(false);
  // cardio
  const [mins, setMins] = useState('');
  const [dist, setDist] = useState('');
  const [unit, setUnit] = useState('km');
  const [watts, setWatts] = useState('');
  const [kcalIn, setKcalIn] = useState('');

  const applyDef = (d: MachineDef) => { setExercise(d.name); setGroup(d.group); setCardio(!!d.cardio); setNeedsPick(false); tapLight(); };

  // Identify the machine from a photo (AI vision) — no code needed.
  //
  // The consent is checked BEFORE the camera opens, not before the upload. A
  // member who has taken the photo has already taken it: putting the question
  // afterwards makes agreeing the way to stop having wasted the gesture, which
  // is not a question, it is a nudge.
  const identifyByPhoto = async () => {
    const gate = mayAnalyzePhoto(photoAI.consent, visionAvailable());
    if (!gate.allowed) {
      if (gate.block === 'off') {
        Alert.alert('Photo identifying is off', 'This build has no machine reader. Scan the code, or pick the machine from the list below.');
      } else if (gate.block === 'unknown') {
        // Still reading the stored answer. Not a refusal, and not a yes.
        Alert.alert('One moment', 'Still checking your answer about photos. Try that again in a moment.');
      } else {
        // 'unasked' and 'refused' both land here: the question gets put, and
        // somebody who said no can change their mind in the same place.
        setAskPhoto(true);
      }
      return;
    }
    await capturePhoto();
  };

  const capturePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera access to identify a machine by photo.'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const asset = res.assets[0];
    setReading(true);
    let b64 = asset.base64 || '';
    try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) b64 = mm.base64; } catch { /* fall back to original */ }
    const v = (visionAvailable() && b64) ? await analyzeMachine(b64, 'image/jpeg') : null;
    setReading(false);
    setScanned('photo'); setRawCode(''); setRecalled(false); // photo id — no serial to remember
    if (!v) { setExercise(''); setGroup(''); setCardio(false); setNeedsPick(true); Alert.alert('Could not identify', 'I could not read the machine from that photo — pick it from the list below.'); return; }
    const d = identifyMachine(v.name);
    if (d) { applyDef(d); }
    else { setExercise(v.name); setGroup(v.muscleGroup || ''); setCardio(v.isCardio); setNeedsPick(true); tapLight(); }
  };

  const onScan = async (res: { data: string }) => {
    if (scanned) return;
    setScanned(res.data); setRawCode(res.data); tapLight();
    // 1) Have we set this exact machine up before? Recall it — no re-entry.
    const saved = await recallMachine(res.data);
    if (saved) {
      setExercise(saved.name); setGroup(saved.group); setCardio(!!saved.cardio);
      if (saved.unit) setUnit(saved.unit);
      setNeedsPick(false); setRecalled(true);
      return;
    }
    setRecalled(false);
    // 2) Otherwise try to identify it from the code…
    const d = identifyMachine(res.data);
    if (d) { applyDef(d); }
    else {
      // 3) …or ask the member to pick it (and we'll remember it on save).
      const label = looksLikeSerial(res.data) ? '' : parseMachine(res.data);
      setExercise(label); setGroup(''); setCardio(false); setNeedsPick(true);
    }
  };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Sorted for display only. MACHINES itself stays in catalogue order because
    // identifyMachine() resolves a scan by first match — reordering the source
    // array would change which machine a given QR code maps to.
    return MACHINES
      .filter((m) => !s || m.name.toLowerCase().includes(s) || m.group.toLowerCase().includes(s) || (m.keys || []).some((k) => k.includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q]);

  // `parseFloat(kg) || 0` read the box as KILOGRAMS whatever the member reads
  // in, and the box was labelled "KG" for everybody. So a member in pounds
  // typed 225, and 225 KILOGRAMS — 496 lb — went permanently into their
  // training log, into their volume, their estimated 1RM and next session's
  // target. It was the only load-entry point in the client app that did not
  // convert: app/(client)/workouts.tsx converts at the keyboard in `LogRow`,
  // app/(client)/library.tsx converts at its own load box, and both go through
  // `readLift`. (This used to name scans.tsx as the second one. It is not a
  // load-entry point at all — it records BODY composition and converts through
  // `weightToKg` — and a reader sent there looking for `readLift` would find
  // none, and might well add it: `readLift` caps at 600 kg because that is a
  // barbell bound, which is not the right bound for a person on a scale.)
  //
  // `readLift` also refuses text that is not a number instead of silently
  // making it a bodyweight set, and states its bound in the unit on screen —
  // telling somebody typing pounds that their figure is over 600 kg would be
  // correcting them in a unit they do not use.
  const addSet = () => {
    // A hold is read by `readHold`, not by parseInt: '4 5' parses to 4 and puts
    // a quarter of somebody's plank in the record with nothing to say so. It
    // also accepts 1:30, because that is how a clock is read.
    const first = timedSet ? readHold(reps) : null;
    if (timedSet && first && !first.ok) { Alert.alert('Check that hold', first.reason); return; }
    const r = timedSet ? (first as { ok: true; secs: number }).secs : (parseInt(reps, 10) || 0);
    if (!r) return;
    const load = readLift(kg, wu);
    if (!load.ok) { Alert.alert('Check that load', load.reason); return; }
    setSets((p) => [...p, { reps: r, kg: load.kg ?? 0, bw: bwSet, timed: timedSet }]);
    setReps(''); tapLight();
  };

  // Cardio calories: entered from the machine/watch, or derived from avg watts.
  // With neither, there is no honest number — the entry saves without one.
  const estKcal = (): number | undefined => {
    const m = parseFloat(mins) || 0; const w = parseFloat(watts) || 0;
    if (kcalIn.trim()) return Math.round(parseFloat(kcalIn) || 0);
    if (w > 0 && m > 0) return Math.round(w * m * 0.062); // metabolic ≈ mech watts / 0.23 efficiency
    return undefined;
  };

  const save = async () => {
    if (!exercise.trim()) { Alert.alert('Name the exercise', 'Pick or type the machine/exercise first.'); return; }
    let entry;
    if (cardio) {
      const m = parseFloat(mins) || 0;
      if (m <= 0) { Alert.alert('Add your time', 'Enter how many minutes you did.'); return; }
      const w = parseFloat(watts) || 0;
      entry = { t: new Date().toISOString(), exercise: exercise.trim(), cardio: { mins: m, dist: readNumber(dist) ?? 0, unit, watts: w || undefined }, kcal: estKcal() };
    } else {
      if (!sets.length) { Alert.alert('Log a set first', 'Enter reps (and weight) and tap Add set.'); return; }
      // The same `strengthKcalOf` the caption above renders, so the log and
      // the screen cannot state different figures — and `undefined` rather than
      // a fabricated one when there was no load to estimate from.
      // The two flag arrays go with the sets. Written as full-length arrays
      // rather than omitted when empty: `bw[i]`/`timed[i]` are read by index
      // everywhere downstream, and a short array is a set nobody flagged.
      entry = {
        t: new Date().toISOString(),
        exercise: exercise.trim(),
        sets: sets.map((s) => [s.reps, s.kg] as [number, number]),
        bw: sets.map((s) => s.bw),
        timed: sets.map((s) => s.timed),
        kcal: strengthKcalOf(sets),
      };
    }
    // The result used to be thrown away, so "saved to your workout log" was
    // announced either way — with a button that opens that log — and a client
    // walked away from the machine believing a set was recorded that nothing
    // outside this screen had ever seen. Three outcomes now, and a member
    // standing at a machine in a basement is the reason the middle one exists:
    // a set nobody answered is kept on the phone and sent later.
    const out = await logWorkouts([entry]);
    // Remember this machine's setup so the next scan of the same code auto-fills.
    if (rawCode) rememberMachine(rawCode, { name: exercise.trim(), group, cardio, unit });
    if (out === 'unsent') {
      Alert.alert('Saved on this phone', exercise.trim() + ' has not reached your workout log yet — there is no connection here. Nothing is lost: it is saved on this phone and goes up on its own the next time you have signal.', [{ text: 'OK' }]);
      return;
    }
    if (out === 'refused') {
      Alert.alert('Not saved', exercise.trim() + ' was rejected by your workout log, so it is not recorded and it is not waiting to send. Logging it again as it is will be rejected again.', [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Logged', exercise.trim() + ' saved to your workout log.', [
      { text: 'View history', onPress: () => router.replace('/(client)/activity') },
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  const rescan = () => { setScanned(null); setRawCode(''); setExercise(''); setGroup(''); setCardio(false); setNeedsPick(false); setRecalled(false); setSets([]); setBwSet(false); setTimedSet(false); setReps(''); setKg(''); setMins(''); setDist(''); setWatts(''); setKcalIn(''); setManual(false); setQ(''); };
  const inp = { flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  const showForm = scanned != null || manual;
  /** Kilogram-reps moved, at the same rate the log's own estimate uses, or null
   *  when nothing was loaded. Shared by the caption and by what is SAVED, so
   *  the two can never state different numbers. */
  const strengthKcalOf = (ss: { reps: number; kg: number; timed: boolean }[]): number | undefined => {
    // Holds are not in it. Seconds × kilograms is not a mass moved, and a
    // 45-second plank under a 10 kg plate would otherwise be priced as 450 kg
    // of work — the same arithmetic src/lib/bodyweightSets.ts refuses.
    const volume = ss.reduce((a, s) => a + (s.timed ? 0 : s.reps * (s.kg || 0)), 0);
    return volume > 0 ? Math.round(volume / 60) : undefined;
  };
  const strengthKcal = strengthKcalOf(sets) ?? null;
  const kcalNow = estKcal();
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md, marginBottom: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Log a machine</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Scan Machine</Text>
          </View>
          <Ghost label="Close" onPress={() => router.back()} />
        </View>

        {!showForm ? (
          <View>
            {!permission ? (
              <Section style={{ paddingTop: 0 }}>
                <Text style={{ ...ty.label, color: t.ink3 }}>Preparing camera…</Text>
              </Section>
            ) : !permission.granted ? (
              <Notice kicker="Camera" title="Camera access"
                note={`${BRAND.label} reads the code on a machine, then names the exercise and muscle group for you.`}>
                <View style={{ marginTop: sp.lg }}>
                  <Cta label="Allow Camera" wide onPress={requestPermission} />
                </View>
              </Notice>
            ) : (
              <View style={{ borderRadius: radius.md, overflow: 'hidden', aspectRatio: 3 / 4, backgroundColor: '#000' }}>
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan}>
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: '62%', aspectRatio: 1, borderWidth: 2, borderColor: t.brand, borderRadius: radius.md }} />
                    <Text style={{ ...ty.label, fontWeight: '500', color: '#fff', marginTop: sp.lg }}>Point at the code on the machine</Text>
                  </View>
                </CameraView>
              </View>
            )}

            <Section>
              {reading ? (
                <Text style={{ ...ty.label, color: t.ink2 }}>Identifying the machine from your photo…</Text>
              ) : askPhoto ? (
                /* The question, put before the camera opens. Rendered from the
                   arrays in src/lib/photoAI.ts rather than typed here, so what
                   somebody agrees to cannot drift from what is actually sent. */
                <Notice kicker="Before you photograph it" title="The photo goes to a language model"
                  note={PHOTO_DESTINATION}>
                  <View style={{ marginTop: sp.md, gap: sp.xs }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>What is sent</Text>
                    {PHOTO_SENT.map((line) => (
                      <Text key={line} style={{ ...ty.caption, color: t.ink2 }}>• {line}</Text>
                    ))}
                    <View style={{ height: sp.sm }} />
                    <Text style={{ ...ty.micro, color: t.ink3 }}>What is not</Text>
                    {PHOTO_NOT_SENT.map((line) => (
                      <Text key={line} style={{ ...ty.caption, color: t.ink2 }}>• {line}</Text>
                    ))}
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    A gym floor photo often has other people in it, and they are not being asked. Frame the machine.
                  </Text>
                  <View style={{ marginTop: sp.lg }}>
                    <Cta label="Send the Photo" wide onPress={() => { photoAI.answer('yes'); setAskPhoto(false); void capturePhoto(); }} />
                    <View style={{ height: sp.sm }} />
                    {/* 'No' is recorded, not merely dismissed: a dismissal asks
                        again on the next tap and that is how a question becomes
                        a nag. The machine is still pickable from the list. */}
                    <Ghost label="No — I'll Pick It Myself" onPress={() => { photoAI.answer('no'); setAskPhoto(false); setManual(true); setNeedsPick(true); setExercise(''); }} />
                  </View>
                </Notice>
              ) : (
                <Ghost label="Identify by Photo" icon="camera" onPress={identifyByPhoto} />
              )}
              <View style={{ height: sp.sm }} />
              <Ghost label="No Code? Pick the Machine Yourself" onPress={() => { setManual(true); setNeedsPick(true); setExercise(''); }} />
            </Section>
          </View>
        ) : (
          <View>
            {/* ── what we think you're on ────────────────────────────────── */}
            <Section style={{ paddingTop: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: recalled || !needsPick ? t.brand : t.ink3 }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>{recalled ? 'Remembered' : needsPick ? 'Pick the machine' : 'Machine identified'}</Text>
              </View>
              {recalled ? (
                <Text style={{ ...ty.caption, color: t.ink3 }}>You set this machine up before — recalled automatically. Edit if you like.</Text>
              ) : needsPick && rawCode && looksLikeSerial(rawCode) ? (
                <Text style={{ ...ty.caption, color: t.ink3 }}>The machine's code (<Text style={{ color: t.ink2 }}>{rawCode.slice(0, 18)}</Text>) is just its serial — choose the exercise below. We'll remember it next time.</Text>
              ) : (
                <Text style={{ ...ty.caption, color: t.ink3 }}>Exercise — edit if it's not quite right.</Text>
              )}
              <TextInput value={exercise} onChangeText={setExercise} placeholder="Exercise name" placeholderTextColor={t.ink3}
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, marginTop: sp.md, textTransform: 'capitalize' }} />
              {group ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                  <View style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 }}>
                    <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>{group}</Text>
                  </View>
                  {/* "Strength · switch" — a lowercase verb hanging off a
                      Title-Cased sibling in a ·-joined run, at caption size
                      where nothing is uppercased for it. It was also the only
                      control on the screen a screen reader was told nothing
                      about: an unnamed Pressable reading out its own body. */}
                  <Pressable onPress={() => { setCardio((c) => !c); }} hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Logged as ${cardio ? 'cardio' : 'strength'}. Switch to ${cardio ? 'strength' : 'cardio'}`}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{cardio ? 'Cardio' : 'Strength'} · Switch</Text>
                  </Pressable>
                </View>
              ) : null}
            </Section>

            {needsPick ? (<>
              <Rule />
              <Section>
                <SectionHead title="Machine Catalogue" note={`${list.length}`} />
                <TextInput value={q} onChangeText={setQ} placeholder="Search machines (rower, leg press, lat…)" placeholderTextColor={t.ink3}
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, marginBottom: sp.md }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {list.map((m) => {
                    const on = exercise === m.name;
                    return (
                      // Two lines of text and a fill that says which one is
                      // chosen. The name and the muscle group are separate
                      // Texts and arrive as two stops with the selection
                      // between them said in neither, so the pair is spoken as
                      // one and the fill is spoken as `selected`.
                      <Pressable key={m.name} onPress={() => { applyDef(m); setQ(''); }}
                        accessibilityRole="button" accessibilityLabel={`${m.name}, ${m.group}`}
                        accessibilityState={{ selected: on }}
                        style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: 11, paddingVertical: sp.sm }}>
                        <Text style={{ ...ty.caption, fontWeight: '500', color: on ? t.brandInk : t.ink }}>{m.name}</Text>
                        <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink3 }}>{m.group}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Section>
            </>) : null}

            <Rule />

            {cardio ? (
              <Section>
                <SectionHead title="Your Effort" note={kcalNow != null ? `${num(kcalNow)} kcal` : undefined} />
                {/* Labels, not placeholders. A machine that was scanned once is
                    recalled with its numbers already in the boxes, and every
                    word below then vanished — four bare numerals, one of which
                    is watts and looks exactly like a heart rate. */}
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <Field label="Time" hint="min">
                    <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" style={inp} />
                  </Field>
                  <Field label="Distance" hint={unit}>
                    <TextInput value={dist} onChangeText={setDist} keyboardType="decimal-pad" style={inp} />
                  </Field>
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                  <Field label="Avg watts" hint="optional">
                    <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" style={inp} />
                  </Field>
                  <Field label="Calories" hint="kcal · optional">
                    <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" style={inp} />
                  </Field>
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                  {['km', 'm', 'mi'].map((u) => (
                    <Pressable key={u} onPress={() => setUnit(u)} accessibilityRole="button"
                      accessibilityState={{ selected: unit === u }}
                      accessibilityLabel={unit === u ? `Distance is in ${UNIT_SPOKEN[u]}` : `Measure the distance in ${UNIT_SPOKEN[u]} instead`}
                      style={{ backgroundColor: unit === u ? t.brand : t.surface2, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: sp.lg }}>
                      <Text style={{ ...ty.caption, fontWeight: unit === u ? '600' : '500', color: unit === u ? t.brandInk : t.ink2 }}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Calories come from the machine's console or your Apple Watch. Leave it blank and we'll work it out from your average watts{watts.trim() && kcalNow != null ? ' (≈ ' + kcalNow + ' kcal)' : ''} — with neither, the session logs without a calorie figure.
                </Text>
              </Section>
            ) : (
              <Section>
                <SectionHead title="Add Your Sets" note={sets.length ? `${sets.length} logged` : undefined} />
                {/* What KIND of set this is, asked before the numbers, because
                    the first box means different things under each answer. Both
                    are sticky: sets come in threes and fours, and re-tapping
                    "held" for each one is how a plank ends up logged as reps.
                    MIN_TARGET on both — they are the two controls on this screen
                    that decide what the record says. */}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: bwSet }}
                    accessibilityLabel="This was my own bodyweight"
                    hitSlop={hitSlopFor(36)}
                    onPress={() => { setBwSet((v) => !v); tapLight(); }}
                    style={{ minHeight: 36, justifyContent: 'center', backgroundColor: bwSet ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md }}>
                    <Text style={{ ...ty.caption, fontWeight: bwSet ? '600' : '500', color: bwSet ? t.brandInk : t.ink2 }}>My own bodyweight</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: timedSet }}
                    accessibilityLabel="This was a hold, measured in seconds"
                    hitSlop={hitSlopFor(36)}
                    onPress={() => { setTimedSet((v) => !v); setReps(''); tapLight(); }}
                    style={{ minHeight: 36, justifyContent: 'center', backgroundColor: timedSet ? t.brand : t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md }}>
                    <Text style={{ ...ty.caption, fontWeight: timedSet ? '600' : '500', color: timedSet ? t.brandInk : t.ink2 }}>Held, not repeated</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
                  <Field label={timedSet ? 'Seconds' : 'Reps'}
                    a11y={timedSet ? 'How long you held it, in seconds' : 'Repetitions'}>
                    <TextInput value={reps} onChangeText={setReps}
                      keyboardType={timedSet ? 'default' : 'numeric'}
                      placeholder={timedSet ? '45 or 1:30' : undefined}
                      placeholderTextColor={t.ink3}
                      style={inp} />
                  </Field>
                  {/* The member's own unit, not a fixed "KG". The label and
                      the conversion move together: relabelling one without the
                      other is how a GBP gym's owner typed 50 into a box marked
                      "Amount (GBP)" and 50 dirhams went into the ledger — see
                      the header of scripts/check-currency.mjs. */}
                  <Field label={bwSet ? `+${wu.toUpperCase()}` : wu.toUpperCase()}
                    a11y={bwSet
                      ? `Extra load on top of your bodyweight, in ${wu === 'kg' ? 'kilograms' : 'pounds'}`
                      : `Load in ${wu === 'kg' ? 'kilograms' : 'pounds'}`}>
                    <TextInput value={kg} onChangeText={setKg} keyboardType="decimal-pad" style={inp} />
                  </Field>
                  <Ghost label="Add Set" onPress={addSet} />
                </View>
                {sets.length > 0 ? (
                  <View style={{ marginTop: sp.md }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {sets.map((s, i) => (
                        <Pressable key={i} onPress={() => setSets((p) => p.filter((_, j) => j !== i))}
                          style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {/* The stored load is kilograms whatever the member
                              reads in, so printing it with "kg" typed after it
                              showed a pounds member a figure they never lifted.
                              A blank load is still a dash rather than a 0. */}
                          {/* A hold reads as a clock and never as "45×", and a
                              bodyweight set says so rather than showing a dash
                              where a weight would be — the dash is what made a
                              dip indistinguishable from a barbell lift whose
                              load somebody forgot to type. */}
                          <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink2 }}>
                            Set {i + 1}: {s.timed
                              ? `${holdLabel(s.reps)}${s.kg ? ` × ${liftLabel(s.kg, wu)}` : s.bw ? ' at bodyweight' : ''}`
                              : `${s.reps}×${s.kg ? liftLabel(s.kg, wu) : s.bw ? 'bodyweight' : '–'}`}
                            {s.bw && s.kg ? ' on top' : ''}
                          </Text>
                          <Icon name="minus" size={12} color={t.ink3} />
                        </Pressable>
                      ))}
                    </View>
                    {/* The figure and the sentence describing it have to be
                        the same arithmetic. It said "estimated from your total
                        volume" over `volume / 60 + sets × 8`, and that second
                        term is not volume — three bodyweight sets at no load
                        produced 24 kcal out of nothing at all. This is the same
                        invention the header records removing from the CARDIO
                        branch (`m * 8`) for the same reason; the strength
                        branch kept its copy of it. Volume alone now, and no
                        figure at all when there is no volume to estimate
                        from. */}
                    {strengthKcal != null ? (
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.sm }}>≈ {num(strengthKcal)} kcal, estimated from your total volume.</Text>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>No load on these sets, so there is nothing to estimate calories from — the session logs without a figure.</Text>
                    )}
                  </View>
                ) : null}
              </Section>
            )}

            <Rule />

            <Section>
              <Cta label="Save to Workout Log" wide onPress={save} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Scan Another Machine" onPress={rescan} />
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
