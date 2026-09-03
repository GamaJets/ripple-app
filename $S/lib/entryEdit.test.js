"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for src/lib/entryEdit.ts — the reading and checking behind TF-02.
//
// Run under every zone the suite runs under, because the half of this file that
// deals in days is only wrong in some of them:
//
//   TZ=America/Los_Angeles node .tmp/lib/entryEdit.test.js
//   TZ=Pacific/Auckland    node .tmp/lib/entryEdit.test.js
//   TZ=Asia/Dubai          node .tmp/lib/entryEdit.test.js
//
// A day test that passes only in Dubai is the exact failure src/lib/localDate.ts
// documents: the author is at UTC+4, the bug belongs to the customer in
// California, and nobody at the keyboard can see it.
const entryEdit_1 = require("./entryEdit");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
/* ── the day an entry belongs to ─────────────────────────────────────────── */
// The round trip is the whole point: whatever instant we build for a day must
// read back as that same day for the person who is standing in that timezone.
const DAYS = [
    '2026-01-01', '2026-02-28', '2026-03-08', '2026-03-29', '2026-06-15',
    '2026-09-27', '2026-10-25', '2026-11-01', '2026-12-31', '2024-02-29',
];
for (const d of DAYS) {
    const iso = (0, entryEdit_1.instantForDay)(d, new Date(2026, 6, 4, 9, 30));
    ok(iso != null, `instantForDay refused a real calendar day: ${d}`);
    ok((0, entryEdit_1.dayKeyOf)(iso) === d, `${d} came back as ${(0, entryEdit_1.dayKeyOf)(iso)} under TZ=${process.env.TZ ?? 'system'}`);
}
// Today keeps the clock. Two sessions logged an hour apart must not collapse
// onto one instant, because the calendar groups by exact `performed_at`.
const now = new Date();
const todayKey = (0, entryEdit_1.dayKeyOfDate)(now);
ok((0, entryEdit_1.instantForDay)(todayKey, now) === now.toISOString(), 'today should keep the real clock time');
ok((0, entryEdit_1.dayKeyOf)((0, entryEdit_1.instantForDay)(todayKey, now)) === todayKey, 'today must still read back as today');
// A day that is not today gets midday rather than the current clock time.
const other = (0, entryEdit_1.instantForDay)('2026-05-04', new Date(2026, 6, 4, 23, 45));
ok((0, entryEdit_1.dayKeyOf)(other) === '2026-05-04', 'a past day must land on that past day');
ok(new Date(other).getHours() === 12, 'a past day should be stamped at local midday');
// Rubbish is refused rather than rolled forward into a month nobody picked.
ok((0, entryEdit_1.instantForDay)('2026-13-45') === null, 'a month of 13 must be refused, not rolled over');
ok((0, entryEdit_1.instantForDay)('not a date') === null, 'unparseable text must be refused');
ok((0, entryEdit_1.instantForDay)('') === null, 'an empty day key must be refused');
// dayKeyOf reads a timestamp in local time, and a bare date as itself.
ok((0, entryEdit_1.dayKeyOf)('2026-08-01') === '2026-08-01', 'a bare date must not shift a day in any zone');
ok((0, entryEdit_1.dayKeyOf)(null) === null, 'no date is null, not a guessed day');
ok((0, entryEdit_1.sameLocalDay)('2026-08-01', '2026-08-01'), 'the same bare date is the same day');
ok(!(0, entryEdit_1.sameLocalDay)('2026-08-01', '2026-08-02'), 'different days must not compare equal');
ok(!(0, entryEdit_1.sameLocalDay)(null, null), 'two unknown days are not "the same day"');
/* ── a corrected meal ────────────────────────────────────────────────────── */
const draft = { name: 'Chicken & rice', kcal: '520', protein: '45', carbs: '60', fat: '9' };
const good = (0, entryEdit_1.readFoodEdit)(draft);
ok(good.ok, 'a complete meal should read');
if (good.ok) {
    ok(good.value.kcal === 520 && good.value.protein === 45, 'figures should survive the read');
}
// A blank macro is "none of that". A blank calorie box is not a figure at all.
const blankFat = (0, entryEdit_1.readFoodEdit)({ ...draft, fat: '' });
ok(blankFat.ok && blankFat.value.fat === 0, 'an emptied macro means none');
ok(!(0, entryEdit_1.readFoodEdit)({ ...draft, kcal: '' }).ok, 'calories may not be left blank');
ok(!(0, entryEdit_1.readFoodEdit)({ ...draft, name: '   ' }).ok, 'a meal needs a name');
// The bug this replaces: `parseInt('abc', 10) || 0` printed a confident zero.
const typo = (0, entryEdit_1.readFoodEdit)({ ...draft, kcal: 'abc' });
ok(!typo.ok, 'unreadable calories must be refused, never read as 0');
const typoMacro = (0, entryEdit_1.readFoodEdit)({ ...draft, protein: '4o' });
ok(!typoMacro.ok, 'unreadable protein must be refused, never read as 0');
ok(!(0, entryEdit_1.readFoodEdit)({ ...draft, kcal: '-10' }).ok, 'negative calories must be refused');
// A decimal comma is what a European or Gulf keyboard offers first.
const comma = (0, entryEdit_1.readFoodEdit)({ ...draft, fat: '9,4' });
ok(comma.ok && comma.value.fat === 9, 'a decimal comma should read as a decimal point');
const before = { name: 'Oats', kcal: 230, protein: 8, carbs: 40, fat: 5 };
ok(!(0, entryEdit_1.foodChanged)(before, { ...before }), 'an untouched meal has not changed');
ok((0, entryEdit_1.foodChanged)(before, { ...before, kcal: 231 }), 'a changed calorie count is a change');
ok((0, entryEdit_1.foodChanged)(before, { ...before, name: 'Oats (60g)' }), 'a renamed meal is a change');
/* ── a corrected workout ─────────────────────────────────────────────────── */
const lift = {
    id: 'w1', t: '2026-05-04T11:00:00.000Z', exercise: 'Squat',
    sets: [[8, 60], [8, 60], [6, 70]], feel: ['ok', 'ok', 'hard'], kcal: 180,
};
const fixed = (0, entryEdit_1.readWorkoutEdit)(lift, { name: 'Back squat', sets: [{ reps: 10, kg: 60 }, { reps: 8, kg: 60 }], mins: '', dist: '', watts: '', kcal: '190' });
ok(fixed.ok, 'a corrected lift should read');
if (fixed.ok) {
    ok(fixed.value.exercise === 'Back squat', 'the rename should carry');
    ok(JSON.stringify(fixed.value.sets) === JSON.stringify([[10, 60], [8, 60]]), 'the corrected sets should carry');
    ok(JSON.stringify(fixed.value.feel) === JSON.stringify(['ok', 'ok']), 'effort must be trimmed to the sets that remain');
    // THE rule: a correction may not move the day. `t` is excluded from the type,
    // so this asserts the shipped object as well as the compiler's opinion of it.
    ok(!('t' in fixed.value), 'a correction must never carry a timestamp');
    ok(!('id' in fixed.value) && !('loggedBy' in fixed.value), 'identity and attribution are not editable here');
}
// Blank calories means unknown, and unknown is null — not zero.
const noKcal = (0, entryEdit_1.readWorkoutEdit)(lift, { name: 'Squat', sets: [{ reps: 8, kg: 60 }], mins: '', dist: '', watts: '', kcal: '' });
ok(noKcal.ok && 'kcal' in noKcal.value && noKcal.value.kcal === undefined, 'blank calories must clear the figure, not zero it');
ok(!(0, entryEdit_1.readWorkoutEdit)(lift, { name: 'Squat', sets: [{ reps: 8, kg: 60 }], mins: '', dist: '', watts: '', kcal: 'lots' }).ok, 'unreadable calories must be refused');
// Emptying every set is a delete, and is named as one rather than written.
ok(!(0, entryEdit_1.readWorkoutEdit)(lift, { name: 'Squat', sets: [], mins: '', dist: '', watts: '', kcal: '' }).ok, 'a lift with no sets left must be refused');
ok(!(0, entryEdit_1.readWorkoutEdit)(lift, { name: '  ', sets: [{ reps: 8, kg: 60 }], mins: '', dist: '', watts: '', kcal: '' }).ok, 'an entry needs an exercise name');
// ── the flags a set carries, through an edit ────────────────────────────────
//
// `bw` and `timed` were read by nobody in the sheet and written by nobody in
// `updateWorkout`, so correcting one set of a calisthenics session converted
// every set in it into an ordinary weighted set worth nothing to any board —
// and a 45-second plank opened in a column headed "Reps".
const holds = {
    id: 'w3', t: '2026-05-04T11:00:00.000Z', exercise: 'Plank',
    sets: [[45, 0], [60, 10]], timed: [true, true], feel: ['ok', 'hard'],
};
const heldFix = (0, entryEdit_1.readWorkoutEdit)(holds, {
    name: 'Plank', sets: [{ reps: 50, kg: 0, timed: true }, { reps: 60, kg: 10, timed: true }],
    mins: '', dist: '', watts: '', kcal: '',
});
ok(heldFix.ok, 'a corrected hold reads');
if (heldFix.ok) {
    ok(JSON.stringify(heldFix.value.timed) === JSON.stringify([true, true]), 'a hold is still a hold after an edit');
    ok(heldFix.value.bw === undefined, 'and nothing invents a bodyweight flag it was not given');
}
const pullups = {
    id: 'w4', t: '2026-05-04T11:00:00.000Z', exercise: 'Pull-up',
    sets: [[10, 0], [8, 0], [6, 20]], bw: [true, true, true], feel: ['easy', 'ok', 'hard'],
};
// Deleting the FIRST set. Every flag and every effort answer below it has to
// move up with its own set — the old code sliced `feel` to a length, which left
// set 2's answer describing set 1.
const cut = (0, entryEdit_1.readWorkoutEdit)(pullups, {
    name: 'Pull-up',
    sets: [{ reps: 0, kg: 0, bw: true }, { reps: 8, kg: 0, bw: true }, { reps: 6, kg: 20, bw: true }],
    mins: '', dist: '', watts: '', kcal: '',
});
ok(cut.ok, 'removing a set reads');
if (cut.ok) {
    ok(JSON.stringify(cut.value.sets) === JSON.stringify([[8, 0], [6, 20]]), 'the two surviving sets carry');
    ok(JSON.stringify(cut.value.bw) === JSON.stringify([true, true]), 'and both are still bodyweight sets');
    ok(JSON.stringify(cut.value.feel) === JSON.stringify(['ok', 'hard']), 'each surviving set keeps its OWN effort answer, not the one above it');
}
// A bodyweight entry corrected into a weighted one clears the array rather than
// leaving a stale one describing sets that are no longer bodyweight.
const nowWeighted = (0, entryEdit_1.readWorkoutEdit)(pullups, {
    name: 'Lat pulldown', sets: [{ reps: 10, kg: 55 }, { reps: 8, kg: 55 }],
    mins: '', dist: '', watts: '', kcal: '',
});
ok(nowWeighted.ok, 'a bodyweight entry corrected to a weighted one reads');
if (nowWeighted.ok) {
    ok('bw' in nowWeighted.value && nowWeighted.value.bw === undefined, 'the bodyweight flags are cleared, and cleared explicitly so the write can send null');
}
const row = {
    id: 'w2', t: '2026-05-04T11:00:00.000Z', exercise: 'Rowing',
    cardio: { mins: 30, dist: 6, unit: 'km', hrAvg: 142, hrHigh: 171 }, kcal: 300,
};
const fixedRow = (0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '35', dist: '7.2', watts: '', kcal: '320' });
ok(fixedRow.ok, 'a corrected cardio session should read');
if (fixedRow.ok) {
    ok(fixedRow.value.cardio?.mins === 35 && fixedRow.value.cardio?.dist === 7.2, 'minutes and distance should carry');
    // Measured by a watch, not typed here — a correction to the minutes must not
    // silently erase the heart rate recorded alongside them.
    ok(fixedRow.value.cardio?.hrAvg === 142 && fixedRow.value.cardio?.hrHigh === 171, 'measured heart rate must survive an edit');
    ok(fixedRow.value.cardio?.unit === 'km', 'the unit the distance was measured in must survive');
    ok(!('sets' in fixedRow.value), 'a cardio correction has no sets to write');
}
const wattsOff = (0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '30', dist: '6', watts: '', kcal: '' });
ok(wattsOff.ok && !('watts' in (wattsOff.value.cardio ?? {})), 'blank watts must be absent, not zero');
ok(!(0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '0', dist: '6', watts: '', kcal: '' }).ok, 'a cardio session with no minutes must be refused');
ok(!(0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '30', dist: 'six', watts: '', kcal: '' }).ok, 'an unreadable distance must be refused');
/* ── five miles logged as five kilometres ─────────────────────────────────
 *
 * The app opened every cardio log on kilometres for everybody until recently,
 * so this is the field on a cardio entry most likely to be wrong — and it was
 * the one field the correction sheet could not touch. `{ ...entry.cardio }`
 * carried the original unit through whatever the sheet showed, so a five-mile
 * run stayed 5 km in the distance total, the calorie estimate and every trend,
 * and the only remedy was to delete the session — which also discards the
 * heart-rate zones nobody can retype.
 */
{
    const toMiles = (0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '30', dist: '6', distUnit: 'mi', watts: '', kcal: '' });
    ok(toMiles.ok, 'a unit correction reads');
    ok(toMiles.ok && toMiles.value.cardio?.unit === 'mi', 'and the unit actually changes');
    ok(toMiles.ok && toMiles.value.cardio?.dist === 6, 'the number is not converted — the member is saying what it always was');
    ok(toMiles.ok && toMiles.value.cardio?.hrAvg === 142, 'and the measured heart rate still survives a unit correction');
    // An omitted unit keeps what the entry had. A caller with no unit control
    // must not be able to rewrite the unit by leaving a field out.
    const untouched = (0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '30', dist: '6', watts: '', kcal: '' });
    ok(untouched.ok && untouched.value.cardio?.unit === 'km', 'an absent unit keeps the original');
    const blank = (0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '30', dist: '6', distUnit: '   ', watts: '', kcal: '' });
    ok(blank.ok && blank.value.cardio?.unit === 'km', 'and so does a blank one');
    const same = (0, entryEdit_1.readWorkoutEdit)(row, { name: 'Rowing', sets: [], mins: '30', dist: '6', distUnit: 'km', watts: '', kcal: '' });
    ok(same.ok && same.value.cardio?.unit === 'km', 'and re-stating the same unit changes nothing');
}
/* ── report ──────────────────────────────────────────────────────────────── */
if (errors.length) {
    console.error(`entryEdit: ${errors.length} failure(s) under TZ=${process.env.TZ ?? 'system'}`);
    for (const e of errors)
        console.error('  ✗ ' + e);
    process.exit(1);
}
console.log(`entryEdit: all assertions passed under TZ=${process.env.TZ ?? 'system'}`);
