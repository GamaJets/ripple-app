// Folded days survive a deletion, and follow the day they belong to. Compile
// with tsc, run with node.
//
// The bug these pin: `foldedDays` is keyed by position in the day list, and
// `removeDay` was a bare `filter` that left the map alone. Fold Tuesday, delete
// Monday, and Wednesday — now at index 1 — renders collapsed while Tuesday sits
// open. On the builder screen a day that has closed itself reads as a day whose
// exercises have been lost.
import { foldsAfterRemoval, foldsForNewProgramme, type FoldedDays } from './foldedDays';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The folded indices, ascending, so a whole map can be compared in one line. */
const folded = (f: FoldedDays): number[] => Object.keys(f).map(Number).filter((i) => f[i]).sort((a, b) => a - b);
const same = (f: FoldedDays, want: number[], msg: string) =>
  eq(JSON.stringify(folded(f)), JSON.stringify(want), msg);

/* ── the report ────────────────────────────────────────────────────────────
 * Mon Tue Wed Thu at 0 1 2 3, with Tuesday folded.                          */

const week: FoldedDays = { 1: true };

// Deleting Monday. Tuesday becomes index 0, so the fold must move with it —
// this is the exact case that put the wrong day away.
same(foldsAfterRemoval(week, 0), [0], 'a fold above the removal slides down one');

// Deleting Tuesday itself. Nothing is folded any more, and index 1 — now
// Wednesday — must NOT inherit it.
same(foldsAfterRemoval(week, 1), [], 'the removed day takes its own fold with it');

// Deleting Wednesday or Thursday. Tuesday has not moved.
same(foldsAfterRemoval(week, 2), [1], 'a fold below the removal is left where it is');
same(foldsAfterRemoval(week, 3), [1], 'a removal past every fold changes nothing');

/* ── several folds at once ─────────────────────────────────────────────── */

const many: FoldedDays = { 0: true, 2: true, 4: true };
same(foldsAfterRemoval(many, 1), [0, 1, 3], 'every fold above the removal shifts, and only those');
same(foldsAfterRemoval(many, 0), [1, 3], 'removing a folded first day drops it and shifts the rest');
same(foldsAfterRemoval(many, 4), [0, 2], 'removing the folded last day leaves the others alone');

/* ── the map does not grow ─────────────────────────────────────────────── */

// `toggleDay` writes `false` when a day is opened again, and absence already
// means open. Carrying the falses would grow the map for the life of the screen
// with nothing able to tell them from a key that was never written.
const withFalses: FoldedDays = { 0: false, 1: true, 2: false };
eq(Object.keys(foldsAfterRemoval(withFalses, 0)).length, 1, 'open days are not carried as keys');
same(foldsAfterRemoval(withFalses, 0), [0], 'the one real fold still moves correctly past them');

// A key that cannot name a day cannot fold one. Nothing legitimate writes these
// — this pins that a junk key is dropped rather than shifted into a real index.
const junk = { '-1': true, 1.5: true, 2: true } as unknown as FoldedDays;
same(foldsAfterRemoval(junk, 0), [1], 'keys that are not day indices are dropped');

/* ── input is never mutated ────────────────────────────────────────────── */

// The caller is a React state updater, and a map mutated in place is a state
// object React has already handed out — the fold would apply without a render
// and then disagree with the next one.
const before: FoldedDays = { 1: true, 3: true };
foldsAfterRemoval(before, 0);
same(before, [1, 3], 'the map passed in is left as it was');

/* ── a wholesale replacement keeps nothing ─────────────────────────────── */

// Loading a template or a client's programme replaces every day, so an index
// that was folded now names a day the coach has never seen.
eq(Object.keys(foldsForNewProgramme()).length, 0, 'a new programme starts with nothing folded');
ok(foldsForNewProgramme() !== foldsForNewProgramme(), 'each caller gets its own map, not a shared one');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('foldedDays: ok');
