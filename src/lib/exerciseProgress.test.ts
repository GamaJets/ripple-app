// Compile with tsc, run with node.
import { progressSeries, rangeStart } from './exerciseProgress';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const today = new Date(2026, 9, 16);
const outings = [
  { day: '2026-10-10', topLoadKg: 100, best1RMKg: 120, volumeKg: 3000 },
  { day: '2025-01-01', topLoadKg: 80, best1RMKg: 95, volumeKg: 2000 },
  { day: '2026-09-01', topLoadKg: null, best1RMKg: null, volumeKg: null },
  { day: null, topLoadKg: 200, best1RMKg: 250, volumeKg: 9 },
  { day: '2026-08-20', topLoadKg: 90, best1RMKg: 110, volumeKg: 2500 },
];

eq(rangeStart(today, '1m'), '2026-09-15', '1m window start');
eq(rangeStart(today, 'all'), null, 'all has no start');

const all = progressSeries(outings, 'e1rm', 'all', today);
eq(all.labels, ['2025-01-01', '2026-08-20', '2026-09-01', '2026-10-10'], 'oldest first, undated dropped');
eq(all.data, [95, 110, null, 120], 'gap kept as null');
eq(all.points, 3, 'points count non-null');
eq(all.peak, 120, 'peak');
eq(all.change, 25, 'change first→last');

const m1 = progressSeries(outings, 'volume', '1m', today);
eq(m1.labels, ['2026-10-10'], '1m filters');
eq(m1.change, null, 'one point has no change');

const lb = progressSeries(outings, 'best', '3m', today, (kg) => kg * 2.20462);
eq(lb.data, [198.4, null, 220.5], 'converted and rounded');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('exerciseProgress: ok');
