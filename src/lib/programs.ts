// AI-style workout program — planned from goal + InBody body composition.
// The client just logs weight/reps against the plan; every exercise has
// alternatives if they'd rather not do it.
import type { Goal } from './types';

export interface ProgramExercise {
  key: string; name: string; group: string; sets: number; reps: string; alternatives: string[];
  /**
   * The load ACTUALLY PUT ON THE MACHINE for this exercise, in KILOGRAMS, or
   * null when nobody has said.
   *
   * Not a target. The number a member wants beside sets and reps is what they
   * loaded, because that is the one that changes week to week and the one they
   * have to remember when they walk back to the same machine.
   *
   * Kilograms because the record is metric everywhere else in this app —
   * `readLift` takes what was typed in whatever unit and returns kg, and
   * `liftLabel` reads it back. A second convention here would be a second
   * chance for a pounds member's 225 to be stored as 225 kg, which has happened
   * three times in this codebase already.
   *
   * Optional rather than defaulted: an exercise with no load is the ordinary
   * case — bodyweight work, a movement not loaded yet — and inventing a figure
   * would put a number on screen nobody chose.
   */
  loadKg?: number | null;
}
export interface ProgramDay { day: string; focus: string; cardio?: string; exercises: ProgramExercise[]; }
export interface Program { title: string; focus: string[]; note: string; days: ProgramDay[]; }

const E = (key: string, name: string, group: string, sets: number, reps: string, alternatives: string[]): ProgramExercise => ({ key, name, group, sets, reps, alternatives });

/** Focus areas inferred from body composition + goal (stands in for the scan/photo analysis). */
export function focusAreas(bodyFatPct: number | null | undefined, goal: Goal): string[] {
  const f: string[] = [];
  if (goal === 'fatloss') f.push('Full-body strength', 'Conditioning');
  else if (goal === 'muscle') f.push('Hypertrophy', 'Progressive overload');
  else f.push('Muscle tone', 'Definition');
  if (bodyFatPct != null && bodyFatPct >= 25) f.push('Glutes & core');
  else f.push('Shoulders & back');
  return f;
}

/** bodyFatPct may be null: a client with no scan still gets a program, it just
 *  is not biased by a body-composition figure nobody measured. */
export function buildProgram(goal: Goal, bodyFatPct: number | null | undefined): Program {
  const focus = focusAreas(bodyFatPct, goal);
  // Says only what is true. This used to read "Built from your latest InBody scan
  // (N% body fat) and goal. Your coach flagged X as a priority…" — but the caller
  // supplies bodyFatPct, and three of the six call sites pass a hardcoded constant
  // (25 from the trainer builder, 26/28/30 from the starter templates) for clients
  // who may have no scan at all and no coach. It claimed a measurement that had
  // not been taken and a coach decision nobody had made. The note is not currently
  // rendered to clients; this keeps it safe for whenever it is.
  const note = `A ${goal === 'fatloss' ? 'fat-loss' : goal === 'muscle' ? 'muscle-building' : 'toning'} plan with extra volume on ${(focus[focus.length - 1] || 'strength').toLowerCase()}. Progress the weight when you hit the top of the rep range.`;

  if (goal === 'muscle') {
    return {
      title: 'Push · Pull · Legs',
      focus, note,
      days: [
        { day: 'Mon', focus: 'Push', exercises: [E('bench', 'Bench Press', 'Chest', 4, '6-8', ['Dumbbell Press', 'Machine Chest Press', 'Push-up']), E('ohp', 'Overhead Press', 'Shoulders', 4, '8-10', ['Dumbbell Shoulder Press', 'Arnold Press']), E('incline', 'Incline Dumbbell Press', 'Chest', 3, '8-10', ['Incline Machine Press', 'Landmine Press']), E('lateral', 'Lateral Raise', 'Shoulders', 3, '12-15', ['Cable Lateral', 'Upright Row']), E('tricep', 'Triceps Pushdown', 'Arms', 3, '10-12', ['Skull Crusher', 'Dips']) ] },
        { day: 'Wed', focus: 'Pull', exercises: [E('deadlift', 'Deadlift', 'Back', 4, '5-6', ['Rack Pull', 'Trap-bar Deadlift']), E('pull', 'Pull-up', 'Back', 4, '6-10', ['Lat Pulldown', 'Assisted Pull-up']), E('row', 'Bent-over Row', 'Back', 3, '8-10', ['Seated Cable Row', 'Dumbbell Row']), E('facepull', 'Face Pull', 'Shoulders', 3, '12-15', ['Reverse Fly', 'Band Pull-apart']), E('curl', 'Barbell Curl', 'Arms', 3, '10-12', ['Dumbbell Curl', 'Hammer Curl']) ] },
        { day: 'Fri', focus: 'Legs', exercises: [E('squat', 'Back Squat', 'Legs', 4, '6-8', ['Front Squat', 'Leg Press', 'Goblet Squat']), E('rdl', 'Romanian Deadlift', 'Hamstrings', 4, '8-10', ['Leg Curl', 'Good Morning']), E('hipthrust', 'Hip Thrust', 'Glutes', 3, '10-12', ['Glute Bridge', 'Cable Kickback']), E('lunge', 'Walking Lunge', 'Legs', 3, '12', ['Bulgarian Split Squat', 'Step-up']), E('calf', 'Calf Raise', 'Calves', 4, '12-15', ['Seated Calf Raise', 'Leg-press Calf']) ] },
      ],
    };
  }
  // fatloss / tone → 3-day full body + conditioning, glute/core emphasis
  return {
    title: 'Full-body + Conditioning',
    focus, note,
    days: [
      { day: 'Mon', focus: 'Full Body A', cardio: '15 min incline walk', exercises: [E('squat', 'Back Squat', 'Legs', 4, '8-10', ['Goblet Squat', 'Leg Press', 'Bulgarian Split Squat']), E('hipthrust', 'Hip Thrust', 'Glutes', 3, '10-12', ['Glute Bridge', 'Cable Kickback', 'Step-up']), E('bench', 'Dumbbell Bench Press', 'Chest', 3, '10-12', ['Push-up', 'Machine Chest Press']), E('row', 'Seated Row', 'Back', 3, '10-12', ['Lat Pulldown', 'Dumbbell Row']), E('plank', 'Plank', 'Core', 3, '45 sec', ['Dead Bug', 'Hollow Hold']) ] },
      { day: 'Wed', focus: 'Full Body B', cardio: '20 min intervals', exercises: [E('rdl', 'Romanian Deadlift', 'Hamstrings', 4, '8-10', ['Leg Curl', 'Kettlebell Swing']), E('lunge', 'Walking Lunge', 'Legs', 3, '12', ['Reverse Lunge', 'Step-up']), E('ohp', 'Shoulder Press', 'Shoulders', 3, '10-12', ['Arnold Press', 'Lateral Raise']), E('pull', 'Lat Pulldown', 'Back', 3, '10-12', ['Assisted Pull-up', 'Straight-arm Pulldown']), E('core', 'Cable Crunch', 'Core', 3, '15', ['Hanging Knee Raise', 'Russian Twist']) ] },
      { day: 'Fri', focus: 'Full Body C', cardio: '15 min row', exercises: [E('hipthrust', 'Hip Thrust', 'Glutes', 4, '10-12', ['Glute Bridge', 'Cable Kickback']), E('squat', 'Goblet Squat', 'Legs', 3, '10-12', ['Leg Press', 'Split Squat']), E('bench', 'Push-up', 'Chest', 3, '12', ['Dumbbell Press', 'Machine Press']), E('row', 'Dumbbell Row', 'Back', 3, '12', ['Seated Row', 'Lat Pulldown']), E('plank', 'Side Plank', 'Core', 3, '30 sec/side', ['Pallof Press', 'Bird Dog']) ] },
    ],
  };
}

/** Today's day from the program based on weekday (Mon/Wed/Fri → nearest). */
export function todayIndex(days: ProgramDay[], weekday: number): number {
  // weekday: 0 Sun..6 Sat. Map program days to their weekday.
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  let best = 0, bestDiff = 99;
  days.forEach((d, i) => { const diff = Math.abs(map[d.day] - weekday); if (diff < bestDiff) { bestDiff = diff; best = i; } });
  return best;
}
