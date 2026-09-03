"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whoseClockNote = exports.NO_ZONE_NOTE = void 0;
exports.rotaClock = rotaClock;
exports.rotaDay = rotaDay;
exports.rotaHour = rotaHour;
exports.rotaCell = rotaCell;
exports.rotaTimeLabel = rotaTimeLabel;
exports.rotaInstant = rotaInstant;
exports.addCalendarDays = addCalendarDays;
exports.calendarWeekday = calendarWeekday;
exports.rotaToday = rotaToday;
// Whose clock the rota is drawn on, and the one place that decides.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `app/(owner)/rota.tsx` carried a helper documented as "A stored instant as
// the gym's wall clock" whose body was `d.getHours()`. That is the READER's
// wall clock. `shiftFromHours` in src/lib/gymRota.ts wrote with `setHours` on
// the same clock, so a shift rostered from a phone in Sydney for a gym in Dubai
// was stored six hours from where it was typed — and `studio-web/app/staff`,
// which renders through `gymWhen` with `timeZone: zone`, then showed a
// different hour for the same row. One shift, two answers, and the gym's own
// front desk was not the one telling the truth.
//
// ── Why the times could not be fixed on their own ──────────────────────────
//
// Because the GRID is bucketed by the same clock. `shiftsByDay`, `coverage` and
// `buildRota` group by a local calendar date, so correcting only the labels
// would file a 23:00 gym-time shift under the next day's column with "23:00"
// printed beside it — consistent-but-wrong replaced by visibly inconsistent,
// which is worse. The label and the bucket are one decision and they move
// together. That decision is this file.
//
// ── The rule, and why it differs from gymZone's ────────────────────────────
//
// `src/lib/gymZone.ts` answers NO ZONE MEANS NO ANSWER and returns null, and it
// is right to: bucketing a month's takings on the reader's clock moves money
// between months in a document somebody signs. A ROTA is the case its sibling
// `src/lib/gymWhen.ts` was written for — refusing to draw the week at all, for
// every gym that has not filled in a setting, takes a working screen away to
// make a point.
//
// So these fall back to the reader's clock AND SAY SO. `whoseClockNote` in
// gymWhen.ts is the sentence, `NO_ZONE_NOTE` is its wording, and a screen that
// draws a rota without a zone owes the reader that line. That is the whole
// bargain and it is why `rotaClock()` reports `atGym` rather than swallowing
// the difference.
//
// Framework-free like the rest of src/lib, so the console and the phone can
// both use it and neither owns it — which is the point, because the disagreement
// this closes was between exactly those two.
const gymZone_1 = require("./gymZone");
Object.defineProperty(exports, "NO_ZONE_NOTE", { enumerable: true, get: function () { return gymZone_1.NO_ZONE_NOTE; } });
const gymWhen_1 = require("./gymWhen");
Object.defineProperty(exports, "whoseClockNote", { enumerable: true, get: function () { return gymWhen_1.whoseClockNote; } });
/** What clock a rota is on, given whatever `tenants.timezone` came back as. */
function rotaClock(zone) {
    if ((0, gymZone_1.isZone)(zone))
        return { zone: String(zone).trim(), atGym: true, note: null };
    return { zone: (0, gymZone_1.readerZone)(), atGym: false, note: (0, gymWhen_1.whoseClockNote)(zone) };
}
function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
}
/** `YYYY-MM-DD` from a Date's LOCAL parts — the reader's own day. The same
 *  computation as `isoDay` in src/lib/weekStart.ts, kept here so this module
 *  has no dependency on the week rules it is used beside. */
function readerDay(d) {
    return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function asDate(at) {
    if (at == null || at === '')
        return null;
    const d = at instanceof Date ? at : new Date(at);
    return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * The calendar day an instant falls on, at the gym where the gym has a zone and
 * on the reader's device where it has not. `YYYY-MM-DD`, or null for an instant
 * that is not one.
 *
 * This is the function every bucket in the rota goes through. Two shifts that
 * disagree about which day they are on is the failure, and there is one
 * implementation so they cannot.
 */
function rotaDay(at, zone) {
    if ((0, gymZone_1.isZone)(zone))
        return (0, gymZone_1.gymDay)(at, zone);
    const d = asDate(at);
    return d ? readerDay(d) : null;
}
/**
 * The hour of the day, 0–23, an instant falls in — at the gym, or on the
 * reader's device when the gym has no zone. Null for an unreadable instant.
 *
 * Deliberately NOT derived separately from `rotaDay`: both come from the same
 * zone decision, so the pair can never name a day at the gym and an hour on a
 * laptop.
 */
function rotaHour(at, zone) {
    if ((0, gymZone_1.isZone)(zone))
        return (0, gymZone_1.gymHour)(at, zone);
    const d = asDate(at);
    return d ? d.getHours() : null;
}
/** The day and hour together, or null when either is unreadable. A caller must
 *  not take one without the other — a date with a missing hour is how a shift
 *  ends up drawn at midnight. */
function rotaCell(at, zone) {
    const date = rotaDay(at, zone);
    const hour = rotaHour(at, zone);
    return date != null && hour != null ? { date, hour } : null;
}
/**
 * A wall-clock label for an instant — `HH:MM` on the rota's clock.
 *
 * The screen's own `timeOf` was this function with `getHours()` in it and a doc
 * comment claiming the gym's clock. It is here so the claim is testable, and so
 * the phone and the console cannot drift: `studio-web/app/staff` renders the
 * same instant through `gymWhen`, which asks `Intl` for the same zone, and
 * `rotaClock.test.ts` asserts the two agree on the hour.
 *
 * A dash rather than a plausible-looking midnight for an instant that is not
 * one, which is what the screen already did and is worth keeping.
 */
function rotaTimeLabel(at, zone) {
    const d = asDate(at);
    if (!d)
        return null;
    const hour = rotaHour(at, zone);
    if (hour == null)
        return null;
    const minute = (0, gymZone_1.isZone)(zone) ? gymMinute(d, String(zone)) : d.getMinutes();
    return minute == null ? null : `${pad2(hour)}:${pad2(minute)}`;
}
/** The minute an instant falls on at the gym. Private: nothing outside wants a
 *  minute without the hour beside it. */
function gymMinute(d, zone) {
    try {
        const v = new Intl.DateTimeFormat(undefined, {
            timeZone: zone, numberingSystem: 'latn', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(d).find((p) => p.type === 'minute')?.value;
        const m = Number(v);
        return Number.isInteger(m) && m >= 0 && m <= 59 ? m : null;
    }
    catch {
        return null;
    }
}
/**
 * A day and an hour ON THE ROTA'S CLOCK → the instant they name, as an ISO
 * string. The write side, and the half that moves somebody's shift when it is
 * wrong.
 *
 * `hour` may be 24, and it means midnight opening the NEXT day — the shape a
 * shift form collects, where "06 to 24" is a shift that ends when the day does.
 * Rolling it here rather than at the call site keeps the two shift ends and the
 * week window using one piece of arithmetic.
 *
 * With a zone this is `instantAtGym`, which solves the offset at the instant
 * being named and so is right on the two mornings a year the clocks move. With
 * no zone it is the reader's own midnight plus the hour, which is what the app
 * has always done and is now said out loud rather than implied.
 */
function rotaInstant(day, hour, zone) {
    const d = String(day ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return null;
    if (!Number.isInteger(hour) || hour < 0 || hour > 24)
        return null;
    const rolled = hour === 24 ? { day: addCalendarDays(d, 1), hour: 0 } : { day: d, hour };
    if (rolled.day == null)
        return null;
    if ((0, gymZone_1.isZone)(zone))
        return (0, gymZone_1.instantAtGym)(`${rolled.day}T${pad2(rolled.hour)}:00`, zone);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rolled.day);
    if (!m)
        return null;
    const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), rolled.hour, 0, 0, 0);
    return Number.isNaN(local.getTime()) ? null : local.toISOString();
}
/**
 * `day` plus `n` days, as `YYYY-MM-DD`, with no zone involved at all.
 *
 * Calendar arithmetic on three integers. Doing it through UTC is what keeps it
 * that way: the same string goes in and comes out shifted by whole days, and no
 * reader's midnight and no clock change can touch it. The same trick, and the
 * same reasoning, as the private `addDays` in src/lib/gymZone.ts — exported here
 * because the rota needs it for the week grid, which gymZone has no opinion
 * about.
 */
function addCalendarDays(day, n) {
    const d = String(day ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return null;
    // utc-day-ok: UTC is the CARRIER here, not the calendar. A bare day goes in at
    // UTC midnight and a bare day comes back out, so the zone cancels; using the
    // local getters instead would introduce the very shift this avoids.
    const t = Date.parse(`${d}T00:00:00.000Z`);
    if (Number.isNaN(t))
        return null;
    const x = new Date(t + n * 86400000);
    if (Number.isNaN(x.getTime()))
        return null;
    return `${String(x.getUTCFullYear()).padStart(4, '0')}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
}
/**
 * Which day of the week a bare calendar date falls on: 0 Sunday … 6 Saturday.
 *
 * A calendar date has no zone — "the 6th of September" is not an instant — so
 * this is UTC arithmetic that cancels, exactly as `addCalendarDays` above. The
 * alternative, `new Date(y, m, d).getDay()`, is the reader's midnight and is a
 * different answer on the days a zone has no midnight at all.
 */
function calendarWeekday(day) {
    const d = String(day ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return null;
    // utc-day-ok: as above — a bare day in, a weekday out, and the zone cancels.
    const t = Date.parse(`${d}T00:00:00.000Z`);
    return Number.isNaN(t) ? null : new Date(t).getUTCDay();
}
/**
 * Today, on the rota's clock. The gym's today where it has a zone, the reader's
 * where it has not — which is the difference between an owner in London opening
 * a Sydney gym's rota at 9pm and being shown this week, or next.
 */
function rotaToday(zone, now = Date.now()) {
    return rotaDay(now instanceof Date ? now : new Date(now), zone);
}
