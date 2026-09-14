// Whose copy of a conversation this is. Compile with tsc, run with node.
//
// Three failures are guarded here, and the first one puts one coach's private
// conversation with a client on a second coach's screen:
//
//   1. A DEVICE-GLOBAL KEY. `rc:v1:thread:<clientId>` names the thread and not
//      the reader, so two accounts that both coach that client share one cached
//      page of it. The viewer has to be IN the key.
//
//   2. A KEY MINTED WITHOUT AN ACCOUNT. 'unknown', '' and null are not
//      accounts. A key built from one of them is device-global again, wearing a
//      scoped shape.
//
//   3. THE OLD KEY READ RATHER THAN DELETED. The bytes under it carry no
//      account, so nothing can say whose they were. `legacyThreadCacheKey` is
//      for a delete and the test says so by checking it is NOT what the scoped
//      reader looks under.
import { legacyThreadCacheKey, threadCacheKey, usableAccountId } from './threadCache';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const COACH_A = '11111111-1111-1111-1111-111111111111';
const COACH_B = '22222222-2222-2222-2222-222222222222';
const CLIENT = '33333333-3333-3333-3333-333333333333';

/* ── 1 · the viewer is in the key ──────────────────────────────────────── */

{
  const a = threadCacheKey(CLIENT, COACH_A);
  const b = threadCacheKey(CLIENT, COACH_B);
  ok(a !== null && b !== null, 'two signed-in coaches both get a key for a client they both have');
  ok(a !== b, 'and they are different keys: one key for two accounts is one coach reading the other coach’s thread');
  ok(!!a && a.includes(COACH_A), 'the reader is named in their own key');
  ok(!!a && a.includes(CLIENT), 'and so is the thread, because one account has many');
  eq(threadCacheKey(CLIENT, COACH_A), threadCacheKey(CLIENT, COACH_A), 'the same pair is the same key on every render');
}

{
  // The client side: the thread key IS the reader's own id, which is why the
  // old key was accidentally safe there and must stay safe here.
  const own = threadCacheKey(CLIENT, CLIENT);
  ok(own !== null, 'a client reading their own thread has a key');
  ok(own !== threadCacheKey(CLIENT, COACH_A), 'and it is not the one their coach reads under');
}

/* ── 2 · no account, no cache ──────────────────────────────────────────── */

{
  eq(threadCacheKey(CLIENT, null), null, 'a signed-out device keeps nothing');
  eq(threadCacheKey(CLIENT, undefined), null, 'nor one that has not resolved yet');
  eq(threadCacheKey(CLIENT, ''), null, 'an empty id is not an account');
  eq(threadCacheKey(CLIENT, '   '), null, 'nor is whitespace');
  eq(threadCacheKey(CLIENT, 'unknown'), null, '“unknown” is what a resolver says when it could not tell, and it is refused by name');
  eq(threadCacheKey(CLIENT, 'null'), null, 'and so is the string a template literal makes of a null');
  eq(threadCacheKey(CLIENT, 'undefined'), null, 'and of an undefined');
  eq(threadCacheKey(null, COACH_A), null, 'a thread with no key is not cached either');
  eq(threadCacheKey('', COACH_A), null, 'an empty thread id would collide with every other empty one');

  ok(!usableAccountId('unknown'), 'the predicate says the same thing on its own');
  ok(usableAccountId(COACH_A), 'and a real id passes it');
}

/* ── 3 · the legacy key is only ever deleted ───────────────────────────── */

{
  const legacy = legacyThreadCacheKey(CLIENT);
  ok(legacy !== null, 'there is a key to remove');
  ok(!!legacy && legacy.includes(CLIENT), 'it is the thread’s own');
  ok(legacy !== threadCacheKey(CLIENT, COACH_A), 'and it is not what the scoped read looks under, so nothing migrates it by accident');
  ok(legacy !== threadCacheKey(CLIENT, CLIENT), 'including on the client side, where the two halves are the same id');
  eq(legacyThreadCacheKey(null), null, 'and there is nothing to remove without a thread');
}

if (errors.length) {
  console.error(`threadCache: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('threadCache: ok');
