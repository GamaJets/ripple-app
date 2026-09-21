// The lifting tools — estimated 1RM, training percentages, plate maths and the
// warm-up ramp — as a panel a screen can mount, rather than as a screen.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(client)/tools.tsx has had all of this since the client app was written.
// The coach app had no route to any of it: a coach standing at a rack working
// out what 87.5% of their own top single is, or which plates make 102.5, had
// the arithmetic on their client's phone and not on their own. Grepped before
// this was written — `plateMath`, `warmupRamp` and `est1RM` had no importer
// anywhere under app/(trainer).
//
// ── Why a panel and not a second screen ────────────────────────────────────
//
// A new route has to be registered in app/(trainer)/_layout.tsx, and that file
// is six tab items plus a long list of `href: null` detail screens whose own
// header explains what a seventh bar item costs. So this is a component, and
// app/(trainer)/my-training.tsx mounts it — which is also where a coach already
// is when they want it.
//
// ── Why it is a copy of nothing ────────────────────────────────────────────
//
// Every decision here is made by a module the client screen also calls:
// `readLift` (src/lib/units.ts) for the load, `est1RM` (src/lib/streaks.ts) for
// the estimate, `loadBar` (src/lib/plateMath.ts) for the plates and
// `warmupRamp` (src/lib/warmupRamp.ts) for the rungs. Nothing is re-derived
// here, so this panel and the client screen cannot come to different answers
// about the same barbell — which is the failure the house rule about second
// copies is actually about. What is not shared is the JSX, and it cannot be:
// app/(client)/tools.tsx owns its own tab bar and its own header, and lifting
// its three tabs out is an edit to a file this lane may not touch.
//
// ── Units ──────────────────────────────────────────────────────────────────
//
// `unit` is a prop rather than a `useSettings()` read, because the screen that
// mounts this already has one and already offers the toggle. A second read of
// the same setting is not wrong today; it is the shape that goes wrong when a
// screen gains a local override and its panel does not follow it.
//
// The plate denominations are NOT a converted metric list. A 20 kg Olympic bar
// and a 45 lb bar are different objects and so are the plates beside them —
// src/lib/plateMath.ts holds one native list per unit and says why.
import { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { useTheme } from './components';
import { Rule, Section, SectionHead, KpiRow, fig } from './kit';
import { sp, radius, type as ty, numeric } from '../theme/scale';
import { est1RM } from '../lib/streaks';
import { BARS, PLATES, loadBar } from '../lib/plateMath';
import { warmupRamp, warmupNote, warmupRefusal } from '../lib/warmupRamp';
import { readLift, liftIn, liftLabel, est1RMIn, plain, type WeightUnit } from '../lib/units';

/** The percentages a working set is written as. One descending ladder, not a
 *  choice: a screen offering to configure this is asking a question the person
 *  holding the bar opened it to avoid. */
const PCTS = [100, 95, 90, 85, 80, 75, 70] as const;

/**
 * The tools, for whoever's own lifting the mounting screen is about.
 *
 * Reads nothing and writes nothing. Every figure on it comes from what is typed
 * into it, which is why it needs no load status and can never show a stale
 * answer: there is no provider behind it to go stale.
 */
export function LiftingToolsPanel({ unit }: { unit: WeightUnit }) {
  const t = useTheme();

  // Empty, never seeded with a number. A prefilled "60" on a panel that reads
  // whichever unit its host is set to means two different loads to two coaches,
  // and the one reading pounds has nothing on screen to tell them which it was
  // taken as. This is the same argument app/(client)/tools.tsx makes about the
  // same two boxes, and it is the defect that put a 135 lb bench in as 135 kg.
  const [oneRmWeight, setOneRmWeight] = useState('');
  const [oneRmReps, setOneRmReps] = useState('5');
  const [target, setTarget] = useState('');
  // WHICH bar, by index, not how heavy. A bar held as the number 20 survives a
  // flip to pounds as a "20 lb bar", which is a bar no gym owns.
  const [barIdx, setBarIdx] = useState(0);

  // The typed load makes the same trip into kilograms a logged set makes, and
  // through the same reader — so "225" here and "225" in the coach's own
  // training log are the same load, and text is refused rather than quietly
  // becoming 0 and estimating a one-rep max from nothing.
  const read = readLift(oneRmWeight, unit);
  const kg = read.ok ? read.kg : null;
  const reps = parseInt(oneRmReps, 10) || 0;
  // Epley, applied to the record's own kilograms and through the very function
  // the personal-records board uses. The formula does not care about units but
  // WHICH figure it is applied to does: estimating in pounds and converting the
  // answer puts this panel a pound away from the board for the same set, and
  // two screens disagreeing about one lift is how somebody learns to trust
  // neither.
  const oneRmKg = kg && reps ? est1RM(kg, reps) : 0;
  const oneRm = est1RMIn(oneRmKg || null, unit);

  const bars = BARS[unit];
  const bar = bars[Math.min(barIdx, bars.length - 1)];
  const targetRead = readLift(target, unit);
  const asked = targetRead.ok ? liftIn(targetRead.kg, unit) : null;
  const load = loadBar(asked, bar, unit);
  /* The smallest change the BAR can make, which is a PAIR of the smallest
     plates — 1.25 a side is a 2.5 jump. Derived from `PLATES` rather than
     written down, so a rack that gains a smaller fractional plate changes the
     ramp with it instead of leaving a second copy of the fact here to go
     stale. */
  const rampStep = 2 * Math.min(...PLATES[unit]);
  const ramp = warmupRamp(asked ?? 0, rampStep);

  const inp = {
    ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2,
    borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11,
    flex: 1, textAlign: 'center',
  } as const;

  return (
    <View>
      {/* ── what the top set is worth ─────────────────────────────────── */}
      <Section>
        <SectionHead title="Estimated 1RM" />
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
          Type a set you have actually done. Nothing here is logged. This is arithmetic, not a
          record, and it never reaches your training log.
        </Text>
        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
          {/* The unit is on the label rather than only in the placeholder. A
              placeholder is drawn only while the box is EMPTY, so the moment a
              load was typed the old client screen stopped saying what it was
              reading — and it was reading kilograms whatever had been chosen. */}
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 5 }}>Weight · {unit}</Text>
            <TextInput value={oneRmWeight} onChangeText={setOneRmWeight} keyboardType="decimal-pad"
              placeholder={unit} placeholderTextColor={t.ink3}
              accessibilityLabel={`Weight lifted, in ${unit === 'lb' ? 'pounds' : 'kilograms'}`}
              style={inp} />
          </View>
          <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>×</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 5 }}>Reps</Text>
            {/* `numeric` and not `decimal-pad`: half a repetition is not a
                thing, and widening this would let somebody type a value the
                estimate then silently rounds. */}
            <TextInput value={oneRmReps} onChangeText={setOneRmReps} keyboardType="numeric"
              placeholder="reps" placeholderTextColor={t.ink3}
              accessibilityLabel="Repetitions in that set" style={inp} />
          </View>
        </View>
        {/* A refused load says so where the answer would have been, rather than
            leaving the last good estimate on screen beside a number it was not
            computed from. */}
        <View style={{ marginTop: sp.lg }}>
          <KpiRow items={[
            { label: 'Epley Estimate', value: fig(oneRm), unit: oneRm != null ? unit : undefined },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {!read.ok
              ? read.reason
              : oneRm != null
                ? `From ${liftLabel(kg, unit)} × ${reps}. An estimate from one set, not a max you have hit.`
                : 'Type a weight and a rep count.'}
          </Text>
        </View>
      </Section>

      {oneRm != null ? (<>
        <Rule />
        <Section>
          <SectionHead title="Training Percentages" />
          {PCTS.map((p, i) => (
            <View key={p}>
              {i > 0 ? <Rule /> : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.md }}>
                <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{p}%</Text>
                {/* Each percentage is taken off the KILOGRAM estimate and read
                    out once, rather than off the already-converted figure — so
                    the 100% row is the estimate above it to the pound rather
                    than a pound away from it. */}
                <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>
                  {fig(est1RMIn((oneRmKg * p) / 100, unit))} {unit}
                </Text>
              </View>
            </View>
          ))}
        </Section>
      </>) : null}

      <Rule />

      {/* ── which plates make that number ─────────────────────────────── */}
      <Section>
        <SectionHead title="Load the Bar" />
        <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 5 }}>Target Total · {unit}</Text>
            <TextInput value={target} onChangeText={setTarget} keyboardType="decimal-pad"
              placeholder={unit} placeholderTextColor={t.ink3}
              accessibilityLabel={`Target total on the bar, in ${unit === 'lb' ? 'pounds' : 'kilograms'}, the bar included`}
              style={inp} />
          </View>
          <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>bar</Text>
          {bars.map((b, i) => {
            const on = i === barIdx;
            return (
              <Pressable key={b} onPress={() => setBarIdx(i)} accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Use the ${plain(b)} ${unit} bar`}
                style={{ paddingHorizontal: sp.md, paddingVertical: 11, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
                <Text style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>
                  {plain(b)} {unit}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {load ? (<>
        <Rule />
        <Section>
          <SectionHead title="Per Side" />
          {/* "Each Side" is what the PLATES weigh, not half the gap between the
              target and the bar. The two differ whenever the rack cannot make
              the number asked for, and printing the second gives three figures
              that cannot all be true. */}
          <KpiRow items={[
            { label: 'Each Side', value: fig(load.perSide), unit },
            { label: 'Plates a Side', value: fig(load.plates.length) },
            { label: 'Loadable Total', value: fig(load.total), unit },
          ]} />
        </Section>

        {load.plates.length ? (<>
          <Rule />
          <Section>
            <SectionHead title="Load, Heaviest First" note={`${unit} a Side`} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {load.plates.map((p, i) => (
                <View key={`${p}-${i}`} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink }}>{plain(p)}</Text>
                </View>
              ))}
            </View>
            {/* The warning is a coloured MARK beside ink text. `t.warn` as the
                ink of a sentence fails the contrast gate, and this is the one
                line on the panel that has to be noticed. */}
            {!load.exact ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>
                  Closest loadable: {plain(load.total)} {unit}
                </Text>
              </View>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Loads exactly.</Text>
            )}
          </Section>
        </>) : (
          <Section>
            <Text style={{ ...ty.label, color: t.ink3 }}>Just the bar ({plain(bar)} {unit}).</Text>
          </Section>
        )}

        {/* ── the sets before the set ───────────────────────────────────
            Off the weight already typed above, because asking for it twice is
            the thing this feature exists to remove: a ramp is worked out
            standing at a rack between sets, and the reason people skip a
            warm-up is rarely that they do not know they should. Every rung is
            rounded DOWN to a weight the bar can hold — 40% of 102.5 is 41, and
            there is no 41 kg. */}
        {asked != null ? (<>
          <Rule />
          <Section>
            <SectionHead title="Warm-up Ramp" note={`To ${plain(asked)} ${unit}`} />
            {ramp.length ? (<>
              {ramp.map((r, i) => (
                <View key={r.pct}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, ...numeric, color: t.ink2 }}>{r.pct}%</Text>
                    <Text style={{ ...ty.body, ...numeric, fontWeight: '600', color: t.ink }}>
                      {plain(r.weight)} {unit} × {r.reps}
                    </Text>
                  </View>
                </View>
              ))}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{warmupNote(ramp, unit)}</Text>
            </>) : (
              <Text style={{ ...ty.label, color: t.ink3 }}>{warmupRefusal(asked, rampStep)}</Text>
            )}
          </Section>
        </>) : null}
      </>) : (
        <Section>
          {/* Three different silences, and none of them may look like an
              answer: a refusal, an empty box, and a target lighter than the bar
              itself. All three once rendered as a bar loaded to zero. */}
          <Text style={{ ...ty.label, color: t.ink3 }}>
            {!targetRead.ok
              ? targetRead.reason
              : asked == null
                ? 'Type the total you want on the bar, the bar included.'
                : `${plain(asked)} ${unit} is lighter than the ${plain(bar)} ${unit} bar on its own.`}
          </Text>
        </Section>
      )}
    </View>
  );
}
