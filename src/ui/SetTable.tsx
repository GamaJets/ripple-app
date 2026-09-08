// A set is a ROW, not a multiplier — drawn once, for both apps.
//
// Two things a coach asked for on Repple Coach 1.3.0 (20), 8 September:
//
//   · "When entering amount of sets there should be a drop down to record with
//      the weight being used per set"
//   · "A tick box to send feedback/log sets been completed."
//
// They are one table seen from two ends, so they are one file. `SetLadder` is
// the ENTRY end — a row per set, each with its own reps and load, ticked off as
// the sets are done — and `SetChecklist` is the PLAN end, where the figures are
// already written and the tick is the only thing left to do.
//
// The two are drawn from the same tick box on purpose. A control that decides
// whether a set enters somebody's training history has to look and read the
// same wherever it appears, and the two screens that carry it are in different
// apps: the coach logging their own session, and the member working through a
// programme. One drawing, two callers, and nothing about either app's rules
// crosses into the other — `SetLadder` knows nothing about a plan and
// `SetChecklist` writes nothing itself.
//
// ── What is NOT in here ────────────────────────────────────────────────────
//
// Any decision. `src/lib/setLadder.ts` owns resizing, reading and refusing the
// typed table; `src/lib/setTicks.ts` owns what a tick would record and whether
// it may be offered at all. Both are pure and both are tested. This file draws
// what they say and reports taps back.
//
// Loads are handed in ALREADY RENDERED, as text, in the reader's own unit. That
// is not fussiness: `liftLabel` is the one converter, the member's unit is a
// real setting, and a component that took kilograms and formatted them itself
// would be the second converter — which is how a pounds member comes to be read
// a stored kilogram by a screen reader.
import type { ReactNode } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { Icon } from './Icon';
import { sp, radius, hairline, numeric, type as ty } from '../theme/scale';
import type { Theme } from '../theme/tokens';
import { hitSlopFor } from '../lib/a11y';
import type { WeightUnit } from '../lib/units';
import type { LadderRow } from '../lib/setLadder';
import type { SetTick, TickRecord } from '../lib/setTicks';
import { tickLabel } from '../lib/setTicks';

/**
 * The tick itself.
 *
 * 20pt of box with 7 above and below is 34 — ten short of the minimum target,
 * on the one control in this file that puts a set into somebody's permanent
 * record. `hitSlopFor` is the helper src/ui/LogSetRow.tsx already uses for
 * exactly this argument about exactly this kind of control.
 *
 * `accessibilityRole="checkbox"` with a real `checked` state, and a LABEL that
 * says what the tap does rather than "checkbox". Both callers build that
 * sentence from the figures the tap will write, never from the prescription it
 * read them from.
 *
 * Not exported. Two components in this file draw it and nothing outside needs
 * it, and a third drawing of a tick box is how the app comes to have two that
 * behave differently.
 */
function TickBox({ t, on, disabled, label, hint, onPress }: {
  t: Theme; on: boolean; disabled?: boolean; label: string; hint?: string; onPress: () => void;
}) {
  // Disabled rather than hidden. A set that cannot be ticked yet is still one of
  // the sets of this movement, and a checklist that drew four boxes on Monday
  // and one on Tuesday would read as the app having lost the plan.
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={hitSlopFor(34)}
      style={{ paddingVertical: 7, paddingHorizontal: 2 }}>
      <View style={{
        width: 20, height: 20, borderRadius: 6, borderWidth: hairline,
        borderColor: on ? t.brand : t.ring,
        backgroundColor: on ? t.brand : 'transparent',
        opacity: disabled && !on ? 0.45 : 1,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <Icon name="check" size={13} color={t.brandInk} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * The typed table: one row per set, each with its own reps, its own load and
 * its own tick.
 *
 * This is the control the report asked for. What it replaces is three boxes —
 * a count, one rep figure, one load — which could only ever mean "N of the
 * identical set", so a coach who worked up 60 / 65 / 65 had to pick one of the
 * three numbers and lose the other two.
 *
 * The column headings are drawn once, above the rows, rather than as
 * placeholders inside them: a placeholder disappears the moment somebody types,
 * and from set two onwards there was then nothing on screen saying which column
 * was reps and which was load. The load column is headed with the UNIT the
 * person is typing in, which is their own setting and not a constant.
 */
export function SetLadder({ t, unit, rows, movement, onPatch, onToggle, note }: {
  t: Theme;
  /** The unit on the keyboard. Storage is kilograms; `readLadder` converts. */
  unit: WeightUnit;
  rows: LadderRow[];
  /** What these sets are of, for the spoken labels. */
  movement: string;
  onPatch: (at: number, patch: Partial<LadderRow>) => void;
  /**
   * Tick or untick one row — and, by its ABSENCE, what this table is.
   *
   * A table with a tick column is a LOG: each row is a set that happened, and
   * only the ticked ones are saved. A table without one is a PLAN — sets that
   * are going to happen — where a tick would be a claim about the future and
   * `ladderToPlanRows` reads every row regardless. The same rows, the same
   * boxes, and one column that decides which question is being asked.
   *
   * Omitted rather than a `mode` string, because a caller that passes no way to
   * tick a row cannot then be handed a table whose rows must be ticked to
   * count: the two go together and the type says so.
   */
  onToggle?: (at: number) => void;
  /** The sentence from `ladderNote` — what is and is not going to be saved.
   *  Null when every row is ticked, and on a plan, where there is nothing to
   *  warn about. */
  note: string | null;
}) {
  if (!rows.length) return null;
  const inp = {
    color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
    paddingHorizontal: sp.md, paddingVertical: 10, flex: 1, ...ty.body, ...numeric,
  } as const;
  const of = movement.trim() ? ` of ${movement.trim()}` : '';
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center', marginTop: sp.sm }}>
        <View style={{ width: 42 }} />
        <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Reps</Text>
        <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>{unit.toUpperCase()}</Text>
        {/* The tick column is headed in words, because a bare box column with
            nothing over it reads as decoration — and this is the column that
            decides whether the row is saved at all. */}
        {onToggle ? (
          <Text style={{ ...ty.micro, color: t.ink3, width: 34, textAlign: 'center' }}>Did</Text>
        ) : null}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center', marginTop: sp.sm }}>
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 42 }}>Set {i + 1}</Text>
          {/* A LOG's reps box is a whole number and gets the number pad. A
              PLAN's is a coach's column and holds "8-10", "AMRAP" and "45 sec",
              none of which can be typed on a pad with ten digits and a
              backspace on it — so a table with no tick column, which is a plan,
              gets the ordinary keyboard. Neither is a decimal field: half a rep
              is not a rep, and widening this would let somebody type a value the
              write then rounds away. See scripts/check-decimals.mjs. */}
          <TextInput
            value={r.reps} onChangeText={(v) => onPatch(i, { reps: v })}
            keyboardType={onToggle ? 'numeric' : 'default'}
            accessibilityLabel={`Set ${i + 1}${of}, reps`}
            style={inp} />
          {/* decimal-pad, never numeric. A 16.5 kg dumbbell has the figure
              printed on it and the iOS number pad has no decimal point — see
              scripts/check-decimals.mjs for the report this came from. */}
          <TextInput
            value={r.load} onChangeText={(v) => onPatch(i, { load: v })}
            keyboardType="decimal-pad"
            accessibilityLabel={`Set ${i + 1}${of}, weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
            style={inp} />
          {onToggle ? (
            <View style={{ width: 34, alignItems: 'center' }}>
              <TickBox
                t={t} on={r.done}
                label={`Set ${i + 1}${of} completed`}
                hint={r.done
                  ? 'Ticked, so this set is saved. Tap to take the tick off.'
                  : 'Tap when you have done this set. A set that is not ticked is not saved.'}
                onPress={() => onToggle(i)} />
            </View>
          ) : null}
        </View>
      ))}
      {note ? (
        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start', marginTop: sp.md }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ink3, marginTop: 6 }} />
          <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The plan, ticked off.
 *
 * One line per planned set, showing what it asks for, with a box that LOGS that
 * set at those figures. There is no completion column on `workouts` and this
 * does not pretend there is — see the header of src/lib/setTicks.ts. A filled
 * box is a set that has been recorded, read back out of the session's own log.
 *
 * A row the plan cannot answer for definitely — a range, an AMRAP — is drawn
 * with its box held and a line underneath saying to type it instead. That is
 * the whole reason `setTicks` exists: one tap that has to write a rep count can
 * only be offered where the plan names one, and the quick-log this is modelled
 * on used to write eight reps for "AMRAP".
 */
export function SetChecklist({ t, ticks, movement, askFor, onTick, onUntick, line, extraFor }: {
  t: Theme;
  ticks: SetTick[];
  movement: string;
  /**
   * What set `n` asks for, already rendered in the reader's own unit: `text` is
   * the line on screen — "10 × 60 kg", or "8-10 × 42.5 kg" where the plan names
   * a range — and `loadText` is the load alone, for the spoken label, null on a
   * bodyweight set.
   *
   * Both come from the caller and neither is derived here. See the file header:
   * one converter, and it is not this file. It also means a prescription this
   * module cannot read a single figure out of is still shown VERBATIM rather
   * than rounded, averaged or narrowed to one end of its range.
   */
  askFor: (n: number) => { text: string; loadText: string | null };
  onTick: (n: number, records: TickRecord) => void;
  onUntick: (n: number) => void;
  /** "2 of 4 sets done · 2 to go", from `ticksLine`, or null where there is no
   *  plan to be behind on. */
  line: string | null;
  /** Anything the caller wants on the row after the figures — a method badge, a
   *  prescribed RPE. Passed as a render function so the two screens keep their
   *  own badge vocabulary rather than this file growing one. */
  extraFor?: (n: number) => ReactNode;
}) {
  if (!ticks.length) return null;
  // Whether ANY row is waiting on a figure the plan does not name. Said once,
  // under the table, rather than on each row: four repetitions of the same
  // sentence is how a real explanation comes to be skipped.
  const anyVague = ticks.some((k) => k.state !== 'done' && k.records == null);
  return (
    <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.md }}>
      {line ? (
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.xs }}>{line}</Text>
      ) : null}
      {ticks.map((k) => {
        const here = k.state === 'next';
        const ask = askFor(k.n);
        const load = ask.loadText;
        const rec = k.records;
        return (
          <View key={k.n} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: 2 }}>
            <TickBox
              t={t} on={k.state === 'done'} disabled={!k.actionable}
              label={tickLabel(k, movement, load)}
              hint={k.state === 'done'
                ? (k.actionable ? 'Tap to take this set back out of your log.' : undefined)
                : k.state === 'later'
                  ? 'Sets are ticked in order. Finish the one above first.'
                  : (rec == null ? undefined : 'Tap when you have finished this set.')}
              onPress={() => {
                if (k.state === 'done') { onUntick(k.n); return; }
                if (rec) onTick(k.n, rec);
              }} />
            <Text style={{ ...ty.caption, ...numeric, color: here ? t.brand : t.ink3, width: 20, fontWeight: here ? '700' : '400' }}>{k.n}</Text>
            {/* The prescription as the caller rendered it. Nothing is rounded,
                averaged or picked from a range here — "8-10" stays "8-10", and
                the box beside it stays shut. */}
            <Text style={{ ...ty.label, ...numeric, color: here ? t.ink : t.ink2, fontWeight: here ? '600' : '400' }}>
              {ask.text}
            </Text>
            {extraFor ? extraFor(k.n) : null}
          </View>
        );
      })}
      {anyVague ? (
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>
          Some of these sets do not name one figure to log — a range, or as many as you can. Type those in below when you have done them.
        </Text>
      ) : null}
    </View>
  );
}
