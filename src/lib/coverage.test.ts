// Extended pure-logic coverage (Phase 8 QA). Compile with tsc then run with node.
import { currentStreak, longestStreak, personalRecords, weekStats, est1RM, isNewPR, streakMilestone, freezeBudget, currentStreakFrozen } from './streaks';
import { parseRepRange, suggestNextWeight, suggestForExercise, priorBest1RM, suggestProgression } from './progression';
import { overlaps, isLateCancellation, cancelSession, nextFromWaitlist } from './booking';
import type { WorkoutEntry } from './mockData';
import { rowToEntry, entryToRow, PERSISTED_FIELDS } from './workoutRow';
import { summarise, money, type MembershipPlan, type Membership, type GymPayment } from './gymRecord';
import { weeklyOccurrences, summariseAttendance, weeklyAttendance, pct, type GymClass, type NewClass } from './gymSchedule';
import { summariseClassRows, type ClassSummaryRow } from './classRates';
import { STATUS_LABEL, STATUS_RANK, statusFromRisk, riskLabel } from './status';
import { buildIcs } from './ics';
import { serviceState, nextServiceDue, usableUnits, outOfServiceUnits, capacityFor, summariseRegister, needsAttention, type Equipment } from './gymEquipment';
import { parseCsv, parseSheet, sniffDelimiter, mapColumns } from './csv';
import { parseMoneyCents, parseDate, detectDateOrder, previewMembers, previewPayments, describePreview, MEMBER_ALIASES } from './csvImport';
import { payroll30For, payrollBlocker, type GymTrainer } from './gymTrainers';
import { gymRollup } from './ownerAnalytics';
import { isDelivered, isAwaitingOutcome, isPayable, payrollByTrainer, payrollTotal, settlementBlocker, PAY_DELIVERED_ONLY, type PtSession } from './gymSessions';
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

// ── PT session outcomes and payroll (F17) ──
// The rule under test: an unmarked session is not a delivered session and not a
// free one. It is unknown, and payroll cannot be settled while any remain.
const NOW = Date.parse('2026-08-25T12:00:00Z');
const sess = (o: Partial<PtSession>): PtSession => ({
  id: 's', trainerId: 't1', trainerName: 'Marcus', clientId: 'c1', clientName: 'Elena',
  startsAt: '2026-08-20T09:00:00Z', durationMin: 60, status: 'booked',
  outcome: 'completed', outcomeAt: null, rateCents: 5000, ...o,
});

ok(isDelivered({ outcome: 'completed' }), 'completed is delivered');
ok(!isDelivered({ outcome: 'no_show' }), 'a no-show is not delivered');
ok(!isDelivered({ outcome: null }), 'an unmarked session is not delivered');

// Awaiting an outcome: booked, finished, unmarked.
ok(isAwaitingOutcome(sess({ outcome: null }), NOW), 'a finished booked session with no outcome is awaiting one');
ok(!isAwaitingOutcome(sess({ outcome: 'completed' }), NOW), 'a marked session is not awaiting anything');
ok(!isAwaitingOutcome(sess({ outcome: null, status: 'available' }), NOW), 'an unbooked slot is not awaiting an outcome');
ok(!isAwaitingOutcome(sess({ outcome: null, status: 'blocked' }), NOW), 'a blocked slot is not awaiting an outcome');
ok(!isAwaitingOutcome(sess({ outcome: null, startsAt: '2026-08-26T09:00:00Z' }), NOW), 'a future session is not awaiting an outcome');
// The boundary: still running is not yet finished.
ok(!isAwaitingOutcome(sess({ outcome: null, startsAt: '2026-08-25T11:30:00Z', durationMin: 60 }), NOW), 'a session still running is not awaiting an outcome');
ok(isAwaitingOutcome(sess({ outcome: null, startsAt: '2026-08-25T11:00:00Z', durationMin: 60 }), NOW), 'a session that ended exactly now is awaiting an outcome');

// Pay policy is a stated gym decision, never assumed.
ok(isPayable({ outcome: 'completed' }, PAY_DELIVERED_ONLY), 'delivered is always payable');
ok(!isPayable({ outcome: 'no_show' }, PAY_DELIVERED_ONLY), 'no-shows unpaid under the conservative policy');
ok(isPayable({ outcome: 'no_show' }, { payNoShows: true, payLateCancellations: false }), 'no-shows paid when the gym says so');
ok(!isPayable({ outcome: 'cancelled' }, { payNoShows: true, payLateCancellations: true }), 'a plain cancellation is never payable');
ok(isPayable({ outcome: 'late_cancelled' }, { payNoShows: false, payLateCancellations: true }), 'late cancellations follow their own policy');
ok(!isPayable({ outcome: null }, { payNoShows: true, payLateCancellations: true }), 'an unmarked session is never payable, whatever the policy');

// Payroll per trainer.
const lines = payrollByTrainer([
  sess({ id: '1', outcome: 'completed', rateCents: 5000 }),
  sess({ id: '2', outcome: 'completed', rateCents: 5000 }),
  sess({ id: '3', outcome: 'no_show', rateCents: 5000 }),
  sess({ id: '4', outcome: 'cancelled', rateCents: 5000 }),
  sess({ id: '5', outcome: null }),                                     // unmarked
  sess({ id: '6', trainerId: 't2', trainerName: 'Priya', outcome: 'completed', rateCents: 4000 }),
], PAY_DELIVERED_ONLY, null, NOW);

ok(lines.length === 2, 'payroll groups by trainer');
ok(lines[0].trainerId === 't1' && lines[0].delivered === 2, 'delivered counts only completed sessions');
ok(lines[0].noShows === 1 && lines[0].cancelled === 1, 'outcomes are broken out');
ok(lines[0].unmarked === 1, 'unmarked sessions are reported, not absorbed');
ok(lines[0].cents === 10000, `pay covers delivered only (got ${lines[0].cents})`);
ok(lines[1].cents === 4000, 'a second trainer is priced separately');

// A no-show-paying gym gets a different number from the same sessions.
const paid = payrollByTrainer([
  sess({ id: '1', outcome: 'completed', rateCents: 5000 }),
  sess({ id: '2', outcome: 'no_show', rateCents: 5000 }),
], { payNoShows: true, payLateCancellations: false }, null, NOW);
ok(paid[0].cents === 10000, 'paying no-shows changes the figure');

// Rates: snapshot wins, fallback fills, and no rate at all gives null.
const noRate = payrollByTrainer([sess({ outcome: 'completed', rateCents: null })], PAY_DELIVERED_ONLY, null, NOW);
ok(noRate[0].cents === null, 'a payable session with no rate gives null, not 0');
ok(noRate[0].payable === 1 && noRate[0].priced === 0, 'it is payable but unpriced, and says so');

const fellBack = payrollByTrainer([sess({ outcome: 'completed', rateCents: null })], PAY_DELIVERED_ONLY, 4500, NOW);
ok(fellBack[0].cents === 4500, 'the gym session fee prices a session with no snapshot');

const snapshotWins = payrollByTrainer([sess({ outcome: 'completed', rateCents: 5000 })], PAY_DELIVERED_ONLY, 9999, NOW);
ok(snapshotWins[0].cents === 5000, 'a snapshotted rate is not overwritten by a later fee');

// Settlement: the whole point. Unmarked work blocks the run.
const blocked = payrollTotal(lines);
ok(blocked.cents === 14000, 'total sums the priced lines');
ok(blocked.unmarked === 1, 'the total carries the unmarked count');
ok(blocked.settleable === false, 'payroll cannot be settled while a session is unmarked');
ok((settlementBlocker(blocked) ?? '').includes('1 session'), `blocker names the unmarked work (got ${settlementBlocker(blocked)})`);

const clean = payrollTotal(payrollByTrainer([
  sess({ id: '1', outcome: 'completed', rateCents: 5000 }),
  sess({ id: '2', outcome: 'completed', rateCents: 5000 }),
], PAY_DELIVERED_ONLY, null, NOW));
ok(clean.settleable === true, 'a fully marked, fully priced period is settleable');
ok(settlementBlocker(clean) === null, 'nothing blocks a clean period');

const unpricedTotal = payrollTotal(payrollByTrainer([
  sess({ id: '1', outcome: 'completed', rateCents: null }),
], PAY_DELIVERED_ONLY, null, NOW));
ok(unpricedTotal.settleable === false, 'an unpriced payable session blocks settlement');
ok((settlementBlocker(unpricedTotal) ?? '').includes('rate'), 'blocker names the missing rate');

ok(payrollTotal([]).settleable === false, 'an empty period is not settleable');
ok(payrollTotal([]).cents === null, 'an empty period has null pay, not 0');

// ── gym payroll must not price unconfirmed work ──
// Regression guard: payroll used to be sessions30 * fee, where sessions30 was
// "booked and the clock has passed" — so it paid for no-shows and slots nobody
// cancelled. These assertions exist to stop that coming back.
const tr = (o: Partial<GymTrainer>): GymTrainer => ({
  id: 't1', name: 'Marcus', clients: 8, sessions30: 20, delivered30: 20, unmarked30: 0, since: null, ...o,
});

ok(payroll30For([tr({})], 50) === 1000, 'payroll prices confirmed sessions at the fee');
ok(payroll30For([tr({})], null) === null, 'no session fee gives null, not 0');
ok(payroll30For([tr({ delivered30: 18, unmarked30: 2 })], 50) === null, 'payroll refuses to price while sessions are unmarked');
ok(payroll30For([tr({ sessions30: 20, delivered30: 12, unmarked30: 0 })], 50) === 600,
   'payroll prices delivered, not everything whose clock has passed');

ok((payrollBlocker([tr({ unmarked30: 3 })], 50) ?? '').includes('3 sessions'),
   'the blocker names how many need marking');
ok((payrollBlocker([tr({ unmarked30: 1 })], 50) ?? '').includes('1 session '),
   'the blocker is singular for one session');
ok(payrollBlocker([tr({})], null) === 'No session fee set.', 'an unset fee is named as the blocker');
ok(payrollBlocker([tr({})], 50) === null, 'nothing blocks a clean, priced period');

// The same rule has to hold in the rollup, which is a second place it is computed.
const rollClean = gymRollup([tr({})], 50);
ok(rollClean.payroll30 === 1000, 'rollup prices confirmed sessions');
ok(rollClean.delivered30 === 20 && rollClean.unmarked30 === 0, 'rollup carries the breakdown');

const rollBlocked = gymRollup([tr({ delivered30: 15, unmarked30: 5 })], 50);
ok(rollBlocked.payroll30 === null, 'rollup payroll is null while sessions are unmarked');
ok(rollBlocked.unmarked30 === 5, 'rollup reports how many are unmarked');
ok(rollBlocked.sessions30 === 20, 'rollup still reports what the record shows took place');

// Scoped: this suite is one long module, and these fixture names
// (mem, pay, q…) are common enough to collide with earlier blocks.
{
  // ── CSV reader (F22) ──
  // The failure mode being guarded: a naive split(',') shifts every column after
  // a quoted comma, and the import lands a phone number in the plan field.
  const q = parseCsv('name,plan\n"Smith, Jr.",Full\n');
  ok(q.length === 2, 'a trailing newline does not create a phantom row');
  ok(q[1][0] === 'Smith, Jr.' && q[1][1] === 'Full', 'a comma inside quotes does not split the field');

  ok(parseCsv('a,"b""c",d')[0][1] === 'b"c', 'a doubled quote inside quotes is one literal quote');
  ok(parseCsv('a,"line\nbreak",c')[0][1] === 'line\nbreak', 'a newline inside quotes stays in the field');
  ok(parseCsv('a,b\r\nc,d').length === 2 && parseCsv('a,b\r\nc,d')[1][0] === 'c', 'CRLF line endings parse');
  ok(parseCsv('﻿name,plan\nAmy,Full')[0][0] === 'name', 'a UTF-8 BOM does not become part of the first header');
  ok(parseCsv('a,b\nc,d')[1][1] === 'd', 'a final row without a trailing newline is kept');
  ok(parseCsv('a,,c')[0].length === 3 && parseCsv('a,,c')[0][1] === '', 'an empty field is preserved, not collapsed');
  ok(parseCsv('') .length === 0, 'empty input gives no rows');

  ok(sniffDelimiter('a;b;c') === ';', 'semicolon files are detected');
  ok(sniffDelimiter('a\tb\tc') === '\t', 'tab files are detected');
  ok(sniffDelimiter('"Smith, Jr.";Full') === ';', 'a comma inside quotes does not vote for the comma');
  ok(parseSheet('a;b\n1;2').rows[0][1] === '2', 'a semicolon sheet parses end to end');

  const short = parseSheet('name,plan,email\nAmy,Full');
  ok(short.rows[0].length === 3 && short.rows[0][2] === '', 'a short row is padded to the header width');
  ok(parseSheet('name,plan\n\n\nAmy,Full').rows.length === 1, 'blank lines are discarded');

  const mapped = mapColumns(['Full Name', 'E-Mail', 'Nickname'], MEMBER_ALIASES);
  ok(mapped.index.name === 0 && mapped.index.email === 1, 'headers map through aliases and punctuation');
  ok(mapped.unmatched.includes('Nickname'), 'an unrecognised column is reported, not silently dropped');

  // ── money ──
  ok((parseMoneyCents('£1,234.56') as any).value === 123456, 'money strips a currency symbol and thousands comma');
  ok((parseMoneyCents('1.234,56') as any).value === 123456, 'European decimal comma is read correctly');
  ok((parseMoneyCents('1,234') as any).value === 123400, 'a lone separator before three digits is thousands, not decimals');
  ok((parseMoneyCents('1,23') as any).value === 123, 'a lone separator before two digits is a decimal point');
  ok((parseMoneyCents('50') as any).value === 5000, 'a bare integer is whole units');
  ok((parseMoneyCents('0') as any).value === 0, 'zero is a real amount');
  ok((parseMoneyCents('7.5') as any).value === 750, 'one decimal place is padded, not truncated');
  ok((parseMoneyCents('(50.00)') as any).value === -5000, 'accounting parentheses mean negative');
  ok(parseMoneyCents('1.2345').ok === false, 'four decimal places are refused rather than rounded');
  ok(parseMoneyCents('n/a').ok === false, 'non-numeric text is refused');
  ok(parseMoneyCents('').ok === false, 'an empty amount is refused');

  // ── dates: the decision this module exists for ──
  ok((parseDate('2026-04-03') as any).value === '2026-04-03', 'ISO dates are unambiguous');
  ok((parseDate('25/12/2026') as any).value === '2026-12-25', 'a day above 12 settles the order by itself');
  ok((parseDate('12/25/2026') as any).value === '2026-12-25', 'a month-first file settles the same way');
  ok(parseDate('03/04/2026').ok === false, 'an ambiguous date is REFUSED, not guessed');
  ok((parseDate('03/04/2026', 'dmy') as any).value === '2026-04-03', 'told day-first, it reads day-first');
  ok((parseDate('03/04/2026', 'mdy') as any).value === '2026-03-04', 'told month-first, it reads month-first');
  ok(parseDate('31/02/2026', 'dmy').ok === false, '31 February is refused, not rolled into March');
  ok(parseDate('13/13/2026').ok === false, 'two components above 12 cannot be a date');
  ok((parseDate('01/02/26', 'dmy') as any).value === '2026-02-01', 'a two-digit year resolves to this century');

  // One unambiguous row settles the whole file, so the gym is rarely asked.
  ok(detectDateOrder(['03/04/2026', '25/12/2026']) === 'dmy', 'one day-above-12 row settles the file as day-first');
  ok(detectDateOrder(['03/04/2026', '12/25/2026']) === 'mdy', 'one month-first row settles the file');
  ok(detectDateOrder(['03/04/2026', '05/06/2026']) === 'ambiguous', 'a wholly ambiguous column stays ambiguous');
  ok(detectDateOrder(['25/12/2026', '12/25/2026']) === 'ambiguous', 'a file mixing both conventions is refused');
  ok(detectDateOrder(['2026-04-03']) === 'ymd', 'an ISO column is recognised');
  ok(detectDateOrder([]) === 'unknown', 'nothing to go on is unknown, not a guess');

  // ── member preview ──
  const memPrev = previewMembers(
    'Name,Email,Plan,Start Date,Status\n' +
    'Amy Chen,amy@example.com,Full,25/12/2025,active\n' +   // settles the file as dmy
    'Ben Ross,ben@example.com,Off-peak,03/04/2026,active\n' + // now readable with confidence
    'Cal Diaz,not-an-email,Full,01/01/2026,active\n' +
    ',nobody@example.com,Full,01/01/2026,active\n' +
    'Dee Ellis,amy@example.com,Full,01/01/2026,active\n' +
    'Eve Frost,eve@example.com,Full,01/01/2026,dunno\n'
  );
  ok(memPrev.dateOrder === 'dmy', 'the file settles its own date order from one row');
  ok(memPrev.ready.length === 2, `only clean rows are ready (got ${memPrev.ready.length})`);
  ok(memPrev.ready[1].startedOn === '2026-04-03', 'the ambiguous date is read using the settled order');
  ok(memPrev.rejected.length === 4, 'every problem row is reported');
  ok(memPrev.rejected.some((r) => r.line === 4 && r.errors.some((e) => e.includes('email'))), 'a bad email is caught with its line number');
  ok(memPrev.rejected.some((r) => r.line === 5 && r.errors.includes('no name')), 'a missing name is caught');
  ok(memPrev.rejected.some((r) => r.line === 6 && r.errors.some((e) => e.includes('duplicate of line 2'))), 'a duplicate email points at the first occurrence');
  ok(memPrev.rejected.some((r) => r.line === 7 && r.errors.some((e) => e.includes('dunno'))), 'an unrecognised status is refused, not defaulted to active');

  const noName = previewMembers('Email,Plan\namy@example.com,Full');
  ok(noName.missingRequired.includes('name'), 'a file with no name column cannot be imported');
  ok(noName.ready.length === 0, 'nothing is ready when a required column is missing');

  const backwards = previewMembers('Name,Start Date,End Date\nAmy,2026-06-01,2026-01-01');
  ok(backwards.rejected[0].errors.some((e) => e.includes('ends before')), 'a membership ending before it starts is caught');

  // ── payment preview ──
  const pay = previewPayments(
    'Member,Email,Amount,Date,Method\n' +
    'Amy Chen,amy@example.com,"£1,234.56",2026-01-15,Card\n' +
    'Ben Ross,ben@example.com,69.00,2026-01-16,Bank Transfer\n' +
    ',,50.00,2026-01-17,Cash\n' +
    'Cal Diaz,cal@example.com,-20.00,2026-01-18,Card\n'
  );
  ok(pay.ready.length === 2, `payments with a payer and a good amount are ready (got ${pay.ready.length})`);
  ok(pay.ready[0].amountCents === 123456, 'a quoted, symbol-prefixed amount survives the CSV and the parser');
  ok(pay.ready[1].method === 'transfer', 'a method alias maps to the stored vocabulary');
  ok(pay.rejected.some((r) => r.errors.some((e) => e.includes('cannot be attributed'))), 'a payment with no payer is refused');
  ok(pay.rejected.some((r) => r.errors.some((e) => e.includes('negative'))), 'a refund is refused rather than imported as income');

  ok(describePreview(noName).includes('no name'), 'the summary explains a missing required column');
  ok(describePreview(memPrev).includes('2 of 6'), `the summary counts ready rows (got "${describePreview(memPrev)}")`);
}

// ── equipment register (F20) ──
// Scoped: fixture names like `kit` and `cap` are common enough to collide.
{
const kit = (o: Partial<Equipment>): Equipment => ({
  id: 'e', name: 'Rower', category: 'rower', identifier: null, quantity: 1,
  status: 'in_service', purchasedOn: null, serviceIntervalDays: null,
  lastServicedOn: null, note: null, ...o,
});

// Two different unknowns must stay distinguishable.
ok(serviceState({ serviceIntervalDays: null, lastServicedOn: null }, '2026-08-25') === 'unscheduled',
   'no interval means the gym chose no schedule');
ok(serviceState({ serviceIntervalDays: 90, lastServicedOn: null }, '2026-08-25') === 'unrecorded',
   'a schedule with no recorded service is its own state, not "serviced today"');
ok(nextServiceDue({ serviceIntervalDays: 90, lastServicedOn: null }) === null,
   'no due date is invented from a service that was never recorded');
ok(nextServiceDue({ serviceIntervalDays: null, lastServicedOn: '2026-01-01' }) === null,
   'no interval means no due date');
ok(nextServiceDue({ serviceIntervalDays: 90, lastServicedOn: '2026-06-01' }) === '2026-08-30',
   'a due date is issue + interval');

ok(serviceState({ serviceIntervalDays: 90, lastServicedOn: '2026-06-01' }, '2026-08-31') === 'overdue',
   'past its due date is overdue');
ok(serviceState({ serviceIntervalDays: 90, lastServicedOn: '2026-06-01' }, '2026-08-25') === 'due',
   'inside the grace window is due, so an engineer can be booked first');
ok(serviceState({ serviceIntervalDays: 90, lastServicedOn: '2026-06-01' }, '2026-07-01') === 'ok',
   'well before the date is fine');
ok(serviceState({ serviceIntervalDays: 90, lastServicedOn: '2026-06-01' }, '2026-08-30') === 'due',
   'the due date itself is not yet overdue');

// Counting: retired kit is gone, not broken.
const fleet = [
  kit({ id: 'a', quantity: 6, status: 'in_service' }),
  kit({ id: 'b', quantity: 4, status: 'out_of_service' }),
  kit({ id: 'c', quantity: 2, status: 'retired' }),
];
ok(usableUnits(fleet) === 6, 'only in-service units are usable');
ok(outOfServiceUnits(fleet) === 4, 'broken units are counted separately');

// The capacity claim — the reason this module exists.
const capOk = capacityFor([kit({ quantity: 14 })], 'rower', 14);
ok(capOk.limit === 14 && capOk.supported === true, 'enough kit supports the stated capacity');
ok(capOk.note === null, 'nothing to say when the claim holds');

const capShort = capacityFor([
  kit({ id: 'a', quantity: 8, status: 'in_service' }),
  kit({ id: 'b', quantity: 6, status: 'out_of_service' }),
], 'rower', 14);
ok(capShort.limit === 8, `broken kit lowers the real limit (got ${capShort.limit})`);
ok(capShort.supported === false, 'a capacity of 14 on 8 working rowers is not supported');
ok((capShort.note ?? '').includes('6 of 14'), `the note names what is down (got ${capShort.note})`);

// The important case: an empty register is not an empty gym.
const capUnknown = capacityFor([], 'rower', 14);
ok(capUnknown.limit === null, 'nothing registered gives null, never 0');
ok(capUnknown.supported === null, 'unknown is not the same as unsupported');
ok((capUnknown.note ?? '').includes('cannot be checked'), 'the note says it cannot be checked, not that the class cannot run');

const capOther = capacityFor([kit({ category: 'treadmill', quantity: 20 })], 'rower', 14);
ok(capOther.limit === null, 'kit of another category does not stand in for the one asked about');

// Shared kit: half a unit each.
const capShared = capacityFor([kit({ category: 'rig', quantity: 6 })], 'rig', 12, 0.5);
ok(capShared.limit === 12 && capShared.supported === true, 'a rig two people share seats twice its count');
ok(capacityFor([kit({ quantity: 5 })], 'rower', 4, 0).limit === null, 'zero units per attendee is refused, not divided by');

// Category matching is forgiving about the gym's own words.
ok(capacityFor([kit({ category: 'Rowers' })], 'rower', 1).limit === 1, 'case and plural differences still match');

// Retired kit cannot prop up a capacity claim.
ok(capacityFor([kit({ quantity: 20, status: 'retired' })], 'rower', 14).limit === null,
   'a register holding only retired kit reads as nothing registered');

// Summary and the maintenance queue.
const today = '2026-08-25';
const reg = [
  kit({ id: '1', name: 'Rower 1', serviceIntervalDays: 90, lastServicedOn: '2026-01-01' }), // overdue
  kit({ id: '2', name: 'Bike 1',  serviceIntervalDays: 90, lastServicedOn: '2026-06-01' }), // due
  kit({ id: '3', name: 'Bench 1', serviceIntervalDays: 90, lastServicedOn: null }),         // unrecorded
  kit({ id: '4', name: 'Mat 1' }),                                                          // unscheduled
  kit({ id: '5', name: 'Old rower', status: 'retired', serviceIntervalDays: 90, lastServicedOn: '2020-01-01' }),
];
const sum = summariseRegister(reg, today);
ok(sum.items === 4, 'retired kit is out of the register count');
ok(sum.overdue === 1 && sum.due === 1 && sum.unrecorded === 1, 'each service state is counted separately');
ok(sum.usableUnits === 4, 'usable units exclude the retired item');

const queue = needsAttention(reg, today);
ok(queue.length === 3, 'unscheduled kit is not "needing attention"');
ok(queue[0].state === 'overdue' && queue[0].item.name === 'Rower 1', 'overdue sorts first');
ok(queue[1].state === 'due', 'due sorts above unrecorded');
ok(queue[2].state === 'unrecorded', 'never-recorded still surfaces rather than hiding');
ok(!queue.some((q) => q.item.status === 'retired'), 'retired kit never appears in the queue');
}


// ── weekly attendance series (the chart the site draws) ──
{
const NOW = Date.parse('2026-08-25T12:00:00Z');   // a Tuesday; its Monday is the 24th
const gc = (startsAt: string, capacity: number, booked: number, attended: number): GymClass => ({
  id: startsAt + capacity, title: 'Conditioning', room: null, instructor: null, trainerId: null,
  startsAt, durationMin: 45, capacity, booked, attended,
});

const w3 = weeklyAttendance([
  gc('2026-08-24T07:00:00Z', 20, 15, 12),   // this week
  gc('2026-08-23T09:00:00Z', 10, 10, 9),    // SUNDAY — belongs to the week of the 17th
  gc('2026-07-01T07:00:00Z', 20, 20, 20),   // far outside the window
], 3, NOW);

ok(w3.length === 3, 'weeklyAttendance returns exactly the weeks asked for');
ok(w3[0].weekOf === '2026-08-10' && w3[2].weekOf === '2026-08-24', 'series runs oldest to newest');
ok(w3[2].classes === 1 && w3[2].booked === 15 && w3[2].attended === 12, 'this week totals');
ok(w3[1].weekOf === '2026-08-17' && w3[1].classes === 1, 'a Sunday class counts to the Monday that opened its week');
ok(w3.reduce((a, x) => a + x.classes, 0) === 2, 'classes outside the window are dropped, not clamped into the edge week');

// A quiet week is a gap in the chart, not a missing point.
ok(w3[0].classes === 0 && w3[0].booked === 0, 'empty weeks stay in the series');
ok(w3[0].fillRate === null && w3[0].showRate === null, 'an empty week has no rate — not 0%');

ok(Math.abs((w3[2].fillRate ?? 0) - 15 / 20) < 1e-9, 'fillRate is booked/capacity');
ok(Math.abs((w3[2].showRate ?? 0) - 12 / 15) < 1e-9, 'showRate is attended/booked');

// Capacity recorded as 0 must not read as a 100%-full week.
const noCap = weeklyAttendance([gc('2026-08-24T07:00:00Z', 0, 5, 4)], 1, NOW);
ok(noCap[0].fillRate === null, 'no capacity recorded means no fill rate');
ok(noCap[0].showRate !== null, 'but attendance still has a show rate');

// Nothing booked is not everybody failing to turn up.
const noBook = weeklyAttendance([gc('2026-08-24T07:00:00Z', 20, 0, 0)], 1, NOW);
ok(noBook[0].showRate === null, 'a class nobody booked has no show rate');
ok(noBook[0].fillRate === 0, 'but its fill rate is a real, measured 0%');

// Two classes in one week add up rather than overwrite.
const two = weeklyAttendance([
  gc('2026-08-24T07:00:00Z', 20, 15, 12), gc('2026-08-26T19:00:00Z', 10, 5, 5),
], 1, NOW);
ok(two[0].classes === 2 && two[0].capacity === 30 && two[0].booked === 20 && two[0].attended === 17, 'a week sums its classes');

ok(weeklyAttendance([gc('nonsense', 20, 5, 5)], 1, NOW)[0].classes === 0, 'an unparseable date is skipped, not counted');
ok(weeklyAttendance([], 12, NOW).length === 12, 'a gym with no classes still yields a full, empty series');
}


// ── class rates: fill and show are different questions ──
{
const cr = (capacity: number, booked: number, attended: number): ClassSummaryRow => ({
  classId: 'c' + capacity + booked + attended, title: 'HIIT', kind: 'hiit', branch: 'Main',
  trainerId: 't1', trainerName: 'Nadia', startsAt: '2026-08-24T07:00:00Z', capacity, booked, attended,
});

// The exact case that read 71% on one screen and 80% on another.
const one = summariseClassRows([cr(14, 10, 8)]);
ok(Math.abs((one.fill ?? 0) - 10 / 14) < 1e-9, 'fill is booked/capacity');
ok(Math.abs((one.show ?? 0) - 8 / 10) < 1e-9, 'show is attended/booked');
ok(one.fill !== one.show, 'fill and show are not interchangeable');

const many = summariseClassRows([cr(20, 15, 12), cr(10, 5, 5)]);
ok(many.classes === 2 && many.capacity === 30 && many.booked === 20 && many.attended === 17, 'rows sum');
ok(Math.abs((many.fill ?? 0) - 20 / 30) < 1e-9, 'fill sums before dividing, not an average of averages');

ok(summariseClassRows([cr(0, 5, 4)]).fill === null, 'no capacity recorded means no fill rate');
ok(summariseClassRows([cr(0, 5, 4)]).show !== null, 'but a show rate still exists');
ok(summariseClassRows([cr(20, 0, 0)]).show === null, 'nobody booked means no show rate, not 0%');
ok(summariseClassRows([cr(20, 0, 0)]).fill === 0, 'but an empty class has a real, measured 0% fill');
const none = summariseClassRows([]);
ok(none.classes === 0 && none.fill === null && none.show === null, 'no classes yields no rates at all');
}


// ── one status vocabulary ──
{
ok(riskLabel('high') === 'At risk', '"Not delivering" is gone from the product');
ok(riskLabel('ok') === 'On track', 'trainer "Healthy" and client "On track" are now the same word');
ok(riskLabel('watch') === 'Watch', 'the shared middle word survives');
ok(riskLabel('idle') === 'Idle', 'idle is its own state');
ok(riskLabel('something-new') === 'Idle', 'an unknown risk key reads as no assessment, not as a verdict');
ok(statusFromRisk('high') === 'at_risk' && statusFromRisk('') === 'idle', 'mapping is total');

// Idle sits outside the ranking: no activity is not the worst news, it is no news.
ok(STATUS_RANK.at_risk < STATUS_RANK.watch, 'at risk sorts above watch');
ok(STATUS_RANK.watch < STATUS_RANK.on_track, 'watch sorts above on track');
ok(STATUS_RANK.idle > STATUS_RANK.on_track, 'idle sorts last so it cannot bury rows needing action');

const labels = Object.values(STATUS_LABEL);
ok(new Set(labels).size === labels.length, 'no two levels share a label');
ok(!labels.some((l) => /deliver/i.test(l)), 'nothing in the scale judges the person');
}

if (errors.length) { console.log('COVERAGE FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL COVERAGE TESTS PASSED (${checks} assertions)`);
