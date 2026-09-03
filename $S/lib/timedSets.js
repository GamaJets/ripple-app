"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_HOLD_SECONDS = void 0;
exports.isTimedSet = isTimedSet;
exports.hasTimedSet = hasTimedSet;
exports.prescribedSeconds = prescribedSeconds;
exports.isTimedPrescription = isTimedPrescription;
exports.readHold = readHold;
exports.holdLabel = holdLabel;
exports.timedSetLabel = timedSetLabel;
exports.setChipLabel = setChipLabel;
exports.setListLabel = setListLabel;
exports.entryHoldSeconds = entryHoldSeconds;
exports.holdRecords = holdRecords;
// The other flag that changes what `sets[i][1]` MEANS. Consulted rather than
// re-implemented: a bodyweight set's second number is what was ADDED to the
// body, and two files deciding separately how to print that is how the saved
// chips came to disagree with the draft chips they sit six inches from. Both
// modules only reach into the other from inside a function body, so the cycle
// resolves at call time and neither is half-built when it is read.
const bodyweightSets_1 = require("./bodyweightSets");
/** True when the person said this set was held for a time rather than
 *  repeated. `sets[i][0]` is then SECONDS. */
function isTimedSet(e, i) {
    return e.timed?.[i] === true;
}
/** Whether any set of an entry was timed — for a row that has to decide how to
 *  word itself before it looks at the individual sets. */
function hasTimedSet(e) {
    return Array.isArray(e.timed) && e.timed.some((x) => x === true);
}
/**
 * The seconds a coach's rep prescription is asking for, or null when it is
 * asking for reps.
 *
 * Read from the prescription STRING because that is where the app already
 * says it: `'45 sec'`, `'30 sec/side'`, `'1 min'`, `'90s'`, `'2 min hold'`.
 * Nothing writes a machine-readable duration onto a programme, three years of
 * templates are already stored as prose, and a coach typing "45 sec" into the
 * builder means the same thing today as they did then.
 *
 * A range — `'30-45 sec'` — takes the FIRST number. It is the one the member
 * has to reach for the set to count, and a runner that seeds the box with the
 * top of a range is asking somebody to fail.
 *
 * Deliberately narrow. Only an explicit unit counts, so a bare `'12'` is
 * twelve reps and stays twelve reps: guessing that a large bare number must be
 * seconds is how "AMRAP 100" becomes a minute and forty seconds.
 */
function prescribedSeconds(reps) {
    if (!reps)
        return null;
    const text = String(reps).toLowerCase();
    // The FIRST figure in the prescription, always. '30-45 sec' is a range and
    // the thirty is the one that has to be reached; anchoring on the number that
    // happens to sit next to the unit picks the forty-five and seeds a runner
    // with the top of a range, which is asking somebody to fail.
    const first = text.match(/\d+(?:\.\d+)?/);
    if (!first)
        return null;
    // Minutes first: '1 min 30' would otherwise match the seconds pattern on the
    // 30 and hand back half a minute for a set of ninety seconds.
    const min = text.match(/(?:min|minute|minutes)\b|\d\s*m\b/);
    if (min) {
        const whole = Math.round(parseFloat(first[0]) * 60);
        // '1 min 30' and '1m30s' — the remainder after the minutes, when it is
        // stated as seconds rather than as a second minute figure.
        const rest = text.slice((min.index ?? 0) + min[0].length).match(/^\s*(\d+)\s*(?:s|sec|secs|second|seconds)?\b/);
        const extra = rest ? parseInt(rest[1], 10) : 0;
        const total = whole + (Number.isFinite(extra) ? extra : 0);
        return total > 0 ? total : null;
    }
    // Deliberately narrow. Only an explicit unit counts, so a bare '12' is twelve
    // reps and stays twelve reps: guessing that a large bare number must be
    // seconds is how 'AMRAP 100' becomes a minute and forty seconds.
    if (!/\d\s*(?:s|sec|secs|second|seconds)\b/.test(text))
        return null;
    const v = Math.round(parseFloat(first[0]));
    return Number.isFinite(v) && v > 0 ? v : null;
}
/** Whether a prescription is written in time rather than in reps. */
function isTimedPrescription(reps) {
    return prescribedSeconds(reps) != null;
}
/**
 * A typed hold, or the reason it is refused.
 *
 * The same shape and the same discipline as `readLift` in ./units.ts, and for
 * the same reason: a mistyped duration coerced to a number is a measurement
 * nobody made. `parseInt('4 5')` is 4, and a member who fumbled a two-digit
 * hold would have a quarter of their plank in the record with nothing to say
 * so.
 *
 * The ceiling is two hours. It is not a judgement about anybody's core; it is
 * the point past which a figure is far likelier to be a typo — a fat-fingered
 * 4500 for 45 — than a hold, and the sentence says which so the member can
 * disagree by typing it again.
 */
exports.MAX_HOLD_SECONDS = 7200;
function readHold(text) {
    const raw = (text ?? '').trim();
    if (!raw)
        return { ok: false, reason: 'How long did you hold it? Type the seconds.' };
    // 'mm:ss' as well as plain seconds. A three-minute hold is read off a clock
    // as 3:00 by everybody who has ever used one, and refusing that spelling
    // would send them to do the arithmetic themselves.
    const clock = raw.match(/^(\d{1,2}):([0-5]\d)$/);
    const secs = clock
        ? parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10)
        : (/^\d{1,5}$/.test(raw) ? parseInt(raw, 10) : NaN);
    if (!Number.isFinite(secs)) {
        return { ok: false, reason: 'Type the seconds you held it for, as a whole number or as minutes and seconds like 1:30.' };
    }
    if (secs <= 0)
        return { ok: false, reason: 'A hold has to be at least one second.' };
    if (secs > exports.MAX_HOLD_SECONDS) {
        return { ok: false, reason: `That is over two hours. Type the hold in seconds — 45 for forty-five seconds — or as minutes and seconds like 1:30.` };
    }
    return { ok: true, secs };
}
/** Seconds as a clock reads them: 45 s, 1:30, 12:05. Under a minute stays in
 *  seconds, because that is how a hold is prescribed and how it is counted. */
function holdLabel(secs) {
    const s = Math.max(0, Math.round(secs));
    if (s < 60)
        return `${s} s`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/**
 * How a timed set reads on a row: "45 s hold", or with something on top of it.
 *
 * Sentence case and prose, matching `bodyweightSetLabel` — it sits under a
 * movement name explaining the set rather than heading it.
 */
function timedSetLabel(secs, loadLabel, bodyweight) {
    const hold = `${holdLabel(secs)} hold`;
    if (bodyweight)
        return loadLabel ? `${hold} at bodyweight +${loadLabel}` : `${hold} at bodyweight`;
    return loadLabel ? `${hold} with ${loadLabel}` : hold;
}
/**
 * One SAVED set, as it reads on a chip in the log.
 *
 * ── The bug this is the fix for ───────────────────────────────────────────
 *
 * The draft chips in app/(client)/workouts.tsx already knew: a hold is printed
 * as a clock and never as "45×", which is what a reps chip would say about a
 * plank the app itself asked for. The two places that render a SAVED entry did
 * not — they read `set[0]` and `set[1]` straight out of the row, so the moment
 * a plank was saved it came back as "45×— kg". The app prescribes the hold,
 * asks for it in seconds, prints it correctly while it is a draft, and then
 * showed it back as forty-five repetitions of nothing. A coach reading the same
 * rows sees forty-five plank reps.
 *
 * `loadLabel` is passed in rather than imported, because the number has to be
 * rendered in the member's own unit and in the app's own "no figure" glyph, and
 * neither of those belongs in a pure module. It is given null when the row
 * carries no load, so the caller's own em-dash convention is what shows.
 */
function setChipLabel(e, i, loadLabel, unit) {
    const set = e.sets?.[i];
    const first = Number(set?.[0]) || 0;
    const load = Number(set?.[1]) || 0;
    const bw = (0, bodyweightSets_1.isBodyweightSet)(e, i);
    const added = load > 0 ? `${loadLabel(load)} ${unit}` : null;
    if (isTimedSet(e, i)) {
        // The seconds are the measurement. The load, when there is one, is what was
        // held ON TOP of the member — "45 s × 10 kg" — and never a multiplicand.
        //
        // On a hold the person SAID was their own bodyweight, "45 s × 10 kg" is
        // the second half of the same mistake: it presents the ten as the whole of
        // the load when it is a plate on somebody's back. `HoldRecord.bodyweight`
        // has carried that distinction since it was written, and its own comment
        // asks for exactly this phrasing.
        if (bw && added)
            return `${holdLabel(first)} at bodyweight +${added}`;
        return added ? `${holdLabel(first)} × ${added}` : holdLabel(first);
    }
    // A set whose load was the person. `bw[i] === true` is testimony — see
    // ./bodyweightSets.ts — and printing it as `8×— kg` states two false things
    // at once: that a bar was involved, and that nobody recorded what was on it.
    // A pull-up is not an unrecorded bench press. The draft chips in
    // app/(client)/workouts.tsx have always got this right and the SAVED chips
    // beside them did not, which is the same split `setChipLabel` was written to
    // close for holds.
    if (bw)
        return (0, bodyweightSets_1.bodyweightSetLabel)(first, load, added);
    return `${first}×${loadLabel(load > 0 ? load : null)} ${unit}`;
}
/**
 * Every set of an entry on one line, for the compact strip.
 *
 * The unit is stated once at the end and only when something on the line is a
 * load, so an all-holds entry does not read "1:00  45 s kg".
 *
 * A bodyweight set carries its own unit inside its own phrase — the added
 * kilograms are a clause, not the line's subject — so it does not put the unit
 * on the end either. Without that a member's page of pull-ups read "8 reps at
 * bodyweight  8 reps at bodyweight kg".
 */
function setListLabel(e, loadLabel, unit) {
    const rows = e.sets ?? [];
    const parts = [];
    let anyLoaded = false;
    for (let i = 0; i < rows.length; i++) {
        const first = Number(rows[i]?.[0]) || 0;
        const load = Number(rows[i]?.[1]) || 0;
        const bw = (0, bodyweightSets_1.isBodyweightSet)(e, i);
        const added = load > 0 ? `${loadLabel(load)} ${unit}` : null;
        if (isTimedSet(e, i)) {
            if (bw && added)
                parts.push(`${holdLabel(first)} at bodyweight +${added}`);
            else if (added) {
                parts.push(`${holdLabel(first)} × ${loadLabel(load)}`);
                anyLoaded = true;
            }
            else
                parts.push(holdLabel(first));
        }
        else if (bw) {
            // Never `8×— kg`. See setChipLabel above: the dash is the right answer
            // for an ordinary set nobody described, and the wrong one for a set the
            // person told us was their own body.
            parts.push((0, bodyweightSets_1.bodyweightSetLabel)(first, load, added));
        }
        else {
            parts.push(`${first}×${loadLabel(load > 0 ? load : null)}`);
            anyLoaded = true;
        }
    }
    const line = parts.join('  ');
    return anyLoaded && line ? `${line} ${unit}` : line;
}
/** Total seconds held across an entry. Zero when nothing in it was timed —
 *  which is the ordinary case and is not a measurement of anything. */
function entryHoldSeconds(e) {
    if (!e.sets?.length)
        return 0;
    let total = 0;
    for (let i = 0; i < e.sets.length; i++) {
        if (!isTimedSet(e, i))
            continue;
        const s = e.sets[i][0];
        if (typeof s === 'number' && Number.isFinite(s) && s > 0)
            total += s;
    }
    return total;
}
function holdRecords(log) {
    const best = new Map();
    for (const e of log) {
        if (!e.sets?.length)
            continue;
        for (let i = 0; i < e.sets.length; i++) {
            if (!isTimedSet(e, i))
                continue;
            const secs = e.sets[i][0];
            if (!Number.isFinite(secs) || secs <= 0)
                continue;
            const loadKg = Math.max(0, Number.isFinite(e.sets[i][1]) ? e.sets[i][1] : 0);
            const bodyweight = e.bw?.[i] === true;
            const cur = best.get(e.exercise);
            const better = !cur || secs > cur.secs || (secs === cur.secs && loadKg > cur.loadKg);
            if (better)
                best.set(e.exercise, { exercise: e.exercise, secs, loadKg, bodyweight, at: e.t });
        }
    }
    return [...best.values()].sort((a, b) => b.secs - a.secs || b.loadKg - a.loadKg);
}
