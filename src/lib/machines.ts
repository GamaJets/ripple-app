// Gym machine / exercise catalogue used by the machine scanner. Maps a scanned
// label (or a picked entry) to a real exercise name, its muscle group, and whether
// it's a cardio machine — so the "Scan machine" screen always names the movement
// and target muscle instead of echoing an asset serial off the QR code.

export interface MachineDef {
  name: string;        // display exercise/machine name
  group: string;       // target muscle group
  cardio?: boolean;    // true for cardio machines (log time/distance/watts, not reps/kg)
  keys?: string[];     // extra match keywords / synonyms
}

export const MACHINES: MachineDef[] = [
  // Cardio
  { name: 'Rowing Machine', group: 'Full body · cardio', cardio: true, keys: ['row', 'rower', 'erg', 'concept2', 'concept 2'] },
  { name: 'Ski Erg', group: 'Full body · cardio', cardio: true, keys: ['ski', 'skierg', 'ski erg'] },
  { name: 'Air Bike', group: 'Full body · cardio', cardio: true, keys: ['assault', 'air bike', 'airbike', 'echo bike', 'fan bike'] },
  { name: 'Treadmill', group: 'Legs · cardio', cardio: true, keys: ['tread', 'run', 'running'] },
  { name: 'Upright Bike', group: 'Legs · cardio', cardio: true, keys: ['bike', 'cycle', 'spin', 'spinning'] },
  { name: 'Elliptical', group: 'Full body · cardio', cardio: true, keys: ['elliptical', 'cross trainer', 'crosstrainer'] },
  { name: 'Stair Climber', group: 'Legs · cardio', cardio: true, keys: ['stair', 'stepmill', 'stairmaster', 'step'] },
  // Strength machines
  { name: 'Chest Press', group: 'Chest', keys: ['chest press', 'seated press'] },
  { name: 'Pec Deck', group: 'Chest', keys: ['pec', 'fly', 'peck deck'] },
  { name: 'Cable Crossover', group: 'Chest', keys: ['crossover', 'cable fly'] },
  { name: 'Lat Pulldown', group: 'Back', keys: ['lat', 'pulldown', 'pull down'] },
  { name: 'Seated Row', group: 'Back', keys: ['row machine', 'seated row', 'cable row'] },
  { name: 'Assisted Pull-up', group: 'Back', keys: ['assisted pull', 'assist pull'] },
  { name: 'Shoulder Press', group: 'Shoulders', keys: ['shoulder press', 'overhead machine'] },
  { name: 'Lateral Raise', group: 'Shoulders', keys: ['lateral', 'lat raise'] },
  { name: 'Leg Press', group: 'Legs · quads', keys: ['leg press'] },
  { name: 'Hack Squat', group: 'Legs · quads', keys: ['hack'] },
  { name: 'Leg Extension', group: 'Quads', keys: ['leg extension', 'quad'] },
  { name: 'Leg Curl', group: 'Hamstrings', keys: ['leg curl', 'hamstring'] },
  { name: 'Hip Thrust', group: 'Glutes', keys: ['hip thrust', 'glute'] },
  { name: 'Hip Abduction', group: 'Glutes', keys: ['abduction', 'abductor'] },
  { name: 'Calf Raise', group: 'Calves', keys: ['calf'] },
  { name: 'Bicep Curl', group: 'Biceps', keys: ['arm curl', 'preacher', 'biceps', 'bicep', 'curl machine', 'preacher'] },
  { name: 'Tricep Pushdown', group: 'Triceps', keys: ['tricep', 'pushdown', 'push down'] },
  { name: 'Ab Crunch', group: 'Core', keys: ['crunch', 'ab machine', 'abdominal'] },
  { name: 'Back Extension', group: 'Lower back', keys: ['back extension', 'hyperextension'] },
  { name: 'Smith Machine', group: 'Full body', keys: ['smith'] },
  { name: 'Cable Machine', group: 'Full body', keys: ['cable', 'functional trainer'] },
];

function norm(s: string): string { return (s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// Looks like a machine asset serial rather than a name? e.g. "vrx", "O4-253182",
// "SN-9931". Heuristic: short, or dominated by digits, or no alphabetic word ≥ 3 letters.
export function looksLikeSerial(raw: string): boolean {
  const s = norm(raw);
  if (!s) return true;
  if (/^https?:\/\//.test(s)) return false;              // a URL may still carry a name
  const words = s.split(' ').filter((w) => /[a-z]{3,}/.test(w));
  if (words.length === 0) return true;                   // e.g. "o4 253182", "vrx"
  const digits = (s.match(/\d/g) || []).length;
  if (digits >= 4 && s.length <= 12) return true;        // mostly a code
  return false;
}

// Try to identify a scanned/typed label as a catalogue exercise. Returns null when
// it can't be confidently matched (caller then asks the user to pick from MACHINES).
export function identifyMachine(raw: string): MachineDef | null {
  const s = norm(raw);
  if (!s || looksLikeSerial(raw)) return null;
  for (const m of MACHINES) {
    const hay = [m.name, ...(m.keys || [])].map(norm);
    if (hay.some((h) => s === h || s.includes(h) || h.includes(s))) return m;
  }
  return null;
}

// Best-effort muscle group for an arbitrary exercise name (used in history/trends
// where we only stored the name). Falls back to a neutral label.
export function muscleFor(name: string): string {
  const def = identifyMachine(name);
  if (def) return def.group;
  const s = norm(name);
  if (/(squat|lunge|leg|quad|calf)/.test(s)) return 'Legs';
  if (/(bench|chest|push[- ]?up|dip|fly)/.test(s)) return 'Chest';
  if (/(row|pull|lat|back|deadlift)/.test(s)) return 'Back';
  if (/(press|shoulder|raise|ohp)/.test(s)) return 'Shoulders';
  if (/(curl|bicep)/.test(s)) return 'Biceps';
  if (/(tricep|pushdown|extension)/.test(s)) return 'Triceps';
  if (/(run|row|bike|cycle|ski|elliptical|stair|cardio|treadmill)/.test(s)) return 'Cardio';
  if (/(ab|core|crunch|plank)/.test(s)) return 'Core';
  return 'General';
}

export function isCardioName(name: string): boolean {
  const def = identifyMachine(name);
  if (def) return !!def.cardio;
  return /(run|row|bike|cycle|ski|elliptical|stair|treadmill|cardio|erg)/.test(norm(name));
}
