// One set, typed and logged — the row, and the only one.
//
// ── Why it left app/(client)/workouts.tsx ──────────────────────────────────
//
// It was a local component on the plan screen, so it was reachable from exactly
// one place: expand a row on Train, type into the two boxes. The exercise
// screen — the one a member opens while standing in front of the machine, from
// the library, from a demo, from a search — could not log anything at all, and
// neither could anything else that might want to.
//
// It is also the second copy of a set of guards that has already drifted once.
// The guided runner has its own keyboard with its own reps check and its own
// load check, each carrying a comment saying it mirrors this one word for word.
// Two is survivable while they are both correct and both stay in the same file;
// three, in three files, is how the app comes to refuse a hold on one screen
// and accept it on another.
//
// ── What it records, and the three things a first number can mean ──────────
//
// A set is stored as `[reps, kg]`, and TWO flags change what those numbers
// mean. Both are testimony — the person said so — and neither is inferred:
//
//   bw     the load is the person. `kg` is then what was ADDED to them: 0 for
//          a plain pull-up, 20 for one with a belt. See src/lib/bodyweightSets.
//   timed  the set was HELD rather than repeated. The first number is then
//          SECONDS. See src/lib/timedSets.
//
// The second of those is the one this row exists to make possible. The app
// prescribes `'45 sec'` planks in its own programme builder and the isometric
// set method's blurb says "the reps column is seconds", and until now both log
// paths refused anything that was not a positive whole number of reps. What
// people typed instead was 45 into a reps box, which reads for ever after as
// forty-five plank repetitions — counted in the rep totals, eligible for a rep
// record, indistinguishable from the real thing.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Alert } from 'react-native';
import { Icon } from './Icon';
import { Field } from './kit';
import { WeightUnitToggle } from './WeightUnitToggle';
import { sp, radius, hairline, type as ty } from '../theme/scale';
import type { Theme } from '../theme/tokens';
import { readLift, type WeightUnit } from '../lib/units';
import { readHold } from '../lib/timedSets';
import { hitSlopFor } from '../lib/a11y';

/** What one logged set says. `value` is reps, or SECONDS when `timed`. */
export interface LoggedSet {
  value: number;
  /** Kilograms. Null when the box was empty, which IS a bodyweight set. On a
   *  bodyweight set this is what was added on top of the person. */
  kg: number | null;
  bw: boolean;
  timed: boolean;
}

/**
 * The row.
 *
 * `timedDefault` is the movement's own prescription, read by
 * `isTimedPrescription`: a plank written as '45 sec' opens with the hold box
 * rather than the reps box, because asking somebody to switch a toggle before
 * they can record the set the app asked them for is the same refusal with an
 * extra tap in front of it. It is a DEFAULT and not a lock — a member who
 * counted plank repetitions for their own reasons can say so.
 */
export function LogSetRow({ t, unit, timedDefault = false, onLog }: {
  t: Theme;
  unit: WeightUnit;
  timedDefault?: boolean;
  onLog: (set: LoggedSet) => void;
}) {
  const [first, setFirst] = useState('');
  const [kg, setKg] = useState('');
  const [bwOn, setBwOn] = useState(false);
  const [timedOn, setTimedOn] = useState(timedDefault);
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, flex: 1, ...ty.body } as const;
  return (
    <View style={{ marginTop: sp.md }}>
      <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
        <Field label={timedOn ? 'Hold' : 'Reps'} hint={timedOn ? 'seconds' : undefined}
          a11y={timedOn ? 'How long you held it, in seconds' : 'How many reps you did'}>
          <TextInput value={first} onChangeText={setFirst} keyboardType="numeric" style={inp} />
        </Field>
        {/* The unit is switchable here, not only in Settings. Somebody who thinks
            in kilos should not have to leave a live session to say so — see
            src/ui/WeightUnitToggle.tsx for why it moves the account setting
            rather than just this box. */}
        <Field label={bwOn ? 'Added' : 'Load'} accessory={<WeightUnitToggle />} a11y={bwOn ? (unit === 'kg' ? 'Added load in kilograms, on top of your bodyweight' : 'Added load in pounds, on top of your bodyweight') : (unit === 'kg' ? 'Load in kilograms' : 'Load in pounds')}>
          <TextInput value={kg} onChangeText={setKg} keyboardType="decimal-pad" style={inp} />
        </Field>
        <Pressable accessibilityRole="button" accessibilityLabel="Log set" onPress={() => {
          // The first box is checked HERE and said out loud. This guarded with a
          // bare `if (!reps) return`, so tapping the button with an empty box —
          // which is what happens when somebody types the load first and then
          // reaches for it — did nothing at all: no set, no haptic, no reason.
          let value: number;
          if (timedOn) {
            const held = readHold(first);
            if (!held.ok) { Alert.alert('How long was the hold?', held.reason); return; }
            value = held.secs;
          } else {
            const r = parseInt(first, 10);
            if (!Number.isFinite(r) || r <= 0) { Alert.alert('How many reps?', `Type the reps you did before logging the set. The ${unit} box can stay empty for a bodyweight set.`); return; }
            value = r;
          }
          const read = readLift(kg, unit);
          // Left in the box on a refusal, with the reason said, rather than
          // cleared — the number was typed once and the app has no better guess.
          if (!read.ok) { Alert.alert('Check that load', read.reason); return; }
          // An empty load box IS a bodyweight set, which is what this screen's
          // alert has always told people. Recorded rather than inferred later: a
          // stored 0 cannot be told apart from a load nobody typed, and
          // inferring it at read time would relabel every old zero as a pull-up.
          onLog({ value, kg: read.kg, bw: bwOn || read.kg == null, timed: timedOn });
          setFirst(''); setKg('');
        }} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
          <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Log set</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: sp.xl, flexWrap: 'wrap' }}>
        <SetKindChip
          t={t} on={bwOn} onToggle={() => setBwOn((v) => !v)}
          label="Bodyweight set"
          onLabel={`Bodyweight set — the box above is what you added, in ${unit}`}
          a11yHint={bwOn
            ? `The box holds what you added on top of your own weight, in ${unit}. Turn this off for a set on a bar or a machine.`
            : 'Turn this on for a pull-up, a dip or a press-up. Leaving the load box empty does the same thing.'}
        />
        <SetKindChip
          t={t} on={timedOn} onToggle={() => setTimedOn((v) => !v)}
          label="Timed set"
          onLabel="Timed set — the first box is seconds held"
          a11yHint={timedOn
            ? 'The first box is the seconds you held it for. Turn this off to count reps instead.'
            : 'Turn this on for a plank, a hollow hold or a wall sit, where the set is a length of time rather than a count.'}
        />
      </View>
    </View>
  );
}

/**
 * "This set was my own bodyweight", and "this set was held".
 *
 * Exported because the guided runner in app/(client)/workouts.tsx has its own
 * keyboard — it is a full-screen session with a rest timer and a live heart
 * rate, not a row in a list — and it has to offer the same two answers about a
 * set in the same words. One drawing of the control, two keyboards.
 *
 * One component for both, because they are the same control saying two
 * different things about the same set, and because the two of them have to sit
 * side by side and read as a pair — a plank IS both, and a member holding a
 * plate on their back needs to be able to say all three parts of it.
 *
 * A checkbox rather than a segmented control because the negative case has no
 * name a member would recognise. "Bodyweight" versus "External load" reads like
 * a form; an unticked box beside the load field reads like the ordinary set it
 * is.
 */
export function SetKindChip({ t, on, onToggle, label, onLabel, a11yHint }: {
  t: Theme; on: boolean; onToggle: () => void; label: string; onLabel: string; a11yHint: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      accessibilityHint={a11yHint}
      // 18pt box plus 6 top and bottom is 30 — fourteen short of MIN_TARGET,
      // on the two controls that decide whether the first box is reps or
      // SECONDS and whether the load is the bar or what was added to the body.
      // A mis-tap here changes what a stored set means. `hitSlopFor` is the
      // helper this file already had in the tree for exactly this.
      hitSlop={hitSlopFor(30)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm, paddingVertical: 6 }}>
      <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: hairline, borderColor: on ? t.brand : t.ring, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" size={12} color={t.brandInk} /> : null}
      </View>
      <Text style={{ ...ty.caption, color: on ? t.ink : t.ink3 }}>{on ? onLabel : label}</Text>
    </Pressable>
  );
}
