// Trainer · Program Builder. Pick a client, compose a weekly program (days →
// exercises with sets/reps) starting from their auto plan or blank, then assign
// it. The assigned program flows straight to that client's Train tab, replacing
// the auto-generated one. Revert puts them back on auto.
import { useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import type { Theme } from '../../src/theme/tokens';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { buildProgram, type Program } from '../../src/lib/programs';
import type { Goal } from '../../src/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LIB: { name: string; group: string }[] = [
  { name: 'Back Squat', group: 'Legs' }, { name: 'Front Squat', group: 'Legs' }, { name: 'Leg Press', group: 'Legs' },
  { name: 'Romanian Deadlift', group: 'Hamstrings' }, { name: 'Deadlift', group: 'Back' }, { name: 'Hip Thrust', group: 'Glutes' },
  { name: 'Walking Lunge', group: 'Legs' }, { name: 'Bulgarian Split Squat', group: 'Legs' }, { name: 'Bench Press', group: 'Chest' },
  { name: 'Incline Dumbbell Press', group: 'Chest' }, { name: 'Push-up', group: 'Chest' }, { name: 'Overhead Press', group: 'Shoulders' },
  { name: 'Lateral Raise', group: 'Shoulders' }, { name: 'Face Pull', group: 'Shoulders' }, { name: 'Pull-up', group: 'Back' },
  { name: 'Lat Pulldown', group: 'Back' }, { name: 'Bent-over Row', group: 'Back' }, { name: 'Seated Row', group: 'Back' },
  { name: 'Barbell Curl', group: 'Arms' }, { name: 'Triceps Pushdown', group: 'Arms' }, { name: 'Plank', group: 'Core' },
  { name: 'Cable Crunch', group: 'Core' }, { name: 'Calf Raise', group: 'Calves' },
];

let KEY = 1;
const nextKey = () => 'e' + KEY++;

type BEx = { key: string; name: string; group: string; sets: number; reps: string };
type BDay = { day: string; focus: string; cardio?: string; exercises: BEx[] };

function goalToEnum(g: string): Goal {
  const s = (g || '').toLowerCase();
  if (s.includes('muscle')) return 'muscle';
  if (s.includes('tone')) return 'tone';
  return 'fatloss';
}

export default function Builder() {
  const t = useTheme();
  const { roster } = useRoster();
  const { getProgram, assignProgram, clearProgram } = useAssignedPrograms();
  const { templates, saveTemplate } = useProgramTemplates();
  const router = useRouter();

  const params = useLocalSearchParams();
  const [clientId, setClientId] = useState((params.clientId as string) || roster[0]?.id || '');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<BDay[]>([]);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [tplPick, setTplPick] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tplName, setTplName] = useState('');

  const client = roster.find((c) => c.id === clientId);
  const assignedNow = !!getProgram(clientId);

  const loadFrom = (p: Program) => {
    setTitle(p.title);
    setNote(p.note ?? '');
    setDays(p.days.map((d) => ({
      day: d.day, focus: d.focus, cardio: d.cardio,
      exercises: d.exercises.map((e) => ({ key: nextKey(), name: e.name, group: e.group, sets: e.sets, reps: e.reps })),
    })));
  };

  // Load the client's current program (assigned if any, else their auto plan)
  // whenever the selected client changes.
  useEffect(() => {
    if (!clientId) return;
    const existing = getProgram(clientId);
    if (existing) loadFrom(existing);
    else loadFrom(buildProgram(goalToEnum(client?.goal ?? ''), 25));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // If opened from the template library with a templateId, load it once.
  const loadedTplRef = useRef<string | null>(null);
  useEffect(() => {
    const tid = params.templateId as string;
    if (!tid || loadedTplRef.current === tid) return;
    const tpl = templates.find((x) => x.id === tid);
    if (tpl) { loadedTplRef.current = tid; loadFrom(tpl.program); setTplName(tpl.name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.templateId, templates.length]);

  const setDayFocus = (di: number, focus: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, focus } : d)));
  const addExercise = (di: number, name: string, group: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: [...d.exercises, { key: nextKey(), name, group, sets: 3, reps: '10-12' }] } : d)));
  const removeExercise = (di: number, key: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: d.exercises.filter((e) => e.key !== key) } : d)));
  const patchEx = (di: number, key: string, patch: Partial<BEx>) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: d.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) } : d)));
  const addDay = () => setDays((ds) => {
    const used = new Set(ds.map((d) => d.day));
    const free = DAYS.find((d) => !used.has(d)) ?? 'Mon';
    return [...ds, { day: free, focus: 'Training', exercises: [] }];
  });
  const cycleDay = (di: number) => setDays((ds) => ds.map((d, i) => {
    if (i !== di) return d;
    const idx = DAYS.indexOf(d.day);
    return { ...d, day: DAYS[(idx + 1) % 7] };
  }));
  const removeDay = (di: number) => setDays((ds) => ds.filter((_, i) => i !== di));

  const totalExercises = days.reduce((a, d) => a + d.exercises.length, 0);
  const canAssign = !!clientId && totalExercises > 0;

  const composeProgram = (): Program => ({
    title: title.trim() || 'Custom program',
    focus: ['Coach-assigned', 'Personalised for you'],
    note: note.trim() || 'Your coach built this program for you. Progress the weight when you hit the top of the rep range.',
    days: days.filter((d) => d.exercises.length).map((d) => ({
      day: d.day, focus: d.focus.trim() || 'Training', cardio: d.cardio,
      exercises: d.exercises.map((e, i) => ({ key: d.day + '-' + i, name: e.name, group: e.group || '', sets: e.sets, reps: e.reps || '8-12', alternatives: [] })),
    })),
  });
  const doSaveTemplate = () => {
    if (totalExercises === 0) { Alert.alert('Nothing to save', 'Add at least one exercise first.'); return; }
    saveTemplate(tplName.trim() || title.trim() || 'Untitled template', composeProgram());
    setSaveOpen(false); setTplName('');
    Alert.alert('Template saved', 'It is in your Program Templates — assign it to as many clients as you like.');
  };
  const assign = () => {
    if (!canAssign) return;
    const program: Program = {
      title: title.trim() || 'Custom program',
      focus: ['Coach-assigned', 'Personalised for you'],
      note: note.trim() || 'Your coach built this program for you. Progress the weight when you hit the top of the rep range.',
      days: days.filter((d) => d.exercises.length).map((d) => ({
        day: d.day, focus: d.focus.trim() || 'Training', cardio: d.cardio,
        exercises: d.exercises.map((e, i) => ({ key: `${d.day}-${i}`, name: e.name, group: e.group || '', sets: e.sets, reps: e.reps || '8-12', alternatives: [] })),
      })),
    };
    assignProgram(clientId, program);
    Alert.alert('Program assigned', `${client?.name ?? 'Your client'} will now see this in their Train tab.`, [{ text: 'Done' }]);
  };

  const revert = () => {
    clearProgram(clientId);
    loadFrom(buildProgram(goalToEnum(client?.goal ?? ''), 25));
    Alert.alert('Reverted to auto', `${client?.name ?? 'Your client'} is back on their auto-generated program.`);
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Program builder</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14 }}>Build a weekly plan and assign it to a client</Text>

        {/* Client picker */}
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Client</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 6 }}>
          {roster.map((c) => {
            const on = c.id === clientId;
            return (
              <Pressable key={c.id} onPress={() => setClientId(c.id)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{c.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ backgroundColor: t.surface2, borderRadius: 10, borderWidth: 1, borderColor: t.ring, padding: 10, marginTop: 8, marginBottom: 16 }}>
          <Text style={{ color: t.ink3, fontSize: 12 }}>{assignedNow ? 'Currently on a coach-assigned program' : 'Currently on their auto-generated program'} · goal: {client?.goal ?? '—'}</Text>
        </View>

        {/* Template actions */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <Pressable onPress={() => setTplPick(true)} style={{ flex: 1, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            <Icon name="grid" size={15} color={t.ink2} />
            <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>Start from template</Text>
          </Pressable>
          <Pressable onPress={() => { setTplName(title); setSaveOpen(true); }} style={{ flex: 1, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={15} color={t.brand} />
            <Text style={{ color: t.brand, fontWeight: '700', fontSize: 13 }}>Save as template</Text>
          </Pressable>
        </View>

        {/* Program title + note */}
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Program name</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Push · Pull · Legs" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 12 }]} />
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Note to client (optional)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="Focus, tempo, anything they should know…" placeholderTextColor={t.ink3} multiline style={[inp, { marginBottom: 18, minHeight: 60, textAlignVertical: 'top' }]} />

        {/* Days */}
        {days.map((d, di) => (
          <View key={di} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Pressable onPress={() => cycleDay(di)} style={{ backgroundColor: t.brand, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>{d.day} ⟳</Text>
              </Pressable>
              <TextInput value={d.focus} onChangeText={(v) => setDayFocus(di, v)} placeholder="Focus (e.g. Push)" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
              <Pressable onPress={() => removeDay(di)} accessibilityLabel="Remove day" style={{ paddingHorizontal: 8, paddingVertical: 8 }}>
                <Text style={{ color: t.crit, fontWeight: '800', fontSize: 16 }}>×</Text>
              </Pressable>
            </View>

            {d.exercises.map((e) => (
              <View key={e.key} style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 11, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{e.name}</Text>
                    {e.group ? <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>{e.group}</Text> : null}
                  </View>
                  <Pressable onPress={() => removeExercise(di, e.key)} accessibilityLabel="Remove exercise" style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: t.ink3, fontWeight: '800', fontSize: 15 }}>×</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <Text style={{ color: t.ink3, fontSize: 12 }}>Sets</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.max(1, e.sets - 1) })} style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.ink, fontWeight: '800' }}>−</Text></Pressable>
                    <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, minWidth: 18, textAlign: 'center' }}>{e.sets}</Text>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.min(8, e.sets + 1) })} style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.ink, fontWeight: '800' }}>＋</Text></Pressable>
                  </View>
                  <Text style={{ color: t.ink3, fontSize: 12, marginLeft: 4 }}>Reps</Text>
                  <TextInput value={e.reps} onChangeText={(v) => patchEx(di, e.key, { reps: v })} placeholder="8-10" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, width: 76 }} />
                </View>
              </View>
            ))}

            <Pressable onPress={() => { setCustom(''); setPickerDay(di); }} style={{ borderRadius: 10, borderWidth: 1, borderColor: t.brand, borderStyle: 'dashed', paddingVertical: 10, alignItems: 'center', marginTop: 2 }}>
              <Text style={{ color: t.brand, fontWeight: '700', fontSize: 13 }}>＋ Add exercise</Text>
            </Pressable>
          </View>
        ))}

        <Pressable onPress={addDay} style={{ borderRadius: 12, borderWidth: 1, borderColor: t.ring, paddingVertical: 12, alignItems: 'center', marginBottom: 18, backgroundColor: t.surface }}>
          <Text style={{ color: t.ink2, fontWeight: '700', fontSize: 14 }}>＋ Add training day</Text>
        </Pressable>

        <Pressable onPress={assign} disabled={!canAssign} style={{ backgroundColor: canAssign ? t.brand : t.surface2, borderColor: canAssign ? t.brand : t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: canAssign ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 15 }}>Assign to {client?.name ?? 'client'} · {totalExercises} exercises</Text>
        </Pressable>
        {assignedNow ? (
          <Pressable onPress={revert} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
            <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Revert to auto-generated program</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Exercise picker */}
      <Modal visible={pickerDay !== null} transparent animationType="slide" onRequestClose={() => setPickerDay(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPickerDay(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '82%' }}>
          <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Add exercise</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <TextInput value={custom} onChangeText={setCustom} placeholder="Custom exercise name" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
            <Pressable onPress={() => { if (custom.trim() && pickerDay !== null) { addExercise(pickerDay, custom.trim(), ''); setPickerDay(null); } }} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Add</Text></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {LIB.map((x) => (
              <Pressable key={x.name} onPress={() => { if (pickerDay !== null) { addExercise(pickerDay, x.name, x.group); setPickerDay(null); } }} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                <Text style={{ color: t.ink, fontWeight: '600', fontSize: 15 }}>{x.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12 }}>{x.group}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Start-from-template picker */}
      <Modal visible={tplPick} transparent animationType="slide" onRequestClose={() => setTplPick(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setTplPick(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30, maxHeight: '80%' }}>
          <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>Start from a template</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Loads into the builder for {client?.name ?? 'this client'} — tweak, then assign.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {templates.map((tpl) => {
              const dc = tpl.program.days.length;
              const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <Pressable key={tpl.id} onPress={() => { loadFrom(tpl.program); setTplName(tpl.name); setTplPick(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="grid" size={18} color={t.brand} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{tpl.name}</Text>
                    <Text style={{ color: t.ink3, fontSize: 12 }}>{dc} days · {ec} exercises</Text>
                  </View>
                  <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>Use</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={() => { setTplPick(false); router.push('/(trainer)/templates'); }} style={{ paddingVertical: 12, alignItems: 'center', marginTop: 4 }}>
            <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Manage all templates ›</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Save-as-template */}
      <Modal visible={saveOpen} transparent animationType="slide" onRequestClose={() => setSaveOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSaveOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>Save as template</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Reuse this program with other clients — {totalExercises} exercises across {days.filter((d) => d.exercises.length).length} days.</Text>
          <TextInput value={tplName} onChangeText={setTplName} placeholder="Template name — e.g. Push · Pull · Legs" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 14 }]} />
          <Pressable onPress={doSaveTemplate} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Save template</Text>
          </Pressable>
          <Pressable onPress={() => setSaveOpen(false)} style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
