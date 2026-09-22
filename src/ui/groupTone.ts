// The colour a muscle group takes wherever a screen draws one — its chip under
// the Train hero, its bar in Muscle Focus, its chip on a day of the week and in
// the live runner — so the same group is the same colour on all of them.
//
// Named hues from the data palette, never red or amber: those mean "needs you"
// and "slipping" across the app, and a leg day is neither. Grey for a group
// this list has not met. A colour here is a convenience BESIDE the word and
// never instead of it, which is also why two groups sharing a hue is
// survivable: five hues, more than five groups, and the word is always there.
//
// Keyed on the group as the program's own rows spell it (the coach's builder
// writes it from the catalogue's `muscle_group` when a movement is added),
// lower-cased so 'Legs' and 'legs' agree.
import type { Tone } from './kit';

// ONE map. Three lanes each wrote their own on the night the look was built —
// here, in ExerciseMuscles and in the coach's builder — and the same group came
// out blue on one screen, purple on the next and orange on a third. Both of
// those now re-export this one.
//
// Matched by what the group's name CONTAINS, because the catalogue, a coach's
// hand-typed clip and a builder's volume bar spell groups differently
// ("Quadriceps", "quads", "Chest & Shoulders"). First match wins, so a
// compound name takes the hue of the group it names first.
const GROUP_RULES: readonly (readonly [RegExp, Tone])[] = [
  [/chest|pec/, 'blue'],
  [/shoulder|delt|neck|trap/, 'purple'],
  [/\bback\b|\blats?\b|rhomboid/, 'teal'],
  [/\barms?\b|bicep|tricep|forearm/, 'orange'],
  [/leg|quad|hamstring|glute|calf|calves|hip|adductor|abductor/, 'pink'],
  [/core|\babs?\b|abdom|oblique/, 'brand'],
  [/full|cardio|conditioning/, 'brand'],
];

export function groupTone(group: string | null | undefined): Tone {
  const g = (group ?? '').trim().toLowerCase();
  if (!g) return 'neutral';
  for (const [re, tone] of GROUP_RULES) if (re.test(g)) return tone;
  return 'neutral';
}

/** The groups a list of movements trains, in the order the list meets them,
 *  each once. Read off the rows' own `group`; a row with none is left out
 *  rather than filed under a guess made from its name. */
export const groupsOf = (exercises: readonly { group?: string | null }[]): string[] =>
  [...new Set(exercises.map((e) => (e.group || '').trim()).filter(Boolean))];
