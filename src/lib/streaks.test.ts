// The streak walk, across every daylight-saving boundary the running zone has.
//
// ── The fault ──────────────────────────────────────────────────────────────
//
// `currentStreak`, `currentStreakFrozen` and `streakRisk` all stepped backwards
// with `cursor -= 86_400_000` from local midnight, while `dayKey` is
// deliberately LOCAL. That assumes every local day is 24 hours long. Twice a
// year one is 23 and one is 25: on the 23-hour day, local midnight minus a
// fixed day lands at 23:00 of the day BEFORE yesterday, so yesterday is never
// tested at all and a chain the member never broke is reported as broken.
//
// ── Why the sweep, rather than one hand-picked date ────────────────────────
//
// `npm run test:zones` runs this file under six zones, and the transitions are
// in different places in each of them (Auckland moves in April and September,
// Los Angeles in March and November, Dubai and Kiritimati never). A test
// against one date would be a test of one zone. So this walks a whole year,
// day by day, in whatever zone the process is running in, and asserts the same
// invariant on each: a member who trained on N consecutive LOCAL calendar days
// has a streak of N. In UTC, Dubai, Kiritimati and Midway that is a plain
// restatement; in Auckland and Los Angeles it lands on the transition twice.
import { currentStreak, currentStreakFrozen, shownStreak, freezeBudget, streakRisk, activeDays, longestStreak, weekStats, thisWeekStats, statsSince } from './streaks';
import { startOfWeek } from './weekStart';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** An instant at local midday on the given local calendar day. Midday because
 *  it is the one time of day that exists on every calendar day in every zone —
 *  00:00 does not, where the clock springs forward at midnight. */
const middayOn = (y: number, mIdx: number, d: number): Date => new Date(y, mIdx, d, 12, 0, 0, 0);

const entryAt = (at: Date, exercise = 'Squat'): WorkoutEntry =>
  ({ t: at.toISOString(), exercise, sets: [[5, 100]] });

/** `n` consecutive local calendar days ending on the day of `end`, oldest
 *  first, as one entry each at local midday. Built by stepping the calendar,
 *  not by subtracting hours. */
const runEndingAt = (end: Date, n: number): WorkoutEntry[] => {
  const out: WorkoutEntry[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - k, 12, 0, 0, 0);
    out.push(entryAt(d));
  }
  return out;
};

/* ── the sweep: a whole year, one assertion per day ──────────────────────── */

{
  // 2026 is arbitrary in the way that matters (any year has the same two
  // transitions) and deliberate in the way that does not: it is a year every
  // zone in test:zones has a full IANA rule for.
  let failedDays = 0;
  let firstFailure = '';
  const start = middayOn(2026, 0, 1);
  for (let i = 0; i < 365; i++) {
    const today = new Date(2026, 0, 1 + i, 12, 0, 0, 0);
    const log = runEndingAt(today, 5);
    const got = currentStreak(log, today.getTime());
    if (got !== 5) {
      failedDays++;
      if (!firstFailure) firstFailure = `${today.toDateString()} gave ${got}`;
    }
  }
  ok(start.getTime() > 0, 'the year starts somewhere');
  eq(failedDays, 0,
    `five consecutive local days is a five-day streak on every day of the year (first break: ${firstFailure || 'none'})`);
}

// The same sweep for the frozen walk and for the risk flag, which stepped the
// day the same way and broke the same way.
{
  let frozenFailures = 0;
  let riskFailures = 0;
  for (let i = 0; i < 365; i++) {
    const today = new Date(2026, 0, 1 + i, 12, 0, 0, 0);
    const log = runEndingAt(today, 5);
    if (currentStreakFrozen(log, 2, today.getTime()).streak !== 5) frozenFailures++;
    // Trained through yesterday and not today: the streak is at risk tonight.
    const upToYesterday = runEndingAt(new Date(2026, 0, i, 12, 0, 0, 0), 5);
    const r = streakRisk(upToYesterday, today.getTime());
    if (!r.atRisk || r.trainedToday) riskFailures++;
  }
  eq(frozenFailures, 0, 'the frozen walk counts the same five days on every day of the year');
  eq(riskFailures, 0, 'and yesterday is yesterday on every day of the year, so the risk flag never mis-fires');
}

/* ── a freeze still bridges exactly one missing day ──────────────────────── */

{
  const today = middayOn(2026, 5, 15);
  // Trained today (the 15th), missed yesterday, trained the 11th to the 13th.
  const log = [
    ...runEndingAt(new Date(2026, 5, 13, 12, 0, 0, 0), 3),
    entryAt(today),
  ];
  eq(currentStreak(log, today.getTime()), 1, 'without a freeze the chain ends at the gap');
  const f = currentStreakFrozen(log, 1, today.getTime());
  eq(f.streak, 4, 'one freeze bridges the missed day and the chain reaches back to four');
  eq(f.freezesUsed, 1, 'and it spends exactly one');
  const none = currentStreakFrozen(log, 0, today.getTime());
  eq(none.streak, 1, 'no budget, no bridge');
}

// A trailing gap must never spend a freeze: there is nothing older to reach.
{
  const today = middayOn(2026, 5, 15);
  const log = [entryAt(new Date(2026, 5, 14, 12, 0, 0, 0)), entryAt(today)];
  const f = currentStreakFrozen(log, 2, today.getTime());
  eq(f.streak, 2, 'two days is two days');
  eq(f.freezesUsed, 0, 'and the freezes are still in the bank');
}

/* ── an evening session still counts as today ────────────────────────────── */
//
// The reason `dayKey` is local in the first place: 22:00 local rolls into
// tomorrow in UTC across most of the western hemisphere, and the member who
// just trained must not be told their streak is at risk.
{
  const today = new Date(2026, 8, 20, 22, 30, 0, 0);
  const log = [entryAt(today)];
  eq(currentStreak(log, today.getTime()), 1, 'a 22:30 session counts as today');
  eq(streakRisk(log, today.getTime()).trainedToday, true, 'and the risk flag knows it');
  eq(activeDays(log).length, 1, 'one day, whatever UTC says about it');
}

/* ── nothing to count ────────────────────────────────────────────────────── */

{
  const today = middayOn(2026, 5, 15);
  eq(currentStreak([], today.getTime()), 0, 'an empty log is a streak of zero, not a crash');
  eq(currentStreakFrozen([], 2, today.getTime()).streak, 0, 'and so is the frozen walk');
  eq(longestStreak([]), 0, 'and the longest run of nothing is nothing');
  // A gap of two days with a single freeze cannot be bridged.
  const stale = [entryAt(new Date(2026, 5, 10, 12, 0, 0, 0))];
  eq(currentStreak(stale, today.getTime()), 0, 'a chain that ended last week is over');
}

/* ── longestStreak agrees with the walk ──────────────────────────────────── */

{
  const today = middayOn(2026, 2, 30);
  const log = runEndingAt(today, 9);
  eq(longestStreak(log), 9, 'nine consecutive days is a longest run of nine');
  eq(currentStreak(log, today.getTime()), 9, 'and the current streak agrees with it');
}

/* ── one streak figure, not two ──────────────────────────────────────────── */
//
// Home showed the frozen streak in the ring and the raw one in the banner four
// inches above it, and the raw one was what the Milestone Card exported to
// Instagram, what the Activity feed showed and what the Weekly Report handed to
// the model. `shownStreak` is the single answer every one of those now asks for.

{
  const today = middayOn(2026, 5, 15);
  // Eleven active days, one missed day inside them, so there is a freeze in the
  // bank (one per ten active days) and something for it to bridge.
  const log = [
    ...runEndingAt(new Date(2026, 5, 13, 12, 0, 0, 0), 11),
    entryAt(today),
  ];
  const raw = currentStreak(log, today.getTime());
  const shown = shownStreak(log, today.getTime());
  ok(shown > raw, 'the freeze the app granted is reflected in the figure the member is shown');
  eq(shown, currentStreakFrozen(log, freezeBudget(log), today.getTime()).streak,
    'and it is exactly the frozen walk over the budget the log earned — no second opinion about either');
}

{
  // No freeze earned yet: the two answers must agree, or every unfrozen member
  // would see a different number for no reason.
  const today = middayOn(2026, 5, 15);
  const log = runEndingAt(today, 3);
  eq(shownStreak(log, today.getTime()), currentStreak(log, today.getTime()),
    'with nothing to bridge the shown streak is the plain chain');
  eq(shownStreak([], today.getTime()), 0, 'and an empty log is zero, not a crash');
}


/* ── a calendar week is not a rolling one ─────────────────────────────────── */
//
// `weekStats` is a rolling 168 hours and its docstring always said so.
// app/(client)/dashboard.tsx, restday.tsx and report.tsx printed it under the
// words "this week" anyway, while week.tsx, trends.tsx and consistency.tsx
// measured the same phrase with `startOfWeek`. The sharpest consequence was the
// goal ring on Home reading "4 of 4 this week · goal met" on a Monday morning
// to somebody who had not trained since the week opened.
//
// No literal date is asserted anywhere below — `npm test` runs under six
// timezones and the whole point of this window is that it is LOCAL — so every
// instant is built from `startOfWeek` of a chosen `now`.

{
  // A Wednesday, mid-afternoon local. Built from local parts, never parsed from
  // a bare string: `new Date('2026-09-02')` is UTC midnight and is the day
  // before west of Greenwich, which would move the week under half the world.
  const now = new Date(2026, 8, 2, 15, 0, 0).getTime();
  const weekOpened = startOfWeek(now).getTime();
  const HOUR = 3600_000;

  const entry = (t: number): WorkoutEntry =>
    ({ t: new Date(t).toISOString(), exercise: 'Bench', sets: [[8, 60]] } as WorkoutEntry);

  // One session an hour after the week opened, and one six hours BEFORE it —
  // last week, by a few hours, and inside a rolling seven days either way.
  const log = [entry(weekOpened + HOUR), entry(weekOpened - 6 * HOUR)];

  eq(thisWeekStats(log, now).workouts, 1,
    'the calendar week counts only what was done since the week opened');
  eq(weekStats(log, now).workouts, 2,
    'and the rolling window still counts both, which is what it is for');
  ok(thisWeekStats(log, now).workouts !== weekStats(log, now).workouts,
    'the two windows are genuinely different answers, which is why one screen may not print the other’s figure under the other’s caption');

  // The Monday-morning case that produced "goal met" over a week with nothing
  // in it. Everything logged last week, nothing since the week opened.
  const lastWeekOnly = [entry(weekOpened - 6 * HOUR), entry(weekOpened - 30 * HOUR)];
  eq(thisWeekStats(lastWeekOnly, now).workouts, 0,
    'a week with nothing done in it counts nought, however busy the seven days before it were');
  eq(thisWeekStats(lastWeekOnly, now).days, 0, 'and no active days either');

  // The boundary itself: an entry AT the opening instant is in the week.
  eq(thisWeekStats([entry(weekOpened)], now).workouts, 1,
    'the instant the week opened belongs to the week it opened');
  eq(thisWeekStats([entry(weekOpened - 1)], now).workouts, 0,
    'and the millisecond before it does not');

  // The engine both windows share. The report screen states a span and now
  // counts exactly that span, which is what this is for.
  eq(statsSince(log, weekOpened).workouts, thisWeekStats(log, now).workouts,
    'the calendar week is statsSince from the moment the week opened, and nothing else');
  eq(statsSince(log, 0).workouts, 2, 'and an open window counts everything');

  // Nothing is invented from an empty log.
  eq(thisWeekStats([], now).workouts, 0, 'an empty log is nought sessions');
  eq(thisWeekStats([], now).volumeKg, 0, 'and nought volume');
  eq(thisWeekStats([], now).unpricedSets, 0, 'with no unpriced sets to declare');
}

if (errors.length) { errors.forEach((e) => console.error(e)); console.error(`streaks: ${errors.length} failure(s)`); process.exit(1); }
console.log('streaks: ok — the day walk follows the calendar, not a fixed 86,400,000 ms');
