// Which muscle group a movement a coach just invented trains.
//
// ── the report this exists for ────────────────────────────────────────────
//
// Four rows in a 615-row catalogue had no muscle group, because
// `ensureCatalogueRow` accepted a call with none and two screens made one.
// Those four reached an assigned programme and two templates, and a programme
// row with a blank `group` is dropped by `groupsOf` on purpose — a guess made
// from a movement's name is not a fact. So the owner's Upper day printed
// "Chest · Arms · Back" over a day containing an overhead press, and Muscle
// Focus and the body map had nothing to draw for it either.
//
// The fix is to ask. One tap, before the movement can be added, and a line
// saying what the tap is for — a coach told only "required" will pick the
// first chip, and the first chip is wrong about most movements.
//
// ── why these eleven words and not a free text box ────────────────────────
//
// They are the groups the catalogue actually uses, in the order it uses them
// (Full body 202, Back 103, Shoulders 73, Core 69, Chest 58, Legs 44, Arms 24,
// Hamstrings 21, Glutes 13, Lower back 4, Calves 4). A typed group would file
// "shoulders", "Shoulder" and "Delts" as three groups, and every screen that
// counts by group — the day's chips, Muscle Focus, the coach's volume bars —
// would then say there are three. Spelled EXACTLY as the catalogue spells
// them, sentence case and all: this string is data going into a column beside
// 615 others, not a label, so the Title Case rule does not touch it.
//
// ── why a wrapped chip grid and not `Segmented` ───────────────────────────
//
// Eleven options. A segmented bar with eleven equal slices is unreadable at
// any type size and unusable at 1.35; the kit's `scroll` variant hides most of
// them off the right edge, which is how a coach ends up picking from the three
// they can see. The chips wrap, so every option is on screen at every size.
//
// The selected chip IS the kit's `TonedChip`, in the group's own hue from
// `groupTone` — the same colour that group takes on the day's chips, in Muscle
// Focus and in the runner, so the choice looks like its consequence. The
// unselected ones are the same geometry on `t.surface2`; colour is never the
// only channel here, the word is always there.
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './components';
import { TonedChip } from './kit';
import { groupTone } from './groupTone';
import { sp, grown, font, type as ty } from '../theme/scale';

/**
 * The muscle groups the catalogue is written in, in the order it uses them.
 *
 * Not a lookup and not sorted: the order is by how many of the 615 rows carry
 * each one, so the group a coach most often wants is the first chip.
 */
const MUSCLE_GROUPS: readonly string[] = [
  'Full body', 'Back', 'Shoulders', 'Core', 'Chest', 'Legs',
  'Arms', 'Hamstrings', 'Glutes', 'Lower back', 'Calves',
];

/** The one line that says why the tap is being asked for. Shared so the two
 *  screens that ask say the same thing. */
export const MUSCLE_GROUP_WHY =
  'Pick the muscle group — it is what puts this movement on the body map and in the chips for that day.';

/**
 * The picker. `value` is the chosen group or null; there is no default, and
 * that is the point — a pre-selected chip is a group nobody chose, which is
 * the failure this screen exists to stop one step further along.
 */
export function MuscleGroupPicker({ value, onChange }: {
  value: string | null;
  onChange: (group: string) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
      {MUSCLE_GROUPS.map((g) => {
        const on = value === g;
        return (
          <Pressable key={g} onPress={() => onChange(g)}
            accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={g}>
            {on ? (
              // The tick is the second channel. A coach holding the phone at
              // arm's length in a gym is not going to read a tint difference.
              //
              // Hidden from the reader, and only the reader: `TonedChip` makes
              // itself an accessible element with its own label, which inside
              // a control would put a second focus stop on the chip that says
              // the word and nothing about it being chosen. The Pressable
              // above carries the name AND the selected state, which is the
              // whole of what a radio has to announce.
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <TonedChip label={g} tone={groupTone(g)} icon="check" />
              </View>
            ) : (
              <View style={{
                minHeight: grown(26), paddingHorizontal: 11, paddingVertical: 3,
                borderRadius: grown(26) / 2, backgroundColor: t.surface2,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ ...ty.micro, ...font('700'), letterSpacing: 0, color: t.ink2 }}>{g}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
