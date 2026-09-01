// The plan and the record, side by side — and the four claims this must never
// make. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a coach reads "not logged" and acts
// on it. They ring the client, they rewrite the block, they have the
// conversation. So "not logged" has to be a claim about a PERSON and never
// about a read that failed, a read that was truncated before it reached the
// window, or a movement whose name was spelled differently.
import {
  WINDOW_DAYS, WINDOW_IS_NOT_A_WEEKDAY, coverageLine, planVsActual,
} from './planVsActual';
import type { ProgramDay } from './programs';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-01';
/** Inside the window. Local noon, so the entry lands on the same calendar day
 *  in every zone the repo tests under — the point of the assertion is the
 *  matching, not the day boundary, and a UTC midnight would move under it. */
const at = (day: string) => `${day}T12:00:00`;

const ex = (name: string, loadKg?: number | null) =>
  ({ key: name, name, group: 'x', sets: 3, reps: '8-10', alternatives: [], loadKg: loadKg ?? null });

const plan: ProgramDay[] = [
  { day: 'Mon', focus: 'Upper', exercises: [ex('Bench Press', 100), ex('Bent-over Row')] },
  { day: 'Thu', focus: 'Legs', exercises: [ex('Back Squat', 140)] },
];

const log: WorkoutEntry[] = [
  { t: at('2026-08-30'), exercise: 'bench press', sets: [[8, 95], [6, 102.5]] },
  { t: at('2026-08-27'), exercise: 'Bent-Over Row', sets: [[10, 60]] },
  { t: at('2026-08-25'), exercise: 'Bench Press', sets: [[8, 90]] },
  // Not in the plan at all — the other half of the conversation, and the half a
  // coach currently has no way to see.
  { t: at('2026-08-28'), exercise: 'Leg Press', sets: [[12, 200]] },
];

const run = (over: Partial<Parameters<typeof planVsActual>[0]> = {}) => planVsActual({
  days: plan, programStatus: 'ready', log, logStatus: 'ready', todayISO: TODAY, ...over,
});

/* ── matching is by SLUG, because `exercise` is whatever they typed ─────── */

const base = run();
const byName = (n: string) => base.movements.find((m) => m.name === n)!;

eq(byName('Bench Press').coverage, 'logged',
  '"bench press" matches "Bench Press" — the whole of src/lib/exerciseId.ts exists so it does');
eq(byName('Bent-over Row').coverage, 'logged', 'and so does "Bent-Over Row", which is one movement with two spellings');
eq(byName('Back Squat').coverage, 'not-logged', 'a movement nowhere in the log is not logged, and that is a claim about the client');
eq(byName('Bench Press').daysLogged, 2, 'two separate days of bench press count as two');
eq(byName('Bench Press').lastDay, '2026-08-30', 'and the newest is the one reported');

// The heaviest WORKING set of the plan against the heaviest set logged. A
// warm-up in the plan must not be reported as what the coach prescribed.
eq(byName('Bench Press').plannedTopKg, 100, 'the planned load is what the coach wrote');
eq(byName('Bench Press').loggedTopKg, 102.5, 'and the logged top is the heaviest set in the window');
eq(byName('Bent-over Row').plannedTopKg, null,
  'a movement with no load on the plan has no planned top — a nought would read as a bar with nothing on it');

const ramp = planVsActual({
  ...{ days: [{ day: 'Mon', focus: 'x', exercises: [{
    key: 'a', name: 'Back Squat', group: 'Legs', sets: 3, reps: '5', alternatives: [],
    setRows: [{ loadKg: 60, method: 'warmup' }, { loadKg: 120 }, { loadKg: 140 }],
  }] }] },
  programStatus: 'ready', log: [], logStatus: 'ready', todayISO: TODAY,
});
eq(ramp.movements[0].plannedTopKg, 140,
  'a ramp is prescribed at its top set, and the warm-up row is not what the coach asked for');

/* ── off-plan work, which nothing in this app could see before ──────────── */

eq(base.offPlan, ['Leg Press'], 'a movement logged but not prescribed is named, spelled as the CLIENT typed it');
ok(!base.offPlan.includes('Bench Press'), 'and a prescribed movement is never listed as off-plan');

/* ── refusal 4: never "not logged" over a read that was not whole ───────── */

// THE assertion. An empty log under a failed read is not a client who trained
// nothing, and every movement must come back 'unknown'.
const unread = run({ log: null, logStatus: 'error' });
ok(unread.movements.every((m) => m.coverage === 'unknown'),
  'a refused log answers "unknown" for every movement, never "not logged"');
eq(unread.offPlan, [], 'and lists no off-plan work, because it read none rather than finding none');

const loading = run({ log: [], logStatus: 'loading' });
ok(loading.movements.every((m) => m.coverage === 'unknown'), 'a read still in flight has produced no rows and is not an empty history');

// A CAPPED read still answers, and this is the part worth getting right rather
// than refusing outright: `capped()` returns the NEWEST rows, so a client with
// four thousand workouts has their last month read in full and only their 2023
// is missing. The window is compared against the oldest row that came back.
const cappedReaching = run({ logStatus: 'partial', oldestDay: '2026-01-01' });
eq(cappedReaching.movements.find((m) => m.name === 'Back Squat')!.coverage, 'not-logged',
  'a truncated read that still reaches past the window may say a movement is missing');
const cappedShort = run({ logStatus: 'partial', oldestDay: '2026-08-29' });
ok(cappedShort.movements.every((m) => m.coverage !== 'not-logged'),
  'a truncated read that stops inside the window may not — the absence could be past the cap');
const cappedUnknown = run({ logStatus: 'partial', oldestDay: null });
ok(cappedUnknown.movements.every((m) => m.coverage !== 'not-logged'),
  'and a truncated read whose reach is unknown may not either');

/* ── the window, and the refusal to name a weekday ──────────────────────── */

const outside = run({ log: [{ t: at('2026-05-01'), exercise: 'Back Squat', sets: [[5, 140]] }] });
eq(outside.movements.find((m) => m.name === 'Back Squat')!.coverage, 'not-logged',
  'a session four months old is outside the window and does not count as recent evidence');
eq(base.fromDay, '2026-08-05', `the window is ${WINDOW_DAYS} days ending today, and the screen prints the one it used`);
eq(base.toDay, TODAY, 'ending today');

// An entry with no readable timestamp cannot be placed inside or outside the
// window, so it is skipped rather than filed under today — the same refusal
// `trainingDaysOf` makes when it keeps undated sessions in their own list.
const undated = run({ log: [{ t: 'not a date', exercise: 'Back Squat', sets: [[5, 140]] }] });
eq(undated.movements.find((m) => m.name === 'Back Squat')!.coverage, 'not-logged',
  'an entry with no readable date is not evidence that a movement was done in the window');

ok(/never against a named weekday/i.test(WINDOW_IS_NOT_A_WEEKDAY),
  'the sentence says the comparison is over a window, not a weekday');
ok(/no timezone for the client/i.test(WINDOW_IS_NOT_A_WEEKDAY),
  'and names the missing column that is the reason, so nobody removes the hedge without adding it');

/* ── per day, and the count that must not silently absorb the unknowns ─── */

const mon = base.days.find((d) => d.day === 'Mon')!;
eq([mon.logged, mon.notLogged, mon.unknown], [2, 0, 0], 'Monday’s two movements were both logged');
const thu = base.days.find((d) => d.day === 'Thu')!;
eq([thu.logged, thu.notLogged, thu.unknown], [0, 1, 0], 'and Thursday’s one was not');

const unreadDay = unread.days.find((d) => d.day === 'Thu')!;
eq([unreadDay.logged, unreadDay.notLogged, unreadDay.unknown], [0, 0, 1],
  'under an unread log the movement is in the unknown column, so the two totals visibly do not add up to the day');

// A movement on two days is ONE movement the client either does or does not do.
// Counting it twice would make a two-squat week look like better coverage than
// a one-squat week for the same behaviour.
const twice = planVsActual({
  days: [
    { day: 'Mon', focus: 'a', exercises: [ex('Back Squat')] },
    { day: 'Fri', focus: 'b', exercises: [ex('Back Squat')] },
  ],
  programStatus: 'ready', log: [], logStatus: 'ready', todayISO: TODAY,
});
eq(twice.movements.length, 1, 'a movement prescribed twice in a week is one movement');

/* ── no programme, and no read of one, are different answers ────────────── */

eq(planVsActual({ days: null, programStatus: 'ready', log, logStatus: 'ready', todayISO: TODAY }).state,
  'no-programme', 'a client on nothing is a real state');
eq(planVsActual({ days: null, programStatus: 'error', log, logStatus: 'ready', todayISO: TODAY }).state,
  'unreadable', 'and a programme that could not be read is a different one');

/* ── refusal 3: counts of MOVEMENTS, never a percentage ─────────────────── */

const line = coverageLine(base, WINDOW_DAYS, 'Priya');
ok(/2 of 3 prescribed movements? logged/.test(line), 'the line counts movements');
ok(!/%/.test(line), 'and there is no percentage anywhere in it — one number would hide every caveat above');
ok(!/session/i.test(line), 'nor a session count, which a logged set carries no reference to a plan row to support');
ok(/1 movement logged that this programme does not name/.test(line), 'off-plan work is named in the same breath');

const unreadLine = coverageLine(unread, WINDOW_DAYS, 'Priya');
ok(/not a statement about Priya/i.test(unreadLine),
  'and an unreadable comparison refuses the collapse in as many words');
ok(coverageLine(cappedShort, WINDOW_DAYS, 'Priya').includes('cannot be answered for'),
  'a partial read says how many movements it could not answer for rather than counting them as missed');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('planVsActual: ok — matched by slug over a window, never a weekday, never a percentage, and never "not logged" over an unread log');
