// AI-style workout program — planned from goal + InBody body composition.
// The client just logs weight/reps against the plan; every exercise has
// alternatives if they'd rather not do it.
import type { Goal } from './types';

export interface ProgramExercise {
  key: string; name: string; group: string; sets: number; reps: string; alternatives: string[];
}
export interface ProgramDay { day: string; focus: string; cardio?: string; exercises: ProgramExercise[]; }
export interface Program { title: string; focus: string[]; note: string; days: ProgramDay[]; }

const E = (key: string, name: string, group: string, sets: number, reps: string, alternatives: string[]): ProgramExercise => ({ key, name, group, sets, reps, alternatives });

/** Focus areas inferred from body composition + goal (stands in for the scan/photo analysis). */
export function focusAreas(bodyFatPct: number, goal: Goal): string[] {
  const f: string[] = [];
  if (goal === 'fatloss') f.push('Full-body strength', 'Conditioning');
  else if (goal === 'muscle') f.push('Hypertrophy', 'Progressive overload');
  else f.push('Muscle tone', 'Definition');
  if (bodyFatPct >= 25) f.push('Glutes & core');
  else f.push('Shoulders & back');
  return f;
}

export function buildProgram(goal: Goal, bodyFatPct: number): Program {
  const focus = focusAreas(bodyFatPct, goal);
  const note = `Built from your latest InBody scan (${bodyFatPct}% body fat) and goal. Your coach flagged ${(focus[focus.length - 1] || "strength").toLowerCase()} as a priority — extra volume added there. Progress the weight when you hit the top of the rep range.`;

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
    title: 'Full-body + conditioning',
    focus, note,
    days: [
      { day: 'Mon', focus: 'Full body A', cardio: '15 min incline walk', exercises: [E('squat', 'Back Squat', 'Legs', 4, '8-10', ['Goblet Squat', 'Leg Press', 'Bulgarian Split Squat']), E('hipthrust', 'Hip Thrust', 'Glutes', 3, '10-12', ['Glute Bridge', 'Cable Kickback', 'Step-up']), E('bench', 'Dumbbell Bench Press', 'Chest', 3, '10-12', ['Push-up', 'Machine Chest Press']), E('row', 'Seated Row', 'Back', 3, '10-12', ['Lat Pulldown', 'Dumbbell Row']), E('plank', 'Plank', 'Core', 3, '45 sec', ['Dead Bug', 'Hollow Hold']) ] },
      { day: 'Wed', focus: 'Full body B', cardio: '20 min intervals', exercises: [E('rdl', 'Romanian Deadlift', 'Hamstrings', 4, '8-10', ['Leg Curl', 'Kettlebell Swing']), E('lunge', 'Walking Lunge', 'Legs', 3, '12', ['Reverse Lunge', 'Step-up']), E('ohp', 'Shoulder Press', 'Shoulders', 3, '10-12', ['Arnold Press', 'Lateral Raise']), E('pull', 'Lat Pulldown', 'Back', 3, '10-12', ['Assisted Pull-up', 'Straight-arm Pulldown']), E('core', 'Cable Crunch', 'Core', 3, '15', ['Hanging Knee Raise', 'Russian Twist']) ] },
      { day: 'Fri', focus: 'Full body C', cardio: '15 min row', exercises: [E('hipthrust', 'Hip Thrust', 'Glutes', 4, '10-12', ['Glute Bridge', 'Cable Kickback']), E('squat', 'Goblet Squat', 'Legs', 3, '10-12', ['Leg Press', 'Split Squat']), E('bench', 'Push-up', 'Chest', 3, '12', ['Dumbbell Press', 'Machine Press']), E('row', 'Dumbbell Row', 'Back', 3, '12', ['Seated Row', 'Lat Pulldown']), E('plank', 'Side Plank', 'Core', 3, '30 sec/side', ['Pallof Press', 'Bird Dog']) ] },
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
