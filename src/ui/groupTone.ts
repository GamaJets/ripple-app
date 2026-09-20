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
// Keyed on the group as the programme's own rows spell it (the coach's builder
// writes it from the catalogue's `muscle_group` when a movement is added),
// lower-cased so 'Legs' and 'legs' agree.
import type { Tone } from './kit';

const GROUP_TONES: Record<string, Tone> = {
  chest: 'blue', back: 'teal', shoulders: 'purple',
  arms: 'orange', biceps: 'orange', triceps: 'orange', forearms: 'orange',
  legs: 'pink', quads: 'pink', hamstrings: 'pink', glutes: 'pink', calves: 'pink',
  core: 'teal', abs: 'teal',
};

export const groupTone = (group: string): Tone => GROUP_TONES[group.trim().toLowerCase()] ?? 'neutral';

/** The groups a list of movements trains, in the order the list meets them,
 *  each once. Read off the rows' own `group`; a row with none is left out
 *  rather than filed under a guess made from its name. */
export const groupsOf = (exercises: readonly { group?: string | null }[]): string[] =>
  [...new Set(exercises.map((e) => (e.group || '').trim()).filter(Boolean))];
