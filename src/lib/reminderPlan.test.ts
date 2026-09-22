// Reminders: what the saved settings actually schedule.
//
// The failures worth guarding are all silent ones — a reminder that does not
// arrive is indistinguishable from a reminder that was never set, so nothing
// on any screen would report them:
//
//   · an older stored blob with no `days` field switching every existing
//     member's reminders off, because an absent list was read as none;
//   · an EMPTY day list being read as every day, setting a reminder somebody
//     turned off one day at a time;
//   · the weekday numbering drifting off expo-notifications' 1 = Sunday, which
//     wakes people on their rest day;
//   · a hydration window whose end precedes its start being silently repaired
//     into one nobody asked for.
//
// `ok`/`eq` into an errors array and process.exit(1) — never node:assert.
import {
  DAY_LABEL, EMPTY_SAVED, EVERY_DAY, WEEKDAYS_ONLY, daysLabel, plannedNotificationCount,
  plannedReminders, savedFromStored, reminderTrigger, type SavedReminders, type Weekday,
} from './reminderPlan';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const saved = (over: Partial<SavedReminders> = {}): SavedReminders => ({ ...EMPTY_SAVED, ...over });

// ── the weekday convention ───────────────────────────────────────────────
//
// expo-notifications counts 1 = Sunday. JavaScript's Date counts 0 = Sunday.
// The two differ by one, nothing warns about it, and the symptom is a Monday
// reminder that fires on Sunday.
{
  eq(EVERY_DAY.length, 7, 'a week is seven days');
  eq(EVERY_DAY[0], 1, 'AND IT STARTS AT 1 = SUNDAY, which is expo-notifications’ convention and not JavaScript’s');
  eq(EVERY_DAY[6], 7, 'ending at 7 = Saturday');
  eq(DAY_LABEL[1], 'Sun', 'the labels are indexed by the same number, so DAY_LABEL[w] is always right');
  eq(DAY_LABEL[2], 'Mon', 'Monday is 2');
  eq(WEEKDAYS_ONLY.join(','), '2,3,4,5,6', 'and Monday to Friday is 2 through 6');
}

// ── migrating the older blob ─────────────────────────────────────────────
//
// THE ONE THAT WOULD HAVE BROKEN EVERY EXISTING MEMBER. The stored shape had no
// `days` at all and every reminder in it was daily, so an absent list has to
// become every day. Reading it as none silently switches off every reminder
// anybody has ever set.
{
  const old = savedFromStored(JSON.stringify({
    hydration: true, every: 3, startH: 9, endH: 21,
    supps: [{ id: 'r1', name: 'Creatine', hour: 8, minute: 0 }],
    ids: ['a', 'b'],
  }));
  eq(old.hydrationDays.length, 7, 'an older blob’s hydration reminder was daily and stays daily');
  eq(old.supps[0].days.length, 7, 'AND SO DOES ITS SUPPLEMENT — an absent day list is a migration, not an answer');
  eq(old.supps[0].name, 'Creatine', 'the reminder itself survives');
  eq(old.ids.join(','), 'a,b', 'and so do the ids, so the old notifications can still be cancelled');

  // An EMPTY list is different: somebody unticked every day, which is an
  // answer, and turning it back into seven would set a reminder they switched
  // off one day at a time.
  const emptied = savedFromStored(JSON.stringify({ hydrationDays: [], supps: [{ id: 'r1', name: 'X', hour: 8, minute: 0, days: [] }] }));
  eq(emptied.hydrationDays.length, 0, 'AN EMPTY DAY LIST IS AN ANSWER AND STAYS EMPTY');
  eq(emptied.supps[0].days.length, 0, 'and so does an emptied supplement');
}

// ── the store is never trusted blindly ───────────────────────────────────
{
  eq(savedFromStored(null).supps.length, 0, 'nothing stored means the defaults');
  eq(savedFromStored('not json').every, EMPTY_SAVED.every, 'and so does a corrupt blob, rather than a throw');
  const bad = savedFromStored(JSON.stringify({ every: 99, startH: -4, endH: 40, supps: [{ name: '   ' }, { name: 'Ok', hour: 61 }] }));
  eq(bad.every, EMPTY_SAVED.every, 'an out-of-range interval falls back');
  eq(bad.startH, EMPTY_SAVED.startH, 'as does an impossible hour');
  eq(bad.supps.length, 1, 'a reminder with no name is not a reminder');
  eq(bad.supps[0].hour, 8, 'and a bad hour on a real one falls back rather than discarding it');
  const days = savedFromStored(JSON.stringify({ hydrationDays: [1, 9, 'Mon', 3] })).hydrationDays;
  eq(days.join(','), '1,3', 'rubbish inside a day list is dropped and the real days kept');
}

// ── nothing is scheduled on no days ──────────────────────────────────────
{
  eq(plannedReminders(saved({ hydrationDays: [] })).length, 0, 'hydration on no days schedules nothing');
  eq(plannedReminders(saved({ hydration: false })).length, 0, 'and neither does hydration switched off');
  const off = plannedReminders(saved({ hydration: false, fixed: { training: { on: true, hour: 18, minute: 0, days: [] } } }));
  eq(off.length, 0, 'a training reminder on no days schedules nothing either');
  const offSwitch = plannedReminders(saved({ hydration: false, fixed: { training: { on: false, hour: 18, minute: 0, days: [...EVERY_DAY] } } }));
  eq(offSwitch.length, 0, 'nor does one that is switched off, whatever days it remembers');
}

// ── the hydration window ─────────────────────────────────────────────────
{
  const p = plannedReminders(saved({ hydration: true, every: 3, startH: 9, endH: 21, hydrationDays: [...EVERY_DAY] }));
  eq(p.length, 5, '9 to 21 every three hours is 9, 12, 15, 18, 21');
  eq(p[0].hour, 9, 'starting at the first hour');
  eq(p[4].hour, 21, 'and ending on the last');
  // The loop counts up, so a backwards window produces nothing. The screen says
  // so beside the boxes while it can still be corrected; this must NOT silently
  // repair it into a window nobody chose.
  eq(plannedReminders(saved({ startH: 21, endH: 9 })).length, 0,
    'A BACKWARDS WINDOW SCHEDULES NOTHING and is not quietly swapped round');
}

// ── one row is several notifications ─────────────────────────────────────
//
// expo-notifications has no "these days" trigger, only `weekly`, which fires on
// ONE weekday. So a Monday/Wednesday/Friday reminder is three scheduled
// notifications behind one row, and the screen has to count rows rather than
// notifications or "you'll get 3 reminders" reads as nonsense for one reminder.
{
  const mwf: Weekday[] = [2, 4, 6];
  const p = plannedReminders(saved({ hydration: false, fixed: { training: { on: true, hour: 18, minute: 30, days: mwf } } }));
  eq(p.length, 1, 'a training reminder on three days is ONE reminder');
  eq(plannedNotificationCount(p), 3, 'and THREE scheduled notifications');
  eq(p[0].hour, 18, 'at the hour chosen');
  eq(p[0].minute, 30, 'and the minute');
  ok(p[0].route.includes('workouts'), 'routing to the screen it is about');
  ok(p[0].title.length > 0 && p[0].body.length > 0, 'carrying something to say');
}

// ── all three fixed kinds exist and are distinct ─────────────────────────
{
  const all = plannedReminders(saved({
    hydration: false,
    fixed: {
      training: { on: true, hour: 18, minute: 0, days: [...EVERY_DAY] },
      weighin: { on: true, hour: 7, minute: 0, days: [2] },
      photo: { on: true, hour: 8, minute: 0, days: [1] },
    },
  }));
  eq(all.length, 3, 'training, weigh-in and progress photo are three separate reminders');
  eq(new Set(all.map((x) => x.key)).size, 3, 'with distinct keys');
  eq(new Set(all.map((x) => x.title)).size, 3, 'and distinct titles, so three banners are not one repeated');
}

// ── the label under a row ────────────────────────────────────────────────
{
  eq(daysLabel([]), 'Off', 'no days is off, and says so');
  eq(daysLabel([...EVERY_DAY]), 'Every day', 'all seven is not a list of seven abbreviations');
  eq(daysLabel([...WEEKDAYS_ONLY]), 'Weekdays', 'Monday to Friday has a name');
  eq(daysLabel([1, 7]), 'Weekends', 'and so does Saturday and Sunday');
  // In the order the app draws a week, which src/lib/weekStart.ts owns. The
  // 1 = Sunday numbering underneath is expo's and is not the member's problem;
  // what a member does notice is a label that reads in a different order from
  // the day picker directly above it.
  eq(daysLabel([1, 2, 4]), 'Sun, Mon, Wed', 'anything else lists the days in the order the week is drawn');
  eq(daysLabel([4, 1, 2]), 'Sun, Mon, Wed', 'whatever order they were toggled on in');
}

/* ── seven weekdays is one daily reminder, not seven weekly ones ──────────── */
//
// They arrive daily either way, so nothing LOOKS wrong. What goes wrong is the
// budget: iOS holds 64 pending local notifications and silently drops the rest,
// so ten all-days reminders is seventy and the last six never exist.
{
  const t = reminderTrigger([1, 2, 3, 4, 5, 6, 7]);
  eq(t.mode, 'daily', 'every day is a DAILY trigger — one slot, not seven');
}

// Some days is still weekly, one per day, because there is no "these days".
{
  const t = reminderTrigger([2, 4, 6]);
  eq(t.mode, 'weekly', 'a subset stays weekly');
  eq(JSON.stringify(t.mode === 'weekly' ? t.days : null), '[2,4,6]', 'with the days it was given');
}

// Six of seven is NOT daily — the missing day is the whole point of picking.
eq(reminderTrigger([1, 2, 3, 4, 5, 6]).mode, 'weekly', 'six days is not every day');

/* ── nothing chosen schedules nothing ─────────────────────────────────────── */

eq(reminderTrigger([]).mode, 'none', 'no days is no reminder');
eq(reminderTrigger(null).mode, 'none', 'and so is null');
eq(reminderTrigger(undefined).mode, 'none', 'and undefined');

/* ── junk is dropped, never clamped ───────────────────────────────────────── */
//
// Clamping would move a reminder to a day nobody picked, which is worse than
// losing it: the member sees a banner on a day they deliberately left out.
{
  const t = reminderTrigger([0, 8, 3, -1, 99]);
  eq(t.mode, 'weekly', 'the one valid day survives');
  eq(JSON.stringify(t.mode === 'weekly' ? t.days : null), '[3]', 'and nothing was clamped into range');
}

// A duplicate day must not schedule the same banner twice.
{
  const t = reminderTrigger([3, 3, 3]);
  eq(JSON.stringify(t.mode === 'weekly' ? t.days : null), '[3]', 'duplicates collapse');
}

// All seven, given out of order and duplicated, is still daily.
eq(reminderTrigger([7, 1, 3, 5, 2, 6, 4, 4]).mode, 'daily', 'order and duplicates do not hide an all-days pick');

if (errors.length) {
  console.error(`reminderPlan.test.ts — ${errors.length} failures:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('reminderPlan.test.ts — ok');
