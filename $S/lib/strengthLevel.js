"use strict";
// Grading a lift against bodyweight — and the third answer the screen that does
// the grading did not have.
//
// app/(client)/standards.tsx had two:
//
//   const ratio = best && bw ? best / bw : 0;
//   const lvl   = best ? levelFor(ratio, lift.mult) : -2;
//
// `bw` is `clients.weightKg`, which is null for anybody who has never scanned
// or typed a weight AND for everybody whose scans read failed. So a lifter with
// a 2× bodyweight deadlift on record, opening the screen with no signal, was
// handed a ratio of 0.00×, `levelFor(0, …)` = -1, a five-segment level bar with
// nothing filled in, and the words "Getting started" — the app's way of saying
// "below beginner", stated as a fact about a lift it had never divided.
//
// The two facts being confused are opposites. "We do not know your bodyweight"
// is a hole in OUR record; "you are below the beginner standard" is a claim
// about the reader's strength. Printing the second in place of the first is the
// house rule of src/ui/loadStatus.ts in its most personal form: an unread value
// rendered as a real one, in the one place on the screen where the reader is
// being ranked.
//
// So a grade is one of three things, and the screen renders each of them
// differently rather than folding two into a number:
//
//   'unlogged'   nothing on the log matches this lift. Whether that means
//                "never done it" or "the log could not be read" is the log's
//                status to say, and standards.tsx says it above the rows.
//   'ungradable' there IS a best lift and it is printed, but there is no
//                bodyweight to divide it by. No ratio, no level bar, no
//                "Getting started".
//   'graded'     both numbers are real. `level` is -1 for genuinely below the
//                first standard, and 0…mult.length-1 for the level reached.
Object.defineProperty(exports, "__esModule", { value: true });
exports.levelFor = levelFor;
exports.gradeLift = gradeLift;
/** The level a ratio reaches on one lift's ladder. -1 = below the first rung. */
function levelFor(ratio, mult) {
    let lvl = -1;
    for (let i = 0; i < mult.length; i++)
        if (ratio >= mult[i])
            lvl = i;
    return lvl;
}
/**
 * Grade one lift. `best` is the best estimated 1RM in kilograms, `bodyweightKg`
 * the client's weight in the same unit — both nullable, because both come from
 * reads that can fail.
 *
 * Neither number is trusted blindly: a zero or negative bodyweight would make
 * the ratio infinite or negative, and a NaN from a malformed row would compare
 * false against every multiple and quietly grade as "below beginner", which is
 * the very sentence this function exists to stop being said by accident.
 */
function gradeLift(best, bodyweightKg, mult) {
    if (best == null || !Number.isFinite(best) || best <= 0)
        return { kind: 'unlogged' };
    if (bodyweightKg == null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) {
        return { kind: 'ungradable', best };
    }
    const ratio = best / bodyweightKg;
    return { kind: 'graded', best, ratio, level: levelFor(ratio, mult) };
}
