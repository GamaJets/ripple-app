// The line between "coming up" and "already happened", and the hour of grace on it.
//
// These assertions are about a BOUNDARY, so almost all of them sit one
// millisecond either side of it. A version that used `>=` where this uses `>`,
// or that reused the grace on both questions, passes every test written a
// minute away from the edge.
//
// Compile with tsc, run with node.
import { UPCOMING_GRACE_MS, upcomingFrom, isUpcoming, hasStarted } from './upcomingWindow';

// Start failed and reach success, so a hang or an early exit cannot pass.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** An instant as a session row carries it: a timestamptz with an offset on it. */
const iso = (ms: number) => new Date(ms).toISOString();

const NOW = Date.parse('2026-09-04T19:00:00Z');

/* ── the grace itself ─────────────────────────────────────────────────────── */
{
  eq(UPCOMING_GRACE_MS, 3_600_000, 'the grace is an hour, in milliseconds');
  eq(upcomingFrom(NOW), NOW - 3_600_000, 'and the cut-off is that hour behind now');
}

/* ── coming up ────────────────────────────────────────────────────────────
 *
 * The hour behind `now` is INSIDE the window: a member walking into a class
 * that started twenty minutes ago still needs the room, the coach and the
 * cancel button. An hour and a millisecond behind it is out. */
{
  ok(isUpcoming(iso(NOW + 86_400_000), NOW), 'tomorrow is coming up');
  ok(isUpcoming(iso(NOW + 1), NOW), 'and so is a session one millisecond away');
  ok(isUpcoming(iso(NOW), NOW), 'a session starting exactly now is coming up');
  ok(isUpcoming(iso(NOW - 59 * 60_000), NOW), 'one that began fifty-nine minutes ago is still the one you are walking into');
  ok(isUpcoming(iso(NOW - UPCOMING_GRACE_MS + 1), NOW), 'a millisecond inside the grace is inside it');
  ok(!isUpcoming(iso(NOW - UPCOMING_GRACE_MS), NOW), 'exactly an hour behind is out — the boundary is exclusive');
  ok(!isUpcoming(iso(NOW - UPCOMING_GRACE_MS - 1), NOW), 'and a millisecond past it is certainly out');
  ok(!isUpcoming(iso(NOW - 6 * 3_600_000), NOW),
    'a class that finished six hours ago is NOT upcoming — this is the frozen-clock defect, and it carried a live Cancel button');
}

/* ── already begun ────────────────────────────────────────────────────────
 *
 * The question the approval list asks, and it must NOT carry the grace. If it
 * did, a session that started five minutes ago would be absent from both lists
 * — awaiting nothing and coming up nowhere. */
{
  ok(hasStarted(iso(NOW - 1), NOW), 'a session that began a millisecond ago has begun');
  ok(hasStarted(iso(NOW), NOW), 'and one beginning exactly now has begun — the boundary is inclusive');
  ok(!hasStarted(iso(NOW + 1), NOW), 'one a millisecond away has not');
  ok(hasStarted(iso(NOW - 5 * 60_000), NOW),
    'a session five minutes old is awaiting your approval — it must not fall through the grace and disappear from both lists');
  ok(isUpcoming(iso(NOW - 5 * 60_000), NOW) && hasStarted(iso(NOW - 5 * 60_000), NOW),
    'that same session is in BOTH lists for the length of the grace, which is what a member walking into it would say about it');
  ok(!(isUpcoming(iso(NOW - 2 * 3_600_000), NOW) || !hasStarted(iso(NOW - 2 * 3_600_000), NOW)),
    'two hours later it is only in the second');
}

/* ── the clock moving, which is the whole point ───────────────────────────
 *
 * Same row, two instants. A frozen `now` cannot tell these apart, and that is
 * exactly what the two screens were doing. */
{
  const started = iso(NOW);
  const opened = NOW - 4 * 3_600_000;   // the member opened the screen four hours ago
  ok(isUpcoming(started, opened), 'four hours before it starts, the session is coming up');
  ok(!isUpcoming(started, NOW + 2 * 3_600_000), 'two hours after it starts, it is not');
  ok(!hasStarted(started, opened), 'and at the moment the screen opened it had not begun');
  ok(hasStarted(started, NOW + 2 * 3_600_000), 'while two hours later it plainly had');
}

/* ── a timestamp we cannot read ───────────────────────────────────────────
 *
 * Neither answer is yes. An unreadable row is not evidence that a session is
 * ahead of the member, and it is not evidence that one happened either. */
{
  for (const bad of [null, undefined, '', 'soon', 'not-a-date']) {
    ok(!isUpcoming(bad as string | null | undefined, NOW), `${JSON.stringify(bad)} is not upcoming`);
    ok(!hasStarted(bad as string | null | undefined, NOW), `${JSON.stringify(bad)} has not started either`);
  }
}

if (errors.length) {
  console.error('upcomingWindow.test FAILED');
  for (const e of errors) console.error(' · ' + e);
  process.exit(1);
}
console.log('upcomingWindow.test passed');
process.exitCode = 0;
