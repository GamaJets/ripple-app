// Focus areas — the muscle groups to emphasise, set from the AI progress-photo
// read (physique.focusAreas) or manually. The free-text areas the vision model
// returns ("upper back", "rear delts"…) are normalised to the program's muscle
// groups so the Train tab can tag and prioritise the matching exercises.
export const FOCUS_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Hamstrings', 'Core', 'Calves'];

const ALIAS: Record<string, string> = {
  chest: 'Chest', pecs: 'Chest', 'upper chest': 'Chest', 'lower chest': 'Chest',
  back: 'Back', lats: 'Back', 'upper back': 'Back', 'mid back': 'Back', 'lower back': 'Back', traps: 'Back', trapezius: 'Back',
  shoulder: 'Shoulders', shoulders: 'Shoulders', delt: 'Shoulders', delts: 'Shoulders', deltoid: 'Shoulders', 'rear delts': 'Shoulders', 'side delts': 'Shoulders', 'front delts': 'Shoulders',
  arm: 'Arms', arms: 'Arms', bicep: 'Arms', biceps: 'Arms', tricep: 'Arms', triceps: 'Arms', forearm: 'Arms', forearms: 'Arms',
  leg: 'Legs', legs: 'Legs', quad: 'Legs', quads: 'Legs', quadriceps: 'Legs', thigh: 'Legs', thighs: 'Legs',
  glute: 'Glutes', glutes: 'Glutes', 'glute max': 'Glutes',
  hamstring: 'Hamstrings', hamstrings: 'Hamstrings', hams: 'Hamstrings',
  core: 'Core', ab: 'Core', abs: 'Core', abdominals: 'Core', oblique: 'Core', obliques: 'Core',
  calf: 'Calves', calves: 'Calves',
};

// Normalise free-text focus areas to program muscle groups (deduped, order-kept).
export function focusToGroups(areas: string[] = []): string[] {
  const out: string[] = [];
  for (const raw of areas) {
    const k = String(raw).toLowerCase().trim();
    let g = ALIAS[k];
    if (!g) { for (const key of Object.keys(ALIAS)) { if (k.includes(key)) { g = ALIAS[key]; break; } } }
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

export const isFocusGroup = (group: string, focusGroups: string[] = []): boolean => focusGroups.includes(group);
