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
import { dayKeyOf, dayKeyOfDate, sameLocalDay, instantForDay, readFoodEdit, foodChanged, readWorkoutEdit } from './entryEdit';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

/* ── the day an entry belongs to ─────────────────────────────────────────── */

// The round trip is the whole point: whatever instant we build for a day must
// read back as that same day for the person who is standing in that timezone.
const DAYS = [
  '2026-01-01', '2026-02-28', '2026-03-08', '2026-03-29', '2026-06-15',
  '2026-09-27', '2026-10-25', '2026-11-01', '2026-12-31', '2024-02-29',
];
for (const d of DAYS) {
  const iso = instantForDay(d, new Date(2026, 6, 4, 9, 30));
  ok(iso != null, `instantForDay refused a real calendar day: ${d}`);
  ok(dayKeyOf(iso) === d, `${d} came back as ${dayKeyOf(iso)} under TZ=${process.env.TZ ?? 'system'}`);
}

// Today keeps the clock. Two sessions logged an hour apart must not collapse
// onto one instant, because the calendar groups by exact `performed_at`.
const now = new Date();
const todayKey = dayKeyOfDate(now);
ok(instantForDay(todayKey, now) === now.toISOString(), 'today should keep the real clock time');
ok(dayKeyOf(instantForDay(todayKey, now)) === todayKey, 'today must still read back as today');

// A day that is not today gets midday rather than the current clock time.
const other = instantForDay('2026-05-04', new Date(2026, 6, 4, 23, 45));
ok(dayKeyOf(other) === '2026-05-04', 'a past day must land on that past day');
ok(new Date(other!).getHours() === 12, 'a past day should be stamped at local midday');

// Rubbish is refused rather than rolled forward into a month nobody picked.
ok(instantForDay('2026-13-45') === null, 'a month of 13 must be refused, not rolled over');
ok(instantForDay('not a date') === null, 'unparseable text must be refused');
ok(instantForDay('') === null, 'an empty day key must be refused');

// dayKeyOf reads a timestamp in local time, and a bare date as itself.
ok(dayKeyOf('2026-08-01') === '2026-08-01', 'a bare date must not shift a day in any zone');
ok(dayKeyOf(null) === null, 'no date is null, not a guessed day');
ok(sameLocalDay('2026-08-01', '2026-08-01'), 'the same bare date is the same day');
ok(!sameLocalDay('2026-08-01', '2026-08-02'), 'different days must not compare equal');
ok(!sameLocalDay(null, null), 'two unknown days are not "the same day"');

/* ── a corrected meal ────────────────────────────────────────────────────── */

const draft = { name: 'Chicken & rice', kcal: '520', protein: '45', carbs: '60', fat: '9' };
const good = readFoodEdit(draft);
ok(good.ok, 'a complete meal should read');
if (good.ok) {
  ok(good.value.kcal === 520 && good.value.protein === 45, 'figures should survive the read');
}

// A blank macro is "none of that". A blank calorie box is not a figure at all.
const blankFat = readFoodEdit({ ...draft, fat: '' });
ok(blankFat.ok && blankFat.value.fat === 0, 'an emptied macro means none');
ok(!readFoodEdit({ ...draft, kcal: '' }).ok, 'calories may not be left blank');
ok(!readFoodEdit({ ...draft, name: '   ' }).ok, 'a meal needs a name');

// The bug this replaces: `parseInt('abc', 10) || 0` printed a confident zero.
const typo = readFoodEdit({ ...draft, kcal: 'abc' });
ok(!typo.ok, 'unreadable calories must be refused, never read as 0');
const typoMacro = readFoodEdit({ ...draft, protein: '4o' });
ok(!typoMacro.ok, 'unreadable protein must be refused, never read as 0');
ok(!readFoodEdit({ ...draft, kcal: '-10' }).ok, 'negative calories must be refused');

// A decimal comma is what a European or Gulf keyboard offers first.
const comma = readFoodEdit({ ...draft, fat: '9,4' });
ok(comma.ok && comma.value.fat === 9, 'a decimal comma should read as a decimal point');

const before = { name: 'Oats', kcal: 230, protein: 8, carbs: 40, fat: 5 };
ok(!foodChanged(before, { ...before }), 'an untouched meal has not changed');
ok(foodChanged(before, { ...before, kcal: 231 }), 'a changed calorie count is a change');
ok(foodChanged(before, { ...before, name: 'Oats (60g)' }), 'a renamed meal is a change');

/* ── a corrected workout ─────────────────────────────────────────────────── */

const lift: WorkoutEntry = {
  id: 'w1', t: '2026-05-04T11:00:00.000Z', exercise: 'Squat',
  sets: [[8, 60], [8, 60], [6, 70]], feel: ['ok', 'ok', 'hard'], kcal: 180,
};
const fixed = readWorkoutEdit(lift, { name: 'Back squat', sets: [[10, 60], [8, 60]], mins: '', dist: '', watts: '', kcal: '190' });
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
const noKcal = readWorkoutEdit(lift, { name: 'Squat', sets: [[8, 60]], mins: '', dist: '', watts: '', kcal: '' });
ok(noKcal.ok && 'kcal' in noKcal.value && noKcal.value.kcal === undefined, 'blank calories must clear the figure, not zero it');
ok(!readWorkoutEdit(lift, { name: 'Squat', sets: [[8, 60]], mins: '', dist: '', watts: '', kcal: 'lots' }).ok,
  'unreadable calories must be refused');

// Emptying every set is a delete, and is named as one rather than written.
ok(!readWorkoutEdit(lift, { name: 'Squat', sets: [], mins: '', dist: '', watts: '', kcal: '' }).ok,
  'a lift with no sets left must be refused');
ok(!readWorkoutEdit(lift, { name: '  ', sets: [[8, 60]], mins: '', dist: '', watts: '', kcal: '' }).ok,
  'an entry needs an exercise name');

const row: WorkoutEntry = {
  id: 'w2', t: '2026-05-04T11:00:00.000Z', exercise: 'Rowing',
  cardio: { mins: 30, dist: 6, unit: 'km', hrAvg: 142, hrHigh: 171 }, kcal: 300,
};
const fixedRow = readWorkoutEdit(row, { name: 'Rowing', sets: [], mins: '35', dist: '7.2', watts: '', kcal: '320' });
ok(fixedRow.ok, 'a corrected cardio session should read');
if (fixedRow.ok) {
  ok(fixedRow.value.cardio?.mins === 35 && fixedRow.value.cardio?.dist === 7.2, 'minutes and distance should carry');
  // Measured by a watch, not typed here — a correction to the minutes must not
  // silently erase the heart rate recorded alongside them.
  ok(fixedRow.value.cardio?.hrAvg === 142 && fixedRow.value.cardio?.hrHigh === 171, 'measured heart rate must survive an edit');
  ok(fixedRow.value.cardio?.unit === 'km', 'the unit the distance was measured in must survive');
  ok(!('sets' in fixedRow.value), 'a cardio correction has no sets to write');
}
const wattsOff = readWorkoutEdit(row, { name: 'Rowing', sets: [], mins: '30', dist: '6', watts: '', kcal: '' });
ok(wattsOff.ok && !('watts' in (wattsOff.value.cardio ?? {})), 'blank watts must be absent, not zero');
ok(!readWorkoutEdit(row, { name: 'Rowing', sets: [], mins: '0', dist: '6', watts: '', kcal: '' }).ok,
  'a cardio session with no minutes must be refused');
ok(!readWorkoutEdit(row, { name: 'Rowing', sets: [], mins: '30', dist: 'six', watts: '', kcal: '' }).ok,
  'an unreadable distance must be refused');

/* ── report ──────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`entryEdit: ${errors.length} failure(s) under TZ=${process.env.TZ ?? 'system'}`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`entryEdit: all assertions passed under TZ=${process.env.TZ ?? 'system'}`);
