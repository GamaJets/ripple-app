// Per-habit streaks: what the rows support, and what they do not.
//
// Three things are being defended here and each one has already shipped as a
// bug somewhere in this codebase:
//
//   1. A GAP IS NOT A ZERO. A day with no row is a day nobody recorded, and it
//      must not end a run — nor quietly extend one. It is stepped over and
//      counted separately.
//   2. THE DAY BOUNDARY IS THE MEMBER'S. Every day key here is a bare
//      YYYY-MM-DD compared as a string. The suite is run under
//      Pacific/Kiritimati (UTC+14), Pacific/Midway (UTC-11), Pacific/Auckland
//      and Europe/Berlin (both with clocks changes) as well as UTC, and every
//      assertion must hold identically in all of them.
//   3. A TRUNCATED READ IS NOT A SHORT HISTORY. A run that reaches the bottom
//      of what could be read is a FLOOR, and saying "4" to somebody on 180 is
//      the defect src/lib/streakReach.ts was written for.
//
// Compile with tsc, then run under plain node.
import {
  habitStreaks, streakFor, previousDay, nextDay, daysBefore, habitStreakFigure,
  habitStreakNote, habitStreakCaveat, STREAK_WINDOW_DAYS,
  type HabitTickRow, type HabitStreak,
} from './habitStreaks';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/** What a habit with no row anywhere in the window looks like to a screen
 *  holding a list from `buildChecklist`: a real zero-run, not a missing entry. */
const NO_ROWS: HabitStreak = {
  habit: 'water', days: 0, silentDays: 0, silentAbove: 0,
  from: null, bounded: false, lastTicked: null, totalDays: 0,
};

/** Rows for one habit on the given days. */
const ticks = (habit: string, days: string[]): HabitTickRow[] =>
  days.map((d) => ({ habit, done_on: d }));

/** The run for one habit, or a thrown-shaped failure the assertions can read. */
const run = (rows: HabitTickRow[], today: string, coverFrom?: string | null): HabitStreak => {
  const s = streakFor(habitStreaks(rows, today, { coverFrom }), 'water');
  return s ?? NO_ROWS;
};

/* ── 1. stepping a day is calendar arithmetic, never 86,400,000 ───────────── */

eq(previousDay('2026-09-13'), '2026-09-12', 'the day before the 13th');
eq(previousDay('2026-09-01'), '2026-08-31', 'and across a month edge');
eq(previousDay('2026-01-01'), '2025-12-31', 'and across a year edge');
eq(previousDay('2028-03-01'), '2028-02-29', 'and into a leap day');

// The two days a year that are not 24 hours long. Subtracting a fixed day from
// local midnight lands on the wrong calendar day on one of them and on the
// right one by luck on the other — the defect src/lib/streaks.ts documents in
// its own cursor, and the one Lane 8 hit in streakReach.ts. These are the
// European and Antipodean transition dates; under TZ=Europe/Berlin and
// TZ=Pacific/Auckland one of each pair is a short day and one is a long one.
eq(previousDay('2026-03-29'), '2026-03-28', 'the day the European clocks spring forward');
eq(previousDay('2026-03-30'), '2026-03-29', 'and the day after it');
eq(previousDay('2026-10-25'), '2026-10-24', 'the day the European clocks go back');
eq(previousDay('2026-09-27'), '2026-09-26', 'the day the New Zealand clocks spring forward');
eq(previousDay('2026-04-05'), '2026-04-04', 'and the day they go back');

// The whole calendar days that never existed locally. Samoa skipped 30
// December 2011 and Kiritimati skipped 31 December 1994, crossing the date
// line. A local `Date` stepped with `setDate` normalises a day the zone does
// not have back to one it does and so does not move at all — under TZ=Pacific/Apia
// the midday cursor answered 31 December to "the day before 31 December", which
// is a walk that never terminates. The label arithmetic has no zone to consult.
eq(previousDay('2011-12-31'), '2011-12-30', 'the day before the day Samoa skipped');
eq(previousDay('2011-12-30'), '2011-12-29', 'and the day Samoa skipped has a day before it too');
eq(previousDay('1995-01-01'), '1994-12-31', 'the day Kiritimati skipped');

// A date that matches the shape and is not a day. The regex cannot tell; the
// arithmetic can, and a run walked through one would be walking through
// nothing.
eq(previousDay('2026-02-30'), null, 'the thirtieth of February is not a date');
eq(previousDay('2026-13-01'), null, 'nor is a thirteenth month');
eq(previousDay('2026-00-10'), null, 'nor a zeroth one');
eq(previousDay('2027-02-29'), null, 'nor a leap day in a year that has none');
eq(previousDay('2028-02-29'), '2028-02-28', 'though a real one steps normally');

eq(previousDay('not a day'), null, 'an unreadable day steps nowhere');
eq(previousDay('2026-09-13T10:00:00Z'), null, 'and neither does a timestamp — this takes day keys');

// `nextDay` is the mirror, and the provider leans on it for one thing: on a
// truncated read the oldest day that came back is itself a partial day, so the
// oldest day that can be SPOKEN FOR is the one above it.
eq(nextDay('2026-09-12'), '2026-09-13', 'the day after the 12th');
eq(nextDay('2026-08-31'), '2026-09-01', 'and across a month edge');
eq(nextDay('2025-12-31'), '2026-01-01', 'and across a year edge');
eq(nextDay('2028-02-28'), '2028-02-29', 'into a leap day');
eq(nextDay('2027-02-28'), '2027-03-01', 'and over one in a year that has none');
eq(nextDay('2011-12-29'), '2011-12-30', 'the day Samoa skipped is still a label');
eq(nextDay('2026-02-30'), null, 'a date that never existed steps nowhere');

// Round trips, including over every edge above.
for (const d of ['2026-09-13', '2026-03-01', '2026-01-01', '2028-03-01', '2012-01-01', '2011-12-30']) {
  eq(nextDay(previousDay(d)!), d, `${d} survives a step down and back`);
  eq(previousDay(nextDay(d)!), d, `${d} survives a step up and back`);
}

// `daysBefore` is `previousDay` applied n times and nothing cleverer, because a
// step is the only operation this file has that is known to be right.
eq(daysBefore('2026-09-13', 0), '2026-09-13', 'nought days before today is today');
eq(daysBefore('2026-09-13', 1), '2026-09-12', 'one day before');
eq(daysBefore('2026-09-13', STREAK_WINDOW_DAYS - 1), '2026-06-15', 'the window opens thirteen weeks back');
eq(daysBefore('2026-09-13', -1), null, 'a negative span is refused rather than walked');
eq(daysBefore('2026-09-13', Number.NaN), null, 'and so is an unusable one');
eq(daysBefore('2026-09-13', 99999), null, 'and one past the guard');
eq(daysBefore('rubbish', 3), null, 'an unreadable day has no day before it');
eq(STREAK_WINDOW_DAYS, 91, 'thirteen weeks — see the note on the constant');

/* ── 2. the plain run ─────────────────────────────────────────────────────── */

const TODAY = '2026-09-13';

{
  const r = run(ticks('water', ['2026-09-13', '2026-09-12', '2026-09-11']), TODAY);
  eq(r.days, 3, 'three days in a row, ending today');
  eq(r.silentDays, 0, 'with no holes in it');
  eq(r.from, '2026-09-11', 'and it opened on the 11th');
  eq(r.bounded, false, 'nothing truncated it');
  eq(r.lastTicked, '2026-09-13', 'last ticked today');
  eq(r.totalDays, 3, 'three ticked days on the record');
}

// Today is not over. `currentStreak` in src/lib/streaks.ts anchors on yesterday
// when nothing is logged today, and adherence.ts ends its window yesterday for
// the same reason: "A line unticked at 9am is not a line missed."
{
  const r = run(ticks('water', ['2026-09-12', '2026-09-11', '2026-09-10']), TODAY);
  eq(r.days, 3, 'a run ending yesterday is still a run — today is not over');
  eq(r.from, '2026-09-10', 'and it is dated from the 10th');
}

/* ── 3. A GAP IS NOT A ZERO ───────────────────────────────────────────────── */

// The whole point. The 11th has no row for anything, so nobody recorded it. It
// does not end the run and it is not counted as a day kept.
{
  const rows = [
    ...ticks('water', ['2026-09-13', '2026-09-12', '2026-09-10', '2026-09-09']),
  ];
  const r = run(rows, TODAY);
  eq(r.days, 4, 'a silent day does not end the run');
  eq(r.silentDays, 1, 'and it is not counted as a day kept either');
  eq(r.from, '2026-09-09', 'the run opens below the hole');
  eq(r.days + r.silentDays, 5, 'four kept days across five calendar days');
}

// The other half of the same rule. On the 11th the member ticked SOMETHING —
// so they were standing in front of the list and left this line. That is the
// one day this module is willing to call a miss, and it ends the run.
{
  const rows = [
    ...ticks('water', ['2026-09-13', '2026-09-12', '2026-09-10', '2026-09-09']),
    ...ticks('steps', ['2026-09-11']),
  ];
  const r = run(rows, TODAY);
  eq(r.days, 2, 'a day they were in the app and left this line ends the run');
  eq(r.silentDays, 0, 'and there is no hole inside what is left');
  eq(r.from, '2026-09-12', 'the run is the 12th and the 13th');
  eq(r.bounded, false, 'the day that ended it was read, so the figure is a fact');
  eq(r.totalDays, 4, 'the older ticks are still on the record');
}

// The same two days, one row apart. This pair is the assertion that the
// distinction is load-bearing rather than decorative: identical rows for
// 'water', and the answer moves from 4 to 2 on the presence of somebody else's
// tick on the gap day.
{
  const silent = run(ticks('water', ['2026-09-13', '2026-09-12', '2026-09-10', '2026-09-09']), TODAY);
  const missed = run([
    ...ticks('water', ['2026-09-13', '2026-09-12', '2026-09-10', '2026-09-09']),
    ...ticks('sleep', ['2026-09-11']),
  ], TODAY);
  ok(silent.days !== missed.days, 'a silent gap and a demonstrated miss are not the same day');
}

// Leading silence. Nothing was recorded yesterday OR today, and the run below
// is still alive: the anchor steps over both.
{
  const r = run(ticks('water', ['2026-09-11', '2026-09-10', '2026-09-09']), TODAY);
  eq(r.days, 3, 'silence above a run does not end it');
  eq(r.silentDays, 0, 'and the silence above it is not inside it');
  eq(r.from, '2026-09-09', 'the run is the 9th to the 11th');
}

// Silence with nothing under it. The member ticked water once, four days ago,
// and nothing at all since. Nothing has ENDED that run — there is no day they
// were in the app and left the line — so it is still a run of one. What is
// wrong with printing "1 day running" over it is that the run stopped being
// KEPT UP four days ago, and that is `silentAbove` rather than a smaller
// figure. The first version of this file added those four days into
// `silentDays` and called it a run of one across five days, which is a
// different and false claim.
{
  const r = run(ticks('water', ['2026-09-09']), TODAY);
  eq(r.days, 1, 'one ticked day is a run of one');
  eq(r.silentDays, 0, 'the days above it are not a hole INSIDE the run');
  eq(r.silentAbove, 3, 'they are the silence above it, counted on its own');
  eq(r.lastTicked, '2026-09-09', 'and it says when that was');
  ok(habitStreakNote(r).includes('has not been broken'),
    'and the note leads with the gap rather than with the figure');
  eq(habitStreakCaveat(r), 'silence', 'the figure needs a sentence under it');
}

// A run of two across ninety days of silence is two, and it says how wide it
// is. This is the case that would read as a two-day run if `silentDays` were
// folded in or dropped.
{
  const r = run(ticks('water', ['2026-09-13', '2026-06-15']), TODAY);
  eq(r.days, 2, 'two ticked days');
  eq(r.silentDays, 89, 'across eighty-nine days nobody recorded');
  eq(r.silentAbove, 0, 'the run reaches today, so none of the silence is above it');
  eq(r.days + r.silentDays, 91, 'two kept days across ninety-one');
  ok(habitStreakNote(r).includes('nothing recorded at all'), 'and the note says so');
  ok(habitStreakNote(r).includes('91'), 'and states the span so two cannot read as two days');
}

/* ── 4. a floor, not a fact ───────────────────────────────────────────────── */

// The run reaches the oldest day the read can speak for. It may continue below
// it, so the figure is a floor — streakReach.ts's argument, one table over.
{
  const days = ['2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10'];
  const r = run(ticks('water', days), TODAY, '2026-09-10');
  eq(r.days, 4, 'four days read');
  eq(r.bounded, true, 'and the run runs off the bottom of the read');
  eq(habitStreakFigure(r).unit, 'days or more', 'so the unit says it is a floor');
  eq(habitStreakCaveat(r), 'read', 'and the caveat names the reason');
}

// The same rows, read whole. Nothing truncated it, so it is a figure.
{
  const days = ['2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10'];
  const r = run(ticks('water', days), TODAY, '2026-08-01');
  eq(r.bounded, false, 'a run that ended above the boundary is a fact');
  eq(habitStreakFigure(r).unit, 'days', 'and is spoken as one');
  eq(habitStreakCaveat(r), null, 'with nothing to qualify');
}

// A run ended by a MISS at the boundary is still a fact: the day that ended it
// was read. Bounded is about the run reaching past what we can see, and this
// one did not.
{
  const rows = [
    ...ticks('water', ['2026-09-13', '2026-09-12', '2026-09-11']),
    ...ticks('steps', ['2026-09-10']),
  ];
  const r = run(rows, TODAY, '2026-09-10');
  eq(r.days, 3, 'the run is three');
  eq(r.bounded, false, 'and the day that ended it was inside the read');
}

// No run, no floor. `bounded` qualifies a figure; with no figure there is
// nothing to qualify, and "0 days or more" is a sentence with no content.
{
  const rows = [...ticks('water', ['2026-06-15']), ...ticks('steps', ['2026-09-12'])];
  const r = run(rows, TODAY, '2026-06-01');
  eq(r.days, 0, 'they were in the app yesterday and left this line, so no run');
  eq(r.bounded, false, 'so there is nothing for the boundary to bound');
  eq(habitStreakCaveat(r), null, 'and nothing to caveat');
  eq(r.lastTicked, '2026-06-15', 'the older tick is still on the record');
}

// The lone June tick with a boundary UNDER it. The run may well continue below
// what was read, so even a run of one is a floor.
{
  const r = run(ticks('water', ['2026-06-15']), TODAY, '2026-06-15');
  eq(r.days, 1, 'nothing has ended it, so it is a run of one');
  eq(r.bounded, true, 'and it reaches the bottom of the read, so it may be longer');
  eq(habitStreakFigure(r).unit, 'day or more', 'stated as a floor');
}

// Both qualifiers at once. A run with a hole in it that ALSO reaches the
// bottom of the read is wider than it looks and longer than it says, and the
// screen has to be told both.
{
  const r = run(ticks('water', ['2026-09-13', '2026-09-11', '2026-09-10']), TODAY, '2026-09-10');
  eq(r.days, 3, 'three ticked days');
  eq(r.silentDays, 1, 'one silent day inside the run');
  eq(r.bounded, true, 'and the run reaches the bottom of the read');
  eq(habitStreakCaveat(r), 'both', 'both facts are carried');
  const note = habitStreakNote(r);
  ok(note.includes('may well be longer'), 'the note says it may be longer');
  ok(note.includes('neither kept nor skipped'), 'and that the hole is neither');
}

// A PARTIAL WINDOW IS NOT A SHORT HISTORY. The same member, same run, read two
// ways: the truncated read must not report a SMALLER figure as the figure. It
// reports the same count and says it is a floor.
{
  const days: string[] = [];
  for (let i = 0; i < 40; i++) days.push(previousDay(i === 0 ? '2026-09-14' : days[i - 1])!);
  // Strictly older than the run's oldest day (5 August), so the run demonstrably
  // ended above the line rather than at it.
  const whole = run(ticks('water', days), TODAY, '2026-08-01');
  const cut = run(ticks('water', days.slice(0, 10)), TODAY, '2026-09-04');
  eq(whole.days, 40, 'forty days read whole');
  eq(whole.bounded, false, 'and stated as a figure');
  eq(cut.days, 10, 'ten days is all the truncated read holds');
  eq(cut.bounded, true, 'so it is a floor and never presented as a ten-day history');
  ok(habitStreakFigure(cut).unit.includes('or more'), 'the unit carries the floor');
}

/* ── 5. several habits at once ────────────────────────────────────────────── */

{
  const rows = [
    ...ticks('water', ['2026-09-13', '2026-09-12', '2026-09-11']),
    ...ticks('steps', ['2026-09-13']),
    ...ticks('coach:8f3e', ['2026-09-11', '2026-09-10']),
  ];
  const list = habitStreaks(rows, TODAY);
  eq(list.length, 3, 'one entry per habit in the rows');
  eq(list[0].habit, 'water', 'longest run first');
  eq(streakFor(list, 'steps')?.days, 1, 'a one-day run is a run');
  // 'coach:8f3e' was not ticked on the 12th or the 13th, and the member WAS in
  // the app on both — so those are misses and the run is over.
  eq(streakFor(list, 'coach:8f3e')?.days, 0, 'a coach line left on two days they were in the app has no run');
  eq(streakFor(list, 'coach:8f3e')?.lastTicked, '2026-09-11', 'and it still says when it was last kept');
  eq(streakFor(list, 'sleep'), null, 'a habit with no row in the window is absent, not a zero');
}

// A total order, so the same rows do not render in two orders. Two habits with
// identical runs are separated by the tie-breaks rather than by luck.
{
  const rows = [
    ...ticks('zeta', ['2026-09-13', '2026-09-12']),
    ...ticks('alpha', ['2026-09-13', '2026-09-12']),
  ];
  const a = habitStreaks(rows, TODAY).map((s) => s.habit).join(',');
  const b = habitStreaks([...rows].reverse(), TODAY).map((s) => s.habit).join(',');
  eq(a, 'alpha,zeta', 'ties fall to the habit id');
  eq(a, b, 'and the order does not depend on the order the rows arrived in');
}

/* ── 6. rows this module refuses ──────────────────────────────────────────── */

{
  const rows: HabitTickRow[] = [
    ...ticks('water', ['2026-09-13', '2026-09-12']),
    // A device with a wrong clock flushing a queued tick. A row dated tomorrow
    // is not evidence about a day nobody has lived, and admitting one would
    // start a run from it.
    { habit: 'water', done_on: '2026-09-14' },
    { habit: 'water', done_on: 'whenever' },
    { habit: '', done_on: '2026-09-11' },
  ];
  const r = run(rows, TODAY);
  eq(r.days, 2, 'a tomorrow row, an unreadable one and a nameless one are all dropped');
  eq(r.lastTicked, '2026-09-13', 'and today is still the last day ticked');
  eq(r.totalDays, 2, 'the count is of days the record can stand behind');
}

// Duplicates. The unique constraint on (user_id, habit, done_on) should make
// this impossible; a count that can exceed its own span is not a guarantee a
// function gets to rely on when it is handed an array. adherence.ts defends
// the same way.
{
  const r = run(ticks('water', ['2026-09-13', '2026-09-13', '2026-09-12']), TODAY);
  eq(r.days, 2, 'a repeated row is one day');
  eq(r.totalDays, 2, 'and one day in the count');
}

// A timestamp where a date belongs. `done_on` is a Postgres `date`, but a row
// that arrived as a timestamptz must not be parsed — the first ten characters
// are the day as it was written.
{
  const r = run([{ habit: 'water', done_on: '2026-09-13T23:30:00+00:00' }], TODAY);
  eq(r.days, 1, 'the day is read off the front of the string, never parsed');
}

eq(habitStreaks(ticks('water', ['2026-09-13']), 'not a day').length, 0,
  'an unreadable today produces no streaks rather than streaks against a day nobody is in');
eq(habitStreaks([], TODAY).length, 0, 'no rows, no streaks');
eq(streakFor([], 'water'), null, 'and nothing to look up in an empty list');

// A coverFrom that cannot be read is no boundary rather than a boundary at an
// invented date — which would mark every run a floor, or none.
{
  const r = run(ticks('water', ['2026-09-13', '2026-09-12']), TODAY, 'rubbish');
  eq(r.days, 2, 'an unreadable boundary does not shorten the run');
  eq(r.bounded, false, 'nor is it treated as one the run reached');
}

/* ── 7. the copy ──────────────────────────────────────────────────────────── */

{
  const r = run(ticks('water', ['2026-09-13', '2026-09-12']), TODAY);
  eq(habitStreakFigure(r).figure, 2, 'the figure is the count');
  eq(habitStreakFigure(r).unit, 'days', 'and the unit agrees with it');
}
{
  const r = run(ticks('water', ['2026-09-13']), TODAY);
  eq(habitStreakFigure(r).unit, 'day', 'one day, singular');
}
{
  const r = run(ticks('water', ['2026-09-13']), TODAY, '2026-09-13');
  eq(habitStreakFigure(r).unit, 'day or more', 'and singular under a floor too');
}

// Nothing in the copy calls a member a failure, on any branch. The only day
// this module will call a miss is one they were demonstrably in the app for,
// and that is still not something to score them on.
{
  const samples: HabitStreak[] = [
    run(ticks('water', ['2026-09-13', '2026-09-12']), TODAY),
    run(ticks('water', ['2026-09-13', '2026-09-11']), TODAY),
    run(ticks('water', ['2026-09-13', '2026-09-12']), TODAY, '2026-09-12'),
    run(ticks('water', ['2026-06-15']), TODAY),
    run([], TODAY),
  ];
  for (const s of samples) {
    const note = habitStreakNote(s);
    ok(note.length > 0, 'every branch says something');
    // 'skipped' and 'broken' both appear in this file's copy, and both appear
    // being DENIED — "not the same as a day you skipped", "it has not been
    // broken". The words this bans are the ones that have no honest use in a
    // sentence about somebody's own habits.
    for (const word of ['fail', 'you lost', 'let yourself', 'should have', 'only ']) {
      ok(!note.toLowerCase().includes(word), `the note never says "${word}" — got: ${note}`);
    }
  }
}

// The empty case: a line on today's checklist that has no row anywhere in the
// window. The screen has one of these for every habit the member has never
// ticked, and the sentence must say the record is silent rather than that they
// did nothing.
{
  ok(habitStreakNote(NO_ROWS).includes('not the same as a day you skipped'),
    'no rows at all is said as an absence rather than as a failure');
  eq(habitStreakCaveat(NO_ROWS), null, 'and there is no figure to qualify');
  eq(habitStreakFigure(NO_ROWS).figure, 0, 'the figure is nought');
}

/* ── 8. the boundary is the member's day, in every zone ───────────────────── */
//
// Every assertion in this file is a bare day key and none of them is parsed,
// so the suite's answers cannot move with the zone. This one states that
// outright at the edges the runner is pointed at: UTC+14 and UTC-11 are
// twenty-five hours apart, and a single `Date.parse('2026-09-13')` anywhere in
// the walk would move a run by a day in one of them.
{
  const rows = ticks('water', ['2026-09-13', '2026-09-12', '2026-09-11']);
  const r = run(rows, TODAY);
  eq(r.days, 3, 'the run is three days wherever this suite is run');
  eq(r.from, '2026-09-11', 'and opens on the same calendar day in every zone');
  // A run crossing a clocks change in the runner's own zone. Under
  // Europe/Berlin the 25th of October 2026 is a 25-hour day and the 29th of
  // March is a 23-hour one; under Pacific/Auckland the 5th of April and the
  // 27th of September are the pair. A ms-subtraction walk loses or repeats a
  // day on one of each.
  const spring = run(ticks('water', ['2026-03-30', '2026-03-29', '2026-03-28']), '2026-03-30');
  eq(spring.days, 3, 'three days across the spring clocks change');
  eq(spring.from, '2026-03-28', 'opening on the 28th');
  const autumn = run(ticks('water', ['2026-10-26', '2026-10-25', '2026-10-24']), '2026-10-26');
  eq(autumn.days, 3, 'three days across the autumn clocks change');
  eq(autumn.from, '2026-10-24', 'opening on the 24th');
  const nz = run(ticks('water', ['2026-09-28', '2026-09-27', '2026-09-26']), '2026-09-28');
  eq(nz.days, 3, 'three days across the New Zealand spring change');
  const nzAutumn = run(ticks('water', ['2026-04-06', '2026-04-05', '2026-04-04']), '2026-04-06');
  eq(nzAutumn.days, 3, 'three days across the New Zealand autumn change');
  // A run across the day Samoa did not have. Under TZ=Pacific/Apia a Date-based
  // walk stalls on 31 December and reports whatever the safety guard stops it
  // at; this must be four, everywhere.
  const apia = run(ticks('water', ['2012-01-01', '2011-12-31', '2011-12-30', '2011-12-29']), '2012-01-01');
  eq(apia.days, 4, 'four days across the day Samoa skipped');
  eq(apia.from, '2011-12-29', 'and the run opens where the calendar says');
}

// A long run stepped a day at a time over a year of clocks changes. An
// off-by-one anywhere in the walk shows up here as a figure that is not 400.
{
  const days: string[] = ['2026-09-13'];
  for (let i = 1; i < 400; i++) days.push(previousDay(days[i - 1])!);
  const r = run(ticks('water', days), TODAY);
  eq(r.days, 400, 'four hundred consecutive days is four hundred in every zone');
  eq(r.silentDays, 0, 'with no hole invented by a clocks change');
  eq(r.from, days[399], 'and it opens where the walk says it does');
}

/* ── 9. the safety guard is a floor, not a quiet stop ─────────────────────── */
//
// Every bound the walk has comes from data. A malformed one — a row dated in
// the year 200, a window computed off a NaN — would otherwise walk a day at a
// time for as long as the arithmetic allowed. The guard stops it, and stopping
// for OUR reasons rather than the member's is exactly what `bounded` means: a
// guard that stopped quietly would report ten years as the whole of a longer
// run, as a fact.
{
  const days: string[] = ['2026-09-13'];
  for (let i = 1; i < 3700; i++) days.push(previousDay(days[i - 1])!);
  const r = run(ticks('water', days), TODAY);
  eq(r.days, 3660, 'the walk stops at the ten-year guard');
  eq(r.bounded, true, 'and says the run may be longer rather than stating ten years as the figure');
  ok(habitStreakFigure(r).unit.includes('or more'), 'the unit carries it');
}

if (errors.length) {
  console.error(`habitStreaks: ${errors.length} failure(s)`);
  for (const e of errors) console.error(' ·', e);
  process.exit(1);
}
console.log('habitStreaks: all assertions passed');
