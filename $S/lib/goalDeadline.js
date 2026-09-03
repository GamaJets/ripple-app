"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.targetDayIn = targetDayIn;
// "Four weeks from today", in the calendar the member is standing in.
//
// ── the defect ────────────────────────────────────────────────────────────
//
// app/(client)/goal.tsx offered three chips — 4 wks, 8 wks, 12 wks — and turned
// the chosen one into a stored date like this:
//
//     new Date(Date.now() + days * 86400000).toISOString()
//
// and src/ui/goalTracker.tsx then wrote `.slice(0, 10)` of that into
// `goal_targets.target_date`, which is a bare Postgres `date`. So the day
// recorded against somebody's goal is the day UTC was having when the
// arithmetic finished, and UTC is nobody's calendar.
//
// Two independent errors, both of them a whole day:
//
//   · THE UTC SLICE. A member in Los Angeles tapping "4 wks" at eight in the
//     evening is already on tomorrow's date in UTC, so the target lands 29 days
//     out. A member in Auckland tapping it at nine in the morning is still on
//     yesterday's, so it lands 27. Same chip, same tap, three different answers
//     depending on where the phone is and what time it is. This is the
//     eighteenth instance of the defect scripts/check-utc-day.mjs was written
//     for; it is invisible to that gate because the `.toISOString()` and the
//     `.slice(0, 10)` are in two different files.
//
//   · MILLISECOND ARITHMETIC ACROSS A CLOCKS CHANGE. `days * 86400000` is
//     `days` lots of twenty-four hours, and a calendar day is not always
//     twenty-four hours long. Adding 28 of them to just after midnight on the
//     1st of March lands at half past eleven on the EVENING OF THE 28TH in any
//     zone that puts its clocks forward in between — a day short, for the same
//     reason `startOfWeek` in src/lib/weekStart.ts uses `setDate` rather than a
//     millisecond subtraction.
//
// Neither is loud. The goal simply sits there with a date on it that is one day
// off what the member chose, and the only person who could ever notice is the
// member, counting on a calendar, against a screen they have no reason to
// doubt. It is also the date `isOverdue` in src/lib/goalTargets.ts judges them
// against, and `goalEnergy` builds a daily calorie target from — so a day is
// not only cosmetic here.
//
// ── the answer ────────────────────────────────────────────────────────────
//
// Do the arithmetic on the calendar and write the local day down. `setDate`
// rolls months and years and survives a clocks change; `isoDay` reads the LOCAL
// getters, which is the whole reason it exists.
//
// Pure, and takes its `from` instant, so the answer can be asserted under six
// timezones without a device.
const weekStart_1 = require("./weekStart");
/**
 * The bare `YYYY-MM-DD` that is `days` whole days after the day `from` falls
 * in, read in the reader's own zone.
 *
 * Null for "no date", which is a real answer this screen offers and not a
 * failure: a goal with no deadline is an ordinary goal. Null also for a `days`
 * that is not a whole non-negative number, because a target date is a promise
 * and half a day is not one.
 *
 * `days = 0` is today, and is allowed. Nothing offers it today, and refusing it
 * would be a rule about the caller's chips rather than about dates.
 */
function targetDayIn(days, from = Date.now()) {
    if (days == null)
        return null;
    if (!Number.isInteger(days) || days < 0)
        return null;
    const base = from instanceof Date ? new Date(from.getTime()) : new Date(from);
    if (Number.isNaN(base.getTime()))
        return null;
    // Midnight first, so the answer cannot depend on the time of day the member
    // happened to tap the chip — and so the `setDate` below is arithmetic on a
    // day rather than on a moment inside one.
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + days);
    return (0, weekStart_1.isoDay)(base);
}
