// Scan a QR code on a gym machine → identify the exercise → log reps & weight.
// Uses expo-camera (compiled into the native build). Falls back to manual entry
// when the camera can't run or the client prefers to type it in.
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { tapLight } from '../../src/ui/haptics';

// Turn whatever the QR encodes into a human machine/exercise label.
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
  const [exercise, setExercise] = useState('');
  const [reps, setReps] = useState('');
  const [kg, setKg] = useState('');
  const [sets, setSets] = useState<{ reps: number; kg: number }[]>([]);

  const onScan = (res: { data: string }) => {
    if (scanned) return;
    const name = parseMachine(res.data);
    setScanned(res.data); setExercise(name); tapLight();
  };
  const addSet = () => { const r = parseInt(reps, 10) || 0; if (!r) return; setSets((p) => [...p, { reps: r, kg: parseFloat(kg) || 0 }]); setReps(''); tapLight(); };
  const save = () => {
    if (!exercise.trim() || !sets.length) { Alert.alert('Log a set first', 'Enter reps (and weight) and tap Add set.'); return; }
    addWorkouts([{ t: new Date().toISOString(), exercise: exercise.trim(), sets: sets.map((s) => [s.reps, s.kg] as [number, number]), kcal: Math.round(sets.reduce((a, s) => a + s.reps * (s.kg || 0), 0) / 60) + sets.length * 8 }]);
    Alert.alert('Logged', exercise.trim() + ' saved to your workout log.', [{ text: 'Done', onPress: () => router.back() }]);
  };
  const rescan = () => { setScanned(null); setExercise(''); setSets([]); setReps(''); setKg(''); setManual(false); };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, flex: 1 } as const;

  const showForm = scanned != null || manual;
  const cameraReady = !!permission && permission.granted;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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
                <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 19 }}>Repple uses the camera to read the QR code on a machine and pull up the right exercise.</Text>
                <Pressable onPress={requestPermission} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginTop: 16 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Allow camera</Text></Pressable>
              </View>
            ) : (
              <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: t.ring, aspectRatio: 3 / 4, backgroundColor: '#000' }}>
                <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan}>
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: '62%', aspectRatio: 1, borderWidth: 3, borderColor: 'rgba(45,212,191,0.9)', borderRadius: 20 }} />
                    <Text style={{ color: '#fff', fontSize: 13, marginTop: 16, fontWeight: '700' }}>Point at the QR code on the machine</Text>
                  </View>
                </CameraView>
              </View>
            )}
            <Pressable onPress={() => { setManual(true); setExercise(''); }} style={{ marginTop: 14, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: t.brand, fontWeight: '700', fontSize: 14 }}>No QR code? Enter it manually</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 16, marginBottom: 14 }}>
              <Text style={{ color: t.brand, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 }}>{scanned ? 'Machine identified' : 'Manual entry'}</Text>
              <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 4, marginBottom: 8 }}>Exercise — edit if it's not quite right.</Text>
              <TextInput value={exercise} onChangeText={setExercise} placeholder="Exercise name" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, textTransform: 'capitalize' }} />
            </View>

            <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Add your sets</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
              <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
              <Pressable onPress={addSet} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add set</Text></Pressable>
            </View>

            {sets.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {sets.map((s, i) => (
                  <Pressable key={i} onPress={() => setSets((p) => p.filter((_, j) => j !== i))} style={{ backgroundColor: t.surface2, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: t.ring, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Set {i + 1}: {s.reps}×{s.kg || '–'}kg</Text><Icon name="minus" size={12} color={t.ink3} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              <Icon name="check" size={16} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save to workout log</Text>
            </Pressable>
            <Pressable onPress={rescan} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Scan another machine</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
