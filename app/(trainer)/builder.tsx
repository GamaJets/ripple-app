// Trainer · Program Builder. Pick a client, compose a weekly program (days →
// exercises with sets/reps) starting from their auto plan or blank, then assign
// it. The assigned program flows straight to that client's Train tab, replacing
// the auto-generated one. Revert puts them back on auto.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same providers, state, handlers, routes and modals —
// only the presentation changed: the Georgia serif header and the stack of
// bordered boxes (one per day, one per exercise) became a header block plus
// hairline-separated sections, and every form field now shares one treatment
// (surface2 fill, radius.sm, ty.body, no border). No <Hero>: a builder has no
// single live metric to lead with — the day/exercise counts sit in the section
// head where they belong.
//
// Also removed: the note prefill on the auto plan. `buildProgram()` writes prose
// that cites "your latest InBody scan (25% body fat)" — the 25 is a constant
// this screen passes because the roster carries no body-fat reading, so that
// sentence was an invented scan result being typed into the coach's note to
// their client and shipped with the assigned program. The note now starts empty
// unless a human wrote one. (The exercise library below is kept: it is a
// vocabulary of movement names, not invented client content.)
import { useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
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

/** Prose written by the program generator, which cites a body-fat reading this
 *  screen does not have. Never prefilled into the coach's note to a client. */
const GENERATED_NOTE = /latest InBody scan/i;

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
    setNote(p.note && !GENERATED_NOTE.test(p.note) ? p.note : '');
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

  // One field treatment for the whole screen: surface2 fill, no border.
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 };
  const scrim = { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' };
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Programs</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program builder</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Build a weekly plan and assign it to a client.</Text>
        </View>

        {/* ── client ─────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Client" note={roster.length ? `${roster.length} in roster` : undefined} />
          {roster.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No clients yet — add a client from your dashboard and they'll appear here to build for.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingRight: sp.lg }}>
              {roster.map((c) => {
                const on = c.id === clientId;
                return (
                  <Pressable key={c.id} onPress={() => setClientId(c.id)}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: on ? t.brandInk : t.ink2 }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: assignedNow ? t.brand : t.ink3 }} />
            <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
              {assignedNow ? 'Currently on a coach-assigned program' : 'Currently on their auto-generated program'} · goal: {client?.goal ?? '—'}
            </Text>
          </View>
        </Section>

        <Rule />

        {/* ── templates ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Templates" note="Save as template" onPress={() => { setTplName(title); setSaveOpen(true); }} />
          <Ghost label="Start from a template" icon="grid" onPress={() => setTplPick(true)} />
        </Section>

        <Rule />

        {/* ── the program itself ─────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Program" />
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Program name</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Push · Pull · Legs" placeholderTextColor={t.ink3}
            style={[inp, { marginBottom: sp.lg }]} />
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Note to client (optional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Focus, tempo, anything they should know…" placeholderTextColor={t.ink3}
            multiline style={[inp, { minHeight: 72, textAlignVertical: 'top' }]} />
        </Section>

        <Rule />

        {/* ── days ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Training days"
            note={days.length ? `${days.length} day${days.length === 1 ? '' : 's'} · ${totalExercises} exercises` : undefined} />

          {days.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              No training days yet — add one to start building.
            </Text>
          ) : null}

          {days.map((d, di) => (
            <View key={di} style={{
              marginTop: di === 0 ? 0 : sp.xl, paddingTop: di === 0 ? 0 : sp.xl,
              borderTopWidth: di === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Pressable onPress={() => cycleDay(di)} accessibilityRole="button" accessibilityLabel={`Change day, currently ${d.day}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>{d.day}</Text>
                  <Icon name="swap" size={13} color={t.ink3} />
                </Pressable>
                <TextInput value={d.focus} onChangeText={(v) => setDayFocus(di, v)} placeholder="Focus (e.g. Push)" placeholderTextColor={t.ink3}
                  style={[inp, { flex: 1 }]} />
                <Pressable onPress={() => removeDay(di)} accessibilityRole="button" accessibilityLabel="Remove day" hitSlop={8}
                  style={{ paddingHorizontal: sp.sm, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                </Pressable>
              </View>

              {d.exercises.map((e) => (
                <View key={e.key} style={{ marginTop: sp.md, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.name}</Text>
                      {e.group ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{e.group}</Text> : null}
                    </View>
                    <Pressable onPress={() => removeExercise(di, e.key)} accessibilityRole="button" accessibilityLabel="Remove exercise" hitSlop={8}
                      style={{ paddingHorizontal: sp.sm, paddingVertical: sp.xs }}>
                      <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>Sets</Text>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.max(1, e.sets - 1) })} accessibilityRole="button" accessibilityLabel="One set fewer"
                      style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="minus" size={14} color={t.ink2} />
                    </Pressable>
                    <Text style={{ ...value(16), color: t.ink, minWidth: 16, textAlign: 'center' }}>{e.sets}</Text>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.min(8, e.sets + 1) })} accessibilityRole="button" accessibilityLabel="One set more"
                      style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={14} color={t.ink2} />
                    </Pressable>
                    <Text style={{ ...ty.caption, color: t.ink3, marginLeft: sp.sm }}>Reps</Text>
                    <TextInput value={e.reps} onChangeText={(v) => patchEx(di, e.key, { reps: v })} placeholder="8-10" placeholderTextColor={t.ink3}
                      style={[inp, { width: 74, paddingVertical: 7, paddingHorizontal: 10 }]} />
                  </View>
                </View>
              ))}

              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Add exercise" icon="plus" onPress={() => { setCustom(''); setPickerDay(di); }} />
              </View>
            </View>
          ))}

          <View style={{ marginTop: days.length ? sp.xl : 0 }}>
            <Ghost label="Add training day" icon="calendar" onPress={addDay} />
          </View>
        </Section>

        <Rule />

        {/* ── assign ─────────────────────────────────────────────────────── */}
        <Section>
          <View style={{ opacity: canAssign ? 1 : 0.4 }} pointerEvents={canAssign ? 'auto' : 'none'}>
            <Cta wide label={`Assign to ${client?.name ?? 'client'} · ${totalExercises} exercises`} onPress={assign} />
          </View>
          {!canAssign ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
              {clientId ? 'Add at least one exercise to assign this program.' : 'Pick a client first.'}
            </Text>
          ) : null}
          {assignedNow ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost label="Revert to auto-generated program" onPress={revert} />
            </View>
          ) : null}
        </Section>

      </ScrollView>

      {/* ── exercise picker ──────────────────────────────────────────────── */}
      <Modal visible={pickerDay !== null} transparent animationType="slide" onRequestClose={() => setPickerDay(null)}>
        <Pressable style={scrim} onPress={() => setPickerDay(null)} />
        <View style={[sheet, { maxHeight: '82%' }]}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Add exercise</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.lg }}>
            <TextInput value={custom} onChangeText={setCustom} placeholder="Custom exercise name" placeholderTextColor={t.ink3}
              style={[inp, { flex: 1 }]} />
            <Cta label="Add" onPress={() => { if (custom.trim() && pickerDay !== null) { addExercise(pickerDay, custom.trim(), ''); setPickerDay(null); } }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {LIB.map((x, i) => (
              <Pressable key={x.name} onPress={() => { if (pickerDay !== null) { addExercise(pickerDay, x.name, x.group); setPickerDay(null); } }}
                style={{
                  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md,
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{x.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3 }}>{x.group}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── start-from-template picker ───────────────────────────────────── */}
      <Modal visible={tplPick} transparent animationType="slide" onRequestClose={() => setTplPick(false)}>
        <Pressable style={scrim} onPress={() => setTplPick(false)} />
        <View style={[sheet, { maxHeight: '80%' }]}>
          <Text style={{ ...ty.title, color: t.ink }}>Start from a template</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            Loads into the builder for {client?.name ?? 'this client'} — tweak, then assign.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {templates.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>No templates saved yet.</Text>
            ) : null}
            {templates.map((tpl, i) => {
              const dc = tpl.program.days.length;
              const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <Pressable key={tpl.id} onPress={() => { loadFrom(tpl.program); setTplName(tpl.name); setTplPick(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                    borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                  }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="grid" size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dc} days · {ec} exercises</Text>
                  </View>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Use</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Manage all templates" onPress={() => { setTplPick(false); router.push('/(trainer)/templates'); }} />
          </View>
        </View>
      </Modal>

      {/* ── save-as-template ─────────────────────────────────────────────── */}
      <Modal visible={saveOpen} transparent animationType="slide" onRequestClose={() => setSaveOpen(false)}>
        <Pressable style={scrim} onPress={() => setSaveOpen(false)} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Save as template</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            Reuse this program with other clients — {totalExercises} exercises across {days.filter((d) => d.exercises.length).length} days.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Template name</Text>
          <TextInput value={tplName} onChangeText={setTplName} placeholder="e.g. Push · Pull · Legs" placeholderTextColor={t.ink3}
            style={[inp, { marginBottom: sp.xl }]} />
          <Cta label="Save template" wide onPress={doSaveTemplate} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setSaveOpen(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
