// Mock dataset so the app runs standalone in Expo Go before Supabase is wired.
// Mirrors the prototype's seed. Swap `getClient()` etc. for Supabase queries later.
import type { Goal, Diet, Sex, TrainingSession, Scan, Message, FoodEntry } from './types';

export interface MockClient {
  id: string;
  name: string;
  sex: Sex;
  dob: string;
  heightCm: number;
  goal: Goal;
  diet: Diet;
  activity: number;
  mealsPerDay: 3 | 4 | 5;
  weight: { t: string; v: number }[];
  bodyFat: { t: string; v: number }[];
  muscle: { t: string; v: number }[];
  scans: Scan[];
  log: WorkoutEntry[];
}
export interface WorkoutEntry {
  t: string;
  exercise: string;
  sets?: [number, number][];       // [reps, kg]
  cardio?: { mins: number; dist: number; unit: string };
  kcal?: number;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export const MOCK_CLIENT: MockClient = {
  id: 'c1',
  name: 'Maya K.',
  sex: 'f',
  dob: '1997-06-15',
  heightCm: 167,
  goal: 'fatloss',
  diet: 'vegetarian',
  activity: 1.45,
  mealsPerDay: 4,
  weight: [71.2, 70.1, 69.4, 68.7, 68.0, 67.4].map((v, i) => ({ t: daysAgo(75 - i * 15), v })),
  bodyFat: [31.5, 30.6, 29.8, 29.1, 28.6, 28.2].map((v, i) => ({ t: daysAgo(75 - i * 15), v })),
  muscle: [24.1, 24.3, 24.4, 24.6, 24.8, 24.9].map((v, i) => ({ t: daysAgo(75 - i * 15), v })),
  scans: [
    { id: 's1', clientId: 'c1', takenAt: daysAgo(75), weightKg: 71.2, bodyFatPct: 31.5, skeletalMuscleKg: 24.1, source: 'InBody 770' },
    { id: 's2', clientId: 'c1', takenAt: daysAgo(7), weightKg: 67.4, bodyFatPct: 28.2, skeletalMuscleKg: 24.9, source: 'InBody 770 (OCR)' },
  ],
  log: [
    { t: daysAgo(2), exercise: 'Back Squat', sets: [[8, 52], [8, 52], [8, 54], [7, 54]], kcal: 312 },
    { t: daysAgo(3), exercise: 'Treadmill / Run', cardio: { mins: 32, dist: 5.2, unit: 'km' }, kcal: 342 },
    { t: daysAgo(4), exercise: 'Barbell Bench Press', sets: [[8, 30], [8, 32], [8, 32], [6, 32]], kcal: 288 },
  ],
};

export const MOCK_MESSAGES: Message[] = [
  { id: 'm1', clientId: 'c1', sender: 'coach',  body: 'Great lower-body session on Monday 💪 Let’s nudge dinner protein up on training days.', createdAt: daysAgo(2) },
  { id: 'm2', clientId: 'c1', sender: 'client', body: 'Will do — thanks coach! Felt strong on the squats.', createdAt: daysAgo(2) },
  { id: 'm3', clientId: 'c1', sender: 'coach',  body: 'Perfect. Log your meals this week so I can see the macros.', createdAt: daysAgo(1) },
];

export const MOCK_FOOD: FoodEntry[] = [
  { id: 'f1', clientId: 'c1', loggedAt: daysAgo(0), name: 'Greek yogurt + berries', kcal: 210, protein: 20, carbs: 24, fat: 4, via: 'search' },
  { id: 'f2', clientId: 'c1', loggedAt: daysAgo(0), name: 'Chicken & quinoa bowl',   kcal: 520, protein: 46, carbs: 48, fat: 14, via: 'photo' },
];

export const MOCK_TRAINER = {
  id: 't1',
  name: 'Coach Daniel Reyes',
  sessionFee: 75,
  clients: [{ id: 'c1', name: 'Maya K.', goal: 'fatloss' as Goal, weightDelta: -3.8 }],
};

function at(days: number, hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
export const MOCK_SESSIONS: TrainingSession[] = [
  { id: 'ms1', trainerId: 't1', clientId: 'c1', startsAt: at(0, 9), durationMin: 60, status: 'booked', released: false },
  { id: 'ms2', trainerId: 't1', clientId: null, startsAt: at(1, 17), durationMin: 60, status: 'available', released: false },
  { id: 'ms3', trainerId: 't1', clientId: null, startsAt: at(2, 8), durationMin: 60, status: 'available', released: true },
];
