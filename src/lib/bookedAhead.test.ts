// What each client has booked over the next fortnight. Compile with tsc, run
// with node.
//
// The things that can go wrong here are all over-claims about commitment:
//
//   · a cancelled future session counted as something the client is holding;
//   · an `available` slot with no client counted as somebody's booking;
//   · the session a coach is standing in dropped the moment its start time
//     passes, so a client mid-session reads as having nothing on;
//   · a session just outside the window listed under a heading that names the
//     window.
import {
  BOOKED_AHEAD_DAYS, bookedAhead, bookedAheadHeading, bookedAheadListable,
  bookedAheadNote, nobodyBookedAheadLine, type AheadRow,
} from './bookedAhead';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-13T12:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const row = (over: Partial<AheadRow> = {}): AheadRow => ({
  clientId: 'c1', startsAt: inDays(1), durationMin: 60, status: 'booked', outcome: null, ...over,
});

eq(BOOKED_AHEAD_DAYS, 14, 'the window is a fortnight, and it is stated once');

/* ── who is actually holding an hour ──────────────────────────────────────── */

eq(bookedAhead([row()], NOW).length, 1, 'a booked hour ahead is a booking');
eq(bookedAhead([row({ clientId: null, status: 'available' })], NOW).length, 0,
  'an open slot belongs to nobody and is not anybody’s booking');
eq(bookedAhead([row({ status: 'blocked', clientId: null })], NOW).length, 0,
  'and neither is a block');
eq(bookedAhead([row({ outcome: 'cancelled' })], NOW).length, 0,
  'a cancelled session in the future is a row saying the hour was given back');
eq(bookedAhead([row({ outcome: 'late_cancelled' })], NOW).length, 0,
  'a late cancellation is the same fact with a fee attached');
eq(bookedAhead([row({ status: 'available', outcome: 'completed' })], NOW).length, 1,
  'a row carrying an outcome is somebody stating it was a real session, whatever the slot says');
eq(bookedAhead([row({ startsAt: 'not a date' })], NOW).length, 0,
  'an unparseable instant is dropped rather than becoming NaN in the sort');

/* ── the edges of the window ──────────────────────────────────────────────── */

eq(bookedAhead([row({ startsAt: inDays(15) })], NOW).length, 0,
  'a session past the window is not listed under a heading that names the window');
eq(bookedAhead([row({ startsAt: inDays(13.9) })], NOW).length, 1, 'one just inside it is');
// Started thirty minutes ago, sixty minutes long: the hour the coach is
// standing in. Dropping it would tell them their client has nothing on while
// the client is in front of them.
eq(bookedAhead([row({ startsAt: new Date(NOW - 30 * 60_000).toISOString() })], NOW).length, 1,
  'a session in progress is still ahead — it is measured by its end, not its start');
eq(bookedAhead([row({ startsAt: new Date(NOW - 120 * 60_000).toISOString() })], NOW).length, 0,
  'one that has finished is not');
eq(bookedAhead([row()], NOW, 1).length, 1, 'the window is an argument, and a one-day window still works');

/* ── the shape of the answer ──────────────────────────────────────────────── */

const many = bookedAhead([
  row({ clientId: 'later', startsAt: inDays(5) }),
  row({ clientId: 'sooner', startsAt: inDays(2) }),
  row({ clientId: 'sooner', startsAt: inDays(9) }),
  row({ clientId: 'sooner', startsAt: inDays(4) }),
], NOW);
eq(many.length, 2, 'one row per client, not one per session');
eq(many[0].clientId, 'sooner', 'soonest client first — whoever the coach sees next');
eq(many[0].startsAt.length, 3, 'with every session of theirs in the window');
eq(many[0].startsAt[0], inDays(2), 'their own sessions soonest first');
eq(many[0].startsAt[2], inDays(9), 'and the furthest out last');

// Two clients whose next session is the same instant must not reshuffle between
// renders, so the tie-break is the id and not the insertion order.
const tied = bookedAhead([
  row({ clientId: 'zeb', startsAt: inDays(3) }),
  row({ clientId: 'abe', startsAt: inDays(3) }),
], NOW);
eq(tied.map((c) => c.clientId).join(','), 'abe,zeb', 'a tie is broken on a stable key');

/* ── the words ────────────────────────────────────────────────────────────── */

const day = (iso: string) => iso.slice(0, 10);
eq(bookedAheadNote({ clientId: 'c1', startsAt: [inDays(1)] }, day),
  `1 session — ${day(inDays(1))}.`, 'one session is singular and names its date');
eq(bookedAheadNote({ clientId: 'c1', startsAt: [inDays(1), inDays(3)] }, day),
  `2 sessions — ${day(inDays(1))}, ${day(inDays(3))}.`, 'two are listed in full');
eq(bookedAheadNote({ clientId: 'c1', startsAt: [inDays(1), inDays(2), inDays(3), inDays(4), inDays(5), inDays(6)] }, day, 4),
  `6 sessions — ${day(inDays(1))}, ${day(inDays(2))}, ${day(inDays(3))}, ${day(inDays(4))} and 2 more.`,
  'past the ceiling the count is still exact and the tail becomes a number');

eq(bookedAheadHeading(0), null, 'no heading over an empty list');
eq(bookedAheadHeading(1), 'One client has something booked in the next 14 days', 'one reads as one');
eq(bookedAheadHeading(3), '3 clients have something booked in the next 14 days', 'and more than one as a figure');
ok(nobodyBookedAheadLine().includes('14'), 'the empty line names the same window the heading does');

/* ── which statuses may draw it ───────────────────────────────────────────── */
//
// 'partial' is admitted deliberately: the read is newest-first, so the cut is at
// the OLD end and the future half is whole. 'loading' and 'error' are not — an
// empty fortnight is a claim, and under those two nobody has looked.

eq(bookedAheadListable('ready'), true, 'a whole read may be drawn');
eq(bookedAheadListable('partial'), true, 'and so may a cut one — the cut is behind, and this reads only ahead');
eq(bookedAheadListable('loading'), false, 'nothing is drawn before the read lands');
eq(bookedAheadListable('error'), false, 'and nothing at all after a failed one');

if (errors.length) {
  console.error(`bookedAhead: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('bookedAhead: ok');
