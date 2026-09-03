"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Reading a log back as days, and a day's sets back as one line. Compile with
// tsc, run with node.
//
// The two bugs these guard:
//
//   · a session logged in the evening being filed under tomorrow, because the
//     first ten characters of an ISO string are the UTC date and not the day
//     the person trained on. `npm run test:zones` runs this file in
//     America/Los_Angeles, Pacific/Auckland and Asia/Dubai, which is what makes
//     the assertion mean anything.
//   · a load of zero printed as "0 kg". A bodyweight set has no external load,
//     and a screen that states one is stating a weight that was never on the
//     bar.
const ownTraining_1 = require("./ownTraining");
const entryEdit_1 = require("./entryEdit");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** An entry at a LOCAL wall-clock time, which is how a person experiences it. */
const at = (y, m, d, h, min, exercise = 'Back Squat', sets) => ({ t: new Date(y, m - 1, d, h, min, 0, 0).toISOString(), exercise, sets });
/* ── grouping into local days ──────────────────────────────────────────── */
{
    // 21:30 on the 14th and 06:00 on the 15th. In UTC−7 the first of these has an
    // ISO date of the 15th, so a `slice(0, 10)` would put both on the 15th and
    // report one training day where there were two.
    const days = (0, ownTraining_1.trainingDays)([at(2026, 8, 14, 21, 30), at(2026, 8, 15, 6, 0)]);
    eq(days.length, 2, 'an evening session and the next morning are two days, in every timezone');
    eq(days[0].day, (0, entryEdit_1.dayKeyOfDate)(new Date(2026, 7, 15)), 'the newer day comes first');
    eq(days[1].day, (0, entryEdit_1.dayKeyOfDate)(new Date(2026, 7, 14)), 'and the evening session keeps the day it was performed on');
}
{
    // Handed oldest-first, which is not the order the provider uses today. The
    // screen renders "Today" at the top, so the order has to be this function's
    // doing rather than something it inherits and could silently lose.
    const days = (0, ownTraining_1.trainingDays)([
        at(2026, 8, 10, 9, 0, 'Deadlift'),
        at(2026, 8, 12, 9, 0, 'Bench Press'),
        at(2026, 8, 11, 9, 0, 'Back Squat'),
    ]);
    eq(days.map((d) => d.entries[0].exercise).join(','), 'Bench Press,Back Squat,Deadlift', 'newest day first regardless of the order the log arrives in');
}
{
    // Two exercises inside one session, plus one added later the same evening.
    const days = (0, ownTraining_1.trainingDays)([
        at(2026, 8, 12, 18, 0, 'Back Squat'),
        at(2026, 8, 12, 18, 0, 'Leg Press'),
        at(2026, 8, 12, 20, 5, 'Calf Raise'),
    ]);
    eq(days.length, 1, 'one calendar day is one group however many exercises it holds');
    eq(days[0].entries.length, 3, 'and it keeps all of them');
    eq(days[0].entries[0].exercise, 'Calf Raise', 'newest entry first inside the day');
}
// A row whose timestamp cannot be read is not a session that happened today.
// Filing it under today would invent a training day out of a parse failure —
// and on this screen that day is the one the coach is looking at.
{
    const days = (0, ownTraining_1.trainingDays)([
        { t: 'not a date', exercise: 'Ghost' },
        at(2026, 8, 12, 9, 0, 'Back Squat'),
    ]);
    eq(days.length, 1, 'an unreadable timestamp makes no day of its own');
    eq(days[0].entries.length, 1, 'and is not folded into a real one');
}
eq((0, ownTraining_1.trainingDays)([]).length, 0, 'an empty log is no days — not one empty day');
/* ── the sets line ─────────────────────────────────────────────────────── */
eq((0, ownTraining_1.setsSummary)(undefined, 'kg'), null, 'a cardio entry has no sets line at all');
eq((0, ownTraining_1.setsSummary)([], 'kg'), null, 'and neither does an empty array — null, not ""');
eq((0, ownTraining_1.setsSummary)([[8, 60], [8, 60], [8, 60]], 'kg'), '3 × 8 @ 60 kg', 'three identical sets collapse to one group');
// A drop set that returns to the opening weight is a different session from one
// that stayed there. Collapsing across the gap would hide the drop entirely.
eq((0, ownTraining_1.setsSummary)([[8, 60], [8, 40], [8, 60]], 'kg'), '1 × 8 @ 60 kg · 1 × 8 @ 40 kg · 1 × 8 @ 60 kg', 'only consecutive identical sets merge');
eq((0, ownTraining_1.setsSummary)([[5, 100], [5, 100], [3, 110]], 'kg'), '2 × 5 @ 100 kg · 1 × 3 @ 110 kg', 'a top set after a working run reads as its own group');
// Bodyweight. `liftIn` deliberately keeps a stored 0 rather than nulling it, so
// that this line can tell "no external load" from "the load is unknown".
eq((0, ownTraining_1.setsSummary)([[12, 0], [12, 0]], 'kg'), '2 × 12', 'a bodyweight set prints its reps and claims no weight');
eq((0, ownTraining_1.setsSummary)([[12, 0], [10, 20]], 'lb'), '1 × 12 · 1 × 10 @ 44 lb', 'a bodyweight set and a loaded one can sit in the same line');
// The load is read out in the coach's own unit. Storage is kilograms either
// way — see units.ts — so this is the same set said twice, not two figures.
eq((0, ownTraining_1.setsSummary)([[5, 100]], 'lb'), '1 × 5 @ 220.5 lb', '100 kg reads as 220.5 lb, at the half-pound the plates justify');
eq((0, ownTraining_1.setsSummary)([[5, 100]], 'kg'), '1 × 5 @ 100 kg', 'and as the stored kilograms for a metric reader');
if (errors.length) {
    console.error(`ownTraining: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error('  ✗ ' + e);
    process.exit(1);
}
console.log('ownTraining: ok');
