// Deleting something you can take back. Compile with tsc, run with node.
//
// The rule the whole thing hangs on, and the only one worth stating twice:
// a staged delete has exactly two ends. It is written, or it is undone. There
// is no third outcome, and every assertion below is a way of trying to produce
// one — by staging a second delete, by undoing after the window, by undoing
// something that was never staged, by leaving the screen.
import {
  UNDO_WINDOW_MS, due, hiddenIds, isDue, remainingMs, stage, undo, type Undoable,
} from './undoable';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const T0 = 1_770_000_000_000;
const item = (id: string, atMs = T0): Undoable<string> => ({ id, atMs, payload: `write ${id}` });

/* ── the window ──────────────────────────────────────────────────────────── */

eq(UNDO_WINDOW_MS, 6000, 'the window is six seconds');

ok(!isDue(item('a'), T0), 'a delete just staged is not due');
ok(!isDue(item('a'), T0 + UNDO_WINDOW_MS - 1), 'nor is it a millisecond before the window closes');
ok(isDue(item('a'), T0 + UNDO_WINDOW_MS), 'it is due exactly when the window closes');
ok(isDue(item('a'), T0 + 60_000), 'and long after');

// A clock that will not read is not "plenty of time left". The write is the
// thing the person asked for; the undo is the courtesy. When the arithmetic
// cannot be done, the write wins.
ok(isDue({ id: 'a', atMs: NaN, payload: 'x' }, T0), 'an unreadable stage time is due, not pending');
ok(isDue(item('a'), NaN), 'an unreadable now is due, not pending');

eq(remainingMs(item('a'), T0), UNDO_WINDOW_MS, 'the whole window is left at the moment it is staged');
eq(remainingMs(item('a'), T0 + 2000), 4000, 'and four seconds after two have gone');
eq(remainingMs(item('a'), T0 + 99_999), 0, 'never a negative number of seconds left');
eq(remainingMs(item('a'), NaN), 0, 'and never NaN');

/* ── staging ─────────────────────────────────────────────────────────────── */

const first = stage([], item('a'), T0);
same(hiddenIds(first.queue), ['a'], 'the staged row is the one to hide');
eq(first.commit.length, 0, 'and nothing is written yet');

// A second delete while the first is still offered back. There is one bar at
// the bottom of the screen and one Undo on it, so the first one stands. What
// must NOT happen is the first being dropped: nobody undid it.
const second = stage(first.queue, item('b', T0 + 1000), T0 + 1000);
same(hiddenIds(second.queue), ['b'], 'the new one is what is offered back now');
same(second.commit.map((c) => c.id), ['a'], 'and the one it replaced is WRITTEN, not dropped');

// The same row staged twice. One row, one delete — writing both would be one
// delete and one error about a row that is already gone.
const twice = stage(first.queue, item('a', T0 + 500), T0 + 500);
same(hiddenIds(twice.queue), ['a'], 'the same row restaged is still one row');
eq(twice.commit.length, 0, 'and is not written twice');
eq(twice.queue[0].atMs, T0 + 500, 'its window restarts from the second tap');

/* ── the window closing ──────────────────────────────────────────────────── */

const openStill = due([item('a')], T0 + 1000);
eq(openStill.commit.length, 0, 'nothing is written while the window is open');
same(hiddenIds(openStill.queue), ['a'], 'and the row stays hidden');

const closed = due([item('a')], T0 + UNDO_WINDOW_MS);
same(closed.commit.map((c) => c.id), ['a'], 'the write happens when the window closes');
same(closed.queue, [], 'and nothing is left pending');

const mixed = due([item('a', T0), item('b', T0 + 5000)], T0 + UNDO_WINDOW_MS);
same(mixed.commit.map((c) => c.id), ['a'], 'only the one whose window closed is written');
same(hiddenIds(mixed.queue), ['b'], 'the other is still takeable back');

/* ── taking it back ──────────────────────────────────────────────────────── */

const back = undo([item('a')], 'a', T0 + 2000);
eq(back.undone?.id, 'a', 'an open window can be taken back');
same(back.queue, [], 'and nothing is left to write');

// THE assertion. After the window, the write has already gone out. Reporting
// this as undone would put a row back on screen that no longer exists on the
// server, which is the same lie as a delete that silently failed.
const late = undo([item('a')], 'a', T0 + UNDO_WINDOW_MS);
eq(late.undone, null, 'a closed window cannot be taken back, and says so');
same(hiddenIds(late.queue), ['a'], 'and the pending write is left exactly where it was');

eq(undo([item('a')], 'b', T0).undone, null, 'an id that was never staged undoes nothing');
eq(undo([], 'a', T0).undone, null, 'and neither does an empty queue');
same(undo([item('a')], 'b', T0).queue.map((q) => q.id), ['a'], 'an unknown id leaves the queue alone');

// Undoing one of two leaves the other pending. Nothing about taking one back
// is a decision about anything else the person deleted.
const two = [item('a', T0), item('b', T0 + 100)];
const oneBack = undo(two, 'a', T0 + 200);
eq(oneBack.undone?.id, 'a', 'the named one comes back');
same(hiddenIds(oneBack.queue), ['b'], 'and only that one');

/* ── the payload is carried, not inspected ───────────────────────────────── */

// The queue holds the WRITE, not a description of it. That is what makes the
// commit unconditional: by the time it runs there is nothing left to decide.
eq(stage([], item('a'), T0).queue[0].payload, 'write a', 'the payload is carried through staging');
eq(due([item('a')], T0 + UNDO_WINDOW_MS).commit[0].payload, 'write a', 'and handed back to be run when due');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('undoable: ok');
