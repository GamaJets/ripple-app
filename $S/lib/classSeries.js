"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seriesKey = seriesKey;
exports.seriesOf = seriesOf;
exports.weeksLater = weeksLater;
exports.daysLater = daysLater;
exports.atTimeOfDay = atTimeOfDay;
exports.duplicatePlan = duplicatePlan;
exports.duplicateBlocker = duplicateBlocker;
exports.duplicateBrief = duplicateBrief;
exports.duplicateOutcome = duplicateOutcome;
// "Same again next term" — the eight fields a coach re-types every twelve weeks.
//
// ── What was there ────────────────────────────────────────────────────────
//
// app/(trainer)/classes.tsx offers Repeat as 1 / 4 / 8 / 12 weeks AT CREATION
// and nowhere else. Twelve weeks later the Tuesday 6pm Reformer class simply
// stops, and the only way to put it back is to type the title, the kind, the
// branch, the room, the instructor, the day, the hour, the duration and the
// capacity in again — nine fields, from memory, for a class that is already on
// the screen in front of them.
//
// This module is the part of "same again" that is arithmetic, so it can be
// asserted without a database: which rows are one series, when the series ends,
// which dates a re-run would land on, and which of those dates are already
// taken.
//
// ── There is no series in the database, and this does not invent one ──────
//
// `gym_classes` rows are independent. Part 30 gave them a `tenant_id` and
// nothing has ever given them a parent — the existing Repeat loop writes N
// unrelated rows and the fourth of them does not know about the first. So a
// "series" here is a DESCRIPTION of rows that match, not a record, and the
// difference is worth stating because it decides what this can promise:
//
//   · it can say "these nine rows look like one weekly class", and be right
//     about the nine rows it was given;
//   · it CANNOT say "this is the whole of that series", because a row past the
//     read's row cap, or a read that failed, is a row it never saw.
//
// `duplicateBlocker` is the whole of the second point and it refuses rather
// than warns. The reason is specific: the run starts a week after the LAST
// occurrence of the series, so the whole thing depends on having actually seen
// the last one. Under 'partial' the classes shown are real and the ones missing
// are the LATER ones, because the screen sorts ascending — so the row the run
// counts forward from would be the wrong row, and the new term would land on
// top of a term already scheduled. That is the collision this refuses, and it
// is refused at the read rather than guarded against per date, because a date
// check cannot see a class that never arrived.
//
// ── Weeks are added in local wall-clock time, not in milliseconds ─────────
//
// `startsAt + 7 * 86400000` is the obvious version and it is wrong twice a year:
// a 6pm class re-run across a daylight-saving boundary lands at 5pm or 7pm, and
// the members who booked the old one turn up an hour out. `setDate(d + 7)`
// keeps the wall-clock hour and lets the date do the offset, which is what
// "same time next week" means to everybody who is not a computer. The suite
// runs under six timezones (`test:zones`) because of lines like this one.
//
// `daysLater` and `atTimeOfDay` are the same rule applied to the other thing a
// coach does to a class's date: correcting one that was typed in at the wrong
// time. They live here rather than on the screen so there is one place this
// arithmetic is written and one place it is asserted.
//
// Pure — no supabase, no react-native, no clock of its own. `now` is passed in.
const format_1 = require("./format");
const locale_1 = require("./locale");
/**
 * What makes two rows the same series.
 *
 * Every field a coach would have to re-type, PLUS the weekday and the time of
 * day — because "Tuesday 6pm Reformer at Al Quoz" and "Thursday 6pm Reformer at
 * Al Quoz" are two classes a member chooses between, not one class recorded
 * twice. Duration and capacity are in as well: a 45-minute class and a
 * 60-minute class with the same name are different products, and merging them
 * would make the duplicate copy whichever one happened to be last.
 *
 * The date is NOT in the key, which is the point of the key.
 *
 * Case- and space-insensitive on the typed fields. Branch is free text (the
 * picker it replaced offered six hardcoded Dubai locations), so "Al Quoz" and
 * "al quoz " are one branch to every human who reads the timetable, and a key
 * that disagreed would offer to duplicate a series of one.
 */
function seriesKey(c) {
    const d = new Date(c.startsAt);
    const norm = (s) => String(s ?? '').trim().toLowerCase();
    // A row whose date will not parse gets a key nothing else can match, rather
    // than a NaN weekday shared with every other broken row.
    const when = Number.isFinite(d.getTime())
        ? `${d.getDay()}|${d.getHours()}:${d.getMinutes()}`
        : `unparseable|${c.id}`;
    return [
        norm(c.title), norm(c.kind), norm(c.branch), norm(c.room), norm(c.instructor),
        String(c.durationMin), String(c.capacity), when,
    ].join('§');
}
/** Every class in `all` that belongs to the same series as `c`, oldest first.
 *  `c` itself is included — it is one of its own series. */
function seriesOf(c, all) {
    const key = seriesKey(c);
    return all
        .filter((x) => seriesKey(x) === key)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
/**
 * The same wall-clock time, `weeks` weeks later.
 *
 * Exported because the test has to be able to state the DST rule directly
 * rather than through the plan below it.
 */
function weeksLater(iso, weeks) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()))
        return null;
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + 7 * weeks);
    return out.toISOString();
}
/**
 * The same wall-clock time, `days` days later — or earlier, for a negative
 * count.
 *
 * The sibling of `weeksLater`, and here for the same reason it is: a class
 * typed in on the wrong day is corrected by nudging the date, and a nudge made
 * by adding 86,400,000ms moves a 6pm class to 5pm or 7pm across a clocks
 * change. `setDate` moves the calendar and leaves the clock alone, which is
 * what "same time, a day later" means to everybody who is not a computer.
 */
function daysLater(iso, days) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()))
        return null;
    if (!Number.isFinite(days))
        return null;
    const out = new Date(d.getTime());
    out.setDate(out.getDate() + Math.trunc(days));
    return out.toISOString();
}
/**
 * The same calendar day, at a different time of day.
 *
 * The other half of correcting a class that was typed in wrong: `daysLater`
 * moves the date and keeps the clock, this keeps the date and moves the clock.
 * Local hours, because a timetable is read in the room it is taught in.
 *
 * Out-of-range values are brought back onto the clock rather than rolled into
 * the next day — a stepper that wraps 23 to 24 must not silently move a class
 * to tomorrow, which is a class the members who booked it cannot find.
 */
function atTimeOfDay(iso, hour, minute) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()))
        return null;
    const h = Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : 0;
    const m = Number.isFinite(minute) ? ((Math.trunc(minute) % 60) + 60) % 60 : 0;
    const out = new Date(d.getTime());
    out.setHours(h, m, 0, 0);
    return out.toISOString();
}
/**
 * What "run this series again for `weeks` more weeks" would actually write.
 *
 * ── Why it counts forward from the LAST occurrence, not from today ────────
 *
 * A coach opens this in week eleven of a twelve-week term. Counting from today
 * would put the first new class next Tuesday — on top of the one already
 * scheduled — and the term would come out one week short at the far end.
 * Counting from the last occurrence is what "next term" means: the class after
 * the last class.
 *
 * A series whose last occurrence is in the PAST is the ordinary case, not an
 * edge one: the coach noticed in December that the Tuesday class stopped in
 * November. The run still starts a week after that last class, which puts the
 * first few occurrences in the past — so those are skipped as well, by
 * `startsAt <= now`. A class scheduled for a Tuesday three weeks ago cannot be
 * booked and is on nobody's timetable; writing it would put dead rows in the
 * schedule and make the count of what was added disagree with what a member can
 * see. `firstFuture` reports where the run actually begins.
 *
 * `weeks` is how many occurrences to ADD, counted from the last one — so 12
 * gives twelve new Tuesdays, of which the ones already on the timetable and the
 * ones in the past are skipped rather than counted.
 */
function duplicatePlan(c, all, weeks, now) {
    const mine = seriesOf(c, all);
    const times = mine
        .map((x) => Date.parse(x.startsAt))
        .filter((t) => Number.isFinite(t));
    const lastMs = times.length ? Math.max(...times) : null;
    const lastAt = lastMs == null ? null : new Date(lastMs).toISOString();
    const shape = {
        title: c.title, kind: c.kind, instructor: c.instructor, branch: c.branch,
        room: c.room, durationMin: c.durationMin, capacity: c.capacity,
    };
    if (lastAt == null || !Number.isFinite(weeks) || weeks < 1) {
        return { planned: [], toWrite: [], inPast: 0, lastAt, shape };
    }
    const nowMs = now.getTime();
    const planned = [];
    for (let w = 1; w <= Math.floor(weeks); w++) {
        const at = weeksLater(lastAt, w);
        if (!at)
            continue;
        planned.push({ startsAt: at, write: Date.parse(at) > nowMs });
    }
    const toWrite = planned.filter((p) => p.write);
    return {
        planned,
        toWrite,
        inPast: planned.filter((p) => !p.write).length,
        lastAt,
        shape,
    };
}
/**
 * Why this series may not be duplicated right now, or null when it may.
 *
 * Refuses rather than warns, and the reason is in the header: a duplicate's one
 * job is to land on empty slots, and a timetable that came back short or not at
 * all cannot say which slots are empty. Under 'partial' the missing rows are
 * the later ones — the exact ones a next-term run would collide with — so this
 * is the status where a warning would be least use and the collision most
 * likely.
 *
 * Sentence case: it goes under a heading or into an alert body, not on a label.
 */
function duplicateBlocker(status) {
    if (status === 'loading') {
        return 'Still reading your timetable. Adding classes now could put a second copy of one that is already scheduled, because this screen has not seen the whole schedule yet.';
    }
    if (status === 'partial') {
        return 'Your timetable came back at its row limit, so the classes furthest ahead are the ones missing from this screen — and those are exactly the ones a repeat would land on top of. Nothing is added until the whole schedule can be read.';
    }
    if (status === 'error') {
        return 'Your timetable could not be read, so there is no way to tell which slots are already taken. An empty schedule here means the read failed, not that the week is free.';
    }
    return null;
}
const dayLabel = (iso) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime()))
        return 'a date that could not be read';
    return d.toLocaleDateString((0, locale_1.appLocale)(), { weekday: 'short', day: 'numeric', month: 'short' });
};
function duplicateBrief(plan) {
    const n = plan.toWrite.length;
    const { title } = plan.shape;
    if (plan.lastAt == null) {
        return {
            title: 'Nothing To Repeat',
            body: `No date on this class could be read, so there is no last occurrence to count forward from.`,
            confirmLabel: 'OK',
            canWrite: false,
        };
    }
    if (n === 0) {
        return {
            title: 'Nothing Left To Add',
            body: plan.inPast > 0
                ? `“${title}” last ran on ${dayLabel(plan.lastAt)}, and every one of the ${(0, format_1.num)(plan.inPast)} dates this would add falls before today. A class in the past is on nobody’s timetable and cannot be booked, so nothing is written. Ask for more weeks, or add the next one from the form above.`
                : `There is nothing to add. “${title}” runs until ${dayLabel(plan.lastAt)}.`,
            confirmLabel: 'OK',
            canWrite: false,
        };
    }
    const first = plan.toWrite[0].startsAt;
    const last = plan.toWrite[n - 1].startsAt;
    const skipped = plan.inPast > 0
        ? ` ${(0, format_1.num)(plan.inPast)} of the dates in that run ${plan.inPast === 1 ? 'falls' : 'fall'} before today and ${plan.inPast === 1 ? 'is' : 'are'} skipped — a class in the past is on nobody’s timetable.`
        : '';
    return {
        title: n === 1 ? 'Add One More?' : `Add ${(0, format_1.num)(n)} More?`,
        body: `“${title}” carries on weekly from ${dayLabel(first)} to ${dayLabel(last)}, at the same time, in the same room, `
            + `with the same instructor and the same capacity as the one you tapped.${skipped}\n\n`
            + `Members book each one separately, and nothing is booked for anybody by adding them.`,
        confirmLabel: n === 1 ? 'Add It' : `Add ${(0, format_1.num)(n)}`,
        canWrite: true,
    };
}
/**
 * What to say once the writes come back.
 *
 * The same discipline `bulkReport` keeps and for the same reason: `addClass`
 * resolves false when the insert never reached `gym_classes`, and a class that
 * exists on the coach's phone alone is on nobody's timetable and cannot be
 * booked. "Added" over a partial run is the sentence that puts a coach in an
 * empty room.
 */
function duplicateOutcome(title, wanted, saved) {
    if (wanted === 0)
        return { title: 'Nothing Added', body: 'There was nothing to write.' };
    if (saved === wanted) {
        return {
            title: wanted === 1 ? 'Added' : 'Added To Your Timetable',
            body: `${(0, format_1.num)(wanted)} more ${wanted === 1 ? 'class' : 'classes'} of “${title}”. Members can book ${wanted === 1 ? 'it' : 'them'} now.`,
        };
    }
    if (saved === 0) {
        return {
            title: 'Not On The Timetable',
            body: `None of the ${(0, format_1.num)(wanted)} classes reached the server, so they are on this phone only and nobody can book them. They will be gone when you reopen the app — try again once you have signal.`,
        };
    }
    return {
        title: 'Partly Added',
        body: `${(0, format_1.num)(saved)} of ${(0, format_1.num)(wanted)} reached the server. The other ${(0, format_1.num)(wanted - saved)} are on this phone only and cannot be booked. Repeating once you have signal counts forward from the last class that actually landed, so the missing weeks are added rather than the whole run again.`,
    };
}
