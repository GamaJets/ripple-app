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
  { name: 'Upright Bike', group: 'Legs · cardio', cardio: true, keys: ['bike', 'cycle', 'cycling', 'spin', 'spin bike', 'spinning', 'stationary bike', 'exercise bike'] },
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

/**
 * How much of a label a key must explain before it may claim it.
 *
 * This is the whole of the fix below. The catalogue leads with `Rowing Machine`
 * carrying the bare key 'row', and the old matcher took the FIRST entry whose
 * name or any key was a substring of the input in either direction — so
 * 'Barbell Row', 'Upright Row' and 'Seated Cable Row' were all rowing machines,
 * with 'Full body · cardio' as their muscle group and the cardio flag set.
 *
 * Three characters of an eleven-character label is not an identification. A key
 * now has to account for a real share of what it is looking at, and 0.4 is
 * where the two kinds of case separate cleanly: 'spin' in 'spin bike' is 0.44
 * and survives; 'row' in 'barbell row' is 0.27 and does not.
 */
const MIN_KEY_COVERAGE = 0.4;

/**
 * Identify a scanned or photographed label as a catalogue machine, or null.
 *
 * Null is a real answer and the callers treat it as one: app/(client)/scan-machine.tsx
 * asks the member to pick from the list and then REMEMBERS their pick against
 * that QR code. So the cost of not knowing is one tap, once, for that machine
 * forever — while the cost of a confident wrong answer is an exercise, a muscle
 * group and a cardio flag applied silently and recalled every scan afterwards.
 * Everything here is built on that asymmetry: it would rather ask than guess.
 *
 * BEST match rather than first. `MACHINES` order is still load-bearing and is
 * still respected — it breaks ties, because a later entry must beat an earlier
 * one strictly to displace it — but order no longer lets a short key at the top
 * of the catalogue swallow a label that a longer key further down explains.
 */
export function identifyMachine(raw: string): MachineDef | null {
  const s = norm(raw);
  if (!s || looksLikeSerial(raw)) return null;

  let best: MachineDef | null = null;
  let bestScore = 0;

  for (const m of MACHINES) {
    for (const h of [m.name, ...(m.keys || [])].map(norm)) {
      if (!h) continue;
      let score = 0;
      if (s === h) {
        // An exact label. Nothing loose can outrank it, whatever its length.
        score = 1000 + h.length;
      } else if (s.includes(h)) {
        // The key sits inside the label: 'cable row' within 'seated cable row'.
        // Scored by how much of the label it accounts for.
        if (h.length / s.length >= MIN_KEY_COVERAGE) score = h.length;
      } else if (h.includes(s)) {
        // The label is a fragment of the key: 'concept' typed for 'concept2'.
        // The same share test, the other way round.
        if (s.length / h.length >= MIN_KEY_COVERAGE) score = s.length;
      }
      // Strictly greater, so an earlier catalogue entry keeps a tie.
      if (score > bestScore) { bestScore = score; best = m; }
    }
  }
  return best;
}

// ── Two helpers that used to live here ────────────────────────────────────
//
// `muscleFor(name)` and `isCardioName(name)` are gone. Both wrapped
// `identifyMachine` and inherited its first-match looseness, so both answered
// that a barbell row was a rowing machine — 'Full body · cardio' as its muscle
// group, and cardio as its kind.
//
// They are deleted rather than corrected because neither had a caller. The one
// screen that reached for `isCardioName` stopped in ea69951/380e71b, having
// found it right for a scanned machine and wrong for a movement in a training
// plan, and it now matches exact names against two lists it keeps itself. What
// was left was a pair of wrong answers sitting in a shared module waiting to be
// picked up — and the commit that removed the last caller says plainly how that
// happens: it "reached for `isCardioName` because it was there".
//
// If a screen ever needs a muscle group for an arbitrary movement name, that is
// a question about a training catalogue and not about the machines in a gym,
// and `src/lib/muscleMap.ts` is where it belongs.

