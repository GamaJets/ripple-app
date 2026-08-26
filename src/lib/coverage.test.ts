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
import { reconcile, reconcileNote } from './finReconcile';
import { VARIANT_ACCENT, VARIANT_TILE, VARIANT_LABEL } from './variant';
import { tipsFor, nextTip, markShown, isDue, tipToShow, EMPTY_TIP_STATE, type TipState } from './tips';
import { buildIcs } from './ics';
import { serviceState, nextServiceDue, usableUnits, outOfServiceUnits, capacityFor, summariseRegister, needsAttention, type Equipment } from './gymEquipment';
import { parseCsv, parseSheet, sniffDelimiter, mapColumns } from './csv';
import { parseMoneyCents, parseDate, detectDateOrder, previewMembers, previewPayments, previewPlans, describePreview, MEMBER_ALIASES } from './csvImport';
import { classEntry, ptEntry, mergeTimetable, overlapping, entriesAt, floorAt, floorByHour, clashes, summariseBoard, slotBlocker, type PtSlot } from './gymPtSchedule';
import { groupSessions, sessionKey, sessionDuration, sessionActivity, sessionKcal, sessionDistanceMeters, planSession, planWrite, summariseResult, HK_WRITE_ACTIVITIES, type Ledger } from './wearables/appleHealthWrite';
import { payroll30For, payrollBlocker, type GymTrainer } from './gymTrainers';
import { gymRollup } from './ownerAnalytics';
import { isDelivered, isAwaitingOutcome, isPayable, payrollByTrainer, payrollTotal, settlementBlocker, settleableSessions, settlementAmount, settleBlocker, PAY_DELIVERED_ONLY, type PtSession } from './gymSessions';
import { dwellMinutes, averageDwellMinutes, uniqueMembers, summariseVisits, visitsByHour, peakHour, visitsPerDay, lastSeenDays, type Visit } from './gymVisits';
import { remainingUses, isExpired, isRedeemable, expiryFor, passRevenueCents, summarisePasses, guestsByHost, passStatus, type GymPass } from './gymPasses';
import { estimateDish, searchDishes, DISHES } from './restaurant';
import { normaliseEmail, inviteState, isExpired as inviteExpired, isRedeemable as inviteRedeemable, expiryFor as inviteExpiryFor, daysUntilExpiry, inviteBlocker, screenInvites, summariseInvites, DEFAULT_VALID_DAYS, type MemberInvite } from './memberInvites';
import { weekStartOf, weekDays, shiftWeek, hoursSpanned, shiftHours, hourLabel, buildRota, coverage, shiftsByDay, rosterByTrainer, summariseRota, shiftFromHours, type Shift, type DemandBlock } from './gymRota';
import { photoObjectPath, isOwnPhotoPath, sortOldestFirst, comparePair, daysApart, photosNote, missingFileCount, rowToPhoto, PHOTO_PATH_RE, type ProgressPhoto } from './progressPhotos';
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
  outcome: 'completed', outcomeAt: null, rateCents: 5000, settlementId: null, ...o,
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


// ── reconciling a typed figure against a derived one ──
{
// Nothing recorded is not a disagreement — it is nothing to compare against.
const none = reconcile(40000, null);
ok(none.state === 'no_record', 'no records means nothing to check, not a mismatch');
ok(none.delta === null && none.driftPct === null, 'no delta without both sides');

const blank = reconcile(0, 34500);
ok(blank.state === 'not_entered', 'records with nothing typed is its own state');

ok(reconcile(34500, 34500).state === 'agrees', 'identical figures agree');
ok(reconcile(34500, 34600).state === 'agrees', 'a 0.3% gap is rounding, not a discrepancy');
ok(reconcile(40000, 34500).state === 'differs', 'a 16% gap is a real disagreement');

const d = reconcile(40000, 34500);
ok(d.delta === -5500, 'delta is derived minus typed, so a signed shortfall');
ok(Math.abs((d.driftPct ?? 0) - 5500 / 34500) < 1e-9, 'drift is measured against the derived figure');

// Tolerance is a fraction, so the same rule serves money and headcount.
ok(reconcile(102, 100).state === 'agrees', '2 members off 100 is inside tolerance');
ok(reconcile(120, 100).state === 'differs', '20 members off 100 is not');
ok(reconcile(40000, 34500, 0.5).state === 'agrees', 'tolerance is caller-settable');

// A derived zero is a real measurement and must not divide by itself.
ok(reconcile(500, 0).state === 'differs', 'records showing nobody active contradicts a typed figure');
ok(reconcile(0, 0).state === 'not_entered', 'nothing typed against a real zero is still "not entered"');

// The note says something only when something needs doing.
ok(reconcileNote(reconcile(34500, 34500), 'MRR') === null, 'agreement says nothing — no self-congratulation');
ok((reconcileNote(reconcile(40000, 34500), 'MRR') ?? '').includes('less'), 'a shortfall is described as less');
ok((reconcileNote(reconcile(30000, 34500), 'MRR') ?? '').includes('more'), 'a surplus is described as more');
ok((reconcileNote(reconcile(40000, null), 'MRR') ?? '').includes('Nothing recorded'), 'no-record note explains why');
}


// ── settlement: the same session is never paid twice, and never dropped ──
{
const NOW2 = Date.parse('2026-08-25T12:00:00Z');
const s2 = (o: Partial<PtSession>): PtSession => ({
  id: 'x', trainerId: 't1', trainerName: 'Marcus', clientId: 'c1', clientName: 'Elena',
  startsAt: '2026-08-20T09:00:00Z', durationMin: 60, status: 'booked',
  outcome: 'completed', outcomeAt: null, rateCents: 5000, settlementId: null, ...o,
});

const fresh = s2({ id: 'a' });
const alreadyPaid = s2({ id: 'b', settlementId: 'run-1' });
const unmarked = s2({ id: 'c', outcome: null });
const unpriced = s2({ id: 'd', rateCents: null });
const noShow = s2({ id: 'e', outcome: 'no_show' });

const pool = [fresh, alreadyPaid, unmarked, unpriced, noShow];
const payable = settleableSessions(pool, PAY_DELIVERED_ONLY, NOW2);

ok(payable.length === 1 && payable[0].id === 'a', 'only the unpaid, marked, priced, payable session settles');
ok(!payable.some((x) => x.id === 'b'), 'a session already carrying a settlement is never paid again');
ok(!payable.some((x) => x.id === 'c'), 'an unmarked session is not settled — nobody has said it happened');
ok(!payable.some((x) => x.id === 'd'), 'a session with no rate cannot be paid for');
ok(!payable.some((x) => x.id === 'e'), 'a no-show is not payable under a delivered-only policy');

ok(settlementAmount(payable) === 5000, 'the amount is the sum of the rates snapshotted on the sessions');
ok(settlementAmount([]) === 0, 'nothing outstanding settles to nothing');

// The late-marking case, which is the whole reason settlement is per session.
const lateMarked = s2({ id: 'f', settlementId: null, startsAt: '2026-08-18T09:00:00Z' });
const secondRun = settleableSessions([alreadyPaid, lateMarked], PAY_DELIVERED_ONLY, NOW2);
ok(secondRun.length === 1 && secondRun[0].id === 'f',
   'a session marked after its period was settled joins the next run rather than being lost or double-paid');

ok(settleBlocker(payable, 1) !== null, 'an unmarked session anywhere blocks settling');
ok((settleBlocker(payable, 1) ?? '').includes('unfinished'), 'and says why');
ok(settleBlocker([], 0) !== null, 'nothing to pay is a blocker, not a zero-value run');
ok(settleBlocker(payable, 0) === null, 'a clean, fully marked position settles');
}


// ── member invites: the path from "person the gym knows" to "member" ──
{
const NOW3 = Date.parse('2026-08-25T12:00:00Z');
const mi = (o: Partial<MemberInvite> = {}): MemberInvite => ({
  id: 'i1', tenantId: 'gym-1', email: 'sam@fit.com', fullName: 'Sam Ali',
  planId: null, planName: null, invitedBy: null, token: null,
  status: 'pending', createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-09-24T12:00:00Z', acceptedAt: null, acceptedBy: null, ...o,
});

// The address is compared case-insensitively, but `.` and `+` are significant
// on real mail servers and must survive normalisation.
ok(normaliseEmail('  Sam.Ali+gym@Example.COM ') === 'sam.ali+gym@example.com',
   'address is trimmed and lowercased, dots and plus kept');
ok(normaliseEmail('not an address') === null, 'a non-address is rejected, not guessed at');
ok(normaliseEmail('sam@fit') === null, 'an address with no domain dot is rejected');
ok(normaliseEmail('') === null && normaliseEmail(null) === null, 'blank is not an address');

// Expiry. A missing expiry is a gap in the record, not a lapse.
ok(inviteExpired(mi({ expiresAt: null }), NOW3) === false,
   'no expiry recorded is not the same as expired');
ok(inviteExpired(mi({ expiresAt: 'not a date' }), NOW3) === false,
   'an unreadable expiry does not lock a real member out');
ok(inviteExpired(mi({ expiresAt: '2026-08-01T00:00:00Z' }), NOW3) === true, 'a past expiry has passed');
ok(inviteExpired(mi(), NOW3) === false, 'a future expiry has not');

// Derived state: a decision somebody made outranks the clock.
ok(inviteState(mi(), NOW3) === 'pending', 'open and in date reads as pending');
ok(inviteState(mi({ expiresAt: '2026-08-01T00:00:00Z' }), NOW3) === 'expired',
   'open and out of date reads as expired, though nothing wrote that down');
ok(inviteState(mi({ status: 'accepted', expiresAt: '2026-08-01T00:00:00Z' }), NOW3) === 'accepted',
   'an accepted invite does not become "expired" later — that would misdescribe it');
ok(inviteState(mi({ status: 'revoked' }), NOW3) === 'revoked', 'a withdrawn invite stays withdrawn');

ok(inviteRedeemable(mi(), NOW3) === true, 'a pending in-date invite can be accepted');
ok(inviteRedeemable(mi({ expiresAt: '2026-08-01T00:00:00Z' }), NOW3) === false, 'a lapsed one cannot');
ok(inviteRedeemable(mi({ status: 'accepted' }), NOW3) === false, 'nor one already accepted');

// Days left. Null, never 0, when nobody recorded a deadline.
ok(daysUntilExpiry(mi({ expiresAt: null }), NOW3) === null,
   'no deadline recorded returns null — 0 would read as "expires today"');
ok(daysUntilExpiry(mi({ expiresAt: 'nonsense' }), NOW3) === null, 'an unreadable deadline is not known');
ok(daysUntilExpiry(mi(), NOW3) === 30, 'thirty days out is thirty days left');
ok(daysUntilExpiry(mi({ expiresAt: '2026-08-25T21:00:00Z' }), NOW3) === 1,
   'nine hours left rounds up to a day, not down to none');
ok(daysUntilExpiry(mi({ expiresAt: '2026-08-01T00:00:00Z' }), NOW3) === 0,
   'something already lapsed has no days left, not negative days');

ok(inviteExpiryFor('2026-08-25T12:00:00Z', 30) === '2026-09-24T12:00:00.000Z', 'expiry is issue + days');
ok(inviteExpiryFor('2026-08-25T12:00:00Z', null) === null, 'no window means no expiry date is invented');
ok(inviteExpiryFor('whenever', 30) === null, 'an unreadable issue date yields no expiry');
ok(DEFAULT_VALID_DAYS === 30, 'the default invite window is thirty days');

// The blocker: a sentence, or null meaning go. Same shape as settleBlocker.
ok((inviteBlocker('nope') ?? '').includes('email address'), 'a bad address is refused with a reason');
ok(inviteBlocker('sam@fit.com') === null, 'a good address with nothing in the way goes');
ok((inviteBlocker('sam@fit.com', ['SAM@FIT.COM']) ?? '').includes('already an invitation'),
   'a second open invite to the same address is blocked, case-insensitively');
ok((inviteBlocker('sam@fit.com', [], ['Sam@Fit.com']) ?? '').includes('already a member'),
   'inviting an existing member is blocked and says so');
ok(inviteBlocker('sam@fit.com', ['other@fit.com'], ['someone@fit.com']) === null,
   'other people\'s invites and memberships are not in the way');

// Bulk screening, which is what the CSV importer needs.
const batch = [
  { email: 'a@b.com', fullName: 'A' },
  { email: 'A@B.com', fullName: 'A again' },
  { email: 'bad', fullName: 'B' },
  { email: 'c@d.com', fullName: 'C' },
  { email: 'dup@fit.com', fullName: 'D' },
];
const screened = screenInvites(batch, ['dup@fit.com']);
ok(screened.send.length === 2, 'only the usable, unique, not-already-invited rows are sent');
ok(screened.send.map((r) => r.email).join(',') === 'a@b.com,c@d.com', 'and they are the right two');
ok(screened.rejected.length === 3, 'every dropped row is reported, never silently trimmed');
ok((screened.rejected.find((r) => r.row.email === 'A@B.com')?.reason ?? '').includes('more than once'),
   'a repeat inside the same file is caught before the insert fails halfway through');
ok(screened.rejected.some((r) => r.row.email === 'bad'), 'the unparseable address is among the rejects');
ok(screenInvites([]).send.length === 0, 'an empty file screens to nothing rather than throwing');

// Summary. The acceptance rate is the number the owner will read hardest.
const invites = [
  mi({ id: 'a' }),                                                    // pending
  mi({ id: 'b', expiresAt: '2026-08-01T00:00:00Z' }),                 // expired
  mi({ id: 'c', status: 'accepted', expiresAt: '2026-08-01T00:00:00Z' }),
  mi({ id: 'd', status: 'revoked' }),
];
const sum = summariseInvites(invites, NOW3);
ok(sum.total === 4 && sum.pending === 1 && sum.accepted === 1 && sum.revoked === 1 && sum.expired === 1,
   'each invite lands in exactly one derived state');
ok(Math.abs((sum.acceptanceRate ?? 0) - 1 / 3) < 1e-9,
   'acceptance is measured against the settled invites — pending ones have not failed');
ok(summariseInvites([], NOW3).acceptanceRate === null,
   'a gym that has sent nothing has no acceptance rate, which is not 0%');
ok(summariseInvites([mi({ id: 'a' }), mi({ id: 'b' })], NOW3).acceptanceRate === null,
   'nor has a gym whose first batch went out this morning and is all still pending');
ok(summariseInvites([mi({ id: 'a' }), mi({ id: 'b' })], NOW3).pending === 2,
   'though those pending invites are still counted');
}


// ── each app is drawn in its own colour ──
{
const variants = ['client', 'trainer', 'owner'] as const;

for (const v of variants) {
  ok(/^#[0-9a-f]{6}$/i.test(VARIANT_ACCENT[v]), `${v} accent is a full hex value`);
  ok(/^#[0-9a-f]{6}$/i.test(VARIANT_TILE[v]), `${v} tile is a full hex value`);
}

// The whole point: three apps, three colours. A duplicate would mean two
// products look identical, which is what this change exists to fix.
const accents = variants.map((v) => VARIANT_ACCENT[v]);
ok(new Set(accents).size === 3, 'no two apps share an accent');
ok(new Set(variants.map((v) => VARIANT_TILE[v])).size === 3, 'no two apps share an icon tile');
ok(new Set(variants.map((v) => VARIANT_LABEL[v])).size === 3, 'no two apps share a name');

// Accent and tile are deliberately different values — the tile is a plate
// colour behind an icon, the accent is drawn on a near-black screen. They must
// stay in the same hue family, though, or the app stops matching its own logo.
const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
for (const v of variants) {
  const gap = Math.abs(hue(VARIANT_ACCENT[v]) - hue(VARIANT_TILE[v]));
  ok(Math.min(gap, 360 - gap) < 30, `${v}: accent and icon are the same hue family (${gap.toFixed(0)}deg apart)`);
}

// Legibility: the accent carries button labels, so brand-ink must contrast.
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114);
};
for (const v of variants) {
  ok(lum(VARIANT_ACCENT[v]) > lum(VARIANT_TILE[v]) - 1,
     `${v}: the UI accent is no darker than the icon plate`);
}
}


// ── "did you know" rotation ──
{
const all = tipsFor('client');
ok(all.length > 0, 'the client app has tips to show');
ok(new Set(all.map((t) => t.id)).size === all.length, 'every tip id is unique');
ok(all.every((t) => t.text.trim().length > 0 && t.tab.trim().length > 0), 'no blank tips');

// A new user starts at the beginning rather than somewhere arbitrary.
const first = nextTip('client', EMPTY_TIP_STATE);
ok(first?.id === all[0].id, 'a new user gets the first tip, not a random one');

// Walk a full rotation: everything is shown exactly once before anything repeats.
let st: TipState = EMPTY_TIP_STATE;
const order: string[] = [];
for (let i = 0; i < all.length; i++) {
  const t = nextTip('client', st)!;
  order.push(t.id);
  st = markShown(st, t, all.length, new Date(2026, 0, i + 1).toISOString());
}
ok(new Set(order).size === all.length, 'a full rotation shows every tip exactly once');

// After the rotation it restarts from the one shown longest ago, not at random.
ok(nextTip('client', st)?.id === order[0], 'the next rotation starts with the oldest tip');

// seen[] must not grow without bound across years of use.
ok(st.seen.length <= all.length, 'the seen list is capped at the number of tips');

// Timing: the request was "once a session or once a few days", not every launch.
const t0 = Date.parse('2026-08-25T08:00:00Z');
const shown: TipState = { seen: [], lastShownAt: '2026-08-25T08:00:00Z' };
ok(isDue(shown, t0 + 1 * 3600_000) === false, 'an hour later is too soon');
ok(isDue(shown, t0 + 19 * 3600_000) === false, 'nineteen hours is still too soon');
ok(isDue(shown, t0 + 21 * 3600_000) === true, 'past the window it is due again');
ok(isDue(EMPTY_TIP_STATE, t0) === true, 'somebody who has never seen one is due');

// A corrupted timestamp must not silence the feature forever.
ok(isDue({ seen: [], lastShownAt: 'not a date' }, t0) === true, 'an unreadable timestamp counts as due');

ok(tipToShow('client', shown, t0 + 3600_000) === null, 'too soon yields nothing at all');
ok(tipToShow('client', shown, t0 + 21 * 3600_000) !== null, 'due yields a tip');

// Every build has its own tips, drawn from its own guide.
for (const v of ['client', 'trainer', 'owner'] as const) {
  ok(tipsFor(v).length > 0, `${v} has tips of its own`);
}
ok(tipsFor('client')[0].id !== tipsFor('owner')[0].id, 'the apps do not share a first tip');
}

// ── plan import ─────────────────────────────────────────────────────────────
// The third of CSV import that did not exist. A price list is the one sheet
// where a misread cell becomes a wrong amount of money charged every month.
{
  const p = previewPlans('name,price,interval\nOff-peak,180,month\nAnnual,1800,year\nDay pass,45,once\n');
  ok(p.ready.length === 3, 'three plans read');
  ok(p.rejected.length === 0, 'nothing rejected from a clean sheet');
  ok(p.ready[0].priceCents === 18000, 'price becomes minor units');
  ok(p.ready[0].interval === 'month', 'month read');
  ok(p.ready[1].interval === 'year', 'year read');
  ok(p.ready[2].interval === 'once', 'one-off read');
  ok(p.ready[0].currency === 'AED', 'currency defaults');
  ok(p.ready[0].active === true, 'plans default to on sale');

  // The refusal that matters most. membership_plans.interval accepts only
  // month/year/once, so a quarterly plan has nowhere truthful to go: mapping
  // it to month divides the gym's recurring revenue by three.
  const q = previewPlans('name,price,interval\nQuarterly,500,quarterly\n');
  ok(q.ready.length === 0, 'a quarterly plan is not silently repriced');
  ok(q.rejected.length === 1, 'it is refused, not dropped');
  ok(/not month, year or one-off/.test(q.rejected[0]?.errors.join(' ') ?? ''), 'and says why');

  // A blank price is an unfinished row, not a free plan.
  const blank = previewPlans('name,price\nUnnamed,\n');
  ok(blank.ready.length === 0, 'a blank price is refused');
  ok(/unfinished row/.test(blank.rejected[0]?.errors.join(' ') ?? ''), 'blank price explains itself');

  // But a deliberate zero is a real thing a gym sells: staff, comp, founder.
  const free = previewPlans('name,price\nStaff,0\n');
  ok(free.ready.length === 1, 'a deliberate zero IS a plan');
  ok(free.ready[0]?.priceCents === 0, 'and stays zero');

  const neg = previewPlans('name,price\nOops,-50\n');
  ok(neg.ready.length === 0, 'a negative price is refused');

  // Same plan twice is two prices for one thing.
  const dup = previewPlans('name,price\nGold,200\ngold,250\n');
  ok(dup.ready.length === 1, 'a duplicate plan name is refused');
  ok(/duplicate of line 2/.test(dup.rejected[0]?.errors.join(' ') ?? ''), 'and points at the first one');

  const cur = previewPlans('name,price,currency\nGold,200,GBP\n');
  ok(cur.ready[0]?.currency === 'GBP', 'a real currency code is kept');
  const badCur = previewPlans('name,price,currency\nGold,200,pounds\n');
  ok(badCur.ready.length === 0, 'a currency that is not a code is refused');

  const off = previewPlans('name,price,active\nRetired,200,no\n');
  ok(off.ready.length === 1 && off.ready[0].active === false, 'no means not on sale');
  const odd = previewPlans('name,price,active\nGold,200,maybe\n');
  ok(odd.ready.length === 0, 'an unreadable yes/no is refused, not defaulted on sale');

  const noCols = previewPlans('something,else\na,b\n');
  ok(noCols.missingRequired.includes('name') && noCols.missingRequired.includes('price'),
     'a sheet with neither column says so');
}

// ── the trainer rota ────────────────────────────────────────────────────────
// The point of this module is not the calendar, it is the disagreement between
// the rota and the timetable. So most of what is checked here is the two
// findings — an hour with work booked and nobody on, and an hour with somebody
// on and nothing booked — plus the refusal to report either against a rota
// nobody has filled in.
//
// Every instant is built with `new Date(y, m, d, h)` and converted to ISO, so
// the wall-clock times below mean the same thing in whatever timezone this
// runs, which is exactly what the module buckets by. 7 Sept 2026 is a Monday.
{
  const at = (day: number, h: number, min = 0) => new Date(2026, 8, day, h, min, 0, 0).toISOString();
  const MON = '2026-09-07';
  const days = weekDays(MON);

  const shift = (id: string, trainerId: string, day: number, from: number, to: number,
                 over: Partial<Shift> = {}): Shift => ({
    id, trainerId, trainerName: trainerId, startsAt: at(day, from), endsAt: at(day, to),
    role: 'floor', status: 'scheduled', note: null, ...over,
  });
  const cls = (day: number, h: number, durationMin = 60, trainerId: string | null = null): DemandBlock =>
    ({ kind: 'class', label: 'HIIT', startsAt: at(day, h), durationMin, trainerId });
  const pt = (day: number, h: number, durationMin = 60, trainerId: string | null = null): DemandBlock =>
    ({ kind: 'pt', label: 'One-to-one', startsAt: at(day, h), durationMin, trainerId });

  // The week the screen pages through.
  ok(weekStartOf(new Date(2026, 8, 9)) === MON, 'midweek resolves to its Monday');
  ok(weekStartOf(new Date(2026, 8, 7)) === MON, 'Monday is its own week start');
  ok(weekStartOf(new Date(2026, 8, 13)) === MON, 'Sunday belongs to the week that began Monday');
  ok(weekStartOf(new Date(2026, 8, 14)) === '2026-09-14', 'the next Monday opens the next week');
  ok(days.length === 7 && days[0] === MON && days[6] === '2026-09-13', 'seven days, Monday to Sunday');
  ok(shiftWeek(MON, -1) === '2026-08-31', 'paging back crosses the month');
  ok(hourLabel(6) === '06:00' && hourLabel(18) === '18:00', 'hours read as a wall clock');

  // A block occupies every hour it touches — a 17:30 class needs somebody on
  // the floor at 17:00 and at 18:00.
  const straddle = hoursSpanned(at(7, 17, 30), at(7, 18, 15));
  ok(straddle.length === 2, 'a 17:30-18:15 block touches two hours');
  ok(straddle[0].hour === 17 && straddle[1].hour === 18, 'and they are 17 and 18');
  ok(hoursSpanned(at(7, 9), at(7, 9)).length === 0, 'a zero-length span covers nothing');
  ok(hoursSpanned(at(7, 10), at(7, 9)).length === 0, 'a reversed span covers nothing');
  ok(shiftHours({ startsAt: at(7, 6), endsAt: at(7, 14) }) === 8, 'a 06:00-14:00 shift is eight hours');
  ok(shiftHours({ startsAt: at(7, 14), endsAt: at(7, 6) }) === null,
     'an unreadable span is null hours, not zero');

  // The grid holds only hours with something in them.
  const grid = buildRota(days, [shift('s1', 't1', 7, 9, 11)], [cls(7, 18)]);
  ok(grid.length === 3, 'three hours have something in them');
  ok(grid[0].hour === 9 && grid[2].hour === 18, 'and they come out in time order');
  ok(grid[2].classes === 1 && grid[2].rostered.length === 0, 'the 18:00 class has nobody on it');
  ok(buildRota(['2026-09-14'], [shift('s1', 't1', 7, 9, 11)], []).length === 0,
     'hours outside the asked-for days are dropped');

  // THE RULE: an empty rota is not an uncovered gym.
  const empty = coverage(days, [], [cls(7, 18)]);
  ok(empty.uncovered === null, 'an empty rota reports no uncovered hours — it refuses the question');
  ok(empty.idle === null, 'and no idle hours either');
  ok(empty.rosteredHours === null, 'nothing rostered is null hours, not zero');
  ok(empty.coverRate === null, 'and no cover rate');
  ok(/No shifts/.test(empty.blocker ?? ''), 'it says why rather than showing a confident zero');
  ok(empty.demandHours === 1, 'the class is still counted — it is a real row');

  // The two findings the whole module exists for.
  const mismatch = coverage(days, [shift('s1', 't1', 7, 9, 11)], [cls(7, 18)]);
  ok(mismatch.uncovered!.length === 1, 'the 18:00 class with nobody on is one uncovered hour');
  ok(mismatch.uncovered![0].hour === 18, 'and it is the 18:00 hour');
  ok(/nobody rostered/.test(mismatch.uncovered![0].note), 'the gap says what is wrong');
  ok(mismatch.idle!.length === 2, 'the two rostered hours with nothing booked are idle');
  ok(mismatch.coverRate === 0, 'no demand hour was covered');

  // Cover that actually lines up.
  const aligned = coverage(days, [shift('s1', 't1', 7, 17, 19)], [cls(7, 18)]);
  ok(aligned.uncovered!.length === 0, 'a shift spanning the class covers it');
  ok(aligned.coverRate === 1, 'every demand hour covered');
  ok(aligned.idle!.length === 1, 'the 17:00 hour of that shift is still idle');

  // A pulled shift is not cover — and is not the same hole as never rostering.
  const pulled = coverage(
    days,
    [shift('s1', 't1', 8, 9, 10), shift('s2', 't2', 7, 18, 19, { status: 'cancelled' })],
    [cls(7, 18)],
  );
  ok(pulled.uncovered!.length === 1, 'a pulled shift does not cover its hour');
  ok(pulled.uncovered![0].cancelled.includes('t2'), 'but the rota still knows who dropped out');
  ok(/pulled/.test(pulled.uncovered![0].note), 'and says so, rather than "nobody rostered"');

  // A class with an instructor who is not on the rota is a different problem.
  const assigned = coverage(days, [shift('s1', 't1', 8, 9, 10)], [cls(7, 18, 60, 't2')]);
  ok(assigned.uncovered![0].assigned.includes('t2'), 'the assigned trainer is carried onto the gap');
  ok(/assigned/.test(assigned.uncovered![0].note), 'and the note distinguishes it');

  // One-to-ones are demand too, not just classes.
  const ptGap = coverage(days, [shift('s1', 't1', 8, 9, 10)], [pt(7, 18)]);
  ok(ptGap.uncovered!.length === 1, 'a booked one-to-one with nobody rostered is uncovered');
  ok(/one-to-one/.test(ptGap.uncovered![0].note), 'and the note names it');

  // A week with no classes has no cover rate. That is not 0%.
  const noDemand = coverage(days, [shift('s1', 't1', 7, 9, 11)], []);
  ok(noDemand.demandHours === 0 && noDemand.coverRate === null, 'no demand means no cover rate');
  ok(noDemand.idle!.length === 2, 'but two hours of paid floor time with nothing booked');

  // The week, per trainer.
  const roster = rosterByTrainer([
    shift('a', 't1', 7, 9, 11), shift('b', 't2', 7, 6, 14), shift('c', 't1', 8, 9, 10),
  ]);
  ok(roster[0].trainerId === 't2' && roster[0].hours === 8, 'busiest trainer first');
  ok(roster[1].hours === 3, 'and hours add across days');
  const onlyPulled = rosterByTrainer([shift('a', 't1', 7, 9, 11, { status: 'cancelled' })]);
  ok(onlyPulled[0].hours === null, 'a trainer whose only shift was pulled has null hours, not zero');
  ok(onlyPulled[0].shifts.length === 1, 'the pulled shift is still on their week');

  ok(summariseRota([]).hours === null, 'an empty rota has null hours');
  const sum = summariseRota([shift('a', 't1', 7, 9, 11), shift('b', 't1', 8, 9, 10, { status: 'cancelled' })]);
  ok(sum.shifts === 2 && sum.cancelled === 1, 'a pulled shift is still a shift on the rota');
  ok(sum.trainers === 1 && sum.hours === 2, 'only live hours are counted');

  const byDay = shiftsByDay(days, [shift('b', 't1', 7, 14, 18), shift('a', 't2', 7, 6, 14)]);
  ok(byDay.length === 7, 'every day of the week comes back, including the empty ones');
  ok(byDay[0].shifts.length === 2 && byDay[0].shifts[0].id === 'a', 'Monday sorted by start time');
  ok(byDay[1].shifts.length === 0, 'Tuesday is empty, and says so by being empty');

  // Building a shift from what the form collects.
  ok(shiftFromHours('t1', MON, 6, 14)?.startsAt === at(7, 6), 'a 6-14 shift starts at 06:00 local');
  ok(shiftFromHours('t1', MON, 6, 14)?.endsAt === at(7, 14), 'and ends at 14:00 local');
  ok(shiftFromHours('t1', MON, 14, 14) === null, 'a zero-length shift is refused, not saved');
  ok(shiftFromHours('t1', MON, 14, 6) === null, 'a backwards shift is refused');
  ok(shiftFromHours('', MON, 6, 14) === null, 'a shift with no trainer is refused');
  ok(shiftFromHours('t1', 'next tuesday', 6, 14) === null, 'a date that is not a date is refused');
}


// Scoped, like the CSV block above: this suite is one long module and `cls`,
// `slot`, `both` are common enough names to collide with an earlier section.
{
  // ── one-to-ones on the gym's own timetable (Phase 1) ──
  //
  // The gap being closed: classes were on the gym's board and one-to-ones were
  // in the trainer's private calendar, so "is the floor covered at six?" could
  // not be asked at all. These assertions guard the merge, and — more
  // importantly — guard the two ways a merged board could lie: by inventing a
  // zero where the row cannot say, and by calling normal sharing a clash.
  const cls = (o: Partial<GymClass>): GymClass => ({
    id: 'c1', title: 'Spin', room: 'Studio 1', instructor: 'Marcus', trainerId: 'tr1',
    startsAt: '2026-09-01T17:00:00Z', durationMin: 60, capacity: 20, booked: 12, attended: 0, ...o,
  });
  const slot = (o: Partial<PtSlot>): PtSlot => ({
    id: 's1', trainerId: 'tr2', trainerName: 'Priya', clientId: 'cl1', clientName: 'Dana',
    startsAt: '2026-09-01T17:00:00Z', durationMin: 60, room: 'Floor', status: 'booked',
    outcome: null, settlementId: null, ...o,
  });
  const AT_1730 = Date.parse('2026-09-01T17:30:00Z');

  // One board, in the order things happen — not classes then one-to-ones.
  const ordered = mergeTimetable(
    [cls({ id: 'c1', startsAt: '2026-09-01T18:00:00Z' })],
    [slot({ id: 's1', startsAt: '2026-09-01T17:00:00Z' })],
  );
  ok(ordered.map((e) => e.key).join(',') === 'pt:s1,class:c1',
     'the board is ordered by time, not by which table the row came from');

  // gym_classes.id and sessions.id are separate id spaces and can collide.
  const sameId = mergeTimetable([cls({ id: 'x' })], [slot({ id: 'x' })]);
  ok(new Set(sameId.map((e) => e.key)).size === 2,
     'a class and a session that share an id stay two rows on the board');

  // Nothing renders 0 for something the row cannot report.
  ok(ptEntry(slot({ status: 'blocked' })).booked === null, 'a held slot has no booked count, not 0');
  ok(ptEntry(slot({ status: 'blocked' })).capacity === null, 'and no denominator either');
  ok(ptEntry(slot({ status: 'available' })).booked === 0, 'an open slot genuinely has 0 booked');
  ok(ptEntry(slot({ status: 'booked' })).capacity === 1, 'a one-to-one holds exactly one place');
  ok(classEntry(cls({ capacity: 0 })).capacity === null,
     'a class with no capacity recorded has no denominator, rather than a full room');

  // Who is actually on the floor at 17:30.
  const both = mergeTimetable([cls({})], [
    slot({}),
    slot({ id: 's2', trainerId: 'tr3', trainerName: 'Sam', status: 'available', clientId: null, clientName: null }),
  ]);
  const at = floorAt(both, AT_1730);
  ok(at.classes === 1 && at.oneToOnes === 2, 'the floor at 17:30 counts both calendars');
  ok(at.heads === 13, `heads = 12 in the class + 1 booked one-to-one + 0 in the open slot (got ${at.heads})`);
  ok(at.staff.join(',') === 'Marcus,Priya,Sam', 'distinct staff on the floor, by name');

  const emptyFloor = floorAt([], AT_1730);
  ok(emptyFloor.heads === null, 'an empty floor has no headcount, not 0 people who failed to turn up');
  ok(emptyFloor.classes === 0 && emptyFloor.oneToOnes === 0, 'but the counts of what is on are real zeros');

  const anon = floorAt([classEntry(cls({ instructor: null, trainerId: null }))], AT_1730);
  ok(anon.unstaffed === 1 && anon.staff.length === 0,
     'a class with nobody named is counted as unstaffed, not staffed by nobody');

  // Half-open, so a class ending as another begins does not read as two.
  ok(entriesAt(both, Date.parse('2026-09-01T17:00:00Z')).length === 3, 'something starting at 17:00 is on at 17:00');
  ok(entriesAt(both, Date.parse('2026-09-01T18:00:00Z')).length === 0, 'something ending at 18:00 is not');
  ok(overlapping(classEntry(cls({})), ptEntry(slot({ startsAt: '2026-09-01T18:00:00Z' }))) === false,
     'back-to-back is not overlapping');

  // The hourly strip keeps its quiet hours, because a gap in cover is the answer.
  const strip = floorByHour(both, Date.parse('2026-09-01T00:00:00Z'), 6, 22);
  ok(strip.length === 17, 'every hour in the range comes back');
  ok(strip[8].entries.length === 0, 'a quiet 14:00 is a row on the strip, not a hole in it');
  ok(strip[11].entries.length === 3, 'and 17:00 carries all three');

  // Clashes: the whole point of one board.
  const dbl = mergeTimetable(
    [cls({ trainerId: 'tr9', instructor: 'Nadia' })],
    [slot({ trainerId: 'tr9', trainerName: 'Nadia', room: 'Floor' })],
  );
  const cl = clashes(dbl);
  ok(cl.length === 1 && cl[0].reason === 'trainer',
     'a trainer teaching a class and a one-to-one at the same hour is a clash');
  ok(cl[0].what === 'Nadia', 'and the clash names them');

  // A free-text instructor is a label, never an identity.
  const twoSams = mergeTimetable(
    [cls({ trainerId: null, instructor: 'Sam' })],
    [slot({ trainerId: 'tr7', trainerName: 'Sam', room: 'Floor' })],
  );
  ok(clashes(twoSams).length === 0, 'two people called Sam are not one double-booked trainer');

  // A room clash needs a class in it; `sessions` records no room capacity, so
  // calling two one-to-ones on the main floor a clash would invent a limit.
  const twoPt = mergeTimetable([], [
    slot({ id: 'a', trainerId: 't1', trainerName: 'A', room: 'Main floor' }),
    slot({ id: 'b', trainerId: 't2', trainerName: 'B', room: 'Main floor' }),
  ]);
  ok(clashes(twoPt).length === 0, 'two one-to-ones sharing the main floor is not a clash');
  const ptInStudio = mergeTimetable(
    [cls({ room: 'Studio 1' })],
    [slot({ trainerId: 't5', trainerName: 'B', room: 'studio 1' })],
  );
  ok(clashes(ptInStudio).some((c) => c.reason === 'room'),
     'but a one-to-one in a room a class has taken is, whatever the casing');

  const backToBack = mergeTimetable([
    cls({ id: 'c1', startsAt: '2026-09-01T17:00:00Z', room: 'Studio 1' }),
    cls({ id: 'c2', startsAt: '2026-09-01T18:00:00Z', room: 'Studio 1' }),
  ], []);
  ok(clashes(backToBack).length === 0, 'a class ending as the next begins is not a double-booking');

  // The KPI row above the board.
  const s = summariseBoard(both);
  ok(s.classes === 1 && s.oneToOnes === 2, 'the summary splits the two kinds');
  ok(s.openSlots === 1, 'and counts the PT capacity nobody has taken');
  ok(s.booked === 13, 'places booked spans both calendars');
  ok(summariseBoard([]).booked === null, 'an empty board has no booked figure, not 0');

  // A slot is refused rather than repaired: a duration typed as 0 is an
  // unfinished form, and defaulting it to an hour puts time on the gym's
  // timetable that nobody asked for.
  ok(slotBlocker({ trainerId: '', startsAt: '2026-09-01T17:00:00Z', durationMin: 60 }) !== null,
     'a slot with no trainer is refused');
  ok(slotBlocker({ trainerId: 't1', startsAt: 'nonsense', durationMin: 60 }) !== null,
     'a slot with no readable time is refused');
  ok(slotBlocker({ trainerId: 't1', startsAt: '2026-09-01T17:00:00Z', durationMin: 0 }) !== null,
     'a zero-minute slot is refused, not defaulted to an hour');
  ok(slotBlocker({ trainerId: 't1', startsAt: '2026-09-01T17:00:00Z', durationMin: NaN }) !== null,
     'a duration that did not parse is refused');
  ok(slotBlocker({ trainerId: 't1', startsAt: '2026-09-01T17:00:00Z', durationMin: 60 }) === null,
     'a complete slot is allowed through');
}

// ── progress photos ──
// The storage layout is load-bearing: `photos/<auth.uid()>/<file>`, because the
// policies in supabase/parts/45-progress-photos.sql grant own-folder access on
// `(storage.foldername(name))[1] = auth.uid()::text` and nothing else. A key
// built any other way is refused by the database, not by this code, so these
// pin the shape the two sides agreed on.
{
  const UID = 'fc0f5920-8063-47a8-92b0-94ea1d196cdd';
  const OTHER = '11111111-2222-3333-4444-555555555555';
  const p = photoObjectPath(UID, 1756000000000, 'abc123xy');
  ok(p === UID + '/1756000000000-abc123xy.jpg', 'the object key is <uid>/<millis>-<token>.jpg');
  ok(p.split('/')[0] === UID, 'the first path segment is the uid the storage policy reads');
  ok(PHOTO_PATH_RE.test(p), 'a generated key matches the shape the server will purge');

  ok(isOwnPhotoPath(p, UID) === true, 'my own key is mine');
  ok(isOwnPhotoPath(p, OTHER) === false, 'somebody else\'s key is not mine');
  ok(isOwnPhotoPath('../' + UID + '/x.jpg', UID) === false, 'a traversal prefix is not my folder');
  ok(isOwnPhotoPath(UID + '/a b.jpg', UID) === false, 'a key needing URL escaping is refused');
  ok(isOwnPhotoPath(UID + '.jpg', UID) === false, 'a key with no folder at all is refused');

  const ph = (id: string, takenAt: string, url: string | null = 'u'): ProgressPhoto =>
    ({ id, path: UID + '/' + id + '.jpg', takenAt, url, weightKg: null, bodyFatPct: null });
  const mixed = [ph('c', '2026-03-01T00:00:00Z'), ph('a', '2026-01-01T00:00:00Z'), ph('b', '2026-02-01T00:00:00Z')];
  ok(sortOldestFirst(mixed).map((x) => x.id).join('') === 'abc', 'a progress view reads oldest first');
  ok(mixed.map((x) => x.id).join('') === 'cab', 'sorting does not mutate the caller\'s array');

  // The pair is ordered by when the photos were TAKEN, not by tap order —
  // tapping the newer one first must still label it "after".
  const pair = comparePair(sortOldestFirst(mixed), ['c', 'a']);
  ok(pair !== null && pair.before.id === 'a' && pair.after.id === 'c', 'before/after follows the dates, not the taps');
  ok(pair !== null && pair.days === 59, 'and the gap is whole days apart');
  ok(comparePair(mixed, ['a']) === null, 'one photo is not a comparison');
  ok(comparePair(mixed, ['a', 'a']) === null, 'the same photo twice is not a comparison');
  ok(comparePair(mixed, ['a', 'zz']) === null, 'a photo that is not there is not a comparison');
  ok(daysApart('2026-01-01T00:00:00Z', 'nonsense') === null, 'an unreadable date has no gap, not zero');

  // The label this whole feature exists to make honest. It used to read
  // "N on screen" because nothing was stored.
  ok(photosNote(null) === null, 'not loaded yet claims nothing');
  ok(photosNote([]) === null, 'loaded and empty claims nothing either — the body says which');
  ok(photosNote([ph('a', '2026-01-01T00:00:00Z')]) === '1 saved', 'one saved photo says saved');
  ok(photosNote(mixed) === '3 saved', 'three saved photos say saved');

  // "Not loaded" and "loaded, nothing missing" must not both be 0.
  ok(missingFileCount(null) === null, 'nothing loaded is not zero missing');
  ok(missingFileCount([ph('a', '2026-01-01T00:00:00Z')]) === 0, 'a signed photo is not missing');
  ok(missingFileCount([ph('a', '2026-01-01T00:00:00Z', null)]) === 1, 'a row whose file would not sign counts as missing');

  // No invented values: a scan-less photo carries nulls, not zeroes.
  const row = rowToPhoto({ id: 'r1', client_id: UID, taken_at: '2026-01-01T00:00:00Z', image_path: UID + '/1-a.jpg', weight_kg: null, body_fat_pct: null }, null);
  ok(row.weightKg === null && row.bodyFatPct === null, 'a photo with no measurements carries null, never 0');
  ok(row.url === null, 'a photo that could not be signed has no url');
}


// ── writing sessions back to Apple Health ───────────────────────────────────
// The only path in this app that PUTS something in a person's permanent health
// record. A mistake here is not a wrong pixel: it is a row they have to find
// and delete by hand in Apple's Health app.
{
  const T1 = '2026-08-20T18:00:00.000Z';
  const T2 = '2026-08-21T07:30:00.000Z';
  const lift = (t: string, name: string, extra: Partial<WorkoutEntry> = {}): WorkoutEntry =>
    ({ t, exercise: name, sets: [[8, 60], [8, 62.5]] as [number, number][], ...extra });

  const pushDay = ['Bench Press', 'Incline Press', 'Dip', 'Lateral Raise',
                   'Overhead Press', 'Cable Fly', 'Triceps Pushdown', 'Skullcrusher']
    .map((n) => lift(T1, n));
  ok(groupSessions(pushDay).length === 1, 'eight exercises at one timestamp are ONE session, not eight');
  ok(groupSessions(pushDay)[0].entries.length === 8, 'and that session keeps all eight exercises');
  ok(groupSessions([...pushDay, lift(T2, 'Back Squat')]).length === 2, 'a second timestamp is a second session');

  ok(sessionKey('2026-08-20T18:00:00.000Z') === sessionKey('2026-08-20T19:00:00+01:00'),
     'the same instant spelled two ways is ONE idempotency key');
  ok(sessionKey(T1) !== sessionKey(T2), 'different sessions get different keys');

  ok(sessionDuration(pushDay) === null,
     'a strength session with no HR and no stated length has NO duration — not a default');
  ok(sessionDuration([]) === null, 'no entries means no duration');

  const zoned = pushDay.map((e, i) => (i === 0 ? { ...e, zones: { z1: 300, z2: 600, z3: 900, z4: 300, z5: 60 } } : e));
  const dz = sessionDuration(zoned)!;
  ok(dz !== null && dz.source === 'zones' && dz.seconds === 2160,
     'seconds measured from a heart-rate series are the session length');
  const zonedTwice = zoned.map((e) => ({ ...e, zones: { z1: 300, z2: 600, z3: 900, z4: 300, z5: 60 } }));
  ok(sessionDuration(zonedTwice)!.seconds === 2160,
     'zone seconds are the largest measured span, never the sum across entries');

  const cardioPair: WorkoutEntry[] = [
    { t: T2, exercise: 'Rowing', cardio: { mins: 12, dist: 2.4, unit: 'km' } },
    { t: T2, exercise: 'Rowing', cardio: { mins: 8, dist: 1.6, unit: 'km' } },
  ];
  const dc = sessionDuration(cardioPair)!;
  ok(dc.source === 'cardio' && dc.seconds === 20 * 60,
     'consecutive cardio blocks at one timestamp add up to the session length');

  const stated = pushDay.map((e) => ({ ...e, sessionMins: 52 }));
  const ds = sessionDuration(stated)!;
  ok(ds.source === 'entered' && ds.seconds === 52 * 60,
     'a length the person typed is real data and is used when nothing measured one');
  ok(sessionDuration(pushDay.map((e) => ({ ...e, sessionMins: 0 }))) === null,
     'a typed 0 is an unfinished form, not a zero-minute workout');
  ok(sessionDuration(zoned.map((e) => ({ ...e, sessionMins: 999 })))!.source === 'zones',
     'a measurement outranks a typed number when both exist');

  ok(sessionActivity(pushDay).activity === 'TraditionalStrengthTraining',
     'rows of [reps, kg] with no cardio are strength training');
  ok(sessionActivity(cardioPair).activity === 'Rowing', 'a session of rows is Rowing');
  const mixed = [...pushDay, { t: T1, exercise: 'Cycling', cardio: { mins: 20, dist: 8, unit: 'km' } }];
  ok(sessionActivity(mixed).activity === 'Other' && sessionActivity(mixed).specific === false,
     'lifting plus a bike finisher is NOT a cycling workout — it is Other, and says so');
  ok(sessionActivity([{ t: T1, exercise: 'Underwater Basket Weaving' }]).activity === 'Other',
     'an exercise Health has no name for falls back to the honest generic');

  // The bridge files an unrecognised activity string as AMERICAN FOOTBALL
  // rather than erroring, so every string this code can emit must be known.
  for (const entries of [pushDay, cardioPair, mixed, [{ t: T1, exercise: 'Nonsense' }] as WorkoutEntry[]]) {
    ok(HK_WRITE_ACTIVITIES.has(sessionActivity(entries).activity),
       'every activity this code can produce must be one Apple Health defines');
  }
  ok(!HK_WRITE_ACTIVITIES.has('Circuit') && HK_WRITE_ACTIVITIES.has('Other'),
     'the allowlist is the bridge dictionary, not the app vocabulary');

  ok(sessionKcal(cardioPair.map((e) => ({ ...e, kcal: 120 }))) === 240,
     'energy is the sum when every entry recorded some');
  ok(sessionKcal([{ ...cardioPair[0], kcal: 120 }, cardioPair[1]]) === null,
     'a session where only some entries recorded energy writes NO energy, not a partial total');
  ok(sessionKcal(pushDay) === null, 'a session that recorded no energy writes none');

  ok(sessionDistanceMeters([cardioPair[0]]) === 2400, 'one recorded distance converts to metres');
  ok(sessionDistanceMeters(cardioPair) === null, 'two distances in one session are not summed into a fiction');
  ok(sessionDistanceMeters([{ t: T2, exercise: 'Walk', cardio: { mins: 30, dist: 0, unit: 'km' } }]) === null,
     'dist 0 is the importer saying "not reported" — never a measurement of standing still');
  ok(sessionDistanceMeters([{ t: T2, exercise: 'Run', cardio: { mins: 30, dist: 5, unit: 'mi' } }]) === 8047,
     'miles convert rather than being written as kilometres');

  const blocked = planSession(groupSessions(pushDay)[0]) as any;
  ok(blocked.code === 'no-duration', 'a session with no length is refused, with a code');
  ok(/length/i.test(blocked.reason) && !/\b45\b|\bdefault/i.test(blocked.reason),
     'and the refusal explains what is missing without offering a substitute');

  const ready = planSession(groupSessions(stated)[0]) as any;
  ok(ready.code === undefined && ready.activity === 'TraditionalStrengthTraining',
     'the same session becomes writable once its length is stated');
  ok(ready.startISO === new Date(T1).toISOString(), 'the workout starts when the session did');
  ok(Date.parse(ready.endISO) - Date.parse(ready.startISO) === 52 * 60 * 1000,
     'and ends exactly one stated duration later — no rounding into invented time');
  ok(ready.kcal === null && ready.distanceMeters === null,
     'nothing unrecorded is filled in on the way to Health');

  const log2: WorkoutEntry[] = [...stated, ...cardioPair];
  const fresh = planWrite(log2, {});
  ok(fresh.writable.length === 2 && fresh.alreadyWritten === 0, 'two sessions, both writable, first time');
  const led: Ledger = { [sessionKey(T1)]: { at: T1, uuid: 'u', activity: 'TraditionalStrengthTraining', seconds: 3120 } };
  const again = planWrite(log2, led);
  ok(again.writable.length === 1 && again.alreadyWritten === 1,
     'a session already in Health is never offered a second time');
  ok(again.writable[0].t === T2, 'and the one still to write is the other one');
  ok(planWrite([...log2, lift(T1, 'Ninth Exercise', { sessionMins: 52 })], led).alreadyWritten === 1,
     'adding an exercise to a written session does not make it a new one to write');

  const partial = summariseResult({
    state: 'done',
    written: [1, 2, 3, 4, 5].map((n) => ({ key: 'k' + n, activityLabel: 'Rowing', t: T2, uuid: null })),
    failed: [6, 7, 8, 9].map((n) => ({ key: 'k' + n, activityLabel: 'Rowing', t: T2, reason: 'HealthKit said no' })),
    skipped: [], alreadyWritten: 0,
  });
  ok(partial.includes('5 of 9') && partial.includes('4 failed'),
     'writing 5 of 9 says exactly that — the count attempted and the count that failed');
  ok(summariseResult({ state: 'done', written: [{ key: 'k', activityLabel: 'Rowing', t: T2, uuid: null }], failed: [], skipped: [], alreadyWritten: 0 })
       === 'Wrote 1 session to Apple Health.',
     'a clean run says so plainly');
  const noneWritten = summariseResult({ state: 'done', written: [], failed: [], skipped: [blocked], alreadyWritten: 0 });
  ok(noneWritten.includes('no recorded length') && !/^Wrote/.test(noneWritten),
     'a run that wrote nothing does not open with "Wrote"');
  ok(summariseResult({ state: 'denied', reason: 'Health is not allowing this.' }) === 'Health is not allowing this.',
     'a refusal is reported as the user’s decision, not as a failure of ours');
}

if (errors.length) { console.log('COVERAGE FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL COVERAGE TESTS PASSED (${checks} assertions)`);
