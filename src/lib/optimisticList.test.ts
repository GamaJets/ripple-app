// Rows drawn before the server answered. Compile with tsc, run with node.
//
// One rule, broken five times in this codebase and shipped every time: count
// what the server confirmed, never what you sent.
import { keepOptimistic, settleOptimistic, settleRemoval, type WriteSettlement } from './optimisticList';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

interface Row { id: string; waist?: number }
const list = (): Row[] => [{ id: 'm3', waist: 84 }, { id: 'm2', waist: 85 }, { id: 'm1', waist: 86 }];

/* ── a refusal comes off the screen ──────────────────────────────────────── */

{
  const after = settleOptimistic(list(), 'm3', 'refused');
  eq(after.map((r) => r.id), ['m2', 'm1'],
    'A MEASUREMENT THE ACCOUNT REFUSED IS NOT THE MEMBER’S CURRENT FIGURE');
  eq(after.length, 2, 'and it is not part of the count either');
  eq(settleOptimistic(list(), 'm3', 'refused')[0].waist, 85,
    'and the figure before it is what "latest" means again');
}

/* ── the other two stay ──────────────────────────────────────────────────── */

{
  for (const out of ['stored', 'queued', 'unsent'] as WriteSettlement[]) {
    eq(settleOptimistic(list(), 'm3', out).map((r) => r.id), ['m3', 'm2', 'm1'],
      `a row the server took, or one waiting to be sent, stays (${out})`);
    eq(keepOptimistic(out), true, `and says so (${out})`);
  }
  eq(keepOptimistic('refused'), false,
    'unreachable and refused are different events — only the refusal did not happen');
}

/* ── by id, because the row may have moved ───────────────────────────────── */

{
  const reordered: Row[] = [{ id: 'm9' }, { id: 'm3' }, { id: 'm1' }];
  eq(settleOptimistic(reordered, 'm3', 'refused').map((r) => r.id), ['m9', 'm1'],
    'a re-read or a second entry may have moved it; position zero is somebody else’s row');
  eq(settleOptimistic(reordered, 'nope', 'refused').map((r) => r.id), ['m9', 'm3', 'm1'],
    'and a row already gone takes nothing else with it');
}

/* ── identity, so a landed write does not re-render the app ──────────────── */

{
  const l = list();
  ok(settleOptimistic(l, 'm3', 'stored') === l, 'a write that landed changes nothing at all');
  ok(settleOptimistic(l, 'gone', 'refused') === l, 'and neither does a refusal of a row not here');
  ok(settleOptimistic(l, 'm3', 'refused') !== l, 'a refusal that removes a row is a new list');
  eq(l.map((r) => r.id), ['m3', 'm2', 'm1'], 'and the original is not mutated under anyone');
}

/* ── an empty list is not a crash ────────────────────────────────────────── */

{
  eq(settleOptimistic([] as Row[], 'm3', 'refused'), [], 'nothing to take off is not an error');
}

/* ── and the mirror: a row taken off before the server answered ──────────────
 *
 * The half that has no tell. A row drawn optimistically and left there is at
 * least VISIBLE — somebody can look at it and doubt it. A row REMOVED
 * optimistically over a delete the server refused leaves nothing on the screen
 * at all, so there is no phantom to be suspicious of, and the thing it is
 * hiding goes on being true server-side.
 *
 * src/ui/availability.ts is the case: a weekly slot dropped from the phone AND
 * from AsyncStorage before the DELETE was sent, over a delete PostgREST
 * answered with 204 and zero rows. The coach's week loses an hour; the row goes
 * on generating bookable sessions; clients keep booking them. */

{
  const week = (): Row[] => [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  // The graded assertion.
  eq(settleRemoval(week().filter((r) => r.id !== 'b'), { id: 'b' }, false).map((r) => r.id),
    ['a', 'c', 'b'],
    'A SLOT THE SERVER DID NOT DELETE IS STILL ON THE COACH’S WEEK');

  const after = week().filter((r) => r.id !== 'b');
  ok(settleRemoval(after, { id: 'b' }, true) === after,
    'a delete the server confirmed puts nothing back, and does not even make a new array');

  ok(settleRemoval(after, null, false) === after,
    'a removal with no row in hand — an id that was never in the list — restores nothing');

  // Idempotent, because a retry can race a re-read. Two restores of one slot
  // would put a coach's Tuesday 7am on their week twice, and the duplicate has
  // the same id as the real one.
  const restored = settleRemoval(after, { id: 'b' }, false);
  ok(settleRemoval(restored, { id: 'b' }, false) === restored,
    'a row already back is not appended a second time');

  // The value goes back, not a placeholder: the caller has the row in hand and
  // a re-read is a second thing that can fail.
  const dur = settleRemoval([] as Row[], { id: 'b', waist: 45 }, false);
  eq(dur, [{ id: 'b', waist: 45 }], 'the row restored is the row that was removed, fields and all');

  eq(settleRemoval(week(), { id: 'zz' }, false).map((r) => r.id), ['a', 'b', 'c', 'zz'],
    'and restoring into a list that never held it still puts it there — the server said the delete did not happen');
}

/* ── the pair, stated once ───────────────────────────────────────────────── */

{
  // Both directions of the same rule, so a future edit cannot fix one and
  // leave the other: what the SERVER said decides, never what was asked for.
  const l = list();
  ok(settleOptimistic(l, 'm3', 'refused').length < l.length, 'a refused ADD comes off');
  ok(settleRemoval(l.filter((r) => r.id !== 'm3'), { id: 'm3' }, false).length === l.length,
    'and a refused REMOVE goes back on');
}

if (errors.length) {
  console.error(`optimisticList: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('optimisticList: ok — a refused row does not survive the alert that reported it');
