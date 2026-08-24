// Extended pure-logic coverage (Phase 8 QA). Compile with tsc then run with node.
import { currentStreak, longestStreak, personalRecords, weekStats, est1RM, isNewPR, streakMilestone, freezeBudget, currentStreakFrozen } from './streaks';
import { parseRepRange, suggestNextWeight, suggestForExercise, priorBest1RM, suggestProgression } from './progression';
import { overlaps, isLateCancellation, cancelSession, nextFromWaitlist } from './booking';
import type { WorkoutEntry } from './mockData';
import { rowToEntry, entryToRow, PERSISTED_FIELDS } from './workoutRow';
import { summarise, money, type MembershipPlan, type Membership, type GymPayment } from './gymRecord';
import { weeklyOccurrences, summariseAttendance, pct, type GymClass, type NewClass } from './gymSchedule';
import { buildIcs } from './ics';
import { dwellMinutes, averageDwellMinutes, uniqueMembers, summariseVisits, visitsByHour, peakHour, visitsPerDay, lastSeenDays, type Visit } from './gymVisits';
import { remainingUses, isExpired, isRedeemable, expiryFor, passRevenueCents, summarisePasses, guestsByHost, passStatus, type GymPass } from './gymPasses';
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

// ── drop-ins, guest passes and packs (F16) ──
// The rule under test throughout: an unpriced pass is not a free pass, and an
// expiry date is inclusive of its own day.
const pass = (o: Partial<GymPass>): GymPass => ({
  id: 'p', passTypeId: null, passTypeName: null, kind: 'drop_in', holderId: null,
  holderName: 'Walk-in', hostMemberId: null, issuedOn: '2026-08-01', expiresOn: null,
  usesTotal: 1, usesSpent: 0, paidCents: 1500, currency: 'AED', note: null, ...o,
});

ok(remainingUses({ usesTotal: 10, usesSpent: 3 }) === 7, 'remaining uses subtracts');
ok(remainingUses({ usesTotal: 1, usesSpent: 4 }) === 0, 'remaining uses never goes negative');

ok(isExpired({ expiresOn: '2026-08-10' }, '2026-08-11'), 'a pass is expired the day after');
ok(!isExpired({ expiresOn: '2026-08-10' }, '2026-08-10'), 'a pass is still good on its expiry day');
ok(!isExpired({ expiresOn: null }, '2030-01-01'), 'no expiry set never expires');

ok(isRedeemable({ usesTotal: 5, usesSpent: 1, expiresOn: '2026-08-10' }, '2026-08-10'), 'redeemable with uses left, on expiry day');
ok(!isRedeemable({ usesTotal: 5, usesSpent: 5, expiresOn: null }, '2026-08-10'), 'not redeemable once spent');
ok(!isRedeemable({ usesTotal: 5, usesSpent: 0, expiresOn: '2026-08-09' }, '2026-08-10'), 'not redeemable once expired');

ok(expiryFor('2026-08-01', null) === null, 'no valid_days means no expiry date');
ok(expiryFor('2026-08-01', 30) === '2026-08-31', 'expiry is issue + valid_days');
ok(expiryFor('2026-08-20', 30) === '2026-09-19', 'expiry crosses a month boundary');
ok(expiryFor('2026-12-20', 30) === '2027-01-19', 'expiry crosses a year boundary');
ok(expiryFor('2026-02-27', 2) === '2026-03-01', 'expiry handles a non-leap February');

// Revenue must never report zero for "nobody wrote the price down".
const unpriced = passRevenueCents([pass({ paidCents: null }), pass({ paidCents: null })]);
ok(unpriced.cents === null, 'no recorded prices gives null revenue, not 0');
ok(unpriced.total === 2 && unpriced.priced === 0, 'unpriced passes are still counted as issued');

const mixed = passRevenueCents([pass({ paidCents: 1500 }), pass({ paidCents: null }), pass({ paidCents: 2500 })]);
ok(mixed.cents === 4000, 'revenue sums only the passes carrying a price');
ok(mixed.priced === 2 && mixed.total === 3, 'revenue reports how many of the total it could price');

const free = passRevenueCents([pass({ paidCents: 0 })]);
ok(free.cents === 0 && free.priced === 1, 'a deliberately free pass is 0, which is not the same as null');

// Bucketing: a pass that is both spent and expired is counted once.
const sum = summarisePasses([
  pass({ id: 'a', usesTotal: 10, usesSpent: 2, expiresOn: '2026-12-31', paidCents: 9000 }), // live, 8 left
  pass({ id: 'b', usesTotal: 1, usesSpent: 0, expiresOn: '2026-08-01', paidCents: null }),  // expired, 1 left
  pass({ id: 'c', usesTotal: 1, usesSpent: 1, expiresOn: '2026-08-01', paidCents: null }),  // spent AND expired
  pass({ id: 'd', usesTotal: 5, usesSpent: 5, expiresOn: null, paidCents: 4000 }),          // used up
], '2026-08-15');
ok(sum.issued === 4, 'every issued pass is counted');
ok(sum.live === 1, 'one pass is live');
ok(sum.expired === 1, 'a spent-and-expired pass is not double counted as expired');
ok(sum.usedUp === 2, 'spent passes are used up regardless of expiry');
ok(sum.live + sum.expired + sum.usedUp === sum.issued, 'the buckets partition the passes exactly');
ok(sum.visitsRemaining === 9, `visits remaining sums across passes (got ${sum.visitsRemaining})`);
ok(sum.revenueCents === 13000 && sum.priced === 2, 'summary revenue only counts priced passes');

ok(summarisePasses([], '2026-08-15').revenueCents === null, 'no passes at all gives null revenue, not 0');

// Guest attribution.
const guests = guestsByHost([
  pass({ kind: 'guest', hostMemberId: 'm1' }),
  pass({ kind: 'guest', hostMemberId: 'm2' }),
  pass({ kind: 'guest', hostMemberId: 'm1' }),
  pass({ kind: 'drop_in', hostMemberId: 'm3' }),
  pass({ kind: 'guest', hostMemberId: null }),
]);
ok(guests.length === 2, 'only guest passes with a host are attributed');
ok(guests[0].hostMemberId === 'm1' && guests[0].guests === 2, 'hosts are ranked by guests brought');

ok(passStatus(pass({ usesTotal: 1, usesSpent: 1 }), '2026-08-15') === 'used up', 'status: used up');
ok(passStatus(pass({ expiresOn: '2026-08-01' }), '2026-08-15') === 'expired', 'status: expired');
ok(passStatus(pass({ expiresOn: '2026-08-30' }), '2026-08-15') === 'live', 'status: live');

// ── the door log (F21) ──
// The rule under test: an unfinished visit is not a zero-minute visit, and an
// hour with no visits is information rather than a gap to interpolate through.
const visit = (o: Partial<Visit>): Visit => ({
  id: 'v', memberId: 'm1', memberName: null, passId: null, classId: null,
  enteredAt: '2026-08-20T09:00:00Z', exitedAt: null, source: 'desk', note: null, ...o,
});

ok(dwellMinutes({ enteredAt: '2026-08-20T09:00:00Z', exitedAt: '2026-08-20T10:15:00Z' }) === 75, 'dwell in minutes');
ok(dwellMinutes({ enteredAt: '2026-08-20T09:00:00Z', exitedAt: null }) === null, 'an open visit has null dwell, not 0');
ok(dwellMinutes({ enteredAt: '2026-08-20T10:00:00Z', exitedAt: '2026-08-20T09:00:00Z' }) === null, 'a negative dwell is refused, not averaged in');

// The average must never be dragged down by visits nobody closed.
const dw = averageDwellMinutes([
  { enteredAt: '2026-08-20T09:00:00Z', exitedAt: '2026-08-20T10:00:00Z' }, // 60
  { enteredAt: '2026-08-20T09:00:00Z', exitedAt: '2026-08-20T11:00:00Z' }, // 120
  { enteredAt: '2026-08-20T09:00:00Z', exitedAt: null },                    // open
]);
ok(dw.minutes === 90, `dwell averages only closed visits (got ${dw.minutes})`);
ok(dw.closed === 2 && dw.total === 3, 'dwell reports how many it could measure');
ok(averageDwellMinutes([{ enteredAt: '2026-08-20T09:00:00Z', exitedAt: null }]).minutes === null, 'no closed visits gives null dwell, not 0');
ok(averageDwellMinutes([]).minutes === null, 'no visits at all gives null dwell');

// Anonymous head-counts still count as visits but not as members.
const vs = [
  visit({ id: 'a', memberId: 'm1' }),
  visit({ id: 'b', memberId: 'm1' }),
  visit({ id: 'c', memberId: 'm2' }),
  visit({ id: 'd', memberId: null }),
];
ok(uniqueMembers(vs) === 2, 'unique members ignores repeat visits');
ok(uniqueMembers([visit({ memberId: null })]) === 0, 'an anonymous visit identifies nobody');

const vsum = summariseVisits(vs);
ok(vsum.visits === 4, 'every visit is counted, identified or not');
ok(vsum.anonymous === 1, 'anonymous visits are reported separately');
ok(vsum.uniqueMembers === 2, 'summary counts distinct members');
ok(vsum.visitsPerMember === 1.5, `visits per member excludes anonymous (got ${vsum.visitsPerMember})`);
ok(vsum.inside === 4, 'visits with no exit are counted as still inside');
ok(summariseVisits([visit({ memberId: null })]).visitsPerMember === null, 'no identified members gives null, not a divide by zero');
ok(summariseVisits([]).peak === null, 'no visits means no peak hour');

// Every hour is present, including the quiet ones.
const byHour = visitsByHour([{ enteredAt: '2026-08-20T09:30:00' }, { enteredAt: '2026-08-20T09:45:00' }, { enteredAt: '2026-08-20T18:10:00' }]);
ok(byHour.length === 24, 'every hour of the day is present, including empty ones');
ok(byHour[9].visits === 2 && byHour[18].visits === 1, 'visits land in the right hour');
ok(byHour[14].visits === 0, 'a quiet hour reads 0 rather than being omitted');

const pk = peakHour([{ enteredAt: '2026-08-20T09:30:00' }, { enteredAt: '2026-08-20T09:45:00' }, { enteredAt: '2026-08-20T18:10:00' }]);
ok(pk !== null && pk.hour === 9 && pk.visits === 2, 'peak hour is the busiest');

// A tie resolves to the earlier hour.
const tie = peakHour([{ enteredAt: '2026-08-20T07:10:00' }, { enteredAt: '2026-08-20T19:10:00' }]);
ok(tie !== null && tie.hour === 7, 'a tied peak resolves to the earlier hour');

// Per-day grouping, oldest first.
const days = visitsPerDay([
  { enteredAt: '2026-08-20T09:00:00' }, { enteredAt: '2026-08-20T18:00:00' }, { enteredAt: '2026-08-18T09:00:00' },
]);
ok(days.length === 2 && days[0].day === '2026-08-18', 'days come back oldest first');
ok(days[1].visits === 2, 'two visits on the same day group together');

// Last seen — the retention input.
const now = Date.parse('2026-08-25T12:00:00Z');
const seen = lastSeenDays([
  { memberId: 'm1', enteredAt: '2026-08-24T09:00:00Z' },
  { memberId: 'm2', enteredAt: '2026-08-10T09:00:00Z' },
  { memberId: 'm1', enteredAt: '2026-08-01T09:00:00Z' },  // older, must not win
  { memberId: null, enteredAt: '2026-08-24T09:00:00Z' },
], now);
ok(seen.length === 2, 'anonymous visits cannot be attributed to a member');
ok(seen[0].memberId === 'm2' && seen[0].days === 15, `longest absent first (got ${seen[0]?.days})`);
ok(seen[1].memberId === 'm1' && seen[1].days === 1, 'a member is measured from their most recent visit');

if (errors.length) { console.log('COVERAGE FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL COVERAGE TESTS PASSED (${checks} assertions)`);
