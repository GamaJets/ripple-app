"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOAD_TOLERANCE = exports.WINDOW_IS_NOT_A_WEEKDAY = exports.WINDOW_DAYS = void 0;
exports.planVsActual = planVsActual;
exports.coverageLine = coverageLine;
exports.loadCheck = loadCheck;
exports.loadTally = loadTally;
exports.loadLine = loadLine;
const exerciseId_1 = require("./exerciseId");
const setRows_1 = require("./setRows");
const setMethods_1 = require("./setMethods");
const entryEdit_1 = require("./entryEdit");
/**
 * How far back the comparison looks, in days.
 *
 * Twenty-eight, and the number is argued rather than picked. A week is too
 * short: a client who trains Monday and Thursday and is read on a Wednesday has
 * had five days, and a movement they do fortnightly would read as dropped. A
 * quarter is too long: a movement logged eleven weeks ago is not evidence about
 * the block they are on now, and a coach reading "logged" would be reassured
 * about a session that happened before this programme was written.
 *
 * Four weeks is also the longest block most of the coaches on this platform
 * write, so the window is the same order of magnitude as the thing it is
 * measuring. It is exported so a screen can offer another and so the assertions
 * can name it rather than repeating 28.
 */
exports.WINDOW_DAYS = 28;
/**
 * THE SENTENCE. What a window is and what a weekday would have been.
 *
 * Written once so that the day this schema grows a client timezone column there
 * is one string to delete and one grep that finds every screen that promised a
 * window rather than a day. A phrase composed at each call site would leave
 * three of them still hedging a year after the hedge stopped being necessary —
 * and, worse, would let a fourth screen quietly not hedge at all.
 */
exports.WINDOW_IS_NOT_A_WEEKDAY = 'Matched over a window of days, never against a named weekday. A logged set is stored as an instant '
    + "and this app holds no timezone for the client, so nothing here can say a Tuesday session happened on their Tuesday. "
    + 'It can say the movement was logged, and when.';
const UNREADABLE = {
    state: 'unreadable', days: [], movements: [], offPlan: [], fromDay: null, toDay: null,
};
/** `YYYY-MM-DD` shifted back by whole days. UTC midnights on both sides, so no
 *  daylight-saving hour lands in the arithmetic and the result is exact. */
function backDays(dayISO, n) {
    const ms = Date.parse(`${dayISO}T00:00:00Z`);
    if (!Number.isFinite(ms))
        return null;
    const d = new Date(ms - n * 86400000);
    const p = (x) => (x < 10 ? '0' + x : String(x));
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
/**
 * The heaviest WORKING set a plan names for an exercise, in kilograms.
 *
 * Working, by `countsToVolume` — a warm-up single at 60 and a top set at 120 are
 * both in the table, and reporting the warm-up as what the coach prescribed
 * would make every ramped movement look lighter than it is. The same rule
 * src/lib/programReview.ts applies for the same reason.
 *
 * Null when no working set carries a load. Not 0: an exercise with nothing on
 * the bar is bodyweight work, and a planned top of 0 kg beside a logged 40 kg
 * would render as somebody wildly exceeding a prescription that did not exist.
 */
function plannedTop(ex) {
    let top = null;
    for (const s of (0, setRows_1.expandSets)(ex)) {
        if (!(0, setMethods_1.countsToVolume)(s.method))
            continue;
        if (s.loadKg == null || !Number.isFinite(s.loadKg))
            continue;
        if (top == null || s.loadKg > top)
            top = s.loadKg;
    }
    return top;
}
function planVsActual(input) {
    const windowDays = Number.isFinite(input.windowDays) && input.windowDays > 0
        ? Math.floor(input.windowDays)
        : exports.WINDOW_DAYS;
    const toDay = input.todayISO;
    const fromDay = backDays(toDay, windowDays - 1);
    // No programme is one of three different answers and only one of them is
    // 'no-programme'. A null under a read that has not landed is "we did not find
    // out what they are on", which is exactly the confusion
    // src/ui/assignedPrograms.tsx exists to prevent.
    if (input.programStatus === 'loading' || input.programStatus === 'error')
        return UNREADABLE;
    if (!input.days || !input.days.length) {
        return { ...UNREADABLE, state: 'no-programme', fromDay, toDay };
    }
    // Whether the record may be used to say a movement was NOT logged.
    //
    // Three conditions, all of them necessary. The read landed; it was not still
    // in flight; and it reached back at least as far as the window starts. That
    // last one is what lets a truncated read still answer: `capped()` returns the
    // newest rows, so a client with four thousand workouts has their last month
    // read in full and only their 2023 is missing.
    // whole-ok: `landed` is not the whole gate and is not meant to be. It is
    // ANDed with `reachesWindow` below, which is the condition that actually
    // handles 'partial' — and handles it better than `isWhole` would, because it
    // asks the question that matters rather than the blunt one. A capped read
    // returns the newest rows, so a client with four thousand workouts still has
    // their last month in full; `oldestDay <= fromDay` lets that answer, and
    // refuses only when the truncation genuinely ate into the window asked about.
    // `isWhole` here would refuse every such client a plan-versus-actual they
    // have complete data for, which is a dash where an answer exists.
    const landed = input.log != null && input.logStatus !== 'error' && input.logStatus !== 'loading';
    const reachesWindow = input.logStatus === 'ready'
        || (input.oldestDay != null && fromDay != null && input.oldestDay <= fromDay);
    const canSayNo = landed && reachesWindow && fromDay != null;
    const facts = new Map();
    const offPlanNames = new Map();
    for (const e of input.log ?? []) {
        const day = (0, entryEdit_1.dayKeyOf)(e?.t);
        // No readable timestamp means no day, and a movement cannot be placed
        // inside or outside the window without one. Skipped rather than counted:
        // filing it under today would put work inside a window it may predate by a
        // year, which is precisely the invention src/lib/clientTraining.ts refuses
        // when it keeps undated sessions in their own list.
        if (!day || fromDay == null)
            continue;
        if (day < fromDay || day > toDay)
            continue;
        const slug = (0, exerciseId_1.exerciseSlug)(e.exercise ?? '');
        if (!slug)
            continue;
        let f = facts.get(slug);
        if (!f) {
            f = { days: new Set(), lastDay: null, topKg: null };
            facts.set(slug, f);
        }
        f.days.add(day);
        if (f.lastDay == null || day > f.lastDay)
            f.lastDay = day;
        for (const set of e.sets ?? []) {
            const reps = typeof set?.[0] === 'number' ? set[0] : 0;
            const load = typeof set?.[1] === 'number' ? set[1] : 0;
            // A load with no rep count behind it is a row somebody tabbed past, not a
            // set. The same test `sessionsOf` uses, so the two screens cannot
            // disagree about what counts as a set.
            if (!(reps > 0) || !(load > 0))
                continue;
            if (f.topKg == null || load > f.topKg)
                f.topKg = load;
        }
        // Spelled as the client typed it. Kept in a map keyed by slug so 'Bench
        // press' and 'Bench Press' are one movement rather than two rows on the
        // coach's screen accusing the client of doing something twice.
        if (!offPlanNames.has(slug))
            offPlanNames.set(slug, (e.exercise ?? '').trim());
    }
    const check = (name, ex) => {
        const slug = (0, exerciseId_1.exerciseSlug)(name);
        const f = slug ? facts.get(slug) : undefined;
        const coverage = f ? 'logged' : canSayNo ? 'not-logged' : 'unknown';
        return {
            name: (name ?? '').trim() || 'An unnamed movement',
            slug,
            coverage,
            lastDay: f?.lastDay ?? null,
            daysLogged: f ? f.days.size : 0,
            plannedTopKg: plannedTop(ex),
            loggedTopKg: f?.topKg ?? null,
        };
    };
    const days = [];
    // De-duplicated across the week: a squat on Monday and on Friday is ONE
    // movement the client either does or does not do, and counting it twice would
    // make a two-squat week look like better coverage than a one-squat week for
    // the same behaviour.
    const bySlug = new Map();
    const planSlugs = new Set();
    for (const d of input.days) {
        const movements = [];
        let logged = 0, notLogged = 0, unknown = 0;
        for (const ex of d.exercises ?? []) {
            const c = check(ex.name ?? '', ex);
            movements.push(c);
            if (c.slug) {
                planSlugs.add(c.slug);
                // De-duplicated by slug — a squat on Monday and on Friday is ONE
                // movement the client either does or does not do — but the PRESCRIPTION
                // is not one fact. `plannedTopKg` is the heaviest working set the coach
                // wrote for that day, and first-one-wins kept Monday's 100 and threw
                // Friday's 140 away, so `loadCheck` compared a client's week against a
                // load the coach had superseded and reported them as exceeding a
                // prescription that was not theirs. The week's prescription for a
                // movement is the heaviest of the days it appears on, which is the same
                // rule `plannedTop` applies within one exercise and for the same
                // reason. Everything else on the check is derived from the LOG by slug
                // and is identical between the two, so only the load is merged.
                const seen = bySlug.get(c.slug);
                if (!seen)
                    bySlug.set(c.slug, c);
                else if (c.plannedTopKg != null && (seen.plannedTopKg == null || c.plannedTopKg > seen.plannedTopKg)) {
                    bySlug.set(c.slug, { ...seen, plannedTopKg: c.plannedTopKg });
                }
            }
            if (c.coverage === 'logged')
                logged += 1;
            else if (c.coverage === 'not-logged')
                notLogged += 1;
            else
                unknown += 1;
        }
        days.push({
            day: (d.day ?? '').trim() || 'An unnamed day',
            focus: (d.focus ?? '').trim(),
            movements, logged, notLogged, unknown,
        });
    }
    // Off-plan is only meaningful when the log read landed. Under an unreadable
    // log the map is empty for the wrong reason, and an empty list rendered under
    // a heading reading "Logged but not prescribed" is a screen saying the client
    // stuck to the plan when it never read what they did.
    const offPlan = landed
        ? [...offPlanNames.entries()].filter(([slug]) => !planSlugs.has(slug)).map(([, name]) => name).filter(Boolean).sort()
        : [];
    return {
        state: 'ready',
        days,
        movements: [...bySlug.values()],
        offPlan,
        fromDay,
        toDay,
    };
}
const s = (n) => (n === 1 ? '' : 's');
/**
 * The one line above the comparison, in sentence case.
 *
 * Counts MOVEMENTS, never sessions and never a percentage, for the reasons at
 * the top of this file. The 'unknown' arm is separate rather than folded into
 * the "not logged" figure, because the difference between "they have not done
 * these" and "we could not tell" is the whole reason this module exists.
 */
function coverageLine(pva, windowDays, who) {
    if (pva.state === 'unreadable') {
        return `The programme or the training could not be read, so nothing here compares them. An empty list below is not a statement about ${who}.`;
    }
    if (pva.state === 'no-programme') {
        return `${who} is on no coach-assigned programme, so there is nothing to compare their training against.`;
    }
    const all = pva.movements;
    const logged = all.filter((m) => m.coverage === 'logged').length;
    const unknown = all.filter((m) => m.coverage === 'unknown').length;
    if (!all.length)
        return 'This programme names no movements, so there is nothing to compare.';
    if (unknown === all.length) {
        // Two different failures land here — the log read was refused, or it came
        // back at the row cap before reaching the start of the window — and both
        // produce the same list of unknowns. The sentence names the read rather
        // than the client either way, because the one thing a coach must not take
        // from an empty comparison is that their client did none of it.
        return `Their logged training could not be read back over the last ${windowDays} days, so none of these ${all.length} `
            + `movement${all.length === 1 ? '' : 's'} can be answered for. That is about the read, and it is not a statement about ${who}.`;
    }
    const head = `${logged} of ${all.length} prescribed movement${s(all.length)} logged in the last ${windowDays} days.`;
    const tail = unknown ? ` ${unknown} of them cannot be answered for — the read did not cover the whole window.` : '';
    const off = pva.offPlan.length
        ? ` ${pva.offPlan.length} movement${s(pva.offPlan.length)} logged that this programme does not name.`
        : '';
    return head + tail + off;
}
/**
 * What counts as having hit the number.
 *
 * The smallest pair of plates on most racks is 1.25 kg a side, so the finest
 * adjustment a client can actually make to a barbell is 2.5 kg. Against a
 * prescribed 100 that is 2.5%, and a client who racked 97.5 carried out the
 * instruction — calling that a miss would fill a coach's screen with rows
 * about the plate rack rather than about the training. A FRACTION and not a
 * fixed kilogram, because 2.5 kg off a prescribed 20 kg accessory is an eighth
 * of the load and is a different fact entirely.
 */
exports.LOAD_TOLERANCE = 0.025;
/** One movement's load, judged. Pure, and takes the check rather than the whole
 *  board so a screen can call it per row. */
function loadCheck(m) {
    const planned = Number.isFinite(m.plannedTopKg) && m.plannedTopKg > 0
        ? m.plannedTopKg : null;
    const logged = Number.isFinite(m.loggedTopKg) && m.loggedTopKg > 0
        ? m.loggedTopKg : null;
    if (planned == null)
        return { verdict: 'no-plan', plannedKg: null, loggedKg: logged, gapKg: null };
    if (logged == null)
        return { verdict: 'not-logged', plannedKg: planned, loggedKg: null, gapKg: null };
    const gap = logged - planned;
    const tol = planned * exports.LOAD_TOLERANCE;
    const verdict = Math.abs(gap) <= tol ? 'at' : gap < 0 ? 'under' : 'over';
    return { verdict, plannedKg: planned, loggedKg: logged, gapKg: gap };
}
/**
 * The tally over a set of movements — a whole week, or one prescribed day.
 *
 * Counts and nothing else. There is no rate here for the same reason there is
 * no coverage percentage: the moment "78% of prescribed loads hit" exists it is
 * the only thing anybody reads, and it hides that half the movements had no
 * prescribed load at all.
 */
function loadTally(movements) {
    const out = { compared: 0, at: 0, under: 0, over: 0, notLogged: 0, noPlan: 0 };
    for (const m of movements) {
        const c = loadCheck(m);
        switch (c.verdict) {
            case 'no-plan':
                out.noPlan++;
                break;
            case 'not-logged':
                out.notLogged++;
                break;
            case 'at':
                out.at++;
                out.compared++;
                break;
            case 'under':
                out.under++;
                out.compared++;
                break;
            case 'over':
                out.over++;
                out.compared++;
                break;
        }
    }
    return out;
}
/**
 * The sentence above the rows, or null when there is nothing load-shaped to
 * say.
 *
 * Null rather than "0 movements carried a prescribed load", because a block
 * written in reps and RPE alone is an ordinary block and a line apologising for
 * it every time the screen opens is furniture.
 */
function loadLine(tally, who) {
    if (tally.compared === 0 && tally.notLogged === 0)
        return null;
    if (tally.compared === 0) {
        return `${tally.notLogged} prescribed movement${tally.notLogged === 1 ? ' names a load' : 's name a load'} `
            + `and nothing logged in the window carried one, so there is nothing to compare ${who} against.`;
    }
    const parts = [];
    if (tally.at)
        parts.push(`${tally.at} at the prescribed load`);
    if (tally.under)
        parts.push(`${tally.under} under it`);
    if (tally.over)
        parts.push(`${tally.over} over it`);
    let out = `Of ${tally.compared} movement${tally.compared === 1 ? '' : 's'} that could be compared on load: ${parts.join(', ')}.`;
    if (tally.notLogged) {
        out += ` ${tally.notLogged} more name${tally.notLogged === 1 ? 's' : ''} a load that nothing in the window carried.`;
    }
    if (tally.noPlan) {
        out += ` ${tally.noPlan} name${tally.noPlan === 1 ? 's' : ''} no load at all, which is ordinary and is not a gap.`;
    }
    return out;
}
