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
import { currentStreak, currentStreakFrozen, streakRisk, activeDays, longestStreak } from './streaks';
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

if (errors.length) { errors.forEach((e) => console.error(e)); console.error(`streaks: ${errors.length} failure(s)`); process.exit(1); }
console.log('streaks: ok — the day walk follows the calendar, not a fixed 86,400,000 ms');
