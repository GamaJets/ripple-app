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
import { MACHINES, identifyMachine, looksLikeSerial, type MachineDef } from '../../src/lib/machines';
import { recallMachine, rememberMachine } from '../../src/lib/machineMemory';
import { Rule, Section, SectionHead, Cta, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';

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
  const t = useTheme();
  const router = useRouter();
  const { addWorkouts } = useWorkoutLog();
  const [permission, requestPermission] = useCameraPermissions();
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
  const [sets, setSets] = useState<{ reps: number; kg: number }[]>([]);
  // cardio
  const [mins, setMins] = useState('');
  const [dist, setDist] = useState('');
  const [unit, setUnit] = useState('km');
  const [watts, setWatts] = useState('');
  const [kcalIn, setKcalIn] = useState('');

  const applyDef = (d: MachineDef) => { setExercise(d.name); setGroup(d.group); setCardio(!!d.cardio); setNeedsPick(false); tapLight(); };

  // Identify the machine from a photo (AI vision) — no code needed.
  const identifyByPhoto = async () => {
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

  const addSet = () => { const r = parseInt(reps, 10) || 0; if (!r) return; setSets((p) => [...p, { reps: r, kg: parseFloat(kg) || 0 }]); setReps(''); tapLight(); };

  // Cardio calories: entered from the machine/watch, or derived from avg watts.
  // With neither, there is no honest number — the entry saves without one.
  const estKcal = (): number | undefined => {
    const m = parseFloat(mins) || 0; const w = parseFloat(watts) || 0;
    if (kcalIn.trim()) return Math.round(parseFloat(kcalIn) || 0);
    if (w > 0 && m > 0) return Math.round(w * m * 0.062); // metabolic ≈ mech watts / 0.23 efficiency
    return undefined;
  };

  const save = () => {
    if (!exercise.trim()) { Alert.alert('Name the exercise', 'Pick or type the machine/exercise first.'); return; }
    let entry;
    if (cardio) {
      const m = parseFloat(mins) || 0;
      if (m <= 0) { Alert.alert('Add your time', 'Enter how many minutes you did.'); return; }
      const w = parseFloat(watts) || 0;
      entry = { t: new Date().toISOString(), exercise: exercise.trim(), cardio: { mins: m, dist: parseFloat(dist) || 0, unit, watts: w || undefined }, kcal: estKcal() };
    } else {
      if (!sets.length) { Alert.alert('Log a set first', 'Enter reps (and weight) and tap Add set.'); return; }
      entry = { t: new Date().toISOString(), exercise: exercise.trim(), sets: sets.map((s) => [s.reps, s.kg] as [number, number]), kcal: Math.round(sets.reduce((a, s) => a + s.reps * (s.kg || 0), 0) / 60) + sets.length * 8 };
    }
    addWorkouts([entry]);
    // Remember this machine's setup so the next scan of the same code auto-fills.
    if (rawCode) rememberMachine(rawCode, { name: exercise.trim(), group, cardio, unit });
    Alert.alert('Logged', exercise.trim() + ' saved to your workout log.', [
      { text: 'View history', onPress: () => router.replace('/(client)/activity') },
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  const rescan = () => { setScanned(null); setRawCode(''); setExercise(''); setGroup(''); setCardio(false); setNeedsPick(false); setRecalled(false); setSets([]); setReps(''); setKg(''); setMins(''); setDist(''); setWatts(''); setKcalIn(''); setManual(false); setQ(''); };
  const inp = { flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  const showForm = scanned != null || manual;
  const strengthKcal = Math.round(sets.reduce((a, s) => a + s.reps * (s.kg || 0), 0) / 60) + sets.length * 8;
  const kcalNow = estKcal();
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md, marginBottom: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Log a machine</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Scan machine</Text>
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
                note="Repple reads the code on a machine, then names the exercise and muscle group for you.">
                <View style={{ marginTop: sp.lg }}>
                  <Cta label="Allow camera" wide onPress={requestPermission} />
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
              ) : (
                <Ghost label="Identify by photo" icon="camera" onPress={identifyByPhoto} />
              )}
              <View style={{ height: sp.sm }} />
              <Ghost label="No code? Pick the machine yourself" onPress={() => { setManual(true); setNeedsPick(true); setExercise(''); }} />
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
                  <Pressable onPress={() => { setCardio((c) => !c); }} hitSlop={6}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{cardio ? 'Cardio' : 'Strength'} · switch</Text>
                  </Pressable>
                </View>
              ) : null}
            </Section>

            {needsPick ? (<>
              <Rule />
              <Section>
                <SectionHead title="Machine catalogue" note={`${list.length}`} />
                <TextInput value={q} onChangeText={setQ} placeholder="Search machines (rower, leg press, lat…)" placeholderTextColor={t.ink3}
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, marginBottom: sp.md }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {list.map((m) => {
                    const on = exercise === m.name;
                    return (
                      <Pressable key={m.name} onPress={() => { applyDef(m); setQ(''); }}
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
                <SectionHead title="Your effort" note={kcalNow != null ? `${kcalNow} kcal` : undefined} />
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="minutes" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder={'distance (' + unit + ')'} placeholderTextColor={t.ink3} style={inp} />
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="avg watts" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" placeholder="calories" placeholderTextColor={t.ink3} style={inp} />
                </View>
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                  {['km', 'm', 'mi'].map((u) => (
                    <Pressable key={u} onPress={() => setUnit(u)}
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
                <SectionHead title="Add your sets" note={sets.length ? `${sets.length} logged` : undefined} />
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
                  <Ghost label="Add set" onPress={addSet} />
                </View>
                {sets.length > 0 ? (
                  <View style={{ marginTop: sp.md }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {sets.map((s, i) => (
                        <Pressable key={i} onPress={() => setSets((p) => p.filter((_, j) => j !== i))}
                          style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink2 }}>Set {i + 1}: {s.reps}×{s.kg || '–'}kg</Text>
                          <Icon name="minus" size={12} color={t.ink3} />
                        </Pressable>
                      ))}
                    </View>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.sm }}>≈ {strengthKcal} kcal, estimated from your total volume.</Text>
                  </View>
                ) : null}
              </Section>
            )}

            <Rule />

            <Section>
              <Cta label="Save to workout log" wide onPress={save} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Scan another machine" onPress={rescan} />
            </Section>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
