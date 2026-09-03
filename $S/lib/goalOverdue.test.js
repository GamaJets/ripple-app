"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// When a goal's target date has actually passed.
//
// ── Why this is its own file ───────────────────────────────────────────────
//
// `isOverdue` in src/lib/goalTargets.ts was three lines and was asserted only
// at distances — a target on the 20th, read on the 25th — which every wrong
// implementation also passes. What nothing asserted was the BOUNDARY, and the
// boundary is where all the harm was:
//
//   · `Date.parse` of a bare `date` is UTC midnight, so the deadline was the
//     instant the target day BEGAN rather than the instant it ended. A goal
//     "By 12 Sep" read "Target date passed (12 Sep)" all day on the 12th.
//   · That instant is UTC's, so it moved with the reader. A coach in Los
//     Angeles saw a goal go overdue at five in the afternoon on the ELEVENTH;
//     a coach at UTC+14 saw the same goal stay on time until two in the
//     afternoon on the twelfth. Same client, same goal, two answers.
//
// `goal_targets.target_date` is a bare Postgres `date`. It means a day in the
// life of the person who set it, and a day is not late until it is over.
//
// The zone is switched inside the process rather than left to the runner,
// because the failure only exists at particular offsets and a suite that can
// only see one of them is how this shipped. `process.env.TZ` is honoured by
// Node for Dates constructed after it changes.
//
// Compile with tsc, run with node.
const goalTargets_1 = require("./goalTargets");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const goal = (over = {}) => ({
    id: 'g1', kind: 'weight', targetValue: 80, title: null,
    targetDateISO: '2026-09-12', achievedAtISO: null,
    createdAtISO: '2026-08-01T09:00:00Z',
    ...over,
});
/** Run `f` with the process in `zone`, and put the zone back afterwards. */
function inZone(zone, f) {
    const was = process.env.TZ;
    process.env.TZ = zone;
    try {
        f();
    }
    finally {
        if (was == null)
            delete process.env.TZ;
        else
            process.env.TZ = was;
    }
}
/** A local wall-clock instant in the zone currently in force. */
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
/* ── the boundary, in five zones spanning the whole range ──────────────────── */
const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Midway', 'Asia/Kolkata'];
for (const zone of ZONES) {
    inZone(zone, () => {
        const g = goal();
        eq((0, goalTargets_1.isOverdue)(g, at(2026, 9, 11, 23, 59)), false, `${zone}: the night before the target day, the goal is not late`);
        eq((0, goalTargets_1.isOverdue)(g, at(2026, 9, 12, 0, 1)), false, `${zone}: one minute into the target day it is not late — this is the whole day the old code took away`);
        eq((0, goalTargets_1.isOverdue)(g, at(2026, 9, 12, 12, 0)), false, `${zone}: nor at midday on the target day`);
        eq((0, goalTargets_1.isOverdue)(g, at(2026, 9, 12, 23, 59)), false, `${zone}: nor with a minute of it left, which is still a minute they can use`);
        eq((0, goalTargets_1.isOverdue)(g, at(2026, 9, 13, 0, 1)), true, `${zone}: once the target day is over, it is late`);
        eq((0, goalTargets_1.isOverdue)(g, at(2026, 9, 20, 9, 0)), true, `${zone}: and it stays late`);
    });
}
/* ── the same instant, read in two zones, must not disagree about a day ───── */
{
    // 2026-09-12T07:00:00Z. In Los Angeles that is midnight on the 12th — the
    // target day has just started, so nothing is late. Under the old
    // implementation the UTC midnight of the 12th had already gone by, so this
    // exact instant reported the goal as overdue to that coach.
    const instant = Date.parse('2026-09-12T07:00:00Z');
    inZone('America/Los_Angeles', () => {
        eq((0, goalTargets_1.isOverdue)(goal(), instant), false, 'at midnight in Los Angeles on the target day the goal has a full day left');
    });
    // The same instant is 21:00 on the 12th in Kiritimati — still the target day
    // there too, and still not late.
    inZone('Pacific/Kiritimati', () => {
        eq((0, goalTargets_1.isOverdue)(goal(), instant), false, 'and the same instant is still the target day at UTC+14, so it is not late there either');
    });
}
/* ── the two answers that are not about dates at all ───────────────────────── */
inZone('UTC', () => {
    eq((0, goalTargets_1.isOverdue)(goal({ achievedAtISO: '2026-09-01T10:00:00Z' }), at(2026, 12, 1)), false, 'a goal they reached is never overdue, however long ago the date was');
    eq((0, goalTargets_1.isOverdue)(goal({ targetDateISO: null }), at(2026, 12, 1)), false, 'and a goal with no target date has no date to have passed');
    eq((0, goalTargets_1.isOverdue)(goal({ targetDateISO: 'not a date' }), at(2026, 12, 1)), false, 'an unreadable target date is not a passed one — it is an unknown one, and lateness is a claim');
});
/* ── a timestamp in the column, which is not what it holds but might be ────── */
inZone('UTC', () => {
    // `target_date` is a bare date and this is defensive rather than expected.
    // A full timestamp keeps its own instant through `localDate`, and the day it
    // falls on is still the day that has to be over.
    const g = goal({ targetDateISO: '2026-09-12T18:00:00Z' });
    eq((0, goalTargets_1.isOverdue)(g, Date.parse('2026-09-12T23:00:00Z')), false, 'a timestamped target is not late while its own day is still running');
    eq((0, goalTargets_1.isOverdue)(g, Date.parse('2026-09-13T01:00:00Z')), true, 'and is once that day is over');
});
if (errors.length) {
    console.error(`goalOverdue: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
}
console.log('goalOverdue ok — a day is not late until it is over, and it is over on the reader’s own calendar');
