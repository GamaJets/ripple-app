// A coach's own sessions, scoped by who delivered them. Compile with tsc, run
// with node.
//
// Two refusals are pinned down here, and they are the two that put a wrong
// number in front of a coach:
//
//   1. "Delivered" is a recorded outcome and nothing else. Every other reading
//      — it was booked, its clock has passed, so it happened — counts no-shows
//      and un-cancelled slots as work done. That inference is exactly what
//      src/lib/gymSessions.ts was written to end on the gym's side, and it must
//      not creep back in on the coach's.
//
//   2. A figure headed "last 30 days" contains only the last 30 days. Both ends
//      matter: an outcome can be recorded before the slot's own start time, so
//      without an upper bound a session scheduled for next Tuesday and marked
//      today lands in this month's delivered count. History would then include
//      the future, and the number would go DOWN as time passed.
import {
  DELIVERED_WINDOW_DAYS, MARK_WINDOW_DAYS,
  awaitingOutcome, deliveredBetween, rowToSession, windowStart,
} from './trainerSessions';
import type { PtSession, SessionOutcome } from './gymSessions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-08-31T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const sess = (over: Partial<PtSession> = {}): PtSession => ({
  id: 's1', trainerId: 'coach-1', trainerName: null,
  clientId: 'client-1', clientName: null,
  startsAt: daysAgo(3), durationMin: 60,
  status: 'booked', outcome: null, outcomeAt: null,
  rateCents: null, settlementId: null,
  ...over,
});

/* ── the windows are stated, not scattered ────────────────────────────────── */

eq(MARK_WINDOW_DAYS, 90, 'the marking queue looks back 90 days');
eq(DELIVERED_WINDOW_DAYS, 30, 'the delivered figure is counted over a month');
eq(windowStart(30, NOW), '2026-08-01T12:00:00.000Z', 'windowStart is exactly that many days before now');
eq(windowStart(0, NOW), new Date(NOW).toISOString(), 'a zero-day window starts now');

/* ── delivered means somebody recorded that it completed ──────────────────── */

const since30 = NOW - 30 * 86_400_000;
const outcomes: (SessionOutcome | null)[] = ['completed', 'no_show', 'cancelled', 'late_cancelled', null];
const oneOfEach = outcomes.map((o, i) => sess({ id: 'o' + i, outcome: o, startsAt: daysAgo(2) }));
eq(deliveredBetween(oneOfEach, since30, NOW), 1,
  'only the completed one counts — a no-show, a cancellation and an unmarked session are not delivered work');

eq(deliveredBetween([], since30, NOW), 0, 'no sessions is a real zero, not a crash');
eq(deliveredBetween([sess({ outcome: 'completed' }), sess({ id: 's2', outcome: 'completed' })], since30, NOW), 2,
  'two delivered sessions are two');

// The bug this guards: a booked session whose time has passed is NOT delivered.
const passedButUnmarked = sess({ startsAt: daysAgo(5), status: 'booked', outcome: null });
eq(deliveredBetween([passedButUnmarked], since30, NOW), 0,
  'a booked session whose clock has run out is still unknown — the clock is not an outcome');

/* ── the window has two ends ──────────────────────────────────────────────── */

eq(deliveredBetween([sess({ outcome: 'completed', startsAt: daysAgo(31) })], since30, NOW), 0,
  'a session delivered before the window is outside it');
eq(deliveredBetween([sess({ outcome: 'completed', startsAt: daysAgo(29) })], since30, NOW), 1,
  'and one inside it is counted');
eq(deliveredBetween([sess({ outcome: 'completed', startsAt: inDays(2) })], since30, NOW), 0,
  'a session marked completed but scheduled for next week is not last month’s work');
eq(deliveredBetween([sess({ outcome: 'completed', startsAt: 'not a date' })], since30, NOW), 0,
  'an unparseable start time is not counted rather than counted as now');

// The boundaries themselves, because an off-by-one here moves real money.
eq(deliveredBetween([sess({ outcome: 'completed', startsAt: new Date(since30).toISOString() })], since30, NOW), 1,
  'the first instant of the window is inside it');
eq(deliveredBetween([sess({ outcome: 'completed', startsAt: new Date(NOW).toISOString() })], since30, NOW), 1,
  'and so is this instant');

/* ── the marking queue ────────────────────────────────────────────────────── */

const queue = awaitingOutcome([
  sess({ id: 'q1', startsAt: daysAgo(2), status: 'booked', outcome: null }),
  sess({ id: 'q2', startsAt: daysAgo(2), status: 'booked', outcome: 'completed' }),
  sess({ id: 'q3', startsAt: daysAgo(2), status: 'available', outcome: null }),
  sess({ id: 'q4', startsAt: inDays(1), status: 'booked', outcome: null }),
], NOW);
eq(queue.length, 1, 'only a booked, finished, unmarked session is awaiting an outcome');
eq(queue[0].id, 'q1', 'and it is the right one');
ok(!queue.some((s) => s.id === 'q3'),
  'an empty slot nobody booked is not waiting on anything — there was nobody in it');
ok(!queue.some((s) => s.id === 'q4'),
  'a session that has not happened yet is not overdue for an outcome');

/* ── the row mapper ───────────────────────────────────────────────────────── */
//
// The shape has to match gymSessions' own mapper exactly, because both feed the
// same pure rules. The two that matter are the ones with a fallback: a session
// with no duration is an hour (the app's booking default), and a rate is null
// rather than zero — zero is a rate somebody could genuinely charge, and the
// two must never collapse into each other.

const names = new Map([['coach-1', 'Sam Rowe'], ['client-1', 'Alex Day']]);
const mapped = rowToSession({
  id: 'r1', trainer_id: 'coach-1', client_id: 'client-1',
  starts_at: daysAgo(1), duration_min: 45, status: 'booked',
  outcome: 'completed', outcome_at: daysAgo(1), rate_cents: 5500, settlement_id: null,
}, names);
eq(mapped.trainerName, 'Sam Rowe', 'the trainer is named from the lookup');
eq(mapped.clientName, 'Alex Day', 'and so is the client');
eq(mapped.durationMin, 45, 'a stated duration is kept');
eq(mapped.rateCents, 5500, 'and so is a snapshotted rate');

const bare = rowToSession({
  id: 'r2', trainer_id: 'coach-1', client_id: null,
  starts_at: daysAgo(1), status: 'available',
}, new Map());
eq(bare.durationMin, 60, 'a row with no duration is an hour, the booking default');
eq(bare.rateCents, null, 'a row with no rate is unknown, NOT zero — zero is a rate a coach may charge');
eq(bare.outcome, null, 'a row with no outcome is unknown');
eq(bare.clientId, null, 'an empty slot has no client');
eq(bare.clientName, null, 'and therefore no client name to look up');
eq(bare.trainerName, null, 'a name the lookup did not have is null, so the screen draws its dash');

/* ── the scoping this module exists for ───────────────────────────────────── */
//
// Not a database test — that is verified against the live database — but the
// property the screens depend on: a session is the coach's because of who
// delivered it, and a coach with no gym still has sessions.

const independent = [
  sess({ id: 'i1', trainerId: 'coach-1', outcome: 'completed', startsAt: daysAgo(4) }),
  sess({ id: 'i2', trainerId: 'coach-1', outcome: null, startsAt: daysAgo(4) }),
];
eq(deliveredBetween(independent, since30, NOW), 1,
  'a coach with no tenant has a delivered count like anybody else — nothing here consults a gym');
eq(awaitingOutcome(independent, NOW).length, 1,
  'and a marking queue like anybody else');

if (errors.length) {
  console.error(`trainerSessions: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('trainerSessions: ok');
