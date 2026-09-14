// When a goal's target date has actually passed.
//
// ── Why this is its own file ───────────────────────────────────────────────
//
// `isOverdue` in src/lib/goalTargets.ts was three lines and was asserted only
// at distances — a target on the 20th, read on the 25th — which every wrong
// implementation also passes. What nothing asserted was the BOUNDARY, and the
// boundary is where all the harm was:
//
//   · `Date.parse` of a bare `date` is UTC midnight, so the deadline was the
//     instant the target day BEGAN rather than the instant it ended. A goal
//     "By 12 Sep" read "Target date passed (12 Sep)" all day on the 12th.
//   · That instant is UTC's, so it moved with the reader. A coach in Los
//     Angeles saw a goal go overdue at five in the afternoon on the ELEVENTH;
//     a coach at UTC+14 saw the same goal stay on time until two in the
//     afternoon on the twelfth. Same client, same goal, two answers.
//
// `goal_targets.target_date` is a bare Postgres `date`. It means a day in the
// life of the person who set it, and a day is not late until it is over.
//
// The zone is switched inside the process rather than left to the runner,
// because the failure only exists at particular offsets and a suite that can
// only see one of them is how this shipped. `process.env.TZ` is honoured by
// Node for Dates constructed after it changes.
//
// Compile with tsc, run with node.
import {
  isOverdue, deadlineTally, deadlineNote, type GoalTarget, type DeadlineTally,
} from './goalTargets';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const goal = (over: Partial<GoalTarget> = {}): GoalTarget => ({
  id: 'g1', kind: 'weight', targetValue: 80, title: null,
  targetDateISO: '2026-09-12', achievedAtISO: null,
  createdAtISO: '2026-08-01T09:00:00Z',
  ...over,
});

/** Run `f` with the process in `zone`, and put the zone back afterwards. */
function inZone(zone: string, f: () => void) {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try { f(); } finally { if (was == null) delete process.env.TZ; else process.env.TZ = was; }
}

/** A local wall-clock instant in the zone currently in force. */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

/* ── the boundary, in five zones spanning the whole range ──────────────────── */

const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Midway', 'Asia/Kolkata'];

for (const zone of ZONES) {
  inZone(zone, () => {
    const g = goal();

    eq(isOverdue(g, at(2026, 9, 11, 23, 59)), false,
      `${zone}: the night before the target day, the goal is not late`);
    eq(isOverdue(g, at(2026, 9, 12, 0, 1)), false,
      `${zone}: one minute into the target day it is not late — this is the whole day the old code took away`);
    eq(isOverdue(g, at(2026, 9, 12, 12, 0)), false,
      `${zone}: nor at midday on the target day`);
    eq(isOverdue(g, at(2026, 9, 12, 23, 59)), false,
      `${zone}: nor with a minute of it left, which is still a minute they can use`);
    eq(isOverdue(g, at(2026, 9, 13, 0, 1)), true,
      `${zone}: once the target day is over, it is late`);
    eq(isOverdue(g, at(2026, 9, 20, 9, 0)), true,
      `${zone}: and it stays late`);
  });
}

/* ── the same instant, read in two zones, must not disagree about a day ───── */

{
  // 2026-09-12T07:00:00Z. In Los Angeles that is midnight on the 12th — the
  // target day has just started, so nothing is late. Under the old
  // implementation the UTC midnight of the 12th had already gone by, so this
  // exact instant reported the goal as overdue to that coach.
  const instant = Date.parse('2026-09-12T07:00:00Z');
  inZone('America/Los_Angeles', () => {
    eq(isOverdue(goal(), instant), false,
      'at midnight in Los Angeles on the target day the goal has a full day left');
  });
  // The same instant is 21:00 on the 12th in Kiritimati — still the target day
  // there too, and still not late.
  inZone('Pacific/Kiritimati', () => {
    eq(isOverdue(goal(), instant), false,
      'and the same instant is still the target day at UTC+14, so it is not late there either');
  });
}

/* ── the two answers that are not about dates at all ───────────────────────── */

inZone('UTC', () => {
  eq(isOverdue(goal({ achievedAtISO: '2026-09-01T10:00:00Z' }), at(2026, 12, 1)), false,
    'a goal they reached is never overdue, however long ago the date was');
  eq(isOverdue(goal({ targetDateISO: null }), at(2026, 12, 1)), false,
    'and a goal with no target date has no date to have passed');
  eq(isOverdue(goal({ targetDateISO: 'not a date' }), at(2026, 12, 1)), false,
    'an unreadable target date is not a passed one — it is an unknown one, and lateness is a claim');
});

/* ── a timestamp in the column, which is not what it holds but might be ────── */

inZone('UTC', () => {
  // `target_date` is a bare date and this is defensive rather than expected.
  // A full timestamp keeps its own instant through `localDate`, and the day it
  // falls on is still the day that has to be over.
  const g = goal({ targetDateISO: '2026-09-12T18:00:00Z' });
  eq(isOverdue(g, Date.parse('2026-09-12T23:00:00Z')), false,
    'a timestamped target is not late while its own day is still running');
  eq(isOverdue(g, Date.parse('2026-09-13T01:00:00Z')), true,
    'and is once that day is over');
});

/* ── the tally the coach's goal board leads with ────────────────────────────
 *
 * `deadlineTally` is the same boundary counted rather than tested one goal at a
 * time, plus the two buckets that exist so an unjudgeable goal is never counted
 * as on time.
 *
 * The `soon` window is built by LOCAL CALENDAR arithmetic, and the assertion
 * that makes that claim is the daylight-saving one at the bottom — found by
 * mutation, not by reading. A version written `nowMs + days * 86400000` passes
 * every other assertion in this file, including the UTC+14 ones: a fixed offset
 * shifts both sides of the comparison equally, so only a day that is not 24
 * hours long can tell the two apart. */

inZone('UTC', () => {
  // Null is not an empty book. The screen hands null when the read did not
  // land, and zeros there would read as "nothing has slipped".
  eq(deadlineTally(null, at(2026, 9, 14)), null,
    'an unread goal list produces no tally at all, never four zeros');
  eq(deadlineTally(undefined, at(2026, 9, 14)), null,
    'and neither does an absent one');

  const t0 = deadlineTally([], at(2026, 9, 14));
  eq(t0?.overdue, 0, 'a client with no goals has none overdue');
  eq(t0?.undated, 0, 'and none undated');

  const book = [
    goal({ id: 'past', targetDateISO: '2026-09-12' }),
    goal({ id: 'today', targetDateISO: '2026-09-14' }),
    goal({ id: 'in-6', targetDateISO: '2026-09-20' }),
    goal({ id: 'in-8', targetDateISO: '2026-09-22' }),
    goal({ id: 'none', targetDateISO: null }),
    goal({ id: 'junk', targetDateISO: 'not a date' }),
    goal({ id: 'done', targetDateISO: '2026-08-01', achievedAtISO: '2026-08-02T09:00:00Z' }),
  ];
  const t = deadlineTally(book, at(2026, 9, 14, 10));

  eq(t?.overdue, 1, 'only the goal whose day is over is overdue');
  // The boundary that matters most on this screen: today's goal is SOON and
  // never overdue. A tally that compared the target date to today's date as
  // strings would put it in the wrong bucket and tell a coach a client had
  // missed a deadline they still have the afternoon of.
  eq(t?.soon, 2, 'today and the one other day inside the next seven are due soon');
  eq(t?.undated, 1, 'a goal with no target date is named, not counted as on time');
  eq(t?.unreadable, 1, 'and neither is one whose date this build cannot read');

  // Two goals are in NO bucket: the achieved one, a month past its date, and
  // `in-8`, which is the eighth day out. That second absence is the point of
  // there being no `ahead` field — a coach acts on the first three and nothing
  // here invites them to infer a fourth by subtraction.
  eq((t?.overdue ?? 0) + (t?.soon ?? 0) + (t?.undated ?? 0) + (t?.unreadable ?? 0), 5,
    'a goal marked done is counted in no bucket, however long ago its date was');

  const narrow = deadlineTally(book, at(2026, 9, 14, 10), 0);
  eq(narrow?.soon, 1, 'with a window of zero days, only today is soon');
});

// Large offset, and a day either side of the local date line's disagreement
// with UTC. In Kiritimati (UTC+14) the local 14th begins at 10:00 UTC on the
// 13th; a tally built on UTC days would have the 12th's goal still merely
// "soon" at this instant, and today's goal already overdue.
inZone('Pacific/Kiritimati', () => {
  const t = deadlineTally(
    [goal({ targetDateISO: '2026-09-12' }), goal({ id: 'b', targetDateISO: '2026-09-14' })],
    at(2026, 9, 14, 9),
  );
  eq(t?.overdue, 1, 'UTC+14: the 12th is over here and is counted overdue');
  eq(t?.soon, 1, 'and the 14th is still today here, so it is soon and not late');
});

// The day that is 25 hours long. Clocks go back in Los Angeles on 1 Nov 2026,
// so the seven days after Wednesday 28 October contain 169 hours and not 168.
// Counted on the local calendar, a goal targeted at 4 November is the seventh
// day out and is due soon. Counted as `nowMs + 8 * 86400000`, the window closes
// an hour before the 5th begins — and the goal falls out of the figure the coach
// reads, silently, once a year, in the week a coach is most likely to be
// planning around a clock change.
inZone('America/Los_Angeles', () => {
  const t = deadlineTally(
    [goal({ targetDateISO: '2026-11-04' })],
    at(2026, 10, 28),
  );
  eq(t?.soon, 1, 'across the end of daylight saving, the seventh day out is still inside a seven-day window');
  eq(t?.overdue, 0, 'and nothing about a clock change makes it late');
});

/* ── the sentence, and the clause that keeps it from being an all-clear ───── */

{
  const note = (o: Partial<DeadlineTally>) => deadlineNote(
    { overdue: 0, soon: 0, undated: 0, unreadable: 0, ...o },
  );

  eq(deadlineNote(null), null, 'no tally, no sentence');
  eq(note({}), null, 'a client with no open goals gets no sentence, because the board above already says so');

  eq(note({ overdue: 2, soon: 1 }),
    '2 goals are past their target date. 1 more goal is due within a week.',
    'the two figures, and "more" only once there is something to be more than');
  eq(note({ overdue: 1 }),
    '1 goal is past its target date. Nothing with a target date is late or due within a week.'.split('.')[0] + '.',
    'one overdue goal is singular throughout');
  eq(note({ soon: 1 }),
    '1 goal is due within a week.',
    'and a goal due soon with nothing late does not say "more"');

  // The clause this whole function exists for. Four goals, none of which has a
  // target date: the deadline figures are both zero and both are true, and a
  // board that stopped after the first sentence would be an all-clear over a
  // set nothing was ever asked of.
  eq(note({ undated: 4 }),
    'Nothing with a target date is late or due within a week. 4 goals have no target date, so they are in neither figure.',
    'an empty set is never reported as an all-clear on its own');
  eq(note({ overdue: 1, undated: 1, unreadable: 1 }),
    '1 goal is past its target date. 1 goal has no target date, so it is in neither figure. '
    + '1 goal carries a target date this app could not read, so it is in neither figure either.',
    'and the two kinds of unknown are named apart, because they are different things to do something about');

  // check:prose walks these strings; a dash inside a sentence is what it exists
  // to stop, and this asserts it here too so a rewrite cannot reintroduce one
  // without a test saying so.
  for (const s of [note({ overdue: 2, soon: 1 }), note({ undated: 4 }), note({ unreadable: 1 })]) {
    ok(!/\s[—–-]\s/.test(s ?? ''), `no dash inside a sentence: ${JSON.stringify(s)}`);
  }
}

if (errors.length) {
  console.error(`goalOverdue: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('goalOverdue ok — a day is not late until it is over, it is over on the reader’s own calendar, and a goal nothing can be said about is named rather than counted as on time');
