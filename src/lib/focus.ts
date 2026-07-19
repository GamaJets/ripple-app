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

// Specific moves to recommend for each focus group (from the progress-photo read).
export const EXERCISES_BY_GROUP: Record<string, string[]> = {
  Chest: ['Bench Press', 'Incline Dumbbell Press', 'Chest Press', 'Cable Crossover'],
  Back: ['Lat Pulldown', 'Seated Row', 'Bent-Over Row', 'Pull-up'],
  Shoulders: ['Shoulder Press', 'Lateral Raise', 'Rear Delt Fly', 'Face Pull'],
  Arms: ['Bicep Curl', 'Tricep Pushdown', 'Hammer Curl', 'Overhead Tricep Extension'],
  Legs: ['Leg Press', 'Back Squat', 'Leg Extension', 'Walking Lunge'],
  Glutes: ['Hip Thrust', 'Glute Bridge', 'Romanian Deadlift', 'Cable Kickback'],
  Hamstrings: ['Leg Curl', 'Romanian Deadlift', 'Good Morning', 'Nordic Curl'],
  Core: ['Plank', 'Hanging Leg Raise', 'Cable Crunch', 'Russian Twist'],
  Calves: ['Standing Calf Raise', 'Seated Calf Raise'],
};

// Up to `perGroup` specific moves for each focus group (deduped across groups).
export function recommendedExercises(groups: string[] = [], perGroup = 2): { name: string; group: string }[] {
  const out: { name: string; group: string }[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    const list = EXERCISES_BY_GROUP[g] || [];
    let n = 0;
    for (const name of list) { if (n >= perGroup) break; if (seen.has(name)) continue; seen.add(name); out.push({ name, group: g }); n++; }
  }
  return out;
}

export const isFocusGroup = (group: string, focusGroups: string[] = []): boolean => focusGroups.includes(group);
