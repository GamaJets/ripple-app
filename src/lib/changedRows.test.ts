// A series write that changed nothing, announced as a series that changed.
// Compile with tsc, run with node.
//
// Every assertion here is about a sentence a coach reads immediately after
// acting on a whole term at once, and the one it replaces was this:
//
//     Series called off
//     0 classes were called off. … Nobody had booked or was waiting, so there
//     was nobody to tell.
//
// So the tests are mostly about what must NOT be produced:
//
//   1. null for zero. A screen treats null as "announce it", and zero rows is
//      the ordinary outcome of a policy that filters — which is what
//      app/(trainer)/classes.tsx's own header says happens when a coach acts on
//      a class that is not theirs;
//   2. the same sentence for zero and for a missing count. One says the server
//      matched nothing, the other says nobody counted, and only the second is
//      evidence of a call site that forgot to ask;
//   3. a refusal that states which of two innocent readings applied when the
//      writer cannot tell them apart.
import { changedFailure, assertChanged } from './changedRows';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1. a write that landed is not reported ───────────────────────────────*/

{
  eq(changedFailure('That series', 1), null, 'one row changed is a write that happened');
  eq(changedFailure('That series', 12), null, 'and so is a whole term of them');
}

/* ── 2. zero rows is a refusal, and says so in the coach's words ──────────*/

{
  const why = changedFailure('That series', 0);
  ok(why != null, 'zero rows is NEVER null — null is what makes a screen announce it');
  ok((why as string).startsWith('That series'), 'the subject is the coach’s word for the thing, not a column name');
  ok((why as string).includes('not yours to change'),
    'and it names the cause the policies actually produce: a filtered write, not an error');
  ok(!(why as string).includes('0 classes'),
    'the count itself is not repeated back — "0 classes were called off" is the sentence this replaces');
}

/* ── 3. the second innocent reading, where the writer has one ─────────────*/

{
  // `cancelSeriesFrom` carries `.neq('status', 'cancelled')`, so a term that is
  // already off matches nothing for a reason that is not a refusal.
  const why = changedFailure('Those classes', 0, 'they were already called off') as string;
  ok(why.includes('already called off'), 'the innocent reading is offered');
  ok(why.includes('not yours to change'),
    'and it is offered BESIDE the refusal, never instead of it — the write cannot tell which happened');
  const bare = changedFailure('That series', 0) as string;
  ok(!bare.includes(', or '),
    'a writer with only one reading does not get an "or" clause with nothing on the other side');
}

/* ── 4. nobody counted is not the same as nothing matched ─────────────────*/

{
  const missing = changedFailure('That series', null) as string;
  const zero = changedFailure('That series', 0) as string;
  ok(missing !== zero, 'a missing count and a zero count are different sentences');
  ok(missing.includes('did not say how many'),
    'and the missing one names the omission, which is what makes a forgetful call site findable');
  eq(changedFailure('That series', undefined), missing, 'undefined is the same omission as null');
  eq(changedFailure('That series', NaN), missing, 'and so is a NaN, which is what Number() gives for a count that was text');
}

/* ── 5. a negative count is not a number of rows ──────────────────────────*/

{
  const why = changedFailure('That series', -1) as string;
  ok(why != null && why.includes('not a number of rows'),
    'a negative count is reported rather than read as "nothing changed" or waved through');
}

/* ── 6. the throwing form carries the same sentence ───────────────────────*/

{
  let threw: string | null = null;
  try { assertChanged('That series', 0); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  eq(threw, changedFailure('That series', 0),
    'assertChanged throws the exact sentence changedFailure returns, so a catch can show it unedited');

  let ok1 = true;
  try { assertChanged('That series', 3); } catch { ok1 = false; }
  ok(ok1, 'and a write that landed passes through silently');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CHANGED ROWS FAILURES:\n' + errors.join('\n') : 'changedRows: ok — a series write that matched nothing can no longer be announced as one that did');
if (errors.length) process.exit(1);
