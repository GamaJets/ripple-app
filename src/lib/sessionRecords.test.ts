import { sessionRecords, priorTopLoad } from './sessionRecords';
import type { WorkoutEntry } from './mockData';
const errors: string[] = [];
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${m}: got ${JSON.stringify(a)}`); };
const e = (t: string, exercise: string, sets: [number, number][], extra: Partial<WorkoutEntry> = {}): WorkoutEntry => ({ t, exercise, sets, ...extra } as WorkoutEntry);
const d1 = '2026-10-01T10:00:00Z', d2 = '2026-10-05T10:00:00Z', d3 = '2026-10-09T10:00:00Z';
const log = [
  e(d1, 'Bench Press', [[5, 80]]), e(d1, 'Squat', [[5, 100]]), e(d1, 'Pull-Up', [[8, 0]], { bw: [true] }),
  e(d2, 'Bench Press', [[3, 85]]),            // load PR, not e1RM (85×3=93.5→94 vs 80×5=93.3→93) → e1rm actually
  e(d2, 'Squat', [[1, 105]]),                 // load PR only (105×1→109 < 100×5→117)
  e(d2, 'Deadlift', [[5, 140]]),              // first ever: not a record
  e(d2, 'Pull-Up', [[10, 0]], { bw: [true] }),
  e(d3, 'Bench Press', [[5, 82]]),            // e1RM 96 > 94: record even though a later look sees it
];
eq(sessionRecords(log, d2), [
  { exercise: 'Bench Press', kind: 'e1rm', kg: 85, reps: 3 },
  { exercise: 'Squat', kind: 'load', kg: 105, reps: 1 },
], 'records in session 2');
eq(sessionRecords(log, d1), [], 'first session has no records');
eq(sessionRecords(log, d3).map((r) => r.kind), ['e1rm'], 'later session judged against earlier only');
eq(priorTopLoad(log, 'Squat'), 105, 'top load');
eq(priorTopLoad(log, 'Pull-Up'), 0, 'bodyweight ignored');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionRecords: ok');
