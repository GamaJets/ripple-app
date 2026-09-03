"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestProgression = suggestProgression;
exports.parseRepRange = parseRepRange;
exports.lastSetsFor = lastSetsFor;
exports.suggestNextWeight = suggestNextWeight;
exports.suggestForExercise = suggestForExercise;
exports.priorBest1RM = priorBest1RM;
const streaks_1 = require("./streaks");
// A 45-second plank is `[45, 10]` with `timed[0]` true — seconds in the reps
// slot. Every rule below reads `sets[i][0]` as repetitions, so a timed set has
// to be dropped before any of them sees it. src/lib/streaks.ts does exactly
// this (`if (isTimedSet(e, i)) continue;`) and this module was the sibling that
// never imported it.
const timedSets_1 = require("./timedSets");
const units_1 = require("./units");
// Lower-body / big compounds tolerate bigger jumps than small isolation lifts.
const BIG = /squat|deadlift|leg press|hip thrust|lunge|row|bench|pull-up|pulldown|press/i;
const SMALL = /curl|raise|fly|pushdown|extension|face pull|calf|crunch|plank/i;
const step = (name) => (SMALL.test(name) && !BIG.test(name) ? 2.5 : BIG.test(name) ? 5 : 2.5);
/**
 * The repeated, loaded sets of one entry — the only ones a rep-range rule may
 * read.
 *
 * A weighted hold passes every other test in this file: a 45-second plank under
 * a 10 kg plate is `[45, 10]`, both numbers positive, and 45 is "reps" as far
 * as arithmetic is concerned. It then cleared twelve reps on every top set, so
 * the member was told to add 2.5 kg to their plank and reset to eight — every
 * session, for ever.
 */
function liftedSets(e) {
    const out = [];
    const sets = e.sets || [];
    for (let i = 0; i < sets.length; i++) {
        if ((0, timedSets_1.isTimedSet)(e, i))
            continue;
        const [r, w] = sets[i];
        if ((w ?? 0) > 0 && (r ?? 0) > 0)
            out.push([r, w]);
    }
    return out;
}
// Group the log by exercise, newest session first, keeping only weighted sets.
function latestByExercise(log) {
    const seen = new Map();
    const sorted = [...log].sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
    for (const e of sorted) {
        if (!e.sets || !e.sets.length)
            continue;
        if (!liftedSets(e).length)
            continue;
        if (!seen.has(e.exercise))
            seen.set(e.exercise, e);
    }
    return seen;
}
/**
 * ── Why this takes a unit, and why it has no default ──────────────────────
 *
 * `rationale` is prose a member reads, and it was built here with "kg" written
 * into the template — seven times. A member set to pounds opened Targets and
 * read "Target Load 132 lb" in the panel with "In range at 60kg" printed
 * directly underneath it: one lift, two units, one card. Nothing was stored
 * wrong, which is why it survived so long.
 *
 * The parameter is `unit?: WeightUnit` and NOT `unit: WeightUnit = 'kg'`. A
 * default here would be the same defect wearing a parameter — `money()` in
 * src/lib/gymRecord.ts lost its `= 'AED'` for exactly this reason, and this is
 * a pure module with no member in scope to guess about. Every caller that
 * renders `rationale` passes the member's own unit; a caller that has none gets
 * a sentence with the LOAD left out rather than a sentence in a unit nobody
 * chose. The unit-free wording is deliberately still useful advice ("repeat the
 * same weight and build reps") rather than a dash, because unlike an amount of
 * money, the coaching decision does not depend on the unit at all.
 *
 * The DECISION is untouched: the increment ladder stays metric — 2.5 kg is a
 * plate pair, not a converted number — and `lastWeight` / `nextWeight` stay
 * kilograms, because the Targets screen renders them through `liftIn` and the
 * workout log is metric. Only the wording moves.
 */
function suggestProgression(log, unit, topRange = 12, bottomRange = 8) {
    /** A stored load as the member reads it, or null when nobody has told us how
     *  they read. Null is what selects the unit-free wording below. */
    const load = (kg) => (unit ? (0, units_1.liftLabel)(kg, unit) : null);
    /** A progression step as the member reads it. Converted as a SPAN, so a
     *  2.5 kg bump is "5.5 lb" every week rather than 5 or 6 depending on where
     *  the two loads happened to sit inside their rounding. */
    const bump = (kg) => {
        if (!unit)
            return null;
        const v = (0, units_1.liftDeltaIn)(kg, unit);
        return v == null ? null : `${(0, units_1.plain)(v)} ${unit}`;
    };
    const latest = latestByExercise(log);
    const tips = [];
    for (const [exercise, e] of latest) {
        const working = liftedSets(e);
        if (!working.length)
            continue;
        // Heaviest weight used, and the best reps achieved at that weight.
        const lastWeight = Math.max(...working.map(([, w]) => w));
        const atTop = working.filter(([, w]) => w === lastWeight);
        const lastReps = Math.max(...atTop.map(([r]) => r));
        // Did every top-weight set clear the top of the range?
        const allClearedTop = atTop.every(([r]) => r >= topRange);
        const at = load(lastWeight);
        let action, nextWeight = lastWeight, nextReps = `${bottomRange}-${topRange}`, rationale = '';
        if (allClearedTop) {
            action = 'increase';
            nextWeight = Math.round((lastWeight + step(exercise)) * 2) / 2;
            nextReps = `${bottomRange}-${topRange}`;
            const add = bump(step(exercise));
            rationale = `Cleared ${topRange}+ reps on every top set — add ${add ?? 'a step'} and reset to ${bottomRange}.`;
        }
        else if (lastReps >= bottomRange) {
            action = 'reps';
            nextWeight = lastWeight;
            nextReps = `${Math.min(topRange, lastReps + 1)}+`;
            rationale = `In range${at ? ` at ${at}` : ''} — hold the weight and chase one more rep (aim ${Math.min(topRange, lastReps + 1)}).`;
        }
        else if (lastReps >= Math.max(3, bottomRange - 3)) {
            action = 'hold';
            nextWeight = lastWeight;
            nextReps = `${bottomRange}-${topRange}`;
            rationale = `Just under range — repeat ${at ?? 'the same weight'} and build reps before adding load.`;
        }
        else {
            action = 'deload';
            nextWeight = Math.round((lastWeight * 0.9) * 2) / 2;
            nextReps = `${bottomRange}-${topRange}`;
            // The figure named is the one the card shows as the target, not a second
            // rounding of the same 10% — two numbers a rep apart on one card is how a
            // member decides the suggestion is guesswork.
            const easeTo = load(nextWeight);
            rationale = easeTo
                ? `Reps fell off — ease to ~${easeTo} and rebuild.`
                : 'Reps fell off — ease off about 10% and rebuild.';
        }
        // RPE / "felt" signal: the hardest feel logged on the top-weight sets (captured
        // per set in session mode) governs how aggressively to progress.
        const feels = e.feel || [];
        const topFeels = (e.sets || [])
            .map((s, i) => ({ w: s[1], r: s[0], f: feels[i] }))
            .filter((x) => x.w === lastWeight && x.r > 0 && !!x.f)
            .map((x) => x.f);
        const feltHard = topFeels.includes('hard');
        const feltEasy = topFeels.length > 0 && topFeels.every((f) => f === 'easy');
        if (feltHard && action === 'increase') {
            action = 'reps';
            nextWeight = lastWeight;
            nextReps = `${Math.min(topRange, lastReps)}+`;
            rationale = `Cleared the range but the top sets felt hard — hold ${at ?? 'the same weight'} and bank the reps before adding load.`;
        }
        else if (feltHard && action === 'reps') {
            action = 'hold';
            nextWeight = lastWeight;
            nextReps = `${bottomRange}-${topRange}`;
            rationale = `In range but it felt hard — repeat ${at ?? 'the same weight'} to consolidate before progressing.`;
        }
        else if (feltEasy && action === 'reps') {
            action = 'increase';
            nextWeight = Math.round((lastWeight + step(exercise)) * 2) / 2;
            nextReps = `${bottomRange}-${topRange}`;
            rationale = `In range and every top set felt easy — add ${bump(step(exercise)) ?? 'a step'} now.`;
        }
        else if (feltEasy && action === 'increase') {
            rationale = rationale + ' Top sets felt easy — add with confidence.';
        }
        tips.push({ exercise, lastWeight, lastReps, nextWeight, nextReps, action, rationale, at: e.t });
    }
    // Show the biggest lifts first (proxy: heaviest last weight).
    return tips.sort((a, b) => b.lastWeight - a.lastWeight);
}
/** Parse a program rep target: "6-8" → {6,8}; "12" → {12,12}; "45 sec" → null. */
function parseRepRange(reps) {
    const m = reps.match(/(\d+)\s*-\s*(\d+)/);
    if (m)
        return { low: +m[1], high: +m[2] };
    const s = reps.match(/^\s*(\d+)\s*$/);
    if (s)
        return { low: +s[1], high: +s[1] };
    return null;
}
/** Most-recent logged sets for a given exercise name (newest entry wins). */
function lastSetsFor(log, exerciseName) {
    const entries = log.filter((e) => e.exercise === exerciseName && e.sets && e.sets.length).sort((a, b) => b.t.localeCompare(a.t));
    const e = entries[0];
    if (!e)
        return undefined;
    // The holds come out here too: `suggestNextWeight` reads the pair as reps and
    // load, so a session of planks would otherwise recommend a heavier plank.
    // An entry that was ALL holds returns undefined — no suggestion at all — which
    // is the right answer for a movement this rule has nothing to say about.
    const lifted = liftedSets(e);
    return lifted.length ? lifted : undefined;
}
/** Recommend the next working weight from the last session's sets. */
function suggestNextWeight(lastSets, range, increment = 2.5, 
// No `= 'kg'`. That default was an invented unit in a pure module — the same
// shape as `money(cents, currency = 'AED')`, which this codebase already had
// to unpick after it reached disk. An omitted unit now means "nobody has told
// us how this member reads", and the sentence below leaves the load out
// rather than stating it in a unit nobody chose.
unit) {
    if (!lastSets || lastSets.length === 0)
        return null;
    let topW = 0, repsAtTop = 0;
    for (const [r, w] of lastSets) {
        if (w > topW) {
            topW = w;
            repsAtTop = r;
        }
        else if (w === topW && r > repsAtTop)
            repsAtTop = r;
    }
    if (topW <= 0)
        return null;
    const round = (n) => Math.round(n * 2) / 2;
    // `weight` stays kilograms — it is fed straight back into the log, the
    // warm-up ramp and the PR check, all of which are metric. Only `reason` is
    // prose, and prose is read rather than computed on.
    const read = (kg) => (unit ? (0, units_1.liftLabel)(kg, unit) : null);
    const top = read(topW);
    if (range && repsAtTop >= range.high) {
        const add = unit ? `${(0, units_1.plain)((0, units_1.liftDeltaIn)(increment, unit) ?? increment)} ${unit}` : 'a step';
        return {
            weight: round(topW + increment),
            up: true,
            reason: `You hit ${repsAtTop} reps at ${top ?? 'your top weight'} — add ${add}`,
        };
    }
    return {
        weight: round(topW),
        up: false,
        reason: range
            ? `Match ${top ?? 'your last top weight'}, aim for ${range.high} reps`
            : `Match last: ${top ?? 'your last top weight'}`,
    };
}
/**
 * Convenience: suggestion for one program exercise given the log.
 *
 * ── Why this takes a unit ───────────────────────────────────────────────────
 *
 * `weight` has always been kilograms and the Train tab has always rendered it
 * through `liftLabel`, so the number a pounds member reads was right. The
 * SENTENCE beside it was not: `reason` was built here with "kg" written into
 * it, so a member set to pounds saw "132 lb" and, immediately to its right,
 * "You hit 8 reps at 60kg — add 2.5kg". Two figures for the same lift, in two
 * units, on one line, in front of their coach — and the one in kilograms looks
 * like the app has lost track of what they lift.
 *
 * The unit is a reading convention only. Nothing about the DECISION changes:
 * the increment ladder stays metric (see `feelStep` in the session runner for
 * why a second, imperial ladder would be a second progression model), and what
 * moves is the wording.
 */
function suggestForExercise(log, exerciseName, reps, increment = 2.5, unit) {
    return suggestNextWeight(lastSetsFor(log, exerciseName), parseRepRange(reps), increment, unit);
}
/**
 * Best estimated-1RM ever recorded for an exercise (for live PR detection).
 *
 * Timed sets are skipped, and this is the half of the plank defect that did not
 * heal on its own: Epley over seconds is arithmetic on a stopwatch, and one
 * logged 45-second hold under a plate raised that movement's "best" to a
 * fictional 1RM no real set could beat — so real records on it stopped firing,
 * permanently and silently. src/lib/timedSets.ts states the rule this now
 * keeps: a timed set produces no estimated 1RM.
 */
function priorBest1RM(log, exerciseName) {
    let best = 0;
    for (const e of log) {
        if (e.exercise !== exerciseName || !e.sets)
            continue;
        for (let i = 0; i < e.sets.length; i++) {
            if ((0, timedSets_1.isTimedSet)(e, i))
                continue;
            const [r, w] = e.sets[i];
            if (w && r)
                best = Math.max(best, (0, streaks_1.est1RM)(w, r));
        }
    }
    return best;
}
