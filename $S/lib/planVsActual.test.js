"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The plan and the record, side by side — and the four claims this must never
// make. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a coach reads "not logged" and acts
// on it. They ring the client, they rewrite the block, they have the
// conversation. So "not logged" has to be a claim about a PERSON and never
// about a read that failed, a read that was truncated before it reached the
// window, or a movement whose name was spelled differently.
const planVsActual_1 = require("./planVsActual");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const TODAY = '2026-09-01';
/** Inside the window. Local noon, so the entry lands on the same calendar day
 *  in every zone the repo tests under — the point of the assertion is the
 *  matching, not the day boundary, and a UTC midnight would move under it. */
const at = (day) => `${day}T12:00:00`;
const ex = (name, loadKg) => ({ key: name, name, group: 'x', sets: 3, reps: '8-10', alternatives: [], loadKg: loadKg ?? null });
const plan = [
    { day: 'Mon', focus: 'Upper', exercises: [ex('Bench Press', 100), ex('Bent-over Row')] },
    { day: 'Thu', focus: 'Legs', exercises: [ex('Back Squat', 140)] },
];
const log = [
    { t: at('2026-08-30'), exercise: 'bench press', sets: [[8, 95], [6, 102.5]] },
    { t: at('2026-08-27'), exercise: 'Bent-Over Row', sets: [[10, 60]] },
    { t: at('2026-08-25'), exercise: 'Bench Press', sets: [[8, 90]] },
    // Not in the plan at all — the other half of the conversation, and the half a
    // coach currently has no way to see.
    { t: at('2026-08-28'), exercise: 'Leg Press', sets: [[12, 200]] },
];
const run = (over = {}) => (0, planVsActual_1.planVsActual)({
    days: plan, programStatus: 'ready', log, logStatus: 'ready', todayISO: TODAY, ...over,
});
/* ── matching is by SLUG, because `exercise` is whatever they typed ─────── */
const base = run();
const byName = (n) => base.movements.find((m) => m.name === n);
eq(byName('Bench Press').coverage, 'logged', '"bench press" matches "Bench Press" — the whole of src/lib/exerciseId.ts exists so it does');
eq(byName('Bent-over Row').coverage, 'logged', 'and so does "Bent-Over Row", which is one movement with two spellings');
eq(byName('Back Squat').coverage, 'not-logged', 'a movement nowhere in the log is not logged, and that is a claim about the client');
eq(byName('Bench Press').daysLogged, 2, 'two separate days of bench press count as two');
eq(byName('Bench Press').lastDay, '2026-08-30', 'and the newest is the one reported');
// The heaviest WORKING set of the plan against the heaviest set logged. A
// warm-up in the plan must not be reported as what the coach prescribed.
eq(byName('Bench Press').plannedTopKg, 100, 'the planned load is what the coach wrote');
eq(byName('Bench Press').loggedTopKg, 102.5, 'and the logged top is the heaviest set in the window');
eq(byName('Bent-over Row').plannedTopKg, null, 'a movement with no load on the plan has no planned top — a nought would read as a bar with nothing on it');
const ramp = (0, planVsActual_1.planVsActual)({
    ...{ days: [{ day: 'Mon', focus: 'x', exercises: [{
                        key: 'a', name: 'Back Squat', group: 'Legs', sets: 3, reps: '5', alternatives: [],
                        setRows: [{ loadKg: 60, method: 'warmup' }, { loadKg: 120 }, { loadKg: 140 }],
                    }] }] },
    programStatus: 'ready', log: [], logStatus: 'ready', todayISO: TODAY,
});
eq(ramp.movements[0].plannedTopKg, 140, 'a ramp is prescribed at its top set, and the warm-up row is not what the coach asked for');
/* ── one movement, two days, two prescriptions ──────────────────────────── */
//
// A squat on Monday at 100 and on Friday at 140 is ONE movement the client
// either does or does not do — which is why the week-level list is
// de-duplicated by slug — but it is NOT one prescription. First-one-wins kept
// Monday's 100 and dropped Friday's 140, so `loadCheck` measured the client's
// week against a load their coach had already superseded and called them 40 kg
// over a target that was not theirs.
const twoDays = (0, planVsActual_1.planVsActual)({
    days: [
        { day: 'Mon', focus: 'Squat', exercises: [ex('Back Squat', 100)] },
        { day: 'Fri', focus: 'Squat', exercises: [ex('Back Squat', 140)] },
    ],
    programStatus: 'ready',
    log: [{ t: at('2026-08-29'), exercise: 'Back Squat', sets: [[5, 135]] }],
    logStatus: 'ready',
    todayISO: TODAY,
});
eq(twoDays.movements.length, 1, 'the same movement on two days is one row at week level');
eq(twoDays.movements[0].plannedTopKg, 140, 'and the week prescribes the HEAVIEST of the two, not whichever day came first');
eq((0, planVsActual_1.loadCheck)(twoDays.movements[0]).verdict, 'under', 'so 135 against a week that asks for 140 is under it, where Monday alone would have called it over');
// Each day still carries its own figure, because the load belongs to the day
// the coach wrote it on.
eq(JSON.stringify(twoDays.days.map((d) => d.movements[0].plannedTopKg)), JSON.stringify([100, 140]), 'the per-day rows are untouched — merging happens only in the week-level list');
// The order the days are written in must not decide the answer.
const reversed = (0, planVsActual_1.planVsActual)({
    days: [
        { day: 'Mon', focus: 'Squat', exercises: [ex('Back Squat', 140)] },
        { day: 'Fri', focus: 'Squat', exercises: [ex('Back Squat', 100)] },
    ],
    programStatus: 'ready', log: [], logStatus: 'ready', todayISO: TODAY,
});
eq(reversed.movements[0].plannedTopKg, 140, 'heaviest wins whichever day it is written on');
// A day with no load on it cannot erase a day that has one.
const oneLoaded = (0, planVsActual_1.planVsActual)({
    days: [
        { day: 'Mon', focus: 'Squat', exercises: [ex('Back Squat', 140)] },
        { day: 'Fri', focus: 'Squat', exercises: [ex('Back Squat')] },
    ],
    programStatus: 'ready', log: [], logStatus: 'ready', todayISO: TODAY,
});
eq(oneLoaded.movements[0].plannedTopKg, 140, 'a bodyweight day beside a loaded one does not turn the week into a prescription of nothing');
/* ── off-plan work, which nothing in this app could see before ──────────── */
eq(base.offPlan, ['Leg Press'], 'a movement logged but not prescribed is named, spelled as the CLIENT typed it');
ok(!base.offPlan.includes('Bench Press'), 'and a prescribed movement is never listed as off-plan');
/* ── refusal 4: never "not logged" over a read that was not whole ───────── */
// THE assertion. An empty log under a failed read is not a client who trained
// nothing, and every movement must come back 'unknown'.
const unread = run({ log: null, logStatus: 'error' });
ok(unread.movements.every((m) => m.coverage === 'unknown'), 'a refused log answers "unknown" for every movement, never "not logged"');
eq(unread.offPlan, [], 'and lists no off-plan work, because it read none rather than finding none');
const loading = run({ log: [], logStatus: 'loading' });
ok(loading.movements.every((m) => m.coverage === 'unknown'), 'a read still in flight has produced no rows and is not an empty history');
// A CAPPED read still answers, and this is the part worth getting right rather
// than refusing outright: `capped()` returns the NEWEST rows, so a client with
// four thousand workouts has their last month read in full and only their 2023
// is missing. The window is compared against the oldest row that came back.
const cappedReaching = run({ logStatus: 'partial', oldestDay: '2026-01-01' });
eq(cappedReaching.movements.find((m) => m.name === 'Back Squat').coverage, 'not-logged', 'a truncated read that still reaches past the window may say a movement is missing');
const cappedShort = run({ logStatus: 'partial', oldestDay: '2026-08-29' });
ok(cappedShort.movements.every((m) => m.coverage !== 'not-logged'), 'a truncated read that stops inside the window may not — the absence could be past the cap');
const cappedUnknown = run({ logStatus: 'partial', oldestDay: null });
ok(cappedUnknown.movements.every((m) => m.coverage !== 'not-logged'), 'and a truncated read whose reach is unknown may not either');
/* ── the window, and the refusal to name a weekday ──────────────────────── */
const outside = run({ log: [{ t: at('2026-05-01'), exercise: 'Back Squat', sets: [[5, 140]] }] });
eq(outside.movements.find((m) => m.name === 'Back Squat').coverage, 'not-logged', 'a session four months old is outside the window and does not count as recent evidence');
eq(base.fromDay, '2026-08-05', `the window is ${planVsActual_1.WINDOW_DAYS} days ending today, and the screen prints the one it used`);
eq(base.toDay, TODAY, 'ending today');
// An entry with no readable timestamp cannot be placed inside or outside the
// window, so it is skipped rather than filed under today — the same refusal
// `trainingDaysOf` makes when it keeps undated sessions in their own list.
const undated = run({ log: [{ t: 'not a date', exercise: 'Back Squat', sets: [[5, 140]] }] });
eq(undated.movements.find((m) => m.name === 'Back Squat').coverage, 'not-logged', 'an entry with no readable date is not evidence that a movement was done in the window');
ok(/never against a named weekday/i.test(planVsActual_1.WINDOW_IS_NOT_A_WEEKDAY), 'the sentence says the comparison is over a window, not a weekday');
ok(/no timezone for the client/i.test(planVsActual_1.WINDOW_IS_NOT_A_WEEKDAY), 'and names the missing column that is the reason, so nobody removes the hedge without adding it');
/* ── per day, and the count that must not silently absorb the unknowns ─── */
const mon = base.days.find((d) => d.day === 'Mon');
eq([mon.logged, mon.notLogged, mon.unknown], [2, 0, 0], 'Monday’s two movements were both logged');
const thu = base.days.find((d) => d.day === 'Thu');
eq([thu.logged, thu.notLogged, thu.unknown], [0, 1, 0], 'and Thursday’s one was not');
const unreadDay = unread.days.find((d) => d.day === 'Thu');
eq([unreadDay.logged, unreadDay.notLogged, unreadDay.unknown], [0, 0, 1], 'under an unread log the movement is in the unknown column, so the two totals visibly do not add up to the day');
// A movement on two days is ONE movement the client either does or does not do.
// Counting it twice would make a two-squat week look like better coverage than
// a one-squat week for the same behaviour.
const twice = (0, planVsActual_1.planVsActual)({
    days: [
        { day: 'Mon', focus: 'a', exercises: [ex('Back Squat')] },
        { day: 'Fri', focus: 'b', exercises: [ex('Back Squat')] },
    ],
    programStatus: 'ready', log: [], logStatus: 'ready', todayISO: TODAY,
});
eq(twice.movements.length, 1, 'a movement prescribed twice in a week is one movement');
/* ── no programme, and no read of one, are different answers ────────────── */
eq((0, planVsActual_1.planVsActual)({ days: null, programStatus: 'ready', log, logStatus: 'ready', todayISO: TODAY }).state, 'no-programme', 'a client on nothing is a real state');
eq((0, planVsActual_1.planVsActual)({ days: null, programStatus: 'error', log, logStatus: 'ready', todayISO: TODAY }).state, 'unreadable', 'and a programme that could not be read is a different one');
/* ── refusal 3: counts of MOVEMENTS, never a percentage ─────────────────── */
const line = (0, planVsActual_1.coverageLine)(base, planVsActual_1.WINDOW_DAYS, 'Priya');
ok(/2 of 3 prescribed movements? logged/.test(line), 'the line counts movements');
ok(!/%/.test(line), 'and there is no percentage anywhere in it — one number would hide every caveat above');
ok(!/session/i.test(line), 'nor a session count, which a logged set carries no reference to a plan row to support');
ok(/1 movement logged that this programme does not name/.test(line), 'off-plan work is named in the same breath');
const unreadLine = (0, planVsActual_1.coverageLine)(unread, planVsActual_1.WINDOW_DAYS, 'Priya');
ok(/not a statement about Priya/i.test(unreadLine), 'and an unreadable comparison refuses the collapse in as many words');
ok((0, planVsActual_1.coverageLine)(cappedShort, planVsActual_1.WINDOW_DAYS, 'Priya').includes('cannot be answered for'), 'a partial read says how many movements it could not answer for rather than counting them as missed');
/* ── the load, not just the presence ─────────────────────────────────────
 *
 * P5. The sentence that changes next week's programme is not "they did four of
 * six sessions", it is "they hit every prescribed load on upper and missed
 * every one on legs". Every assertion here is aimed at the same bug the rest of
 * this file is: a coach reads a verdict and acts on it, so a verdict must never
 * be manufactured out of an absent prescription.
 */
const mv = (plannedTopKg, loggedTopKg) => ({ name: 'x', slug: 'x', coverage: 'logged', lastDay: null, daysLogged: 1, plannedTopKg, loggedTopKg });
eq((0, planVsActual_1.loadCheck)(mv(null, 80)).verdict, 'no-plan', 'a plan that names no load has nothing to be under or over');
eq((0, planVsActual_1.loadCheck)(mv(null, 80)).gapKg, null, 'and no gap: a gap against an absent prescription is not a gap');
eq((0, planVsActual_1.loadCheck)(mv(100, null)).verdict, 'not-logged', 'a prescribed load with nothing logged against it is its own state');
eq((0, planVsActual_1.loadCheck)(mv(100, 100)).verdict, 'at', 'the number, hit exactly');
eq((0, planVsActual_1.loadCheck)(mv(100, 97.5)).verdict, 'at', 'and hit within one pair of the smallest plates on the rack — 2.5 kg off 100 is the instruction carried out');
eq((0, planVsActual_1.loadCheck)(mv(100, 95)).verdict, 'under', 'past the tolerance it is short');
eq((0, planVsActual_1.loadCheck)(mv(100, 110)).verdict, 'over', 'and above it, which is reported rather than congratulated');
eq((0, planVsActual_1.loadCheck)(mv(100, 95)).gapKg, -5, 'the gap is signed, in kilograms, logged minus prescribed');
// The tolerance is a FRACTION and this is why. 2.5 kg off a prescribed 20 kg
// accessory is an eighth of the load and is a different fact from 2.5 kg off a
// prescribed 100 kg squat.
eq((0, planVsActual_1.loadCheck)(mv(20, 17.5)).verdict, 'under', 'the tolerance scales with the prescription rather than being a fixed 2.5 kg');
ok(planVsActual_1.LOAD_TOLERANCE > 0 && planVsActual_1.LOAD_TOLERANCE < 0.1, 'and it is a small fraction, not a licence');
// A zero is never a prescription. `plannedTopKg` is null rather than 0 for
// bodyweight work precisely so a logged 40 kg cannot render as somebody wildly
// exceeding a target of nothing.
eq((0, planVsActual_1.loadCheck)(mv(0, 40)).verdict, 'no-plan', 'a planned top of zero is not a target of zero');
eq((0, planVsActual_1.loadCheck)(mv(100, 0)).verdict, 'not-logged', 'and a logged zero is an absent measurement, not a lift of nothing');
const tally = (0, planVsActual_1.loadTally)([mv(100, 100), mv(100, 80), mv(100, 130), mv(140, null), mv(null, 50)]);
eq(tally, { compared: 3, at: 1, under: 1, over: 1, notLogged: 1, noPlan: 1 }, 'the tally counts every arm separately');
const ll = (0, planVsActual_1.loadLine)(tally, 'Priya');
ok(!/%/.test(ll), 'there is no percentage in the load line either — it would hide that a fifth of the movements name no load at all');
ok(/1 at the prescribed load/.test(ll) && /1 under it/.test(ll) && /1 over it/.test(ll), 'each arm is named');
ok(/names no load at all, which is ordinary and is not a gap/.test(ll), 'and a block written in reps and RPE is not reported as a failure');
eq((0, planVsActual_1.loadLine)((0, planVsActual_1.loadTally)([mv(null, 50), mv(null, null)]), 'Priya'), null, 'a block that names no loads anywhere gets no line at all rather than one apologising for itself');
ok(/nothing to compare Priya against/.test((0, planVsActual_1.loadLine)((0, planVsActual_1.loadTally)([mv(100, null)]), 'Priya')), 'and a prescription nothing was logged against says so about the record, not about the person');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('planVsActual: ok — matched by slug over a window, never a weekday, never a percentage, and never "not logged" over an unread log');
