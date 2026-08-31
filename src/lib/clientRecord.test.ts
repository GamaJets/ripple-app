// The guard that decides whether a coach's client screen is allowed to say
// anything at all. Compile with tsc, run with node.
//
// The bug these pin: a client the coach typed in by hand gets a server-side
// uuid the moment `coach_clients` accepts the insert, so the id test that used
// to identify them stopped identifying them. Every read on the client screen
// then ran, came back with zero rows and no error, and was rendered as fact —
// including "they have not started their intake", which is an accusation about
// a person who has never been given the app.
import { clientIsQueryable } from './clientRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a real client with an account ─────────────────────────────────────── */

const REAL = '759c8d25-4d50-4a5c-bdb5-806bcad18ac1';

eq(clientIsQueryable(REAL, false), true, 'a linked client is asked about');
eq(clientIsQueryable(REAL, undefined), true,
  'and so is one whose row has not arrived yet — withholding a real screen on a value nobody has supplied is its own wrong answer');
eq(clientIsQueryable(REAL, null), true, 'null is the same absence of knowledge as undefined');

/* ── the case the id test used to catch and now cannot ─────────────────── */

// This is the shape the bug wore: coach_clients.id is uuid DEFAULT
// gen_random_uuid(), so a hand-added person is indistinguishable from a real
// one by their id alone.
eq(clientIsQueryable('3f2b0c8e-11d4-4a7b-9c30-6d5e1f80a2b7', true), false,
  'a hand-added client is NOT asked about, even though their id is a perfectly good uuid');
ok(clientIsQueryable('3f2b0c8e-11d4-4a7b-9c30-6d5e1f80a2b7', undefined),
  'and the uuid alone cannot tell you — which is exactly why the roster has to say');

/* ── the ids the database would refuse outright ────────────────────────── */

eq(clientIsQueryable('c900', true), false, 'a not-yet-synced hand-added client is still withheld');
eq(clientIsQueryable('c900', false), false, 'and a local id is refused whatever the roster claims');
eq(clientIsQueryable(null, false), false, 'no client was named, so nothing can be asked');
eq(clientIsQueryable(undefined, false), false, 'and undefined is the same');
eq(clientIsQueryable('', false), false, 'an empty id names nobody');
eq(clientIsQueryable(`  ${REAL}  `, false), true, 'surrounding whitespace does not disqualify a real id');
eq(clientIsQueryable('759c8d25-4d50-4a5c-bdb5-806bcad18ac', false), false,
  'a uuid one character short is not a uuid');

/* ── the two reasons compose, they do not cancel ───────────────────────── */

ok(!clientIsQueryable('not-a-uuid', undefined) && !clientIsQueryable(REAL, true),
  'either reason alone is enough to withhold');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('clientRecord: ok');
