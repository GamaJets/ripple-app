"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainingDays = trainingDays;
exports.setsSummary = setsSummary;
const entryEdit_1 = require("./entryEdit");
const units_1 = require("./units");
/**
 * A log split into the days it was performed on, newest day first.
 *
 * The order is stated rather than inherited. `useWorkoutLog` already hands back
 * newest-first rows, but a screen that renders "Today" at the top must not be
 * relying on the provider's ORDER BY staying what it is — a reversed page would
 * silently put last month at the top of a screen headed "Recent".
 */
function trainingDays(log) {
    const byDay = new Map();
    for (const e of log) {
        const day = (0, entryEdit_1.dayKeyOf)(e.t);
        if (!day)
            continue;
        const bucket = byDay.get(day);
        if (bucket)
            bucket.push(e);
        else
            byDay.set(day, [e]);
    }
    return [...byDay.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, entries]) => ({
        day,
        // Newest first inside the day too, so an exercise added five minutes ago
        // is at the top of the day it belongs to rather than the bottom.
        entries: [...entries].sort((x, y) => Date.parse(y.t) - Date.parse(x.t)),
    }));
}
/**
 * One line describing what was actually lifted, in the unit the reader has
 * chosen. Null when there is nothing to describe.
 *
 * Null rather than an empty string, and null rather than "0 sets": a cardio
 * entry carries no `sets` at all, and a screen handed "" would render a blank
 * where it expected a sentence. The caller decides what absence looks like.
 *
 * A load of zero is a bodyweight set — pull-ups, press-ups — and prints as the
 * reps alone. units.ts says the same thing from the other side: `liftIn` keeps
 * a 0 rather than nulling it, precisely so the screens can tell "no external
 * load" from "nobody recorded the load", and printing "8 × 0 kg" would state a
 * weight that was never on the bar.
 */
function setsSummary(sets, unit) {
    if (!sets || !sets.length)
        return null;
    const parts = [];
    let i = 0;
    while (i < sets.length) {
        const [reps, kg] = sets[i];
        let run = 1;
        while (i + run < sets.length && sets[i + run][0] === reps && sets[i + run][1] === kg)
            run++;
        // `kg` may be 0, null or undefined off a jsonb column that has held all
        // three. Only a real, positive load gets printed.
        const load = kg ? (0, units_1.liftLabel)(kg, unit) : null;
        // Sets × reps @ load, which is how it is written on a gym notepad. The "@"
        // rather than a second "×" so that "3 × 8 @ 60 kg" cannot be read as three
        // multiplications, and " · " between groups so the two separators never
        // stand for the same relationship.
        parts.push(load ? `${run} × ${reps} @ ${load}` : `${run} × ${reps}`);
        i += run;
    }
    return parts.join(' · ');
}
