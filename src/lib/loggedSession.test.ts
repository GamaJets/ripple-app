// An hour of training, and the five rows it is stored as.
// Compile with tsc, run with node.
//
//   ONE SESSION      five rows sharing an instant are one thing, not five
//   WHOSE HOUR       who wrote it is part of a session's identity
//   THE LINK         `session_id` is exact and beats the day every time
//   THE DAY          and when nothing links them, the day is said to be a day
//   THE OTHER COACH  a stranger's row never joins this coach's session
import {
  loggedSessions, sessionSummary, sessionFeedTitle, entriesInSession, pairingNote,
  type SessionRow,
} from './loggedSession';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const COACH = 'coach-1';
const OTHER = 'coach-2';
/* The hour from the report, to the second. Five rows, one coach, one instant,
 * `session_id` null on every one of them — which is what a coach logging from
 * a client's record rather than from the booked hour writes, on purpose. */
//
// Built from a LOCAL Date rather than written as a Z string, and that is not
// tidiness: `test:zones` runs this suite under six timezones, the day match
// below is a LOCAL day, and a fixed UTC instant lands on the 14th in New York
// and the 15th in Auckland. A literal here would have made the pairing
// assertions pass in three zones and fail in three.
const AT = new Date(2026, 8, 15, 10, 0, 35).toISOString();
const row = (o: Partial<SessionRow> & { exercise: string }): SessionRow => ({
  t: AT, sets: [[12, 38.3], [15, 38.3], [15, 38.3]], loggedBy: COACH, ...o,
});
const THE_HOUR: SessionRow[] = [
  row({ exercise: 'Seated Leg Curl' }),
  row({ exercise: 'Dumbbell Split Squat', sets: [[12, 6], [12, 6], [12, 6], [12, 6]] }),
  row({ exercise: 'Hip Thrust', sets: [[12, 22.5], [12, 22.5], [12, 22.5]] }),
  row({ exercise: 'Hip Abduction', sets: [[12, 50], [12, 50], [12, 50]] }),
  row({ exercise: 'Abdominal crunch', sets: [[12, 24.75], [12, 24.75], [15, 24.75]] }),
];

/* ── one session ────────────────────────────────────────────────────────── */

{
  const out = loggedSessions(THE_HOUR);
  eq(out.length, 1, 'five rows sharing an instant are ONE session, which is the whole report');
  eq(out[0].exercises, 5, 'five movements');
  eq(out[0].sets, 16, 'sixteen sets — 3 + 4 + 3 + 3 + 3');
  eq(out[0].loggedBy, COACH, 'and the coach who wrote them');
  eq(out[0].sessionId, null, 'no booked hour was named, and null is not an invention');
  eq(sessionSummary(out[0], '5,472 kg'), '5 exercises · 16 sets · 5,472 kg',
     'the line under the heading');
  eq(sessionSummary(out[0], null), '5 exercises · 16 sets',
     'and no load at all rather than a zero, when nothing could price it');
}

// The same movement twice in one hour is a rep scheme, not two exercises.
{
  const out = loggedSessions([
    row({ exercise: 'Hip Thrust', sets: [[12, 60]] }),
    row({ exercise: 'Hip Thrust', sets: [[8, 80]] }),
  ]);
  eq(out[0].exercises, 1, 'one movement logged twice is one exercise');
  eq(out[0].sets, 2, 'and two sets');
}

// A cardio row carries no sets and contributes none — never a zero, never a
// crash. It is still part of the session it was logged in.
{
  const out = loggedSessions([
    row({ exercise: 'Hip Thrust', sets: [[12, 60]] }),
    { t: AT, exercise: 'Cycling', loggedBy: COACH },
  ]);
  eq(out[0].exercises, 2, 'a cardio row is part of the hour');
  eq(out[0].sets, 1, 'and adds no sets to it');
}

/* ── whose hour ─────────────────────────────────────────────────────────── */

// The key is the instant AND who wrote it. A coach typing an hour up at the
// same moment the member logs their own accessory work is two sessions with
// two attributions, and folding them would make one of the attributions false.
{
  const out = loggedSessions([
    row({ exercise: 'Hip Thrust' }),
    { t: AT, exercise: 'Farmer Carry', sets: [[1, 40]] },
  ]);
  eq(out.length, 2, 'one instant, two writers, two sessions');
  eq(out.map((s) => s.loggedBy).sort(), [COACH, null].sort() as never,
     'and each keeps its own author');
}

{
  const mine = loggedSessions([{ t: AT, exercise: 'Row', sets: [[10, 50]] }])[0];
  const theirs = loggedSessions(THE_HOUR)[0];
  eq(sessionFeedTitle(mine, null), 'Training Session', 'my own hour is not "with" anybody');
  eq(sessionFeedTitle(theirs, null), 'Session With Your Coach',
     'a coach this app cannot name is still the coach');
  eq(sessionFeedTitle(theirs, 'Sam'), 'Session With Sam', 'and is named where it can be');
  eq(sessionFeedTitle(theirs, '   '), 'Session With Your Coach',
     'a blank name is not a name');
}

/* ── order ──────────────────────────────────────────────────────────────── */

{
  const out = loggedSessions([
    { t: '2026-09-10T08:00:00.000Z', exercise: 'A', sets: [[5, 5]] },
    { t: '2026-09-14T08:00:00.000Z', exercise: 'B', sets: [[5, 5]] },
    // A row nobody can date. Real training, typed by somebody — kept, but it
    // must not sort to the epoch and present itself as the oldest thing that
    // ever happened.
    { t: 'not a date', exercise: 'C', sets: [[5, 5]] },
  ]);
  eq(out.map((s) => s.entries[0].exercise), ['B', 'A', 'C'],
     'newest first, and an undated row last rather than first');
}

/* ── pairing with the booked hour ───────────────────────────────────────── */

const BOOKED = { id: 'sess-1', startsAt: new Date(2026, 8, 15, 7, 15).toISOString(), trainerId: COACH };

// The link, when there is one. Exact and provable.
{
  const log = [
    ...THE_HOUR.map((e) => ({ ...e, sessionId: 'sess-1' })),
    // Something the member logged the same day and did not do in the session.
    { t: new Date(2026, 8, 15, 19, 0).toISOString(), exercise: 'Evening Walk', sets: [[1, 0]] as [number, number][] },
  ];
  const p = entriesInSession(log, BOOKED);
  eq(p.by, 'link', 'a named session is matched by name');
  eq(p.entries.length, 5, 'and ONLY by name — the evening walk is not in this hour');
  eq(pairingNote('link'), null, 'a linked session has nothing to qualify');
}

// No link anywhere: the day, and said to be the day.
{
  const p = entriesInSession(THE_HOUR, BOOKED);
  eq(p.by, 'day', 'with nothing to link them the day is the only honest answer');
  eq(p.entries.length, 5, 'and the coach’s five rows are what it finds');
  ok((pairingNote('day') ?? '').length > 0, 'and it says so where the member reads it');
}

// A row already filed under a DIFFERENT hour is never swept in by its date.
{
  const log: SessionRow[] = [
    ...THE_HOUR,
    { t: AT, exercise: 'Bench Press', sets: [[8, 60]], loggedBy: COACH, sessionId: 'sess-9' },
  ];
  const p = entriesInSession(log, BOOKED);
  eq(p.by, 'day', 'no row names THIS session, so the day is still the rule');
  ok(!p.entries.some((e) => e.exercise === 'Bench Press'),
     'but an hour that belongs to another session does not join this one');
}

// Another coach's write-up on the same day belongs to their session, not this
// one. The member's OWN rows are kept: a member who types their session up
// themselves is the ordinary case for a coach who does not log.
{
  const log: SessionRow[] = [
    { t: AT, exercise: 'Hip Thrust', sets: [[12, 60]], loggedBy: OTHER },
    { t: AT, exercise: 'Leg Press', sets: [[12, 80]] },
  ];
  const p = entriesInSession(log, BOOKED);
  eq(p.entries.map((e) => e.exercise), ['Leg Press'],
     'a stranger’s row is not this coach’s session; the member’s own is');
}

// Nothing on the day at all.
{
  const p = entriesInSession([{ t: new Date(2026, 8, 1, 9, 0).toISOString(), exercise: 'Row', sets: [[5, 5]] }], BOOKED);
  eq(p.by, 'none', 'nothing found is its own answer');
  eq(p.entries.length, 0, 'and it is empty rather than approximate');
  eq(pairingNote('none'), null, 'with nothing shown there is nothing to qualify');
}

// A session whose start will not parse cannot be paired by day, and must not
// throw or pair by accident.
{
  const p = entriesInSession(THE_HOUR, { id: 'sess-2', startsAt: 'nonsense', trainerId: COACH });
  eq(p.by, 'none', 'an undated session pairs with nothing');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('loggedSession: ok (five rows are one hour, and the hour says how sure it is)');
