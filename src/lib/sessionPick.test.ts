import { pickSession, loggedSets, topKg, compareToPrevious, volumeVsPrevious } from './sessionPick';
import { sessionsOf } from './clientTraining';
import type { WorkoutEntry } from './mockData';

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const log: WorkoutEntry[] = [
  { t: '2026-10-18T09:00:00.000Z', exercise: 'Bench Press', sets: [[8, 60], [8, 62.5]], feel: ['ok', 'hard'] },
  { t: '2026-10-18T09:00:00.000Z', exercise: 'Plank', sets: [[45, 0]], timed: [true] },
  { t: '2026-10-16T09:00:00.000Z', exercise: 'Squat', sets: [[5, 100]] },
  { t: '2026-10-14T09:00:00.000Z', exercise: 'Bench Press', sets: [[8, 65]] },
  { t: '2026-10-14T09:00:00.000Z', exercise: 'Squat', sets: [[5, 95]] },
];
const ss = sessionsOf(log);
eq(ss.map((s) => s.at.slice(0, 10)), ['2026-10-18', '2026-10-16', '2026-10-14'], 'newest first');

// one selection drives everything: the picked session IS the list shown
eq(pickSession(ss, '2026-10-14T09:00:00.000Z')?.entries.map((e) => e.exercise), ['Bench Press', 'Squat'], 'picked list is that day');
eq(pickSession(ss, null)?.at, ss[0].at, 'no pick is the newest');
eq(pickSession(ss, 'gone')?.at, ss[0].at, 'a stale pick falls back to the newest');
eq(pickSession([], null), null, 'nothing logged');

eq(loggedSets(log[0]).map((s) => [s.reps, s.kg, s.feel]), [[8, 60, 'ok'], [8, 62.5, 'hard']], 'sets as logged, with feel');
eq(loggedSets(log[1])[0].secs, 45, 'a hold is seconds');
eq(topKg(log[1]), null, 'a hold carries no top load');

// against the last session with the SAME movement, skipping a different day
const c = compareToPrevious(ss, 0);
eq(c.map((x) => [x.exercise, x.top, x.prevTop, x.dir]), [['Bench Press', 62.5, 65, 'down'], ['Plank', null, null, 'new']], 'bench vs Oct 14');
eq(compareToPrevious(ss, 1)[0].dir, 'up', 'squat 100 vs 95');
eq(compareToPrevious(ss, 2).every((x) => x.dir === 'new'), true, 'oldest has nothing before');
eq(volumeVsPrevious(ss, 1), 500 - (8 * 65 + 5 * 95), 'volume delta');
eq(volumeVsPrevious(ss, 2), null, 'no earlier session');
console.log('sessionPick.test.ts — ok');
