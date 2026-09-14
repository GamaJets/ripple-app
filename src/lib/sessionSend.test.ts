// Whether an hour of somebody's training may be sent. Compile with tsc, run
// with node.
//
// The assertion this file exists for is one line long: a session for a client
// with no Repple account is blocked, and blocked in BOTH of the places that
// ask — the button, and the belt inside the save that a press beating the
// button lands on. Every other case here is there so that neither guard can be
// satisfied by simply refusing everything.
import {
  sessionSendBlock, maySendSession, sessionClientBlocked,
  type SessionSendFacts,
} from './sessionSend';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A client with a Repple account behind them. */
const REAL = '759c8d25-4d50-4a5c-bdb5-806bcad18ac1';
/** A hand-added client. `coach_clients.id` is a real uuid, so the id alone
 *  cannot tell you — only the roster can, which is what `handAdded` carries. */
const HAND = '3f2b0c8e-11d4-4a7b-9c30-6d5e1f80a2b7';

/** A sheet with a client, sets, a readable load and a usable hour. */
const good = (over: Partial<SessionSendFacts> = {}): SessionSendFacts => ({
  clientId: REAL, handAdded: false, hasSets: true, loadProblem: null, whenProblem: null, ...over,
});

/* ── the sheet that may be sent ──────────────────────────────────────────── */

eq(sessionSendBlock(good()), null, 'a full sheet for a client with an account may be sent');
eq(maySendSession(good()), true, 'and Finish is offered for it');
eq(sessionClientBlocked(good()), false, 'and the belt lets it through');

/* ── the client with no account: the reason this module exists ───────────── */

eq(sessionSendBlock(good({ clientId: HAND, handAdded: true })), 'no-account',
  'a session for a hand-added client is blocked: workouts.user_id references profiles(id), so there is nothing on the other side to accept it');
eq(maySendSession(good({ clientId: HAND, handAdded: true })), false,
  'so Finish is withheld rather than offered and then refused twenty minutes later');
eq(sessionClientBlocked({ clientId: HAND, handAdded: true }), true,
  'and the belt inside the save blocks it too — this is what a press that beat the button hits');

// The belt is asked WITHOUT the sheet, because by the time it runs the sheet
// has already been answered for. A complete, valid, ready-to-send sheet must
// still be blocked when the person it names has no account.
eq(sessionClientBlocked({ clientId: HAND, handAdded: true }), true,
  'the belt does not depend on anything else being wrong');
eq(sessionSendBlock(good({ clientId: HAND, handAdded: true, hasSets: true, loadProblem: null, whenProblem: null })), 'no-account',
  'an otherwise perfect sheet is still blocked on the account');

// Offline is where this matters most, and offline looks identical from here:
// nothing about the block is a server answer. The decision is made from the
// roster and the id alone, before anything is sent.
eq(sessionSendBlock({ clientId: HAND, handAdded: true, hasSets: true, loadProblem: null, whenProblem: null }), 'no-account',
  'the block is made from facts on the phone, so it is the same with no signal — which is when a queued write would be dropped hours later with no screen left to say so');

/* ── a local id, which the database would refuse outright ────────────────── */

eq(sessionSendBlock(good({ clientId: 'c900', handAdded: true })), 'no-account',
  'a not-yet-synced hand-added client is still blocked');
eq(sessionSendBlock(good({ clientId: 'c900', handAdded: false })), 'no-account',
  'and a local id is refused whatever the roster claims');

/* ── an unknown roster answer is not a refusal ───────────────────────────── */
//
// `undefined` is the first render and a row from an older build. Blocking on
// it would lose the same hour of training for the opposite reason.
eq(sessionSendBlock(good({ handAdded: undefined })), null,
  'a real client whose roster row has not arrived yet may still be logged');
eq(sessionSendBlock(good({ handAdded: null })), null,
  'null is the same absence of knowledge as undefined, not a hand-added client');
eq(sessionSendBlock(good({ clientId: HAND, handAdded: undefined })), null,
  'the uuid alone cannot tell you, which is exactly why the roster has to say');

/* ── nobody chosen ───────────────────────────────────────────────────────── */

eq(sessionSendBlock(good({ clientId: null })), 'no-client', 'nothing can be logged against nobody');
eq(sessionSendBlock(good({ clientId: '' })), 'no-client', 'an empty id names nobody');
eq(sessionClientBlocked({ clientId: null, handAdded: false }), true,
  'and the belt blocks an unchosen client too, rather than reading it as an account');

/* ── the other three, so the guard is not just "always refuse" ───────────── */

eq(sessionSendBlock(good({ hasSets: false })), 'no-sets', 'a sheet with no rep counts has nothing to write');
eq(sessionSendBlock(good({ loadProblem: 'Squat: that weight could not be read' })), 'unreadable-load',
  'one unreadable figure withholds the save rather than being silently zeroed');
eq(sessionSendBlock(good({ whenProblem: 'That session is in the future' })), 'unusable-when',
  'a session dated into the future is not filed');

// Null is not an empty string. A problem reported as '' is still a problem.
eq(sessionSendBlock(good({ loadProblem: '' })), 'unreadable-load',
  'an empty problem sentence is still a problem, not an approval');
eq(sessionSendBlock(good({ whenProblem: '' })), 'unusable-when',
  'and the same for the hour');

/* ── order: the account is asked before the sheet ────────────────────────── */
//
// So a coach with a half-typed sheet for somebody with no account is told the
// thing they cannot fix by typing, rather than being sent to finish the sheet
// first and refused at the end anyway.
eq(sessionSendBlock({ clientId: HAND, handAdded: true, hasSets: false, loadProblem: 'bad', whenProblem: 'bad' }), 'no-account',
  'the account is the first thing said, because it is the only one typing cannot fix');
eq(sessionSendBlock({ clientId: null, handAdded: true, hasSets: false, loadProblem: 'bad', whenProblem: 'bad' }), 'no-client',
  'except that nobody chosen comes first, since every other question is about a person');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionSend: ok');
