// weeklyVolume must reproduce the loop trends.tsx and WeeklyVolumeCard used to
// write inline. The old loop is kept here verbatim as the reference.
// Compile with tsc, run with node.
import { weeklyVolume } from './weeklyVolume';
import { entryTonnage, type Tonnage, type BodyweightHistory } from './bodyweightSets';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

function previous(log: WorkoutEntry[], weightSeries: BodyweightHistory, weekOpened: Date, WEEKS: number) {
  const out: { start: number; vol: number; unpriced: number; days: number }[] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const start = new Date(weekOpened); start.setDate(weekOpened.getDate() - w * 7);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const inWk = log.filter((e) => { const d = new Date(e.t); return d >= start && d < end; });
    const days = new Set(inWk.map((e) => new Date(e.t).toDateString()));
    const t = inWk.reduce<Tonnage>((a, e) => { const x = entryTonnage(e, weightSeries); return { kg: a.kg + x.kg, unknownSets: a.unknownSets + x.unknownSets }; }, { kg: 0, unknownSets: 0 });
    out.push({ start: start.getTime(), vol: t.kg, unpriced: t.unknownSets, days: days.size });
  }
  return out;
}

const opened = new Date(2026, 8, 21); // a Monday, local midnight
const at = (daysBack: number, h = 18) => { const d = new Date(opened); d.setDate(d.getDate() - daysBack); d.setHours(h); return d.toISOString(); };
const log: WorkoutEntry[] = [
  { t: at(-1), exercise: 'Squat', sets: [[5, 100], [5, 100]] },
  { t: at(-1, 7), exercise: 'Bench', sets: [[8, 60]] },
  { t: at(0, 0), exercise: 'Deadlift', sets: [[3, 140]] },          // the first instant of this week
  { t: at(1, 23), exercise: 'Row', sets: [[10, 50]] },              // last evening of last week
  { t: at(20), exercise: 'Pull-up', sets: [[10, 0]], bw: [true] } as WorkoutEntry, // bodyweight
  { t: at(40), exercise: 'Squat', sets: [[5, 90]] },
  { t: at(80), exercise: 'Squat', sets: [[5, 80]] },               // outside ten weeks
  { t: at(3), exercise: 'Plank' },                                  // no sets
];
for (const weights of [[], [{ t: at(30), v: 80 }]] as BodyweightHistory[]) {
  const got = weeklyVolume(log, weights, opened, 10).map((w) => ({ start: w.start.getTime(), vol: w.t.kg, unpriced: w.t.unknownSets, days: w.days }));
  eq(got, previous(log, weights, opened, 10), `matches the old loop with ${weights.length} weigh-ins`);
}
eq(weeklyVolume([], [], opened, 10).length, 10, 'always ten weeks');
eq(weeklyVolume([], [], opened, 10)[9].start.getTime(), opened.getTime(), 'newest last, opening on weekStart');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('weeklyVolume: ok');
