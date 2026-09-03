"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// "Have I trained legs this week?" — and the three ways answering it lies.
// Compile with tsc, run with node.
//
// The board is a join between a workout log and the exercise catalogue, and
// each side can be wrong in a way that reads as a fact about somebody's body:
//
//   THE JOIN        a movement is filed by the catalogue, once, by slug
//   UNMATCHED       work we cannot file is stated, never silently dropped
//   ABSENCE         "you have not trained your back" needs a whole catalogue
//   THE WINDOW      a session outside it is not in the figure
//   WHAT COUNTS     holds are sets; a hold is not tonnage; cardio is neither
const muscleVolume_1 = require("./muscleVolume");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const at = (day, hour = 12) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};
const NOW = Date.parse(at('2026-09-01'));
const WEEK = 7 * 86400000;
const CATALOGUE = [
    { id: 'back-squat', name: 'Back Squat', group: 'Legs' },
    { id: 'leg-press', name: 'Leg Press', group: 'Legs' },
    { id: 'bench-press', name: 'Bench Press', group: 'Chest' },
    { id: 'pull-up', name: 'Pull-up', group: 'Back' },
    { id: 'plank', name: 'Plank', group: 'Core' },
    { id: 'no-group', name: 'Mystery Machine', group: null },
];
const HISTORY = [{ t: at('2026-01-01'), v: 80 }];
/* ── THE JOIN ─────────────────────────────────────────────────────────────
 *
 * Keyed on `exerciseSlug`, which is the app's one answer to "are these the
 * same movement". Two spellings of a squat are one squat and one muscle.
 */
{
    const log = [
        { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100], [5, 100]] },
        { t: at('2026-08-31'), exercise: 'back squat', sets: [[8, 80]] },
        { t: at('2026-08-31'), exercise: 'Bench Press', sets: [[5, 80]] },
    ];
    const b = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, history: HISTORY, catalogueWhole: true });
    eq(b.groups.length, 2, 'two muscle groups were trained');
    eq(b.groups[0].group, 'Legs', 'most sets first');
    eq(b.groups[0].sets, 3, 'and both spellings of the squat are the same movement in the same group');
    eq(b.groups[0].volumeKg, 1000 + 640, 'with the tonnage totalled across them');
    eq(b.groups[0].exercises.length, 2, 'the movements are listed as they were written, because that is what the member typed');
    eq(b.groups[0].lastDay, '2026-08-31', 'and the group knows when it was last trained');
    eq(b.groups[1].group, 'Chest', 'the lighter group is behind it');
    eq(b.unmatched.length, 0, 'nothing was left unfiled');
}
/* ── UNMATCHED ────────────────────────────────────────────────────────────
 *
 * A coach can write any exercise they like and a member can type one in.
 * That work happened; the board cannot file it; leaving it out silently makes
 * the board understate the week and look complete doing it.
 */
{
    const log = [
        { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] },
        { t: at('2026-08-30'), exercise: 'Kettlebell Windmill', sets: [[8, 16], [8, 16]] },
        { t: at('2026-08-30'), exercise: 'Mystery Machine', sets: [[10, 30]] },
    ];
    const b = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, catalogueWhole: true });
    eq(b.groups.length, 1, 'only the movement with a group is on the board');
    eq(b.unmatchedSets, 3, 'and the three sets that could not be filed are counted');
    ok(b.unmatched.includes('Kettlebell Windmill'), 'a movement absent from the catalogue is named');
    ok(b.unmatched.includes('Mystery Machine'), 'and so is one that IS in the catalogue with no muscle group on it — an unfiled row is unfiled either way');
    const note = (0, muscleVolume_1.unmatchedNote)(b);
    ok(!!note && note.includes('3 sets'), 'the sentence counts sets, because that is the size of the hole');
    ok(!!note && note.includes('Kettlebell Windmill'), 'and names them, so the member can see what is missing');
    eq((0, muscleVolume_1.unmatchedNote)({ ...muscleVolume_1.EMPTY_BOARD, groups: [] }), null, 'and there is no sentence when nothing is missing');
}
/* ── ABSENCE ──────────────────────────────────────────────────────────────
 *
 * "You have not trained your back" is a claim about a list. Making it off a
 * catalogue read that failed or stopped short is the LoadStatus rule broken by
 * a different door.
 */
{
    const log = [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] }];
    const whole = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, catalogueWhole: true });
    ok(whole.untrained != null, 'a whole catalogue read can state what was not trained');
    ok(whole.untrained.includes('Back'), 'and it says so about the back');
    ok(!whole.untrained.includes('Legs'), 'while the group that WAS trained is not on the list');
    const partial = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, catalogueWhole: false });
    eq(partial.untrained, null, 'a catalogue we have not seen the end of supports no claim about an untrained muscle');
    eq(partial.groups.length, 1, 'though everything we DID read is still on the board — the rows are real');
    const nothing = (0, muscleVolume_1.muscleBoard)([], CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, catalogueWhole: true });
    eq(nothing.groups.length, 0, 'a week with nothing logged has no groups');
    ok(nothing.untrained != null && nothing.untrained.length === 4, 'and every group in the catalogue is named as untrained rather than drawn as a row of noughts');
}
/* ── THE WINDOW ───────────────────────────────────────────────────────────── */
{
    const log = [
        { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] },
        { t: at('2026-08-01'), exercise: 'Bench Press', sets: [[5, 80]] },
        { t: '', exercise: 'Pull-up', sets: [[10, 0]], bw: [true] },
        { t: 'not a date', exercise: 'Pull-up', sets: [[10, 0]], bw: [true] },
    ];
    const b = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, catalogueWhole: true });
    eq(b.groups.length, 1, 'a session a month ago is not in this week');
    eq(b.groups[0].group, 'Legs', 'and the one in the window is');
    ok(!b.unmatched.length, 'an entry whose timestamp will not parse is left out entirely rather than filed under today');
    const wider = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - 60 * 86400000, nowMs: NOW, catalogueWhole: true });
    eq(wider.groups.length, 2, 'and a wider window reaches the older session');
}
/* ── WHAT COUNTS ──────────────────────────────────────────────────────────
 *
 * A hold loaded the muscle and is a set; it is not tonnage. Cardio is neither.
 * A bodyweight set nobody has a weight for is a set with no price on it, said
 * out loud rather than counted as zero.
 */
{
    const log = [
        { t: at('2026-08-30'), exercise: 'Plank', sets: [[45, 0], [45, 0]], timed: [true, true], bw: [true, true] },
        { t: at('2026-08-30'), exercise: 'Cycling', cardio: { mins: 40, dist: 15, unit: 'km' } },
    ];
    const b = (0, muscleVolume_1.muscleBoard)(log, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, history: HISTORY, catalogueWhole: true });
    eq(b.groups.length, 1, 'the cardio row has no sets and is not filed under a muscle');
    eq(b.groups[0].group, 'Core', 'the planks are');
    eq(b.groups[0].sets, 2, 'and both holds count as sets, because the body was loaded twice');
    eq(b.groups[0].volumeKg, null, 'with no tonnage — null, never a well-formed 0 — because seconds times kilograms is not a mass moved');
    const unpriced = (0, muscleVolume_1.muscleBoard)([{ t: at('2026-08-30'), exercise: 'Pull-up', sets: [[10, 0], [8, 0]], bw: [true, true] }], CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, history: [], catalogueWhole: true });
    eq(unpriced.groups[0].sets, 2, 'a member nobody has weighed still did two sets of pull-ups');
    eq(unpriced.groups[0].volumeKg, null, 'they have no tonnage');
    eq(unpriced.groups[0].unpricedSets, 2, 'and the board says how many sets are not in the figure');
    const priced = (0, muscleVolume_1.muscleBoard)([{ t: at('2026-08-30'), exercise: 'Pull-up', sets: [[10, 0]], bw: [true] }], CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, history: HISTORY, catalogueWhole: true });
    eq(priced.groups[0].volumeKg, 800, 'and with a weigh-in behind it the same set is priced at the body that did it');
    eq(priced.groups[0].unpricedSets, 0, 'with nothing left out');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('muscleVolume.test.ts ok');
