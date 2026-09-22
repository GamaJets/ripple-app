// The coach's correction sheet, and the withdraw confirmation beside it.
//
// For a set the coach logged themselves and only that (`coachMayAmend`); the
// reasons, and what the database enforces, are in src/lib/coachAmend.ts. The
// figures are read by `readWorkoutEdit` in src/lib/entryEdit.ts, the member's
// own reader, so there is one idea of a valid correction and not two.
//
// Nothing here is drawn as done until the server returns the row. A refusal, a
// write that matched nothing and a write that never answered all keep the sheet
// open with what was typed, and say why.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTheme } from './components';
import { Field, Ghost } from './kit';
import { sp, radius, hairline, elevation, type as ty, font } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { WORKOUT_COLS, rowToEntry, type WorkoutRow } from '../lib/workoutRow';
import { liftIn, readLift, plain, type WeightUnit } from '../lib/units';
import { coachAmendment, writeOutcome, type CoachWrite } from '../lib/coachAmend';
import type { WorkoutDraftSet } from '../lib/entryEdit';
import type { WorkoutEntry } from '../lib/mockData';

/** Delete a row this coach logged. Resolves null when it is gone, or the
 *  sentence saying it is not. */
export async function withdrawEntry(entry: WorkoutEntry, coachId: string): Promise<string | null> {
  let res: CoachWrite;
  try {
    const { data, error } = await supabase.from('workouts').delete()
      .eq('id', entry.id!).eq('logged_by', coachId).select('id');
    if (error) reportError('coachAmend.withdraw', error);
    res = { rows: data?.length ?? 0, error };
  } catch (e) { reportError('coachAmend.withdraw', e); res = 'threw'; }
  return writeOutcome('withdraw', res);
}

/**
 * Ask before withdrawing, naming what goes: the movement, what was in it and
 * the day. It is a delete of a real training record and cannot be undone.
 */
export function confirmWithdraw(opts: {
  entry: WorkoutEntry; coachId: string; movement: string; detail: string | null; day: string | null;
  who: string; onGone: () => void;
}) {
  const { entry, coachId, movement, detail, day, who, onGone } = opts;
  const what = [movement, detail, day ? `logged on ${day}` : null].filter(Boolean).join(', ');
  Alert.alert('Withdraw This Entry?', `${what}. This removes it from ${who}'s training record for good. It cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Withdraw', style: 'destructive',
      onPress: async () => {
        const failed = await withdrawEntry(entry, coachId);
        if (failed) Alert.alert('Not Withdrawn', failed);
        else onGone();
      },
    },
  ]);
}

type Row = { reps: string; load: string; kg: number; shown: string; bw: boolean; timed: boolean };

export function CoachAmendSheet({ entry, coachId, unit, who, onClose, onSaved }: {
  entry: WorkoutEntry; coachId: string; unit: WeightUnit; who: string;
  onClose: () => void; onSaved: (next: WorkoutEntry) => void;
}) {
  const t = useTheme();
  const [name, setName] = useState(entry.exercise);
  // `kg` and `shown` are the stored load and how it first read. A load box left
  // as it was keeps the stored kilograms rather than a round trip through the
  // display unit, which in pounds would move an untouched set by a few grams
  // and stamp the record as changed when nobody changed it.
  const [rows, setRows] = useState<Row[]>(() => (entry.sets ?? []).map(([r, kg], i) => {
    const shown = kg ? plain(liftIn(kg, unit) ?? 0) : '';
    return { reps: r ? String(r) : '', load: shown, kg, shown, bw: entry.bw?.[i] === true, timed: entry.timed?.[i] === true };
  }));
  const [mins, setMins] = useState(entry.cardio ? String(entry.cardio.mins) : '');
  const [dist, setDist] = useState(entry.cardio ? String(entry.cardio.dist) : '');
  const [kcal, setKcal] = useState(entry.kcal != null ? String(entry.kcal) : '');
  const [busy, setBusy] = useState(false);

  const setAt = (i: number, key: 'reps' | 'load', v: string) =>
    setRows((p) => p.map((r, k) => (k === i ? { ...r, [key]: v } : r)));

  const save = async () => {
    if (busy) return;
    const sets: WorkoutDraftSet[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // An emptied box drops the set, as Remove does; a typo is refused rather
      // than read as a set of nothing.
      if (r.reps.trim() === '') continue;
      const reps = Number(r.reps.trim());
      if (!Number.isInteger(reps) || reps < 0) { Alert.alert(`Check Set ${i + 1}`, 'Reps or seconds must be a whole number.'); return; }
      let kg = r.kg;
      if (r.load !== r.shown) {
        const read = readLift(r.load, unit);
        if (!read.ok) { Alert.alert(`Check Set ${i + 1}`, read.reason); return; }
        kg = read.kg ?? 0;
      }
      sets.push({ reps, kg, bw: r.bw, timed: r.timed });
    }
    const watts = entry.cardio?.watts ? String(entry.cardio.watts) : '';
    const read = coachAmendment(entry, { name, sets, mins, dist, watts, kcal });
    if (!read.ok) { Alert.alert('Check That', read.reason); return; }
    if (read.value == null) { onClose(); return; }
    setBusy(true);
    let res: CoachWrite;
    let back: WorkoutRow | undefined;
    try {
      const { data, error } = await supabase.from('workouts').update(read.value)
        .eq('id', entry.id!).eq('logged_by', coachId).select(WORKOUT_COLS);
      if (error) reportError('coachAmend.update', error);
      back = (data as unknown as WorkoutRow[] | null)?.[0];
      res = { rows: data?.length ?? 0, error };
    } catch (e) { reportError('coachAmend.update', e); res = 'threw'; }
    setBusy(false);
    const failed = writeOutcome('amend', res);
    // Left open with everything typed: closing would throw the correction away
    // and look as though it had been taken.
    if (failed || !back) { Alert.alert('Not Saved', failed ?? 'The server did not return the corrected set.'); return; }
    onSaved(rowToEntry(back));
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, ...ty.body } as const;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '86%', ...elevation.e2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: sp.lg }}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button"><Text style={{ ...ty.body, ...font('500'), color: t.ink3 }}>Cancel</Text></Pressable>
            <Text style={{ ...ty.head, color: t.ink }}>Correct Entry</Text>
            <Pressable onPress={save} hitSlop={8} disabled={busy} accessibilityRole="button">
              <Text style={{ ...ty.body, ...font('600'), color: busy ? t.ink3 : t.brandText }}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              You logged this for {who}. Saving a correction marks it as changed after it was filed, and {who} will see that mark. It stays on the day it was logged.
            </Text>
            <Field label="Exercise">
              <TextInput value={name} onChangeText={setName} style={inp} placeholder="Exercise" placeholderTextColor={t.ink3} />
            </Field>

            {entry.cardio ? (
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xl }}>
                <Field label="Minutes">
                  <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" style={inp} />
                </Field>
                <Field label="Distance" hint={entry.cardio.unit || undefined}>
                  <TextInput value={dist} onChangeText={setDist} keyboardType="decimal-pad" style={inp} />
                </Field>
              </View>
            ) : (
              <View style={{ marginTop: sp.xl }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Sets · reps or seconds × {unit}</Text>
                {rows.map((r, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
                    <Text style={{ ...ty.caption, color: t.ink3, width: 22 }}>{i + 1}</Text>
                    <TextInput value={r.reps} onChangeText={(v) => setAt(i, 'reps', v)} keyboardType="numeric"
                      accessibilityLabel={r.timed ? `Set ${i + 1}, seconds held` : `Set ${i + 1}, reps`}
                      placeholder={r.timed ? 'Secs' : 'Reps'} placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                    <Text style={{ ...ty.caption, color: t.ink3 }}>×</Text>
                    <TextInput value={r.load} onChangeText={(v) => setAt(i, 'load', v)} keyboardType="decimal-pad"
                      accessibilityLabel={`Set ${i + 1}, ${r.bw ? 'load added on top of bodyweight' : 'load'} in ${unit}`}
                      placeholder={r.bw ? `+${unit}` : unit} placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${i + 1}`} hitSlop={8}
                      onPress={() => setRows((p) => p.filter((_, k) => k !== i))} style={{ padding: 4 }}>
                      <Text style={{ ...ty.caption, ...font('600'), color: t.ink2 }}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
                <Ghost label="Add Set" onPress={() => setRows((p) => {
                  const last = p[p.length - 1];
                  return [...p, { reps: '', load: last?.load ?? '', kg: last?.kg ?? 0, shown: last?.shown ?? '', bw: last?.bw ?? false, timed: last?.timed ?? false }];
                })} />
              </View>
            )}

            <Field label="Calories" hint="kcal · leave blank if unknown" style={{ marginTop: sp.xl }}>
              <TextInput value={kcal} onChangeText={setKcal} keyboardType="numeric" style={inp} />
            </Field>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
