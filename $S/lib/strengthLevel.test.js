"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Grading a lift against a bodyweight we may not have. Compile with tsc, run
// with node.
//
// The bug this guards: a real 200 kg deadlift with no bodyweight on record was
// graded "0.00× · Getting started" — an empty five-segment bar telling a lifter
// they are below the beginner standard, because `best && bw ? best / bw : 0`
// fell to zero and `levelFor(0, …)` returns -1, which the screen renders. These
// assertions pin the one distinction that fixes it: no bodyweight is a THIRD
// answer, and it is never the bottom of the scale.
const strengthLevel_1 = require("./strengthLevel");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// The deadlift ladder from app/(client)/standards.tsx.
const DEAD = [1.0, 1.5, 2.0, 2.5, 3.0];
const kindOf = (g) => g.kind;
/* ── the reported case: a real lift, no bodyweight ─────────────────────── */
const noBw = (0, strengthLevel_1.gradeLift)(200, null, DEAD);
eq(kindOf(noBw), 'ungradable', 'a lift with no bodyweight is ungradable, not level -1');
ok(!('level' in noBw), 'an ungradable lift carries no level at all');
ok(noBw.kind === 'ungradable' && noBw.best === 200, 'the best lift survives — it is the half we do know');
// The distinction the screen turns on. Both of these used to arrive as -1.
const below = (0, strengthLevel_1.gradeLift)(60, 100, DEAD);
ok(below.kind === 'graded' && below.level === -1, 'a genuinely light lift IS below the first standard');
ok(kindOf(below) !== kindOf(noBw), 'below-beginner and no-bodyweight are not the same answer');
/* ── nothing logged ────────────────────────────────────────────────────── */
eq(kindOf((0, strengthLevel_1.gradeLift)(0, 80, DEAD)), 'unlogged', 'a zero best means nothing was found for this lift');
eq(kindOf((0, strengthLevel_1.gradeLift)(null, 80, DEAD)), 'unlogged', 'a null best means nothing was found');
eq(kindOf((0, strengthLevel_1.gradeLift)(undefined, 80, DEAD)), 'unlogged', 'an undefined best means nothing was found');
// `personalRecords` reduces with Math.max from 0, so 0 is what an unmatched
// lift actually arrives as. It must not reach the ratio.
eq(kindOf((0, strengthLevel_1.gradeLift)(0, null, DEAD)), 'unlogged', 'no lift and no bodyweight is still no lift');
/* ── a bodyweight that cannot divide ───────────────────────────────────── */
// Zero would make the ratio Infinity and grade every reader Elite; a negative
// or a NaN from a malformed row would compare false against every multiple and
// grade them below beginner. Both are holes, not grades.
eq(kindOf((0, strengthLevel_1.gradeLift)(200, 0, DEAD)), 'ungradable', 'a zero bodyweight cannot grade a lift');
eq(kindOf((0, strengthLevel_1.gradeLift)(200, -80, DEAD)), 'ungradable', 'a negative bodyweight cannot grade a lift');
eq(kindOf((0, strengthLevel_1.gradeLift)(200, NaN, DEAD)), 'ungradable', 'a NaN bodyweight cannot grade a lift');
eq(kindOf((0, strengthLevel_1.gradeLift)(NaN, 80, DEAD)), 'unlogged', 'a NaN best is not a lift');
/* ── the grading itself, unchanged ─────────────────────────────────────── */
const g = (0, strengthLevel_1.gradeLift)(200, 100, DEAD);
ok(g.kind === 'graded' && g.ratio === 2, 'the ratio is best over bodyweight');
ok(g.kind === 'graded' && g.level === 2, '2× bodyweight is the third rung of the deadlift ladder');
ok((0, strengthLevel_1.gradeLift)(300, 100, DEAD).kind === 'graded'
    && (0, strengthLevel_1.gradeLift)(300, 100, DEAD).level === DEAD.length - 1, '3× bodyweight tops the scale');
// A ratio exactly on a multiple counts as having reached it — a 100 kg lifter
// who deadlifts 150 is Novice, not "nearly Novice".
eq((0, strengthLevel_1.levelFor)(1.5, DEAD), 1, 'a ratio sitting exactly on a standard reaches it');
eq((0, strengthLevel_1.levelFor)(0.99, DEAD), -1, 'a ratio under the first standard is below the scale');
eq((0, strengthLevel_1.levelFor)(0, DEAD), -1, 'zero is below the scale — which is why zero must never be a stand-in for unknown');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('strengthLevel: ok');
