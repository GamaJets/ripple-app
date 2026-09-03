"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_BACK_DAYS = void 0;
exports.logDayOptions = logDayOptions;
exports.hourLabel = hourLabel;
exports.logStamp = logStamp;
exports.logStampProblem = logStampProblem;
exports.logWhenLine = logWhenLine;
// When the session a coach is typing up actually happened.
//
// ── What was there ────────────────────────────────────────────────────────
//
// app/(trainer)/log-session.tsx built every entry it wrote with one line:
//
//     const at = new Date().toISOString();
//
// So the record said the session happened at the moment Save was pressed, and
// the screen offered nothing to say otherwise. A coach who ran a Monday evening
// session and wrote it up on the Tuesday put an hour of somebody's training on
// the Tuesday — in the client's own log, in their streak, in the weekly report
// their coach then reads back to them, and in plan-versus-actual, which compares
// the day a thing was planned for against the day it landed on. Four things
// that all bucket by day, all wrong, and the client has no way to tell.
//
// Writing up in the evening or the next morning is the ordinary case, not the
// awkward one: a coach with back-to-back clients types the lot up at the end of
// the day. So the day is asked for, and it defaults to today.
//
// ── The day is local, and the arithmetic is on the calendar ───────────────
//
// A day here is a day in the coach's own life, so it is built and read in local
// time throughout: `isoDay` from src/lib/weekStart.ts on the way out and
// `localDate` from src/lib/localDate.ts on the way back. Stepping back through
// the options is `setDate(d - 1)` and never a subtraction of 86,400,000ms — a
// fortnight of options crossing a clocks change would otherwise skip a day at
// one end and repeat one at the other. The suite runs under six timezones
// (`test:zones`) because of lines like these.
//
// ── What the stamp is made of ─────────────────────────────────────────────
//
// The DAY and the HOUR are the coach's; the minute is zero, because an hour is
// what they were asked for and inventing a minute would be inventing detail.
// The seconds and milliseconds are the moment of saving, and they are there for
// one reason worth writing down: they are what keeps two sessions typed up on
// the same evening two rows rather than one. `supersedeKey` in
// src/lib/floorQueue.ts identifies a queued session log by its contents, so two
// logs that agreed on every field INCLUDING the instant would be treated as the
// same log offered twice — which is exactly what we want for a write that was
// re-issued, and exactly what we do not want for two real sessions.
//
// Pure — no react, no supabase, no clock of its own. `now` is passed in.
const locale_1 = require("./locale");
const localDate_1 = require("./localDate");
const weekStart_1 = require("./weekStart");
/**
 * How far back the day picker offers.
 *
 * A fortnight. A coach catching up on Sunday needs the week behind them; a
 * coach catching up after a fortnight away needs two. Further back than that is
 * not catching up, it is reconstructing — and a session remembered three weeks
 * later is a guess going into somebody's history, which this screen should not
 * make easy.
 */
exports.LOG_BACK_DAYS = 13;
/**
 * Today and the days behind it, most recent first.
 *
 * "Today" and "Yesterday" by name because that is what a coach calls them, and
 * everything else as the reader's own locale writes a date — never a hardcoded
 * format, for the reason src/lib/locale.ts gives.
 */
function logDayOptions(now, back = exports.LOG_BACK_DAYS) {
    const out = [];
    const n = Math.max(0, Math.floor(back));
    const cursor = new Date(now.getTime());
    cursor.setHours(12, 0, 0, 0);
    for (let i = 0; i <= n; i++) {
        const day = (0, weekStart_1.isoDay)(cursor);
        out.push({
            day,
            daysAgo: i,
            label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : dayLabel(day),
        });
        // On the calendar, not on the clock. A fortnight containing a clocks change
        // is still fourteen days.
        cursor.setDate(cursor.getDate() - 1);
    }
    return out;
}
/** A date as the reader's own locale writes it. Read through `localDate` — a
 *  bare `YYYY-MM-DD` handed to `Date.parse` is UTC midnight, and reads back as
 *  the previous day for everybody west of Greenwich. */
function dayLabel(day) {
    const d = (0, localDate_1.localDate)(day);
    if (!d)
        return day;
    return d.toLocaleDateString((0, locale_1.appLocale)(), { weekday: 'short', day: 'numeric', month: 'short' });
}
/** An hour of the day as the reader's own locale writes it — "6 pm", "18". */
function hourLabel(hour) {
    const d = new Date(2000, 0, 1, clampHour(hour), 0, 0, 0);
    return d.toLocaleTimeString((0, locale_1.appLocale)(), { hour: 'numeric' });
}
/** Any number the steppers can produce, brought back onto the clock. The
 *  stepper wraps, so this is belt rather than braces — but a stamp is a write
 *  into somebody else's history and `setHours(24)` is tomorrow. */
const clampHour = (h) => {
    if (!Number.isFinite(h))
        return 0;
    return ((Math.floor(h) % 24) + 24) % 24;
};
/**
 * The instant to write, or null when the day cannot be read.
 *
 * See the header for what each part of it comes from.
 */
function logStamp(day, hour, now) {
    const d = (0, localDate_1.localDate)(day);
    if (!d)
        return null;
    d.setHours(clampHour(hour), 0, now.getSeconds(), now.getMilliseconds());
    return d.toISOString();
}
/**
 * Why this session cannot be filed where the coach has put it, or null when it
 * can.
 *
 * One reason: it has not happened yet. A workout dated into the future counts
 * towards a streak nobody has earned and lands in plan-versus-actual against a
 * day that has not been lived, and the client cannot correct it because they
 * were not the one who typed it. The screen holds Save on this rather than
 * warning, because there is no undo on the other side of the write.
 */
function logStampProblem(day, hour, now) {
    const at = logStamp(day, hour, now);
    if (!at) {
        return 'That day could not be read, so there is nothing to file this session under. Pick a day above.';
    }
    if (Date.parse(at) > now.getTime()) {
        return `${hourLabel(hour)} on that day has not happened yet, so this cannot be logged as done. Pick an earlier hour, or an earlier day.`;
    }
    return null;
}
/**
 * What the coach reads under the picker: where this is going and what turns on
 * it.
 *
 * Names the four things that bucket by day, because they are the whole reason
 * the day is being asked for, and a coach who thinks this field is cosmetic
 * will leave it on today.
 */
function logWhenLine(day, hour, now, who) {
    const at = logStamp(day, hour, now);
    if (!at)
        return 'Pick the day this session happened.';
    const when = `${dayLabel(day)} at ${hourLabel(hour)}`;
    const same = day === (0, weekStart_1.isoDay)(now);
    return same
        ? `Goes into ${who}'s record as today at ${hourLabel(hour)}. The day is what their log, their streak, their weekly report and plan-versus-actual all count it on.`
        : `Goes into ${who}'s record as ${when} — not as the moment you are typing it. The day is what their log, their streak, their weekly report and plan-versus-actual all count it on.`;
}
