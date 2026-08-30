// Trainer · Log the session you just ran, into your client's own record.
//
// A coach standing next to somebody through an hour of squats had nowhere to
// put it. `workouts` only ever accepted writes from the person they belonged
// to, so an in-person session existed in the coach's memory and in neither
// app. 53-coach-logged-workouts.sql opened an insert for a coach's own client,
// attributed with `logged_by`; this is the screen that uses it.
//
// What lands is the same shape the client's own log writes, so their progress,
// PRs, calories, streak and weekly report count it without caring who typed it.
//
// Two things this screen refuses to do:
//
//   · say "logged" when it is not. `logForClient` reports the write rather than
//     returning a boolean, and a failure names what happened and states plainly
//     that nothing was saved — including the one cause a coach can act on,
//     which is the person not being on their roster.
//   · invent a calorie figure. Strength work records reps and weight, not
//     energy, and the client's own screens render an absent burn as a dash.
//     Guessing here would put a fabricated number into somebody else's history.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { readLift, type WeightUnit } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Flag } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { useCoachExercises, mergeExerciseLists } from '../../src/ui/coachExercises';
import { logForClient } from '../../src/lib/coachLog';
import { notifySuccess } from '../../src/ui/haptics';
import type { WorkoutEntry } from '../../src/lib/mockData';

/** The same starter list the program builder offers. */
const LIB = [
  { name: 'Back Squat', group: 'Legs' }, { name: 'Front Squat', group: 'Legs' },
  { name: 'Romanian Deadlift', group: 'Hamstrings' }, { name: 'Deadlift', group: 'Back' },
  { name: 'Hip Thrust', group: 'Glutes' }, { name: 'Walking Lunge', group: 'Legs' },
  { name: 'Bulgarian Split Squat', group: 'Legs' }, { name: 'Bench Press', group: 'Chest' },
  { name: 'Incline Dumbbell Press', group: 'Chest' }, { name: 'Push-up', group: 'Chest' },
  { name: 'Overhead Press', group: 'Shoulders' }, { name: 'Lateral Raise', group: 'Shoulders' },
  { name: 'Pull-up', group: 'Back' }, { name: 'Barbell Row', group: 'Back' },
  { name: 'Lat Pulldown', group: 'Back' }, { name: 'Plank', group: 'Core' },
];

interface Row { key: string; name: string; sets: { reps: string; kg: string }[] }

let SEQ = 0;
const mkKey = () => `ex-${SEQ++}`;

export default function LogSession() {
  const t = useTheme();
  const router = useRouter();
  // The unit the COACH reads in. The field was hardcoded "kg", so a coach
  // thinking in pounds typed 135 and wrote 135 kg into a client's history.
  const wu: WeightUnit = useSettings().weightUnit;
  const auth = useAuth();
  const { clientId, name } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const coachEx = useCoachExercises();

  const [rows, setRows] = useState<Row[]>([]);
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const first = (name || 'your client').split(' ')[0];
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 };
  const G = layout.gutter;

  const addExercise = (n: string) => {
    setRows((p) => [...p, { key: mkKey(), name: n, sets: [{ reps: '', kg: '' }] }]);
    setPicker(false);
    setCustom('');
  };
  const addSet = (key: string) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, sets: [...r.sets, { reps: '', kg: '' }] } : r)));
  const patchSet = (key: string, i: number, patch: Partial<{ reps: string; kg: string }>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, sets: r.sets.map((s, x) => (x === i ? { ...s, ...patch } : s)) } : r)));
  const removeRow = (key: string) => setRows((p) => p.filter((r) => r.key !== key));

  // Only sets with a rep count are real. A blank row the coach tabbed past is
  // not a set of zero reps, and writing it as one would put a lie in the log.
  //
  // The same reasoning applies to the LOAD, and it had not been applied.
  // `parseFloat(s.kg) || 0` turned anything unreadable into zero — a letter O
  // typed for a nought, a comma decimal, a stray space — and zero here is not
  // an absence, it is a bodyweight set written into somebody ELSE's history.
  // It drags down their volume, their estimated 1RM and the next target built
  // from it, and the person it happened to has no way of knowing.
  //
  // readLift refuses instead of coercing, and converts from whatever unit the
  // coach reads in. `loadProblem` below surfaces the refusal rather than
  // letting a bad figure through quietly.
  const entriesToWrite = (): WorkoutEntry[] => {
    const at = new Date().toISOString();
    return rows
      .map((r) => {
        const pairs = r.sets
          .filter((s) => (parseInt(s.reps, 10) || 0) > 0)
          .map((s) => {
            const load = readLift(s.kg, wu);
            // A refused load is not written as a number at all. `ready` below
            // withholds the save while any refusal stands, so this only ever
            // runs on figures that read.
            return [parseInt(s.reps, 10) || 0, load.ok && load.kg != null ? load.kg : 0] as [number, number];
          });
        return pairs.length ? { t: at, exercise: r.name, sets: pairs } : null;
      })
      .filter(Boolean) as WorkoutEntry[];
  };

  /** The first unreadable load on the sheet, addressed to the coach. Null when
   *  every figure reads — including the empty ones, which are bodyweight sets
   *  and always legitimate. */
  const loadProblem = (): string | null => {
    for (const r of rows) {
      for (const st of r.sets) {
        if ((parseInt(st.reps, 10) || 0) <= 0) continue;
        const load = readLift(st.kg, wu);
        if (!load.ok) return `${r.name}: ${load.reason}`;
      }
    }
    return null;
  };

  // Withheld while any load is unreadable. Saving a session with one bad
  // figure silently zeroed is the failure above; refusing the save is the
  // only honest alternative, because this is a write to a client's record
  // with no undo and no notification to them.
  const ready = entriesToWrite().length > 0 && loadProblem() == null;

  const save = async () => {
    const entries = entriesToWrite();
    if (!entries.length) {
      Alert.alert('Nothing to log', 'Add at least one set with a rep count.');
      return;
    }
    if (!clientId) {
      setFailure('This screen was opened without a client, so there is nobody to log against.');
      return;
    }
    const coachId = auth.user?.id;
    if (!coachId) {
      // A session still being restored is not a signed-out coach, and telling
      // somebody they are signed out sends them to sign in again and lose the
      // sets they have just typed. `auth.loading` is the difference between the
      // two, and this screen used to fold them into one sentence.
      setFailure(auth.loading
        ? 'Still checking your sign-in — nothing has been saved yet. Try again in a moment.'
        : 'You are not signed in, so this cannot reach your client.');
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await logForClient(clientId, coachId, entries);
    setBusy(false);
    if (!res.ok) { setFailure(res.reason); return; }
    notifySuccess();
    Alert.alert(
      'Session logged',
      `${res.written} exercise${res.written === 1 ? '' : 's'} added to ${first}'s record. They will see it on their own phone, marked as logged by you, and it counts towards their progress.`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg }}>
            <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={18} color={t.ink} />
            </Pressable>
            <View>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Log a session</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{name || 'Client'}</Text>
            </View>
          </View>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            Goes into {first}&rsquo;s own record, marked as logged by you.
          </Text>

          <Rule />

          {failure ? (
            <View style={{ marginBottom: sp.lg }}>
              <Flag tone={t.crit}>{failure}</Flag>
            </View>
          ) : null}

          <Section>
            <SectionHead title="Exercises" note={rows.length ? `${rows.length}` : undefined} />
            {rows.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Nothing added yet. Add what {first} actually did — only sets with a rep count are saved.
              </Text>
            ) : null}

            {rows.map((r) => (
              <View key={r.key} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{r.name}</Text>
                  <Pressable onPress={() => removeRow(r.key)} hitSlop={8} accessibilityRole="button"
                    accessibilityLabel={`Remove ${r.name}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>Remove</Text>
                  </Pressable>
                </View>

                {r.sets.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center' }}>
                    <Text style={{ ...ty.caption, color: t.ink3, width: 46 }}>Set {i + 1}</Text>
                    <TextInput value={s.reps} onChangeText={(v) => patchSet(r.key, i, { reps: v })}
                      keyboardType="numeric" placeholder="Reps" placeholderTextColor={t.ink3}
                      accessibilityLabel={`${r.name} set ${i + 1} reps`} style={[inp, { flex: 1 }]} />
                    <TextInput value={s.kg} onChangeText={(v) => patchSet(r.key, i, { kg: v })}
                      keyboardType="numeric" placeholder={wu} placeholderTextColor={t.ink3}
                      accessibilityLabel={`${r.name} set ${i + 1} weight`} style={[inp, { flex: 1 }]} />
                  </View>
                ))}
                <Pressable onPress={() => addSet(r.key)} hitSlop={8} accessibilityRole="button"
                  style={{ paddingVertical: sp.sm, marginTop: 2 }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Add a set</Text>
                </Pressable>
              </View>
            ))}

            <View style={{ marginTop: sp.md }}>
              <Ghost label="Add Exercise" onPress={() => setPicker(true)} />
            </View>
          </Section>

          <View style={{ marginTop: sp.xl }}>
            <View style={{ opacity: ready && !busy ? 1 : 0.4 }} pointerEvents={ready && !busy ? 'auto' : 'none'}>
              <Cta wide label={busy ? 'Saving…' : `Log to ${first}'s record`} onPress={save} />
            </View>
            {/* Two different reasons the button is held, and they need
                different sentences. "Add a set" to somebody who added four and
                typed one load wrong sends them looking for the wrong thing. */}
            {!ready ? (
              <Text style={{ ...ty.caption, color: loadProblem() ? t.warn : t.ink3, textAlign: 'center', marginTop: sp.sm }}>
                {loadProblem() ?? 'Add at least one set with a rep count.'}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPicker(false)} />
          <View style={[sheet, { maxHeight: '82%' }]}>
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Add Exercise</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.lg }}>
              <TextInput value={custom} onChangeText={setCustom} placeholder="Custom exercise name"
                placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} accessibilityLabel="Custom exercise name" />
              <Cta label="Add" onPress={() => {
                const nm = custom.trim();
                if (!nm) return;
                addExercise(nm);
                // Remembered for next time, exactly as the program builder does.
                void coachEx.remember(nm);
              }} />
            </View>
            {coachEx.status === 'error' ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved exercises could not be read, so only the built-in ones are listed. That is not
                the same as having none saved.
              </Text>
            ) : coachEx.status === 'partial' ? (
              // 'partial' arrived with the row-cap work and this branch did not
              // exist for it, so a coach whose saved list came back short saw a
              // picker missing names with nothing to say why — and retyped one
              // they had already saved.
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved exercises came back short — there are more of them than are listed here.
              </Text>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {mergeExerciseLists(coachEx.saved, LIB).map((x, i) => (
                <Pressable key={x.name} onPress={() => addExercise(x.name)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{x.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{x.group}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
