// The two numbers a coach opens an attendance record for, and the several
// occasions on which neither of them may be given.
//
// Compile with tsc, then run under plain node.
import { longestGap, currentGap, classMix, averageDwell } from './attendanceGaps';
import type { AttendanceEvent, ClassDetail, MyVisit } from './attendance';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const TODAY = '2026-09-13';

/* ── 1. the longest gap, and the read that may not answer it ──────────────── */

// Newest-first, as `attendedDays()` hands them over. The gaps here are 2, 9 and
// 3 days; the answer is the nine-day one in June.
const DAYS = ['2026-09-04', '2026-09-01', '2026-08-23', '2026-08-21'];

{
  const g = longestGap(DAYS, true);
  eq(g?.days, 9, 'the longest stretch between two visits is found');
  eq(g?.from, '2026-08-23', 'and says which visit it started from');
  eq(g?.to, '2026-09-01', 'and which one ended it');
}

// The refusal that is the point of the flag. A newest-first read that hit its
// cap is missing the OLD end — exactly where a bigger gap would be — so a
// maximum over what came back is not a smaller answer, it is a wrong one.
eq(longestGap(DAYS, false), null, 'a truncated record answers no maximum at all');

// One visit is a point. A gap needs two, and 0 would say they have never missed.
eq(longestGap(['2026-09-04'], true), null, 'one visit is not a gap of zero');
eq(longestGap([], true), null, 'and no visits is not a gap of zero either');
eq(longestGap(['2026-09-04', 'not-a-day'], true), null, 'an unreadable day answers nothing');

// Order is not trusted from the caller.
{
  const shuffled = ['2026-08-21', '2026-09-04', '2026-08-23', '2026-09-01'];
  eq(longestGap(shuffled, true)?.days, 9, 'the answer does not depend on the order they arrive in');
}
// Two rows for the same day are one day.
eq(longestGap(['2026-09-01', '2026-09-01', '2026-09-03'], true)?.days, 2,
  'a day recorded twice is still one day');

/* ── 2. the current gap, which survives a cut record ──────────────────────── */

{
  const g = currentGap(DAYS, TODAY, longestGap(DAYS, true));
  eq(g?.days, 9, 'the days since the last visit are counted to today');
  eq(g?.since, '2026-09-04', 'from the newest day on record');
  // Nine equals their longest, and equal is not longer. A record needs beating.
  eq(g?.aRecord, false, 'a gap matching their longest is not yet unusual for them');
}

// The fact that turns a number into a phone call.
{
  const quiet = currentGap(['2026-08-01'], TODAY, longestGap(['2026-07-25', '2026-08-01'], true));
  eq(quiet?.days, 43, 'six weeks is six weeks');
  eq(quiet?.aRecord, true, 'and it is longer than they have ever gone before, which is the point');
}

// With nothing to compare against, the answer is unknown and never "normal".
eq(currentGap(['2026-08-01'], TODAY, null)?.aRecord, null,
  'no longest gap means the comparison is unknown, not false');

eq(currentGap(['2026-09-13'], TODAY, null)?.days, 0, 'in today is a gap of zero days');
eq(currentGap([], TODAY, null), null, 'nothing on record is not a gap of zero');
// A back-dated row or a disagreeing clock. Nothing honest to say.
eq(currentGap(['2026-09-20'], TODAY, null), null, 'a visit in the future produces no figure');

// Deliberately NOT gated on a whole read: the cut falls at the old end.
ok(currentGap(DAYS, TODAY, longestGap(DAYS, false)) != null,
  'a truncated record still answers how long it has been — the newest day survives the cut');

/* ── 3. what they actually turn up to ─────────────────────────────────────── */

const klass = (kind: string | null, title: string): ClassDetail => ({
  id: `c-${kind ?? 'x'}-${title}`, title, kind, instructor: null, branch: null, room: null,
  startsAt: '2026-09-01T09:00:00Z', durationMin: 45, tenantId: 't1',
});
const visit = (enteredAt: string, exitedAt: string | null): MyVisit => ({
  id: `v-${enteredAt}`, tenantId: 't1', classId: null, enteredAt, exitedAt, source: 'door',
});
let seq = 0;
const ev = (o: Partial<AttendanceEvent> & { outcome: AttendanceEvent['outcome'] }): AttendanceEvent => ({
  key: `e${seq++}`, source: 'class', at: '2026-09-01T09:00:00Z', day: '2026-09-01',
  tenantId: 't1', klass: null, booking: null, visit: null, ...o,
});
const here = { kind: 'attended', register: true, door: false } as const;

{
  const mix = classMix([
    ev({ outcome: here, klass: klass('Pilates', 'Reformer 7am') }),
    ev({ outcome: here, klass: klass('Pilates', 'Reformer 6pm') }),
    ev({ outcome: here, klass: klass('Spin', 'Spin 45') }),
    // Booked and never marked. Not an attendance, and counting it would answer
    // "what do they turn up to" with what they signed up for.
    ev({ outcome: { kind: 'unmarked' }, klass: klass('Yoga', 'Flow') }),
    ev({ outcome: { kind: 'upcoming' }, klass: klass('Yoga', 'Flow') }),
    ev({ outcome: { kind: 'waitlisted' }, klass: klass('Yoga', 'Flow') }),
  ]);
  eq(mix.rows.length, 2, 'only the attendances are counted');
  eq(mix.rows[0].label, 'Pilates', 'the commonest kind leads');
  eq(mix.rows[0].times, 2, 'with its count');
  eq(mix.rows[1].label, 'Spin', 'and the rest follow');
  ok(!mix.rows.some((r) => r.label === 'Yoga'), 'a class they never attended is not on the list');
}

// Two titles, one kind: one habit, not five rows.
eq(classMix([
  ev({ outcome: here, klass: klass('Pilates', 'Reformer 7am') }),
  ev({ outcome: here, klass: klass('Pilates', 'Reformer 6pm') }),
]).rows.length, 1, 'the same kind at different times is one habit');

// No kind on the row: the title is what there is.
eq(classMix([ev({ outcome: here, klass: klass(null, 'Open Mat') })]).rows[0].label, 'Open Mat',
  'a class with no kind is counted under its title');

// A class we could not read is its own figure, never folded into a named row.
{
  const mix = classMix([
    ev({ outcome: here, klass: klass('Spin', 'Spin 45') }),
    ev({ outcome: here, klass: null }),
    ev({ outcome: here, klass: null }),
  ]);
  eq(mix.unreadable, 2, 'the classes we could not open are counted apart');
  eq(mix.rows.length, 1, 'and are not added to the one we could');
}

// The floor is its own record, not a class.
{
  const mix = classMix([
    ev({ outcome: here, source: 'floor', klass: null, visit: visit('2026-09-01T09:00:00Z', null) }),
    ev({ outcome: here, klass: klass('Spin', 'Spin 45') }),
  ]);
  eq(mix.floor, 1, 'floor visits are counted as floor visits');
  eq(mix.unreadable, 0, 'and are not mistaken for a class nobody could read');
}

eq(classMix([]).rows.length, 0, 'an empty record is an empty mix');

/* ── 4. how long they stay, over the visits that recorded both ends ───────── */

{
  const d = averageDwell([
    ev({ outcome: here, visit: visit('2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z') }),
    ev({ outcome: here, visit: visit('2026-09-02T09:00:00Z', '2026-09-02T09:30:00Z') }),
    // Still inside, or a door that logs entries only. Not a zero-minute visit.
    ev({ outcome: here, visit: visit('2026-09-03T09:00:00Z', null) }),
    // No door record at all — a register tick and nothing more.
    ev({ outcome: here, visit: null }),
  ]);
  eq(d?.minutes, 45, 'the average is over the visits that recorded both ends');
  eq(d?.over, 2, 'and says how many those were');
  eq(d?.without, 2, 'and how many are not in it, which is what stops the figure being read as everybody');
}

// An average of no measurements is not zero minutes.
eq(averageDwell([ev({ outcome: here, visit: visit('2026-09-03T09:00:00Z', null) })]), null,
  'no completed visit, no average');
eq(averageDwell([]), null, 'and an empty record has none either');
// An unmarked class carries no attendance and must not reach the mean.
eq(averageDwell([
  ev({ outcome: { kind: 'unmarked' }, visit: visit('2026-09-03T09:00:00Z', '2026-09-03T23:00:00Z') }),
]), null, 'a class nobody marked is not a visit to average');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('attendanceGaps.test.ts — all assertions passed');
