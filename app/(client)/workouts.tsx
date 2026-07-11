// Train — pick any weekday, follow your AI program (log/swap/video) OR log cardio.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { buildProgram, type ProgramExercise } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CARDIO = ['Treadmill / Run', 'Cycling', 'Rowing', 'Ski erg', 'Elliptical', 'Swim', 'Walk', 'Stairs'];

export default function Train() {
  const t = useTheme();
  const cd = useClientData();
  const program = buildProgram(cd.goal, cd.bodyFatPct);
  const jsToMon = (new Date().getDay() + 6) % 7; // Mon=0
  const [dayIdx, setDayIdx] = useState(jsToMon);
  const [mode, setMode] = useState<'strength' | 'cardio'>('strength');
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [logged, setLogged] = useState<Record<string, { reps: string; kg: string }[]>>({});
  const [cardioLog, setCardioLog] = useState<{ type: string; mins: number; dist: number; unit: string; kcal: number }[]>([]);
  const [swapFor, setSwapFor] = useState<ProgramExercise | null>(null);
  const [videoFor, setVideoFor] = useState<string | null>(null);
  const [ctype, setCtype] = useState(CARDIO[0]); const [mins, setMins] = useState('30'); const [dist, setDist] = useState('5'); const [unit, setUnit] = useState<'km' | 'mi'>('km');

  // map any weekday to one of the program's workouts so you can train any day
  const workout = program.days[dayIdx % program.days.length];
  const uid = (e: ProgramExercise) => `${dayIdx}:${e.key}`;
  const nameOf = (e: ProgramExercise) => swaps[uid(e)] || e.name;
  const logSet = (e: ProgramExercise, reps: string, kg: string) => { if (!reps) return; setLogged({ ...logged, [uid(e)]: [...(logged[uid(e)] || []), { reps, kg }] }); };
  const logCardio = () => { const m = parseInt(mins, 10) || 0, d = parseFloat(dist) || 0; if (!m) return; setCardioLog([{ type: ctype, mins: m, dist: d, unit, kcal: Math.round(m * 10) }, ...cardioLog]); setMins('30'); setDist('5'); };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, flex: 1 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Train</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>{program.title} · pick the day you're training</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
          {WEEK.map((d, i) => {
            const on = i === dayIdx; const today = i === jsToMon;
            return (
              <Pressable key={d} onPress={() => setDayIdx(i)} style={{ width: 46, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink, fontWeight: '800', fontSize: 13 }}>{d}</Text>
                <Text style={{ color: on ? t.brandInk : today ? t.brand : t.ink3, fontSize: 9, marginTop: 2 }}>{today ? 'today' : ''}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 10, padding: 3, marginBottom: 14, borderWidth: 1, borderColor: t.ring }}>
          {(['strength', 'cardio'] as const).map((mm) => (
            <Pressable key={mm} onPress={() => setMode(mm)} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: mode === mm ? t.brand : 'transparent' }}>
              <Text style={{ color: mode === mm ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 13 }}>{mm === 'strength' ? '🏋️ Strength' : '🏃 Cardio'}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'strength' ? (
          <View>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 12 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{workout.focus}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>🤖 {program.focus.join(' · ')}{workout.cardio ? ` · finish with ${workout.cardio}` : ''}</Text>
            </View>
            {workout.exercises.map((e) => {
              const sets = logged[uid(e)] || []; const done = sets.length >= e.sets;
              return (
                <View key={e.key} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: done ? t.brand : t.ring, padding: 15, marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{done ? '✅ ' : ''}{nameOf(e)}</Text>
                      <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{e.group} · target {e.sets} × {e.reps}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable onPress={() => setVideoFor(nameOf(e))} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ color: t.ink, fontSize: 12, fontWeight: '700' }}>▶</Text></Pressable>
                      <Pressable onPress={() => setSwapFor(e)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ color: t.ink, fontSize: 12, fontWeight: '700' }}>🔄</Text></Pressable>
                    </View>
                  </View>
                  {sets.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{sets.map((s, i) => <View key={i} style={{ backgroundColor: t.surface2, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{s.reps}×{s.kg || '–'}kg</Text></View>)}</View>}
                  <LogRow t={t} onLog={(r, k) => logSet(e, r, k)} />
                </View>
              );
            })}
          </View>
        ) : (
          <View>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Log a cardio session</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 10 }}>
                {CARDIO.map((ct) => <Pressable key={ct} onPress={() => setCtype(ct)} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: ctype === ct ? t.brand : t.surface2, borderWidth: 1, borderColor: ctype === ct ? t.brand : t.ring }}><Text style={{ color: ctype === ct ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{ct}</Text></Pressable>)}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="mins" placeholderTextColor={t.ink3} style={inp} />
                <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder="dist" placeholderTextColor={t.ink3} style={inp} />
                <Pressable onPress={() => setUnit(unit === 'km' ? 'mi' : 'km')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 14, justifyContent: 'center' }}><Text style={{ color: t.ink, fontWeight: '700' }}>{unit}</Text></Pressable>
                <Pressable onPress={logCardio} style={{ backgroundColor: t.brand, borderRadius: 9, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Log</Text></Pressable>
              </View>
            </View>
            {cardioLog.length > 0 && (
              <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Today's cardio</Text>
                {cardioLog.map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < cardioLog.length - 1 ? 1 : 0, borderBottomColor: t.ring }}>
                    <Text style={{ color: t.ink, fontWeight: '600', fontSize: 14 }}>{c.type}</Text>
                    <Text style={{ color: t.ink3, fontSize: 13 }}>{c.mins} min · {c.dist} {c.unit} · 🔥 {c.kcal}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!swapFor} transparent animationType="slide" onRequestClose={() => setSwapFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSwapFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20 }}>
          {swapFor && (<View>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>Swap {nameOf(swapFor)}</Text>
            <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2, marginBottom: 14 }}>Alternatives that hit the same muscles</Text>
            {[swapFor.name, ...swapFor.alternatives].map((alt) => { const on = nameOf(swapFor) === alt; return (
              <Pressable key={alt} onPress={() => { setSwaps({ ...swaps, [uid(swapFor)]: alt }); setSwapFor(null); }} style={{ backgroundColor: on ? t.surface2 : 'transparent', borderColor: on ? t.brand : t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: t.ink, fontWeight: '600', fontSize: 14 }}>{alt}</Text>{on && <Text style={{ color: t.brand, fontWeight: '800' }}>✓</Text>}
              </Pressable>); })}
          </View>)}
        </View>
      </Modal>
      <Modal visible={!!videoFor} transparent animationType="fade" onRequestClose={() => setVideoFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setVideoFor(null)}>
          <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.ring }}>
            <Text style={{ fontSize: 40 }}>▶️</Text><Text style={{ color: '#fff', fontWeight: '700', marginTop: 8 }}>{videoFor}</Text><Text style={{ color: '#999', fontSize: 12, marginTop: 4 }}>Your coach's demo plays here</Text>
          </View>
          <Text style={{ color: '#bbb', fontSize: 12, marginTop: 14 }}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function LogRow({ t, onLog }: { t: Theme; onLog: (reps: string, kg: string) => void }) {
  const [reps, setReps] = useState(''); const [kg, setKg] = useState('');
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, flex: 1 } as const;
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
      <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
      <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
      <Pressable onPress={() => { onLog(reps, kg); setReps(''); setKg(''); }} style={{ backgroundColor: t.brand, borderRadius: 9, paddingHorizontal: 18, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Log set</Text></Pressable>
    </View>
  );
}
