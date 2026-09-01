import { applyMove, shifts, targetIndex } from './dragReorder';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

// Four rows of 100. Row 0 spans 0-100, row 1 100-200, and so on.
const even = [100, 100, 100, 100];

// ── Not moving far enough is not moving ───────────────────────────────────
eq(targetIndex(even, 0, 0), 0, 'no drag, no move');
eq(targetIndex(even, 0, 20), 0, 'a nudge does not reorder');
eq(targetIndex(even, 2, -30), 2, 'nor does a nudge upward');

// ── Half a row is the threshold, because the row goes where its middle is ─
// Dragging row 0 down: its centre starts at 50. The rows below have closed up,
// so row 1 now occupies 0-100 with midpoint 50. Passing 50 means passing it.
eq(targetIndex(even, 0, 51), 1, 'just past the next row swaps with it');
eq(targetIndex(even, 0, 49), 0, 'just short of it does not');
eq(targetIndex(even, 0, 151), 2, 'past two rows moves two places');
eq(targetIndex(even, 0, 400), 3, 'dragged off the bottom lands last, never past the end');
eq(targetIndex(even, 3, -400), 0, 'dragged off the top lands first');
eq(targetIndex(even, 3, -51), 2, 'upward, half a row is the same threshold');

// ── Uneven rows are the whole reason heights are passed in ────────────────
// A tall note on one exercise. With a fixed row height this is where a drag
// lands somewhere nobody aimed at.
const uneven = [60, 300, 60, 60];
eq(targetIndex(uneven, 0, 100), 0, 'a short row does not displace a tall one too early');

// ── Refusals: an uncertain answer leaves the order alone ──────────────────
eq(targetIndex(even, 0, NaN), 0, 'a NaN offset never reorders');
eq(targetIndex(even, 0, Infinity), 0, 'nor does an infinite one');
eq(targetIndex([100, 0, 100], 0, 500), 0, 'a zero-height row means the list is not measured yet');
eq(targetIndex([100, NaN, 100], 0, 500), 0, 'nor is one with an unmeasured row');
eq(targetIndex(even, 9, 50), 9, 'an out-of-range start is returned untouched');
eq(targetIndex(even, -1, 50), -1, 'and so is a negative one');
eq(targetIndex([100], 0, 500), 0, 'one row cannot be reordered');
eq(targetIndex([], 0, 50), 0, 'nor can none');
eq(targetIndex(even, 1.5, 50), 1.5, 'a fractional index is refused rather than rounded');

// ── applyMove ─────────────────────────────────────────────────────────────
eq(applyMove(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'], 'moving down');
eq(applyMove(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'], 'moving up');
eq(applyMove(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c'], 'moving nowhere');
// The SAME reference, so an accidental pixel of drag is not an edit against a
// programme somebody is part way through writing.
const same = ['a', 'b', 'c'];
ok(applyMove(same, 1, 1) === same, 'a no-op returns the same array, not a copy');
ok(applyMove(same, 0, 9) === same, 'and so does an out-of-range destination');
ok(applyMove(same, 0, 1) !== same, 'a real move returns a new array');

// ── shifts: the gap that opens under the finger ───────────────────────────
eq(shifts(even, 0, 2), [0, -100, -100, 0], 'rows between origin and target move up by one row');
eq(shifts(even, 3, 1), [0, 100, 100, 0], 'and down when the drag goes up');
eq(shifts(even, 1, 1), [0, 0, 0, 0], 'nothing shifts when nothing moves');
eq(shifts(uneven, 0, 2), [0, -60, -60, 0], 'they shift by the DRAGGED row height, not their own');
eq(shifts(even, 0, 3), [0, -100, -100, -100], 'a full-length drag shifts every other row');
// Rows outside the span are untouched — the list reads as one row changing
// place, not the whole day sliding about.
eq(shifts([100, 100, 100, 100, 100], 1, 2)[4], 0, 'a row past the destination does not move');
eq(shifts(even, 0, 9), [0, 0, 0, 0], 'an out-of-range destination shifts nothing');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log('dragReorder ok — a row displaces its neighbour at half the neighbour height, and uneven rows are why heights are measured');
