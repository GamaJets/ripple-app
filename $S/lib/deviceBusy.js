"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSY_PRIVACY_NOTE = exports.BUSY_NOTES = exports.candidateMinutes = exports.MAX_BUSY_DAYS = void 0;
exports.toBusySpan = toBusySpan;
exports.busyWindow = busyWindow;
exports.busyCandidates = busyCandidates;
exports.candidateTimeLabel = candidateTimeLabel;
exports.foldByDay = foldByDay;
exports.busyView = busyView;
exports.busyBlockLabel = busyBlockLabel;
// Coach · blocking time from the phone's own diary, without reading the diary.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// `doBlock` in app/(trainer)/calendar.tsx blocks time a coach types in by
// hand, and src/lib/blockRange.ts extended that to a run of days. Both start
// from the coach remembering. A coach whose Repple availability does not know
// about their dentist appointment double-books once, and after that they stop
// trusting the availability generator — which is the feature the whole booking
// side of this app rests on.
//
// The phone already knows. So this module takes the phone's answer to one
// question — WHEN ARE YOU BUSY — and turns it into the same day-and-period
// shape `block_time` already accepts. Nothing here talks to a device: the
// reading lives in src/ui/deviceBusy.ts behind the HAS_NATIVE_CALENDAR guard,
// and everything below is arithmetic on numbers, which is why it can be run
// under six timezones by `npm run test:zones`.
//
// ── THE RULE THIS MODULE EXISTS TO KEEP ───────────────────────────────────
//
// TIMES ONLY. NEVER TITLES, ATTENDEES, NOTES OR LOCATIONS.
//
// A coach's diary is not a work calendar. It holds their therapy appointment,
// their solicitor, their child's hospital date, and other people's names and
// addresses. None of that is ours, none of it is needed to know that a Tuesday
// afternoon is spoken for, and none of it may be stored, sent, logged or drawn
// on screen. `toBusySpan` below is the ONLY place in this app that touches an
// object that came out of the calendar, and it reads exactly two properties
// off it. A test asserts that the thing it returns has two keys and that both
// are numbers, so a fifth field cannot be added here by accident and cannot
// arrive by a later `...spread` either.
//
// The `allDay` flag is not read either, though the calendar offers it. It is
// DERIVED from the times — a period covering a whole local day — because
// deriving it needs nothing beyond the two numbers already taken, and an
// all-day entry has to be told apart: a birthday reminder is not a reason to
// close somebody's Tuesday.
//
// And nothing derived from a calendar entry ever reaches a client. The result
// of all of this is a `block_time` call, which is an ABSENCE on the coach's
// availability — no reason, no title, nothing to leak.
const format_1 = require("./format");
const localDate_1 = require("./localDate");
/** How far ahead a single read may look. Matches MAX_BLOCK_DAYS in
 *  src/lib/blockRange.ts, because everything found here is blocked through it
 *  and a window it could not act on would be a list that lies. */
exports.MAX_BUSY_DAYS = 60;
/**
 * Epoch milliseconds for a value off a calendar entry, or null.
 *
 * `localDate` rather than `Date.parse` for the same reason the rest of this
 * repo uses it: an all-day entry can come back as a bare `YYYY-MM-DD`, which
 * `Date.parse` resolves to UTC midnight — the previous afternoon in Kiritimati
 * and the following morning in Midway. A bare date means a day in the coach's
 * own life, so it is read as local midnight.
 */
function msOf(v) {
    if (v instanceof Date) {
        const t = v.getTime();
        return Number.isFinite(t) ? t : null;
    }
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const d = (0, localDate_1.localDate)(v);
        const t = d ? d.getTime() : NaN;
        return Number.isFinite(t) ? t : null;
    }
    return null;
}
/**
 * The two numbers, off whatever the calendar handed back — and nothing else.
 *
 * Takes `unknown` on purpose. The caller holds a native shared object whose
 * type this file must not depend on, and typing the parameter as an event
 * shape would invite somebody to widen it one field at a time. Every property
 * read is written out below and there are two of them.
 *
 * Returns null for an entry with no readable start, no readable end, or an end
 * that is not after its start. A dropped entry is a period the coach blocks by
 * hand, which is what they do today; a guessed one is time nobody can book.
 */
function toBusySpan(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    let startMs = null;
    let endMs = null;
    try {
        // Reading a property off a native shared object can throw. These two lines
        // are the entire surface this app presents to somebody's diary.
        startMs = msOf(raw.startDate);
        endMs = msOf(raw.endDate);
    }
    catch {
        return null;
    }
    if (startMs == null || endMs == null)
        return null;
    if (endMs <= startMs)
        return null;
    return { startMs, endMs };
}
/** Local midnight `days` after the local midnight of `from`, as a Date, or
 *  null. Built with `setDate` rather than by adding milliseconds: across a
 *  clock change a day is 23 or 25 hours, and a window built by multiplication
 *  ends an hour into the wrong day. */
function midnightPlus(from, days) {
    const start = (0, localDate_1.localDate)(from);
    if (!start)
        return null;
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d.setDate(d.getDate() + days);
    return d;
}
/** The instants a read covers: local midnight on `fromDay`, to local midnight
 *  `days` later. Null for anything outside the guards, which the caller shows
 *  as a refusal rather than clamping — a window nobody asked for would list
 *  time nobody meant to block. */
function busyWindow(fromDay, days) {
    if (!Number.isInteger(days) || days < 1 || days > exports.MAX_BUSY_DAYS)
        return null;
    const from = midnightPlus(fromDay, 0);
    const to = midnightPlus(fromDay, days);
    if (!from || !to)
        return null;
    return { fromMs: from.getTime(), toMs: to.getTime() };
}
/** Minutes from local midnight, from the wall clock rather than from a
 *  subtraction. On the day a clock goes back, `(t - midnight) / 60000` is sixty
 *  minutes adrift for every instant after the change. */
const minsOf = (d) => d.getHours() * 60 + d.getMinutes();
const MINS_PER_DAY = 24 * 60;
/**
 * The busy periods inside the window, one row per period per day.
 *
 * Overlapping and touching periods on the same day are merged: two entries at
 * 9-10 and 9:30-11 are one busy stretch to a coach and would otherwise be two
 * rows and two calls that the server would answer 'already-blocked' for the
 * second of. Periods with a gap between them are NOT merged — a 9am
 * physiotherapist and a 6pm dinner are two absences, and joining them would
 * close a working day the coach never said was closed.
 */
function busyCandidates(spans, fromDay, days) {
    const win = busyWindow(fromDay, days);
    if (!win)
        return [];
    const out = [];
    for (let i = 0; i < days; i++) {
        const dayStart = midnightPlus(fromDay, i);
        const dayEnd = midnightPlus(fromDay, i + 1);
        if (!dayStart || !dayEnd)
            return [];
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayEnd.getTime();
        const day = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
        const pieces = [];
        for (const s of spans) {
            if (s.endMs <= dayStartMs || s.startMs >= dayEndMs)
                continue;
            const from = new Date(Math.max(s.startMs, dayStartMs));
            const to = Math.min(s.endMs, dayEndMs);
            const startMin = from.getTime() <= dayStartMs ? 0 : minsOf(from);
            const endMin = to >= dayEndMs ? MINS_PER_DAY : minsOf(new Date(to));
            if (endMin <= startMin)
                continue;
            pieces.push({ startMin, endMin, entries: 1 });
        }
        if (pieces.length === 0)
            continue;
        pieces.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
        const merged = [];
        for (const p of pieces) {
            const last = merged[merged.length - 1];
            if (last && p.startMin <= last.endMin) {
                last.endMin = Math.max(last.endMin, p.endMin);
                last.entries += p.entries;
            }
            else {
                merged.push({ ...p });
            }
        }
        for (const m of merged) {
            out.push({
                key: `${day}@${m.startMin}-${m.endMin}`,
                day,
                startMin: m.startMin,
                endMin: m.endMin,
                allDay: m.startMin === 0 && m.endMin === MINS_PER_DAY,
                entries: m.entries,
            });
        }
    }
    return out;
}
/** How long a period runs, in minutes — the argument `block_time` takes. */
const candidateMinutes = (c) => c.endMin - c.startMin;
exports.candidateMinutes = candidateMinutes;
/**
 * The period as a coach reads one: "9 am — 10:30 am", or "All day".
 *
 * Through `fmtClock`, so a coach in Berlin reads 19:00 and a coach in Sydney
 * reads 7 pm. The end of the day is written as a word because "00:00" at the
 * END of a range reads as a range that runs backwards.
 */
function candidateTimeLabel(c) {
    if (c.allDay)
        return 'All day';
    const from = (0, format_1.fmtClock)(Math.floor(c.startMin / 60), c.startMin % 60);
    const to = c.endMin >= MINS_PER_DAY
        ? 'midnight'
        : (0, format_1.fmtClock)(Math.floor(c.endMin / 60), c.endMin % 60);
    return `${from} — ${to}`;
}
/**
 * How badly a day went, when more than one period on it was blocked.
 *
 * `summariseBlocks` in src/lib/blockRange.ts counts DAYS, and a coach picking
 * two periods on the same Tuesday produces two calls with the same day. Left
 * unfolded, "2 days blocked" would be a sentence about a week with one day in
 * it. So each day is folded to a single outcome first, and the precedence
 * below is deliberately pessimistic:
 *
 *     failed > booked > blocked > already-blocked
 *
 * A Tuesday where one period saved and another did not is reported as 'failed'
 * — "that day is still bookable" — which is TRUE of the part that did not
 * save, and the coach is sent back to a day that needs them. The other order
 * would report the day as blocked while an hour of it was still on sale, and
 * that is the one sentence blockRange.ts exists to stop. Under-claiming is the
 * only safe direction here.
 *
 * `withdrawn` is summed across every period of the day whatever the fold
 * chooses, because a slot the server actually withdrew is a fact about the
 * diary and not a judgement about the day.
 */
const SEVERITY = {
    'already-blocked': 0,
    blocked: 1,
    booked: 2,
    failed: 3,
};
function foldByDay(results) {
    const byDay = new Map();
    const order = [];
    for (const r of results) {
        const prev = byDay.get(r.day);
        if (!prev) {
            order.push(r.day);
            byDay.set(r.day, { day: r.day, outcome: r.outcome, withdrawn: r.withdrawn || 0 });
            continue;
        }
        byDay.set(r.day, {
            day: r.day,
            outcome: SEVERITY[r.outcome] > SEVERITY[prev.outcome] ? r.outcome : prev.outcome,
            withdrawn: prev.withdrawn + (r.withdrawn || 0),
        });
    }
    return order.map((d) => byDay.get(d));
}
function busyView(a) {
    // A binary without the native half never asked anybody anything, so this
    // outranks every other state including a stale permission. It is also the
    // reason this comes before 'ask': offering a button that cannot do anything
    // is worse than saying why it is not there.
    if (!a.supported || a.permission === 'unavailable')
        return 'unavailable';
    if (!a.asked)
        return 'ask';
    if (a.status === 'loading')
        return 'loading';
    // Before 'failed' and before 'empty': a refusal usually arrives WITH an
    // empty list, and sometimes with an error as well.
    if (a.permission === 'denied')
        return 'denied';
    if (a.status === 'error')
        return 'failed';
    // 'partial' is not 'ready', but for this list it is honest: the periods
    // shown are real and blockable, and the note for 'list' says the list is
    // what the phone gave rather than a complete account of the coach's life.
    if (a.count === 0)
        return 'empty';
    return 'list';
}
/**
 * What each state says, in words, minus the one the app already owns: a binary
 * without the native module shows CALENDAR_UNAVAILABLE_NOTE from
 * src/ui/nativeModules.ts, which is the sentence the rest of the app uses for
 * exactly that, and repeating it here is how two sentences drift apart.
 */
exports.BUSY_NOTES = {
    ask: 'Nothing has been read yet. Your phone will ask you to allow this, and you can say no and go on blocking time by hand.',
    loading: 'Looking at when you are busy…',
    denied: 'Your calendar is not shared with Repple, so nothing was read and this is not a statement that you are free. Turn calendar access on for Repple in your phone settings, or block the time by hand below.',
    failed: 'Your calendar could not be read, so this is not a statement that you are free either. Try again, or block the time by hand below.',
    empty: 'Nothing in your calendar falls in this window. Anything you add later needs looking again.',
    list: 'These are the times your calendar says you are busy. Pick the ones that should stop clients booking you.',
};
/**
 * The promise the permission sheet makes, kept in the same file as the code
 * that keeps it.
 *
 * The Info.plist strings in app.json say the same thing to the operating
 * system. This is what a coach reads inside the app, before the system prompt
 * appears, so the sentence and the behaviour are decided together.
 */
exports.BUSY_PRIVACY_NOTE = 'Repple reads when you are busy and nothing else. No title, no notes, no location and nobody you are meeting is read, shown, saved or sent, and nothing is ever written back to your calendar. A client only sees that you are unavailable, never why.';
/** The confirm button, saying what it will actually do. Null when nothing is
 *  picked, which is the caller's cue to disable it — this feature never blocks
 *  anything the coach has not chosen one row at a time. */
function busyBlockLabel(picked) {
    if (!Number.isInteger(picked) || picked < 1)
        return null;
    return picked === 1 ? 'Block This Period' : `Block ${picked} Periods`;
}
