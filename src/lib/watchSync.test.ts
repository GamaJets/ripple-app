// The phone/watch contract. Compile with tsc, run with node.
import { parseWatchMessage, setDoneApplies, type WatchState } from './watchSync';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };

const st: WatchState = { v: 1, kind: 'state', session: { exercise: 'Back Squat', exerciseIndex: 0, exerciseCount: 4, setIndex: 1, setCount: 3, targetReps: '8', targetLoad: '80 kg', restEndsAt: null } };
const done = parseWatchMessage({ v: 1, kind: 'set-done', id: 'a1', exerciseIndex: 0, setIndex: 1, reps: 8 });
ok(!!done && done.kind === 'set-done', 'a valid set-done parses');
ok(parseWatchMessage({ v: 2, kind: 'set-done', id: 'x', exerciseIndex: 0, setIndex: 0 }) === null, 'another protocol version is refused');
ok(parseWatchMessage({ v: 1, kind: 'set-done', id: '', exerciseIndex: 0, setIndex: 0 }) === null, 'no idempotency key is refused');
ok(parseWatchMessage({ v: 1, kind: 'set-done', id: 'x', exerciseIndex: 0, setIndex: 0, reps: -1 }) === null, 'negative reps refused');
ok(parseWatchMessage('junk') === null, 'junk refused');
if (done && done.kind === 'set-done') {
  ok(setDoneApplies(done, st, new Set()), 'applies to the set on screen');
  ok(!setDoneApplies(done, st, new Set(['a1'])), 'a resend is not logged twice');
  ok(!setDoneApplies({ ...done, setIndex: 0 }, st, new Set()), 'a stale set is dropped');
  ok(!setDoneApplies(done, { ...st, session: null }, new Set()), 'no session, nothing applies');
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('watchSync ok');
