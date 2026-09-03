"use strict";
// One movement, every time it has been done, and what it is worth saying about it.
//
// ── The hole this closes ───────────────────────────────────────────────────
//
// Both apps could show a training log and neither could answer the question a
// coach and a lifter actually ask, which is not "what did she do in March" but
// "where is she on bench press". src/lib/clientTraining.ts groups a log into
// days and sessions — the right shape for reading a week back — and there was
// no shape at all for reading ONE exercise forward through a year. The client
// side had `personalRecords` in src/lib/streaks.ts, which is a single best per
// movement with no history behind it, and `prTimeline` in src/lib/longView.ts,
// which is every record across every movement with no way to follow one.
//
// ── Why it is one module and not two screens ───────────────────────────────
//
// The arithmetic behind "every time I have done bench press, and where it has
// gone" is identical whoever is reading it. This codebase has been bitten by
// the alternative more than once: three write paths that each converted pounds
// their own way and one of them didn't, two definitions of unread, a tips
// engine a client could see and a coach could not. So the coach's
// app/(trainer)/client-training.tsx and the member's app/(client)/history.tsx
// are two thin renderings of this file, and a disagreement between them is a
// bug in one file rather than a divergence nobody notices.
//
// ── Kilograms all the way through ──────────────────────────────────────────
//
// Every figure here — loads, volumes, estimated maxes, and every DIFFERENCE
// between two of them — is in kilograms, because that is what the `workouts`
// table stores. Nothing in this file knows what unit anybody reads in, and
// that is deliberate. Conversion happens once, at the render boundary, through
// `liftLabel` / `liftDeltaIn` / `est1RMIn` / `volumeIn` in ./units. Converting
// inside the comparisons would mean the two ends of a movement were rounded
// separately before being subtracted, which is the bug `liftDeltaIn` exists to
// prevent: a genuine 2.5 kg progression reading "+5 lb" one week and "+6 lb"
// the next off nothing the lifter did.
//
// ── And it does not decide which way is good ───────────────────────────────
//
// A movement comes back as a signed number of kilograms or as null. This file
// never returns a word for it, never returns a colour, and never returns a
// flag saying whether it is progress. That judgement is src/lib/deltaLabel.ts's
// — `deltaLabel` gives a movement of nothing no sign at all, and `goalWants`
// refuses to have an opinion about a direction when the goal does not settle
// one. A member on a fat-loss block whose bench has held is not failing, and a
// screen that draws every flat line as a disappointment is worse than one that
// says nothing.
Object.defineProperty(exports, "__esModule", { value: true });
exports.exerciseOutings = exerciseOutings;
exports.exerciseIndex = exerciseIndex;
exports.matchExercises = matchExercises;
exports.exerciseTrend = exerciseTrend;
const entryEdit_1 = require("./entryEdit");
const exerciseId_1 = require("./exerciseId");
const streaks_1 = require("./streaks");
// The two flags that change what a stored pair MEANS. This file was left
// unconverted when `bw` landed, which showed as a pull-up trail with no load on
// any day of it beside a Records board that had priced the same sets — one
// movement, two answers, both drawn from the same rows. `setLoadKg` is the only
// thing in the app that prices a set, and `isTimedSet` is the only thing that
// knows the first number is sometimes seconds.
const bodyweightSets_1 = require("./bodyweightSets");
const timedSets_1 = require("./timedSets");
/** A finite number, or null. `Number.isFinite` rather than a truthiness test,
 *  because a load of 0 is a bodyweight set and must survive as a 0 to be
 *  counted as one rather than being read as an absent measurement. */
const num = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
/** Entries that are this movement, whatever spelling was typed. Resolution is
 *  `exerciseSlug` and nothing else: a second matcher is a second definition of
 *  what counts as the same lift, and the two would disagree the week somebody
 *  logged "Bench-Press". */
function entriesFor(log, slug) {
    return log.filter((e) => e && typeof e.exercise === 'string' && (0, exerciseId_1.exerciseSlug)(e.exercise) === slug);
}
/** Fold a day's worth of entries into one outing. `entries` must already be
 *  this movement and this day, oldest first. */
function foldOuting(slug, day, entries, history) {
    const sets = [];
    const holds = [];
    let reps = 0, bodyweightSets = 0, unpricedSets = 0, holdSeconds = 0;
    let volume = 0, anyVolume = false;
    let topLoad = null, topReps = null;
    let best1RM = null;
    let bestSet = null;
    for (const e of entries) {
        const list = e.sets ?? [];
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            const first = num(s?.[0]);
            if (first == null || first <= 0)
                continue; // a blank row somebody tabbed past
            const own = (0, bodyweightSets_1.isBodyweightSet)(e, i);
            // `setLoadKg` and nothing else. It is what the Records board prices a set
            // with, and a second opinion here is how one movement comes to read two
            // ways on two screens drawn from the same rows.
            const load = (0, bodyweightSets_1.setLoadKg)(e, i, s, history, e.t);
            if (own)
                bodyweightSets++;
            else if (load == null)
                bodyweightSets++; // a loadless row from before the flag
            if ((0, timedSets_1.isTimedSet)(e, i)) {
                // A hold. Counted as a set that happened, kept out of every figure
                // that reads the first number as repetitions, and out of the tonnage
                // for the reason src/lib/timedSets.ts gives: seconds times kilograms
                // is not a mass moved.
                holds.push([first, load]);
                holdSeconds += first;
                continue;
            }
            sets.push([first, load]);
            reps += first;
            if (load == null) {
                unpricedSets++;
                continue;
            }
            volume += first * load;
            anyVolume = true;
            if (topLoad == null || load > topLoad) {
                topLoad = load;
                topReps = first;
            }
            else if (load === topLoad && (topReps == null || first > topReps))
                topReps = first;
            const e1 = (0, streaks_1.est1RM)(load, first);
            if (best1RM == null || e1 > best1RM) {
                best1RM = e1;
                bestSet = { reps: first, loadKg: load };
            }
        }
    }
    if (!sets.length && !holds.length)
        return null; // logged, but nothing was done to it
    // The newest timestamp of the day speaks for it, and the newest spelling with
    // it — a lifter who has since renamed the movement in their own log should
    // see the name they use now.
    const newest = entries[entries.length - 1];
    return {
        slug,
        name: newest.exercise,
        day,
        at: newest.t,
        sets,
        holds,
        setCount: sets.length + holds.length,
        bodyweightSets,
        unpricedSets,
        timedSets: holds.length,
        holdSeconds,
        reps,
        volumeKg: anyVolume ? Math.round(volume) : null,
        topLoadKg: topLoad,
        topReps,
        best1RMKg: best1RM,
        bestSet,
        entryCount: entries.length,
    };
}
/**
 * Every day this movement was done, newest first.
 *
 * An entry whose timestamp will not parse keeps its outing — the sets in it are
 * real — with `day: null`, and those come last rather than being filed under a
 * day nobody trained on.
 *
 * The order is stated here rather than inherited from whatever query fed it.
 * The reads that call this already ask for `performed_at` descending, but a
 * screen headed "newest first" must not depend on an ORDER BY in a file it does
 * not own; `sessionsOf` and `trainingDays` make the same point for the same
 * reason.
 */
function exerciseOutings(log, name, 
/** The member's own weight over time, which is what lets a bodyweight set
 *  carry a load at all. Optional and defaulting to none, because plenty of
 *  members have never been weighed and every caller that has no history must
 *  still get the trail — their bodyweight sets simply land in
 *  `unpricedSets` rather than being given an invented body. */
history = []) {
    const slug = (0, exerciseId_1.exerciseSlug)(name);
    if (!slug)
        return [];
    const mine = entriesFor(log, slug)
        .filter((e) => typeof e.t === 'string' && e.t)
        .sort((a, b) => {
        const d = Date.parse(a.t) - Date.parse(b.t);
        return Number.isFinite(d) && d !== 0 ? d : a.t.localeCompare(b.t);
    });
    const byDay = new Map();
    const undated = [];
    for (const e of mine) {
        const day = (0, entryEdit_1.dayKeyOf)(e.t);
        if (day == null) {
            undated.push([e]);
            continue;
        }
        const bucket = byDay.get(day);
        if (bucket)
            bucket.push(e);
        else
            byDay.set(day, [e]);
    }
    const dated = [];
    for (const [day, group] of byDay) {
        const o = foldOuting(slug, day, group, history);
        if (o)
            dated.push(o);
    }
    dated.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''));
    const loose = [];
    for (const group of undated) {
        const o = foldOuting(slug, null, group, history);
        if (o)
            loose.push(o);
    }
    return [...dated, ...loose];
}
/**
 * Every distinct movement in a log, most recently trained first.
 *
 * Most-recent first rather than alphabetical because the question this list
 * answers is "what has she been doing", and an A–Z puts Ab Wheel above a squat
 * somebody did last night. A search box narrows it when the answer is further
 * down.
 *
 * Everything logged is in here, including movements that never carried a set.
 * The trail behind such a movement is empty and `daysWithSets` says so; leaving
 * it out of the index altogether would make the search box deny that a client
 * who has cycled fifteen times has ever cycled.
 */
function exerciseIndex(log, history = []) {
    const bySlug = new Map();
    for (const e of log) {
        if (!e || typeof e.exercise !== 'string' || typeof e.t !== 'string' || !e.t)
            continue;
        const slug = (0, exerciseId_1.exerciseSlug)(e.exercise);
        if (!slug)
            continue;
        const bucket = bySlug.get(slug);
        if (bucket)
            bucket.push(e);
        else
            bySlug.set(slug, [e]);
    }
    const out = [];
    for (const [slug, entries] of bySlug) {
        const outings = exerciseOutings(entries, entries[0].exercise, history);
        let best1RM = null, topLoad = null;
        for (const o of outings) {
            if (o.best1RMKg != null && (best1RM == null || o.best1RMKg > best1RM))
                best1RM = o.best1RMKg;
            if (o.topLoadKg != null && (topLoad == null || o.topLoadKg > topLoad))
                topLoad = o.topLoadKg;
        }
        // Counted over every entry, not over the outings, so a cardio movement has
        // a real number of days behind it. An entry whose timestamp will not parse
        // counts as a day of its own rather than being dropped or merged, which is
        // how `exerciseOutings` treats it too — the two figures must agree.
        const dayKeys = new Set();
        let undated = 0;
        let lastDay = null, lastAt = null, name = entries[0].exercise;
        for (const e of entries) {
            const day = (0, entryEdit_1.dayKeyOf)(e.t);
            if (day == null)
                undated++;
            else {
                dayKeys.add(day);
                if (lastDay == null || day > lastDay)
                    lastDay = day;
            }
            if (lastAt == null || e.t.localeCompare(lastAt) > 0) {
                lastAt = e.t;
                name = e.exercise;
            }
        }
        out.push({
            slug, name, days: dayKeys.size + undated, daysWithSets: outings.length,
            lastDay, lastAt, best1RMKg: best1RM, topLoadKg: topLoad,
        });
    }
    return out.sort((a, b) => {
        // A movement with no readable date on it anywhere sorts last rather than
        // to the top of a list headed "most recent".
        if (a.lastDay == null && b.lastDay != null)
            return 1;
        if (b.lastDay == null && a.lastDay != null)
            return -1;
        const d = (b.lastDay ?? '').localeCompare(a.lastDay ?? '');
        return d !== 0 ? d : a.name.localeCompare(b.name);
    });
}
/**
 * The movements a typed query is asking for.
 *
 * The query goes through `exerciseSlug` like everything else, so "Bench Press",
 * "bench press" and "bench-press" are one search, and then every word of it has
 * to appear somewhere in the movement's slug. Word-wise rather than as one
 * substring so that "press bench" and "bench press" find the same lift, which
 * is a thing people type; and AND rather than OR so that "bench press" does not
 * return every leg press in the book.
 *
 * This adds no vocabulary of its own. There is exactly one answer in this
 * codebase to "are these the same movement" and it is `exerciseSlug`; a fuzzy
 * matcher here would be a second one, and the two would part company on the
 * first hyphen.
 */
function matchExercises(index, query) {
    const words = (0, exerciseId_1.exerciseSlug)(query).split('-').filter(Boolean);
    if (!words.length)
        return [...index];
    return index.filter((e) => words.every((w) => e.slug.includes(w)));
}
const NO_MOVEMENT = { from: null, topLoadKg: null, est1RMKg: null, volumeKg: null, reps: null };
function movementBetween(from, to) {
    if (!from || !to)
        return NO_MOVEMENT;
    const span = (a, b) => (a == null || b == null ? null : a - b);
    return {
        from,
        topLoadKg: span(to.topLoadKg, from.topLoadKg),
        est1RMKg: span(to.best1RMKg, from.best1RMKg),
        volumeKg: span(to.volumeKg, from.volumeKg),
        reps: to.reps - from.reps,
    };
}
const UNREADABLE_TREND = {
    state: 'unreadable', outings: [], whole: false, outingCount: null,
    latest: null, best: null, sinceLast: NO_MOVEMENT, sinceFirst: NO_MOVEMENT,
};
function exerciseTrend(outings, status) {
    if (outings == null || status === 'error')
        return UNREADABLE_TREND;
    const whole = status === 'ready';
    if (!outings.length) {
        // A read still in flight has not established anything, and 'nothing on
        // record' is a statement about a person that must never be made from a
        // question nobody has finished asking.
        if (status === 'loading')
            return UNREADABLE_TREND;
        return { ...UNREADABLE_TREND, state: 'none', whole, outingCount: whole ? 0 : null };
    }
    const latest = outings[0];
    const previous = outings.length > 1 ? outings[1] : null;
    const earliest = outings.length > 1 ? outings[outings.length - 1] : null;
    let best = null;
    for (const o of outings) {
        if (o.best1RMKg == null)
            continue;
        if (best == null || best.best1RMKg == null || o.best1RMKg > best.best1RMKg)
            best = o;
    }
    return {
        state: 'some',
        outings,
        whole,
        outingCount: whole ? outings.length : null,
        latest,
        best,
        sinceLast: movementBetween(previous, latest),
        sinceFirst: movementBetween(earliest, latest),
    };
}
