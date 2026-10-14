import { lastActiveChip } from './rosterStatReach';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => {
  if (a !== b) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

/* ── the run that was mixed ──────────────────────────────────────────────
   "Online · just added" beside a legend reading "On Track". The three stored
   status phrases are the ones a coach sees on the day they add somebody. */
eq(lastActiveChip('just added'), 'Just Added', 'the phrase a hand-added client gets today');
eq(lastActiveChip('added by you'), 'Added by You', 'and the one they get tomorrow');
eq(lastActiveChip('no activity yet'), 'No Activity Yet', 'and a joined client with nothing recorded');

/* ── an elapsed form keeps its units ─────────────────────────────────────
   "3d Ago" would capitalise a measurement, which this codebase does not do. */
eq(lastActiveChip('3d ago'), 'Last Active 3d ago', 'the prefix both screens wanted, the figure as typed');
eq(lastActiveChip('45m ago'), 'Last Active 45m ago', 'minutes too');

/* ── unknown stays unknown ───────────────────────────────────────────────
   A dash is the app's sign for a figure nobody could read, and turning it into
   words here would be this screen inventing an answer the roster refused. */
eq(lastActiveChip('—'), '—', 'the dash is passed straight through');
eq(lastActiveChip(null), '—', 'and so is nothing at all');
eq(lastActiveChip(''), '—', 'including an empty cell');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('rosterStatReachChip: ok');
