// Extended pure-logic coverage (Phase 8 QA). Compile with tsc then run with node.
import { currentStreak, longestStreak, personalRecords, weekStats, est1RM, isNewPR, streakMilestone, freezeBudget, currentStreakFrozen } from './streaks';
import { parseRepRange, suggestNextWeight, suggestForExercise, priorBest1RM, suggestProgression } from './progression';
import { overlaps, isLateCancellation, cancelSession, nextFromWaitlist } from './booking';
import type { WorkoutEntry } from './mockData';
import { rowToEntry, entryToRow, PERSISTED_FIELDS } from './workoutRow';
import { summarise, money, type MembershipPlan, type Membership, type GymPayment } from './gymRecord';
import { weeklyOccurrences, summariseAttendance, weeklyAttendance, pct, type GymClass, type NewClass, classFillState } from './gymSchedule';
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
import { mergeExerciseLists } from './coachExerciseList';
import { coverageFor, coverageLine } from './videoCoverage';
import { lockDecision, lockSettingNote, GRACE_MS } from './appLock';
import { attributionLine } from './workoutAttribution';
import { RECOVERY_ACTIVITIES, isRecoveryActivity } from './recoveryActs';
import { normaliseCode, isPlausibleCode, joinErrorMessage, CODE_ALPHABET, CODE_LENGTH } from './joinCode';
import { groupSessions, sessionKey, sessionDuration, sessionActivity, sessionKcal, sessionDistanceMeters, planSession, planWrite, summariseResult, HK_WRITE_ACTIVITIES, type Ledger } from './wearables/appleHealthWrite';
import { sliceLoading, sliceReady, sliceFailed, rowsOf, brokenParts, completeness, partialWarning, memberIds, buildDossier, buildDossiers, retentionRead, doorLogActive, attendanceCaveat, type MemberRecord, type MemberBooking } from './memberView';
import { payroll30For, payrollBlocker, type GymTrainer } from './gymTrainers';
import { gymRollup, trainerHealth } from './ownerAnalytics';
import { isDelivered, isAwaitingOutcome, isPayable, payrollByTrainer, payrollTotal, settlementBlocker, settleableSessions, settlementAmount, settleBlocker, sessionProfileIds, namesById, PAY_DELIVERED_ONLY, type PtSession } from './gymSessions';
import { dwellMinutes, averageDwellMinutes, uniqueMembers, summariseVisits, visitsByHour, peakHour, visitsPerDay, lastSeenDays, type Visit } from './gymVisits';
import { remainingUses, isExpired, isRedeemable, expiryFor, passRevenueCents, summarisePasses, guestsByHost, passStatus, type GymPass } from './gymPasses';
import { estimateDish, searchDishes, DISHES } from './restaurant';
import { normaliseEmail, inviteState, isExpired as inviteExpired, isRedeemable as inviteRedeemable, expiryFor as inviteExpiryFor, daysUntilExpiry, inviteBlocker, screenInvites, summariseInvites, DEFAULT_VALID_DAYS, type MemberInvite } from './memberInvites';
import { exerciseSlug, sameExercise, findExercise, videoForExercise, type ExerciseRef, isAcademyClip } from './exerciseId';
import { weekStartOf, weekDays, shiftWeek, hoursSpanned, shiftHours, hourLabel, buildRota, coverage, shiftsByDay, rosterByTrainer, summariseRota, shiftFromHours, type Shift, type DemandBlock } from './gymRota';
import { photoObjectPath, isOwnPhotoPath, sortOldestFirst, comparePair, daysApart, photosNote, missingFileCount, rowToPhoto, PHOTO_PATH_RE, type ProgressPhoto } from './progressPhotos';
import { viewerMaySee, shareStateOf, shareLabel, sharedNote, sharedCount, sendBlocker, sentPhotos, sortNewestShared, missingSharedFiles, revokeCaveat, SHARED_URL_TTL_S, type ShareGrant, type CoachLink, type SharedPhoto } from './photoShare';
import { monthlyHistory, monthKey, monthLabel, yearRows, peakVolume, intensity, bestMonth, trainedMonths, gaps, longestGap, monthsSinceLast, historySpan, stageOf, historyNote, lifetimeTotals, prTimeline, volumeArc, tonnes } from './longView';
import { buildPassConversion, hostsOf, intervalOf, coversDate, daysBetween, dateOf, attributionSentence, suppressionSentence, CAUSAL_CAVEAT, MONEY_NOTE, type PassConversionRecord } from './passConversion';
import type { TrainingSession } from './types';
import { assessDrift, rankClients, sortByDrift, summariseDrift, compareDrift, DRIFT_RANK, DRIFT_LABEL, DEFAULT_WINDOWS, type ActivityEvent, type DriftInput, isQueryableId } from './clientDrift';
import { atRiskClient, noRecordOf } from './trainerMock';
import { csvCell, csvRow, toCsv, minorToDecimal, isoDatePart, slug, buildGymExport, exportBlocker, incompleteWarning, EXPORT_PARTS, EXPORT_FILE, type GymExportInput, type PassType } from './gymExport';
import {
  monthWindow, monthKeyOf, recentMonths, monthEnded, inMonth, dayInMonth, sliceMonth,
  isOverdue, incomeOf, purposeOf, owedOf, moneyCheck, payrollOf, buildClose,
  brokenCloseParts, loadingCloseParts, closeWarning, closeHeadline,
  CLOSE_PARTS, CLOSE_LABEL, CLOSE_COST,
  type CloseRecord, type GymInvoice, type MonthWindow,
} from './monthEnd';
import { buildGymRetention, doorLogState, absenceBlocker, cohortFeasibility, monthOfDate, pointsPerMember, rateOf, suppressionNote, headline, pendingRetentionParts, MIN_COHORT_FOR_RATE, type RetentionRecord } from './gymRetention';
import {
  assessFollowUp, assessAllFollowUps, summariseFollowUps, loopHeadline,
  surfaceOrder, quietenedCount, contactsFor, lastContactFor, contactBy, triedLine,
  paceFor, paceOf, paceNote, landed,
  CHANNEL_LABEL, OUTCOME_LABEL, WHY_NO_RATE, MIN_JUDGE_DAYS, DEFAULT_COOLDOWN_DAYS,
  MAX_COOLDOWN_DAYS, MIN_COOLDOWN_DAYS,
  type Contact, type FollowUpRead,
} from './interventions';
import {
  buildStaff, brokenStaffParts, loadingStaffParts, staffCompleteness, staffWarning,
  caveatOf, compareStaff, STAFF_RANK, STAFF_STATUS_LABEL, STAFF_PARTS, STAFF_COST,
  NEW_TRAINER_DAYS,
  type StaffRecord, type StaffTrainer, type StaffClient, type ClientActivity,
} from './staffView';

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


// ── session names come from profiles, not from an embed ──
// The sessions read used to ask PostgREST for trainers(full_name) and
// clients(full_name). Neither table has that column — both are keyed on
// profiles.id — so the whole query was rejected and the screen showed an error
// where the payroll board should have been. Names are now resolved in one pass
// over profiles, and these are the two pure halves of that.
{
const rows = [
  { trainer_id: 't1', client_id: 'c1' },
  { trainer_id: 't1', client_id: 'c2' },   // same trainer again
  { trainer_id: 't2', client_id: null },   // an unbooked slot has no client
  { trainer_id: 't2', client_id: 'c1' },   // same client again
];
const ids = sessionProfileIds(rows);
ok(ids.length === 4, `every distinct person is asked for exactly once (got ${ids.length})`);
ok(ids.includes('t1') && ids.includes('t2') && ids.includes('c1') && ids.includes('c2'),
   'trainers and clients are both looked up, since both are keyed on profiles.id');
ok(!ids.includes(null as any) && !ids.includes(undefined as any),
   'a slot with nobody booked contributes no id — an .in() on null matches nothing');
ok(sessionProfileIds([]).length === 0, 'no rows means no lookup at all');

const names = namesById([
  { id: 't1', full_name: 'Marcus' },
  { id: 'c1', full_name: '  Elena  ' },
  { id: 'c2', full_name: '   ' },
  { id: 't2', full_name: null },
]);
ok(names.get('t1') === 'Marcus', 'a name is carried across by id');
ok(names.get('c1') === 'Elena', 'and trimmed');
ok(!names.has('c2') && !names.has('t2'),
   'a blank name is left out, so the screen shows its dash rather than an empty cell');
}


// ── an exercise is a thing, not a spelling ──
// The video library used to match a clip to an exercise with a bidirectional
// substring test, so asking for "Squat" returned whichever of Back/Front/Goblet
// Squat sorted first — a demo of a different movement, shown as the right one.
{
ok(exerciseSlug('Back Squat') === 'back-squat', 'a name becomes a slug');
ok(exerciseSlug('Push-up') === 'push-up', 'punctuation collapses to a single hyphen');
ok(exerciseSlug('  Bent-Over   Row ') === 'bent-over-row', 'case and stray spacing do not make a new movement');
ok(exerciseSlug('Bent-over Row') === exerciseSlug('Bent-Over Row'),
   'the two spellings the app ships resolve to one exercise');
ok(exerciseSlug('') === '' && exerciseSlug('   ') === '', 'an empty name has no id');

ok(sameExercise('Push-up', 'push up'), 'the same movement, spelled differently');
ok(!sameExercise('Back Squat', 'Front Squat'), 'two squats are not one squat');
ok(!sameExercise('', ''), 'nothing is not the same movement as nothing');

const cat: ExerciseRef[] = [
  { id: 'back-squat', name: 'Back Squat', group: 'Legs' },
  { id: 'bench-press', name: 'Bench Press', group: 'Chest' },
];
ok(findExercise('back squat', cat)?.id === 'back-squat', 'a name finds its catalogue row');
ok(findExercise('Kettlebell Windmill', cat) === null,
   'a movement the coach invented is absent, which is an answer rather than a failure');

// Picking the clip. The substring rule is gone: a near-miss is the wrong lift.
const vids = [
  { exerciseId: 'back-squat', name: 'Back Squat', trainerId: 't1' },
  { exerciseId: null, name: 'Front Squat', trainerId: 't1' },
  { exerciseId: 'back-squat', name: 'Coach Marcus — squat cues', trainerId: 't2' },
];
ok(videoForExercise('Back Squat', vids)?.name === 'Back Squat', 'the clip linked by id wins');
ok(videoForExercise('Front Squat', vids)?.name === 'Front Squat',
   'a clip written before exercise_id existed still resolves, by name');
ok(videoForExercise('Squat', vids) === null,
   'a partial name matches nothing — the old substring rule would have returned Back Squat');
ok(videoForExercise('Goblet Squat', vids) === null, 'a different squat is not this squat');
ok(videoForExercise('', vids) === null, 'no exercise, no clip');
ok(videoForExercise('Back Squat', vids, 't2')?.trainerId === 't2',
   'a member sees their own coach demonstrating it, not a stranger');
// This used to assert the opposite — that a member coached by t9 would be shown
// t1's clip. Two lines above, the file already says "not a stranger". Both
// could not be true, and the fallback was the wrong one: right movement, wrong
// person, from a gym they have nothing to do with. There is no Academy clip in
// `vids`, so the honest answer here is none.
ok(videoForExercise('Back Squat', vids, 't9') === null,
   'a member is shown no clip rather than one belonging to a coach who is not theirs');
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

  // The Face ID lock over an app you are already signed in to.
  {
    const base = { enabled: true, available: true, signedIn: true, backgroundedAt: null, now: 1_000_000 };

    ok(lockDecision({ ...base, signedIn: false }).state === 'open',
       'a lock over a sign-in screen protects nothing');
    ok(lockDecision({ ...base, enabled: false }).state === 'open',
       'off is off');
    ok(lockDecision(base).state === 'locked',
       'a cold start locks — there is no record of when the app was last put down');
    ok(lockDecision({ ...base, backgroundedAt: base.now - GRACE_MS }).state === 'locked',
       'and so does coming back after the grace period');
    ok(lockDecision({ ...base, backgroundedAt: base.now - 1 }).state === 'unlocked',
       'but glancing at a notification does not — a lock people switch off protects nobody');

    const noHw = lockDecision({ ...base, available: false });
    ok(noHw.state === 'open' && noHw.reason !== null && noHw.reason.includes('passcode'),
       'a device with nothing enrolled says WHY it is not asking, rather than silently not locking');

    ok(lockSettingNote(false, true, 'Face ID').startsWith('Unavailable'),
       'and Settings says the same thing');
    ok(lockSettingNote(true, false, 'Face ID').includes('Anyone who picks up this phone'),
       'off states the risk plainly rather than describing the feature');
    ok(lockSettingNote(true, true, 'Face ID').includes('stays signed in either way'),
       'and on makes clear this is a lock, not a second sign-in');
  }

  // How full a class is, for the mark beside the exact count.
  {
    ok(classFillState(20, 20) === 'full' && classFillState(20, 25) === 'full',
       'no spots left is full, and over-booked is still full rather than negative');
    ok(classFillState(20, 0) === 'open', 'an empty class is open');
    ok(classFillState(20, 17) === 'nearly',
       '3 left in a class of 20 is nearly full — 15% of capacity');
    ok(classFillState(20, 16) === 'open', 'and 4 left is not');
    ok(classFillState(8, 6) === 'nearly',
       '2 left in a small class is nearly full, where a flat percentage would have said otherwise');
    ok(classFillState(60, 9) === 'open' && classFillState(60, 51) === 'nearly',
       'and 9 left in a class of 60 is roomy, where a flat count of 3 would have said otherwise');
    ok(classFillState(0, 0) === 'full',
       'a class with no capacity cannot be joined');
  }

  // What a coach programmes vs what anybody has filmed.
  {
    const vids = [
      { exerciseId: 'back-squat', name: 'Back Squat', trainerId: 'me' },
      { exerciseId: 'bench-press', name: 'Bench Press', trainerId: null },
      { exerciseId: 'deadlift', name: 'Deadlift', trainerId: 'other-coach' },
    ];
    const programmed = ['Back Squat', 'Bench Press', 'Deadlift', 'Hip Thrust', 'back squat'];
    const r = coverageFor(programmed, vids, 'me');

    ok(r.all.length === 4,
       'the same movement written twice is one job, however it was cased');
    ok(r.mine.join() === 'Back Squat', 'what this coach has filmed');
    ok(r.academyOnly.join() === 'Bench Press',
       'what only the Academy covers — theirs to replace if they want to');
    ok(r.missing.join() === 'Deadlift,Hip Thrust',
       'and what nobody has filmed. Another coach\u2019s clip does NOT count as covered, because the client will never be shown it');

    ok(coverageLine(coverageFor([], vids, 'me')) === null,
       'a coach who has programmed nothing gets no claim about coverage either way');
    const line = coverageLine(r);
    ok(line !== null && line.includes('2 of the 4') && line.includes('Academy'),
       'the line names both jobs: what is missing, and what is only the Academy');
    const done = coverageLine(coverageFor(['Back Squat'], vids, 'me'));
    ok(done !== null && done.startsWith('Every movement you programme has your own clip'),
       'and says so plainly when there is nothing left to film');
  }

  // Which demo clip a client sees: their coach, then the Academy, then none.
  {
    const mine    = { exerciseId: 'back-squat', name: 'Back Squat', trainerId: 'coach-me' };
    const academy = { exerciseId: 'back-squat', name: 'Back Squat', trainerId: null };
    const other   = { exerciseId: 'back-squat', name: 'Back Squat', trainerId: 'coach-someone-else' };

    ok(videoForExercise('Back Squat', [academy, other, mine], 'coach-me') === mine,
       'a member sees their OWN coach demonstrating, ahead of anything else');
    ok(videoForExercise('Back Squat', [other, academy], 'coach-me') === academy,
       'and the Academy clip when their coach has not filmed it');
    ok(videoForExercise('Back Squat', [other], 'coach-me') === null,
       'but NEVER a stranger from another gym — that used to be the fallback');
    ok(videoForExercise('Back Squat', [other]) === other,
       'with nobody to prefer, the only clip there is is the right answer');
    ok(videoForExercise('Front Squat', [mine, academy], 'coach-me') === null,
       'and a different movement matches nothing — no fuzzy fallback, ever');

    ok(isAcademyClip(academy) && !isAcademyClip(mine) && !isAcademyClip(other),
       'an Academy clip is the one belonging to no coach');
  }

  // An average over no trainers is undefined, not zero.
  {
    const empty = gymRollup([], null);
    ok(empty.avgClientsPerTrainer === null && empty.avgSessionsPerTrainer === null,
       'a gym with no trainers has no average per trainer — 0 claimed every trainer carried nobody');
    const one = gymRollup([{ clients: 6, sessions30: 12 } as any], null);
    ok(one.avgClientsPerTrainer === 6 && one.avgSessionsPerTrainer === 12,
       'and with one trainer the average is simply that trainer');
  }

  // Only ids the database can parse may reach a uuid column.
  {
    ok(isQueryableId('7d4ca6bf-2f1c-4b87-94f4-9b6bdd008aad'),
       'a real uuid is queryable');
    ok(isQueryableId('7D4CA6BF-2F1C-4B87-94F4-9B6BDD008AAD'),
       'and case does not matter, since Postgres accepts either');
    ok(!isQueryableId('c900'),
       'a client added by hand on the phone is NOT — this is the id that took the whole read down');
    ok(!isQueryableId('') && !isQueryableId('local-3') && !isQueryableId('c1'),
       'nor any other local id shape');
    ok(!isQueryableId('7d4ca6bf-2f1c-4b87-94f4-9b6bdd008aa'),
       'a uuid one character short is refused rather than sent and rejected');
  }

  // Recovery is one idea in two places, kept in step by one list.
  {
    ok(isRecoveryActivity('Sauna') && isRecoveryActivity('Cold Plunge'),
       'the modalities Train offers are the ones the Recovery screen recognises');
    ok(isRecoveryActivity('sauna') && isRecoveryActivity('  SAUNA  '),
       'matched however it was cased or spaced, since it arrives as a logged string');
    ok(!isRecoveryActivity('Back Squat') && !isRecoveryActivity('') && !isRecoveryActivity(null),
       'and nothing else is swept onto the Recovery screen');
    for (const name of RECOVERY_ACTIVITIES) {
      ok(isRecoveryActivity(name),
         `${name} is offered on Train, so it must show under Recovery — one list, two screens`);
    }
  }

  // Attribution on a workout a coach logged for a client.
  {
    ok(attributionLine({}, 'Dave', true) === null,
       'a workout somebody logged themselves carries no attribution line');
    ok(attributionLine({ loggedBy: 'coach-1' }, 'Dave', true) === 'Logged by Dave',
       'the client is told who logged it');
    ok(attributionLine({ loggedBy: 'coach-1' }, null, true) === 'Logged by your coach',
       'and is still told SOMEBODY logged it when the name could not be read');
    ok(attributionLine({ loggedBy: 'coach-1' }, 'Dave', false) === 'Logged by you',
       'the coach sees it as their own entry');
    const amended = attributionLine({ loggedBy: 'coach-1', amendedAt: '2026-08-27T09:00:00Z' }, 'Dave', false);
    ok(amended !== null && amended.startsWith('Logged by you · amended by them'),
       'a coach is told plainly that their account of the session was changed');
    const clientSide = attributionLine({ loggedBy: 'coach-1', amendedAt: '2026-08-27T09:00:00Z' }, 'Dave', true);
    ok(clientSide !== null && clientSide.startsWith('Logged by Dave · amended by you'),
       'and the client is told their change is visible, rather than it being silent');
    ok(attributionLine({ loggedBy: 'coach-1', amendedAt: 'not-a-date' }, 'Dave', true) === 'Logged by Dave · amended by you',
       'an unreadable timestamp drops the date rather than rendering Invalid Date');
  }

  // A coach's own exercise names, merged into the picker ahead of the built-ins.
  {
    const builtIn = [{ name: 'Back Squat', group: 'Legs' }, { name: 'Bench Press', group: 'Chest' }];
    const mine = [{ name: 'Sled Push', group: '' }, { name: 'Farmer Carry', group: '' }];
    const merged = mergeExerciseLists(mine, builtIn);
    ok(merged.length === 4, 'a coach\u2019s names are added to the built-in list, not swapped for it');
    ok(merged[0].name === 'Farmer Carry' && merged[1].name === 'Sled Push',
       'the coach\u2019s own come first, alphabetically');
    ok(merged[2].name === 'Back Squat', 'the built-ins follow, in their own order');

    // Retyping something that already exists must not double it up, whatever
    // case it was typed in — the picker is a list a human reads.
    const dup = mergeExerciseLists([{ name: 'bench press', group: '' }], builtIn);
    ok(dup.length === 2, 'a saved name that duplicates a built-in appears once');
    ok(dup[0].name === 'bench press',
       'and it is the coach\u2019s spelling that survives, because they chose it');

    ok(mergeExerciseLists([], builtIn).length === 2,
       'a coach who has saved nothing still gets the whole built-in list');
  }

  // Recovery: a sauna is a real session with a real duration and a real heart
  // rate, and no calorie figure at all. Apple has no sauna type, so it files
  // under the one it provides for this — and it MUST be named, because the
  // fallback for an unknown string is American Football, not an error.
  for (const [name, expected] of [
    ['Sauna', 'PreparationAndRecovery'],
    ['Steam Room', 'PreparationAndRecovery'],
    ['Cold Plunge', 'PreparationAndRecovery'],
    ['Contrast Therapy', 'PreparationAndRecovery'],
    ['Massage', 'PreparationAndRecovery'],
    ['Breathwork', 'MindAndBody'],
  ] as const) {
    const one: WorkoutEntry[] = [{ t: T1, exercise: name, cardio: { mins: 20, dist: 0, unit: 'km' } }];
    ok(sessionActivity(one).activity === expected,
       `${name} writes to Apple Health as ${expected}`);
    ok(HK_WRITE_ACTIVITIES.has(sessionActivity(one).activity),
       `${name} resolves to an activity Apple Health defines`);
    ok(sessionKcal(one) === null,
       `${name} reports no energy — thermoregulation is not work, and a figure there would be invented`);
  }

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


// ── the member view: two members the timetable cannot tell apart ────────────
{
  const NOW = Date.parse('2026-08-26T12:00:00Z');
  const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  const mem = (memberId: string, memberName: string | null, status: Membership['status'], startedOn: string): Membership =>
    ({ id: 'ms-' + memberId + '-' + startedOn, memberId, memberName, planId: 'p1', planName: 'Full', startedOn, endsOn: null, status });
  const pay = (id: string, memberId: string, amountCents: number, takenAt: string): GymPayment =>
    ({ id, memberId, memberName: null, amountCents, currency: 'AED', method: 'card', takenAt, note: null });
  const visit = (id: string, memberId: string, enteredAt: string, classId: string | null = null): Visit =>
    ({ id, memberId, memberName: null, passId: null, classId, enteredAt, exitedAt: null, source: 'door', note: null });
  const book = (bookingId: string, memberId: string, startsAt: string, attended: boolean, status = 'booked'): MemberBooking =>
    ({ bookingId, memberId, classId: 'c-' + bookingId, classTitle: 'Spin', startsAt, status, attendedAt: attended ? startsAt : null });
  const sess = (id: string, clientId: string, startsAt: string, outcome: PtSession['outcome']): PtSession =>
    ({ id, trainerId: 't1', trainerName: 'Coach', clientId, clientName: null, startsAt, durationMin: 60, status: 'booked', outcome, outcomeAt: null, rateCents: 20000, settlementId: null });
  const pass = (id: string, holderId: string, total: number, spent: number): GymPass =>
    ({ id, passTypeId: 'pt1', passTypeName: '10-pack', kind: 'pack', holderId, holderName: null, hostMemberId: null, issuedOn: '2026-08-01', expiresOn: null, usesTotal: total, usesSpent: spent, paidCents: null, currency: 'AED', note: null });

  // FLOOR and GONE have byte-identical class histories. On the timetable they
  // are the same member. In the door log they could not be less alike.
  const classHistory = (id: string) => [
    book(id + '-1', id, ago(40), true),
    book(id + '-2', id, ago(35), true),
    book(id + '-3', id, ago(30), true),
  ];

  const rec: MemberRecord = {
    memberships: sliceReady([
      mem('floor', 'Sara Floor', 'active', '2025-01-01'),
      mem('gone', 'Tom Gone', 'active', '2025-01-01'),
    ]),
    payments: sliceReady([pay('pay1', 'floor', 15000, ago(20)), pay('pay2', 'floor', 15000, ago(50))]),
    visits: sliceReady([
      visit('v1', 'floor', ago(2)), visit('v2', 'floor', ago(5)), visit('v3', 'floor', ago(9)),
      visit('v4', 'floor', ago(40), 'c-floor-1'),
      visit('v5', 'gone', ago(40), 'c-gone-1'), visit('v6', 'gone', ago(35), 'c-gone-2'),
    ]),
    bookings: sliceReady([...classHistory('floor'), ...classHistory('gone')]),
    sessions: sliceReady([
      sess('s1', 'floor', ago(20), 'completed'),
      sess('s2', 'floor', ago(10), null),
      sess('s3', 'floor', ago(3), 'no_show'),
    ]),
    passes: sliceReady([pass('pass1', 'floor', 10, 4)]),
    invites: sliceReady([] as MemberInvite[]),
  };

  const floor = buildDossier('floor', rec, NOW);
  const gone = buildDossier('gone', rec, NOW);

  ok(floor.attended === 3 && gone.attended === 3, 'both members attended the same three classes');
  ok(floor.showRate === 1 && gone.showRate === 1, 'and both show a 100% class attendance rate');

  const rFloor = retentionRead(floor, { now: NOW, doorLogActive: true });
  const rGone = retentionRead(gone, { now: NOW, doorLogActive: true });
  ok(rFloor.classes === 'down' && rGone.classes === 'down', 'the timetable says the same thing about both: down');
  ok(rFloor.recent.classAttendances === 0 && rGone.recent.classAttendances === 0, 'neither has attended a class this half');

  ok(rFloor.stillTrainingOffTheTimetable === true, 'the door log shows one of them still training');
  ok(rGone.stillTrainingOffTheTimetable === false, 'and shows the other has stopped');
  ok(rGone.absentFromLiveDoorLog === true, 'the one who stopped is absent from a live door log');
  ok(rFloor.absentFromLiveDoorLog === false, 'the one still coming in is not');
  ok(rFloor.door === 'up' && rGone.door === 'down', 'the two door trends point opposite ways');
  ok((rFloor.note ?? '').includes('would read this member as lapsed'), 'and the screen is told why it matters');
  ok((rGone.note ?? '').includes('Not through the door'), 'the absent member gets the absence stated');

  const silent = retentionRead(gone, { now: NOW, doorLogActive: false });
  ok(silent.absentFromLiveDoorLog === false, 'a silent door log cannot convict anybody of absence');
  const blindRec: MemberRecord = { ...rec, visits: sliceReady([]) };
  ok(doorLogActive(blindRec) === false, 'an empty door log is a fact about the gym');
  ok((attendanceCaveat(blindRec) ?? '').includes('class bookings only'), 'and the page must say attendance is class-only');
  ok(attendanceCaveat(rec) === null, 'a live door log needs no such caveat');

  const brokenDoor: MemberRecord = { ...rec, visits: sliceFailed('500') };
  const blind = retentionRead(buildDossier('floor', brokenDoor, NOW), { now: NOW, doorLogActive: false });
  ok(blind.door === null, 'an unread door log has no trend');
  ok(blind.stillTrainingOffTheTimetable === false, 'and supports no claim that they are still training');
  ok(doorLogActive(brokenDoor) === null, 'unread is not "no door log"');
  ok(attendanceCaveat(brokenDoor) === null, 'the failure banner says it, so the caveat does not double up');

  ok(rowsOf(sliceLoading<number>()) === null, 'not loaded yet has no rows');
  ok(rowsOf(sliceFailed<number>('boom')) === null, 'a failed read has no rows either');
  ok((rowsOf(sliceReady<number>([])) ?? null)?.length === 0, 'loaded and empty has rows, and there are none');
  ok(completeness(rec) === 'whole', 'every part read is a whole picture');
  ok(completeness({ ...rec, passes: sliceLoading() }) === 'loading', 'one part in flight is still loading');
  ok(completeness({ ...rec, passes: sliceLoading(), visits: sliceFailed('x') }) === 'broken', 'a definite failure outranks a pending read');
  ok(partialWarning(rec) === null, 'a whole page carries no warning');
  const warn = partialWarning({ ...rec, visits: sliceFailed('timeout'), passes: sliceFailed('timeout') }) ?? '';
  ok(warn.includes('the door log') && warn.includes('passes'), 'the warning names every part that failed');
  ok(warn.includes('missing from this page, not empty'), 'and refuses to let a failure read as an empty record');
  ok(brokenParts({ ...rec, visits: sliceFailed('timeout') })[0].cost.includes('in the building'), 'it says what the reader is therefore not seeing');

  ok(gone.paidCents === null, 'a member with no payment rows has paid an unknown amount, not 0');
  ok(floor.paidCents === 30000, 'and a member with two has the sum of them');
  ok(buildDossier('floor', { ...rec, payments: sliceFailed('nope') }, NOW).paidCents === null, 'an unread payments table is not 0.00 either');
  const noClasses = buildDossier('floor', { ...rec, bookings: sliceReady([]) }, NOW);
  ok(noClasses.booked === 0 && noClasses.showRate === null, 'nobody who booked nothing has a 0% attendance rate');
  const halfShown = buildDossier('x', {
    ...rec,
    memberships: sliceReady([mem('x', 'X', 'active', '2025-01-01')]),
    bookings: sliceReady([book('b1', 'x', ago(3), true), book('b2', 'x', ago(4), false), book('b3', 'x', ago(5), false, 'cancelled')]),
  }, NOW);
  ok(halfShown.booked === 2 && halfShown.attended === 1, 'a cancelled booking is not a place held');
  ok(halfShown.showRate === 0.5, 'and the rate is over what was actually booked');

  ok(floor.floorVisits === 3 && floor.classVisits === 1, 'floor visits and class visits are counted apart');
  ok(floor.lastSeenDays === 2, 'last seen is measured from the door, not from a booking');
  ok(buildDossier('nobody', rec, NOW).lastSeenDays === null, 'a member never seen has no number of days, not 0');

  ok(floor.delivered === 1, 'only a session somebody marked completed is delivered');
  ok(floor.noShows === 1 && floor.unmarked === 1, 'no-shows and unmarked sessions are reported separately');
  ok(floor.passVisitsLeft === 6, 'and the pass shows what is still owed');

  ok((memberIds(rec) ?? []).length === 2, 'the roster comes from the memberships, not from who happened to visit');
  ok(memberIds({ ...rec, memberships: sliceFailed('down') }) === null, 'with no roster there is no member list, not an empty one');
  ok(buildDossiers({ ...rec, memberships: sliceFailed('down') }, NOW) === null, 'and no dossiers either');
  ok((buildDossiers(rec, NOW) ?? [])[0].name === 'Sara Floor', 'dossiers come back sorted by name');

  // ── absence is a question about somebody the gym still expects to see ──
  //
  // This flag used to consult only the door log. A frozen member — a pause the
  // gym itself agreed — came back "gone quiet", and so did somebody who had
  // cancelled and left. Both got chased.
  const quietRec: MemberRecord = {
    ...rec,
    memberships: sliceReady([
      mem('act', 'Active Person', 'active', '2025-01-01'),
      mem('frz', 'Frozen Person', 'frozen', '2025-01-01'),
      mem('can', 'Cancelled Person', 'cancelled', '2025-01-01'),
      mem('exp', 'Expired Person', 'expired', '2025-01-01'),
    ]),
    // Nobody in this set has visited recently; the log is live because `floor`
    // and `gone` above are still generating rows for the same gym.
    visits: sliceReady([visit('vq', 'other', ago(2))]),
  };
  const live = { now: NOW, doorLogActive: true };
  const rd = (id: string) => retentionRead(buildDossier(id, quietRec, NOW), live);

  ok(rd('act').absentFromLiveDoorLog === true, 'an active member who has stopped coming in IS absent');
  ok(rd('act').absenceUnknownBecause === null, 'and nothing excuses it, so the flag stands on its own');

  ok(rd('frz').absentFromLiveDoorLog === false,
     'a FROZEN member is not gone quiet — the gym agreed that pause and is reading its own decision back as a problem');
  ok(rd('frz').absenceUnknownBecause === 'frozen', 'and the reason is named rather than left as a bare false');

  ok(rd('can').absentFromLiveDoorLog === false,
     'somebody who cancelled has left, and chasing a leaver is worse than noise');
  ok(rd('can').absenceUnknownBecause === 'cancelled', 'named too, so a screen can tell it apart from "fine"');

  // The one that must NOT be excused, and the reason the rule is a list rather
  // than "has a live membership".
  ok(rd('exp').absentFromLiveDoorLog === true,
     'an EXPIRED membership nobody renewed is exactly who a retention view exists to surface');
  ok(rd('exp').absenceUnknownBecause === null, 'so it is not excused as an agreed ending');

  // No membership row at all is not evidence of anything.
  ok(rd('nobody').absentFromLiveDoorLog === false, 'a member with no membership row cannot be judged absent');
  ok(rd('nobody').absenceUnknownBecause === 'no-membership', 'and says so, rather than reading as present');

  const rejoined = buildDossier('r', {
    ...rec,
    memberships: sliceReady([mem('r', 'R', 'cancelled', '2026-03-01'), mem('r', 'R', 'active', '2026-06-01')]),
  }, NOW);
  ok(rejoined.status === 'active', 'a member who rejoined reads as active, not as their old cancellation');
}


// ── client drift: the coach's book, ordered by who is breaking their own pattern ──
{
  // Local noon, so NOW - n*DAY always lands on a distinct local calendar day
  // whatever the timezone or a DST shift does — the module buckets by local day.
  const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const DAY_MS = 86_400_000;
  const at = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
  const evs = (offsets: number[]): ActivityEvent[] => offsets.map((n) => ({ at: at(n), kind: 'workout' as const }));
  const who = (clientId: string, offsets: number[], sinceDaysAgo: number | null): DriftInput =>
    ({ clientId, events: evs(offsets), since: sinceDaysAgo == null ? null : at(sinceDaysAgo) });
  const D = (i: DriftInput) => assessDrift(i, NOW, DEFAULT_WINDOWS);

  const steady2 = who('steady2', [1, 4, 8, 11, 15, 18, 22, 25, 29, 32, 36, 39, 43, 46, 50, 53], 56);
  const steady1 = who('steady1', [3, 10, 17, 24, 31, 38, 45, 52], 56);
  const fell4to1 = who('fell4to1', [3, 10, 15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32, 36, 37, 38, 39, 43, 44, 45, 46, 50, 51, 52, 53], 56);
  const fell5to2 = who('fell5to2', [1, 2, 8, 9, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33, 36, 37, 38, 39, 40, 43, 44, 45, 46, 47, 50, 51, 52, 53, 54], 56);
  const wentSilent = who('wentSilent', [15, 17, 19, 22, 24, 26, 29, 31, 33, 36, 38, 40, 43, 45, 47, 50, 52, 54], 56);
  const noData = who('noData', [], 40);
  const noDataNew = who('noDataNew', [], 5);
  const joined42 = who('joined42', [3, 10, 15, 17, 19, 22, 24, 26, 29, 31, 33, 36, 38, 40], 42);
  const tooNew = who('tooNew', [1, 3, 5, 8, 10, 12, 15, 17], 20);

  // ── drift is a change, not a level ──
  ok(D(steady2).baselinePerWeek === 2 && D(steady2).recentPerWeek === 2, 'two a week, every week, measures as two a week');
  ok(D(steady2).status === 'on_track', 'a client who always trained twice a week is not drifting');
  ok(D(steady1).status === 'on_track', 'a client who always trained once a week is not drifting either');
  ok(D(fell4to1).baselinePerWeek === 4 && D(fell4to1).recentPerWeek === 1, 'four a week fell to one a week');
  ok(D(fell4to1).status === 'at_risk', 'four a week down to one a week IS drifting');
  ok(D(fell4to1).recentPerWeek === D(steady1).recentPerWeek && D(fell4to1).status !== D(steady1).status,
    'same rate today, different verdict — the break is what is ranked, not the level');
  ok(D(fell5to2).recentPerWeek! > D(steady1).recentPerWeek! && D(fell5to2).status === 'at_risk' && D(steady1).status === 'on_track',
    'still twice as active as a steady client, and still the one drifting');
  ok(D(steady2).drop === 0 && D(fell4to1).drop === 0.75, 'the drop is measured against their own baseline');

  // ── a client with NO DATA AT ALL is never "fine" ──
  ok(D(noData).unknown === true, 'no record at all cannot be assessed');
  ok(D(noData).status === 'idle', 'no record at all is UNKNOWN, never on track');
  ok(D(noData).status !== 'on_track', 'absence of evidence is not evidence of health');
  ok(D(noData).status !== 'at_risk', 'and UNKNOWN is distinct from at-risk too — we do not know');
  ok(DRIFT_LABEL[D(noData).status] === 'Unknown', 'and it prints as Unknown, not as a verdict about the person');
  ok(D(noData).reason.includes('Nothing recorded') && D(noData).reason.includes('40 days'), 'the reason says what is missing and for how long');
  ok(D(noData).kinds.length === 0, 'no check-ins, no logs, no visits, no sessions');

  // The older boolean version of this idea, which returned FALSE for a client
  // it had never seen a data point from. Pinned so it cannot regress.
  ok(noRecordOf({ adherence: null, lastActive: 'no activity yet' }) === true, 'a client with nothing recorded is recognised as such');
  ok(atRiskClient({ adherence: null, lastActive: 'no activity yet' }) === true,
    'a client with NO record does not read as fine — absence of evidence is not evidence of health');
  ok(atRiskClient({ adherence: 92, lastActive: '1d' }) === false, 'and a healthy, recently-active client still reads as fine');

  // ── no invented figures ──
  ok(D(noData).baselinePerWeek === null, 'a rate over an unobserved baseline is null, not 0');
  ok(D(noData).drop === null, 'a client with no baseline has no drop, not a drop of 0');
  ok(D(noData).lostPerWeek === null && D(noData).score === null, 'nothing derived from an empty set is reported as a number');
  ok(D(noData).quietDays === null, 'never seen is not "seen 0 days ago"');
  ok(D(noData).silentDays === 40, 'silence runs for as long as they have been on the book');
  ok(summariseDrift(null) === null, 'not read yet is not "nobody is drifting"');
  ok(summariseDrift([])!.drifting === 0 && summariseDrift([])!.total === 0, 'read and empty counts as zero of everything');

  // ── UNKNOWN must not be sorted to the bottom as if it were fine ──
  ok(DRIFT_RANK.idle === 1, 'unknown sorts second, under the measurably drifting');
  ok(DRIFT_RANK.idle < DRIFT_RANK.on_track && DRIFT_RANK.idle < DRIFT_RANK.watch, 'and above both watch and on-track');
  ok(STATUS_RANK.idle === 3 && DRIFT_RANK.idle !== STATUS_RANK.idle, 'deliberately unlike STATUS_RANK, which buries idle');
  ok(DRIFT_LABEL.at_risk === STATUS_LABEL.at_risk && DRIFT_LABEL.watch === STATUS_LABEL.watch && DRIFT_LABEL.on_track === STATUS_LABEL.on_track,
    'the three concern levels keep the product-wide words');

  const book = rankClients([steady2, steady1, fell4to1, noData, wentSilent, tooNew, noDataNew], NOW, DEFAULT_WINDOWS);
  const order = book.map((d) => d.clientId);
  const posOf = (id: string) => order.indexOf(id);
  ok(order[0] === 'wentSilent' && order[1] === 'fell4to1', 'the biggest break in a pattern leads the book');
  ok(posOf('noData') < posOf('steady2') && posOf('noData') < posOf('steady1'),
    'a client with no record at all sorts above a client holding their pattern');
  ok(posOf('noData') !== order.length - 1, 'a client with no record at all is never last');
  ok(posOf('noData') < posOf('noDataNew'), 'the longest silence leads the unknown band');
  ok(posOf('wentSilent') < posOf('noData') && posOf('fell4to1') < posOf('noData'),
    'but a measured break still outranks an unknown');
  ok(posOf('tooNew') < posOf('steady2'), 'a client too new to judge is also not filed under fine');
  ok(book.map((d) => DRIFT_RANK[d.status]).every((r, i, a) => i === 0 || a[i - 1] <= r), 'the book comes back in band order');
  ok(summariseDrift(book)!.unknown === 3 && summariseDrift(book)!.drifting === 2 && summariseDrift(book)!.steady === 2,
    'the band counts match the book');

  // ── the baseline is clamped to the client's own record ──
  ok(D(joined42).baselineSpanDays === 28, "the baseline stops where the client's record starts");
  ok(D(joined42).baselinePerWeek === 3, 'and the rate is over the days they were actually on the book');
  ok(D(joined42).status === 'at_risk', 'so a real fall is not diluted by a period they did not exist for');

  // ── too little record is UNKNOWN, not a verdict ──
  ok(D(tooNew).unknown === true && D(tooNew).status === 'idle', 'twenty days is not a pattern, however keen');
  ok(D(tooNew).baselinePerWeek === null, 'no baseline is claimed from a first impression');
  ok(D(tooNew).reason.includes('too little'), 'and it says so');

  // ── going silent off a real pattern is measured, not guessed ──
  ok(D(wentSilent).drop === 1 && D(wentSilent).recentPerWeek === 0, 'a client who stops has fallen the whole way');
  ok(D(wentSilent).quietDays === 15, 'and we know exactly how long it has been');
  ok(D(wentSilent).reason.includes('15 days') && D(wentSilent).reason.includes('3 days a week'), 'the reason carries both halves');

  // ── housekeeping ──
  const unsorted = [D(steady2), D(fell4to1), D(noData)];
  const sorted = sortByDrift(unsorted);
  ok(unsorted.map((d) => d.clientId).join(',') === 'steady2,fell4to1,noData', "sorting does not mutate the caller's array");
  ok(sorted[0].clientId === 'fell4to1', 'and it does sort');
  ok(compareDrift(D(noData), D(noData)) === 0, 'a client does not outrank themselves');
  ok(D({ clientId: 'junk', events: [{ at: 'not-a-date', kind: 'workout' }], since: at(56) }).unknown === true,
    'an unreadable timestamp is not a day of training');
}


// ── sending ONE progress photo to your coach ──
// The consent model, not the plumbing. 47-share-progress-photo.sql enforces all
// of this in RLS; viewerMaySee() is the same rule in TypeScript and is what the
// coach screen filters on, so breaking either shows up here.
{
  const COACH = 'coach-a', NEW_COACH = 'coach-b', ME = 'client-x', THEM = 'client-y';
  const mine = { id: 'p1', clientId: ME };
  const alsoMine = { id: 'p2', clientId: ME };
  const theirs = { id: 'p9', clientId: THEM };
  const grant = (photoId: string, clientId: string, coachId: string): ShareGrant =>
    ({ photoId, clientId, coachId, sharedAt: '2026-08-01T00:00:00.000Z' });
  const live: CoachLink[] = [{ clientId: ME, coachId: COACH, active: true }, { clientId: THEM, coachId: COACH, active: true }];
  const ended: CoachLink[] = [{ clientId: ME, coachId: COACH, active: false }];
  const sentP1 = [grant('p1', ME, COACH)];

  // ── the default is closed ──
  ok(viewerMaySee(COACH, mine, [], live) === false, 'a coach with no grant sees nothing, however linked');
  ok(viewerMaySee(COACH, mine, sentP1, live) === true, 'a coach sees the one photo that was sent to them');
  ok(viewerMaySee(COACH, theirs, sentP1, live) === false, 'and a grant is about ONE photo, not about a person');

  // ── per photo, never per account ──
  ok(viewerMaySee(COACH, alsoMine, sentP1, live) === false, 'sending one photo does not send the next one');

  // ── revocable: the grant IS the access ──
  ok(viewerMaySee(COACH, mine, [], live) === false, 'taking the photo back closes it again');

  // ── access ends when the coaching relationship does ──
  ok(viewerMaySee(COACH, mine, sentP1, ended) === false, 'a coach who is no longer the coach sees nothing, grant or no grant');
  ok(viewerMaySee(COACH, mine, sentP1, []) === false, 'and no recorded link at all is not a live one');
  ok(viewerMaySee(NEW_COACH, mine, sentP1, [{ clientId: ME, coachId: NEW_COACH, active: true }]) === false,
    'a new coach inherits nothing that was sent to the last one');

  // ── one member cannot read another member's shared photo ──
  ok(viewerMaySee(THEM, mine, sentP1, live) === false, 'another client cannot see a photo that was sent to a coach');
  ok(viewerMaySee(THEM, mine, [grant('p1', THEM, THEM)], [{ clientId: ME, coachId: THEM, active: true }]) === false,
    "a grant naming the wrong sender cannot unlock another member's photo");
  ok(viewerMaySee(ME, mine, [], []) === true, 'and you always see your own, shared or not');
  ok(viewerMaySee('', mine, sentP1, live) === false, 'nobody signed in sees nothing');

  // ── the client can always tell, and "we do not know" is an answer ──
  ok(shareStateOf('p1', null) === 'unknown', 'before the grants are read, whether the coach can see it is UNKNOWN');
  ok(shareStateOf('p1', []) === 'private', 'read and empty is private — a different fact from unknown');
  ok(shareStateOf('p1', sentP1) === 'sent', 'and a grant reads as sent');
  ok(shareLabel('unknown') === '—', 'unknown prints as an em-dash, never as the reassuring one');
  ok(shareLabel('private') === 'Only you' && shareLabel('sent') === 'Sent to coach', 'the two known states say which');
  ok(sharedCount(null) === null && sharedCount([]) === 0, 'not read is null; read and empty is zero');
  ok(sharedNote(null) === null, 'no summary line at all until the read lands');
  ok(sharedNote([]) === 'None sent', 'but "none sent" is stated, not left to be inferred from silence');
  ok(sharedNote(sentP1) === '1 sent to your coach', 'and the count is the count');

  // ── the send control refuses rather than lies ──
  const coach = { id: COACH, name: 'Sam' };
  const withFile = { id: 'p1', url: 'https://signed' };
  const noFile = { id: 'p2', url: null };
  ok(sendBlocker(withFile, coach, []) === null, 'a photo with a picture, and a linked coach, can be sent');
  ok(sendBlocker(withFile, coach, null) !== null, 'nothing is offered while the share list is unknown');
  ok(sendBlocker(withFile, null, null)!.includes('checking'),
    'an unknown list speaks BEFORE "you have no coach" — a failed read has not earned that claim');
  ok(sendBlocker(withFile, null, [])!.includes('coach linked'), 'once the list IS known, having no coach is said plainly');
  ok(sendBlocker(withFile, coach, sentP1) !== null, 'a photo already sent is not sent again');
  ok(sendBlocker(noFile, coach, []) !== null, 'and a row with no picture behind it is not sent as though it were one');

  // ── what the client screen lists as visible to the coach ──
  const shPh = (id: string): ProgressPhoto => ({ id, path: id + '.jpg', takenAt: '2026-01-01T00:00:00.000Z', url: 'u', weightKg: null, bodyFatPct: null });
  const strip = [shPh('p1'), shPh('p2')];
  ok(sentPhotos(null, sentP1) === null, 'no photo list, no answer');
  ok(sentPhotos(strip, null) === null, 'no grant list, no answer — and never an empty one, which would read as "none"');
  ok(sentPhotos(strip, [])!.length === 0, 'read and empty IS an empty answer, which is a different thing');
  ok(sentPhotos(strip, sentP1)!.map((p) => p.id).join(',') === 'p1', 'and it lists exactly what was sent');

  // ── the coach's strip ──
  const sh = (id: string, sharedAt: string, url: string | null): SharedPhoto =>
    ({ id, path: id + '.jpg', takenAt: '2026-01-01T00:00:00.000Z', sharedAt, url });
  const inbox = [sh('a', '2026-01-01T00:00:00.000Z', 'u'), sh('c', '2026-03-01T00:00:00.000Z', 'u'), sh('b', '2026-02-01T00:00:00.000Z', null)];
  const ordered = sortNewestShared(inbox);
  ok(ordered.map((p) => p.id).join(',') === 'c,b,a', 'the coach sees the most recently sent first');
  ok(inbox.map((p) => p.id).join(',') === 'a,c,b', "sorting does not mutate the caller's array");
  ok(missingSharedFiles(null) === null, 'nothing loaded is not "none missing"');
  ok(missingSharedFiles(ordered) === 1, 'and a grant whose file will not sign is counted, never hidden');

  // ── the one thing revocation cannot reach, pinned to the TTL that bounds it ──
  ok(SHARED_URL_TTL_S === 5 * 60, 'a coach URL lasts five minutes, so taking a photo back bites in minutes');
  ok(SHARED_URL_TTL_S < 60 * 60, 'and far less than the hour a member gets for their own photos');
  ok(revokeCaveat().includes('five minutes'), 'and the app says out loud how long an already-open link keeps working');
}

// ── month-end close ────────────────────────────────────────────────────────
//
// The close is the one screen whose most valuable output is the word "no", so
// most of what is pinned here is a refusal: a month with unmarked sessions must
// not read as closed, a failed read must not become a zero, and no figure may
// be estimated to fill a gap.
{
  // Mid-August 2026, local. June is therefore a finished month and August is not.
  const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime();
  const JUNE = monthWindow('2026-06') as MonthWindow;
  const AUG = monthWindow('2026-08') as MonthWindow;

  // ── the window ──
  ok(JUNE.label === 'June 2026', 'a month window is named in the gym\'s own words');
  ok(JUNE.firstDay === '2026-06-01' && JUNE.lastDay === '2026-06-30', 'June ends on the 30th');
  ok(monthWindow('2026-02')!.lastDay === '2026-02-28', 'February 2026 ends on the 28th');
  ok(monthWindow('2028-02')!.lastDay === '2028-02-29', 'and February 2028 on the 29th — no month-length table to get wrong');
  ok(monthWindow('2026-13') === null && monthWindow('June') === null, 'a key that is not a month opens nothing');
  ok(monthKeyOf(new Date(2026, 5, 30, 23, 30)) === '2026-06',
     'a late-evening moment belongs to the gym\'s own month, not to UTC\'s next one');
  ok(recentMonths(3, NOW).join(',') === '2026-08,2026-07,2026-06', 'the picker walks back from the running month');
  ok(monthEnded(JUNE, NOW) === true && monthEnded(AUG, NOW) === false, 'a month is over only once it is over');
  ok(inMonth(new Date(2026, 5, 1, 0, 0, 0).toISOString(), JUNE) === true, 'the first instant of the month is in it');
  ok(inMonth(new Date(2026, 6, 1, 0, 0, 0).toISOString(), JUNE) === false,
     'and the first instant of the next month is NOT — the boundary is exclusive, so nothing is counted twice');
  ok(inMonth(null, JUNE) === false && inMonth('not a date', JUNE) === false, 'an unparseable stamp is not silently in the month');
  ok(dayInMonth('2026-06-30', JUNE) === true && dayInMonth('2026-07-01', JUNE) === false, 'plain dates land in the right month');

  // ── narrowing a slice to a month keeps all three states ──
  const junePay = (id: string, cents: number, opts: Partial<GymPayment> = {}): GymPayment => ({
    id, memberId: 'm1', memberName: 'Sara', amountCents: cents, currency: 'AED',
    method: 'card', takenAt: new Date(2026, 5, 10, 9, 0).toISOString(), note: null, ...opts,
  });
  const julyPay = junePay('late', 999, { takenAt: new Date(2026, 6, 2, 9, 0).toISOString() });

  ok(sliceMonth(sliceLoading<GymPayment>(), JUNE, (p) => p.takenAt).state === 'loading',
     'narrowing a slice that has not arrived leaves it not-arrived');
  ok(sliceMonth(sliceFailed<GymPayment>('boom'), JUNE, (p) => p.takenAt).state === 'failed',
     'and narrowing a FAILED read leaves it failed — it never becomes an empty month');
  ok(rowsOf(sliceMonth(sliceReady([junePay('a', 100), julyPay]), JUNE, (p) => p.takenAt))!.length === 1,
     'a ready slice is filtered to the month');

  // ── what came in ──
  ok(incomeOf([]).takenCents === null,
     'a month with no payment recorded has UNKNOWN income, not zero — nobody entered anything');
  ok(incomeOf([]).count === 0, 'and it says so as a count of nothing');
  const mixed = incomeOf([junePay('a', 100), junePay('b', 200, { currency: 'GBP' })]);
  ok(mixed.takenCents === null && mixed.currencies.join(',') === 'AED,GBP',
     'dirhams plus pounds is not a sum, so no total is offered');
  const inc = incomeOf([
    junePay('a', 30000), junePay('b', 15000, { method: 'cash' }),
    junePay('c', 5000, { method: 'cash', memberId: null, memberName: null }),
  ]);
  ok(inc.takenCents === 50000 && inc.count === 3, 'what came in is the sum of what was recorded');
  ok(inc.byMethod[0].key === 'card' && inc.byMethod[0].cents === 30000,
     'and it is broken down by how it arrived, largest first');
  ok(inc.byMethod.find((l) => l.key === 'cash')!.cents === 20000, 'with the two cash payments added together');
  ok(inc.unattributed === 1 && inc.unattributedCents === 5000,
     'money with nobody\'s name on it is counted in the total and named separately, never hidden in it');

  // ── what it was for ──
  const mem = (memberId: string, startedOn: string, endsOn: string | null): Membership => ({
    id: 'ms-' + memberId, memberId, memberName: memberId, planId: 'p1', planName: 'Standard',
    startedOn, endsOn, status: 'active',
  });
  ok(purposeOf([junePay('a', 100)], null, JUNE) === null,
     'with no roster read, no payment is attributed — every payer would otherwise look like a non-member');
  const purpose = purposeOf(
    [junePay('a', 30000), junePay('b', 20000, { memberId: 'm9', memberName: 'Walk-in' })],
    [mem('m1', '2026-01-01', null)],
    JUNE,
  )!;
  ok(purpose.find((l) => l.key === 'membership')!.cents === 30000, 'a payer holding a membership is attributed to it');
  ok(purpose.find((l) => l.key === 'no_membership')!.cents === 20000, 'and one who does not is not quietly folded in');
  ok(purposeOf([junePay('a', 100)], [mem('m1', '2026-01-01', '2026-06-20')], JUNE)![0].key === 'membership',
     'a membership that ended mid-month was still a membership for the month being closed');
  ok(purposeOf([junePay('a', 100)], [mem('m1', '2026-01-01', '2026-05-31')], JUNE)![0].key === 'no_membership',
     'one that ended before it started was not');

  // ── what is still owed ──
  const inv = (id: string, cents: number, status: GymInvoice['status'], dueOn: string | null = null): GymInvoice => ({
    id, memberId: 'm1', memberName: 'Sara', amountCents: cents, currency: 'AED',
    issuedOn: '2026-06-01', dueOn, status, note: null,
  });
  const TODAY = '2026-08-15';
  ok(isOverdue(inv('x', 1, 'open', '2026-08-14'), TODAY) === true, 'an open invoice past its due date is overdue');
  ok(isOverdue(inv('x', 1, 'open', TODAY), TODAY) === false, 'an invoice due today is not late today');
  ok(isOverdue(inv('x', 1, 'open', null), TODAY) === false,
     'and one with no due date never is — the gym never said when it wanted the money');
  ok(isOverdue(inv('x', 1, 'paid', '2020-01-01'), TODAY) === false, 'a paid invoice is not overdue whatever its date');

  const empty = owedOf([], TODAY);
  ok(empty.settledCents === null && empty.outstandingCents === null && empty.droppedCents === null,
     'no invoices means unknown on every line, never a row of zeroes');
  const owed = owedOf([
    inv('i1', 50000, 'paid'), inv('i2', 20000, 'open', '2026-06-30'),
    inv('i3', 10000, 'open', null), inv('i4', 90000, 'draft'), inv('i5', 7000, 'written_off'),
  ], TODAY);
  ok(owed.settledCents === 50000 && owed.settled === 1, 'what the register says arrived');
  ok(owed.outstandingCents === 30000 && owed.outstanding === 2, 'what is still owed');
  ok(owed.overdueCents === 20000 && owed.overdue === 1, 'and how much of it is late');
  ok(owed.droppedCents === 7000, 'money written off is on its own line');
  ok(owed.settledCents! + owed.outstandingCents! === 80000,
     'the draft invoice is in neither — an invoice nobody sent is owed by nobody');

  // ── what does not reconcile ──
  const fmt = (c: number) => `AED ${(c / 100).toFixed(2)}`;
  ok(moneyCheck(null, owed, fmt) === null, 'no reconciliation is offered against a payments read that failed');
  ok(moneyCheck(inc, null, fmt) === null, 'nor against an invoice read that failed — a check over a failure looks like a finding');
  ok(moneyCheck(incomeOf([]), owedOf([], TODAY), fmt) === null,
     'two silences are not an agreement, so nothing is claimed');
  const agrees = moneyCheck(incomeOf([junePay('a', 50000)]), owedOf([inv('i1', 50500, 'paid')], TODAY), fmt)!;
  ok(agrees.r.state === 'agrees' && agrees.note === null,
     'inside the gym\'s existing 2% tolerance the two sides agree and the screen stays quiet');
  const differs = moneyCheck(incomeOf([junePay('a', 50000)]), owedOf([inv('i1', 60000, 'paid')], TODAY), fmt)!;
  ok(differs.r.state === 'differs' && differs.gapCents === 10000, 'outside it, the gap is measured');
  ok(differs.note!.includes('AED 100.00') && differs.note!.includes('has not arrived'),
     'and NAMED in the sentence rather than absorbed into either figure');
  const oneSided = moneyCheck(incomeOf([]), owedOf([inv('i1', 60000, 'paid')], TODAY), fmt)!;
  ok(oneSided.r.state === 'not_entered' && oneSided.note!.includes('not one payment was recorded'),
     'a register claiming money arrived that no payment shows is a gap, not a blank');

  // ── the close, end to end ──
  const sess = (id: string, outcome: PtSession['outcome'], rateCents: number | null = 20000): PtSession => ({
    id, trainerId: 't1', trainerName: 'Alex', clientId: 'm1', clientName: 'Sara',
    startsAt: new Date(2026, 5, 10, 9, 0).toISOString(), durationMin: 60,
    status: 'booked', outcome, outcomeAt: outcome ? '2026-06-10T10:00:00.000Z' : null,
    rateCents, settlementId: null,
  });
  const rec = (over: Partial<CloseRecord> = {}): CloseRecord => ({
    payments: sliceReady([junePay('a', 30000), junePay('b', 20000)]),
    invoices: sliceReady([inv('i1', 50000, 'paid')]),
    sessions: sliceReady([sess('s1', 'completed'), sess('s2', 'completed')]),
    memberships: sliceReady([mem('m1', '2026-01-01', null)]),
    passes: sliceReady([]),
    ...over,
  });
  const build = (r: CloseRecord, w: MonthWindow = JUNE) =>
    buildClose(r, w, { policy: PAY_DELIVERED_ONLY, fallbackRateCents: null, now: NOW, fmt });

  const clean = build(rec());
  ok(clean.state === 'closeable' && clean.blockers.length === 0,
     'a month whose sessions are all marked and whose money reconciles can be closed');
  ok(clean.income!.takenCents === 50000 && clean.payroll!.total.cents === 40000, 'and it reports both figures');
  ok(closeHeadline(clean).includes('reconciles'), 'the headline says the check actually ran');

  // THE refusal. Payroll is computed from delivered sessions, so a month with
  // an unmarked one is wrong by exactly that one and must not read as closed.
  const unmarked = build(rec({ sessions: sliceReady([sess('s1', 'completed'), sess('s2', null)]) }));
  ok(unmarked.state === 'blocked',
     'a month with an unmarked session must NOT be presentable as closed');
  const unmarkedBlock = unmarked.blockers.find((b) => b.kind === 'unmarked_sessions');
  ok(!!unmarkedBlock, 'and the reason is named as unmarked sessions, not left as a footnote');
  ok((unmarkedBlock?.text ?? '').startsWith('1 session'), 'the refusal says HOW MANY are unmarked');
  ok(unmarked.payroll!.total.unmarked === 1 && unmarked.payroll!.total.cents === 20000,
     'payroll is short by exactly the session nobody marked — 20000, not the 40000 a delivered month showed');
  ok(!closeHeadline(unmarked).includes('can be closed'),
     'and the headline never offers a close it is refusing');
  const many = build(rec({ sessions: sliceReady([sess('s1', null), sess('s2', null), sess('s3', 'completed')]) }));
  ok((many.blockers.find((b) => b.kind === 'unmarked_sessions')?.text ?? '').startsWith('2 sessions'),
     'two unmarked are counted as two');

  // A gym that does no personal training has nothing blocking its month, even
  // though payrollTotal reports it as unsettleable.
  const noPt = build(rec({ sessions: sliceReady([]) }));
  ok(noPt.payroll!.total.settleable === false, 'payrollTotal calls an empty period unsettleable');
  ok(noPt.blockers.every((b) => b.kind !== 'unmarked_sessions' && b.kind !== 'unpriced_sessions'),
     'but a gym with no one-to-ones has nothing unmarked and nothing unpriced');
  ok(noPt.state === 'closeable', 'so it can still close its month');

  // A payable session nobody priced is missing from the total, not free.
  const unpriced = build(rec({ sessions: sliceReady([sess('s1', 'completed', null)]) }));
  ok(unpriced.payroll!.total.cents === null, 'an unpriced payable session leaves the pay figure unknown, not zero');
  ok(!!unpriced.blockers.find((b) => b.kind === 'unpriced_sessions'), 'and that blocks the close too');

  // A failed read is never a zero.
  const brokenPay = build(rec({ payments: sliceFailed('connection reset') }));
  ok(brokenPay.income === null,
     'a month whose payments read failed has NO income figure — it is not a month with no income');
  ok(brokenPay.check === null, 'and nothing is reconciled against it');
  ok(!!brokenPay.blockers.find((b) => b.kind === 'read_failed'), 'the failed read itself blocks the close');
  ok(brokenPay.warning!.includes('what came in is unknown, not zero'),
     'and the banner names the half that failed and what the reader is therefore not seeing');
  ok(brokenCloseParts(rec({ payments: sliceFailed('connection reset') }))[0].reason === 'connection reset',
     'the broken part is reported by name, with the reason it broke');
  ok(loadingCloseParts(rec({ invoices: sliceLoading() })).join(',') === 'invoices', 'so is the one still in flight');
  ok(closeWarning(rec()) === null, 'a whole close carries no warning');
  ok(CLOSE_PARTS.every((p) => !!CLOSE_LABEL[p] && !!CLOSE_COST[p]),
     'every part of the close has a name and a stated cost when it cannot be read');

  // A month still running cannot be closed, whatever its numbers say.
  const running = build(rec({ sessions: sliceReady([]) }), AUG);
  ok(!!running.blockers.find((b) => b.kind === 'month_running'),
     'August cannot be closed in the middle of August');

  // A named money gap stops the month.
  const gap = build(rec({ invoices: sliceReady([inv('i1', 90000, 'paid')]) }));
  ok(!!gap.blockers.find((b) => b.kind === 'money_gap'), 'a gap between money taken and money billed blocks the close');

  // But having no invoice register at all is a stated limitation, not an error:
  // a cash-only gym must still be able to close.
  const cashOnly = build(rec({ invoices: sliceReady([]) }));
  ok(cashOnly.check!.r.state === 'no_record', 'with no invoice marked paid there is nothing to check against');
  ok(cashOnly.state === 'closeable', 'and a cash-only gym is not punished for it');
  ok(closeHeadline(cashOnly).includes('not checked against a second source'),
     'though the headline refuses to claim a reconciliation that never happened');

  // Arrears reach back past the month; the reconciliation does not.
  const old = { ...inv('old', 12000, 'open', '2026-05-30'), issuedOn: '2026-05-01' };
  const withArrears = build(rec({ invoices: sliceReady([inv('i1', 50000, 'paid'), old]) }));
  ok(withArrears.owed!.outstandingCents === null,
     'an invoice raised in May is not part of what June billed');
  ok(withArrears.arrears!.outstandingCents === 12000,
     'but it IS still money the gym is owed at the June close');
  ok(withArrears.state === 'closeable', 'and being owed money does not stop a month closing — it is a fact of it');

  // Payroll is the shared rule, not a second one.
  const pv = payrollOf([sess('s1', 'completed'), sess('s2', null)], PAY_DELIVERED_ONLY, null, NOW);
  ok(pv.blocker !== null && pv.blocker!.includes('outcome'), 'the payroll panel uses settlementBlocker\'s own words');
  ok(pv.lines[0].unmarked === 1 && pv.lines[0].delivered === 1, 'and payrollByTrainer\'s own counts');
}


// ── the long view: months and years, not weeks ──
//
// The screens that existed before this could show ten weeks. These assertions
// are about the three things that go wrong when you widen that to a year:
// inventing zeros for months nobody trained, smoothing a break into a trend,
// and drawing a year-shaped frame around three weeks of history.
{
  const at = (d: string) => `${d}T10:00:00`;               // local, so month bucketing is TZ-stable
  const NOW = Date.parse('2026-06-15T12:00:00');
  const lv: WorkoutEntry[] = [
    { t: at('2026-01-10'), exercise: 'Back Squat', sets: [[8, 50]], kcal: 300 },
    { t: at('2026-01-24'), exercise: 'Back Squat', sets: [[8, 55]] },
    { t: at('2026-02-14'), exercise: 'Back Squat', sets: [[8, 60]] },
    // March and April: nothing. This is the gap the whole module is about.
    { t: at('2026-05-06'), exercise: 'Back Squat', sets: [[8, 60]] },
    { t: at('2026-05-20'), exercise: 'Back Squat', sets: [[8, 70]] },
    { t: at('2026-06-02'), exercise: 'Back Squat', sets: [[5, 80]] },
  ];
  const cells = monthlyHistory(lv, NOW);

  // ── the window is the member's own, not a round number of months ──
  ok(cells.length === 6, 'the history runs first logged month → this month, and no further');
  ok(cells[0].key === '2026-01' && cells[5].key === '2026-06', 'oldest first, ending on the current month');
  ok(monthLabel(cells[0].key) === 'Jan 2026', 'a month key reads as a month');

  // ── a month with no training is a month with NO DATA ──
  const march = cells[2];
  ok(march.key === '2026-03' && march.trained === false, 'March is present in the window and untrained');
  ok(march.volumeKg === null, 'a month with no training reports NO volume — never 0 kg, which the app does not know');
  ok(march.sessions === null && march.days === null, 'and no session count either: nothing was counted, so nothing is claimed');
  ok(march.kcal === null && march.best1RM === null, 'every figure on an untrained month is null');
  ok(intensity(march, peakVolume(cells)) === null, 'and it shades as nothing, not as the lightest possible month');

  // ── a trained month reports what was actually lifted ──
  ok(cells[0].trained === true && cells[0].volumeKg === 840, 'January volume is Σ reps × weight');
  ok(cells[0].sessions === 2 && cells[0].days === 2, 'two sessions on two days');
  ok(cells[0].kcal === 300 && cells[1].kcal === null, 'kcal sums where it exists and stays null where nothing carried one');
  ok(cells[0].topLift === 'Back Squat', 'the month names the lift that carried it');
  ok(peakVolume(cells) === 1040 && bestMonth(cells)!.key === '2026-05', 'the best month is the heaviest month');
  ok(trainedMonths(cells).length === 4, 'four of the six months have training in them');

  // ── a month of pure cardio has sessions but no tonnage ──
  const cardio: WorkoutEntry[] = [{ t: at('2026-06-04'), exercise: 'Row', cardio: { mins: 30, dist: 6, unit: 'km' } }];
  const cCell = monthlyHistory(cardio, NOW)[0];
  ok(cCell.trained === true && cCell.sessions === 1, 'a cardio month is a trained month');
  ok(cCell.volumeKg === null && cCell.best1RM === null, 'but it lifted nothing, which is unknown tonnage — not zero tonnage');
  ok(lifetimeTotals(cardio)!.volumeKg === null, 'and the lifetime total says the same rather than totting up a zero');

  // ── the break stays visible, and is never closed off early ──
  const g = gaps(cells);
  ok(g.length === 1 && g[0].months === 2, 'two months with nothing logged between February and May');
  ok(g[0].afterKey === '2026-02' && g[0].returnKey === '2026-05', 'a gap names where it started and where they came back');
  ok(longestGap(cells)!.months === 2, 'and the longest one is reported');
  ok(monthsSinceLast(cells) === 0, 'the trailing silence is measured separately from the gaps');
  const stopped = monthlyHistory(lv.slice(0, 3), NOW);
  ok(gaps(stopped).length === 0, 'a member who simply stopped has no "gap" — nothing has closed it, and inventing an end would be a lie');
  ok(monthsSinceLast(stopped) === 4, 'that open silence is four months, and it is stated as that instead');

  // ── the shape of a year, with the months outside the history left absent ──
  const rows = yearRows(cells);
  ok(rows.length === 1 && rows[0].year === 2026 && rows[0].cells.length === 12, 'one row per calendar year, twelve slots');
  ok(rows[0].cells[0] !== null && rows[0].cells[2]!.trained === false, 'January has data; March is a real, empty month');
  ok(rows[0].cells[11] === null, 'December has not happened — it is absent from the year, not a month they failed to train');

  // ── then versus now ──
  const arc = volumeArc(cells)!;
  ok(arc.fromKey === '2026-01' && arc.toKey === '2026-06', 'the arc spans the first month with tonnage to the last');
  ok(arc.deltaKg === 400 - 840 && arc.pct === -52, 'and it reports a fall as honestly as a rise');
  ok(arc.months === 6, 'six calendar months end to end');
  ok(volumeArc(monthlyHistory(cardio, NOW)) === null, 'one month is a data point, not an arc');

  // ── personal bests over TIME, not just the current best ──
  const pr = prTimeline(lv);
  ok(pr.length === 5, 'five improvements: the equalled 60 kg in May is not a new record');
  ok(pr[0].prev === null, 'the first record on a lift beat nothing — prev is null, never 0');
  ok(pr[1].prev === pr[0].est1RM, 'and every later one names what it beat');
  ok(pr[0].at < pr[4].at && pr[4].est1RM === 93, 'oldest first, ending on the current best');

  // ── a short history is not a failed long one ──
  const fresh: WorkoutEntry[] = [
    { t: day(3), exercise: 'Bench Press', sets: [[8, 40]] },
    { t: day(1), exercise: 'Bench Press', sets: [[8, 42.5]] },
  ];
  const fCells = monthlyHistory(fresh);
  ok(stageOf(historySpan(fresh)) === 'starting', 'three weeks in reads as "starting", and the screen skips the year grid');
  ok(fCells.length <= 2, 'a member days old gets the months they have — not eleven blanks and one bar');
  ok(fCells[0].key === monthKey(day(3)), 'the window opens on their first session, never twelve months before it');
  ok(historyNote(fresh).startsWith('Day '), 'and it says how many days in, which is true and is not an apology');
  ok(stageOf(historySpan(lv, NOW)) === 'building', 'five months in is "building"');
  ok(historyNote(lv, NOW) === '4 months with training, back to Jan 2026.', 'the note counts only months actually trained');
  ok(stageOf(historySpan([{ t: at('2025-01-05'), exercise: 'X', sets: [[5, 60]] }], NOW)) === 'long', 'past six months the long view earns its frame');

  // ── nothing loaded, nothing claimed ──
  ok(monthlyHistory([], NOW).length === 0, 'an empty log produces no months at all');
  ok(historySpan([], NOW) === null && lifetimeTotals([]) === null, 'and no span and no totals — not a zeroed set of them');
  ok(stageOf(null) === 'empty' && prTimeline([]).length === 0, 'empty is its own stage');
  ok(yearRows([]).length === 0 && peakVolume([]) === null, 'no grid and no scale to draw one against');
  ok(tonnes(null) === null && tonnes(2760) === 2.8, 'unknown kilos never become 0.0 tonnes');

  // ── a corrupt row must not take the history down with it ──
  const bad = monthlyHistory([{ t: 'not a date', exercise: 'X', sets: [[8, 50]] }, ...lv], NOW);
  ok(bad.length === 6 && bad[0].key === '2026-01', 'an unparseable timestamp is skipped, not bucketed into some month');
  ok(monthKey('not a date') === null, 'and it is refused at the door');

  // ── the totals ──
  const life = lifetimeTotals(lv)!;
  ok(life.sessions === 6 && life.days === 6, 'six sessions across six days');
  ok(life.volumeKg === 840 + 480 + 1040 + 400, 'lifetime tonnage is the sum of the months that have one');
  ok(life.kcal === 300, 'and only the entries that actually carried calories');
  ok(life.lifts === 1 && life.firstAt === at('2026-01-10'), 'one lift, first logged in January');
}


// ── the gym's own export (gymExport.ts) ──
//
// The sibling of gdpr.ts, one tenant up. Everything here is pointed at the two
// ways an export lies: a failed read that becomes an empty file, and a value
// that changes shape on the way out.
{
  const plansIn: MembershipPlan[] = [
    { id: 'pl1', name: 'Monthly, full access', priceCents: 45000, currency: 'AED', interval: 'month', active: true },
    { id: 'pl2', name: 'Day pass', priceCents: 5, currency: 'AED', interval: 'once', active: false },
  ];
  // Names chosen to break a naive writer: an inner quote, a comma, an
  // apostrophe. A gym really does have these members.
  const msIn: Membership[] = [
    { id: 'ms1', memberId: 'u1', memberName: '"Bob" Smith', planId: 'pl1', planName: 'Monthly, full access', startedOn: '2026-01-05', endsOn: null, status: 'active' },
    { id: 'ms2', memberId: 'u2', memberName: "O'Brien, Sean", planId: null, planName: null, startedOn: '2025-11-30', endsOn: '2026-11-29', status: 'frozen' },
    { id: 'ms3', memberId: 'u1', memberName: '"Bob" Smith', planId: 'pl2', planName: 'Day pass', startedOn: '2024-02-02', endsOn: '2024-02-03', status: 'cancelled' },
  ];
  const payIn: GymPayment[] = [
    { id: 'pay1', memberId: 'u1', memberName: '"Bob" Smith', amountCents: 45000, currency: 'AED', method: 'card', takenAt: '2026-08-02T09:14:00.000Z', note: 'Renewal; said "thanks"\nsecond line of the note' },
    { id: 'pay2', memberId: 'u2', memberName: "O'Brien, Sean", amountCents: 5, currency: 'AED', method: 'cash', takenAt: '2026-07-01T00:00:00.000Z', note: null },
    { id: 'pay3', memberId: null, memberName: null, amountCents: 1250, currency: 'AED', method: 'other', takenAt: '2026-06-01T00:00:00.000Z', note: 'walk-in, till float' },
  ];
  const clsIn: GymClass[] = [
    { id: 'c1', title: 'Spin, 45min', room: 'Studio 2', instructor: null, trainerId: 't1', startsAt: '2026-08-01T06:00:00.000Z', durationMin: 45, capacity: 20, booked: 2, attended: 1 },
  ];
  const bkIn: MemberBooking[] = [
    { bookingId: 'b1', memberId: 'u1', classId: 'c1', classTitle: 'Spin, 45min', startsAt: '2026-08-01T06:00:00.000Z', status: 'booked', attendedAt: '2026-08-01T06:03:00.000Z' },
    { bookingId: 'b2', memberId: 'u2', classId: 'c1', classTitle: 'Spin, 45min', startsAt: '2026-08-01T06:00:00.000Z', status: 'booked', attendedAt: null },
  ];
  const sessIn: PtSession[] = [
    { id: 's1', trainerId: 't1', trainerName: 'Dana', clientId: 'u1', clientName: '"Bob" Smith', startsAt: '2026-08-03T10:00:00.000Z', durationMin: 60, status: 'booked', outcome: 'completed', outcomeAt: '2026-08-03T11:00:00.000Z', rateCents: 20000, settlementId: null },
    { id: 's2', trainerId: 't1', trainerName: 'Dana', clientId: 'u2', clientName: "O'Brien, Sean", startsAt: '2026-08-04T10:00:00.000Z', durationMin: 60, status: 'booked', outcome: null, outcomeAt: null, rateCents: null, settlementId: null },
  ];
  const ptIn: PassType[] = [
    { id: 'pt1', name: 'Guest pass', kind: 'guest', priceCents: 0, currency: 'AED', uses: 1, validDays: null, active: true },
  ];
  const passIn: GymPass[] = [
    { id: 'gp1', passTypeId: 'pt1', passTypeName: 'Guest pass', kind: 'guest', holderId: null, holderName: 'Walk-in', hostMemberId: 'u1', issuedOn: '2026-08-01', expiresOn: null, usesTotal: 1, usesSpent: 0, paidCents: null, currency: 'AED', note: null },
  ];
  const visIn: Visit[] = [
    { id: 'v1', memberId: 'u1', memberName: '"Bob" Smith', passId: null, classId: 'c1', enteredAt: '2026-08-01T05:52:00.000Z', exitedAt: null, source: 'door', note: 'tailgated; spoke to them' },
  ];
  const invIn: MemberInvite[] = [
    { id: 'iv1', tenantId: 'T', email: 'bob@example.com', fullName: '"Bob" Smith', planId: 'pl1', planName: 'Monthly, full access', invitedBy: 'o1', token: 'SECRET-JOIN-TOKEN', status: 'accepted', createdAt: '2025-12-20T00:00:00.000Z', expiresAt: '2026-01-19T00:00:00.000Z', acceptedAt: '2026-01-05T00:00:00.000Z', acceptedBy: 'u1' },
  ];

  const whole: GymExportInput = {
    gymName: 'Iron House Dubai', tenantId: 'T', generatedAt: '2026-08-26T08:00:00.000Z',
    from: '1970-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z',
    plans: sliceReady(plansIn), memberships: sliceReady(msIn), payments: sliceReady(payIn),
    classes: sliceReady(clsIn), attendance: sliceReady(bkIn), sessions: sliceReady(sessIn),
    passTypes: sliceReady(ptIn), passes: sliceReady(passIn), visits: sliceReady(visIn),
    invites: sliceReady(invIn),
  };

  // ── escaping: the assertion the whole file stands on ──
  // Get this wrong and every column after the offending one shifts, silently,
  // for as long as the file exists.
  ok(csvCell('"Bob" Smith') === '"""Bob"" Smith"', 'a quote inside a name is doubled AND the field is quoted');
  ok(csvCell('Smith, Jr.') === '"Smith, Jr."', 'a comma inside a name is quoted');
  ok(csvCell("O'Brien") === "O'Brien", 'an apostrophe needs no quoting and gains none');
  ok(csvCell('line one\nline two') === '"line one\nline two"', 'a note with a line break is quoted, not truncated');
  ok(csvCell('a\r\nb') === '"a\r\nb"', 'a CRLF inside a field is quoted whole');
  ok(csvCell('Paid cash; owes 20') === '"Paid cash; owes 20"', 'a semicolon is quoted too — sniffDelimiter would vote for it otherwise');
  ok(csvCell('a\tb') === '"a\tb"' && csvCell('a|b') === '"a|b"', 'tab and pipe are quoted for the same reason');
  ok(csvCell(' Sara ') === '" Sara "', 'whitespace somebody typed is preserved by quoting, not trimmed away');
  ok(csvCell(null) === '' && csvCell(undefined) === '', 'a null becomes empty — never "null"');
  ok(csvCell(0) === '0', 'and a real zero still becomes zero: missing and none are different facts');
  ok(csvCell(false) === 'no' && csvCell(true) === 'yes', 'booleans leave as words the CSV importer reads back');
  ok(csvCell(NaN) === '' && csvCell(Infinity) === '', 'NaN is not a figure and is never laundered into a money column');
  ok(csvRow(['a', null, 'b,c']) === 'a,,"b,c"', 'a row keeps its empty cell in place');

  // ── and it survives the repo's own reader ──
  const nasty = toCsv(['name', 'note'], [['"Bob" Smith', 'Paid cash; owes 20\nchase Monday'], ['Smith, Jr.', null]]);
  const back = parseSheet(nasty);
  ok(back.delimiter === ',', 'the header decides the delimiter, and a semicolon in the data does not get a vote');
  ok(back.header.join('|') === 'name|note', 'the BOM does not become part of the first header name');
  ok(back.rows.length === 2, 'a note containing a newline is one row, not two');
  ok(back.rows[0][0] === '"Bob" Smith', 'the quotes come back exactly as they went in');
  ok(back.rows[0][1] === 'Paid cash; owes 20\nchase Monday', 'and so does the line break');
  ok(back.rows[1][0] === 'Smith, Jr.' && back.rows[1][1] === '', 'the comma name did not shift the column after it');

  // ── money and dates leave as they are stored ──
  ok(minorToDecimal(45000) === '450.00', 'minor units become an exact decimal');
  ok(minorToDecimal(5) === '0.05', 'five fils is 0.05, not 5.00');
  ok(minorToDecimal(0) === '0.00', 'a genuine zero is 0.00');
  ok(minorToDecimal(-450) === '-4.50', 'a negative keeps its sign');
  ok(minorToDecimal(123456789) === '1234567.89', 'and a large figure does not go near a float');
  ok(minorToDecimal(null) === '', 'no recorded price is empty — a pass with no price is not a free pass');
  ok(parseMoneyCents(minorToDecimal(45000)).ok && (parseMoneyCents(minorToDecimal(45000)) as any).value === 45000, 'the importer reads back the same integer');
  ok((parseMoneyCents(minorToDecimal(5)) as any).value === 5, 'including the awkward sub-unit one');
  ok(isoDatePart('2026-08-02T09:14:00.000Z') === '2026-08-02', 'the date-only column is the day part of the stored timestamp');
  ok(isoDatePart(null) === '' && isoDatePart('not a date') === '', 'and anything unreadable is empty rather than guessed');

  // ── a whole bundle ──
  const wx = buildGymExport(whole);
  ok(wx.complete === true, 'every part read means a complete bundle');
  ok(exportBlocker(whole) === null, 'and nothing blocks the download');
  ok(wx.missing.length === 0 && incompleteWarning(wx.missing) === null, 'a complete bundle carries no warning');
  ok(wx.prefix === 'repple-export-iron-house-dubai-2026-08-26', 'the filename stem names the gym and the day');
  ok(!wx.files.some((f) => f.name.includes('INCOMPLETE')), 'and no file claims to be incomplete');
  ok(wx.files.filter((f) => f.name.endsWith('.csv')).length === EXPORT_PARTS.length, 'one CSV per part of the record');
  ok(wx.files.length === EXPORT_PARTS.length + 2, 'plus the manifest and the README');
  ok(wx.files.every((f) => f.name.startsWith(wx.prefix + '-')), 'every file carries the bundle stem, so a Downloads folder stays sortable');
  ok(wx.manifest.complete === true && wx.manifest.warning === null, 'the manifest says so too');
  ok(wx.manifest.parts.every((p) => p.status === 'exported'), 'and no part is marked unavailable');
  ok(wx.files.find((f) => f.name.endsWith('README.txt'))!.text.startsWith('This bundle is complete'), 'the README opens by saying it is whole');

  const fileFor = (b: typeof wx, base: string) => b.files.find((f) => f.name.endsWith(base));
  const sheetFor = (b: typeof wx, base: string) => parseSheet(fileFor(b, base)!.text);

  // ── members.csv round-trips through previewMembers ──
  const membersCsv = fileFor(wx, 'members.csv')!.text;
  const mp = previewMembers(membersCsv);
  ok(mp.missingRequired.length === 0, 'the exporter writes the header previewMembers requires');
  ok(mp.unmatchedColumns.join(',') === 'member_id', 'only the id column is unrecognised, and it is reported rather than dropped');
  ok(mp.rows.length === 2 && mp.ready.length === 2, 'one row per member, both readable — the second membership for u1 did not become a second person');
  ok(mp.rejected.length === 0, 'and nothing was refused');
  // Optional chaining rather than `!` throughout: a mutation that breaks the
  // escaping makes these rows unfindable, and the suite has to report the named
  // assertion that caught it rather than dying on a TypeError.
  const bob = mp.ready.find((m) => m.name === '"Bob" Smith') ?? null;
  ok(bob !== null, 'the quoted name survived export and re-import intact');
  ok(bob?.status === 'active' && bob?.plan === 'Monthly, full access', 'the live membership won over the older cancelled one');
  ok(bob?.startedOn === '2026-01-05' && bob?.endsOn === null, 'an absent end date came back as null, not as a date');
  ok(bob?.email === 'bob@example.com', 'and the address the gym recorded on the invite came with them');
  const sean = mp.ready.find((m) => m.name === "O'Brien, Sean") ?? null;
  ok(sean !== null, 'the comma name survived too');
  ok(sean?.status === 'frozen', 'and did not shift the status column');
  ok(sean?.plan === null && sean?.email === null, 'no plan and no invite stay null — not "" dressed up as a value');

  // ── payments.csv round-trips through previewPayments ──
  const payCsv = fileFor(wx, 'payments.csv')!.text;
  const pp = previewPayments(payCsv);
  ok(pp.missingRequired.length === 0, 'the exporter writes the amount and date columns previewPayments requires');
  ok(pp.rows.length === 3 && pp.ready.length === 2, 'two attributed payments import; the unattributed one is refused');
  ok(pp.ready[0].amountCents === 45000, 'the money came back as the same integer minor units');
  ok(pp.ready[1].amountCents === 5, 'including the five-fils one');
  ok(pp.ready[0].takenOn === '2026-08-02', 'the date column is readable where the raw timestamp would not have been');
  ok(pp.ready[0].note === 'Renewal; said "thanks"\nsecond line of the note', 'a note with a semicolon, a quote AND a newline survived the whole trip');
  ok(pp.ready[0].method === 'card' && pp.ready[1].method === 'cash', 'the method column did not shift');
  ok(pp.rejected[0].errors.some((e) => e.includes('cannot be attributed')), 'and the unattributed payment is refused loudly rather than assigned to somebody');
  ok(sheetFor(wx, 'payments.csv').rows[0][8] === '45000', 'the authoritative amount_cents column is the stored integer itself');

  // ── plans.csv round-trips through previewPlans ──
  const pl = previewPlans(fileFor(wx, 'plans.csv')!.text);
  ok(pl.missingRequired.length === 0 && pl.ready.length === 2, 'both plans import');
  ok(pl.ready[0].priceCents === 45000 && pl.ready[0].interval === 'month', 'price and billing period survive');
  ok(pl.ready[0].name === 'Monthly, full access', 'and a comma in a plan name does not split it');
  ok(pl.ready[1].priceCents === 5 && pl.ready[1].interval === 'once', 'the one-off day pass keeps both');
  ok(pl.ready[0].active === true && pl.ready[1].active === false, 'a retired plan comes back retired, not back on sale');

  // ── a null must never arrive as a zero ──
  const passSheet = sheetFor(wx, 'passes.csv');
  ok(passSheet.header.indexOf('paid_cents') > 0 && passSheet.rows[0][passSheet.header.indexOf('paid_cents')] === '', 'a pass with no recorded price exports empty, never 0');
  ok(passSheet.rows[0][passSheet.header.indexOf('paid')] === '', 'and its decimal column is empty too');
  ok(passSheet.rows[0][passSheet.header.indexOf('expires_on')] === '', 'a pass that does not expire has an empty expiry, not a date');
  ok(!passSheet.header.includes('uses_left'), 'no clamped "uses left" column — a counter out of step is evidence, not something to hide');
  const sessSheet = sheetFor(wx, 'sessions.csv');
  ok(sessSheet.rows[1][sessSheet.header.indexOf('outcome')] === '', 'a session nobody has marked exports empty — it is not a no-show');
  ok(sessSheet.rows[1][sessSheet.header.indexOf('rate_cents')] === '', 'and an unrecorded rate is not zero either');
  ok(sessSheet.rows[0][sessSheet.header.indexOf('rate_cents')] === '20000', 'while a recorded rate is the exact stored integer');
  const visSheet = sheetFor(wx, 'door-log.csv');
  ok(visSheet.rows[0][visSheet.header.indexOf('exited_at')] === '', 'somebody still inside has an empty exit, not a zero-minute visit');
  const attSheet = sheetFor(wx, 'attendance.csv');
  ok(attSheet.rows[1][attSheet.header.indexOf('attended_at')] === '', 'and a booking nobody ticked off is empty, which is not the same as absent');

  // ── the invite token is a live credential and does not leave ──
  const invSheet = sheetFor(wx, 'invites.csv');
  ok(!invSheet.header.includes('token'), 'the export carries no invite token column');
  ok(!fileFor(wx, 'invites.csv')!.text.includes('SECRET-JOIN-TOKEN'), 'and the token itself appears nowhere in the file');

  // ── a partial export must be unmistakable ──
  const brokenDoor: GymExportInput = { ...whole, visits: sliceFailed('permission denied for table gym_visits') };
  const bx = buildGymExport(brokenDoor);
  ok(bx.complete === false, 'one failed read means the bundle is not complete');
  ok(bx.prefix.endsWith('-INCOMPLETE'), 'the filename stem says so');
  ok(bx.files.every((f) => f.name.includes('INCOMPLETE')), 'and EVERY file in the bundle carries it, so no single file can be mistaken for a whole record');
  ok(!bx.files.some((f) => f.name.endsWith('door-log.csv')), 'the failed part produces NO CSV at all — an empty one would claim nobody came through the door');
  ok(bx.files.filter((f) => f.name.endsWith('.csv')).length === EXPORT_PARTS.length - 1, 'exactly one CSV is absent');
  const stub = bx.files.find((f) => f.placeholder)!;
  ok(stub.name.endsWith('door-log-NOT-EXPORTED.txt'), 'a plainly-named stub stands where the file should have been');
  ok(stub.text.includes('permission denied for table gym_visits'), 'and it carries the actual reason, not a shrug');
  ok(stub.text.includes('came through the door and when'), 'said in terms of what the gym is missing, not which query failed');
  ok(bx.manifest.complete === false && bx.manifest.warning!.includes('THIS EXPORT IS NOT YOUR WHOLE RECORD'), 'the manifest refuses to call it complete');
  ok(bx.manifest.parts.find((p) => p.part === 'visits')!.status === 'unavailable', 'and names the part as unavailable rather than empty');
  ok(bx.manifest.parts.find((p) => p.part === 'visits')!.rows === null, 'with a null row count, never 0');
  const readme = bx.files.find((f) => f.name.endsWith('README.txt'))!;
  ok(readme.text.startsWith('!'), 'the README opens with the warning rather than burying it');
  ok(readme.text.includes('the door log') && readme.text.includes(stub.name), 'and points at the stub by name');

  // ── loading is not the same as failed, and blocks the download ──
  const stillReading: GymExportInput = { ...whole, payments: sliceLoading() };
  ok(exportBlocker(stillReading) !== null, 'an export cannot be taken while a read is in flight');
  ok(exportBlocker(stillReading)!.includes('payments'), 'and it says which one');
  const lx = buildGymExport(stillReading);
  ok(lx.complete === false, 'a bundle built anyway is still not complete');
  ok(!lx.files.some((f) => f.name.endsWith('payments.csv')), 'and still refuses to write an empty payments.csv');
  ok(lx.missing[0].reason.includes('still loading'), 'the reason distinguishes it from a read that failed');

  // ── an empty gym is a different fact from a broken one ──
  const emptyGym: GymExportInput = {
    ...whole,
    plans: sliceReady([]), memberships: sliceReady([]), payments: sliceReady([]),
    classes: sliceReady([]), attendance: sliceReady([]), sessions: sliceReady([]),
    passTypes: sliceReady([]), passes: sliceReady([]), visits: sliceReady([]), invites: sliceReady([]),
  };
  const ex = buildGymExport(emptyGym);
  ok(ex.complete === true, 'a gym that has recorded nothing still gets a complete export');
  ok(ex.files.filter((f) => f.name.endsWith('.csv')).length === EXPORT_PARTS.length, 'with every file present');
  ok(parseSheet(fileFor(ex, 'payments.csv')!.text).rows.length === 0, 'header only, no rows');
  ok(parseSheet(fileFor(ex, 'payments.csv')!.text).header.length > 0, 'and the header still names the columns, so the shape is knowable');

  // ── an address the gym does not hold must not read as "no address" ──
  const noInvites: GymExportInput = { ...whole, invites: sliceFailed('relation "member_invites" does not exist') };
  const nx = buildGymExport(noInvites);
  const nHeader = sheetFor(nx, 'members.csv').header;
  ok(!nHeader.includes('email'), 'with the invites read gone the email COLUMN is dropped, because a blank one would read as "this member has no email"');
  ok(nHeader.join(',') === 'name,plan,started,ends,status,member_id', 'and the rest of the roster is still there');
  ok(previewMembers(fileFor(nx, 'members.csv')!.text).ready.length === 2, 'still re-importable without it — previewMembers only requires a name');
  ok(nx.caveats.some((c) => c.includes('email')), 'and the bundle says out loud why the column is absent');

  // ── the stem stays usable when the gym's own name did not read ──
  const unnamed = buildGymExport({ ...whole, gymName: null });
  ok(unnamed.prefix === 'repple-export-2026-08-26', 'no gym name means no gym name in the filename — not the word "null"');
  ok(slug('Iron House, Dubai!') === 'iron-house-dubai' && slug(null) === '', 'the slug drops punctuation and refuses to invent one');
  ok(EXPORT_FILE.visits === 'door-log.csv', 'the door log is named for what an owner calls it');
}

// ── the staff view: a trainer with no data must never read as fine ──────────
//
// The whole point of staffView.ts. `trainerHealth` scores on bookings whose
// clock has passed, so a trainer with six clients and twenty sessions that
// NOBODY MARKED comes back "ok" — healthy, green, sorted in among the people
// actually delivering. That trainer is simultaneously the one whose pay cannot
// be computed. The assertions below hold the gate that stops it.
{
  const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const DAY_MS = 86_400_000;
  const at = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
  const span = (daysAgo: number, hours: number) => ({
    startsAt: at(daysAgo),
    endsAt: new Date(NOW - daysAgo * DAY_MS + hours * 3_600_000).toISOString(),
  });

  const tr = (id: string, name: string, sinceDaysAgo: number | null): StaffTrainer =>
    ({ trainerId: id, name, since: sinceDaysAgo == null ? null : at(sinceDaysAgo) });

  const sess = (
    id: string, trainerId: string, daysAgo: number,
    outcome: PtSession['outcome'], rateCents: number | null, settlementId: string | null = null,
  ): PtSession => ({
    id, trainerId, trainerName: trainerId, clientId: null, clientName: null,
    startsAt: at(daysAgo), durationMin: 60, status: 'booked',
    outcome, outcomeAt: outcome ? at(daysAgo) : null, rateCents, settlementId,
  });

  const shift = (id: string, trainerId: string, daysAgo: number, hours: number, status: 'scheduled' | 'cancelled' = 'scheduled'): Shift => ({
    id, trainerId, trainerName: trainerId, ...span(daysAgo, hours),
    role: 'pt', status, note: null,
  });

  const cl = (clientId: string, trainerId: string | null): StaffClient =>
    ({ clientId, name: clientId, trainerId, since: at(200) });

  // ── the roster ──
  const trainers: StaffTrainer[] = [
    tr('omar', 'Omar', 300),    // delivering, and paid for it
    tr('dana', 'Dana', 300),    // six clients, twenty sessions, NOT ONE MARKED
    tr('rae', 'Rae', 3),        // hired on Friday
    tr('nadia', 'Nadia', 300),  // four clients and nothing delivered in 30 days
    tr('sol', 'Sol', 300),      // nothing on record at all
  ];

  const clients: StaffClient[] = [
    ...['c1', 'c2', 'c3', 'c4', 'c5'].map((c) => cl(c, 'omar')),
    ...['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((c) => cl(c, 'dana')),
    cl('r1', 'rae'), cl('r2', 'rae'),
    ...['n1', 'n2', 'n3', 'n4'].map((c) => cl(c, 'nadia')),
    cl('u1', null),   // on nobody's book — a real state, not a rounding error
  ];

  const sessions: PtSession[] = [
    // Omar: six delivered and unsettled, one already paid, one delivered with
    // no rate anybody snapshotted, one no-show.
    ...[1, 2, 3, 4, 5, 6].map((n) => sess(`o${n}`, 'omar', n, 'completed', 20_000)),
    sess('o7', 'omar', 7, 'completed', 20_000, 'run-1'),
    sess('o8', 'omar', 8, 'completed', null),
    sess('o9', 'omar', 9, 'no_show', 20_000),
    // Dana: twenty finished sessions, no outcome on any of them, plus one
    // booked for next week which nobody is late marking.
    ...Array.from({ length: 20 }, (_, i) => sess(`dn${i}`, 'dana', i + 1, null, 20_000)),
    sess('dnext', 'dana', -6, null, 20_000),
    // Somebody who is not on the roster at all, and is owed for it.
    sess('g1', 'ghost', 4, 'completed', 20_000),
    sess('g2', 'ghost', 5, 'completed', 20_000),
  ];

  const shifts: Shift[] = [
    shift('s-omar', 'omar', 2, 10),
    shift('s-dana', 'dana', 2, 8),
    shift('s-rae', 'rae', 2, 6, 'cancelled'),   // pulled, so it is not cover
  ];

  const classes: DemandBlock[] = [
    { kind: 'class', label: 'Conditioning', startsAt: at(3), durationMin: 60, trainerId: 'omar' },
  ];

  // c1 holds a steady pattern, c2 has gone silent off a real one, c3–c5 have
  // nothing recorded at all. Everyone else's book is silent.
  const acts = (offsets: number[]): ActivityEvent[] => offsets.map((n) => ({ at: at(n), kind: 'workout' as const }));
  const activity: ClientActivity[] = clients.map((c) => ({
    clientId: c.clientId,
    events:
      c.clientId === 'c1' ? acts([3, 10, 17, 24, 31, 38, 45, 52])
      : c.clientId === 'c2' ? acts([15, 17, 19, 22, 24, 26, 29, 31, 33, 36, 38, 40, 43, 45, 47, 50, 52, 54])
      : [],
  }));

  const whole: StaffRecord = {
    trainers: sliceReady(trainers),
    sessions: sliceReady(sessions),
    shifts: sliceReady(shifts),
    clients: sliceReady(clients),
    activity: sliceReady(activity),
    classes: sliceReady(classes),
  };
  const build = (rec: StaffRecord) => buildStaff(rec, {
    policy: PAY_DELIVERED_ONLY, fallbackRateCents: null, now: NOW, windowDays: 30,
  });

  const v = build(whole);
  const by = (id: string) => v.members!.find((m) => m.trainerId === id)!;
  const order = v.members!.map((m) => m.trainerId);
  const posOf = (id: string) => order.indexOf(id);

  // ── THE TRAP ──
  //
  // First, prove the bug is real and would have been reproduced by the obvious
  // implementation: hand ownerAnalytics the booked count, as GymTrainer would,
  // and it calls Dana healthy.
  ok(trainerHealth({ id: 'dana', name: 'Dana', clients: 6, sessions30: 20 }).risk === 'ok',
    'scored on bookings alone, twenty unmarked sessions read as a healthy trainer — this is the bug');
  ok(by('dana').status === 'idle' && by('dana').unknown === true,
    'the staff view refuses that: twenty sessions nobody marked is UNKNOWN, not healthy');
  ok(by('dana').status !== 'on_track', 'a trainer with no evidence never comes back on_track');
  ok(by('dana').delivered === 0 && by('dana').unmarked === 20,
    'because not one of them is confirmed delivered');
  ok(by('dana').reason.includes('20 one-to-ones finished') && by('dana').reason.includes('not one has an outcome recorded'),
    'and the reason says exactly which kind of nothing it is looking at');
  ok(by('dana').reason.includes('no pay can be computed'),
    'naming the consequence an owner acts on, not the query that came back thin');
  ok(by('dana').upcoming === 1,
    'a session booked for next week is not one anybody is late marking, and is counted apart');
  ok(by('dana').deliveredHours === null,
    'with nothing marked, delivered hours are unknown — 0h would assert they delivered nothing');
  ok(by('dana').floorUse === null && by('dana').rosteredHours === 8,
    'so no share of their rostered hours is claimed either, though the rota itself is known');
  ok(by('dana').settleable === false && by('dana').settleBlocker!.includes('unfinished period'),
    'and nothing about them can be settled');

  // ── the other three ways a person ends up unknown ──
  ok(by('rae').unknown === true && by('rae').reason.includes('On the books 3 days'),
    'somebody hired on Friday is not failing to deliver');
  ok(by('rae').clients === 2 && by('rae').sessions === 0, 'even carrying clients already');
  ok(NEW_TRAINER_DAYS === 14, 'and the grace period is stated rather than buried in a branch');
  ok(by('sol').unknown === true && by('sol').reason.includes('Nothing to assess'),
    'a trainer with no clients and no sessions is nothing to assess');
  ok(by('sol').reason.includes('not the same as nothing wrong'), 'said so out loud');

  // ── evidence, when there is some, is ownerAnalytics\' own verdict ──
  ok(by('nadia').status === 'at_risk' && by('nadia').unknown === false,
    'four clients and nothing delivered in thirty days IS a judgement the record supports');
  ok(by('nadia').reason === trainerHealth({ id: '', name: 'Nadia', clients: 4, sessions30: 0 }).reason,
    "and it is ownerAnalytics' own sentence, printed verbatim rather than reworded");
  ok(by('omar').status === 'on_track' && by('omar').unknown === false, 'Omar is the one person here who is fine');

  // ── ordering: unknown is never filed under fine ──
  ok(STAFF_RANK.idle === 1, 'unknown sorts second, directly under the trainers who need attention');
  ok(STAFF_RANK.idle < STAFF_RANK.on_track && STAFF_RANK.idle < STAFF_RANK.watch, 'above both watch and on-track');
  ok(STATUS_RANK.idle === 3 && STAFF_RANK.idle !== STATUS_RANK.idle,
    'deliberately unlike STATUS_RANK, which buries idle for the Overview glance');
  ok(STAFF_RANK.idle === DRIFT_RANK.idle, 'and it is the same deviation clientDrift already makes, not a third scale');
  ok(STAFF_STATUS_LABEL.idle === 'Unknown', '"Idle" is a verdict on a colleague; "Unknown" is the truth');
  ok(STAFF_STATUS_LABEL.at_risk === STATUS_LABEL.at_risk && STAFF_STATUS_LABEL.on_track === STATUS_LABEL.on_track,
    'the three concern levels keep the product-wide words');
  ok(order[0] === 'nadia', 'the trainer the record can actually fault leads the list');
  ok(posOf('dana') < posOf('omar') && posOf('rae') < posOf('omar') && posOf('sol') < posOf('omar'),
    'every unassessable trainer sorts above the one who is demonstrably fine');
  ok(posOf('omar') === order.length - 1, 'so the only healthy row is the last row');
  ok(posOf('dana') < posOf('rae') && posOf('rae') < posOf('sol'),
    'within the unknown band the biggest book leads — the largest exposure is the first call');
  ok(compareStaff(by('dana'), by('dana')) === 0, 'a trainer does not outrank themselves');

  // ── delivery, money and hours ──
  ok(by('omar').delivered === 8 && by('omar').noShows === 1 && by('omar').unmarked === 0, 'the buckets are what the outcomes say');
  ok(by('omar').marked === 9 && by('omar').sessions === 9, 'and everything of theirs carries an outcome');
  ok(by('omar').owedCents === 140_000 && by('omar').payable === 8 && by('omar').priced === 7,
    'a payable session nobody priced is counted as payable and left OUT of the money');
  ok(by('omar').outstandingCents === 120_000 && by('omar').outstandingSessions === 6,
    'what a settlement would hand over excludes the one already paid and the one with no rate');
  ok(by('omar').settleable === true && by('omar').settleBlocker === null, 'and it is safe to settle');
  ok(by('omar').rosteredHours === 10 && by('omar').deliveredHours === 8 && by('omar').floorUse === 0.8,
    'ten hours rostered, eight confirmed delivering');
  ok(by('omar').classHours === 1 && by('omar').hoursNote!.includes('1 class hour'),
    'and the class they teach is named as absent from that ratio rather than silently ignored');
  ok(by('rae').rosteredHours === null && by('rae').pulledShifts === 1 && by('rae').shifts === 1,
    'a shift somebody pulled leaves no rostered hours — not zero hours, which would read as a trainer who worked none');
  ok(by('rae').hoursNote!.includes('not the same as a trainer who worked none'), 'said in the note');
  ok(by('nadia').rosteredHours === null && by('nadia').shifts === 0, 'and never rostered at all is its own answer');

  // ── the book ──
  ok(by('omar').clients === 5 && by('omar').drifting === 1 && by('omar').unknownClients === 3 && by('omar').steadyClients === 1,
    "a trainer's book is assessed client by client against each client's own pattern");
  ok(by('omar').book!.length === 5 && by('omar').book![0].status === 'at_risk', 'and comes back drifting-first');
  ok(by('dana').clients === 6 && by('dana').unknownClients === 6,
    'six clients nobody has a data point for are six unknowns, not six steady members');

  // ── the gym-wide figures ──
  ok(v.rollup.trainers === 5 && v.rollup.unknown === 3 && v.rollup.atRisk === 1 && v.rollup.onTrack === 1,
    'three of five people on this roster cannot be assessed at all');
  ok(v.rollup.flagged === 4, 'and "flagged" is the same set gymRollup counts as atRiskCount, named for what it is');
  ok(v.rollup.flagged === gymRollup([
    { id: 'dana', name: 'Dana', clients: 6, sessions30: 0 },
    { id: 'rae', name: 'Rae', clients: 2, sessions30: 0 },
    { id: 'nadia', name: 'Nadia', clients: 4, sessions30: 0 },
    { id: 'sol', name: 'Sol', clients: 0, sessions30: 0 },
    { id: 'omar', name: 'Omar', clients: 5, sessions30: 8 },
  ], null).atRiskCount, 'so the two screens cannot be read as disagreeing about how many need looking at');
  ok(v.rollup.flaggedClients === 12, 'the exposure is the clients under those trainers, not the headcount');
  ok(v.rollup.clients === 18 && v.rollup.unassignedClients === 1, 'a member on nobody\'s book is counted and named');
  ok(v.rollup.delivered === 8 && v.rollup.unmarked === 20 && v.rollup.noShows === 1, 'gym-wide delivery');
  ok(v.rollup.outstandingCents === 120_000,
    'the payable-now headline equals the sum of the rows beneath it, off-roster money excluded');
  ok(v.rollup.rosteredHours === 18 && v.rollup.deliveredHours === 8 && v.rollup.classHours === 1, 'gym-wide hours');
  ok(v.offRoster!.length === 1 && v.offRoster![0].trainerId === 'ghost' && v.offRoster![0].cents === 40_000,
    'sessions run by somebody not on the roster are real money and are surfaced, not dropped');
  ok(v.caveat!.includes('3 of 5 cannot be assessed') && v.caveat!.includes('Dana'),
    'and the page says up front how much of its own roster it cannot judge, by name');
  ok(v.warning === null && staffCompleteness(whole) === 'whole', 'with every read in, there is nothing to warn about');

  // ── a failed read is never an empty roster ──
  const noSessions: StaffRecord = { ...whole, sessions: sliceFailed('permission denied for table sessions') };
  const fv = build(noSessions);
  ok(fv.members!.every((m) => m.unknown), 'with the one-to-ones unreadable, NOBODY can be judged');
  ok(fv.members!.every((m) => m.status !== 'on_track'), 'and in particular nobody comes back fine');
  ok(by2(fv, 'omar').reason.includes('could not be read') && by2(fv, 'omar').reason.includes('unknown, not nil'),
    'the reason names the failed read rather than the person');
  ok(by2(fv, 'omar').delivered === null && by2(fv, 'omar').owedCents === null && by2(fv, 'omar').outstandingCents === null,
    'every derived figure is null, never 0 — a broken query must not report a trainer who delivered nothing');
  ok(fv.rollup.delivered === null && fv.rollup.unmarked === null, 'and no gym-wide total is offered over it');
  ok(fv.rollup.trainers === 5, 'the roster itself is still known, so the people are still named');
  ok(fv.warning!.includes('the one-to-ones') && fv.warning!.includes('what was delivered and what is owed are unknown'),
    'the banner names the part AND what the reader is therefore not seeing');
  ok(staffCompleteness(noSessions) === 'broken', 'a page missing a part is not a whole picture');
  ok(brokenStaffParts(noSessions)[0].reason === 'permission denied for table sessions', 'carrying the actual reason, not a shrug');

  // ── loading is a third state, not a kind of failure and not a kind of empty ──
  const stillReading: StaffRecord = { ...whole, sessions: sliceLoading() };
  ok(build(stillReading).members!.every((m) => m.unknown), 'nothing is claimed while a read is in flight either');
  ok(by2(build(stillReading), 'omar').reason.includes('Still reading'), 'but it says so differently from a failure');
  ok(staffCompleteness(stillReading) === 'loading' && loadingStaffParts(stillReading)[0] === 'sessions', 'and the page knows which');
  ok(staffWarning(stillReading) === null, 'a read still in flight raises no failure banner');
  ok(staffCompleteness({ ...whole, sessions: sliceLoading(), clients: sliceFailed('boom') }) === 'broken',
    'but once something has definitively failed, "loading" would promise a completeness that is not coming');

  // ── the halves fail independently ──
  const noClients: StaffRecord = { ...whole, clients: sliceFailed('permission denied for table clients') };
  ok(by2(build(noClients), 'omar').clients === null && by2(build(noClients), 'omar').unknown === true,
    'a trainer with no clients reads very differently from one whose clients did not load, so no verdict is offered');
  ok(by2(build(noClients), 'omar').delivered === 8, 'though what they delivered is still known and still shown');
  ok(build(noClients).rollup.clients === null && build(noClients).rollup.unassignedClients === null,
    'and no client count is invented for the gym');

  const noActivity: StaffRecord = { ...whole, activity: sliceFailed('permission denied for table check_ins') };
  ok(by2(build(noActivity), 'omar').book === null && by2(build(noActivity), 'omar').drifting === null,
    'drift over an unread training record would call every client silent, so none is judged');
  ok(by2(build(noActivity), 'omar').clients === 5, 'the book is still counted — only the reading of it is withheld');
  ok(by2(build(noActivity), 'omar').status === 'on_track',
    'and a failure in one half does not drag the other half to a verdict it does not warrant');

  // ── no roster, no page ──
  const noRoster = build({ ...whole, trainers: sliceFailed('permission denied for table trainers') });
  ok(noRoster.members === null && noRoster.rollup.trainers === null, 'with no roster there is nobody to name');
  ok(noRoster.offRoster === null, 'and nothing can be called off-roster when the roster itself is unknown');
  ok(noRoster.caveat === null, 'no claim is made about how many can be assessed');

  // ── an empty gym is a different fact from a broken one ──
  const emptyGym: StaffRecord = {
    trainers: sliceReady([]), sessions: sliceReady([]), shifts: sliceReady([]),
    clients: sliceReady([]), activity: sliceReady([]), classes: sliceReady([]),
  };
  const ev = build(emptyGym);
  ok(ev.members!.length === 0 && ev.rollup.trainers === 0, 'a gym with no trainers has a roster of none, and says so');
  ok(ev.warning === null && ev.caveat === null && staffCompleteness(emptyGym) === 'whole', 'with nothing wrong about it');
  ok(ev.rollup.clients === 0 && ev.rollup.outstandingCents === null,
    'no clients is zero clients; no money owed is a dash, because nothing was priced rather than nothing being due');

  // ── a roster nothing can be said about ──
  const blind = build({ ...whole, trainers: sliceReady([tr('dana', 'Dana', 300), tr('sol', 'Sol', 300)]) });
  ok(blind.caveat!.includes('Not one of the 2 people'), 'a gym where nobody marks outcomes gets that as the finding, not a footnote');
  ok(blind.caveat!.includes('none of them is a clean bill of health'), 'said in exactly those terms');
  ok(blind.warning === null, 'and it fires even though every single read succeeded — this is not a broken page');

  // ── the parts each name what their absence costs ──
  ok(STAFF_PARTS.every((p) => STAFF_COST[p].length > 20), 'every part states what the reader loses without it');
  ok(STAFF_COST.shifts.includes('not nil') && STAFF_COST.activity.includes('looks the same as a steady one'),
    'in terms of the missing answer, not the missing table');
}

/** Find one person in a staff view under test. */
function by2(v: ReturnType<typeof buildStaff>, id: string) {
  return v.members!.find((m) => m.trainerId === id)!;
}

// ── gym-wide retention (Phase 2 · Studio web: retention) ──
//
// The per-member read already existed. What did not was any roll-up, and a
// roll-up is where the two lies live: a roster convicted of absence because
// nobody installed a door reader, and a percentage over four people.
{
  const RNOW = Date.parse('2026-08-15T12:00:00Z');
  const RDAY = 86_400_000;
  const rAgo = (n: number) => new Date(RNOW - n * RDAY).toISOString();
  const rng = (n: number) => Array.from({ length: n }, (_, i) => i);

  const mem = (id: string, started: string, status: Membership['status']): Membership => ({
    id: `m-${id}-${started}`, memberId: id, memberName: id, planId: 'p1', planName: 'Gym',
    startedOn: started, endsOn: null, status,
  });
  const vis = (id: string, daysAgo: number, classId: string | null = null): Visit => ({
    id: `v-${id}-${daysAgo}`, memberId: id, memberName: id, passId: null, classId,
    enteredAt: rAgo(daysAgo), exitedAt: null, source: 'door', note: null,
  });
  const bk = (id: string, daysAgo: number, attended: boolean): MemberBooking => ({
    bookingId: `b-${id}-${daysAgo}`, memberId: id, classId: `c-${daysAgo}`, classTitle: 'HIIT',
    startsAt: rAgo(daysAgo), status: 'booked', attendedAt: attended ? rAgo(daysAgo) : null,
  });
  const rrec = (ms: Membership[], vs: Visit[], bs: MemberBooking[]): RetentionRecord => ({
    memberships: sliceReady(ms), visits: sliceReady(vs),
    bookings: sliceReady(bs), sessions: sliceReady<PtSession>([]),
  });

  // ── TRAP 2: a percentage over a handful of people ──
  //
  // Three cohorts: January is twelve and mature, March is three, August is
  // twenty and started three weeks ago.
  const roster: Membership[] = [
    ...rng(12).map((i) => mem(`jan-${i}`, '2026-01-10', i < 9 ? 'active' : 'cancelled')),
    ...rng(3).map((i) => mem(`mar-${i}`, '2026-03-05', i < 2 ? 'active' : 'cancelled')),
    ...rng(20).map((i) => mem(`aug-${i}`, '2026-08-02', 'active')),
    { ...mem('nodate', '2025-01-01', 'active'), startedOn: '' },
  ];
  const gc = buildGymRetention(rrec(roster, [], []), { now: RNOW });
  const spine = gc.spine!;
  const jan = spine.cohorts.find((c) => c.month === '2026-01')!;
  const feb = spine.cohorts.find((c) => c.month === '2026-02')!;
  const mar = spine.cohorts.find((c) => c.month === '2026-03')!;
  const aug = spine.cohorts.find((c) => c.month === '2026-08')!;

  ok(gc.summary.roster === 36 && gc.summary.onBooks === 32, 'the roster and the live memberships are counted');
  ok(jan.joined === 12 && jan.onBooks === 9 && jan.lapsed === 3, 'January: twelve joined, nine still on the books');
  ok(jan.retention === 0.75, 'a cohort of twelve, matured, does report its rate');
  ok(mar.joined === 3, 'March took three joiners');
  ok(mar.retention === null, 'A COHORT OF THREE REPORTS NO RETENTION PERCENTAGE — two of three is not a 67% retention rate, it is two people');
  ok(mar.suppressed === 'too-small', 'and the row says which floor it failed rather than just showing a dash');
  ok(mar.onBooks === 2 && mar.lapsed === 1, 'while still reporting the counts, which are true and useful');
  ok((suppressionNote(mar) ?? '').includes('33.3'), 'the note states it in the cohort’s own terms: one member there is worth 33.3 points');
  ok(suppressionNote(jan) === null, 'and a cohort that carries a rate has nothing to explain');
  ok(aug.joined === 20 && aug.retention === null && aug.suppressed === 'too-young',
    'a cohort twice the floor STILL gets no rate three weeks in — nobody who joined this month has had the chance to leave, so 100% would be a fact about the calendar');
  ok(feb.joined === 0 && feb.retention === null,
    'a month the gym recruited nobody is present at zero rather than skipped, and has no rate over no joiners');
  ok(spine.undated === 1, 'the membership with no usable start date is in no cohort');
  ok(spine.cohorts.reduce((a, c) => a + c.joined, 0) + spine.undated === gc.summary.roster,
    'and nobody is lost between the roster and the spine');
  ok(spine.reportable === 1, 'exactly one of the three cohorts clears both the floor and the maturity rule');
  ok(spine.floorNote.includes('10') && spine.floorNote.includes('30 days'),
    'the rule is stated on screen, not buried in the module');

  // the arithmetic the floor comes from
  ok(MIN_COHORT_FOR_RATE === 10, 'the floor is ten');
  ok(pointsPerMember(10) === 10, 'because at ten joiners one member is worth exactly ten points of the rate');
  ok(pointsPerMember(9)! > 10, 'and at nine, more than ten — further than anything an owner would act on');
  ok(pointsPerMember(0) === null, 'over an empty cohort a member is worth nothing, because there are none');
  ok(rateOf(3, 4) === null, 'three of four is not 75% retention');
  ok(rateOf(0, 0) === null, 'a rate over zero opportunities is null — not 0%, and not 100%');
  ok(rateOf(9, 12) === 0.75, 'a rate over a real denominator is a number');

  // join dates, and the timezone that could move a whole cohort
  ok(monthOfDate('2026-08-01') === '2026-08',
    'a plain date is read off the STRING, so no timezone west of Greenwich can file an August joiner under July');
  ok(monthOfDate('2026-01-31T22:00:00Z') === '2026-01', 'a timestamp with a date prefix is read the same way');
  ok(monthOfDate('') === null && monthOfDate(null) === null && monthOfDate('sometime') === null,
    'and an unusable date is null, never today');

  const rejoin = buildGymRetention(
    rrec([mem('g', '2025-03-01', 'cancelled'), mem('g', '2026-07-01', 'active')], [], []),
    { now: RNOW },
  );
  ok(rejoin.rows![0].cohort === '2025-03',
    'somebody who cancelled and rejoined belongs to their ORIGINAL cohort — filing them under the rejoin month draws a gym that recruits well and keeps nobody, built entirely out of its own returning members');
  ok(rejoin.rows![0].status === 'active', 'while their membership today is the live row');

  ok(cohortFeasibility([{ joinedOn: '2026-02-01' }, { joinedOn: '2026-02-08' }]).usable === false,
    'every dated membership starting in one month is an imported roster, not a cohort spine — checked rather than assumed');
  ok(cohortFeasibility([{ joinedOn: '2026-02-01' }, { joinedOn: '2026-03-08' }]).usable === true,
    'two join months is enough to compare one against another');
  ok(cohortFeasibility([{ joinedOn: null }, { joinedOn: null }]).usable === false,
    'and no usable dates at all is not a spine either');
  ok(cohortFeasibility([{ joinedOn: null }, { joinedOn: '2026-02-01' }, { joinedOn: '2026-03-01' }]).undated === 1,
    'undated members are counted and reported, never folded into the oldest cohort');

  // ── TRAP 1: a gym with no door log cannot be told who has lapsed ──
  //
  // a: stopped booking classes, still through the door. b: stopped entirely.
  // c: still booking and still coming.
  const live = rrec(
    [mem('a', '2026-01-10', 'active'), mem('b', '2026-01-10', 'active'), mem('c', '2026-01-10', 'active')],
    [
      ...[3, 7, 10, 14].map((d) => vis('a', d)),
      ...[30, 37, 44, 51].map((d) => vis('b', d)),
      ...[2, 5, 9, 12, 16, 19, 23, 26, 30, 33, 37, 40, 44, 47, 51, 54].map((d) => vis('c', d)),
    ],
    [
      ...[30, 37, 44, 51].map((d) => bk('a', d, true)),
      ...[30, 37, 44, 51].map((d) => bk('b', d, true)),
      ...[2, 9, 16, 23, 30, 37, 44, 51].map((d) => bk('c', d, true)),
    ],
  );
  const gl = buildGymRetention(live, { now: RNOW });
  ok(gl.doorLog === 'live', 'a log with rows in it is live');
  ok(absenceBlocker(live) === null, 'so the absence figure is allowed');
  ok(gl.summary.offTimetable === 1, 'one member stopped booking classes and did not stop training');
  ok(gl.rows!.find((r) => r.memberId === 'a')!.offTimetable === true, 'and it is the one on the gym floor');
  ok(gl.summary.quiet === 1, 'exactly one is absent from a log that was recording the other two');
  ok(gl.rows!.find((r) => r.memberId === 'b')!.quiet === true, 'and it is the one who stopped');
  ok(gl.rows!.find((r) => r.memberId === 'a')!.quiet === false,
    'the member who moved to the floor is NOT counted as gone — the whole point of reading the door log beside the timetable');
  ok(headline(gl)!.includes('still coming through the door'),
    'the headline surfaces the member a class-only report would have written off');

  // the same gym, read, with nothing at the door
  const dark: RetentionRecord = { ...live, visits: sliceReady<Visit>([]) };
  const gd = buildGymRetention(dark, { now: RNOW });
  ok(gd.doorLog === 'silent', 'read and empty is SILENT, which is not the same as unread');
  ok(gd.summary.quiet === null,
    'A GYM WITH NO DOOR LOG IS TOLD NOTHING ABOUT WHO HAS LAPSED — the count is null, never 0 and never the whole roster');
  ok(gd.rows!.every((r) => r.quiet === false), 'and not one member is marked absent on no evidence');
  ok(gd.summary.offTimetable === null,
    'nor is anybody counted as training off the timetable — with no terminal there is nowhere to be seen instead, and 0 would read as a finding');
  ok(absenceBlocker(dark)!.includes('terminal'), 'the screen is told why, in terms of the gym rather than the query');
  ok(gd.caveat !== null && gd.caveat!.includes('class bookings only'),
    'and warned that the attendance under it is class bookings only');
  ok(gd.warning === null, 'nothing failed, so there is no failure banner — silent and broken are different renders');

  // the same gym again, with the door read broken
  const blind: RetentionRecord = { ...live, visits: sliceFailed('permission denied for table gym_visits') };
  const gb = buildGymRetention(blind, { now: RNOW });
  ok(gb.doorLog === 'unread', 'a failed read is UNREAD, and not quietly rounded to silent');
  ok(gb.summary.quiet === null && gb.summary.offTimetable === null, 'neither door figure is offered');
  ok(gb.rows!.every((r) => r.read === null), 'and no per-member verdict either — the read needs both halves');
  ok(gb.warning!.includes('door log') && gb.warning!.includes('not counted as nil'),
    'the banner names the read and says the figures are missing rather than zero');
  ok(gb.broken.some((b) => b.part === 'visits' && b.cost.includes('in the building')),
    'and says what that read was carrying, in the owner’s words');
  ok(gb.sources.join(',') === 'bookings,sessions', 'the remaining two sources are still used');

  // ── drift: a break in a pattern, not a level — the coach-side model, rolled up ──
  const drifters = rrec(
    [mem('c2', '2025-06-01', 'active'), mem('d2', '2025-06-01', 'active')],
    [
      ...[3, 20, 34, 48].map((d) => vis('c2', d)),
      vis('d2', 3),
      ...[16, 17, 18, 19, 23, 24, 25, 26, 30, 31, 32, 33, 37, 38, 39, 40, 44, 45, 46, 47, 51, 52, 53, 54].map((d) => vis('d2', d)),
    ],
    [],
  );
  const gdr = buildGymRetention(drifters, { now: RNOW });
  const dc = gdr.rows!.find((r) => r.memberId === 'c2')!.drift!;
  const dd = gdr.rows!.find((r) => r.memberId === 'd2')!.drift!;
  ok(dc.recentPerWeek === 0.5 && dd.recentPerWeek === 0.5, 'two members training at exactly the same rate today');
  ok(dc.status === 'on_track' && dd.status === 'at_risk',
    'and only the one who used to do four days a week is drifting — the roll-up keeps clientDrift’s model, where drift is a break in a person’s own pattern and not a level');
  ok(gdr.summary.bands!.steady === 1 && gdr.summary.bands!.drifting === 1, 'the bands count them apart');
  ok(gdr.rows![0].memberId === 'd2', 'and the one breaking their pattern leads the list');

  // one day of training is one day, however many rows recorded it
  const sameDay = rrec([mem('e', '2025-06-01', 'active')], [vis('e', 5, 'c1')], [bk('e', 5, true)]);
  ok(buildGymRetention(sameDay, { now: RNOW }).rows![0].drift!.recentActiveDays === 1,
    'a class attendance that also produced a door scan is ONE day of training — counting it twice lets a busy Tuesday cover a fortnight of silence');
  const notTicked = rrec([mem('f', '2025-06-01', 'active')], [], [bk('f', 5, false)]);
  ok(buildGymRetention(notTicked, { now: RNOW }).rows![0].drift!.recentActiveDays === 0,
    'a booking nobody ticked off is an intention, not attendance');

  // ── nothing read is not the same as nothing happening ──
  const noActivity: RetentionRecord = {
    memberships: sliceReady([mem('a', '2026-01-10', 'active')]),
    visits: sliceFailed('down'), bookings: sliceFailed('down'), sessions: sliceFailed('down'),
  };
  const gn = buildGymRetention(noActivity, { now: RNOW });
  ok(gn.sources.length === 0, 'nothing that records attendance landed');
  ok(gn.summary.bands === null,
    'so NO bands at all — a roster marked "nothing recorded" would be a statement about three failed queries wearing the clothes of a statement about the gym');
  ok(gn.rows![0].drift === null, 'and no verdict on the member: not judged, which is not the same as unknown');
  ok(headline(gn)!.includes('unknown — not zero'), 'the headline says so in as many words');

  // ── no roster, and still loading ──
  const noRoster: RetentionRecord = {
    memberships: sliceFailed('relation "memberships" does not exist'),
    visits: sliceReady<Visit>([]), bookings: sliceReady<MemberBooking>([]), sessions: sliceReady<PtSession>([]),
  };
  const gnr = buildGymRetention(noRoster, { now: RNOW });
  ok(gnr.rows === null && gnr.spine === null,
    'with no roster there is no member-centred view, and one is not invented from whoever happens to appear in the door log');
  ok(gnr.summary.roster === null && gnr.summary.onBooks === null, 'and the counts are null, not 0');

  const stillReading: RetentionRecord = {
    memberships: sliceLoading(), visits: sliceLoading(), bookings: sliceLoading(), sessions: sliceLoading(),
  };
  const gld = buildGymRetention(stillReading, { now: RNOW });
  ok(gld.warning === null, 'still loading is not a failure, so there is no failure banner');
  ok(gld.rows === null && gld.summary.quiet === null, 'and no figures are claimed while the reads are in flight');
  ok(gld.blocker !== null, 'but nobody can be called absent either — an unread log is not an empty gym');
  ok(pendingRetentionParts(stillReading).length === 4, 'and the page can say which four reads it is waiting on');
  ok(doorLogState(stillReading) === 'unread', 'a log that has not arrived is unread');
}



// ── the intervention loop (Phase 4 · surface, contact, record, measure) ─────
//
// Surfacing was already done and already honest. What did not exist was any
// record that somebody had been contacted, so the same name came up every
// Monday and nobody could say whether any of it helps.
//
// "Measure" is the hard half, and every assertion below is about a way of
// answering it badly:
//
//   1. a logged call must not move a drift verdict;
//   2. an intervention logged yesterday must refuse to report a verdict, on a
//      window taken from the member's OWN rate;
//   3. what is reported is a sequence, never a rate that reads as causal;
//   4. a contacted member sinks; she never disappears;
//   5. what was tried has to survive being read back.
{
  const INOW = Date.parse('2026-08-15T12:00:00Z');
  const IDAY = 86_400_000;
  const iAgo = (n: number) => new Date(INOW - n * IDAY).toISOString();
  const iev = (n: number): ActivityEvent => ({ at: iAgo(n), kind: 'visit' });
  /** Days-ago list → events. Distinct days, so each is one active day. */
  const ievs = (days: number[]): ActivityEvent[] => days.map(iev);
  const span = (from: number, to: number, keep: (d: number) => boolean): number[] => {
    const out: number[] = [];
    for (let d = from; d <= to; d++) if (keep(d)) out.push(d);
    return out;
  };

  const ic = (id: string, memberId: string, daysAgo: number, over: Partial<Contact> = {}): Contact => ({
    id, memberId, at: iAgo(daysAgo), channel: 'call',
    byId: 'staff-1', byName: 'Dana', outcome: 'reached', note: 'Said the 6am is too early now',
    ...over,
  });

  const imem = (id: string, status: Membership['status'] = 'active'): Membership => ({
    id: `m-${id}`, memberId: id, memberName: id, planId: 'p1', planName: 'Gym',
    startedOn: '2025-06-01', endsOn: null, status,
  });

  // ── 5 · what was tried, read back ──
  const tried = ic('k1', 'sara', 3);
  ok(triedLine(tried, INOW).startsWith(CHANNEL_LABEL.call), 'the line says which channel was used');
  ok(triedLine(tried, INOW).includes('by Dana'), 'and who did it, so a second person does not repeat the call');
  ok(triedLine(tried, INOW).includes('3 days ago'), 'and when');
  ok(triedLine(tried, INOW).includes(OUTCOME_LABEL.reached.toLowerCase()), 'and what came of the contact itself');
  ok(contactBy({ ...tried, byName: null }) === null,
    'a staff member whose name was never written down comes back null — never the uuid dressed up as a name');
  ok(landed('reached') === true && landed('bounced') === false && landed('left_message') === null,
    'a message left on an answerphone reached the phone; whether it reached the person is exactly what nobody knows, and it is null rather than guessed either way');
  ok(landed('unknown') === null, 'and an unfinished row asserts nothing about whether anybody was spoken to');

  const many = [ic('k3', 'sara', 40), ic('k1', 'sara', 3), ic('k2', 'sara', 20), ic('k9', 'other', 1)];
  ok(lastContactFor(many, 'sara')!.id === 'k1', 'the most recent contact is the most recent one');
  ok(contactsFor(many, 'sara').length === 3 && contactsFor(many, 'sara')[2].id === 'k3', 'and the history is newest first');
  const undated = ic('bad', 'sara', 0, { at: 'not a date' });
  ok(lastContactFor([undated, ic('k1', 'sara', 9)], 'sara')!.id === 'k1',
    'a row whose date will not parse must not silently become "the most recent contact"');

  // ── 2 · the window comes from the member's own rate, not from a round number ──
  ok(paceFor(4)!.judgeAfterDays === MIN_JUDGE_DAYS,
    'somebody who trained four times a week is judged after the floor of a fortnight — three of their gaps is a weekend, and a weekend is not evidence');
  ok(paceFor(1)!.judgeAfterDays === 21, 'a once-a-week member needs three weeks');
  ok(paceFor(0.5)!.judgeAfterDays === 42,
    'and a fortnightly member needs six — a fortnight of silence is her ordinary gap, and calling that "no effect" is how a gym gives up on somebody who had not gone anywhere');
  ok(paceFor(0.5)!.judgeAfterDays! > paceFor(7)!.judgeAfterDays!,
    'the quieter the pattern, the longer before anything can be said. The opposite ordering would be the bug');
  ok(paceFor(null).judgeAfterDays === null && paceFor(null).basis === 'no-pattern',
    'no baseline, no window — nothing about a member with no pattern is judgeable at all');
  ok(paceFor(null).cooldownDays === DEFAULT_COOLDOWN_DAYS,
    'but there is still a cooldown: "we know nothing about her" is not a licence to ring her daily');
  ok(paceFor(4).cooldownDays === MIN_COOLDOWN_DAYS && paceFor(0.5).cooldownDays === MAX_COOLDOWN_DAYS,
    'the gap before a second approach is paced the same way, floored at a week and capped at a month');
  ok(paceOf(null).basis === 'no-pattern', 'a member with no drift verdict at all paces as no-pattern');
  ok(paceNote(paceFor(0.5)).includes('42'), 'and the screen can say why the wait is as long as it is');

  // A member who trained four days a week for six weeks, then stopped.
  // Contact 30 days ago; her window is 14 days, so it has passed.
  const REC_C = 30;
  const baseDays = span(45, 86, (d) => (d - 45) % 7 < 4);   // 24 active days over 42
  const recovered = ievs([...baseDays, 40, 17, 19, 21, 23, 25, 27, 29, 30]);
  const fRec = assessFollowUp({ contact: ic('c1', 'ret', REC_C), events: recovered, readFromMs: INOW - 150 * IDAY }, INOW);
  ok(fRec.baselinePerWeek === 4, 'her own settled rate before the drop, measured as it stood on the day of the call');
  ok(fRec.beforePerWeek === 0.5, 'the state the gym was looking at when it decided to ring');
  ok(fRec.afterPerWeek === 4, 'and what she actually did in the window afterwards');
  ok(fRec.verdict === 'recovered' && fRec.backToBaseline === true, 'training picked back up to her own pattern');
  ok(fRec.reason.includes('not proof it caused it'),
    'and the sentence says in as many words that this is a sequence — she may have come back anyway, and the record cannot tell');
  ok(!/\bworked\b/.test(fRec.reason), 'the word "worked" appears nowhere');

  const fell = ievs([...baseDays, 40, 38, 36]);
  const fFell = assessFollowUp({ contact: ic('c2', 'ret', REC_C), events: fell, readFromMs: INOW - 150 * IDAY }, INOW);
  ok(fFell.beforePerWeek === 1.5 && fFell.afterPerWeek === 0, 'she was already down, and did nothing at all afterwards');
  ok(fFell.verdict === 'kept-falling', 'which is a further fall, not a hold');

  const heldEv = ievs([...baseDays, 40, 36, 25, 20]);
  const fHeld = assessFollowUp({ contact: ic('c3', 'ret', REC_C), events: heldEv, readFromMs: INOW - 150 * IDAY }, INOW);
  ok(fHeld.beforePerWeek === 1 && fHeld.afterPerWeek === 1 && fHeld.verdict === 'held',
    'the same either side is "held" — neither a recovery nor a further fall');

  // ── 2 (the one that bites) · an intervention logged yesterday ──
  const yBase = span(16, 57, (d) => (d - 16) % 7 < 4);
  const yesterday = assessFollowUp({ contact: ic('c4', 'ret', 1), events: ievs(yBase), readFromMs: INOW - 150 * IDAY }, INOW);
  ok(yesterday.verdict === 'unknown' && yesterday.blocked === 'too-early',
    'an intervention logged yesterday reports NO verdict — one day is not a measurement, and "no effect" would be a claim a gym acts on by giving up');
  ok(yesterday.daysToWait === 13, 'it says how long is left instead');
  ok(yesterday.afterPerWeek === null, 'and no rate is computed over a window that has not happened');

  // The same elapsed time, two members, two answers — because the window is
  // theirs and not the calendar's.
  const wkBase = span(40, 81, (d) => (d - 40) % 7 === 0);       // 6 active days over 42 → 1.0/wk
  const ftBase = span(40, 81, (d) => (d - 40) % 14 === 0);      // 3 active days over 42 → 0.5/wk
  const weekly = assessFollowUp({ contact: ic('c5', 'wk', 25), events: ievs([...wkBase, 10, 5]), readFromMs: INOW - 150 * IDAY }, INOW);
  const fortnightly = assessFollowUp({ contact: ic('c6', 'ft', 25), events: ievs([...ftBase, 10]), readFromMs: INOW - 150 * IDAY }, INOW);
  ok(weekly.baselinePerWeek === 1 && fortnightly.baselinePerWeek === 0.5, 'two members, two rates');
  ok(weekly.verdict !== 'unknown', 'twenty-five days is enough to say something about the once-a-week member');
  ok(fortnightly.verdict === 'unknown' && fortnightly.blocked === 'too-early',
    'and not enough to say anything about the fortnightly one, contacted on the very same day. A fixed window would have called her a failure while she was between her normal visits');
  ok(fortnightly.daysToWait === 17, 'seventeen days still to run on her own clock');

  // ── the four other ways it refuses, each a different fact ──
  const noBase = assessFollowUp({ contact: ic('c7', 'nb', 30), events: ievs([70, 60]), readFromMs: INOW - 150 * IDAY }, INOW);
  ok(noBase.blocked === 'no-baseline' && noBase.reason.includes('2 active days'),
    'two visits is not a pattern, and the refusal names what was actually there rather than reporting a fall from a baseline she never had');
  const silent = assessFollowUp({ contact: ic('c7b', 'nb', 30), events: [], readFromMs: INOW - 150 * IDAY }, INOW);
  ok(silent.blocked === 'no-baseline' && silent.reason.includes('Not "no effect"'),
    'and a member with nothing recorded before the contact is a member with no measurement — said in those words, because "no effect" is the reading a gym gives up on somebody for');

  const old = assessFollowUp({ contact: ic('c8', 'ret', 140), events: recovered, readFromMs: INOW - 150 * IDAY }, INOW);
  ok(old.blocked === 'outside-the-read',
    'a contact older than the attendance the page read is not judged on a baseline built out of the query\'s own edge');
  ok(old.reason.includes('read here'), 'and the sentence is about the read, not about the member');

  const bad = assessFollowUp({ contact: undated, events: recovered }, INOW);
  ok(bad.blocked === 'unreadable-date', 'a row with no readable date has no window to measure from');

  // ── 3 · a second contact inside the window means neither gets the credit ──
  const twice = [ic('t1', 'ret', 30), ic('t2', 'ret', 20)];
  const both = assessAllFollowUps(twice, () => recovered, { now: INOW, readFromMs: INOW - 150 * IDAY });
  const byId = new Map(both.map((f) => [f.contactId, f]));
  ok(both.length === 2, 'both contacts are assessed');
  ok(byId.get('t1')!.blocked === 'recontacted',
    'the first cannot be judged: somebody rang again inside its window, so whatever followed followed both');
  ok(byId.get('t2')!.verdict !== 'unknown', 'the second, whose own window has run clear, can be');

  const withUndated = assessAllFollowUps([...twice, undated], () => recovered, { now: INOW, readFromMs: INOW - 150 * IDAY });
  ok(withUndated.length === 3,
    'a row nobody can date is still reported — it is work somebody did, and dropping it would under-count what the staff actually tried');

  // ── 3 · counts of what followed, and NO rate ──
  const tally = summariseFollowUps([fRec, fFell, fHeld, yesterday, noBase, old, bad, byId.get('t1')!])!;
  ok(tally.total === 8 && tally.judged === 3, 'eight contacts, three of them old enough and backed by enough record to look at');
  ok(tally.recovered === 1 && tally.held === 1 && tally.keptFalling === 1, 'counted by what followed each one');
  ok(tally.tooEarly === 1 && tally.noBaseline === 1 && tally.outsideTheRead === 1 && tally.recontacted === 1 && tally.unreadable === 1,
    'and the five refusals are kept apart rather than folded into one dash — "wait nine more days" and "older than this page reads" send a gym to different places');
  ok(!('rate' in tally) && !('successRate' in tally) && !('worked' in tally),
    'there is NO success rate on the tally. Everybody in it was contacted BECAUSE they were drifting, so there is no comparable group left alone for a percentage to be higher than — and the members furthest below their own average drift back toward it regardless');
  ok(WHY_NO_RATE.includes('left alone'), 'and the page says that out loud rather than leaving a suspicious gap');
  ok(summariseFollowUps(null) === null,
    'null in, null out: "not read yet" is not "nothing has been tried", and a 0 there tells a gym its staff have done nothing');
  ok(loopHeadline(summariseFollowUps([])) === null, 'nothing tried, nothing claimed');
  ok(loopHeadline(summariseFollowUps([yesterday]))!.includes('not a result'),
    'a loop whose every contact is too young says so, instead of printing three zeroes that read as three failures');

  // ── 1 · a logged call is not a training session ──
  //
  // The structural guarantee is that `member_interventions` is not one of the
  // four parts a RetentionRecord carries and nothing here builds an
  // ActivityEvent from a Contact. These assertions pin the consequence.
  const steady = span(0, 56, (d) => d % 2 === 0);
  const drifting = span(15, 56, (d) => (d - 15) % 7 < 4);
  const drA = assessDrift({ clientId: 'a', events: ievs(drifting), since: iAgo(200) }, INOW);
  const drB = assessDrift({ clientId: 'b', events: ievs(drifting), since: iAgo(200) }, INOW);
  const drC = assessDrift({ clientId: 'c', events: ievs(steady), since: iAgo(200) }, INOW);
  ok(drA.status === 'at_risk' && drC.status === 'on_track', 'two drifting members and one holding her pattern');

  const iRows = [
    { memberId: 'a', name: 'A', drift: drA },
    { memberId: 'b', name: 'B', drift: drB },
    { memberId: 'c', name: 'C', drift: drC },
  ];
  const called = [ic('x1', 'b', 2)];
  const surf = surfaceOrder(iRows, called, { now: INOW });
  ok(surf.every((s) => iRows.includes(s.row)),
    'surfacing hands back the very same row objects — the verdict is untouched, not recomputed with a call folded in');
  ok(JSON.stringify(summariseDrift(surf.map((s) => s.row.drift))) === JSON.stringify(summariseDrift(iRows.map((r) => r.drift))),
    'and the band counts are identical with and without the contact. If logging a call nudged a member toward healthy, the loop would feed the gym its own activity back as retention');

  // The sharpest version: a member the record knows nothing about, rung five
  // times. Five calls are five calls; they are not five days of training.
  const ghostRec: RetentionRecord = {
    memberships: sliceReady([imem('ghost')]),
    visits: sliceReady<Visit>([]), bookings: sliceReady<MemberBooking>([]), sessions: sliceReady<PtSession>([]),
  };
  const ghostG = buildGymRetention(ghostRec, { now: INOW });
  const fiveCalls = [0, 30, 60, 90, 120].map((d, i) => ic(`g${i}`, 'ghost', d));
  const ghostSurf = surfaceOrder(ghostG.rows!, fiveCalls, { now: INOW });
  ok(ghostG.rows![0].drift!.unknown === true, 'nothing recorded, so no pattern to judge');
  ok(ghostSurf[0].row.drift!.unknown === true && ghostSurf[0].row.drift!.status === 'idle',
    'and five logged calls leave her exactly as unknown as she was — a contact is not a sign of life');
  ok(ghostSurf[0].contactCount === 5, 'though the loop knows perfectly well that five were made');
  ok(assessFollowUp({ contact: fiveCalls[4], events: [] }, INOW).blocked === 'no-baseline',
    'and none of them can be judged, because there is no pattern of hers to judge against');

  // ── 4 · quieten, never hide ──
  ok(surf.length === iRows.length, 'surfacing NEVER drops a row');
  ok(surf.map((s) => s.row.memberId).sort().join() === 'a,b,c', 'everybody is still there');
  ok(surf.map((s) => s.row.memberId).join() === 'a,b,c',
    'the contacted member sinks below the drifting member nobody has tried — but stays above the steady one, because she is still drifting and the call did not change that');
  const flipped = surfaceOrder([iRows[1], iRows[0], iRows[2]], called, { now: INOW });
  ok(flipped.map((s) => s.row.memberId).join() === 'a,b,c',
    'and she sinks within her band whichever order she arrived in');
  const sB = surf.find((s) => s.row.memberId === 'b')!;
  ok(sB.quietened === true && sB.quietForDays === paceFor(drB.baselinePerWeek).cooldownDays - 2,
    'quietened, with the wait taken from her own rate rather than a flat fortnight');
  ok(sB.label !== null && sB.label!.includes('Dana'),
    'and greyed rather than gone, still carrying who called and when — a gym that stops seeing a member who is still leaving has swapped a nuisance for a blind spot');
  ok(surf.find((s) => s.row.memberId === 'a')!.quietened === false, 'nobody has tried A, so A is not quietened');
  ok(quietenedCount(surf) === 1, 'and the screen can say how many rows the order has moved');

  const stale = surfaceOrder(iRows, [ic('x2', 'b', 90)], { now: INOW });
  ok(stale.find((s) => s.row.memberId === 'b')!.quietened === false,
    'a call ninety days ago quietens nobody — the cooldown is a pause, not an amnesty');
  ok(stale.find((s) => s.row.memberId === 'b')!.label !== null,
    'but it is still shown, because "we rang her in May and she is still going" is the case worth acting on');
  const unreadable = surfaceOrder(iRows, [ic('x3', 'b', 0, { at: 'nonsense' })], { now: INOW });
  ok(unreadable.find((s) => s.row.memberId === 'b')!.quietened === false,
    'and a row nobody can date never pushes anybody down the list');
}

// ── pass conversion: used a pass, then joined ──
// PASTE THE IMPORT LINE AT THE TOP OF src/lib/coverage.test.ts:
//
// import { buildPassConversion, hostsOf, intervalOf, coversDate, daysBetween, dateOf, attributionSentence, suppressionSentence, CAUSAL_CAVEAT, MONEY_NOTE, type PassConversionRecord } from './passConversion';
//
// ── and this block ABOVE the final `if (errors.length)` guard ──
{
  const PC_TODAY = '2026-08-26';
  const pcPass = (
    id: string,
    kind: 'guest' | 'drop_in' | 'pack',
    holderId: string | null,
    holderName: string | null,
    host: string | null,
    issued: string,
    expires: string | null,
    spent: number,
    paid: number | null,
    currency = 'AED',
  ): GymPass => ({
    id, passTypeId: 't1', passTypeName: kind, kind, holderId, holderName,
    hostMemberId: host, issuedOn: issued, expiresOn: expires,
    usesTotal: kind === 'guest' && spent === 0 ? 3 : 1, usesSpent: spent,
    paidCents: paid, currency, note: null,
  });
  const pcMem = (
    id: string, memberId: string, name: string | null, plan: string | null,
    from: string, to: string | null, status: Membership['status'],
  ): Membership => ({
    id, memberId, memberName: name, planId: plan,
    planName: plan === 'pl1' ? 'Monthly' : plan === 'pl2' ? 'Annual' : null,
    startedOn: from, endsOn: to, status,
  });
  const pcVisit = (id: string, memberId: string | null, passId: string | null, at: string): Visit => ({
    id, memberId, memberName: null, passId, classId: null, enteredAt: at,
    exitedAt: null, source: 'desk', note: null,
  });

  //  ann  two guest passes from hostA, joined 22 days after the first
  //  ???  one guest pass from hostA to a walk-in with NO ACCOUNT
  //  ben  a drop-in that ran out, never joined
  //  cara a guest pass still live — undecided, not lost
  //  dan  a drop-in while he was already a member
  //  eve  a guest pass and a membership the SAME DAY
  //  fin  a member who left in 2025, took a drop-in, and came back
  const pcPasses: GymPass[] = [
    pcPass('p1', 'guest', 'ann', 'Ann W', 'hostA', '2026-01-10', '2026-01-17', 1, 5000),
    pcPass('p2', 'guest', null, 'walk-in', 'hostA', '2026-01-10', '2026-01-17', 1, 5000),
    pcPass('p3', 'drop_in', 'ben', 'Ben', null, '2026-03-01', '2026-03-02', 1, 8000),
    pcPass('p4', 'guest', 'cara', null, 'hostB', '2026-08-20', '2026-09-20', 0, null),
    pcPass('p5', 'drop_in', 'dan', null, null, '2026-05-01', '2026-05-02', 1, 8000),
    pcPass('p6', 'guest', 'eve', null, 'hostA', '2026-06-01', '2026-06-05', 1, 5000),
    pcPass('p7', 'guest', 'ann', null, 'hostA', '2026-03-01', '2026-03-05', 1, null),
    pcPass('p8', 'drop_in', 'fin', null, null, '2026-02-01', '2026-02-02', 1, 8000),
  ];
  const pcMems: Membership[] = [
    pcMem('m1', 'ann', 'Ann Wright', 'pl1', '2026-02-01', null, 'active'),
    pcMem('m2', 'dan', 'Dan', 'pl1', '2026-01-01', null, 'active'),
    pcMem('m3', 'eve', 'Eve', 'pl2', '2026-06-01', null, 'active'),
    pcMem('m4', 'zoe', 'Zoe', 'pl1', '2025-04-01', null, 'active'),
    pcMem('m5', 'hostA', 'Sara Ali', 'pl1', '2025-01-01', null, 'active'),
    pcMem('m6', 'hostB', 'Tom Reid', 'pl1', '2025-01-01', null, 'active'),
    pcMem('m7', 'fin', 'Fin', 'pl1', '2025-01-01', '2025-06-01', 'cancelled'),
    pcMem('m8', 'fin', 'Fin', 'pl1', '2026-03-01', null, 'active'),
  ];
  const pcPlans: MembershipPlan[] = [
    { id: 'pl1', name: 'Monthly', priceCents: 20000, currency: 'AED', interval: 'month', active: true },
    { id: 'pl2', name: 'Annual', priceCents: 120000, currency: 'AED', interval: 'year', active: true },
  ];
  const pcVisits: Visit[] = [
    pcVisit('v1', 'ann', 'p1', '2026-01-12T10:00:00Z'),
    pcVisit('v2', 'zoe', null, '2026-08-20T10:00:00Z'),
  ];

  const pcRec: PassConversionRecord = {
    passes: sliceReady(pcPasses),
    memberships: sliceReady(pcMems),
    visits: sliceReady(pcVisits),
    plans: sliceReady(pcPlans),
  };
  const pc = buildPassConversion(pcRec, { today: PC_TODAY });
  const pcBy = new Map((pc.holders ?? []).map((h) => [h.holderId, h]));

  // ── the counts a gym asked for ──
  ok(pc.passes!.issued === 8 && pc.passes!.live === 1 && pc.passes!.usedUp === 7,
    'pass counts come straight from summarisePasses — this module extends gymPasses rather than re-deciding what a live pass is');
  ok(pc.redeemedPasses === 7, 'seven of the eight passes have had a visit taken off them');
  ok(pc.redemptionVisits === 1,
    'but the DOOR LOG only saw one of those redemptions — a desk can spend a pass without the terminal recording anybody, and quoting the door figure as "passes used" would undercount by six');

  // ── TRAP 2: a walk-in with no account is unanswerable, not a failure ──
  ok(pc.anonymousPasses === 1, 'one pass went to somebody with no account');
  ok(pc.counts!.identified === 6,
    'six HOLDERS, not eight passes — ann holds two and the anonymous pass belongs to nobody the record can name');
  ok(pc.counts!.noMembership === 1,
    'only ben is a miss; the anonymous pass is NOT counted as one, because whether that person joined is unanswerable rather than no');
  ok(pc.counts!.decided === 4,
    'four holders have decided. Folding the anonymous pass in would make it five and invent a failure out of a missing account');
  ok(pc.attributionNote !== null && pc.attributionNote!.includes('1 of 8') && /UNANSWERABLE/.test(pc.attributionNote!),
    'and the exclusion is stated on the page rather than done silently');
  ok(attributionSentence(10, 0, null) === null, 'no anonymous passes, no warning to print');
  ok(/Over half the passes/.test(attributionSentence(10, 6, null) ?? ''),
    'a gym whose passes mostly go to walk-ins is told the figures describe a minority of what it handed out');

  // ── TRAP 4: a pass that has not run out has not failed ──
  ok(pcBy.get('cara')!.outcome === 'undecided' && pcBy.get('cara')!.hasLivePass,
    'cara was given a pass six days ago and has not joined — undecided');
  ok(pc.counts!.undecided === 1 && pc.counts!.decided === 4,
    'and she is OUT of the denominator: counting her would make the gym’s most recent week of pass-giving look like its worst');
  ok(pc.undecidedNote !== null && /asymmetry/.test(pc.undecidedNote!),
    'the note also owns the asymmetry — a live pass whose holder already joined IS counted, so the figure moves as live passes run out');

  // ── TRAP 3: no percentage over a handful, and the SAME floor as /retention ──
  ok(pc.joinedAfterRate === null && pc.suppressed === 'too-few',
    'three quarters of four holders is not 75% of anything an owner should act on');
  ok(pc.floorNote.includes(String(MIN_COHORT_FOR_RATE)),
    'and the floor is gymRetention’s constant, imported rather than re-picked, so the two screens cannot disagree about the same rule');
  ok(/10 points|worth 10 points|worth 25 points/.test(suppressionSentence(pc) ?? ''),
    'the row says what one person is worth instead of showing a bare dash');
  const pcLoose = buildPassConversion(pcRec, { today: PC_TODAY, minGroup: 4 });
  ok(pcLoose.joinedAfterRate === 0.75 && pcLoose.suppressed === null,
    'lower the floor and the same rows carry a percentage — the suppression is the floor, not a missing number');

  // ── TRAP 1: a sequence, never a cause ──
  ok(!/convert/i.test(pc.headline ?? '') && /nothing here says the pass is why/.test(pc.headline ?? ''),
    'the headline reports the order and the interval and refuses the arrow between them');
  ok(/sequence, not a cause/.test(CAUSAL_CAVEAT) && !/conversion rate/i.test(CAUSAL_CAVEAT),
    'and the caveat the screen must print is a constant, so it cannot drift into "conversion rate" in a later edit');

  // ── who joined, when, and the holder as the unit ──
  ok(pcBy.get('ann')!.outcome === 'joined-after' && pcBy.get('ann')!.daysToJoin === 22 && pcBy.get('ann')!.passes === 2,
    'ann held two passes and joined once — counted once');
  ok(pc.counts!.joinedAfter === 3,
    'three people joined after a pass. Per-PASS counting would say four, which is how a gym with a few enthusiastic regulars talks itself into a rate it does not have');
  ok(pcBy.get('eve')!.outcome === 'joined-after' && pcBy.get('eve')!.daysToJoin === 0,
    'a walk-in who takes a pass and signs up the same afternoon is the most pass-shaped join a gym gets — it must not read as "already a member"');
  ok(pcBy.get('dan')!.outcome === 'already-member',
    'dan was on the books before his drop-in, so his membership cannot have followed it — outside the question in both directions');
  ok(pcBy.get('fin')!.outcome === 'joined-after' && pcBy.get('fin')!.daysToJoin === 28,
    'fin left in 2025 and came back through a drop-in — a membership that ENDED before the pass does not make him an existing member');
  ok(coversDate(pcMems[6], '2026-02-01') === false && coversDate(pcMems[1], '2026-05-01') === true,
    'coversDate reads the end date rather than the status');
  ok(pcBy.get('ann')!.firstUsedOn === '2026-01-12' && pcBy.get('ben')!.firstUsedOn === null,
    'when the pass was actually used comes from the door log, and is null rather than back-filled from the issue date');
  ok(pcBy.get('cara')!.name === null && pcBy.get('ann')!.name === 'Ann Wright',
    'a holder with no name recorded gets null — never the account id dressed up as a name');
  ok(pc.holders![0].holderId === 'eve' && pc.holders![1].holderId === 'ann',
    'joiners lead the list, quickest first');

  // ── how long it took ──
  ok(pc.interval!.n === 3 && pc.interval!.medianDays === 22 && pc.interval!.minDays === 0 && pc.interval!.maxDays === 28,
    'the MEDIAN, with its n and its range beside it — one guest who joined two years later would drag a mean into meaninglessness');
  ok(intervalOf([]) === null && intervalOf(pc.holders!.filter((h) => h.outcome !== 'joined-after')) === null,
    'and no interval at all over nobody, rather than a confident 0 days');
  ok(daysBetween('2026-01-10', '2026-02-01') === 22 && daysBetween('2026-02-01', '2026-01-10') === 0,
    'day arithmetic is UTC and never negative');
  ok(dateOf('2026-08-26T23:30:00+04:00') === '2026-08-26' && dateOf(null) === null,
    'a plain date is taken from the string, not parsed and re-formatted into yesterday west of Greenwich');

  // ── which members bring guests who join ──
  const pcHostA = pc.hosts!.find((h) => h.hostMemberId === 'hostA')!;
  const pcHostB = pc.hosts!.find((h) => h.hostMemberId === 'hostB')!;
  ok(pc.hosts!.length === 2 && pc.hosts![0].hostMemberId === 'hostA', 'hosts are ranked by guests who joined');
  ok(pcHostA.guests === 4 && pcHostA.identified === 2 && pcHostA.joined === 2 && pcHostA.anonymous === 1,
    'sara issued four guest passes to two identifiable people, both of whom later joined — distinct GUESTS, not distinct passes');
  ok(pcHostA.hostName === 'Sara Ali',
    'the host is named from the roster; holderName on a guest pass is the GUEST’s name and would label every host with their visitor');
  ok(pcHostB.guests === 1 && pcHostB.joined === 0 && pcHostB.undecided === 1,
    'tom brought one guest whose pass is still live — nought joined, and that is not the same as a guest who declined');
  ok(hostsOf(pcPasses.filter((p) => p.kind !== 'guest'), pc.holders!, pcMems).length === 0,
    'drop-ins have no host, so they never appear in the guest table');

  // ── the money: two figures that are never one ──
  ok(pc.money!.passCents === 39000 && pc.money!.passesPriced === 6 && pc.money!.passesTotal === 8,
    'pass income counts only the passes whose price somebody recorded, and says how many that was');
  ok(pc.money!.followingMrrCents === 50000 && pc.money!.followingActive === 3,
    'the memberships that followed are valued per month through gymRecord.summarise — a yearly plan is a twelfth here exactly as it is on /money');
  ok(!('total' in (pc.money as unknown as Record<string, unknown>))
    && !('combinedCents' in (pc.money as unknown as Record<string, unknown>)),
    'and there is NO total field to tempt anyone: AED 390 already in the till plus AED 500 a month that has not been taken is not AED 890 of anything');
  ok(/must not be added/.test(MONEY_NOTE), 'the page says so in words as well');
  ok(pc.money!.mixedCurrency === false, 'one currency here');
  const pcMixed = buildPassConversion(
    { ...pcRec, passes: sliceReady([...pcPasses, pcPass('p9', 'drop_in', 'gus', null, null, '2026-04-01', '2026-04-02', 1, 3000, 'GBP')]) },
    { today: PC_TODAY },
  );
  ok(pcMixed.money!.mixedCurrency === true,
    'sell a pass in a second currency and the total is flagged as adding unlike things');

  // ── a price nobody recorded is not a free pass ──
  const pcUnpriced = buildPassConversion(
    { ...pcRec, passes: sliceReady(pcPasses.map((p) => ({ ...p, paidCents: null }))) },
    { today: PC_TODAY },
  );
  ok(pcUnpriced.money!.passCents === null && pcUnpriced.money!.passesPriced === 0,
    'null, not 0 — a gym reading "pass income: 0.00" after a week of taking cash makes a worse decision than one reading a dash');

  // ── three states, never two ──
  const pcNoRoster: PassConversionRecord = { ...pcRec, memberships: sliceFailed('relation "memberships" does not exist') };
  const pcNR = buildPassConversion(pcNoRoster, { today: PC_TODAY });
  ok(pcNR.passes!.issued === 8 && pcNR.holders === null && pcNR.counts === null && pcNR.joinedAfterRate === null,
    'a failed roster read leaves the pass counts standing and every conversion figure null — not a gym where no pass holder has ever joined');
  ok(/unknown here — not none/.test(pcNR.headline ?? ''), 'and the headline says which');
  ok(pcNR.warning !== null && /whether any pass holder ever joined/.test(pcNR.warning!),
    'the banner names the missing ANSWER, not the missing query');

  const pcNoPasses = buildPassConversion({ ...pcRec, passes: sliceFailed('boom') }, { today: PC_TODAY });
  ok(pcNoPasses.passes === null && pcNoPasses.anonymousPasses === null && pcNoPasses.headline === null,
    'with no passes there is no page, and nothing is claimed — a gym whose pass query failed has not issued nothing');

  const pcNoDoor = buildPassConversion({ ...pcRec, visits: sliceFailed('down') }, { today: PC_TODAY });
  ok(pcNoDoor.redemptionVisits === null && pcNoDoor.redeemedPasses === 7,
    'an unread door log makes door-seen redemptions null rather than 0, while uses_spent still answers how many passes were used');
  ok(pcNoDoor.holders!.every((h) => h.firstUsedOn === null), 'and no pass has a first-use date invented for it');

  const pcNoPlans = buildPassConversion({ ...pcRec, plans: sliceFailed('down') }, { today: PC_TODAY });
  ok(pcNoPlans.money!.followingMrrCents === null && pcNoPlans.money!.passCents === 39000,
    'without the price book the memberships cannot be valued, but what the passes took is still known');

  const pcLoading: PassConversionRecord = {
    passes: sliceLoading(), memberships: sliceLoading(), visits: sliceLoading(), plans: sliceLoading(),
  };
  const pcLd = buildPassConversion(pcLoading, { today: PC_TODAY });
  ok(pcLd.warning === null && pcLd.loading.length === 4 && pcLd.passes === null,
    'still loading is not a failure and not an empty gym — four reads in flight, no figures claimed');

  const pcEmpty = buildPassConversion({
    passes: sliceReady<GymPass>([]), memberships: sliceReady(pcMems),
    visits: sliceReady<Visit>([]), plans: sliceReady(pcPlans),
  }, { today: PC_TODAY });
  ok(pcEmpty.passes!.issued === 0 && pcEmpty.headline === null && pcEmpty.counts!.identified === 0,
    'loaded and genuinely empty is its own third state: nought passes, and no headline pretending to a finding');
  ok(pcEmpty.joinedAfterRate === null && pcEmpty.suppressed === 'no-denominator' && pcEmpty.attributionNote === null,
    'a rate over nobody is nothing, not 0%');

  // ── every holder is accounted for exactly once ──
  ok(pc.counts!.alreadyMember + pc.counts!.joinedAfter + pc.counts!.undecided + pc.counts!.noMembership
    === pc.counts!.identified,
    'the four outcomes partition the identified holders — nobody is double-counted and nobody quietly disappears');
}

/* ── the coach join code ──────────────────────────────────────────────────
 *
 * The code exists because coach→client invites match on an exactly-typed email
 * address, so one mistyped character strands both people silently and forever.
 * These assertions guard the property that makes the replacement safe.
 */
{
  // The alphabet must exclude exactly the glyph pairs people confuse when a
  // code is read aloud, and must keep the ones that merely look similar in
  // print. Getting this wrong is not cosmetic: see the substitution note below.
  for (const c of 'IO01') {
    ok(!CODE_ALPHABET.includes(c), `the generator alphabet excludes ${c}, which is misheard and misread`);
  }
  for (const c of 'LJQ') {
    ok(CODE_ALPHABET.includes(c), `${c} is a VALID code character — anything that "corrects" it corrupts real codes`);
  }
  ok(CODE_LENGTH === 6, 'six characters — short enough to read across a gym floor');
  ok(new Set(CODE_ALPHABET).size === CODE_ALPHABET.length, 'no character appears twice in the alphabet');

  // Formatting a human applies is removed; the characters themselves are not.
  ok(normaliseCode('k7m2qx') === 'K7M2QX', 'lowercase is folded up');
  ok(normaliseCode('K7M-2QX') === 'K7M2QX', 'dashes people add to group a code are dropped');
  ok(normaliseCode('  K7M 2QX  ') === 'K7M2QX', 'surrounding and internal spaces are dropped');
  ok(normaliseCode('K7M2QXYZ') === 'K7M2QX', 'anything past the sixth character is discarded');
  ok(normaliseCode('') === '' && normaliseCode(null as any) === '', 'empty and null normalise to empty, not to a crash');

  // THE ONE THAT MATTERS. An earlier version of normaliseCode folded O→Q and
  // I/1/L→J, reasoning that since the alphabet excludes O and I, any occurrence
  // must be a misreading. But L, J and Q are all valid, and a typed O could
  // equally have been Q, D or G. A fold that lands on a real six-character code
  // connects the client to A DIFFERENT COACH — silently, with nothing on screen
  // that looks wrong to either of them. Failing to find a code costs seconds;
  // this does not announce itself at all.
  ok(normaliseCode('LJQ123') === 'LJQ123', 'L, J and Q survive normalisation unchanged — they are real code characters');
  ok(normaliseCode('QQQQQQ') === 'QQQQQQ', 'Q is never rewritten');
  ok(!isPlausibleCode('OOOOOO'), 'a code of excluded glyphs is rejected, never silently rewritten into a valid one');
  ok(!isPlausibleCode('K7M2QI'), 'one excluded glyph is enough to reject — no guessing what was meant');

  ok(isPlausibleCode('K7M2QX'), 'a well-formed code passes');
  ok(!isPlausibleCode('K7M2Q'), 'five characters is not yet a code, so the button stays disabled');
  ok(!isPlausibleCode(''), 'nothing typed is not a code');

  // Every generated code must pass the client-side check, or the app would
  // reject codes its own database issued.
  const sample = ['ABCDEF', 'K7M2QX', '234567', 'ZZZZZZ', 'LJQ999'];
  for (const c of sample) {
    ok(isPlausibleCode(c), `${c} is drawn from the generator's alphabet and must be accepted`);
  }

  // Failures say what to do. The excluded characters are named HERE, in the
  // message, which is the safe place to help — rather than by rewriting input.
  ok(joinErrorMessage('no coach uses that code').includes('O'),
    'the not-found message names the characters a code never contains, so the reader can spot the misreading themselves');
  ok(joinErrorMessage('that is your own code').includes('own coaching code'),
    'pasting your own code is explained, not reported as a lookup failure');
  ok(joinErrorMessage('not signed in').toLowerCase().includes('sign in'),
    'a signed-out join tells them to sign in first');
  // An unrecognised failure keeps the server's words rather than being
  // flattened into a sentence that tells nobody anything.
  ok(joinErrorMessage('connection reset by peer').includes('connection reset by peer'),
    'an unknown error is passed through rather than replaced with "something went wrong"');
  ok(joinErrorMessage('connection reset by peer').includes('Nothing was sent'),
    'and still says the request did not go anywhere');
  ok(joinErrorMessage(null).includes('nothing was sent'),
    'a failure with no message at all still reports that nothing was sent');
}

if (errors.length) { console.log('COVERAGE FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log(`ALL COVERAGE TESTS PASSED (${checks} assertions)`);
