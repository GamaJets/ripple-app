import {
  addSetRow, expandSets, hasSetRows, patchSetRow, plannedVolume, readRepSpan,
  removeSetRow, setCount, type SetSpec,
} from './setRows';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

};

/** What every set of every programme written before src/lib/setIntensity.ts
 *  carries. Named rather than repeated so the assertions below read as "nothing
 *  changed" rather than as three nulls somebody has to check by eye. */
const NO_INTENSITY = { rpe: null, pct1rm: null, tempo: null };

/** The shape every programme already on a phone has: one spec, no table. */
const old: SetSpec = { sets: 3, reps: '8-10', loadKg: 42.5 };

// ── the old shape still runs exactly as it did ────────────────────────────
//
// This is the assertion the whole file exists for. Programmes live in the
// database AND in an on-device draft, and no migration reaches both.
ok(!hasSetRows(old), 'an exercise with no table has no table');
eq(setCount(old), 3, 'its set count is still `sets`');
// `intensity` is on every planned set and is three nulls for every programme
// ever written — the RPE, %1RM and tempo columns arrived after these, and
// absent still means absent. Asserted in full here rather than picked apart,
// because the whole claim of src/lib/setIntensity.ts is that adding them
// changed NOTHING about an exercise that carries none.
eq(expandSets(old), [
  { n: 1, reps: '8-10', loadKg: 42.5, method: null, fromRow: false, intensity: NO_INTENSITY },
  { n: 2, reps: '8-10', loadKg: 42.5, method: null, fromRow: false, intensity: NO_INTENSITY },
  { n: 3, reps: '8-10', loadKg: 42.5, method: null, fromRow: false, intensity: NO_INTENSITY },
], 'and it expands to `sets` copies of the one spec');
eq(expandSets({ sets: 2, reps: '12' }), [
  { n: 1, reps: '12', loadKg: null, method: null, fromRow: false, intensity: NO_INTENSITY },
  { n: 2, reps: '12', loadKg: null, method: null, fromRow: false, intensity: NO_INTENSITY },
], 'a bodyweight exercise keeps its null load rather than gaining a 0');
// The per-exercise method reaches every copy — that is what it means today.
eq(expandSets({ sets: 2, reps: '5', method: 'drop' }).map((s) => s.method), ['drop', 'drop'],
  'the exercise method is on every set when there is no table');

// A count nothing sane writes, which a jsonb column can still hold.
eq(expandSets({ sets: 0, reps: '8' }).length, 0, 'zero sets is zero rows');
eq(expandSets({ sets: -3, reps: '8' }).length, 0, 'a negative count is not a loop that runs backwards');
eq(expandSets({ sets: 2.7, reps: '8' }).length, 2, 'a fractional count floors rather than rounding up to a set nobody planned');
eq(expandSets({ sets: Number.NaN, reps: '8' }).length, 0, 'a count that is not a number is not a number of rows');
eq(expandSets({ sets: Number.POSITIVE_INFINITY, reps: '8' }).length, 0, 'nor is infinity');

// An EMPTY table is not a table. An exercise with nothing to log against is a
// worse answer than the one the old fields already give.
ok(!hasSetRows({ ...old, setRows: [] }), 'an empty array is not a table');
eq(expandSets({ ...old, setRows: [] }).length, 3, 'and falls back to the old fields rather than showing no sets');
eq(expandSets({ ...old, setRows: null }).length, 3, 'so does an explicit null');

// ── the table, and what a row inherits ───────────────────────────────────
const ramped: SetSpec = {
  sets: 3, reps: '10', loadKg: 42.5,
  setRows: [{}, { loadKg: 42.5 }, { reps: '8', loadKg: 45 }],
};
ok(hasSetRows(ramped), 'an exercise with rows has a table');
eq(expandSets(ramped), [
  { n: 1, reps: '10', loadKg: 42.5, method: null, fromRow: true, intensity: NO_INTENSITY },
  { n: 2, reps: '10', loadKg: 42.5, method: null, fromRow: true, intensity: NO_INTENSITY },
  { n: 3, reps: '8', loadKg: 45, method: null, fromRow: true, intensity: NO_INTENSITY },
], 'the top set can be heavier than the back-offs — the thing one spec could not say');

// Absent inherits; present answers, `null` included.
eq(expandSets({ sets: 1, reps: '10', loadKg: 60, setRows: [{}] })[0].loadKg, 60,
  'a row that has not said takes the exercise load');
eq(expandSets({ sets: 1, reps: '10', loadKg: 60, setRows: [{ loadKg: null }] })[0].loadKg, null,
  'a row that says null has nothing on the bar, even where the exercise names a load');
eq(expandSets({ sets: 1, reps: '10', setRows: [{ reps: '' }] })[0].reps, '10',
  'a blank reps column inherits — a set of no reps is not a thing to mean');
eq(expandSets({ sets: 1, reps: '10', setRows: [{ reps: '   ' }] })[0].reps, '10',
  'and so does one that is only spaces');
eq(expandSets({ sets: 1, reps: '10', setRows: [{ reps: null }] })[0].reps, '10',
  'and so does an explicit null, for the same reason');
// A key written as `undefined` is the ABSENCE of an answer, not an answer of
// none — which is what `{ ...row, loadKg: undefined }` produces and what
// JSON.stringify and a jsonb column both drop on the way to storage. It must
// inherit, exactly as a missing key does.
eq(expandSets({ sets: 1, reps: '10', loadKg: 60, setRows: [{ loadKg: undefined }] })[0].loadKg, 60,
  'a load written as undefined asks the exercise rather than emptying the bar');
eq(expandSets({ sets: 1, reps: '10', method: 'drop', setRows: [{ method: undefined }] })[0].method, 'drop',
  'and a method written as undefined takes the exercise default rather than going ordinary');

// The per-exercise method is the DEFAULT for rows that do not override it,
// and a row can be ordinary inside an exercise whose default is not.
const dropDefault: SetSpec = {
  sets: 4, reps: '8', loadKg: 40, method: 'drop',
  setRows: [{ method: 'warmup' }, {}, {}, { method: null }],
};
eq(expandSets(dropDefault).map((s) => s.method), ['warmup', 'drop', 'drop', null],
  'set 1 a warm-up, the middle two the exercise default, set 4 explicitly ordinary');
eq(setCount(dropDefault), 4, 'the count comes off the rows once there are rows');
eq(setCount({ ...old, setRows: [{}, {}, {}, {}, {}] }), 5, 'even where `sets` disagrees — the rows are what is drawn');

// ── reps as a span, never as an average ──────────────────────────────────
eq(readRepSpan('10'), { low: 10, high: 10 }, 'one number is a span of itself');
eq(readRepSpan(' 12 '), { low: 12, high: 12 }, 'spaces round it are not part of it');
eq(readRepSpan('6-8'), { low: 6, high: 8 }, 'a hyphen span');
eq(readRepSpan('6–8'), { low: 6, high: 8 }, 'an en dash, which is what a coach on a phone types');
eq(readRepSpan('6 - 8'), { low: 6, high: 8 }, 'spaces inside it too');
eq(readRepSpan('12-8'), { low: 8, high: 12 }, 'written backwards is still a range, put in order');
eq(readRepSpan('45 sec'), null, 'an isometric hold is seconds, not reps');
eq(readRepSpan('AMRAP'), null, 'a set whose reps are not known in advance has no number');
eq(readRepSpan('30 sec/side'), null, 'nor does a per-side hold');
eq(readRepSpan(''), null, 'nor does a blank');
eq(readRepSpan(null), null, 'nor does nothing at all');
eq(readRepSpan('8.5'), null, 'half a rep is not a rep count this app will multiply');

// ── volume: the warm-up is the whole point ───────────────────────────────
//
// A warm-up is real work that was performed and typed in, and it is NOT
// tonnage. Counting it makes a member's weekly figure jump on a day they did
// nothing different.
const withWarmup: SetSpec = {
  sets: 4, reps: '10', loadKg: 40,
  setRows: [
    { method: 'warmup', loadKg: 20 },
    { loadKg: 40 },
    { loadKg: 40 },
    { method: 'cooldown', loadKg: 15 },
  ],
};
const v = plannedVolume(withWarmup);
eq(v.lowKg, 800, 'only the two working sets are tonnage');
eq(v.highKg, 800, 'and with a fixed rep count the two ends agree');
eq(v.counted, 2, 'two rows counted');
eq(v.notVolume, 2, 'the warm-up and the cool-down are named, not silently dropped');
eq(v.unfigured, 0, 'nothing was unreadable');
// The proof it is the METHOD deciding and not the position: move the warm-up
// to the end and the total does not move.
eq(plannedVolume({ ...withWarmup, setRows: [
  { loadKg: 40 }, { loadKg: 40 }, { method: 'cooldown', loadKg: 15 }, { method: 'warmup', loadKg: 20 },
] }).lowKg, 800, 'the method decides, never where the row sits');
// …and that a row with no method at all is counted, because that means an
// ordinary working set.
eq(plannedVolume({ sets: 2, reps: '10', loadKg: 40 }).lowKg, 800, 'an exercise with no methods anywhere is all volume');
// A drop set and a set to failure ARE volume, whatever the rest timer does
// with them.
eq(plannedVolume({ sets: 1, reps: '10', loadKg: 40, method: 'drop' }).counted, 1, 'a drop set is training volume');

// A span stays a span all the way to the total.
const spanned = plannedVolume({ sets: 2, reps: '6-8', loadKg: 50 });
eq(spanned.lowKg, 600, 'the low end of two sets of six to eight at fifty');
eq(spanned.highKg, 800, 'and the high end');
ok(spanned.lowKg !== spanned.highKg, 'a range is not collapsed to a figure nobody wrote');

// Rows that count but carry no arithmetic are named rather than added as zero.
const bodyweight = plannedVolume({ sets: 3, reps: '12' });
eq(bodyweight.lowKg, 0, 'a bodyweight exercise has no tonnage');
eq(bodyweight.counted, 0, 'and nothing was counted');
eq(bodyweight.unfigured, 3, 'but three sets happened, and the tally says so');
const held = plannedVolume({ sets: 2, reps: '45 sec', loadKg: 20, method: 'isometric' });
eq(held.unfigured, 2, 'seconds under load are not reps × kilograms');
eq(held.lowKg, 0, 'and are not multiplied into the total anyway');
// A load of 0 is a bodyweight set that was logged, not a load — but a PLANNED
// 0 still multiplies out to 0, which is the truth about a planned tonnage.
eq(plannedVolume({ sets: 2, reps: '10', loadKg: 0 }).counted, 2, 'a planned zero load is a figure, and it is zero');
eq(plannedVolume({ sets: 1, reps: '8', loadKg: 16.5 }).lowKg, 132, 'a decimal load multiplies cleanly rather than arriving with a float tail');

// ── adding a set ─────────────────────────────────────────────────────────
//
// The first add is the moment the old shape becomes a table, and it happens
// under a control the coach pressed — never on its own.
const added = addSetRow(old);
eq(added.sets, 4, 'three sets become four');
eq(added.setRows.length, 4, 'and the table has four rows');
eq(added.setRows, [
  { reps: '8-10', loadKg: 42.5 },
  { reps: '8-10', loadKg: 42.5 },
  { reps: '8-10', loadKg: 42.5 },
  { reps: '8-10', loadKg: 42.5 },
], 'the old spec is written out column by column, so what the builder shows is what the client gets');
// The METHOD is not written into the rows, and that is the difference between
// a default and a copy: change the exercise afterwards and every row that has
// not said otherwise follows it.
eq(expandSets({ ...old, ...added, method: 'drop' }).map((s) => s.method), ['drop', 'drop', 'drop', 'drop'],
  'the exercise method still reaches rows that were added before it was set');
eq(expandSets({ ...old, ...patchSetRow({ ...old, ...added }, 0, { method: 'warmup' }), method: 'drop' }).map((s) => s.method),
  ['warmup', 'drop', 'drop', 'drop'], 'and the one row that overrode it keeps its own');
// It is the same programme it was: the four rows still say what the three did.
eq(expandSets({ ...old, ...added }).map((s) => `${s.reps}@${s.loadKg}`),
  ['8-10@42.5', '8-10@42.5', '8-10@42.5', '8-10@42.5'], 'and nothing about the first three changed');

// The new row copies the one it follows, not the exercise, so a ramp keeps
// ramping.
const ramp: SetSpec = { sets: 2, reps: '5', loadKg: 60, setRows: [{ reps: '5', loadKg: 60 }, { reps: '3', loadKg: 80 }] };
// The WHOLE table, not just the new row: an add that inserted its copy one
// place early would leave the last row looking right and the middle wrong,
// which is exactly what a mutation run slipped past a check of the new row
// alone.
eq(addSetRow(ramp).setRows, [
  { reps: '5', loadKg: 60 },
  { reps: '3', loadKg: 80 },
  { reps: '3', loadKg: 80 },
], 'a set added at the end copies the top set, and the rows before it do not move');
// An exercise with nothing to copy still gains a usable set — and its load is
// an explicit null rather than a key with nothing behind it, because absent
// means "ask the exercise" everywhere this table is read.
const fromNothing = addSetRow({ sets: 0, reps: '10', loadKg: 30 });
eq(fromNothing.setRows, [{ reps: '10', loadKg: 30 }], 'an exercise with no sets gains one from its own spec');
ok(Object.is(addSetRow({ sets: 0, reps: '10' }).setRows[0].loadKg, null),
  'and a bodyweight one gains a row that says null rather than saying nothing');

// ── removing a set ───────────────────────────────────────────────────────
const removed = removeSetRow(ramped, 1);
eq(removed.sets, 2, 'three rows less one is two');
eq(removed.setRows, [
  { reps: '10', loadKg: 42.5 },
  { reps: '8', loadKg: 45 },
], 'the middle row goes and the top set stays with its own load');
// `sets` and the row count are one fact. A table of two carrying `sets: 3`
// would show a client "2/3 sets" with nothing left to log.
eq(removeSetRow(ramped, 1).sets, removeSetRow(ramped, 1).setRows.length, 'sets never lags behind the rows');
eq(addSetRow(old).sets, addSetRow(old).setRows.length, 'nor after an add');
eq(patchSetRow(old, 0, { loadKg: 50 }).sets, 3, 'nor after a patch, which changes no count');

// The last row is not removable.
const single: SetSpec = { sets: 1, reps: '10', loadKg: 20 };
eq(removeSetRow(single, 0).setRows.length, 1, 'the last set stays — an exercise of no sets is not a lighter exercise');
eq(removeSetRow(single, 0).sets, 1, 'and the count with it');
eq(removeSetRow(ramped, 9).setRows.length, 3, 'an index off the end removes nothing');
eq(removeSetRow(ramped, -1).setRows.length, 3, 'and neither does a negative one');
eq(removeSetRow(ramped, -1).setRows[2], { reps: '8', loadKg: 45 },
  'nor does it quietly take the last row, which is what a negative index would do to a slice');

// Removing from the old shape materialises first, so what is left is what was
// on screen rather than two of the three vanishing.
eq(removeSetRow(old, 0).setRows.length, 2, 'removing a set from an untouched exercise leaves the other two');
eq(removeSetRow(old, 0).sets, 2, 'and says so');

// ── changing one row ─────────────────────────────────────────────────────
const patched = patchSetRow(old, 2, { loadKg: 45, reps: '8' });
eq(patched.setRows[2], { reps: '8', loadKg: 45 }, 'the third set is now the heavy one');
eq(patched.setRows[0], { reps: '8-10', loadKg: 42.5 }, 'and the first is untouched');
eq(patched.sets, 3, 'the count is unchanged');
// A patch replaces only its own keys — setting a method must not wipe a load
// typed a second earlier.
const twoEdits = patchSetRow({ ...old, ...patched }, 2, { method: 'drop' });
eq(twoEdits.setRows[2], { reps: '8', loadKg: 45, method: 'drop' }, 'a method lands on top of a load rather than instead of it');
eq(patchSetRow(old, 0, { loadKg: null }).setRows[0], { reps: '8-10', loadKg: null },
  'a row can be cleared to nothing on the bar');
eq(patchSetRow(old, 9, { loadKg: 1 }).setRows, patchSetRow(old, 9, {}).setRows, 'an index off the end changes nothing');
eq(patchSetRow(old, -1, { loadKg: 1 }).setRows[2].loadKg, 42.5, 'and neither does a negative one');

// ── none of it mutates what it was given ─────────────────────────────────
const frozen: SetSpec = { sets: 2, reps: '10', loadKg: 30, setRows: [{ loadKg: 30 }, { loadKg: 30 }] };
const before = JSON.stringify(frozen);
addSetRow(frozen); removeSetRow(frozen, 0); patchSetRow(frozen, 0, { loadKg: 99 }); expandSets(frozen); plannedVolume(frozen);
eq(JSON.stringify(frozen), before, 'the exercise handed in is never written to');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log('setRows ok — an untouched exercise still reads as three of the same set, and a warm-up row is not tonnage');
