// Narrowing a quarter of sessions, and the sentence that must never be "you
// have none".
// Compile with tsc, run with node.
//
// The assertion that matters most in this file is a negative one: a filtered
// empty list and an unread empty list are different facts, and the screen this
// serves settles payroll. So the empty-result wording is checked for what it
// does NOT say as hard as for what it does.
import {
  NO_FILTER, clientOptions, emptyFilterLine, filterActive, filterLine,
  filterSessions, matchesText, stateCounts, type SessionFilter,
} from './sessionFilter';
import { PAST_STATES, type PastState } from './sessionHistory';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (clientId: string | null, clientName: string | null) => ({ clientId, clientName });
const F = (over: Partial<SessionFilter> = {}): SessionFilter => ({ ...NO_FILTER, ...over });

/* ── is anything narrowed ──────────────────────────────────────────────── */

ok(!filterActive(NO_FILTER), 'an untouched filter narrows nothing');
ok(filterActive(F({ clientId: 'a' })), 'a picked client narrows');
ok(filterActive(F({ state: 'delivered' })), 'so does a picked outcome');
ok(filterActive(F({ text: 'ana' })), 'and typed text');
// A box holding a space is not a search. Reporting it as one sends a coach
// hunting for a control they never touched.
ok(!filterActive(F({ text: '   ' })), 'whitespace on its own is not a search');

/* ── text ──────────────────────────────────────────────────────────────── */

ok(matchesText('Ana Ruiz', 'ana'), 'the match is case-folded');
ok(matchesText('Ana Ruiz', ' RUIZ '), 'and the query is trimmed');
ok(matchesText('Ana Ruiz', ''), 'an empty query matches everybody rather than nobody');
ok(!matchesText(null, 'ana'), 'a row with no name matches a real search');
ok(matchesText(null, '  '), 'but is not excluded by an empty one');

/* ── who is in the window ──────────────────────────────────────────────── */

const rows = [
  row('c2', 'Ben ODwyer'), row('c1', 'Ana Ruiz'), row('c1', 'Ana Ruiz'),
  row(null, null), row('c3', ''),
];
const opts = clientOptions(rows);
eq(opts.length, 3, 'a row with no client id produces no option, because a slot is not a person');
eq(opts[0].name, 'Ana Ruiz', 'options come back in name order');
eq(opts[0].count, 2, 'and carry how many of the rows are theirs');
eq(opts[2].name, 'Client', 'a client every row named as blank still gets a label, never an empty chip');

/* ── the filter itself ─────────────────────────────────────────────────── */

eq(filterSessions(rows, NO_FILTER).length, 5, 'no filter drops nothing');
eq(filterSessions(rows, F({ clientId: 'c1' })).length, 2, 'a client filter keeps only theirs');
// The one that would be wrong in the dangerous direction: two people called Sam
// are two people, and a name-based filter would show both.
const sams = [row('s1', 'Sam Hall'), row('s2', 'Sam Nkemelu')];
eq(filterSessions(sams, F({ clientId: 's1' })).length, 1, 'the filter is on the id, so two clients named Sam stay two clients');
eq(filterSessions(rows, F({ clientId: 'c1', text: 'ben' })).length, 0, 'the clauses are ANDed, not ORed');
// An unattributed row cannot be reached by a client filter, and that is stated
// behaviour rather than an accident.
eq(filterSessions(rows, F({ clientId: 'c1' })).some((r) => r.clientId === null), false,
  'a row with no client id is never matched by a client filter');

const stated: { clientId: string | null; clientName: string | null; s: PastState }[] = [
  { ...row('a', 'A'), s: 'delivered' },
  { ...row('b', 'B'), s: 'unmarked' },
  { ...row('c', 'C'), s: 'delivered' },
];
const stateOf = (r: { s: PastState }) => r.s;
eq(filterSessions(stated, F({ state: 'delivered' }), stateOf).length, 2, 'the state clause uses the caller’s verdict');
// Omitting `stateOf` must not silently drop everything — the marking queue
// passes no verdict because every row in it is unmarked by construction.
eq(filterSessions(stated, F({ state: 'delivered' })).length, 3,
  'with no verdict function the state clause does not apply at all, rather than matching nothing');

/* ── the counts ────────────────────────────────────────────────────────── */

const counts = stateCounts(stated, stateOf, PAST_STATES);
eq(counts.delivered, 2, 'counted');
// Every state gets a key even at zero. A missing key renders as an absent chip,
// and a coach who cannot see "cancelled late" cannot learn that none of theirs
// is.
for (const s of PAST_STATES) ok(s in counts, `${s} has a count even when it is zero`);
eq(counts.cancelled, 0, 'and a state nothing is in is zero rather than absent');

/* ── what is said about what is shown ──────────────────────────────────── */

eq(filterLine(4, 4, NO_FILTER), null, 'an unfiltered list gets no line, because a permanent "4 of 4" is furniture');
const line = filterLine(2, 88, F({ clientId: 'c1' }), 'Ana Ruiz');
ok(line !== null && /2 of the 88 read/.test(line), 'the line says how many of how many, and says READ');
ok(line !== null && /Ana Ruiz/.test(line), 'and names the client when the caller knows it');
// The name can go missing when the window moves. "one client" is then honest
// and a blank is not.
const anon = filterLine(2, 88, F({ clientId: 'gone' }));
ok(anon !== null && /one client/.test(anon), 'a pick whose name is no longer in the rows still reads as one client');
const both = filterLine(1, 9, F({ clientId: 'c', text: 'an', state: 'delivered' }), 'Ana');
ok(both !== null && /and/.test(both), 'three clauses are joined into one sentence rather than three');

/* ── AND THE ONE THAT MATTERS ──────────────────────────────────────────── */

const empty = emptyFilterLine(88, F({ text: 'zzz' }));
// This is the whole reason this module exists. The rows have not gone
// anywhere; the coach hid them and may well have forgotten.
ok(/88/.test(empty), 'an empty result names how many were read');
ok(/narrowed/.test(empty), 'and names the filter as the reason');
ok(/clear the filters/i.test(empty), 'and says how to get back');
ok(!/you have none|nothing outstanding|all caught up|no sessions of yours/i.test(empty),
  'and never says the coach has none — that is the sentence a settlement gets cleared by');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`sessionFilter: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('sessionFilter: ok (a filtered empty list says the filter did it, and never that the coach has none)');
