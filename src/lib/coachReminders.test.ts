// The coach's own reminders. Compile with tsc, run with node.
//
// The failure this suite exists to stop is not a missing banner — it is a WRONG
// one. A local notification is scheduled on the handset and survives the app
// being closed, so an arming for a session that has since moved or been
// cancelled fires anyway, and tells a coach at 5:30 to go to a 6:30 that is not
// happening. That is worse than no reminder at all, because the coach will
// believe the app is telling them their diary.
//
// So the assertions that matter are the negative ones: an open slot arms
// nothing, a marked session arms nothing, a moved session is BOTH stale and
// re-armable, and a session outside the window the caller actually read is
// never cancelled on the strength of a query that did not ask about it.
import {
  remindAt, toArm, staleReminders, expiredReminders, reminderBody,
  backlogDue, backlogBody, backlogNote,
  COACH_LEAD_MINUTES, ARM_AHEAD_DAYS, MAX_ARMED, BACKLOG_FLOOR,
  type ArmedMap, type RemindableSession,
} from './coachReminders';
import { weekKey } from './nudge';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-01T09:00:00.000Z');

const sess = (o: Partial<RemindableSession> & { id: string; startsAt: string }): RemindableSession => ({
  status: 'booked', outcome: null, clientName: 'Sam Okafor', ...o,
});

/* ── when the banner fires ──────────────────────────────────────────────── */

const inThree = new Date(NOW + 3 * HOUR).toISOString();
eq(remindAt(inThree, NOW)?.getTime(), NOW + 3 * HOUR - COACH_LEAD_MINUTES * MIN,
  'an hour before the session');
eq(remindAt(new Date(NOW - HOUR).toISOString(), NOW), null, 'nothing for a session that has been');
// The one an "if (at < now) at = now" would have got wrong: a banner that fires
// at the moment of the session tells a coach they are late, which is not what a
// reminder is for.
eq(remindAt(new Date(NOW + 20 * MIN).toISOString(), NOW), null,
  'and nothing for one starting inside the lead time');
eq(remindAt('not a date', NOW), null, 'an unparseable start arms nothing');

/* ── what gets armed ────────────────────────────────────────────────────── */

const booked = sess({ id: 'a', startsAt: new Date(NOW + 3 * HOUR).toISOString() });
const open = sess({ id: 'b', startsAt: new Date(NOW + 4 * HOUR).toISOString(), status: 'available', clientName: null });
const blocked = sess({ id: 'c', startsAt: new Date(NOW + 5 * HOUR).toISOString(), status: 'blocked', clientName: null });
const marked = sess({ id: 'd', startsAt: new Date(NOW + 6 * HOUR).toISOString(), outcome: 'completed' });
const far = sess({ id: 'e', startsAt: new Date(NOW + (ARM_AHEAD_DAYS + 2) * DAY).toISOString() });

const armList = toArm([booked, open, blocked, marked, far], {}, NOW);
eq(armList.length, 1, 'only the booked, unmarked session inside the window');
eq(armList[0].id, 'a', 'and it is the right one');
// Each of these is a coach being sent to a room for nothing.
ok(!armList.some((s) => s.id === 'b'), 'an open slot is an offer, not an appointment');
ok(!armList.some((s) => s.id === 'c'), 'blocked time is not a session');
ok(!armList.some((s) => s.id === 'd'), 'a session already marked has been dealt with');
ok(!armList.some((s) => s.id === 'e'), 'and nothing past the arming horizon');

// Already armed against the same start: nothing to do. Two identical banners
// for one session is how somebody learns to swipe these away unread.
const armed: ArmedMap = { a: { notifId: 'n1', startsAt: booked.startsAt } };
eq(toArm([booked], armed, NOW).length, 0, 're-arming an unchanged session does nothing');

// THE case a plain `if (armed[s.id]) return false` would have missed.
const moved = sess({ id: 'a', startsAt: new Date(NOW + 5 * HOUR).toISOString() });
eq(toArm([moved], armed, NOW).length, 1, 'a session that MOVED keeps its id and needs a new banner');

// Soonest first, then capped. A book longer than the platform's pending limit
// must lose the far end and not the near one — the near one is the only part
// anybody needs today.
const many: RemindableSession[] = [];
for (let i = 0; i < MAX_ARMED + 15; i++) {
  many.push(sess({ id: 'm' + i, startsAt: new Date(NOW + 2 * HOUR + i * 30 * MIN).toISOString() }));
}
const capped = toArm(many, {}, NOW);
eq(capped.length, MAX_ARMED, 'no more than the cap is armed at once');
eq(capped[0].id, 'm0', 'and the soonest survives');
ok(Date.parse(capped[capped.length - 1].startsAt) < Date.parse(many[many.length - 1].startsAt),
  'while the far end is what gets dropped');

/* ── what gets cancelled ────────────────────────────────────────────────── */

const from = NOW - DAY;
const to = NOW + 30 * DAY;
const armedThree: ArmedMap = {
  a: { notifId: 'n1', startsAt: booked.startsAt },
  gone: { notifId: 'n2', startsAt: new Date(NOW + 2 * HOUR).toISOString() },
  shifted: { notifId: 'n3', startsAt: new Date(NOW + 2 * HOUR).toISOString() },
};
const stale = staleReminders(
  armedThree,
  [booked, sess({ id: 'shifted', startsAt: new Date(NOW + 4 * HOUR).toISOString() })],
  from, to,
);
const staleIds = stale.map((s) => s.sessionId).sort();
eq(JSON.stringify(staleIds), JSON.stringify(['gone', 'shifted']),
  'a session that vanished and one that moved are both stale; the unchanged one is not');
eq(stale.find((s) => s.sessionId === 'gone')?.notifId, 'n2', 'and the id to cancel comes back with it');

// A session that is still there and is no longer bookable, or has been marked,
// is the same failure from the coach's side.
eq(staleReminders({ x: { notifId: 'n', startsAt: booked.startsAt } },
  [sess({ id: 'x', startsAt: booked.startsAt, status: 'available' })], from, to).length, 1,
  'a booking that became an open slot is stale');
eq(staleReminders({ x: { notifId: 'n', startsAt: booked.startsAt } },
  [sess({ id: 'x', startsAt: booked.startsAt, outcome: 'no_show' })], from, to).length, 1,
  'and so is one somebody has already marked');

// THE refusal. An arming for a session outside the window the caller read is
// left alone — cancelling it would be acting on a query that never asked.
eq(staleReminders(
  { future: { notifId: 'n', startsAt: new Date(NOW + 90 * DAY).toISOString() } },
  [], from, to).length, 0,
  'an arming outside the window that was read is never cancelled on the strength of it');

/* ── what gets forgotten ────────────────────────────────────────────────── */

const old: ArmedMap = {
  past: { notifId: 'n1', startsAt: new Date(NOW - 2 * HOUR).toISOString() },
  soon: { notifId: 'n2', startsAt: new Date(NOW + 2 * HOUR).toISOString() },
  broken: { notifId: 'n3', startsAt: 'nonsense' },
};
const expired = expiredReminders(old, NOW).sort();
eq(JSON.stringify(expired), JSON.stringify(['broken', 'past']),
  'a fired reminder and an undateable one are both dropped from the map');
// The undateable one is the important half: it can never match a live session
// and can never be cancelled, so leaving it would be a row nothing removes and
// the map would grow for the life of the install.
ok(expired.includes('broken'), 'including the one nothing else could ever remove');

/* ── the banner's words ─────────────────────────────────────────────────── */

const body = reminderBody(booked);
ok(body.includes('Sam Okafor'), 'the client is named — a coach with four today needs to know which');
ok(body.endsWith('.'), 'and it is a sentence');
ok(!reminderBody(sess({ id: 'z', startsAt: inThree, clientName: null })).includes('null'),
  'a nameless session does not render the word null');
ok(!body.includes('!'), 'and nothing shouts');

/* ── the backlog prompt ─────────────────────────────────────────────────── */

const thisWeek = weekKey(NOW);
// THE assertion. A count of null is a read that did not answer, and a banner
// about somebody's own business built out of our own failure is how a coach
// learns to ignore this one.
ok(!backlogDue(null, null, NOW), 'a failed read never prompts');
ok(!backlogDue(0, null, NOW), 'and neither does an empty queue');
ok(!backlogDue(BACKLOG_FLOOR - 1, null, NOW), 'a normal week’s work is not a backlog');
ok(backlogDue(BACKLOG_FLOOR, null, NOW), 'at the floor it is');
ok(!backlogDue(12, thisWeek, NOW), 'and having been shown this week, it waits');
ok(backlogDue(12, weekKey(NOW - 8 * DAY), NOW), 'until the following week');
// A stored key from the future — a wrong clock, a restored backup — must show
// rather than silence the prompt forever.
ok(backlogDue(12, weekKey(NOW + 30 * DAY), NOW), 'a key from a future week shows it rather than hiding it for good');

const b = backlogBody(12);
ok(b.includes('12 session'), 'the count is in it');
ok(/statement|revenue|pay/.test(b), 'and so is what it costs — this is the reason, not the chore');
ok(backlogBody(1).includes('1 session is'), 'one is singular');
ok(!backlogBody(1).includes('sessions'), 'properly singular');

eq(backlogNote(0, false), null, 'a clear queue says nothing at all rather than saying it is clear');
eq(backlogNote(null, false), null, 'and an absent count with no failure says nothing either');
ok((backlogNote(null, true) ?? '').includes('unknown'),
  'but a FAILED check says the queue is unknown rather than clear');
ok((backlogNote(4, false) ?? '').includes('4 session'), 'and a real backlog states it');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachReminders.test.ts — ok');
