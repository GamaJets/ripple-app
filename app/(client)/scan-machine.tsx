// Scan a QR/code on a gym machine → identify the exercise + muscle group → log it.
// If the machine's code is just an asset serial (many gyms), we can't name it from
// the code, so we ask the member to pick the machine from a searchable catalogue —
// that way the screen always shows a real exercise + target muscle. Cardio machines
// (rower, ski-erg, bike…) log duration / distance / avg watts / calories instead of
// reps & weight, and we're explicit about where the calorie number comes from.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { tapLight } from '../../src/ui/haptics';
import { MACHINES, identifyMachine, looksLikeSerial, type MachineDef } from '../../src/lib/machines';
import { recallMachine, rememberMachine } from '../../src/lib/machineMemory';

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
    return MACHINES.filter((m) => !s || m.name.toLowerCase().includes(s) || m.group.toLowerCase().includes(s) || (m.keys || []).some((k) => k.includes(s)));
  }, [q]);

  const addSet = () => { const r = parseInt(reps, 10) || 0; if (!r) return; setSets((p) => [...p, { reps: r, kg: parseFloat(kg) || 0 }]); setReps(''); tapLight(); };

  // Cardio calories: entered from the machine/watch, or estimated from avg watts.
  const estKcal = () => {
    const m = parseFloat(mins) || 0; const w = parseFloat(watts) || 0;
    if (kcalIn.trim()) return Math.round(parseFloat(kcalIn) || 0);
    if (w > 0 && m > 0) return Math.round(w * m * 0.062); // metabolic ≈ mech watts / 0.23 efficiency
    return Math.round(m * 8); // last-resort light estimate
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
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, flex: 1 } as const;

  const showForm = scanned != null || manual;
  const strengthKcal = Math.round(sets.reduce((a, s) => a + s.reps * (s.kg || 0), 0) / 60) + sets.length * 8;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Scan machine</Text>
          <Pressable onPress={() => router.back()} hitSlop={8}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 15 }}>Close</Text></Pressable>
        </View>

        {!showForm ? (
          <View>
            {!permission ? (
              <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 22, alignItems: 'center' }}>
                <Text style={{ color: t.ink3, fontSize: 13 }}>Preparing camera…</Text>
              </View>
            ) : !permission.granted ? (
              <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 20, alignItems: 'center' }}>
                <Icon name="camera" size={30} color={t.brand} />
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginTop: 10 }}>Camera access</Text>
                <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 19 }}>Repple reads the code on a machine, then names the exercise and muscle group for you.</Text>
                <Pressable onPress={requestPermission} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginTop: 16 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Allow camera</Text></Pressable>
              </View>
            ) : (
              <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: t.ring, aspectRatio: 3 / 4, backgroundColor: '#000' }}>
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan}>
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: '62%', aspectRatio: 1, borderWidth: 3, borderColor: 'rgba(45,212,191,0.9)', borderRadius: 20 }} />
                    <Text style={{ color: '#fff', fontSize: 13, marginTop: 16, fontWeight: '700' }}>Point at the code on the machine</Text>
                  </View>
                </CameraView>
              </View>
            )}
            <Pressable onPress={() => { setManual(true); setNeedsPick(true); setExercise(''); }} style={{ marginTop: 14, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: t.brand, fontWeight: '700', fontSize: 14 }}>No code? Pick the machine yourself</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 16, marginBottom: 14 }}>
              <Text style={{ color: t.brand, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 }}>{recalled ? '✓ Remembered' : needsPick ? 'Pick the machine' : 'Machine identified'}</Text>
              {recalled ? (
                <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 4 }}>You set this machine up before — recalled automatically. Edit if you like.</Text>
              ) : needsPick && rawCode && looksLikeSerial(rawCode) ? (
                <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 4 }}>The machine's code (<Text style={{ color: t.ink2 }}>{rawCode.slice(0, 18)}</Text>) is just its serial — choose the exercise below. We'll remember it next time.</Text>
              ) : (
                <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 4, marginBottom: 8 }}>Exercise — edit if it's not quite right.</Text>
              )}
              <TextInput value={exercise} onChangeText={setExercise} placeholder="Exercise name" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginTop: 8, textTransform: 'capitalize' }} />
              {group ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <View style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 }}><Text style={{ color: t.brand, fontWeight: '800', fontSize: 12 }}>{group}</Text></View>
                  <Pressable onPress={() => { setCardio((c) => !c); }} hitSlop={6}><Text style={{ color: t.ink3, fontSize: 12 }}>{cardio ? 'Cardio' : 'Strength'} · switch</Text></Pressable>
                </View>
              ) : null}
            </View>

            {needsPick ? (
              <View style={{ marginBottom: 16 }}>
                <TextInput value={q} onChangeText={setQ} placeholder="Search machines (rower, leg press, lat…)" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, marginBottom: 10 }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {list.map((m) => (
                    <Pressable key={m.name} onPress={() => { applyDef(m); setQ(''); }} style={{ backgroundColor: exercise === m.name ? t.brand : t.surface2, borderColor: exercise === m.name ? t.brand : t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }}>
                      <Text style={{ color: exercise === m.name ? t.brandInk : t.ink, fontWeight: '700', fontSize: 12.5 }}>{m.name}</Text>
                      <Text style={{ color: exercise === m.name ? t.brandInk : t.ink3, fontSize: 10.5 }}>{m.group}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {cardio ? (
              <View>
                <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Your effort</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                  <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="minutes" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder={'distance (' + unit + ')'} placeholderTextColor={t.ink3} style={inp} />
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="avg watts" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" placeholder="calories" placeholderTextColor={t.ink3} style={inp} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {['km', 'm', 'mi'].map((u) => (
                    <Pressable key={u} onPress={() => setUnit(u)} style={{ borderWidth: 1, borderColor: unit === u ? t.brand : t.ring, backgroundColor: unit === u ? 'rgba(25,214,191,0.14)' : 'transparent', borderRadius: 9, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: unit === u ? t.brand : t.ink3, fontWeight: '700', fontSize: 13 }}>{u}</Text></Pressable>
                  ))}
                </View>
                <Text style={{ color: t.ink3, fontSize: 11.5, lineHeight: 17, marginBottom: 14 }}>Calories come from the machine's console or your Apple Watch. Leave it blank and we'll estimate from your average watts{watts.trim() ? ' (≈ ' + estKcal() + ' kcal)' : ''}.</Text>
              </View>
            ) : (
              <View>
                <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Add your sets</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
                  <Pressable onPress={addSet} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add set</Text></Pressable>
                </View>
                {sets.length > 0 ? (
                  <View style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {sets.map((s, i) => (
                        <Pressable key={i} onPress={() => setSets((p) => p.filter((_, j) => j !== i))} style={{ backgroundColor: t.surface2, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: t.ring, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Set {i + 1}: {s.reps}×{s.kg || '–'}kg</Text><Icon name="minus" size={12} color={t.ink3} />
                        </Pressable>
                      ))}
                    </View>
                    <Text style={{ color: t.ink3, fontSize: 11.5 }}>≈ {strengthKcal} kcal, estimated from your total volume.</Text>
                  </View>
                ) : null}
              </View>
            )}

            <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 }}>
              <Icon name="check" size={16} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save to workout log</Text>
            </Pressable>
            <Pressable onPress={rescan} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Scan another machine</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
