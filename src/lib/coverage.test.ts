// Extended pure-logic coverage (Phase 8 QA). Compile with tsc then run with node.
import { currentStreak, longestStreak, personalRecords, weekStats, est1RM, isNewPR, streakMilestone, freezeBudget, currentStreakFrozen } from './streaks';
import { parseRepRange, suggestNextWeight, suggestForExercise, priorBest1RM, suggestProgression } from './progression';
import { overlaps, isLateCancellation, cancelSession, nextFromWaitlist } from './booking';
import type { WorkoutEntry } from './mockData';
import { rowToEntry, entryToRow, PERSISTED_FIELDS } from './workoutRow';
import { summarise, money, type MembershipPlan, type Membership, type GymPayment } from './gymRecord';
import { weeklyOccurrences, summariseAttendance, pct, type GymClass, type NewClass } from './gymSchedule';
import { buildIcs } from './ics';
import { estimateDish, searchDishes, DISHES } from './restaurant';
import type { TrainingSession } from './types';

const errors: string[] = [];
let checks = 0;
const ok = (c: boolean, m: string) => { checks++; if (!c) errors.push(m); };
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

// ── streaks ──
const log: WorkoutEntry[] = [0, 1, 2, 3, 4].map((n) => ({ t: day(n), exercise: 'Back Squat', sets: [[8, 50 + n]] as [number, number][], kcal: 100 }));
ok(currentStreak(log, Date.now()) === 5, 'currentStreak 5');
ok(longestStreak([{ t: day(2), exercise: 'X', sets: [[8, 50]] }, { t: day(3), exercise: 'X', sets: [[8, 50]] }, { t: day(4), exercise: 'X', sets: [[8, 50]] }]) === 3, 'longest 3');
ok(currentStreak([], Date.now()) === 0, 'empty streak 0');
ok(est1RM(100, 30) === 200 && est1RM(100, 0) === 100, 'est1RM Epley');
ok(personalRecords(log)[0].exercise === 'Back Squat', 'PR exercise');
ok(weekStats(log, Date.now()).workouts === 5, 'weekStats workouts');
ok(streakMilestone(7)!.includes('week') && streakMilestone(1) === null, 'milestone labels');
// ── ics export ──
const _ics = buildIcs([{ start: '2026-07-20T09:00:00Z', durationMin: 60, title: 'Training, with; coach' }], 'Repple', Date.parse('2026-07-15T00:00:00Z'));
ok(_ics.startsWith('BEGIN:VCALENDAR') && _ics.trimEnd().endsWith('END:VCALENDAR'), 'ics envelope');
ok(_ics.includes('DTSTART:20260720T090000Z') && _ics.includes('DTEND:20260720T100000Z'), 'ics start/end utc');
ok(_ics.includes('SUMMARY:Training\\, with\\; coach'), 'ics escapes comma/semicolon');
ok((_ics.match(/BEGIN:VEVENT/g) || []).length === 1, 'ics one event');
ok(buildIcs([], 'X', 0).includes('X-WR-CALNAME:X'), 'ics empty calendar still valid');
// ── restaurant estimator ──
const _burrito = DISHES.find((d) => d.id === 'burrito')!;
ok(estimateDish(_burrito, 1).kcal === _burrito.kcal, 'full portion = base kcal');
ok(estimateDish(_burrito, 2).kcal === _burrito.kcal * 2, 'double portion doubles kcal');
ok(estimateDish(_burrito, 0.5).protein === Math.round(_burrito.protein * 0.5), 'half portion halves protein');
ok(estimateDish(_burrito, 1).name === _burrito.name && estimateDish(_burrito, 2).name.includes('2'), 'portion label');
ok(searchDishes('ramen').length === 1 && searchDishes('ramen')[0].id === 'ramen', 'search by name');
ok(searchDishes('mexican').every((d) => d.cuisine === 'Mexican'), 'search by cuisine');
ok(searchDishes('').length === DISHES.length || searchDishes('').length === 40, 'empty query returns catalog');
// ── streak freeze ──
// 5-day chain (days 0..4), miss day 5, then trained days 6,7 -> a freeze bridges day 5.
const gapLog: WorkoutEntry[] = [0,1,2,3,4,6,7,8,9,10,11,12].map((n) => ({ t: day(n), exercise: 'X', sets: [[8,50]] as [number,number][] }));
ok(currentStreak(gapLog, Date.now()) === 5, 'raw streak stops at gap = 5');
ok(freezeBudget(gapLog) === 1, 'freezeBudget: 12 days -> 1');
ok(currentStreakFrozen(gapLog, 1, Date.now()).streak === 12, 'freeze bridges the gap -> 12');
ok(currentStreakFrozen(gapLog, 1, Date.now()).freezesUsed === 1, 'one freeze consumed');
ok(currentStreakFrozen(gapLog, 0, Date.now()).streak === 5, 'no freeze -> raw 5');
ok(freezeBudget(log) === 0, 'freezeBudget: 5 days -> 0');
ok(currentStreakFrozen([], 2, Date.now()).streak === 0, 'empty frozen streak 0');
// a trailing freeze is never wasted when nothing older exists
const trailLog: WorkoutEntry[] = [0,1,2].map((n) => ({ t: day(n), exercise: 'X', sets: [[8,50]] as [number,number][] }));
ok(currentStreakFrozen(trailLog, 2, Date.now()).freezesUsed === 0, 'no freeze wasted on trailing edge');
const prEntry: WorkoutEntry = { t: day(0), exercise: 'B', sets: [[5, 100]] };
ok(isNewPR([{ t: day(3), exercise: 'B', sets: [[5, 80]] }, prEntry], prEntry) === true, 'isNewPR true');

// ── progression ──
ok(JSON.stringify(parseRepRange('6-8')) === JSON.stringify({ low: 6, high: 8 }), 'range 6-8');
// ── progression × RPE/felt ──
const felt = (feel: any): WorkoutEntry[] => [{ t: day(1), exercise: 'Back Squat', sets: [[12,100],[12,100]] as [number,number][], feel }];
// Cleared the top of the range but it felt hard -> hold load, bank reps (not increase).
ok(suggestProgression(felt(['hard','hard']))[0].action === 'reps', 'hard top set downgrades increase->reps');
// Cleared and felt easy -> still increase, with a confidence note.
ok(suggestProgression(felt(['easy','easy']))[0].action === 'increase', 'easy top set keeps increase');
// In range (not top) but felt easy -> accelerate to a load increase.
const midEasy: WorkoutEntry[] = [{ t: day(1), exercise: 'Back Squat', sets: [[9,100],[9,100]] as [number,number][], feel: ['easy','easy'] }];
ok(suggestProgression(midEasy)[0].action === 'increase', 'in-range + easy accelerates to increase');
// In range but felt hard -> hold instead of chasing another rep.
const midHard: WorkoutEntry[] = [{ t: day(1), exercise: 'Back Squat', sets: [[9,100],[9,100]] as [number,number][], feel: ['ok','hard'] }];
ok(suggestProgression(midHard)[0].action === 'hold', 'in-range + hard holds');
// No feel data -> unchanged behaviour (cleared top -> increase).
ok(suggestProgression(felt(undefined))[0].action === 'increase', 'no feel -> default increase');
ok(parseRepRange('45 sec') === null, 'range non-numeric null');
const up = suggestNextWeight([[8, 50], [8, 52]], { low: 6, high: 8 });
ok(!!up && up.up === true && up.weight === 54.5, 'overload up');
const hold = suggestNextWeight([[6, 50]], { low: 6, high: 8 });
ok(!!hold && hold.up === false, 'hold when reps missed');
ok(suggestForExercise(log, 'Back Squat', '6-8') != null, 'suggestForExercise');
ok(priorBest1RM(log, 'Back Squat') > 0, 'priorBest1RM > 0');

// ── booking ──
const existing: TrainingSession[] = [{ id: 's1', trainerId: 't1', clientId: 'c1', startsAt: '2026-07-20T20:00:00Z', durationMin: 60, status: 'booked', released: false }];
ok(overlaps('2026-07-20T20:30:00Z', 60, existing) === true, 'overlap detected');
ok(overlaps('2026-07-20T21:30:00Z', 60, existing) === false, 'no overlap');
ok(isLateCancellation(new Date(Date.now() + 3600_000).toISOString()) === true, 'late cancel inside 24h');
ok(isLateCancellation(new Date(Date.now() + 48 * 3600_000).toISOString()) === false, 'not late 48h out');
const cr = cancelSession(existing[0], 75, ['c1', 'c2', 'c3']);
ok(cr.notifyClientIds.length === 2 && !cr.notifyClientIds.includes('c1'), 'cancel excludes canceller');
ok(nextFromWaitlist(['c9', 'c8']) === 'c9' && nextFromWaitlist([]) === null, 'waitlist FIFO');

// ── workout row round trip ──────────────────────────────────────────────────
// `entryToRow` silently omitted `feel` and `zones` for months. Both were read
// back on the way in, so the pair looked symmetrical while every session's
// perceived effort and time-in-zone went nowhere. These assertions hold both
// ends and fail if a field is ever dropped again.
const fullEntry: WorkoutEntry = {
  t: '2026-08-23T10:00:00.000Z',
  exercise: 'Back Squat',
  sets: [[8, 100], [8, 102.5]] as [number, number][],
  feel: ['ok', 'hard'],
  cardio: { mins: 12, dist: 2.4, unit: 'km', watts: 180, hrAvg: 141, hrHigh: 168 },
  kcal: 315,
  zones: { z1: 60, z2: 420, z3: 180, z4: 30, z5: 0 },
};

const roundTripped = rowToEntry(entryToRow('user-1', fullEntry));
for (const f of PERSISTED_FIELDS) {
  ok(JSON.stringify(roundTripped[f]) === JSON.stringify(fullEntry[f]),
     `workout field "${String(f)}" did not survive the round trip to a row`);
}

// Every persisted field must actually appear on the row — the exact failure
// that hid the zones bug, where the key was simply absent from the insert.
const row = entryToRow('user-1', fullEntry) as unknown as Record<string, unknown>;
ok(row.user_id === 'user-1', 'row must carry the user id');
ok(row.performed_at === fullEntry.t, 'row must carry performed_at');
for (const [entryKey, rowKey] of [['exercise', 'exercise'], ['sets', 'sets'], ['feel', 'feel'],
                                  ['cardio', 'cardio'], ['kcal', 'kcal'], ['zones', 'zones']] as const) {
  ok(rowKey in row, `row is missing the "${rowKey}" column`);
  ok(row[rowKey] !== undefined && row[rowKey] !== null,
     `row column "${rowKey}" was dropped even though the entry had a value for ${entryKey}`);
}

// An absent value must become null rather than vanish, so an edit can clear a
// field instead of leaving whatever was there before.
const sparse: WorkoutEntry = { t: fullEntry.t, exercise: 'Walk' };
const sparseRow = entryToRow('user-1', sparse) as unknown as Record<string, unknown>;
for (const k of ['sets', 'feel', 'cardio', 'kcal', 'zones']) {
  ok(k in sparseRow && sparseRow[k] === null, `absent "${k}" should be sent as null, not omitted`);
}
ok(rowToEntry(sparseRow as never).sets === undefined, 'a null column should read back as undefined');


// ── gym revenue summary ─────────────────────────────────────────────────────
// The whole point of these figures is that they refuse to invent. A gym with
// nothing recorded must read as unknown, not as zero — the failure that once
// put a fabricated AED 214,000/mo in front of an owner.
const plan = (id: string, cents: number, interval: 'month'|'year'|'once'): MembershipPlan =>
  ({ id, name: id, priceCents: cents, currency: 'AED', interval, active: true });
const mem = (id: string, planId: string | null, status: Membership['status'] = 'active'): Membership =>
  ({ id, memberId: 'm' + id, memberName: 'M', planId, planName: null,
     startedOn: '2026-01-01', endsOn: null, status });
const pay = (cents: number): GymPayment =>
  ({ id: 'p' + cents, memberId: 'm', memberName: 'M', amountCents: cents,
     currency: 'AED', method: 'card', takenAt: '2026-08-01T00:00:00Z', note: null });

const emptyGym = summarise([], [], []);
ok(emptyGym.takenCents === null, 'a gym with no payments must report null, not 0');
ok(emptyGym.mrrCents === null, 'a gym with no priced memberships must report null MRR, not 0');
ok(emptyGym.activeMembers === 0, 'active member count is a real count and may be 0');

const plans = [plan('monthly', 20000, 'month'), plan('annual', 240000, 'year'), plan('daypass', 5000, 'once')];
const s = summarise([pay(20000), pay(5000)], [mem('a','monthly'), mem('b','annual'), mem('c','daypass')], plans);
ok(s.takenCents === 25000, 'payments must sum in minor units');
ok(s.payments === 2, 'payment count');
// 200.00/mo + 2400.00/yr -> 200.00 + 200.00 = 400.00; the day pass adds nothing.
ok(s.mrrCents === 40000, `annual should amortise to monthly and once should not recur (got ${s.mrrCents})`);
ok(s.activeMembers === 3, 'active members counted');

// A cancelled membership contributes nothing.
const s2 = summarise([], [mem('a','monthly','cancelled')], plans);
ok(s2.activeMembers === 0, 'cancelled membership is not active');
ok(s2.mrrCents === null, 'no active priced membership means unknown MRR, not 0');

// A membership whose plan was retired and unlinked cannot be priced.
const s3 = summarise([], [mem('a', null)], plans);
ok(s3.mrrCents === null, 'membership with no plan cannot contribute a price');

ok(money(null) === null, 'money(null) must stay null so a caller cannot render 0.00 for unknown');
ok(money(123456, 'AED') === 'AED 1,234.56', `money formats minor units (got ${money(123456,'AED')})`);
ok(money(0) === 'AED 0.00', 'a real zero still formats as zero');


// ── timetable and attendance ────────────────────────────────────────────────
const base: NewClass = {
  title: 'Spin', startsAt: '2026-09-01T18:00:00.000Z', durationMin: 45, capacity: 20,
};

// A weekly series is materialised so a single week can be edited or dropped.
const series = weeklyOccurrences(base, 4);
ok(series.length === 4, 'four weeks means four occurrences');
ok(series[0].startsAt === base.startsAt, 'the first occurrence is the one given');
const wk = (i: number) => new Date(series[i].startsAt).getTime();
ok(wk(1) - wk(0) === 7 * 86400000, 'occurrences are exactly a week apart');
ok(series.every((c) => c.title === 'Spin' && c.capacity === 20), 'series carries the class details');

// A public holiday is a skipped date, not a broken series.
const skipped = weeklyOccurrences(base, 4, ['2026-09-15']);
ok(skipped.length === 3, `skipping one date drops one occurrence (got ${skipped.length})`);
ok(!skipped.some((c) => c.startsAt.slice(0, 10) === '2026-09-15'), 'the skipped date is absent');

// Attendance figures must not invent a rate.
const cls = (booked: number, attended: number, capacity: number): GymClass => ({
  id: 'c' + booked + attended, title: 'Spin', room: null, instructor: null, trainerId: null,
  startsAt: base.startsAt, durationMin: 45, capacity, booked, attended,
});

const none = summariseAttendance([]);
ok(none.showRate === null, 'no classes means no show rate, not 0%');
ok(none.fillRate === null, 'no classes means no fill rate, not 0%');

const emptyClass = summariseAttendance([cls(0, 0, 20)]);
ok(emptyClass.showRate === null, 'a class nobody booked has no show rate, not 0%');
ok(emptyClass.fillRate === 0, 'a class nobody booked has a real fill rate of 0');

const a = summariseAttendance([cls(10, 8, 20), cls(10, 2, 20)]);
ok(a.booked === 20 && a.attended === 10, 'bookings and attendance sum');
ok(a.showRate === 0.5, `show rate is attended/booked (got ${a.showRate})`);
ok(a.fillRate === 0.5, `fill rate is booked/capacity (got ${a.fillRate})`);
ok(pct(a.showRate) === '50%', 'pct formats');
ok(pct(null) === null, 'pct(null) stays null so a caller cannot render 0%');

if (errors.length) { console.log('COVERAGE FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL COVERAGE TESTS PASSED (${checks} assertions)`);
