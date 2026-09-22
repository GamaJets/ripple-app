// Pick the muscles a workout is built for, on a body or from chips. Both
// halves edit the same `chosen` list, so a tap on the figure ticks the chip
// and a chip lights the figure. The menu, its order and the body's colours
// are decided in src/lib/musclePicker.ts; this only draws them.
//
// Used by app/(client)/build-workout.tsx and by the coach's program builder,
// app/(trainer)/builder.tsx.
//
// The figure is src/ui/MuscleBody.tsx, the same drawing as the Recovery Map,
// painted through `colorOf`: each region takes its own muscle group's colour
// out of src/ui/groupTone.ts — the SAME colour that group's chip carries — at
// full strength for a whole region and mixed back into the body for one that
// is only partly picked. Owner feedback, and it is the right rule: the chip
// and the muscle it lights are one control, and two colours for one thing read
// as two different things. Colour is not the only channel either: every chip
// carries a tick, and the figure speaks each region's state.
import { useCallback, useMemo } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useTheme } from './components';
import { TonedChip, toneOf } from './kit';
import { MuscleBody } from './MuscleBody';
import { ART } from './muscleArt';
import { groupTone } from './groupTone';
import { grown, hairline, sp, type as ty, font } from '../theme/scale';
import { MIN_TARGET, hitSlopFor } from '../lib/a11y';
import { bodyGround, mixHex, type Band } from '../lib/bodyHeat';
import type { Target } from '../lib/targetedWorkout';
import {
  PICKER_REGIONS, layerRegion, optionKey, pickedLayers, regionAt, regionSpoken, regionState,
  regionsOn, toggleOption, toggleRegion, type BodySide,
} from '../lib/musclePicker';

/** One target chip, a checkbox. `kind` is spoken because "Arms" the group and
 *  "Triceps" the muscle sit on one row and build different workouts. */
function TargetChip({ label, kind, on, onPress }: {
  label: string; kind: Target['kind']; on: boolean; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={kind === 'group' ? `${label}, the whole muscle group` : `${label}, one muscle`}
      hitSlop={hitSlopFor(MIN_TARGET)}
    >
      {on ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TonedChip label={label} tone={groupTone(label)} icon="check" />
        </View>
      ) : (
        <View style={{
          minHeight: grown(26), paddingHorizontal: 11, paddingVertical: 3,
          borderRadius: grown(26) / 2, backgroundColor: t.surface2,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ ...ty.micro, ...font('700'), letterSpacing: 0, color: t.ink2 }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const FIGURE_H = 240;

/** One side of the body, tappable by region. */
function Figure({ side, chosen, onChange, ramp, colorOf }: {
  side: BodySide; chosen: string[]; onChange: (next: string[]) => void; ramp: readonly Band[];
  colorOf: (layer: string, band: Band) => string | undefined;
}) {
  const t = useTheme();
  const w = FIGURE_H * ART[side].aspect;
  const regions = regionsOn(side);
  const lit = useMemo(() => pickedLayers(chosen), [chosen]);
  const tap = (e: GestureResponderEvent) => {
    const r = regionAt(side, e.nativeEvent.locationX / w, e.nativeEvent.locationY / FIGURE_H);
    if (r) onChange(toggleRegion(r, chosen));
  };
  const spoken = regions.map((r) => regionSpoken(r, regionState(r, chosen)));
  return (
    <Pressable
      onPress={tap}
      style={{ width: w, height: FIGURE_H }}
      accessibilityRole="image"
      accessibilityLabel={`Body, ${side}. ${spoken.join('. ')}`}
      accessibilityHint="Use the actions to pick or clear a region. The chips below do the same."
      // 'activate' is claimed so a double tap does not land on whatever sits
      // at the figure's centre; a region is picked through its own action.
      accessibilityActions={[{ name: 'activate' }, ...regions.map((r, i) => ({ name: r.key, label: spoken[i] }))]}
      onAccessibilityAction={(e) => {
        const r = regions.find((x) => x.key === e.nativeEvent.actionName);
        if (r) onChange(toggleRegion(r, chosen));
      }}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MuscleBody side={side} intensity={lit} status="ready" ramp={ramp} colorOf={colorOf}
          height={FIGURE_H} surface={t.surface} legend={false} captions={false} />
      </View>
    </Pressable>
  );
}

export function MusclePicker({ chosen, onChange }: {
  chosen: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTheme();
  // The two states the figure draws. The colours here are only what a layer
  // falls back to: `colorOf` below paints each muscle in its own group's
  // colour, so the body and the chip for the same muscle are never two
  // different colours — which is what a member reading both at once expects.
  const ramp = useMemo<readonly Band[]>(() => [
    { no: 1, name: 'Partly Selected', color: t.warn, from: 0, to: 0.5 },
    { no: 2, name: 'Selected', color: t.good, from: 0.5, to: 1 },
  ], [t.warn, t.good]);

  const ground = bodyGround(t.ink3, t.surface);
  /** A whole region in its group's own colour, a partly-picked one in the same
   *  colour mixed back into the body — one hue, two strengths, so colour says
   *  WHICH muscle and strength says how much of it. Neither is the only
   *  channel: every chip carries a tick and the figure speaks each region's
   *  state. */
  const colorOf = useCallback((layer: string, band: Band): string | undefined => {
    // A layer no region owns is one only Full Body lights — the shin, the
    // upper back between the shoulder blades, the neck — so it takes Full
    // Body's colour rather than falling back to the ramp's.
    const mark = toneOf(t, groupTone(layerRegion(layer)?.label ?? 'Full Body')).mark;
    return band.no === 1 ? mixHex(mark, ground, 0.45) : mark;
  }, [t, ground]);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.xl, paddingVertical: sp.md }}>
        <Figure side="front" chosen={chosen} onChange={onChange} ramp={ramp} colorOf={colorOf} />
        <Figure side="back" chosen={chosen} onChange={onChange} ramp={ramp} colorOf={colorOf} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.lg, marginBottom: sp.sm }}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ramp.slice().reverse().map((b) => (
          <View key={b.no} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs }}>
            {/* Strength, not hue: the hue on the body is the muscle group's
                own, so a key drawn in one colour would name a group rather
                than a state. */}
            <View style={{
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: b.no === 1 ? mixHex(t.ink2, ground, 0.45) : t.ink2,
            }} />
            <Text style={{ ...ty.micro, color: t.ink2 }}>{b.name}</Text>
          </View>
        ))}
      </View>

      {PICKER_REGIONS.map((r, i) => {
        const heading = i === 0 || PICKER_REGIONS[i - 1].area !== r.area ? r.area : null;
        return (
          <View key={r.key}>
            {heading && i > 0 ? (
              <Text accessibilityRole="header"
                style={{ ...ty.label, ...font('700'), color: t.ink, marginTop: sp.lg }}>{heading}</Text>
            ) : null}
            <View style={{
              paddingVertical: sp.md,
              borderTopWidth: heading ? 0 : hairline, borderTopColor: t.ring,
              flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, alignItems: 'center',
            }}>
              {r.options.map((o) => (
                <TargetChip key={o.label} label={o.label} kind={o.target.kind}
                  on={chosen.includes(optionKey(o.target))}
                  onPress={() => onChange(toggleOption(o.target, chosen))} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
