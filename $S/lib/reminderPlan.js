"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_SAVED = exports.FIXED_LABEL = exports.DAY_LABEL = exports.WEEKDAYS_ONLY = exports.EVERY_DAY = void 0;
exports.savedFromStored = savedFromStored;
exports.plannedReminders = plannedReminders;
exports.plannedNotificationCount = plannedNotificationCount;
exports.daysLabel = daysLabel;
// What a member's reminder settings actually schedule.
//
// ── The two defects this closes ────────────────────────────────────────────
//
// 1. HYDRATION AND SUPPLEMENTS, DAILY, AND NOTHING ELSE. No training reminder,
//    no weigh-in, no progress photo, and no way to say "weekdays only" about
//    any of them — so a member training Monday, Wednesday and Friday either got
//    nudged on the four days they were not training or got nothing.
//
// 2. THEY WERE SCHEDULED ONLY AT THE MOMENT SAVE WAS PRESSED. The reminders
//    screen said so about itself: "nothing anywhere re-schedules them from the
//    saved payload later". So a member who set reminders on a build that could
//    not schedule anything got nothing after the build that could, for as long
//    as they never went back to the screen — while the alert they had been
//    shown promised the opposite. A reinstall lost them the same way.
//
// The fix for the second is that this module turns the SAVED PAYLOAD into the
// list of things to schedule, so the screen and the launch-time resync
// (src/ui/reminderSync.tsx) compute the same list from the same stored answer.
// Two copies of that derivation is how the screen and the resync end up
// scheduling different reminders — the shape this codebase keeps re-finding.
//
// Pure: no notifications module, no storage, no React.
const weekStart_1 = require("./weekStart");
exports.EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
/** Monday to Friday, in the same 1 = Sunday convention. */
exports.WEEKDAYS_ONLY = [2, 3, 4, 5, 6];
/** Short labels for the day picker, index 0 unused so `DAY_LABEL[w]` works. */
exports.DAY_LABEL = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
exports.FIXED_LABEL = {
    training: {
        title: 'Time to train',
        body: 'Your session is waiting. Even a short one keeps the week honest.',
        route: '/(client)/workouts',
    },
    weighin: {
        title: 'Weigh-in',
        body: 'Step on the scale and log it — one reading a week is enough to see a trend.',
        route: '/(client)/scans',
    },
    photo: {
        title: 'Progress photo',
        body: 'Same spot, same light, same time of day. That is what makes them comparable.',
        route: '/(client)/scans',
    },
};
exports.EMPTY_SAVED = {
    hydration: true,
    every: 3,
    startH: 9,
    endH: 21,
    hydrationDays: [...exports.EVERY_DAY],
    supps: [],
    fixed: {},
    ids: [],
};
const isWeekday = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7;
const hour = (v, fallback) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback);
const minute = (v, fallback) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 59 ? v : fallback);
/**
 * The stored blob → settings, validated field by field.
 *
 * Never throws and never returns null. It also MIGRATES the older shape, which
 * had no `days` and no `fixed` at all: a reminder stored before this existed
 * was daily, so an absent day list becomes every day rather than none. Reading
 * it as none would silently switch off every reminder every existing member has
 * — the worst possible outcome for a change whose entire purpose is that
 * reminders survive.
 */
function savedFromStored(raw) {
    if (raw == null)
        return exports.EMPTY_SAVED;
    let p;
    try {
        p = JSON.parse(raw);
    }
    catch {
        return exports.EMPTY_SAVED;
    }
    if (!p || typeof p !== 'object')
        return exports.EMPTY_SAVED;
    const days = (v) => {
        if (!Array.isArray(v))
            return [...exports.EVERY_DAY];
        const out = v.filter(isWeekday);
        // A stored EMPTY array is an answer — "no days", i.e. off — and must not be
        // turned back into every day. Only an ABSENT list migrates.
        return out;
    };
    const supps = Array.isArray(p.supps)
        ? p.supps.flatMap((s) => {
            const name = typeof s?.name === 'string' ? s.name.trim() : '';
            if (!name)
                return [];
            return [{
                    id: typeof s?.id === 'string' && s.id ? s.id : `r_${name}`,
                    name,
                    hour: hour(s?.hour, 8),
                    minute: minute(s?.minute, 0),
                    days: s?.days === undefined ? [...exports.EVERY_DAY] : days(s.days),
                }];
        })
        : [];
    const fixed = {};
    for (const k of ['training', 'weighin', 'photo']) {
        const f = p.fixed?.[k];
        if (!f || typeof f !== 'object')
            continue;
        fixed[k] = {
            on: f.on === true,
            hour: hour(f.hour, 18),
            minute: minute(f.minute, 0),
            days: f.days === undefined ? [...exports.EVERY_DAY] : days(f.days),
        };
    }
    return {
        hydration: p.hydration !== false,
        every: [2, 3, 4].includes(p.every) ? p.every : exports.EMPTY_SAVED.every,
        startH: hour(p.startH, exports.EMPTY_SAVED.startH),
        endH: hour(p.endH, exports.EMPTY_SAVED.endH),
        hydrationDays: p.hydrationDays === undefined ? [...exports.EVERY_DAY] : days(p.hydrationDays),
        supps,
        fixed,
        ids: Array.isArray(p.ids) ? p.ids.filter((x) => typeof x === 'string') : [],
    };
}
/**
 * Everything `saved` should schedule, in the order it will be scheduled.
 *
 * ── The rules, all of them about not inventing a reminder ─────────────────
 *
 *  · A reminder on NO DAYS produces nothing. An empty day list is an answer,
 *    and reading it as "every day" would set a reminder the member switched
 *    off one day at a time.
 *  · Hydration counts UP from the first hour to the last, so a window whose end
 *    is earlier than its start produces nothing — the screen says so beside the
 *    boxes while it can still be corrected, and this does not silently repair
 *    it into a window nobody asked for.
 *  · A fixed reminder that is off produces nothing, and its stored time is kept
 *    so switching it back on does not lose the hour they chose.
 *
 * The list is the ONLY thing that decides what gets scheduled, and both the
 * save handler and the launch-time resync read it — so the count the screen
 * reports and the reminders that actually exist cannot drift apart.
 */
function plannedReminders(saved) {
    const out = [];
    if (saved.hydration && saved.hydrationDays.length && saved.endH >= saved.startH) {
        const step = Math.max(1, saved.every);
        for (let h = saved.startH; h <= saved.endH; h += step) {
            out.push({
                key: `hydration-${h}`,
                title: 'Time to hydrate',
                body: 'Sip some water — small and often keeps you on target.',
                route: '/(client)/recovery',
                days: [...saved.hydrationDays],
                hour: h,
                minute: 0,
            });
        }
    }
    for (const k of ['training', 'weighin', 'photo']) {
        const f = saved.fixed[k];
        if (!f?.on || !f.days.length)
            continue;
        const l = exports.FIXED_LABEL[k];
        out.push({ key: `fixed-${k}`, title: l.title, body: l.body, route: l.route, days: [...f.days], hour: f.hour, minute: f.minute });
    }
    for (const s of saved.supps) {
        if (!s.days.length)
            continue;
        out.push({
            key: `supp-${s.id}`,
            // The member's own words as the title, so the banner says the thing they
            // wrote rather than "Reminder".
            title: s.name,
            body: `Reminder: ${s.name}`,
            route: '/(client)/reminders',
            days: [...s.days],
            hour: s.hour,
            minute: s.minute,
        });
    }
    return out;
}
/**
 * How many individual notifications a plan needs.
 *
 * One per reminder PER DAY, because expo-notifications has no "these days"
 * trigger — it has `weekly`, which fires on one weekday. A member with a
 * Monday/Wednesday/Friday training reminder has three scheduled notifications
 * behind one row on the screen, and the screen's "you'll get N reminders" has
 * to count the rows rather than the notifications or it reads as nonsense.
 */
function plannedNotificationCount(plan) {
    return plan.reduce((a, p) => a + p.days.length, 0);
}
/** "Every day", "Weekdays", "Mon, Wed, Fri" — for the row on the screen. */
function daysLabel(days) {
    if (!days.length)
        return 'Off';
    if (days.length === 7)
        return 'Every day';
    const set = new Set(days);
    if (set.size === 5 && exports.WEEKDAYS_ONLY.every((d) => set.has(d)))
        return 'Weekdays';
    if (set.size === 2 && set.has(1) && set.has(7))
        return 'Weekends';
    // Read in the order the product draws a week — src/lib/weekStart.ts decides,
    // and "Sun, Mon, Wed" against a Sunday-first strip on the screen above it is
    // the kind of disagreement a member reads as a bug. The +1 is the conversion
    // from `Date.getDay()` to the 1 = Sunday numbering this file works in.
    const order = Array.from({ length: 7 }, (_, i) => ((0, weekStart_1.jsDayForIndex)(i) + 1));
    return order.filter((d) => set.has(d)).map((d) => exports.DAY_LABEL[d]).join(', ');
}
