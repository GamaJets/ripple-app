"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_TYPE_BLURB = exports.DAY_TYPE_LABEL = exports.PLANNED_DAY_TYPES = void 0;
exports.isPlannedDayType = isPlannedDayType;
exports.isoFromParts = isoFromParts;
exports.isoToday = isoToday;
exports.cellKeyFromIso = cellKeyFromIso;
exports.weekdayOfIso = weekdayOfIso;
exports.compareIsoDays = compareIsoDays;
exports.canPlan = canPlan;
exports.planOutcome = planOutcome;
exports.outcomeNote = outcomeNote;
exports.planConflict = planConflict;
exports.byCellKey = byCellKey;
exports.upcomingPlans = upcomingPlans;
// Marking a day AHEAD of time, and never letting that read as a record.
//
// TF-20: the calendar could only be told what had already happened. A client
// who knows they are flying on Thursday and lifting on Friday had nowhere to
// put either, so the plan they were actually following lived in their head and
// their coach could not see it.
//
// ── The vocabulary is inherited, not invented ───────────────────────────────
//
// The app already had three day types, and they already had definitions. They
// are the buttons on `app/(client)/nutrition.tsx` — training / off / rest — and
// the wording of each blurb was written for a tester who asked what the buttons
// meant. That file's own comment says why they are phrased as "the day" and not
// "today":
//
//     the same three definitions have to keep reading correctly when day types
//     can be planned a week ahead, which is the direction this is going
//
// This is that week ahead, so the blurbs below are those blurbs, word for word.
// A second vocabulary would have been the real bug: "Rest day" on the calendar
// meaning something other than "Rest day" on Nutrition is how a client ends up
// eating to a target for a day they planned as something else.
//
// One type is added, and only one: 'deload'. It is not new either — the app has
// held the concept since `deloadCheck` in src/lib/training.ts, which tells a
// client when a deload week is due, and `src/lib/progression.ts` returns
// 'deload' as one of four actions on a lift. There is a whole screen about it
// (`app/(client)/restday.tsx`). Planning one was the only part missing.
//
// ── What was deliberately NOT added ────────────────────────────────────────
//
// The report also asked about refeed / high-carb days and travel days. Neither
// is in the app anywhere: the macro engine has no refeed adjustment to apply
// (`src/lib/nutrition.ts` cycles on training/rest only) and nothing in the
// product knows what a travel day changes. A day type that no other screen can
// act on is a sticker — it looks like it did something. So they are not types;
// they are what the optional note on a planned day is for, and the picker says
// so. When the macro engine grows a refeed, 'refeed' becomes a type here and
// the note stops being the place for it.
//
// ── The rule this file exists to hold ──────────────────────────────────────
//
// A plan is an intention. It is never evidence. `planOutcome` below is written
// so there is no path — none — from "this day was planned" to "this day was
// done": a planned day that has passed with nothing logged comes back as
// 'nothing-logged' for every type, including a rest day, where an empty log is
// exactly what you would expect. Expecting it is not the same as knowing it.
//
// Pure and dependency-free apart from localDate, so the date arithmetic that
// decides whether a day is still ahead can be tested under the three zones the
// repo runs its tests in. Date-only values go through `dateParts`; see the
// header of src/lib/localDate.ts for the two shipped bugs that rule comes from.
const localDate_1 = require("./localDate");
/** Picker order: the two ends of the week's effort, then the baseline between
 *  them, then the one that is a whole week's decision rather than a day's. */
exports.PLANNED_DAY_TYPES = ['training', 'off', 'rest', 'deload'];
exports.DAY_TYPE_LABEL = {
    training: 'Training day',
    off: 'Standard',
    rest: 'Rest day',
    deload: 'Deload day',
};
/** The first three are `DAY_TYPES` in app/(client)/nutrition.tsx, unchanged.
 *  The fourth is the guidance already on the Rest & deload screen. */
exports.DAY_TYPE_BLURB = {
    training: 'A day you train — a gym session or a hard effort. Fuel goes up so there is something to train on.',
    off: 'A normal day with no session: work, walking, ordinary movement. This is the baseline target.',
    rest: 'A full day off training. Fuel comes down, because there is no session to feed.',
    deload: 'A day inside a deload: you still train, at about 60% of the volume and well shy of failure, so fatigue clears.',
};
/** Whether a value off the wire is a day type this build understands. A row
 *  written by a newer build is dropped rather than coerced to a default, which
 *  would silently retype somebody's day. */
function isPlannedDayType(v) {
    return typeof v === 'string' && exports.PLANNED_DAY_TYPES.includes(v);
}
const pad = (n) => (n < 10 ? '0' + n : String(n));
/** `YYYY-MM-DD` from the parts a month grid already holds (month is 0-11). */
function isoFromParts(year, monthIndex, day) {
    return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}
/**
 * Today, as a bare date, in the reader's own zone.
 *
 * Deliberately built from the local getters rather than `toISOString().slice(0, 10)`,
 * which is UTC: in Auckland that spelling is tomorrow's date for most of the
 * working day, and every "is this day still ahead" question below would answer
 * off by one for half the planet.
 */
function isoToday(now) {
    return isoFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}
/** The key the month grid uses for a cell (`${year}-${monthIndex}-${day}`), or
 *  null when the value is not a readable date. */
function cellKeyFromIso(iso) {
    const p = (0, localDate_1.dateParts)(iso);
    return p ? `${p[0]}-${p[1]}-${p[2]}` : null;
}
/** 0 Sun … 6 Sat, for feeding `scheduledFocus`. Null when unreadable. */
function weekdayOfIso(iso) {
    const p = (0, localDate_1.dateParts)(iso);
    // Local midnight, so the weekday is the one the client would name. Parsing
    // the string as UTC hands back the previous day west of Greenwich, which
    // would ask the program for Monday's session on a Tuesday.
    return p ? new Date(p[0], p[1], p[2]).getDay() : null;
}
/** −1, 0 or 1 comparing two calendar days; null when either is unreadable. */
function compareIsoDays(a, b) {
    const pa = (0, localDate_1.dateParts)(a), pb = (0, localDate_1.dateParts)(b);
    if (!pa || !pb)
        return null;
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i])
            return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
}
/**
 * Whether this day can still be PLANNED.
 *
 * Today and forward, and that boundary is the honest part rather than a
 * limitation. Marking last Tuesday as a rest day is not a plan, it is a claim
 * about what happened, and this table is not the place a claim about the past
 * gets to live — the workout log is. Days already gone still show what was
 * planned for them; they just cannot be given a plan retrospectively.
 *
 * The offline queue answers to this rule rather than working around it. A mark
 * made with no signal is kept (`'day-plan'` in src/lib/outbox.ts) and carries an
 * expiry of the day it is about, so an intent that surfaces on Wednesday for
 * Tuesday is taken OUT and said out loud instead of being written — because a
 * queue that replayed it would be this function's refusal arriving through the
 * back door. See `planExpiry` in src/lib/recordQueue.ts.
 */
function canPlan(dateISO, todayISO) {
    const c = compareIsoDays(dateISO, todayISO);
    return c != null && c >= 0;
}
function planOutcome(type, dateISO, todayISO, logged) {
    const c = compareIsoDays(dateISO, todayISO);
    if (c == null)
        return null;
    if (c > 0)
        return 'not-yet';
    if (c === 0)
        return 'today';
    if (logged == null)
        return 'log-unknown';
    if (!logged)
        return 'nothing-logged';
    // Training was logged. A deload day is a training day with the volume cut —
    // the Rest & deload screen's own instruction is "keep training, but cut
    // volume to ~60%" — so a session on one is the plan being followed, not
    // broken. The other three all said, in their own words, that there would be
    // no session.
    return type === 'training' || type === 'deload' ? 'log-agrees' : 'log-disagrees';
}
/** The sentence to put under a planned day. Never claims the plan was kept. */
function outcomeNote(type, outcome) {
    const label = exports.DAY_TYPE_LABEL[type].toLowerCase();
    switch (outcome) {
        case 'not-yet':
            return `Planned as a ${label}. This day hasn’t happened yet — nothing here is a record.`;
        case 'today':
            return `Planned as a ${label} for today. Anything you log today is listed separately below.`;
        case 'log-agrees':
            return `Planned as a ${label}, and there is training logged on it. The log below is what actually happened.`;
        case 'log-disagrees':
            return `Planned as a ${label}, but there is training logged on it. Both are shown — neither has been changed to match the other.`;
        case 'nothing-logged':
            return `Planned as a ${label}. Nothing was logged on this day, so it stays a plan: an unlogged session and a day that went differently look the same from here.`;
        case 'log-unknown':
            return `Planned as a ${label}. Your training log couldn’t be read, so we can’t say what was logged against it.`;
    }
}
function planConflict(marked, scheduled) {
    if (!marked || scheduled === undefined)
        return null;
    const focus = scheduled ? scheduled.trim() : '';
    if (focus) {
        // A deload day is not a conflict with a scheduled session — it is an
        // instruction about how to do that session. See planOutcome.
        if (marked === 'training' || marked === 'deload')
            return null;
        return {
            kind: 'plan-schedules-a-session',
            focus,
            note: `Your program schedules ${focus} on this day and you’ve marked it as a ${exports.DAY_TYPE_LABEL[marked].toLowerCase()}. Neither has been changed — this is here so you can decide, or tell your coach.`,
        };
    }
    if (marked === 'training') {
        return {
            kind: 'plan-schedules-nothing',
            focus: null,
            note: 'Your program has no session on this day. Marking it a training day doesn’t add one to the program — it records what you intend to do.',
        };
    }
    return null;
}
/** Planned days keyed by the month grid's cell key, for one lookup per cell.
 *  A row whose date will not parse is dropped rather than filed under ''. */
function byCellKey(days) {
    const m = new Map();
    for (const d of days) {
        const k = cellKeyFromIso(d.dateISO);
        if (k)
            m.set(k, d);
    }
    return m;
}
/**
 * The plans still to come, soonest first — what "seeing what is already marked"
 * means on a screen that can only show one day's detail at a time.
 *
 * Today counts as upcoming: a day you are standing in is still ahead of you.
 */
function upcomingPlans(days, todayISO) {
    return days
        .filter((d) => canPlan(d.dateISO, todayISO))
        .sort((a, b) => compareIsoDays(a.dateISO, b.dateISO) ?? 0);
}
