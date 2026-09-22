// When a block reads as ending or ended on the coach's attention queue.
// Compile with tsc, run with node.
import { blockEnding } from './blockEnding';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

eq(blockEnding(null, '2026-09-22', 4), null, 'no start date, no end date, no reason');
eq(blockEnding('', '2026-09-22', 4), null, 'a blank date is no date');
eq(blockEnding('not a date', '2026-09-22', 4), null, 'an unreadable date raises nothing');
eq(blockEnding('2026-10-01', '2026-09-22', 1), null, 'a block that has not started is not ending');
// A four week block from 1 Sep runs to 28 Sep.
eq(blockEnding('2026-09-01', '2026-09-21', 4), null, 'seven days left is outside the window');
eq(blockEnding('2026-09-01', '2026-09-22', 4), { state: 'ending', daysLeft: 6 }, 'six days left is inside it');
eq(blockEnding('2026-09-01', '2026-09-28', 4), { state: 'ending', daysLeft: 0 }, 'the last day is ending today');
eq(blockEnding('2026-09-01', '2026-09-29', 4), { state: 'ended', daysAgo: 1 }, 'the day after, it ended yesterday');
eq(blockEnding('2026-09-22', '2026-09-22', 1), { state: 'ending', daysLeft: 6 }, 'a one week block started today ends in six days');
eq(blockEnding('2026-09-01', '2026-09-22', 0), { state: 'ended', daysAgo: 15 }, 'a zero week count is read as one week');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('blockEnding: ok');
