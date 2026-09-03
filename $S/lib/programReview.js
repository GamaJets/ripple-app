"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_GOAL_SETS = exports.HIGH_REPS = exports.RECENT_OUTINGS = exports.VOLUME_JUMP = exports.SHORT_REST_SEC = exports.HEAVY_REPS = exports.NOT_CHECKED = exports.CHECKS = void 0;
exports.reviewProgram = reviewProgram;
exports.checksLine = checksLine;
exports.coverageLine = coverageLine;
const programBlock_1 = require("./programBlock");
const injuries_1 = require("./injuries");
const setGroups_1 = require("./setGroups");
const setMethods_1 = require("./setMethods");
const setRows_1 = require("./setRows");
const restTimer_1 = require("./restTimer");
const exerciseHistory_1 = require("./exerciseHistory");
const deltaLabel_1 = require("./deltaLabel");
/**
 * The rules, in the order their findings are listed.
 *
 * Injury first because it is the only one about somebody getting hurt, and
 * `set-count` second because it is a plain disagreement between two stored
 * numbers rather than anything about training. The rest are ordered by how
 * little interpretation they need, which puts `goal-reps` — the only one that
 * counts against a convention — last.
 */
exports.CHECKS = [
    { id: 'injury', label: 'movements that load a disclosed injury', needs: 'injuries' },
    { id: 'set-count', label: 'set counts that disagree with the sets written out', needs: 'programme' },
    { id: 'group-muscle', label: 'supersets whose movements share a muscle group', needs: 'programme' },
    { id: 'heavy-rest', label: 'rest on low-rep movements', needs: 'programme' },
    { id: 'warmup-volume', label: 'warm-ups and cool-downs counted as working volume', needs: 'programme' },
    { id: 'volume-jump', label: 'planned volume against what this client has been doing', needs: 'history' },
    { id: 'goal-reps', label: 'rep targets against the goal on record', needs: 'goal' },
];
const ORDER = new Map(exports.CHECKS.map((c, i) => [c.id, i]));
/**
 * Checks a coach would reasonably expect to find here and will not, each with
 * the reason it is absent. Shown on screen, because a list of findings implies
 * a list of questions asked, and the ones not asked are part of that.
 *
 * They are not `skipped` entries: nothing failed to load and no future read
 * would enable them. They are decisions.
 */
exports.NOT_CHECKED = [
    'weekly sets per muscle group, which has no settled figure to check against',
    'the order movements are done in within a day',
    'how many days a week this client trains',
    'whether the exercises chosen suit the goal',
];
/* ── the thresholds, each with the reason it is that number ───────────────── */
/**
 * The top of a rep range at or below which `heavy-rest` calls a movement
 * low-rep. Six because it is the conventional top of a strength range and,
 * more to the point, because the rule only reports the rest — it does not say
 * the reps are wrong.
 */
exports.HEAVY_REPS = 6;
/**
 * A rest short enough to be worth naming beside a low-rep movement, in
 * seconds. Under a minute between sets of five is a decision, not an oversight
 * — the finding says what was written and lets the coach agree with it.
 */
exports.SHORT_REST_SEC = 60;
/**
 * How far above a client's own recent best a planned volume has to sit before
 * `volume-jump` reports it. Half again, which is a big enough step that the
 * arithmetic is not the interesting part — a coach ramping 10% a week never
 * sees this, and one who copied a template written for somebody else does.
 */
exports.VOLUME_JUMP = 1.5;
/** How many of the client's most recent sessions on a movement are compared
 *  against. Six, so a single heavy day is not treated as their normal and a
 *  block from six months ago is not either. */
exports.RECENT_OUTINGS = 6;
/**
 * The rep count at or above which `goal-reps` counts a working set as high-rep
 * against a muscle-building goal. Fifteen, and the WHOLE range has to be at or
 * above it — "12-15" is not counted, "15-20" is — so a coach who programmed a
 * range that merely reaches fifteen is never told anything.
 */
exports.HIGH_REPS = 15;
/** The fewest high-rep sets `goal-reps` will report, whatever the share. Three,
 *  because two sets is a finisher and not a pattern. */
exports.MIN_GOAL_SETS = 3;
/* ── helpers ──────────────────────────────────────────────────────────────── */
/** A movement's name as it will be printed. A blank name is a real state — the
 *  builder lets a coach add a custom exercise and clear the field — and a
 *  sentence beginning with nothing reads as a broken screen, which is what
 *  scripts/check-prose.mjs exists to stop. */
const nameOf = (name) => (name ?? '').trim() || 'an unnamed movement';
/** A day as it will be printed, for the same reason. */
const dayOf = (day) => (day ?? '').trim() || 'an unnamed day';
/**
 * Where in the block a finding is, as it reads inside a sentence.
 *
 * The day alone on a one-week programme, so nothing about those screens
 * changes. The day AND the week on a block, because "back squat on Mon loads
 * the knee" is unactionable across twelve Mondays — the coach has to be told
 * which one to open. The number rather than the coach's own week label: a label
 * is free text, may be blank, and two weeks may carry the same one.
 */
const whereOf = (day, week) => week == null ? dayOf(day) : `${dayOf(day)} in week ${week}`;
/** The sets of an exercise whose method counts as training volume. Warm-ups
 *  and cool-downs are not work being reviewed, and every rule below that talks
 *  about "working sets" means these. */
function workingSets(ex) {
    return (0, setRows_1.expandSets)(ex).filter((s) => (0, setMethods_1.countsToVolume)(s.method));
}
/**
 * The top of an exercise's rep range across its working sets, or null.
 *
 * Null when ANY working set carries reps that are not a count — "45 sec" is an
 * isometric hold and "AMRAP" is a set whose reps are decided in the gym — so a
 * rule that needs a rep target declines to run rather than reading one of them
 * as a number. See `readRepSpan` in src/lib/setRows.ts.
 */
function topRep(ex) {
    const highs = [];
    for (const s of workingSets(ex)) {
        const span = (0, setRows_1.readRepSpan)(s.reps);
        if (!span)
            return null;
        highs.push(span.high);
    }
    // The empty case is answered here rather than by a starting value. This was
    // `let top = 0` with a running `>` comparison, and a mutation run moved the
    // seed to 1 and flipped the comparison to `>=` without a single assertion
    // noticing either — a max needs no seed and no branch, so there is nothing
    // left to be silently wrong about.
    if (!highs.length)
        return null;
    return Math.max(...highs);
}
/** Whether a rest was actually set on this exercise, by the same test
 *  `restSecondsFor` uses to decide it has to fall back. A zero is not a rest:
 *  `startRest(0)` is how the runner CLEARS the timer. */
function restWasSet(restSec) {
    return typeof restSec === 'number' && Number.isFinite(restSec) && restSec > 0;
}
const WARMUP_NAME = /\bwarm[\s-]?ups?\b/i;
const COOLDOWN_NAME = /\bcool[\s-]?downs?\b/i;
/**
 * A detail line as a sentence, with its first character upper-cased.
 *
 * Every detail below opens with a movement name, and a coach may have typed
 * one in lower case or left it blank — and then the finding reads "bench press
 * on Mon loads the shoulder" or, worse, opens on `nameOf`'s fallback phrase.
 * A sentence that starts small looks like the screen has lost its first word,
 * which is the exact fault scripts/check-prose.mjs was written for.
 *
 * It changes only the first letter of the SENTENCE. `Finding.exercises` still
 * carries the movement spelled exactly as the coach wrote it, and that is what
 * a screen renders where the name stands on its own.
 */
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function reviewProgram(input) {
    /**
     * EVERY WEEK, not week one.
     *
     * This was `input.program?.days ?? []`, which is week one by definition —
     * see `ProgramWeek` in src/lib/programs.ts for why that field cannot be
     * moved. So a coach writing a twelve-week block was told "7 checks run over
     * this draft" while eleven twelfths of the draft had never been looked at:
     * an injury conflict in week four, a volume jump in week nine and a set count
     * that disagrees with its rows in week two all went unreported, and silence
     * from a check reads as a pass. `programWeeks` is the one resolver of the
     * block and it returns a single week built from `days` for a one-week
     * programme, so nothing changes for one.
     */
    const weeks = (0, programBlock_1.programWeeks)(input.program);
    const multi = weeks.length > 1;
    /** Every day of the block in order, each carrying its week number. Built once
     *  because all seven rules walk it. */
    const days = weeks.flatMap((w, i) => (w.days ?? []).map((d) => ({ d, week: multi ? i + 1 : null })));
    const findings = [];
    const skipped = [];
    let exercises = 0;
    let sets = 0;
    for (const { d } of days) {
        for (const ex of d.exercises) {
            exercises += 1;
            sets += (0, setRows_1.setCount)(ex);
        }
    }
    /* ── injury ───────────────────────────────────────────────────────────── */
    // Asked BEFORE anything is reported, and the order matters for the same
    // reason it does in guardInjuries: an empty disclosure list means "they have
    // disclosed nothing" only when the read that produced it finished.
    if (input.injuries == null) {
        skipped.push({
            id: 'injury', kind: 'absent',
            why: 'There is no client attached to this draft, so no movement here has been checked against a disclosed injury.',
        });
    }
    else if (input.injuryStatus !== 'ready') {
        skipped.push({
            id: 'injury', kind: 'unread',
            why: input.injuryStatus === 'loading'
                ? 'This client\'s injuries are still being read, so nothing here has been checked against them.'
                : 'This client\'s injuries could not be read, so no movement here has been checked against them. A programme written around an injury nobody has seen is what this check exists to catch.',
        });
    }
    else {
        const injuries = input.injuries;
        for (const { d, week } of days) {
            for (const ex of d.exercises) {
                const flag = (0, injuries_1.injuryFlag)(ex.name, ex.group, injuries);
                if (!flag)
                    continue;
                findings.push({
                    id: 'injury', day: d.day, week, exercises: [nameOf(ex.name)], volume: null,
                    detail: sentence(`${nameOf(ex.name)} on ${whereOf(d.day, week)} loads the ${(0, injuries_1.areaLabel)(flag.injury.area).toLowerCase()}, `
                        + `which this client has disclosed as ${flag.injury.severity} and still active.`),
                });
            }
        }
    }
    /* ── set-count ────────────────────────────────────────────────────────── */
    // `sets` and the length of `setRows` are ONE fact — src/lib/setRows.ts says
    // so at length — and every progress reader in the client's app counts against
    // `sets` alone. A four-row exercise carrying `sets: 3` shows somebody
    // "3 of 3 sets" with a fourth row underneath that nothing will ever log.
    for (const { d, week } of days) {
        for (const ex of d.exercises) {
            if (!(0, setRows_1.hasSetRows)(ex))
                continue;
            const rows = (ex.setRows ?? []).length;
            const stored = Number.isFinite(ex.sets) ? Math.floor(ex.sets) : null;
            if (stored === rows)
                continue;
            findings.push({
                id: 'set-count', day: d.day, week, exercises: [nameOf(ex.name)], volume: null,
                detail: sentence(stored == null
                    ? `${nameOf(ex.name)} on ${whereOf(d.day, week)} has ${rows} sets written out but no usable stored set count, `
                        + 'and the client\'s app counts their progress against the stored figure.'
                    : `${nameOf(ex.name)} on ${whereOf(d.day, week)} has ${rows} sets written out but is stored as ${stored}, `
                        + 'and the client\'s app counts their progress against the stored figure.'),
            });
        }
    }
    /* ── group-muscle ─────────────────────────────────────────────────────── */
    // A superset is two movements done back to back with no rest between them.
    // Two that load the same primary group are the second one being done tired
    // by the first, which a coach may well want — so this reports the pair and
    // the group they share, and says nothing about whether it is wrong.
    for (const { d, week } of days) {
        const list = d.exercises;
        for (const run of (0, setGroups_1.groupRuns)(list)) {
            const label = (0, setGroups_1.groupLabel)(run.size).toLowerCase();
            for (let k = 0; k < run.size - 1; k += 1) {
                const a = list[run.start + k];
                const b = list[run.start + k + 1];
                const ga = (a.group ?? '').trim();
                const gb = (b.group ?? '').trim();
                // `!gb` is not asked: if `ga` is not blank and the two compare equal,
                // `gb` is not blank either. It was there, and a mutation run rewrote it
                // to `&&` without changing a single result, which is what a term that
                // another term already implies looks like.
                if (!ga || ga.toLowerCase() !== gb.toLowerCase())
                    continue;
                findings.push({
                    id: 'group-muscle', day: d.day, week,
                    exercises: [nameOf(a.name), nameOf(b.name)], volume: null,
                    detail: sentence(`${nameOf(a.name)} and ${nameOf(b.name)} are next to each other in the same ${label} on `
                        + `${whereOf(d.day, week)}, and both are listed under ${ga}. There is no rest between them.`),
                });
            }
        }
    }
    /* ── heavy-rest ───────────────────────────────────────────────────────── */
    // Only ever reports what is written. The absent case is the one worth having:
    // a coach who left rest blank on a set of triples has not chosen 90 seconds,
    // they have not been told that is what their client's timer will run.
    for (const { d, week } of days) {
        for (const ex of d.exercises) {
            const top = topRep(ex);
            if (top == null || top > exports.HEAVY_REPS)
                continue;
            if (restWasSet(ex.restSec)) {
                const secs = Math.round(ex.restSec);
                if (secs >= exports.SHORT_REST_SEC)
                    continue;
                findings.push({
                    id: 'heavy-rest', day: d.day, week, exercises: [nameOf(ex.name)], volume: null,
                    detail: sentence(`${nameOf(ex.name)} on ${whereOf(d.day, week)} is written at ${top} reps or fewer with ${secs} `
                        + `second${secs === 1 ? '' : 's'} of rest between sets.`),
                });
            }
            else {
                findings.push({
                    id: 'heavy-rest', day: d.day, week, exercises: [nameOf(ex.name)], volume: null,
                    detail: sentence(`${nameOf(ex.name)} on ${whereOf(d.day, week)} is written at ${top} reps or fewer and has no rest set, so `
                        + `the client's timer will run the ${restTimer_1.DEFAULT_REST_SEC} second fallback between sets.`),
                });
            }
        }
    }
    /* ── warmup-volume ────────────────────────────────────────────────────── */
    // The METHOD decides what counts as volume, never the name — that is the
    // whole point of `countsToVolume` in src/lib/setMethods.ts. So a movement a
    // coach NAMED as a warm-up while leaving its sets ordinary is a disagreement
    // between the two, and the one the app will act on is the method.
    for (const { d, week } of days) {
        for (const ex of d.exercises) {
            const isWarm = WARMUP_NAME.test(ex.name ?? '');
            const isCool = COOLDOWN_NAME.test(ex.name ?? '');
            if (!isWarm && !isCool)
                continue;
            const counted = workingSets(ex).length;
            if (!counted)
                continue;
            const total = (0, setRows_1.setCount)(ex);
            findings.push({
                id: 'warmup-volume', day: d.day, week, exercises: [nameOf(ex.name)], volume: null,
                detail: sentence(`${nameOf(ex.name)} on ${whereOf(d.day, week)} is named as a ${isWarm ? 'warm-up' : 'cool-down'} but `
                    + `${counted} of its ${total} sets are ordinary working sets, so they will count towards this client's `
                    + 'training volume.'),
            });
        }
    }
    /* ── volume-jump ──────────────────────────────────────────────────────── */
    if (input.log == null) {
        skipped.push({
            id: 'volume-jump', kind: 'absent',
            why: 'There is no client attached to this draft, so nothing here has been compared with a training history.',
        });
    }
    else if (input.logStatus !== 'ready') {
        skipped.push({
            id: 'volume-jump', kind: 'unread',
            why: input.logStatus === 'loading'
                ? 'This client\'s training log is still being read, so nothing here has been compared with what they have actually been doing.'
                : 'This client\'s training log could not be read, so nothing here has been compared with what they have actually been doing.',
        });
    }
    else {
        const log = input.log;
        for (const { d, week } of days) {
            for (const ex of d.exercises) {
                const tally = (0, setRows_1.plannedVolume)(ex);
                // A SHORT-CIRCUIT, and it is labelled as one rather than as a
                // correctness test, because it is not: `exerciseOutings` folds this
                // client's whole capped log on every call, and this is what stops it
                // being walked for a bodyweight movement with no volume to compare.
                // The condition that actually decides the finding is the comparison
                // below, which an exercise of no volume fails anyway. It used to read
                // `|| tally.lowKg <= 0` as well; a mutation run moved that zero to a
                // one and flipped its operator with nothing able to tell, because the
                // comparison below already covers every case it did.
                if (!tally.counted)
                    continue;
                const outings = (0, exerciseHistory_1.exerciseOutings)(log, ex.name ?? '')
                    .filter((o) => o.volumeKg != null)
                    .slice(0, exports.RECENT_OUTINGS);
                if (!outings.length)
                    continue;
                let best = outings[0];
                for (const o of outings)
                    if (o.volumeKg > best.volumeKg)
                        best = o;
                const bestKg = best.volumeKg;
                // No `bestKg <= 0` guard: `volumeKg` in src/lib/exerciseHistory.ts is
                // `anyVolume ? Math.round(volume) : null`, and `anyVolume` is set only
                // by a set whose load is above zero — so a non-null one is a positive
                // integer. A mutation run moved that guard's zero to a one and flipped
                // its operator with nothing able to tell, which is what a condition
                // that cannot be false looks like.
                if (tally.lowKg <= bestKg * exports.VOLUME_JUMP)
                    continue;
                findings.push({
                    id: 'volume-jump', day: d.day, week, exercises: [nameOf(ex.name)],
                    detail: sentence(`${nameOf(ex.name)} on ${whereOf(d.day, week)} is written at more working volume than this client has `
                        + `logged for it in any of their last ${outings.length} sessions on record.`),
                    volume: {
                        // Neither figure is rounded again here. `plannedVolume` rounds its
                        // own totals to two places, and `volumeKg` is a whole number by
                        // construction — a second round2 over both was a line no assertion
                        // could ever watch change.
                        plannedKg: tally.lowKg,
                        bestKg,
                        changePct: (0, deltaLabel_1.pctChange)(tally.lowKg, bestKg),
                        bestDay: best.day,
                        compared: outings.length,
                    },
                });
            }
        }
    }
    /* ── goal-reps ────────────────────────────────────────────────────────── */
    // Runs for ONE goal, and reports a COUNT rather than a verdict.
    //
    // Fat loss and toning are not checked at all, and that is the honest answer
    // rather than a gap: there is no rep convention for either that this file
    // could state without inventing one, and a rule engine asserting an invented
    // convention as a finding is the thing the header of this file is about.
    // Muscle is checked only on the high side — a set of three inside a
    // hypertrophy block is ordinary strength work and nothing is said about it.
    if (input.goal == null) {
        skipped.push({
            id: 'goal-reps', kind: 'absent',
            why: 'No goal is on record for this client, so the rep targets have nothing to be counted against.',
        });
    }
    else if (input.goal !== 'muscle') {
        skipped.push({
            id: 'goal-reps', kind: 'absent',
            why: `The goal on record is ${input.goal === 'fatloss' ? 'fat loss' : 'toning'}, and there is no rep `
                + 'convention for it these checks could state without making one up.',
        });
    }
    else {
        let high = 0;
        let readable = 0;
        for (const { d } of days) {
            for (const ex of d.exercises) {
                for (const s of workingSets(ex)) {
                    const span = (0, setRows_1.readRepSpan)(s.reps);
                    if (!span)
                        continue;
                    readable += 1;
                    if (span.low >= exports.HIGH_REPS)
                        high += 1;
                }
            }
        }
        if (high >= exports.MIN_GOAL_SETS && high * 2 > readable) {
            findings.push({
                // No day and no week: this one counts across the whole block and the
                // sentence says so. A week number on it would point a coach at a week
                // that is not where the answer is.
                id: 'goal-reps', day: null, week: null, exercises: [], volume: null,
                detail: `The goal on record is to build muscle, and ${high} of the ${readable} working sets with a readable `
                    + `rep target are written at ${exports.HIGH_REPS} reps or more.`,
            });
        }
    }
    // `!` rather than `?? 0`: every `CheckId` is a key of `CHECKS` by
    // construction, so the fallback was an arm nothing could reach and a
    // mutation could rewrite unchallenged.
    findings.sort((a, b) => ORDER.get(a.id) - ORDER.get(b.id));
    return {
        // Only an UNREAD skip degrades this. A goal that was never set is not a
        // failed read and the builder already says so in its own words; reporting
        // it twice would train a coach to ignore the word "partial" on a screen
        // where it also means an injury list that did not load.
        status: skipped.some((s) => s.kind === 'unread') ? 'partial' : 'ready',
        findings,
        skipped,
        counted: { weeks: weeks.length, days: days.length, exercises, sets },
    };
}
/**
 * The one line the screen puts above the list, saying what this is.
 *
 * Built here rather than typed into the screen so the count cannot drift from
 * `CHECKS`, and so the sentence that refuses the word "AI" lives next to the
 * rules it is refusing it on behalf of.
 */
function checksLine() {
    return `${exports.CHECKS.length} checks run over this draft. They are rules, not a model, and each finding names the `
        + 'exercise, day or figure it came from.';
}
/**
 * What was actually read, said out loud, or null on a one-week programme.
 *
 * Only for a block, and it is not decoration. "7 checks run over this draft"
 * was true of week one and read as true of twelve weeks — so a coach who had
 * written a block had no way to tell whether the eleven weeks they could not
 * see on screen had been looked at. Now they can, and the figures are
 * `counted`'s rather than a sentence written beside them.
 */
function coverageLine(counted) {
    if (counted.weeks <= 1)
        return null;
    const s = (n) => (n === 1 ? '' : 's');
    return `Every week of this block was read: ${counted.weeks} week${s(counted.weeks)}, `
        + `${counted.days} training day${s(counted.days)} and ${counted.exercises} movement${s(counted.exercises)}.`;
}
