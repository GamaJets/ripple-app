// Extended pure-logic coverage (Phase 8 QA). Compile with tsc then run with node.
import { currentStreak, longestStreak, personalRecords, weekStats, est1RM, isNewPR, streakMilestone, freezeBudget, currentStreakFrozen } from './streaks';
import { parseRepRange, suggestNextWeight, suggestForExercise, priorBest1RM, suggestProgression } from './progression';
import { overlaps, isLateCancellation, cancelSession, nextFromWaitlist } from './booking';
import type { WorkoutEntry } from './mockData';
import { buildIcs } from './ics';
import { estimateDish, searchDishes, DISHES } from './restaurant';
import type { TrainingSession } from './types';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };
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

if (errors.length) { console.log('COVERAGE FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL COVERAGE TESTS PASSED (${23} assertions)`);
