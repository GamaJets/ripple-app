// What a read may and may not take away. Compile with tsc, run with node.
//
// Three outcomes, and the two that were missing are each somebody training the
// wrong thing:
//
//   1. A REMOVAL THAT NEVER ARRIVES. A coach takes somebody off a block. The
//      read comes back with zero rows, the old merge skipped empty answers
//      entirely, and the member went on being shown the ended block under
//      'ready' until the app was killed. src/lib/readRefresh.ts now keeps a
//      session alive across days, so "until it is killed" is no longer a
//      bounded amount of time.
//
//   2. A LIVE BLOCK DELETED BY A LONG ROSTER. The read is capped. A client
//      whose row sat past the cap is absent from a truncated page for a reason
//      that has nothing to do with them, and a replace would take their real
//      programme off their real screen.
//
//   3. A COACH'S OWN TAP ERASED. The map is written optimistically so the
//      screen answers the tap. A read that started before that write returns
//      the world without it; replacing then deletes the entry, and the write
//      that is about to succeed does not put it back.
import { mayDrop, mergeAssignments, mergeStartsOn, type ReadFacts } from './assignmentMerge';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const keys = (o: Record<string, unknown>) => Object.keys(o).sort().join(',');

const WHOLE: ReadFacts = { whole: true, writesInFlight: 0 };
const PREFIX: ReadFacts = { whole: false, writesInFlight: 0 };
const BUSY: ReadFacts = { whole: true, writesInFlight: 1 };

/* ── 1 · a removal arrives ────────────────────────────────────────────── */
{
  const after = mergeAssignments({ ana: 'Block A' }, {}, WHOLE);
  eq(keys(after), '', 'a whole read with no rows takes the ended block off the screen');
  const swapped = mergeAssignments({ ana: 'Block A', bo: 'Block B' }, { ana: 'Block C' }, WHOLE);
  eq(keys(swapped), 'ana', 'and removes only the person the server no longer lists');
  eq(swapped.ana, 'Block C', 'while taking the new block for the one it does');
}

/* ── 2 · a prefix proves nothing ──────────────────────────────────────── */
{
  const after = mergeAssignments({ ana: 'Block A', bo: 'Block B' }, { ana: 'Block A' }, PREFIX);
  eq(keys(after), 'ana,bo', "a truncated page does not delete the client whose row sat past the cap");
  const empty = mergeAssignments({ ana: 'Block A' }, {}, PREFIX);
  eq(keys(empty), 'ana', 'not even when the page it did return was empty');
}

/* ── 3 · a write in flight is not yet in a read ───────────────────────── */
{
  const after = mergeAssignments({ ana: 'Just assigned' }, {}, BUSY);
  eq(keys(after), 'ana', "a read that raced the coach's own tap does not erase it");
  eq(mayDrop({ whole: true, writesInFlight: 12 }), false, 'a bulk assign is twelve writes and the read waits for all of them');
  eq(mayDrop({ whole: true, writesInFlight: 0 }), true, 'and drops once none are outstanding');
  eq(mayDrop({ whole: false, writesInFlight: 0 }), false, 'a prefix never drops however quiet the device is');
}

/* ── the server's answer is taken, not aliased ────────────────────────── */
{
  const server: Record<string, string> = { ana: 'Block A' };
  const after = mergeAssignments({}, server, WHOLE);
  server.bo = 'added after the read loop finished';
  eq(keys(after), 'ana', 'the caller holds its own copy, not the map the read is still filling');
}

/* ── start dates follow the assignment they belong to ─────────────────── */
{
  const kept = mergeAssignments({ ana: 'A', bo: 'B' }, { ana: 'A' }, WHOLE);
  const dates = mergeStartsOn({ ana: '2026-01-05', bo: '2026-02-02' }, { ana: '2026-01-05' }, kept, WHOLE);
  eq(keys(dates), 'ana', 'a date for somebody taken off their block goes with it — there is no week one of nothing');
  eq(dates.ana, '2026-01-05', 'and the one still on a block keeps theirs');
}
{
  const kept = mergeAssignments({ ana: 'A' }, { ana: 'A' }, WHOLE);
  const cleared = mergeStartsOn({ ana: '2026-01-05' }, {}, kept, WHOLE);
  eq(Object.prototype.hasOwnProperty.call(cleared, 'ana'), false, 'a coach clearing a start date is a real edit, and absence is how this app spells "they did not say"');
}
{
  const kept = mergeAssignments({ ana: 'A', bo: 'B' }, { ana: 'A' }, PREFIX);
  const dates = mergeStartsOn({ ana: '2026-01-05', bo: '2026-02-02' }, {}, kept, PREFIX);
  eq(keys(dates), 'ana,bo', 'and a truncated page cannot take a start date away either');
}
{
  // The orphan case on its own: a date whose programme is gone must not survive
  // even when the date map still lists it.
  const dates = mergeStartsOn({ ghost: '2026-03-03' }, { ghost: '2026-03-03' }, {}, WHOLE);
  eq(keys(dates), '', 'a start date with no assignment left is dropped rather than printed over a generic programme');
}

if (errors.length) {
  console.error(`assignmentMerge: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('assignmentMerge: ok');
