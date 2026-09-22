// The member's own feed: what a finished session is called, and what a week of
// it came to. Compile with tsc, run with node.
//
// ── What is actually being pinned ─────────────────────────────────────────
//
// app/(client)/activity.tsx decided both of these inline, and both were wrong
// in the same way: they inferred from the clock what the record already says.
//
//   1. `s.status === 'booked' && Date.parse(s.startsAt) <= nowMs` printed one
//      sentence — "Session Booked" — over completed, no_show, cancelled,
//      late_cancelled and unmarked alike, and did it from the START of the
//      hour. A session the coach cancelled on Thursday morning sat in the
//      member's own history looking exactly like one they had attended, and a
//      member ten minutes into their session read that it had happened.
//
//   2. the tally over a week. Nothing on the screen answered "what did I do",
//      and the obvious way to answer it — count the feed rows — is wrong,
//      because one training session writes one row per movement.
//
// Every assertion below is about something the screen must NOT be able to say.
// The zone-sensitive ones are marked: this module deals in instants and holds
// no calendar day anywhere, which is the property the three-zone run proves.
import { catchUp, catchUpLine, sessionFeedRows, SESSION_FEED_TITLE } from './activityFeed';
import type { FeedSession } from './activityFeed';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };
const eq = (a: unknown, b: unknown, m: string) =>
  ok(Object.is(a, b), `${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Noon UTC on a Saturday, so the local calendar day differs across the three
 *  zones the suite is run under. */
const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const S = (over: Partial<FeedSession> & { clientId?: string | null } = {}): FeedSession => ({
  startsAt: iso(NOW - 2 * H),
  durationMin: 60,
  status: 'booked',
  clientId: 'me',
  ...over,
});

/* ── 1. a booking is not an event ────────────────────────────────────────── */

// THE assertion. Five outcomes, five headings, none of them "Session Booked".
{
  const rows = sessionFeedRows([
    S({ startsAt: iso(NOW - 5 * D), outcome: 'completed' }),
    S({ startsAt: iso(NOW - 4 * D), outcome: 'no_show' }),
    S({ startsAt: iso(NOW - 3 * D), outcome: 'cancelled' }),
    S({ startsAt: iso(NOW - 2 * D), outcome: 'late_cancelled' }),
    S({ startsAt: iso(NOW - 1 * D), outcome: null }),
  ], 'me', NOW);
  eq(rows.length, 5, 'every finished session of this member is a row');
  eq(rows.map((r) => r.state).join(','), 'unmarked,late_cancelled,cancelled,missed,delivered',
    'newest first, and each row carries the state the RECORD holds');
  ok(!rows.some((r) => r.title === 'Session Booked'),
    'no row says "Session Booked" — that sentence was true of all five and informative about none');
  eq(rows.find((r) => r.state === 'cancelled')!.title, 'Session Cancelled',
    'a cancelled hour is named as cancelled in the member’s own history');
  eq(rows.find((r) => r.state === 'delivered')!.title, 'Session Completed',
    'and a delivered one as completed');
}

// The start is not the end. A session in progress is not history.
{
  const midway = S({ startsAt: iso(NOW - 10 * 60_000), durationMin: 60 });
  eq(sessionFeedRows([midway], 'me', NOW).length, 0,
    'ten minutes into an hour, the session has not happened yet');
  eq(sessionFeedRows([midway], 'me', NOW + 60 * 60_000).length, 1,
    'and it is history once its whole length has gone by');
}

// A duration that is missing or nonsense must not push the end into the future.
eq(sessionFeedRows([S({ startsAt: iso(NOW - H), durationMin: null })], 'me', NOW).length, 1,
  'a session with no recorded length ends when it started, not never');

// An outcome this build has never heard of is unmarked, never delivered.
{
  const rows = sessionFeedRows([S({ outcome: 'rescheduled_by_gym' })], 'me', NOW);
  eq(rows[0].state, 'unmarked', 'an unknown outcome asks a human to look rather than claiming delivery');
  eq(rows[0].title, SESSION_FEED_TITLE.unmarked, 'and is titled as such');
}

// Somebody else's hours, and nobody's hours.
{
  const all = [
    S({ clientId: 'someone-else' }),
    S({ clientId: null, status: 'available' }),
    // The row that makes the guard matter: an hour whose client was cleared
    // when it was released, still carrying the outcome somebody recorded. Its
    // `clientId` is null, so a signed-out reader whose own id is null matches
    // it on `!==` alone.
    S({ clientId: null, status: 'booked', outcome: 'completed' }),
    S({ clientId: 'me' }),
  ];
  eq(sessionFeedRows(all, 'me', NOW).length, 1, 'only this member’s own sessions');
  eq(sessionFeedRows(all, null, NOW).length, 0,
    'a null id matches NOTHING — a loose equality here hands a reader with no id every released hour on the calendar');
  eq(sessionFeedRows(all, '', NOW).length, 0, 'and so does an empty one');
  eq(sessionFeedRows(all, undefined, NOW).length, 0, 'and so does an absent one');
}

// An available slot that simply went by is not a session that happened.
eq(sessionFeedRows([S({ status: 'available', clientId: 'me', outcome: null })], 'me', NOW).length, 0,
  'an hour nobody booked is not history');
// But one carrying an outcome is kept whatever its slot state says now.
eq(sessionFeedRows([S({ status: 'available', clientId: 'me', outcome: 'late_cancelled' })], 'me', NOW).length, 1,
  'recording an outcome is somebody stating this hour was a session');

// An unparseable start is not "the beginning of time".
eq(sessionFeedRows([S({ startsAt: 'not a date' })], 'me', NOW).length, 0,
  'a row with no readable start is not silently filed as long finished');

/* ── 2. what a week came to ──────────────────────────────────────────────── */

const W = (at: string) => ({ at, kind: 'workout' as const });

// The window is a rolling span of INSTANTS. Run under Pacific/Kiritimati (+14),
// UTC and Pacific/Midway (-11) this has to come out the same, which it can only
// do if no calendar day is involved anywhere.
{
  const c = catchUp([
    W(iso(NOW - 1 * H)),
    W(iso(NOW - 6 * D)),
    W(iso(NOW - 7 * D + H)),      // just inside
    W(iso(NOW - 7 * D - H)),      // just outside
    W(iso(NOW - 40 * D)),
  ], NOW, 7);
  eq(c.workouts, 3, 'the window is seven times twenty-four hours back from now, in every zone');
  eq(c.total, 3, 'and the total agrees with it');
}

// Nothing future inflates a week, and nothing unparseable does either.
{
  const c = catchUp([
    W(iso(NOW + H)),
    W(''),
    W('tomorrow'),
    W(iso(NOW)),
  ], NOW, 7);
  eq(c.total, 1, 'a future row, a blank and a nonsense stamp are all outside the window');
}

// A record is a workout as well as a record, and is counted once.
{
  const c = catchUp([
    { at: iso(NOW - H), kind: 'pr' },
    { at: iso(NOW - 2 * H), kind: 'workout' },
    { at: iso(NOW - 3 * H), kind: 'checkin' },
    { at: iso(NOW - 4 * H), kind: 'session' },
    { at: iso(NOW - 5 * H), kind: 'other' },
  ], NOW, 7);
  eq(c.workouts, 1, 'a PR row is not counted again as a workout');
  eq(c.prs, 1, 'it is counted as a record');
  eq(c.checkins, 1, 'check-ins are their own tally');
  eq(c.sessions, 1, 'and so are coach sessions');
  eq(c.total, 5, 'total counts everything in the window, kinds with no sentence included');
  const line = catchUpLine(c, 7)!;
  ok(/2 workouts logged/.test(line), 'the line adds the record back into the trained count exactly once');
}

// An empty window says NOTHING. "Nothing in the last 7 days" is a claim about a
// member and this function cannot see whether the reads behind it landed.
eq(catchUpLine(catchUp([], NOW, 7), 7), null, 'an empty week produces no line at all');
eq(catchUpLine(catchUp([W(iso(NOW - 30 * D))], NOW, 7), 7), null,
  'and neither does a week whose only training is outside it');

// Zero is a true answer inside the tally, and never a null.
{
  const c = catchUp([], NOW, 7);
  eq(c.workouts, 0, 'a tally over an empty list is zeroes');
  eq(c.total, 0, 'including the total');
}

// Singulars, and the shape of the sentence.
{
  const one = catchUpLine(catchUp([
    W(iso(NOW - H)),
    { at: iso(NOW - 2 * H), kind: 'checkin' as const },
  ], NOW, 7), 7)!;
  eq(one, 'In the last 7 days: 1 workout logged and 1 check-in sent.',
    'two clauses are joined with "and", and both are singular');
}
{
  const many = catchUpLine(catchUp([
    W(iso(NOW - H)), W(iso(NOW - 2 * H)),
    { at: iso(NOW - 3 * H), kind: 'checkin' as const },
    { at: iso(NOW - 4 * H), kind: 'session' as const },
  ], NOW, 7), 7)!;
  eq(many, 'In the last 7 days: 2 workouts logged, 1 check-in sent and 1 session with your coach.',
    'three clauses are comma-separated with "and" before the last');
  ok(!/%|streak|only|target/i.test(many), 'the line never grades');
}

// A nonsense window is not a window of nothing.
eq(catchUp([W(iso(NOW - H))], NOW, 0).workouts, 1, 'a zero-day window is floored at one day, not emptied');
eq(catchUp([W(iso(NOW - H))], NOW, -5).workouts, 1, 'and so is a negative one');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('activityFeed: ok (a cancelled hour is never "Session Booked", and a week is instants rather than days)');
