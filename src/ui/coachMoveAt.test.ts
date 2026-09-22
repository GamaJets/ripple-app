// Reading the server's answer to "move this session to an hour nobody opened".
// Compile with tsc, run with node.
//
// Nothing here makes a request. `readMoveAtReport` is the pure half of
// src/ui/coachMoveAt.ts — it takes the jsonb that
// `reschedule_client_session_at` returns and says what is in it — and it is the
// half that can be wrong in a way a coach reads out loud.
//
// ── the assertion this file exists for ────────────────────────────────────
//
// The line was `waiting: Number(r.waiting) || 0`. An absent key, a null, an
// empty string and a NaN all came out of that as the number 0, and 0 is the
// value `coachMovedLine` turns into
//
//     "<hour> is open again on your calendar and nobody was waiting for it."
//
// A waiting count is the one number that must never settle to zero on its own:
// "nobody is waiting" is exactly the claim that cannot be made from an unknown,
// and a coach who believes it offers the hour to somebody else. So a counted
// zero and an unanswered question must be distinguishable after this function,
// and `waitingKnown` is how.
import { readMoveAtReport, MOVE_AT_UNREACHABLE } from './coachMoveAt';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CLIENT = '11111111-2222-3333-4444-555555555555';
const NEW_SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PROMOTED = '99999999-8888-7777-6666-555555555555';

/** The success payload exactly as supabase/parts/1830 builds it. */
const moved = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  moved: true,
  reason: null,
  client: CLIENT,
  session: NEW_SESSION,
  from_at: '2026-09-14T07:00:00.000Z',
  to_at: '2026-09-15T18:00:00.000Z',
  charged: false,
  credit_drawn: false,
  promoted: null,
  waiting: 0,
  ...over,
});

/* ── a counted queue, and a counted empty queue ────────────────────────── */

{
  const r = readMoveAtReport(moved({ waiting: 2 }));
  eq(r.moved, true, 'the server said the session moved');
  eq(r.waiting, 2, 'two people are still in line for the hour that was freed');
  eq(r.waitingKnown, true, 'and the server counted them');
}

{
  // The important half of the distinction: a zero the server actually counted
  // is a zero the coach may be told about.
  const r = readMoveAtReport(moved({ waiting: 0 }));
  eq(r.waiting, 0, 'a counted empty queue is zero');
  eq(r.waitingKnown, true, 'and it is known to be empty, which is a thing that can be said');
}

/* ── every way of not being told ───────────────────────────────────────── */

{
  const { waiting: _omit, ...noKey } = moved();
  const r = readMoveAtReport(noKey);
  eq(r.waitingKnown, false, 'an answer with no waiting key at all did not count anybody');
  eq(r.moved, true, 'and it is still a move that happened — the unknown is about the queue, not the move');
}

eq(readMoveAtReport(moved({ waiting: null })).waitingKnown, false,
  'a null waiting count is not a count of nobody');
eq(readMoveAtReport(moved({ waiting: '' })).waitingKnown, false,
  'an empty string is not a count of nobody, however readily Number() makes it one');
eq(readMoveAtReport(moved({ waiting: 'none' })).waitingKnown, false,
  'a word is not a count');
eq(readMoveAtReport(moved({ waiting: NaN })).waitingKnown, false,
  'a NaN is not a count');
eq(readMoveAtReport(moved({ waiting: -1 })).waitingKnown, false,
  'a negative number is not a queue length');
eq(readMoveAtReport(moved({ waiting: 2.5 })).waitingKnown, false,
  'half a person is not a queue length');
eq(readMoveAtReport(moved({ waiting: true })).waitingKnown, false,
  'a boolean is not a count');
eq(readMoveAtReport(moved({ waiting: [] })).waitingKnown, false,
  'and neither is an empty array, which Number() also calls zero');

// A count of people is not the same as a count of people the app invented, so
// every unknown above must leave the figure at the value that changes nothing
// on screen today rather than at some other guess.
for (const v of [undefined, null, '', 'none', NaN, -1, 2.5, true, []]) {
  eq(readMoveAtReport(moved({ waiting: v })).waiting, 0,
    `an unreadable waiting value (${JSON.stringify(v) ?? 'undefined'}) leaves the figure where it was`);
}

// A number the RPC hands back as a string of digits is still a count — jsonb
// numbers arrive as numbers, but a bigint count is one edit from being a
// string and refusing it would invent an unknown just as badly.
{
  const r = readMoveAtReport(moved({ waiting: '3' }));
  eq(r.waiting, 3, 'a string of digits is read as the number it is');
  eq(r.waitingKnown, true, 'and it is a count');
}

/* ── the rest of the reading, which must not have changed ──────────────── */

{
  const r = readMoveAtReport(moved({ promoted: PROMOTED, waiting: 1 }));
  eq(r.promoted, true, 'a promoted booking id means somebody got the freed hour');
  eq(r.clientId, CLIENT, 'the client is read from the server row, not the screen');
  eq(r.sessionId, NEW_SESSION, 'and so is the new session id');
  eq(r.reason, null, 'a move that happened has no refusal reason');
  eq(r.className, null, 'and no class to name');
}

eq(readMoveAtReport(moved({ promoted: null })).promoted, false,
  'no promotion is false, not true-because-a-key-was-present');
eq(readMoveAtReport(moved({ promoted: '' })).promoted, false,
  'and an empty id is not a promotion either');

{
  // A refusal, exactly as part 1830 builds the clash-class branch: no client,
  // no session, no waiting key.
  const r = readMoveAtReport({ moved: false, reason: 'clash-class', class: 'Reformer Flow' });
  eq(r.moved, false, 'a refusal did not move anything');
  eq(r.reason, 'clash-class', 'and it says why');
  eq(r.className, 'Reformer Flow', 'naming the class the coach is down to teach');
  eq(r.clientId, null, 'a refusal carries no client');
  eq(r.sessionId, null, 'and no new session');
  eq(r.waitingKnown, false, 'and it counted nobody, because it freed no hour to queue for');
}

{
  const r = readMoveAtReport({ moved: false, reason: 'past' });
  eq(r.moved, false, 'a refusal with no extra keys still reads as not moved');
  eq(r.reason, 'past', 'and keeps its reason');
}

// Nothing at all. A refused PostgREST call resolves to `data: null`, and the
// caller turns that into the unreachable sentinel — but the reader must not
// throw on it either.
eq(readMoveAtReport(null).moved, false, 'a null answer is not a move');
eq(readMoveAtReport(null).waitingKnown, false, 'and it counted nobody');
eq(readMoveAtReport(undefined).moved, false, 'and neither is no answer at all');
eq(readMoveAtReport({ moved: 'true' }).moved, false,
  'the string "true" is not the server saying a session moved');

/* ── the sentinel ──────────────────────────────────────────────────────── */

eq(MOVE_AT_UNREACHABLE.moved, false, 'an unreachable move did not move');
eq(MOVE_AT_UNREACHABLE.reason, 'unreachable', 'and says so, rather than reading as a plain refusal');
eq(MOVE_AT_UNREACHABLE.waitingKnown, false,
  'a move that never reached the server knows nothing about who is in line, least of all that nobody is');

if (errors.length) {
  console.error(`coachMoveAt.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('coachMoveAt.test: all assertions passed');
