// Tests for staleRead — the four states of a screen that can be asked again.
//
// The bug: an owner is looking at a correct register, pulls down out of habit,
// the phone is in a lift for two seconds, and the list empties in front of them.
// The catch that did that (`setRows(null)`) was written when the screen read
// once on mount, where blanking a blank page cost nothing. Pull-to-refresh made
// failure-after-success routine and nothing downstream was changed with it.
//
// The fix cannot simply keep the rows, because the reason the old code nulled
// them is also real: `setRows([])` renders as "Nobody on the register yet",
// which is a claim about somebody's business produced by a query that failed.
// So the assertions below are mostly about the boundary between those two —
// which state may word an empty list as an empty gym, and which may not.
//
// Compile with tsc then run with node, like readAll.test.ts.
import {
  readState, hasRows, canSayEmpty, isCurrent, staleNote, failedNote,
  type ReadState,
} from './staleRead';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the four combinations ────────────────────────────────────────────────── */

eq(readState(null, false), 'loading', 'nothing held and nothing failed is the first read');
eq(readState(null, true), 'failed', 'nothing held and a failure is a screen with nothing');
eq(readState([], false), 'ready', 'an empty read that landed is ready, not loading');
eq(readState([{ id: 1 }], false), 'ready', 'rows that landed are ready');
eq(readState([], true), 'stale', 'an empty EARLIER read plus a failed refresh is stale');
eq(readState([{ id: 1 }], true), 'stale', 'rows plus a failed refresh is stale, not failed');

// undefined is the same "we have nothing" as null. A screen holding
// `rows: T[] | null` will never pass it, but a `useState<T[]>()` without an
// initial value produces undefined and would otherwise read as 'ready'.
eq(readState(undefined, false), 'loading', 'undefined is nothing held');
eq(readState(undefined, true), 'failed', 'undefined with a failure is nothing held');

/* ── the regression this exists to prevent ────────────────────────────────── */
//
// Rows on screen, then a refresh fails. The state must be one that still draws
// them. If this ever returns 'failed', the register empties in a lift again.
const held = [{ id: 'a' }, { id: 'b' }];
ok(hasRows(readState(held, true)), 'a failed refresh over real rows still draws the rows');
ok(!isCurrent(readState(held, true)), 'but it is not claimed to be current');

/* ── who may say "nothing" ────────────────────────────────────────────────── */

ok(canSayEmpty('ready'), 'a read that landed empty may be stated as empty');
ok(canSayEmpty('stale'), 'an EARLIER read that landed empty was genuinely empty then');
ok(!canSayEmpty('failed'), 'a screen that never read anything may not state an emptiness');
ok(!canSayEmpty('loading'), 'a screen still reading may not state an emptiness either');

eq(hasRows('loading'), false, 'nothing to draw while loading');
eq(hasRows('failed'), false, 'nothing to draw after a total failure');
eq(isCurrent('stale'), false, 'stale is not current');
eq(isCurrent('failed'), false, 'failed is not current');
eq(isCurrent('loading'), false, 'loading is not current');
eq(isCurrent('ready'), true, 'only ready is current');

// Every state is answered by every predicate — no state falls through to a
// default that happens to be the permissive one.
const all: ReadState[] = ['loading', 'ready', 'stale', 'failed'];
for (const s of all) {
  eq(typeof hasRows(s), 'boolean', `hasRows answers ${s}`);
  eq(typeof canSayEmpty(s), 'boolean', `canSayEmpty answers ${s}`);
  eq(typeof isCurrent(s), 'boolean', `isCurrent answers ${s}`);
  // canSayEmpty and hasRows are the same gate today. Asserted rather than
  // assumed: if they ever come apart, a screen wording an empty list is what
  // breaks, and it breaks silently.
  eq(canSayEmpty(s), hasRows(s), `${s} may state an emptiness exactly when it has rows`);
}

/* ── the copy ─────────────────────────────────────────────────────────────── */

const st = staleNote('register');
ok(st.includes('did not come back'), 'the stale sentence names the refresh as what failed');
ok(st.includes('not confirmed current'), 'the stale sentence does not claim the rows are current');
ok(st.includes('Nothing in your gym has changed'),
   'the stale sentence separates a failed refresh from a change in the gym');
ok(!/\bago\b/.test(st), 'the stale sentence does not restate the age — Fetched owns that');

const stWhy = staleNote('order book', 'the network is unreachable');
ok(stWhy.includes('the network is unreachable'), 'a reason is carried into the stale sentence');
ok(stWhy.includes('order book'), 'the stale sentence names the set');
eq(staleNote('register', null), st, 'a null reason reads exactly as no reason');
eq(staleNote('register', '   '), st, 'a blank reason is not a reason');

const fl = failedNote('register');
ok(fl.includes('could not be read'), 'the failed sentence says the read did not come back');
ok(fl.includes('not an empty register'),
   'the failed sentence refuses the empty-result reading outright');
ok(fl.includes('Nothing has been cleared'),
   'the failed sentence says the gym is unchanged');
eq(failedNote('order book', ''), failedNote('order book'), 'an empty reason is not a reason');
ok(failedNote('order book', 'the read came back at its limit').includes('the read came back at its limit'),
   'a TruncatedRead message survives into the failed sentence');

// The two sentences must never be interchangeable: 'stale' has rows behind it
// and 'failed' does not, and an owner reading the wrong one draws the wrong
// conclusion about whether the figures above mean anything.
ok(st !== fl, 'stale and failed are different sentences');
ok(!fl.includes('What is shown'), 'the failed sentence does not refer to rows it does not have');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('staleRead.test.ts: ok');
