"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIND_LABEL = exports.WORKOUT_KINDS = exports.MOBILITY_ACTIVITIES = exports.HIIT_ACTIVITIES = void 0;
exports.workoutKind = workoutKind;
// What kind of training a logged entry was, in one place.
//
// The workout log stores what was done — an exercise name, sets, a cardio
// block — but never what KIND of session it was. Train knows, because the
// person picked a mode before logging; nothing downstream does. So every
// screen that wants to colour, group or count by type has had to re-derive it
// from the name, and each one derived it slightly differently.
//
// This follows the precedent set by `src/lib/recoveryActs.ts`: one array with
// two consumers, so the two screens cannot drift. There the lesson was that a
// modality added to Train's picker had to appear on the Recovery screen too.
// Here it is the same shape of problem one step further out — a HIIT activity
// added to Train's picker must also come out of `workoutKind` as 'hiit', or
// the calendar quietly files somebody's Tabata under strength. The lists below
// are the single copy; Train imports them rather than holding its own.
//
// Pure and dependency-free on purpose: it is the classifier the UI colours
// from, and it should be testable without mounting a screen.
const recoveryActs_1 = require("./recoveryActs");
/** Titles are Title Case and each list is alphabetical. Acronyms stay upper-case. */
exports.HIIT_ACTIVITIES = [
    { name: 'AMRAP', met: 8.0 },
    { name: 'Bag Work', met: 7.0 },
    { name: 'Bike Intervals', met: 10.0 },
    { name: 'Circuit', met: 8.0 },
    { name: 'EMOM', met: 8.0 },
    { name: 'Sprint Intervals', met: 12.0 },
    { name: 'Tabata', met: 10.0 },
];
exports.MOBILITY_ACTIVITIES = [
    { name: 'Dynamic Warm-Up', met: 4.0 },
    { name: 'Foam Rolling', met: 2.5 },
    { name: 'Pilates', met: 3.5 },
    { name: 'Stretching', met: 2.5 },
    { name: 'Yoga', met: 3.0 },
];
const lower = (acts) => new Set(acts.map((a) => a.name.toLowerCase()));
const HIIT_NAMES = lower(exports.HIIT_ACTIVITIES);
const MOBILITY_NAMES = lower(exports.MOBILITY_ACTIVITIES);
/** The kinds in the order they should be drawn, so a legend and a row of dots agree. */
exports.WORKOUT_KINDS = ['strength', 'cardio', 'hiit', 'mobility', 'recovery'];
/**
 * UI copy for each kind.
 *
 * 'strength' reads as "Strength" here and as "Program" in Train's mode picker.
 * That is deliberate rather than an oversight: in Train the button starts a
 * coach-assigned or generated program, which is what the person is choosing;
 * on a calendar dot the reader is being told what a past session WAS, and
 * "Program" would name the source rather than the training.
 */
exports.KIND_LABEL = {
    strength: 'Strength',
    cardio: 'Cardio',
    hiit: 'HIIT',
    mobility: 'Mobility',
    recovery: 'Recovery',
};
/**
 * Which kind a logged entry was.
 *
 * Name first, shape second, and that order matters. Train writes recovery,
 * HIIT and mobility sessions down the same path as cardio — they all record
 * minutes and so they all carry a `cardio` block (see `logCardio` in
 * `app/(client)/workouts.tsx`). Deciding on the shape alone would therefore
 * file a sauna, a Tabata and a yoga class all as cardio, which is how a
 * colour-coded calendar ends up a single colour.
 *
 * Recovery is asked first because it is the one list shared with a whole
 * screen of its own, and because a recovery modality must never be counted as
 * exercise expenditure anywhere.
 *
 * `sets` is in the accepted shape but is not consulted: strength is the
 * fallback, not a positive match. An entry whose sets never saved is still a
 * strength entry, and requiring sets to prove it would hide it.
 */
function workoutKind(e) {
    const name = (e.exercise ?? '').trim().toLowerCase();
    if ((0, recoveryActs_1.isRecoveryActivity)(name))
        return 'recovery';
    if (HIIT_NAMES.has(name))
        return 'hiit';
    if (MOBILITY_NAMES.has(name))
        return 'mobility';
    if (e.cardio != null)
        return 'cardio';
    return 'strength';
}
