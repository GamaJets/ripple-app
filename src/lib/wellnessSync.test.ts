// The reconciliation the sleep log, the water counter and the coach's
// announcements all run. Compile with tsc, run with node.
//
// Two bugs are guarded here, and neither is arithmetic.
//
// The first is a null that is not an empty array. `mergeLog(null, local)` means
// "the server was not reached" and `mergeLog([], local)` means "the server has
// nothing". Collapse them and a client who logs a night of sleep in a basement
// gym loses it the moment the app next manages to fail a read — which is the
// same class of bug src/ui/loadStatus.ts exists to stop, arriving through the
// merge instead of through the status.
//
// The second is `Math.max` on the water count. It is the obvious way to merge
// two numbers and it silently refuses to let the count go down, so a client
// correcting a miscount watches the correction undo itself.
import {
  LOCAL_PREFIX, WATER_CAP, adoptServerId, byNewest, clampGlasses, isPending,
  localId, mergeCount, mergeLog, type Logged,
} from './wellnessSync';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

interface Night extends Logged { hours: number }
const night = (id: string, at: string, hours = 7): Night => ({ id, at, hours });

/* ── ids: local and server must be distinguishable ──────────────────────── */

ok(isPending(localId()), 'a freshly minted id is pending');
ok(!isPending('9f1c3a2e-0b4d-4c8a-9f21-6b0e1d2c3a4b'), 'a uuid is not pending');
// The specific trap availability.ts's `id.includes('-')` walks into. A uuid has
// hyphens; so, one day, will something else.
ok(!isPending('a-b-c'), 'a hyphenated non-uuid is still not pending — the prefix decides, not the shape');
ok(localId() !== localId(), 'two ids minted in the same millisecond differ');
ok(localId().startsWith(LOCAL_PREFIX), 'local ids carry the prefix');

/* ── mergeLog: null is not empty ────────────────────────────────────────── */

const offline = [night(LOCAL_PREFIX + '1', '2026-08-30T22:00:00Z')];

{
  // The read failed. Everything the device holds stays, and stays pending.
  const m = mergeLog<Night>(null, offline);
  eq(m.entries.length, 1, 'a failed read keeps the offline entry');
  eq(m.pending.length, 1, 'and it is still waiting to be sent');
}
{
  // The read succeeded and the server has nothing. The offline entry is STILL
  // kept — it has never been sent, so the server's silence about it is not
  // evidence of anything.
  const m = mergeLog<Night>([], offline);
  eq(m.entries.length, 1, 'an empty server answer does not discard an unsent entry');
  eq(m.pending.length, 1, 'which is the entry that still has to go up');
}
{
  // A local row carrying a SERVER id that the server no longer returns has been
  // deleted elsewhere. The server is the authority; it goes.
  const stale = [night('9f1c3a2e-0b4d-4c8a-9f21-6b0e1d2c3a4b', '2026-08-29T22:00:00Z')];
  const m = mergeLog<Night>([], stale);
  eq(m.entries.length, 0, 'a confirmed-gone server row is dropped on a successful read');
  const m2 = mergeLog<Night>(null, stale);
  eq(m2.entries.length, 1, 'but a FAILED read leaves it alone — nothing was learnt about it');
  eq(m2.pending.length, 0, 'and it is not pending: it did reach the server once');
}
{
  // The ordinary case: some rows from the server, one still unsent.
  const server = [
    night('11111111-1111-4111-8111-111111111111', '2026-08-29T22:00:00Z'),
    night('22222222-2222-4222-8222-222222222222', '2026-08-28T22:00:00Z'),
  ];
  const m = mergeLog<Night>(server, offline);
  eq(m.entries.length, 3, 'server rows plus the unsent one');
  eq(m.entries[0].id, LOCAL_PREFIX + '1', 'newest first, and the offline night is the newest');
  eq(m.pending.length, 1, 'only the unsent one is pending');
}
{
  // The server has already accepted the row the device thinks is pending —
  // possible when the insert succeeded but the id swap did not land. The server
  // copy wins on id, and no duplicate is shown.
  const dup = [night(LOCAL_PREFIX + '1', '2026-08-30T22:00:00Z')];
  const m = mergeLog<Night>(dup, offline);
  eq(m.entries.length, 1, 'the same id from both sides is one entry, not two');
}

/* ── ordering is total and stable ───────────────────────────────────────── */

{
  const same = [night('b', '2026-08-30T22:00:00Z'), night('a', '2026-08-30T22:00:00Z')];
  const sorted = [...same].sort(byNewest);
  eq(sorted[0].id, 'b', 'a shared timestamp is broken by id, so the order cannot wobble between renders');
  eq([...sorted].sort(byNewest)[0].id, 'b', 'and sorting an already-sorted list does not change it');
}

/* ── adopting the id the server assigned ────────────────────────────────── */

{
  const list = [night(LOCAL_PREFIX + '1', '2026-08-30T22:00:00Z'), night('srv', '2026-08-29T22:00:00Z')];
  const after = adoptServerId(list, LOCAL_PREFIX + '1', 'srv-new');
  eq(after[0].id, 'srv-new', 'the local id is replaced');
  eq(isPending(after[0].id), false, 'so the entry stops being pending');
  eq(after[1].id, 'srv', 'and nothing else moves');
  eq(list[0].id, LOCAL_PREFIX + '1', 'the input list is not mutated');
  // A refresh landed while the insert was in flight and dropped the row.
  // Re-adding it here would resurrect something the user watched disappear.
  eq(adoptServerId([night('srv', '2026-08-29T22:00:00Z')], LOCAL_PREFIX + '9', 'x').length, 1,
    'adopting an id that is no longer in the list adds nothing');
}

/* ── mergeCount: the correction that must not undo itself ───────────────── */

{
  eq(mergeCount(null, null).count, 0, 'nothing anywhere is zero glasses');
  eq(mergeCount(null, null).push, false, 'and there is nothing to send');

  eq(mergeCount(null, { count: 4, at: '2026-08-31T09:00:00Z' }).count, 4, 'device only: the device wins');
  eq(mergeCount(null, { count: 4, at: '2026-08-31T09:00:00Z' }).push, true, 'and the server has to be told');

  eq(mergeCount({ count: 6, at: '2026-08-31T09:00:00Z' }, null).count, 6, 'server only: the server wins');
  eq(mergeCount({ count: 6, at: '2026-08-31T09:00:00Z' }, null).push, false, 'and nothing needs sending');

  // The bug. Local 5 is a correction made after the server saw 6.
  const corrected = mergeCount(
    { count: 6, at: '2026-08-31T09:00:00Z' },
    { count: 5, at: '2026-08-31T10:00:00Z' },
  );
  eq(corrected.count, 5, 'a LOWER but LATER local count wins — Math.max would have undone the correction');
  eq(corrected.push, true, 'and the correction is pushed');

  // The other direction: the client added a glass on their other phone.
  const elsewhere = mergeCount(
    { count: 7, at: '2026-08-31T11:00:00Z' },
    { count: 5, at: '2026-08-31T10:00:00Z' },
  );
  eq(elsewhere.count, 7, 'a newer server count wins');
  eq(elsewhere.push, false, 'and this device has nothing to add');

  // A tie converges on the copy both devices can see.
  const tie = mergeCount(
    { count: 7, at: '2026-08-31T11:00:00Z' },
    { count: 5, at: '2026-08-31T11:00:00Z' },
  );
  eq(tie.count, 7, 'a tie goes to the server, so two phones converge instead of disagreeing forever');
  eq(tie.push, false, 'and a tie sends nothing');

  // Zero is a real answer, not an absence. A client who pressed minus back down
  // to nothing has said something, and it must not be read as "no local copy".
  const zeroed = mergeCount(
    { count: 3, at: '2026-08-31T09:00:00Z' },
    { count: 0, at: '2026-08-31T10:00:00Z' },
  );
  eq(zeroed.count, 0, 'a local zero is a value and wins on recency');
  eq(zeroed.push, true, 'and is pushed like any other correction');
}

/* ── the clamp tracks the column, and the column tracks the goal ────────── */

{
  // part 70 lets a client set a goal of up to 30 glasses; part 109 lets the
  // counter hold up to 30. A cap below the largest permitted goal is a goal
  // nobody can reach.
  eq(WATER_CAP, 30, 'the cap matches clients_water_goal_glasses_check and hydration_logs_glasses_check');
  eq(clampGlasses(31), 30, 'above the cap clamps down');
  eq(clampGlasses(-1), 0, 'below zero clamps up');
  eq(clampGlasses(3.4), 3, 'a fraction of a glass rounds');
  eq(clampGlasses(3.6), 4, 'and rounds the other way too');
  eq(clampGlasses(0), 0, 'zero survives');
  // A null or a string arriving from a cache written by another build must not
  // become NaN, which reaches Array.from({length: NaN}) and renders nothing at
  // all rather than failing visibly.
  //
  // Both land on 0 rather than on the cap. A non-finite value is not a large
  // number of glasses, it is the absence of a number, and 0 is the value that
  // already means "nothing recorded today" everywhere else in this store —
  // whereas clamping Infinity to 30 would put a full row of glasses on the
  // screen and a completed water habit in habit_logs off a parse failure.
  eq(clampGlasses(NaN), 0, 'NaN is not a count');
  eq(clampGlasses(Infinity), 0, 'and neither is infinity — it is the absence of one, not a big one');
  eq(clampGlasses(-Infinity), 0, 'from either end');
}

if (errors.length) {
  console.error(`wellnessSync: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('wellnessSync: ok');
