// Tests for the direction under the readiness score — and for the four ways of
// not having one.
//
// The subtraction is one line and none of these tests is about it. They are
// about the three sentences that are NOT a delta, because every one of them has
// a cheaper wrong answer sitting right next to it:
//
//   · a yesterday with no record reads as "no change", which is a claim that
//     today equals a day we hold nothing for. A brand-new account gets that
//     sentence on its first morning, about a day it had not installed the app
//     for.
//   · a yesterday whose read FAILED reads as "no record", which is a statement
//     about the member assembled out of our own failure. Same house rule the
//     sleep half of this feature already carries: a failed read is not an empty
//     list.
//   · a yesterday on a DIFFERENT SCALE reads as a real movement. That is the
//     expensive one, because it is a well-formed number with nothing visibly
//     wrong with it: `readinessScore` rescales over the signals that were in
//     the scale, so a sleep-and-training score is a percentage of 70 and one
//     with hydration and a strap's recovery verdict in it is a percentage of
//     140. A member whose WHOOP came back to life this morning at 30% reads
//     100 yesterday and 66 today with nothing about them changed, and "down 34"
//     is a false statement about their body.
//
// And the day boundary, which is the whole of the rest of it. "Yesterday" is a
// local calendar question, so these run under four zones — see the header of
// readinessDirection.ts. Every Date below is built from local components on
// purpose; a literal like '2026-09-14T09:00:00Z' would be a different local day
// in Kiritimati and in Midway and the tests would be asserting different things
// in each.
//
// Compile with tsc then run with node, like readiness.test.ts.
import { readinessDirection, yesterdayOf, type ReadinessYesterday, type ReadinessDayScore } from './readinessDirection';
import { readinessScore, type Readiness, type ReadinessSignal } from './readiness';
import { readinessBreakdown, type ReadinessBreakdownInput } from './readinessBreakdown';
import type { ReadinessSleep } from './readiness';
import { todayISO } from './bodyFigures';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A score with an exact composition. Hand-built rather than scored, because
 *  these tests are about the `from` set and not about the arithmetic. */
const R = (score: number, from: ReadinessSignal[]): Readiness => ({
  score, label: 'x', tip: 'x', tone: 'good', from,
  confidence: from.length === 4 ? 'full' : 'partial',
});

const day = (d: Date) => todayISO(d);
const prev = (of: ReadinessDayScore | null, status: ReadinessYesterday['status'] = 'ready'): ReadinessYesterday =>
  ({ status, score: of });
const at = (y: number, m: number, d: number, h = 9, mi = 0) => new Date(y, m - 1, d, h, mi);

/* ── 1. a real delta ──────────────────────────────────────────────────────── */
{
  const now = at(2026, 9, 14);
  const yKey = day(at(2026, 9, 13));
  const today = R(71, ['sleep', 'load']);

  const up = readinessDirection(today, prev({ day: yKey, score: 62, from: ['sleep', 'load'] }), now);
  eq(up?.state, 'scored', 'a yesterday on the same scale is a scored direction');
  eq(up?.delta, 9, 'the delta is today minus yesterday');
  eq(up?.against, yKey, 'the direction names the day it was measured against');
  ok(!!up && up.detail.startsWith('up 9'), `a rise says so — got ${up?.detail}`);
  eq(up?.caveat, null, 'a direction that worked out is not a caveat');

  const down = readinessDirection(today, prev({ day: yKey, score: 80, from: ['sleep', 'load'] }), now);
  eq(down?.delta, -9, 'a fall is a negative delta');
  ok(!!down && down.detail.startsWith('down 9'), `a fall says so — got ${down?.detail}`);

  const flat = readinessDirection(today, prev({ day: yKey, score: 71, from: ['sleep', 'load'] }), now);
  eq(flat?.state, 'scored', 'two equal scores is still a scored direction');
  eq(flat?.delta, 0, 'a zero delta is a MEASURED zero and is carried as one');
  eq(flat?.detail, 'no change from yesterday', 'and it is a word, never a signed nothing');

  // The sign is deltaLabel's decision, not a hand-rolled one: neither arm may
  // put a direction word on a difference of nothing.
  ok(!flat?.detail.includes('up') && !flat?.detail.includes('down'), 'no change is neither up nor down');
}

/* ── 2. yesterday has no record — NOT "no change", NOT zero ───────────────── */
{
  const d = readinessDirection(R(71, ['sleep', 'load']), prev(null), at(2026, 9, 14));
  eq(d?.state, 'no-record', 'a read that came back with nothing for yesterday is no-record');
  eq(d?.delta, null, 'and it carries NO delta — an unknown that renders as 0 is an invented figure');
  ok(!!d && !d.detail.includes('no change'), `an absent yesterday must not read as no change — got ${d?.detail}`);
  eq(d?.detail,
    'no readiness on record for yesterday, so there is no direction to show — it does not mean nothing changed',
    'the no-record sentence');
  eq(d?.caveat, null, 'nothing failed, so nothing is flagged on the number');
  eq(d?.against, day(at(2026, 9, 13)), 'it still names the day it looked for');
}

/* ── 3. yesterday's read FAILED — a different absence ─────────────────────── */
{
  const failed = readinessDirection(R(71, ['sleep', 'load']), prev(null, 'error'), at(2026, 9, 14));
  eq(failed?.state, 'unread', 'a failed read is unread');
  ok(failed?.state !== 'no-record', 'a failed read is NOT an empty day');
  eq(failed?.delta, null, 'and carries no delta');
  eq(failed?.detail,
    'we could not read yesterday’s readiness, so we cannot say which way you have moved',
    'the unread sentence');
  ok(!!failed?.caveat, 'a failed read is the one absence that earns a caveat on the number');

  // A score arriving under a failed status is not a score. The status is the
  // claim about whether we were answered; the payload beside it is not evidence.
  const both = readinessDirection(
    R(71, ['sleep', 'load']),
    prev({ day: day(at(2026, 9, 13)), score: 62, from: ['sleep', 'load'] }, 'error'),
    at(2026, 9, 14),
  );
  eq(both?.state, 'unread', 'a figure handed back under an error status is not subtracted');
  eq(both?.delta, null, 'and produces no delta');

  // 'partial' is a prefix of an answer, and is never quietly promoted to a whole
  // one. Same rule as isWhole everywhere else in this tree.
  const part = readinessDirection(
    R(71, ['sleep', 'load']),
    prev({ day: day(at(2026, 9, 13)), score: 62, from: ['sleep', 'load'] }, 'partial'),
    at(2026, 9, 14),
  );
  eq(part?.state, 'unread', "'partial' is not 'ready' and is not subtracted from");

  const loading = readinessDirection(R(71, ['sleep', 'load']), prev(null, 'loading'), at(2026, 9, 14));
  eq(loading?.state, 'unread', 'a read still in flight is unread');
  eq(loading?.detail, 'still reading yesterday’s readiness', 'and says so in its own words');
  eq(loading?.caveat, null, 'in flight is not failed, so it raises no flag');
}

/* ── 4. the partial-against-whole pair, which is the one that looks fine ──── */
{
  const now = at(2026, 9, 14);
  const yKey = day(at(2026, 9, 13));

  // The concrete case from the header: identical sleep, identical training, a
  // strap that came back to life this morning at 30% recovered.
  const yesterdayWhole = readinessScore({ avgSleepHours: 8, hydrationPct: null, recoveryPct: null, workoutsLast2Days: 0 });
  const todayWhole = readinessScore({ avgSleepHours: 8, hydrationPct: null, recoveryPct: 30, workoutsLast2Days: 0 });
  ok(yesterdayWhole != null && todayWhole != null, 'both days score');
  eq(yesterdayWhole?.score, 100, 'sleep-and-training out of 70');
  eq(todayWhole?.score, 75, 'the same body, with a recovery verdict in the scale, is a much lower number');
  // Left explicit: this is the figure a subtraction would print, and it is a
  // 25-point fall published about somebody whose sleep and training did not
  // change at all. It is the reason the branch below refuses.
  eq((todayWhole?.score ?? 0) - (yesterdayWhole?.score ?? 0), -25, 'a naive subtraction would report a 25-point fall');

  const d = readinessDirection(
    todayWhole,
    prev({ day: yKey, score: yesterdayWhole!.score, from: yesterdayWhole!.from }),
    now,
  );
  eq(d?.state, 'not-comparable', 'a pair out of two different denominators is not comparable');
  eq(d?.delta, null, 'and MUST NOT be subtracted — nothing about the member moved');
  eq(d?.detail,
    'yesterday’s score was built from different signals, so the two numbers are not on the same scale',
    'the not-comparable sentence');
  ok(!!d?.caveat, 'and it is worth saying on the number, because the number visibly moved');

  // The test is the SET and not the count: three against three, and still two
  // different denominators (100 against 110).
  const evenCount = readinessDirection(
    R(71, ['sleep', 'hydration', 'load']),
    prev({ day: yKey, score: 62, from: ['sleep', 'recovery', 'load'] }),
    now,
  );
  eq(evenCount?.state, 'not-comparable', 'an equal COUNT of different signals is still two scales');

  // And the other half of that: two equally short days are perfectly comparable
  // to each other. Refusing here would delete the feature for the members it
  // actually works for.
  const bothShort = readinessDirection(
    R(71, ['sleep', 'load']),
    prev({ day: yKey, score: 62, from: ['sleep', 'load'] }),
    now,
  );
  eq(bothShort?.state, 'scored', 'two partial-confidence days out of the same 70 ARE comparable');
  eq(bothShort?.delta, 9, 'and give a real delta');

  // Both full, all four signals: comparable.
  const bothFull = readinessDirection(
    R(71, ['sleep', 'recovery', 'hydration', 'load']),
    prev({ day: yKey, score: 62, from: ['sleep', 'recovery', 'hydration', 'load'] }),
    now,
  );
  eq(bothFull?.state, 'scored', 'two full days are comparable');

  // `readinessScore` emits `from` in one fixed order, which is what makes the
  // positional comparison above exact. If that ever stops being true, this is
  // the assertion that says so rather than a silent stream of false
  // 'not-comparable's.
  const full = readinessScore({ avgSleepHours: 7, hydrationPct: 0.5, recoveryPct: 55, workoutsLast2Days: 1 });
  eq(full?.from.join(','), 'sleep,recovery,hydration,load', 'the signal set has one fixed order');
}

/* ── 5. a yesterday that is not yesterday ─────────────────────────────────── */
{
  const now = at(2026, 9, 14);

  const stale = readinessDirection(
    R(71, ['sleep', 'load']),
    prev({ day: day(at(2026, 9, 10)), score: 62, from: ['sleep', 'load'] }),
    now,
  );
  eq(stale?.state, 'no-record', 'the newest score we hold being older than yesterday is no record FOR yesterday');
  eq(stale?.delta, null, 'a four-day-old score is not yesterday and is not subtracted');
  eq(stale?.detail,
    'no readiness on record for yesterday — the most recent day you have is older than that',
    'and it says which, rather than reading as "you have never had one"');

  const ahead = readinessDirection(
    R(71, ['sleep', 'load']),
    prev({ day: day(now), score: 62, from: ['sleep', 'load'] }),
    now,
  );
  eq(ahead?.state, 'unread', 'being handed TODAY as yesterday is our fault, not an empty day');
  eq(ahead?.delta, null, 'and today minus today is not a direction');
}

/* ── 6. no score today, and no clock ──────────────────────────────────────── */
{
  eq(readinessDirection(null, prev({ day: day(at(2026, 9, 13)), score: 62, from: ['sleep', 'load'] }), at(2026, 9, 14)),
    null, 'no score today means no direction at all — `absence` is the whole answer there');

  const noClock = readinessDirection(R(71, ['sleep', 'load']), prev(null), new Date(NaN));
  eq(noClock?.state, 'unread', 'a clock we cannot read is ours, and must not report as an empty day');
  eq(noClock?.against, null, 'there is no day to name');
  eq(noClock?.detail,
    'we could not work out which day yesterday was, so we cannot say which way you have moved',
    'the unreadable-clock sentence');
  ok(!!noClock?.caveat, 'and it is flagged, because it is a failure of ours');

  // A score that is not a readable number is not a number to move.
  eq(readinessDirection({ ...R(0, ['sleep', 'load']), score: NaN }, prev(null), at(2026, 9, 14)), null,
    'an unreadable score gets no direction');
}

/* ── 7. the day boundary ──────────────────────────────────────────────────── */
{
  // Ten minutes apart, the same night, two different days — and therefore two
  // different yesterdays. This is the whole reason the day key is not a
  // subtraction and not a slice of an ISO string.
  const late = yesterdayOf(at(2026, 9, 14, 23, 50));
  const early = yesterdayOf(at(2026, 9, 15, 0, 10));
  eq(late?.day, day(at(2026, 9, 13)), 'at 23:50 on the 14th, yesterday is the 13th');
  eq(early?.day, day(at(2026, 9, 14)), 'at 00:10 on the 15th, yesterday is the 14th');
  ok(late?.day !== early?.day, 'ten minutes across midnight is a different yesterday');

  // The instant must agree with the key, in the reader's own zone, or the two
  // halves of this feature are looking at different days.
  for (const [y, m, d, h] of [
    [2026, 9, 14, 9], [2026, 1, 1, 0], [2026, 3, 1, 12], [2026, 3, 29, 2],
    [2026, 10, 25, 2], [2027, 1, 1, 23], [2028, 3, 1, 0], [2026, 12, 31, 23],
  ] as const) {
    const now = at(y, m, d, h, 30);
    const r = yesterdayOf(now);
    ok(r != null, `there is a yesterday for ${y}-${m}-${d} ${h}:30`);
    if (!r) continue;
    eq(day(r.at), r.day, `the instant lands on the day key it was named for (${y}-${m}-${d} ${h}:30)`);
    ok(r.day < day(now), `yesterday sorts before today (${y}-${m}-${d} ${h}:30)`);
    // A calendar day, counted the way the member counts it — and never
    // `now - 86400000`, which is 23 or 25 hours out across a daylight-saving
    // shift. The gap between the two local midnights is whatever the zone says
    // it is; what must hold is that exactly one calendar day passed.
    const a = new Date(r.day + 'T00:00:00');
    const b = new Date(day(now) + 'T00:00:00');
    eq(Math.round((b.getTime() - a.getTime()) / 86400000), 1,
      `exactly one calendar day between them (${y}-${m}-${d} ${h}:30)`);
  }

  eq(yesterdayOf(new Date(NaN)), null, 'no readable instant, no yesterday');
  // Months, years and leap days roll the way the calendar does, because the
  // arithmetic is the runtime's own and not a subtraction of milliseconds.
  eq(yesterdayOf(at(2026, 3, 1, 9))?.day, day(at(2026, 2, 28)), 'the 1st of March 2026 follows the 28th of February');
  eq(yesterdayOf(at(2028, 3, 1, 9))?.day, day(at(2028, 2, 29)), 'and the 29th in a leap year');
  eq(yesterdayOf(at(2026, 1, 1, 9))?.day, day(at(2025, 12, 31)), 'and New Year rolls the year back');
}

/* ── 8. what the breakdown does with it ───────────────────────────────────── */
{
  const sleep: ReadinessSleep = {
    avgHours: 7, nights: [{ night: day(at(2026, 9, 13)), hours: 7, from: 'typed' }],
    fromDevice: 0, fromTyped: 1, windowNights: 3, state: 'scored',
  };
  const scored = readinessScore({ avgSleepHours: 7, hydrationPct: null, recoveryPct: null, workoutsLast2Days: 1 })!;
  const base: ReadinessBreakdownInput = {
    readiness: scored, sleep, windowNights: 3, deviceStatus: 'ready', sources: [],
    typedStatus: 'ready', hydrationGoal: false, hydrationStatus: 'ready', hydrationPct: null,
    workoutsLast2Days: 1,
  };

  const clean = readinessBreakdown(base);
  eq(clean.caveats.length, 0, 'no direction, no extra caveat');
  eq(clean.status, 'ready', 'and the read is still whole');

  const now = at(2026, 9, 14);
  const failed = readinessDirection(scored, prev(null, 'error'), now)!;
  const withFailed = readinessBreakdown({ ...base, direction: failed });
  eq(withFailed.caveats.length, 1, "an unread yesterday puts a sentence in the hero's flags");
  eq(withFailed.caveats[0], failed.caveat, 'and it is the direction\'s own sentence, verbatim');
  eq(withFailed.status, 'ready',
    'but it does NOT call today\'s read partial — nothing about today\'s own inputs came back short');

  const absent = readinessBreakdown({ ...base, direction: readinessDirection(scored, prev(null), now)! });
  eq(absent.caveats.length, 0, 'a yesterday that is simply not there raises no flag');

  const mismatched = readinessDirection(
    R(71, ['sleep', 'load']),
    prev({ day: day(at(2026, 9, 13)), score: 62, from: ['sleep', 'hydration', 'load'] }),
    now,
  )!;
  const withMismatch = readinessBreakdown({ ...base, direction: mismatched });
  eq(withMismatch.caveats.length, 1, 'an incomparable pair can be said out loud');
  eq(withMismatch.status, 'ready', 'and is still not a short read of today');

  // The direction sentence goes LAST, behind everything that says a figure in
  // the score itself may be missing.
  const ordered = readinessBreakdown({
    ...base, typedStatus: 'error', direction: failed,
  });
  ok(ordered.caveats.length === 2 && ordered.caveats[1] === failed.caveat,
    'the direction caveat is last, behind the sentences about the score\'s own inputs');

  // With no score there is no direction — and even if one were handed in, it
  // must not print under a hero showing a dash, where `absence` is the answer.
  const none = readinessBreakdown({
    ...base, readiness: null, sleep: { ...sleep, avgHours: null, nights: [], fromTyped: 0, state: 'none' },
    direction: failed,
  });
  eq(none.caveats.length, 0, 'no score, no direction caveat');
  ok(none.absence != null, 'the absence is what speaks there');
}

if (errors.length) {
  console.error(`readinessDirection.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 30)) console.error('  · ' + e);
  if (errors.length > 30) console.error(`  … and ${errors.length - 30} more`);
  process.exit(1);
}
console.log('readinessDirection.test.ts — ok');
