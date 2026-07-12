// Train — matches the approved mockup: serif header, day strip, "Today" hero with
// Start, clean exercise cards (video/swap line icons, target suggestion, Log set).
// Guided session runner, cardio logging & month calendar preserved.
import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { tapLight } from '../../src/ui/haptics';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { buildProgram, type ProgramExercise } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useWearables } from '../../src/ui/wearables';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { suggestForExercise, priorBest1RM } from '../../src/lib/progression';
import { est1RM } from '../../src/lib/streaks';
import { Confetti } from '../../src/ui/Confetti';
import { useWorkoutLog } from '../../src/ui/workoutLog';

const SERIF = 'Georgia';
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CARDIO = ['Treadmill / Run', 'Cycling', 'Rowing', 'Ski erg', 'Elliptical', 'Swim', 'Walk', 'Stairs'];
const SESSION_TYPES: Record<'cardio' | 'hiit' | 'mobility', string[]> = {
  cardio: CARDIO,
  hiit: ['Circuit', 'Tabata', 'EMOM', 'AMRAP', 'Sprint intervals', 'Bike intervals', 'Bag work'],
  mobility: ['Stretching', 'Yoga', 'Foam rolling', 'Dynamic warm-up', 'Pilates'],
};
const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility']] as const;

export default function Train() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const _cp = useAssignedPrograms().getProgram(cd.id);
  const coachProgram = cd.coachingMode === 'solo' ? null : _cp;
  const w = useWearables();
  const { log: workoutLog, addWorkouts } = useWorkoutLog();
  const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
  const jsToMon = (new Date().getDay() + 6) % 7;
  const [dayIdx, setDayIdx] = useState(jsToMon);
  const [mode, setMode] = useState<'strength' | 'cardio' | 'hiit' | 'mobility'>('strength');
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [logged, setLogged] = useState<Record<string, { reps: string; kg: string }[]>>({});
  const [cardioLog, setCardioLog] = useState<{ type: string; mins: number; dist: number; unit: string; kcal: number }[]>([]);
  const [swapFor, setSwapFor] = useState<ProgramExercise | null>(null);
  const [videoFor, setVideoFor] = useState<string | null>(null);
  const [session, setSession] = useState(false);
  const [ctype, setCtype] = useState(CARDIO[0]); const [mins, setMins] = useState('30'); const [dist, setDist] = useState('5'); const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [showCal, setShowCal] = useState(false);
  const [selCalDay, setSelCalDay] = useState('');
  const [confetti, setConfetti] = useState(false);
  const today0 = new Date();
  const monday0 = new Date(today0); monday0.setDate(today0.getDate() - jsToMon); monday0.setHours(0, 0, 0, 0);
  const dateFor = (i: number) => { const d = new Date(monday0); d.setDate(monday0.getDate() + i); return d; };
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dstr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const workedDates = new Set(workoutLog.map((l) => dstr(new Date(l.t))));
  Object.keys(logged).forEach((k) => { if ((logged[k] || []).length) workedDates.add(dstr(dateFor(parseInt(k.split(':')[0], 10)))); });
  if (cardioLog.length) workedDates.add(dstr(today0));
  const calMonth = monday0.getMonth(), calYear = monday0.getFullYear();
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const monthLabel = monday0.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const activeCalDay = selCalDay || dstr(today0);
  const dayEntries = workoutLog.filter((l) => dstr(new Date(l.t)) === activeCalDay);
  const dayVolume = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.reduce((x: number, s: number[]) => x + (s[0] || 0) * (s[1] || 0), 0) : 0), 0);
  const daySets = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.length : 0), 0);
  const dayKcal = dayEntries.reduce((a, l) => a + (l.kcal || 0), 0);
  const prettyDay = (ds: string) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };

  const programDays = Array.isArray(program && program.days) ? program.days : [];
  const workout = programDays[dayIdx % (programDays.length || 1)] || programDays[0] || { day: '', focus: 'Rest day', exercises: [] };
  const exercises = Array.isArray(workout && workout.exercises) ? workout.exercises : [];
  const estMin = Math.max(20, exercises.length * 9);
  const uid = (e: ProgramExercise) => `${dayIdx}:${e.key}`;
  const nameOf = (e: ProgramExercise) => swaps[uid(e)] || e.name;
  const logSet = (e: ProgramExercise, reps: string, kg: string) => { if (!reps) return; setLogged({ ...logged, [uid(e)]: [...(logged[uid(e)] || []), { reps, kg }] }); tapLight(); };
  const quickLog = (e: ProgramExercise) => { const sg = suggestForExercise(workoutLog, nameOf(e), e.reps); logSet(e, String(parseInt(e.reps, 10) || 8), sg ? String(sg.weight) : ''); };
  const logCardio = () => {
    const m = parseInt(mins, 10) || 0, d = parseFloat(dist) || 0; if (!m) return;
    const kcal = Math.round(m * 10);
    setCardioLog([{ type: ctype, mins: m, dist: d, unit, kcal }, ...cardioLog]);
    addWorkouts([{ t: new Date().toISOString(), exercise: ctype, cardio: { mins: m, dist: d, unit }, kcal }]);
    setMins('30'); setDist('5');
  };
  const saveManual = () => {
    const nowISO = new Date().toISOString();
    let pr = false;
    const entries: WorkoutEntry[] = exercises.map((e) => {
      const s = logged[uid(e)] || [];
      if (!s.length) return null;
      const setPairs = s.map((x) => [parseInt(x.reps, 10) || 0, parseFloat(x.kg) || 0] as [number, number]);
      const bestE1 = Math.max(0, ...setPairs.map(([r, kg]) => (r && kg ? est1RM(kg, r) : 0)));
      if (bestE1 > priorBest1RM(workoutLog, nameOf(e))) pr = true;
      return { t: nowISO, exercise: nameOf(e), sets: setPairs, kcal: Math.round(setPairs.reduce((a, [r, kg]) => a + r * kg, 0) / 60) + s.length * 8 };
    }).filter(Boolean) as WorkoutEntry[];
    if (!entries.length) return;
    addWorkouts(entries);
    setLogged({});
    if (pr) setConfetti(true);
    Alert.alert('Workout saved', `${entries.length} exercise${entries.length === 1 ? '' : 's'} logged.${pr ? ' New personal record!' : ''} Your streak and records are updated.`, [{ text: 'Nice' }]);
  };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, flex: 1 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* header: serif title + program split chip */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: SERIF }}>Train</Text>
          <View style={{ borderWidth: 1, borderColor: coachProgram ? t.brand : t.ring, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 }}>
            <Text style={{ color: coachProgram ? t.brand : t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }} numberOfLines={1}>{coachProgram ? 'Coach plan' : program.title}</Text>
          </View>
        </View>

        {/* month calendar + book a session */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <Pressable onPress={() => { setSelCalDay(dstr(dateFor(dayIdx))); setShowCal(true); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 11 }}>
            <Icon name="calendar" size={15} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Month calendar</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/(client)/calendar')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 11 }}>
            <Icon name="plus" size={15} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Book session</Text>
          </Pressable>
        </View>

        {/* quick links */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
          {([['trending', 'Targets', '/(client)/progression'], ['calendar', 'This Week', '/(client)/week'], ['trophy', 'Records', '/(client)/records'], ['water', 'Recovery', '/(client)/recovery'], ['video', 'Library', '/(client)/library'], ['settings', 'Tools', '/(client)/tools']] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* day strip */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
          {WEEK.map((d, i) => {
            const on = i === dayIdx; const today = i === jsToMon; const dnum = dateFor(i).getDate(); const worked = workedDates.has(dstr(dateFor(i)));
            return (
              <Pressable key={d} onPress={() => setDayIdx(i)} style={{ flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center', backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : today ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 10 }}>{d}</Text>
                <Text style={{ color: on ? t.brandInk : t.ink, fontWeight: '800', fontSize: 15, marginTop: 1 }}>{dnum}</Text>
                <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 3, backgroundColor: worked ? (on ? t.brandInk : t.brand) : 'transparent' }} />
              </Pressable>
            );
          })}
        </View>

        {/* workout-type switcher */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
          {WTYPES.map(([id, label]) => {
            const on = mode === id;
            return (
              <Pressable key={id} onPress={() => { setMode(id); if (id !== 'strength') setCtype(SESSION_TYPES[id][0]); }} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {mode === 'strength' ? (
          <View>
            {/* Today hero */}
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Today · {workout.focus}</Text>
                <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800', marginTop: 2 }}>{exercises.length} exercises · ~{estMin} min</Text>
              </View>
              <Pressable onPress={() => setSession(true)} style={{ backgroundColor: t.brand, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="play" size={14} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Start</Text>
              </Pressable>
            </View>

            {exercises.map((e) => {
              const sets = logged[uid(e)] || []; const done = sets.length >= e.sets;
              const sug = suggestForExercise(workoutLog, nameOf(e), e.reps);
              return (
                <View key={e.key} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: done ? t.brand : t.ring, padding: 14, marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {done ? <Icon name="check" size={15} color={t.brand} /> : null}
                        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14.5, textTransform: 'capitalize' }} numberOfLines={1}>{nameOf(e)}</Text>
                      </View>
                      <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 2 }}>{e.group} · target {e.sets} × {e.reps}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable onPress={() => setVideoFor(nameOf(e))} style={{ width: 30, height: 30, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Icon name="video" size={15} color={t.ink2} /></Pressable>
                      <Pressable onPress={() => setSwapFor(e)} style={{ width: 30, height: 30, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Icon name="swap" size={15} color={t.ink2} /></Pressable>
                    </View>
                  </View>
                  {sets.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{sets.map((s, i) => <View key={i} style={{ backgroundColor: t.surface2, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{s.reps}×{s.kg || '–'}kg</Text></View>)}</View>}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    {sug ? (
                      <View style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: t.ring }}>
                        <Icon name="target" size={14} color={t.brand} />
                        <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>{sug.weight} kg</Text>
                        {sug.up ? <Text style={{ color: t.brand, fontWeight: '800', fontSize: 12 }}>↑</Text> : null}
                        <Text style={{ color: t.ink3, fontSize: 11, flex: 1 }} numberOfLines={1}>{sug.reason}</Text>
                      </View>
                    ) : <View style={{ flex: 1 }} />}
                    <Pressable onPress={() => quickLog(e)} style={{ backgroundColor: t.brand, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Log set</Text></Pressable>
                  </View>
                </View>
              );
            })}
            {Object.values(logged).some((a) => a.length > 0) ? (
              <Pressable onPress={saveManual} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 4, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                <Icon name="check" size={16} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save workout to log</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Log a {mode === 'hiit' ? 'HIIT' : mode === 'mobility' ? 'mobility' : 'cardio'} session</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 10 }}>
                {(SESSION_TYPES[(mode === 'strength' ? 'cardio' : mode) as 'cardio' | 'hiit' | 'mobility'] || CARDIO).map((ct) => <Pressable key={ct} onPress={() => setCtype(ct)} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: ctype === ct ? t.brand : t.surface2, borderWidth: 1, borderColor: ctype === ct ? t.brand : t.ring }}><Text style={{ color: ctype === ct ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{ct}</Text></Pressable>)}
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
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Today's sessions</Text>
                {cardioLog.map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < cardioLog.length - 1 ? 1 : 0, borderBottomColor: t.ring }}>
                    <Text style={{ color: t.ink, fontWeight: '600', fontSize: 14 }}>{c.type}</Text>
                    <Text style={{ color: t.ink3, fontSize: 13 }}>{c.mins} min · {c.dist} {c.unit} · {c.kcal} kcal</Text>
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
              <Pressable key={alt} onPress={() => { setSwaps({ ...swaps, [uid(swapFor)]: alt }); setSwapFor(null); }} style={{ backgroundColor: on ? t.surface2 : 'transparent', borderColor: on ? t.brand : t.ring, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontWeight: '600', fontSize: 14 }}>{alt}</Text>{on && <Icon name="check" size={16} color={t.brand} />}
              </Pressable>); })}
          </View>)}
        </View>
      </Modal>

      <Modal visible={!!videoFor} transparent animationType="fade" onRequestClose={() => setVideoFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setVideoFor(null)}>
          <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.ring }}>
            <Icon name="play" size={40} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', marginTop: 8 }}>{videoFor}</Text><Text style={{ color: '#999', fontSize: 12, marginTop: 4 }}>Your coach's demo plays here</Text>
          </View>
          <Text style={{ color: '#bbb', fontSize: 12, marginTop: 14 }}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>

      <Modal visible={showCal} transparent animationType="slide" onRequestClose={() => setShowCal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowCal(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800', textTransform: 'capitalize' }}>{monthLabel}</Text>
            <Pressable onPress={() => setShowCal(false)}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Close</Text></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', marginBottom: 6 }}>
              {WEEK.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', color: t.ink3, fontSize: 11, fontWeight: '700' }}>{d[0]}</Text>)}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {Array.from({ length: firstDow }).map((_, i) => <View key={'e' + i} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const ds = `${calYear}-${pad2(calMonth + 1)}-${pad2(day)}`;
                const worked = workedDates.has(ds); const isToday = ds === dstr(today0); const isSel = ds === activeCalDay;
                return (
                  <Pressable key={day} onPress={() => setSelCalDay(ds)} style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: worked ? t.brand : 'transparent', borderWidth: isSel ? 2 : isToday && !worked ? 1 : 0, borderColor: isSel ? t.ink : t.brand }}>
                      <Text style={{ color: worked ? t.brandInk : isToday ? t.brand : t.ink2, fontWeight: worked || isToday ? '800' : '500', fontSize: 13 }}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ borderTopWidth: 1, borderTopColor: t.ring, marginTop: 14, paddingTop: 14 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 8 }}>{prettyDay(activeCalDay)}</Text>
              {dayEntries.length === 0 ? (
                <Text style={{ color: t.ink3, fontSize: 13 }}>Rest day — no workout logged.</Text>
              ) : (
                <View>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                    {([['Exercises', String(dayEntries.length)], ['Sets', String(daySets)], ['Volume', dayVolume ? `${(dayVolume / 1000).toFixed(1)}t` : '—'], ['kcal', String(dayKcal)]] as [string, string][]).map(([l, v]) => (
                      <View key={l} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{v}</Text>
                        <Text style={{ color: t.ink3, fontSize: 10, marginTop: 2 }}>{l}</Text>
                      </View>
                    ))}
                  </View>
                  {dayEntries.map((l, i) => (
                    <View key={i} style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}>
                      <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' }}>{l.exercise}</Text>
                      {l.sets ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                          {l.sets.map((s: number[], j: number) => <View key={j} style={{ backgroundColor: t.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontSize: 12, fontWeight: '600' }}>{s[0]}×{s[1]}kg</Text></View>)}
                        </View>
                      ) : l.cardio ? (
                        <Text style={{ color: t.ink3, fontSize: 12, marginTop: 5 }}>{l.cardio.mins} min · {l.cardio.dist} {l.cardio.unit}</Text>
                      ) : null}
                      {l.kcal ? <Text style={{ color: t.ink3, fontSize: 11, marginTop: 6 }}>{l.kcal} kcal</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.brand }} />
              <Text style={{ color: t.ink3, fontSize: 12 }}>Days you trained · {workedDates.size} sessions logged · tap any day for details</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={session} animationType="slide" onRequestClose={() => setSession(false)}>
        <SessionRunner t={t} exercises={exercises} focus={workout.focus} nameOf={nameOf} liveHr={w && w.today ? w.today.heartRateAvg : null} log={workoutLog} onComplete={addWorkouts} onClose={() => setSession(false)} />
      </Modal>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
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

function SessionRunner({ t, exercises, focus, nameOf, liveHr, log, onComplete, onClose }: { t: Theme; exercises: ProgramExercise[]; focus: string; nameOf: (e: ProgramExercise) => string; liveHr: number | null; log: WorkoutEntry[]; onComplete: (entries: WorkoutEntry[]) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<{ reps: number; kg: number }[][]>(() => exercises.map(() => []));
  const [reps, setReps] = useState(''); const [kg, setKg] = useState('');
  const [rest, setRest] = useState(0);
  const [rpes, setRpes] = useState<('easy' | 'ok' | 'hard')[][]>(() => exercises.map(() => []));
  const [pendingFeel, setPendingFeel] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [prMsg, setPrMsg] = useState<string | null>(null);
  const rid = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (rest <= 0) { if (rid.current) clearInterval(rid.current); return; }
    rid.current = setInterval(() => setRest((r) => (r <= 1 ? 0 : r - 1)), 1000);
    return () => { if (rid.current) clearInterval(rid.current); };
  }, [rest > 0]);

  useEffect(() => {
    const sug = suggestForExercise(log, nameOf(exercises[idx]), exercises[idx].reps);
    setKg(sug ? String(sug.weight) : '');
    setReps('');
    setPrMsg(null);
    setPendingFeel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const ex = exercises[idx];
  const done = results[idx] || [];
  const logSet = () => {
    const r = parseInt(reps, 10) || 0; if (!r) return;
    const wkg = parseFloat(kg) || 0;
    const name = nameOf(exercises[idx]);
    const newE1 = wkg && r ? est1RM(wkg, r) : 0;
    const priorBest = Math.max(priorBest1RM(log, name), ...done.map((s) => (s.kg && s.reps ? est1RM(s.kg, s.reps) : 0)), 0);
    if (newE1 > 0 && newE1 > priorBest) { setPrMsg(`New PR on ${name}! ${wkg}kg × ${r}`); setConfetti(true); }
    setResults((prev) => { const n = prev.map((a) => [...a]); n[idx].push({ reps: r, kg: wkg }); return n; });
    setReps(''); setRest(90); setPendingFeel(wkg);
  };
  const feelStep = (base: number) => (base >= 60 ? 5 : base >= 20 ? 2.5 : base > 0 ? 1 : 0);
  const chooseFeel = (f: 'easy' | 'ok' | 'hard') => {
    setRpes((prev) => { const n = prev.map((a) => [...a]); n[idx].push(f); return n; });
    const base = pendingFeel || 0;
    const st = feelStep(base);
    const nextKg = f === 'easy' ? base + st : f === 'hard' ? Math.max(0, base - st) : base;
    setKg(nextKg ? String(nextKg) : '');
    setPendingFeel(null);
    tapLight();
  };
  const finish = () => {
    const nowISO = new Date().toISOString();
    const entries: WorkoutEntry[] = results
      .map((sets, i) => (sets.length ? {
        t: nowISO,
        exercise: nameOf(exercises[i]),
        sets: sets.map((s) => [s.reps, s.kg]) as [number, number][],
        kcal: Math.round(sets.reduce((a, s) => a + s.reps * (s.kg || 0), 0) / 60) + sets.length * 8,
      } : null))
      .filter(Boolean) as WorkoutEntry[];
    onComplete(entries);
    setFinished(true); setConfetti(true);
  };
  const next = () => { if (idx < exercises.length - 1) { setIdx(idx + 1); setRest(0); } else finish(); };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, flex: 1 } as const;

  if (!exercises || exercises.length === 0) return null;
  if (finished) {
    const totalSets = results.reduce((a, r) => a + r.length, 0);
    const volume = results.reduce((a, r) => a + r.reduce((x, s) => x + s.reps * s.kg, 0), 0);
    const exDone = results.filter((r) => r.length > 0).length;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ padding: 22, paddingTop: topPad + 10 }}>
          <View style={{ alignItems: 'center', marginTop: 20 }}><Icon name="trophy" size={44} color={t.brand} /></View>
          <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8 }}>Session complete</Text>
          <Text style={{ color: t.ink3, fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: 24, textTransform: 'capitalize' }}>{focus}</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            {[['Exercises', `${exDone}/${exercises.length}`], ['Sets', String(totalSets)], ['Volume', `${(volume / 1000).toFixed(1)}t`]].map(([l, v]) => (
              <View key={l} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800' }}>{v}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{l}</Text>
              </View>
            ))}
          </View>
          {liveHr != null ? <View style={{ backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="heart" size={15} color={t.brand} /><Text style={{ color: t.ink2, fontSize: 13 }}>Avg heart rate today {liveHr} bpm · from your watch</Text></View> : null}
          <Text style={{ color: t.ink3, fontSize: 12, textAlign: 'center', marginBottom: 20 }}>Logged to your history — strength trends and your coach's dashboard update automatically.</Text>
          <Pressable onPress={onClose} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Done</Text></Pressable>
        </ScrollView>
        <Confetti show={confetti} onDone={() => setConfetti(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, paddingTop: topPad + 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ color: t.ink3, fontSize: 13 }}>Exercise {idx + 1} of {exercises.length}</Text>
          <Pressable onPress={onClose}><Text style={{ color: t.ink3, fontSize: 15, fontWeight: '700' }}>End</Text></Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 5, marginBottom: 20 }}>
          {exercises.map((_, i) => <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < idx ? t.good : i === idx ? t.brand : t.surface3 }} />)}
        </View>

        {liveHr != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 16 }}>
            <Icon name="heart" size={18} color={t.brand} /><Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{liveHr}</Text><Text style={{ color: t.ink3, fontSize: 13 }}>bpm · from your watch</Text>
          </View>
        ) : null}

        {prMsg ? (
          <View style={{ backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="trophy" size={16} color={t.s3} /><Text style={{ color: t.s3, fontWeight: '800', fontSize: 14 }}>{prMsg}</Text>
          </View>
        ) : null}

        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '900', textTransform: 'capitalize' }}>{nameOf(ex)}</Text>
        <Text style={{ color: t.ink3, fontSize: 14, marginTop: 4, marginBottom: 20 }}>{ex.group} · target {ex.sets} × {ex.reps}</Text>

        {rest > 0 ? (
          <View style={{ backgroundColor: t.brand, borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: t.brandInk, fontSize: 13, fontWeight: '700', opacity: 0.85 }}>REST</Text>
            <Text style={{ color: t.brandInk, fontSize: 40, fontWeight: '900' }}>{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</Text>
            <Pressable onPress={() => setRest(0)} style={{ marginTop: 6 }}><Text style={{ color: t.brandInk, fontWeight: '700', opacity: 0.85 }}>Skip rest</Text></Pressable>
          </View>
        ) : null}

        {done.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {done.map((s, i) => { const f = (rpes[idx] || [])[i]; const fc = f === 'easy' ? t.good : f === 'hard' ? t.crit : t.ink3; return (<View key={i} style={{ backgroundColor: t.surface2, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: t.ring, flexDirection: 'row', alignItems: 'center', gap: 6 }}>{f ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fc }} /> : null}<Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Set {i + 1}: {s.reps}×{s.kg || '–'}kg</Text></View>); })}
          </View>
        ) : null}

        <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 6 }}>Log set {done.length + 1}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
          <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
          <Pressable onPress={logSet} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 22, justifyContent: 'center' }}><Icon name="check" size={18} color={t.brandInk} /></Pressable>
        </View>

        {pendingFeel != null ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 20 }}>
            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>How did that set feel?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(([['easy', 'Easy', t.good], ['ok', 'Just right', t.brand], ['hard', 'Hard', t.crit]]) as ['easy' | 'ok' | 'hard', string, string][]).map(([f, lbl, c]) => (
                <Pressable key={f} onPress={() => chooseFeel(f)} style={{ flex: 1, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 11, paddingVertical: 12, alignItems: 'center' }}>
                  <Text style={{ color: c, fontWeight: '800', fontSize: 14 }}>{lbl}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 8 }}>Tunes your next set — Easy adds weight, Hard eases it back.</Text>
          </View>
        ) : null}

        <Pressable onPress={next} style={{ backgroundColor: done.length >= ex.sets ? t.brand : t.surface2, borderWidth: 1, borderColor: done.length >= ex.sets ? t.brand : t.ring, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
          <Text style={{ color: done.length >= ex.sets ? t.brandInk : t.ink, fontWeight: '800', fontSize: 15 }}>{idx < exercises.length - 1 ? 'Next exercise →' : 'Finish session'}</Text>
        </Pressable>
      </ScrollView>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}
