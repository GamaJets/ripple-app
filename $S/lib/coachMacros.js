"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIET_WORD = exports.GOAL_WORD = exports.ACTIVITY_LEVELS = void 0;
exports.activityFactor = activityFactor;
exports.activityLevelOf = activityLevelOf;
exports.asOwnGoal = asOwnGoal;
exports.asOwnDiet = asOwnDiet;
exports.macroGate = macroGate;
exports.unaskedLine = unaskedLine;
exports.builtFromLine = builtFromLine;
/**
 * The five levels, in order, with the multiplier each one means.
 *
 * The factors are the published Harris–Benedict set and are not this app's
 * invention. They are stated here once so the database constraint
 * (supabase/parts/1020) and the app agree on the range, and so that no screen
 * ever writes a bare number of its own.
 */
exports.ACTIVITY_LEVELS = [
    { id: 'sedentary', label: 'Sedentary', note: 'Desk work, no training beyond walking about.', factor: 1.2 },
    { id: 'light', label: 'Lightly active', note: 'On your feet some of the day, or training one to three times a week.', factor: 1.375 },
    { id: 'moderate', label: 'Moderately active', note: 'Coaching sessions most days, or training three to five times a week.', factor: 1.55 },
    { id: 'active', label: 'Very active', note: 'On the floor all day, or training six or seven times a week.', factor: 1.725 },
    { id: 'very-active', label: 'Extremely active', note: 'Physical work plus daily training, or two sessions a day.', factor: 1.9 },
];
/** The multiplier for a level. */
function activityFactor(level) {
    return exports.ACTIVITY_LEVELS.find((a) => a.id === level)?.factor ?? 1.55;
}
/**
 * The level a stored multiplier belongs to, or null.
 *
 * Nearest rather than exact, because a row written by an earlier build — or by
 * hand — may carry a value between two levels, and a coach whose stored figure
 * is 1.5 is not wrong, only unlabelled. Null for anything outside the range the
 * constraint allows, so a nonsense value is asked again rather than snapped to
 * the nearest sensible-looking one.
 */
function activityLevelOf(factor) {
    if (factor == null || !Number.isFinite(factor))
        return null;
    if (factor < 1 || factor > 2.5)
        return null;
    let best = exports.ACTIVITY_LEVELS[0];
    for (const a of exports.ACTIVITY_LEVELS) {
        if (Math.abs(a.factor - factor) < Math.abs(best.factor - factor))
            best = a;
    }
    return best.id;
}
/** A stored `own_goal`, or null when it is not one of the three. */
function asOwnGoal(v) {
    return v === 'fatloss' || v === 'tone' || v === 'muscle' ? v : null;
}
/** A stored `own_diet`, or null when it is not one of the five. */
function asOwnDiet(v) {
    return v === 'meat' || v === 'vegetarian' || v === 'vegan' || v === 'paleo' || v === 'keto' ? v : null;
}
/**
 * The one decision this screen turns on.
 *
 * Every refusal is its own sentence, because to a coach they are four different
 * situations and only one of them is anything they can act on now:
 *
 *   'reading'    — the answers have not arrived. Nothing is claimed either way.
 *   'unread'     — the read failed. NOT "you have not answered", which would
 *                  invite a coach to answer a second time and, worse, would
 *                  read as a reason to accept a target built from defaults.
 *   'unmeasured' — no weight or no body fat on record, which is the gate this
 *                  screen already had and is kept exactly as it was.
 *   'unasked'    — the coach genuinely has not said. This is the one with a
 *                  control under it.
 *
 * `measured` is passed rather than read here so this module never touches a
 * body: the screen already knows whether it has one.
 */
function macroGate(o) {
    if (o.status === 'loading') {
        return { ok: false, reason: 'reading', why: 'Reading the answers your target is built from.' };
    }
    if (o.status === 'error') {
        return {
            ok: false,
            reason: 'unread',
            why: 'Your goal, diet and activity level could not be read, so no target is worked out. That is a read that failed rather than questions you have not answered — pull down to try again.',
        };
    }
    if (!o.measured) {
        return {
            ok: false,
            reason: 'unmeasured',
            why: 'A target needs a weight and a body-fat figure on record. Add a weigh-in and a scan, and this will work itself out from them.',
        };
    }
    const { goal, diet, activity } = o.inputs;
    if (goal == null || diet == null || activity == null) {
        return { ok: false, reason: 'unasked', why: unaskedLine({ goal, diet, activity }) };
    }
    return { ok: true, goal, diet, activity };
}
/**
 * Which of the three is still missing, said by name.
 *
 * Named rather than counted, because the coach has to know which control to
 * touch — and because "answer three questions" is a chore while "we do not know
 * your goal" is a sentence somebody finishes.
 */
function unaskedLine(i) {
    const missing = [];
    if (i.goal == null)
        missing.push('what you are training for');
    if (i.diet == null)
        missing.push('how you eat');
    if (i.activity == null)
        missing.push('how active your week is');
    const list = missing.length === 1
        ? missing[0]
        : missing.length === 2
            ? `${missing[0]} or ${missing[1]}`
            : `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}`;
    return `You have not told this app ${list}, so it will not put a calorie target in front of you. `
        + 'It used to assume you were building muscle, eating meat and moderately active, and count the day down against that.';
}
/** What the screen says once the three are answered — so a number a coach reads
 *  all day carries the assumptions it was built from. */
function builtFromLine(goal, diet, activity) {
    const level = activityLevelOf(activity);
    const label = exports.ACTIVITY_LEVELS.find((a) => a.id === level)?.label.toLowerCase() ?? 'the activity level you set';
    return `Built from your own answers: ${exports.GOAL_WORD[goal]}, ${exports.DIET_WORD[diet]}, ${label}. Change any of them and the target moves.`;
}
exports.GOAL_WORD = {
    fatloss: 'losing fat',
    tone: 'holding your weight',
    muscle: 'building muscle',
};
exports.DIET_WORD = {
    meat: 'eating meat',
    vegetarian: 'vegetarian',
    vegan: 'vegan',
    paleo: 'paleo',
    keto: 'keto',
};
