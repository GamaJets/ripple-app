"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_RECORD_NOTE = void 0;
exports.localDay = localDay;
exports.daysBetween = daysBetween;
exports.addDays = addDays;
exports.weekStart = weekStart;
exports.classOutcome = classOutcome;
exports.dwellMinutes = dwellMinutes;
exports.mergeAttendance = mergeAttendance;
exports.attendedDays = attendedDays;
exports.rhythm = rhythm;
exports.rhythmWeekLabel = rhythmWeekLabel;
exports.fetchMyAttendance = fetchMyAttendance;
exports.fetchClientAttendance = fetchClientAttendance;
exports.staffScopeNote = staffScopeNote;
// ── A member's own record of turning up ────────────────────────────────────
//
// Two tables hold it and neither was ever read by the client app.
// `class_bookings.attended_at` is the register a coach ticks in
// app/(trainer)/class-checkin.tsx; `gym_visits` (supabase/parts/32-door-log.sql)
// is the door log, which exists precisely because register-only attendance
// under-counts — part 32's own words: "every member who walks in, trains on the
// floor and leaves is invisible". Both are about the member. Only the gym could
// see them.
//
// Both ends are read from here now. `fetchMyAttendance` is the member's own
// history (app/(client)/attendance.tsx) and `fetchClientAttendance` is their
// coach's read of the same record (app/(trainer)/client-attendance.tsx) — the
// same rules, the same refusals, and one extra caveat that belongs only to the
// coach's side, set out above that function.
//
// Framework-agnostic, the shape src/lib/memberRecord.ts and src/lib/gymVisits.ts
// already use: the Supabase client arrives as an argument, so every rule below
// is testable without a database.
//
// ── The four rules this file exists to keep ────────────────────────────────
//
// 1. AN UNTICKED REGISTER IS NOT AN ABSENCE. `attended_at` null on a class that
//    has already run means one of two things: they did not come, or nobody took
//    the register. `set_class_attendance` is a coach pressing a button on their
//    phone, and a coach who is teaching does not always press it. Printing
//    "missed" over that is the app inventing an absence and handing it to the
//    member and — because their coach reads the same record — to the person
//    having the retention conversation with them. The word for it is `unmarked`
//    and there is no code path in this file that turns it into `missed`.
//
// 2. ONE TURNING-UP IS ONE ROW ON SCREEN. `gym_visits.class_id` is set "when the
//    visit was attendance at a booked class, so the two records reconcile
//    instead of double counting the same person" — again part 32's own comment.
//    A member who booked a class, walked through a door that logged them and was
//    ticked off by the coach generates two rows about one hour of their life.
//    `mergeAttendance` folds them into one, and a frequency built on the
//    unfolded pair would report double the training that happened.
//
// 3. NO DATE, NO PLACE ON THE TIMELINE. A class row this member is no longer
//    allowed to read (they changed gyms — see part 136) leaves a booking with no
//    start time. Such an event is neither dropped nor guessed onto a day: it is
//    carried out separately as `undated` so the screen can say "we have this and
//    cannot say when", which is true, instead of either silence or a wrong day.
//    `created_at` is NOT used as the fallback — that is when the seat was
//    booked, which is routinely a different week from when the class ran.
//
// 4. NO RATE FROM A PARTIAL RECORD. `rhythm` refuses to divide unless the read
//    came back whole AND the weeks it averages over lie entirely inside the
//    record. A member who joined three weeks ago, averaged across twelve, reads
//    as somebody who comes once a fortnight. That is a grade computed from
//    weeks that had not happened yet, and it is exactly what this codebase means
//    by inventing a figure.
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const weekStart_1 = require("./weekStart");
/* ── pure rules ───────────────────────────────────────────────────────────── */
/**
 * The local calendar day a timestamp falls on, as YYYY-MM-DD, or null.
 *
 * Local and not UTC, the same choice src/lib/gymVisits.ts made: a gym's Tuesday
 * is its own Tuesday, and a 22:00 session in Dubai belongs to that evening
 * rather than to the next UTC day. `npm run test:zones` runs the suite in three
 * zones so this cannot be right only in London.
 */
function localDay(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Whole days between two bare ISO dates, in UTC from the parsed components.
 *  Constructing local Dates and subtracting is 23 or 25 hours across a DST
 *  boundary, which is how a week silently becomes six days or eight. */
function daysBetween(from, to) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from).trim());
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(to).trim());
    if (!a || !b)
        return null;
    return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}
/** `day` shifted by n days, as a bare ISO date. UTC arithmetic, same reason. */
function addDays(day, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day).trim());
    if (!m)
        return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** The first day of the week `day` falls in — a Sunday, per src/lib/weekStart.ts,
 *  which is the one place in this product that decides. */
function weekStart(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day).trim());
    if (!m)
        return null;
    // UTC arithmetic on a bare date, like `addDays` above and for the same reason:
    // these strings are calendar days with no instant in them, and reading them
    // through a local zone would move half of them.
    const back = (0, weekStart_1.dayIndexInWeek)(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay());
    return addDays(day, -back);
}
function classOutcome(b, startsAt, hasDoorRecord, now) {
    const register = !!b.attendedAt;
    // Evidence first: a member marked present, or logged through the door, was
    // there — whatever the class row says about the time, and whether or not the
    // seat was ever converted off the waitlist.
    if (register || hasDoorRecord)
        return { kind: 'attended', register, door: hasDoorRecord };
    if (b.status === 'waitlist')
        return { kind: 'waitlisted' };
    if (!startsAt)
        return { kind: 'unknown' };
    const t = Date.parse(startsAt);
    if (Number.isNaN(t))
        return { kind: 'unknown' };
    return t > now.getTime() ? { kind: 'upcoming' } : { kind: 'unmarked' };
}
/** Minutes inside, or null when there is no exit. Never 0 for an open visit —
 *  the same refusal src/lib/gymVisits.ts makes, for the same reason. */
function dwellMinutes(v) {
    if (!v || !v.exitedAt)
        return null;
    const a = Date.parse(v.enteredAt);
    const b = Date.parse(v.exitedAt);
    if (Number.isNaN(a) || Number.isNaN(b))
        return null;
    const mins = (b - a) / 60000;
    return mins < 0 ? null : Math.round(mins);
}
/**
 * The two records, folded into one timeline, newest first.
 *
 * Rule 2 is the whole job. A visit carrying a class_id is the SAME occasion as
 * the booking for that class, so it is attached to that event rather than
 * emitted beside it. A visit carrying a class_id we hold no booking for is
 * still one occasion — the desk logged them into a class they never booked —
 * and becomes a class event on its own.
 *
 * `undated` is separate rather than sorted to the end: those events cannot be
 * placed in time at all, and a screen that mixes them into the list implies an
 * ordering that does not exist.
 */
function mergeAttendance(bookings, visits, classes, now) {
    // The door record for each class, if any. First one wins: a member logged in
    // and out twice around one class attended it once.
    const doorByClass = new Map();
    for (const v of visits) {
        if (v.classId && !doorByClass.has(v.classId))
            doorByClass.set(v.classId, v);
    }
    const out = [];
    const seenClass = new Set();
    const classEvent = (classId, booking) => {
        const klass = classes.get(classId) ?? null;
        const visit = doorByClass.get(classId) ?? null;
        // The class's own start time is the occasion. `attendedAt` and the door
        // entry are when somebody pressed something, which is close enough to stand
        // in when the class row is unreadable — and `bookedAt` is not, so it is not
        // in this chain. Rule 3.
        const at = klass?.startsAt ?? booking?.attendedAt ?? visit?.enteredAt ?? null;
        const b = booking ?? { id: `visit:${classId}`, classId, status: 'booked', attendedAt: null, bookedAt: at ?? '' };
        return {
            key: `class:${classId}`,
            source: 'class',
            at,
            day: localDay(at),
            tenantId: klass?.tenantId ?? visit?.tenantId ?? null,
            klass,
            booking,
            outcome: classOutcome(b, klass?.startsAt ?? null, !!visit, now),
            visit,
        };
    };
    for (const b of bookings) {
        if (seenClass.has(b.classId))
            continue;
        seenClass.add(b.classId);
        out.push(classEvent(b.classId, b));
    }
    for (const v of visits) {
        if (v.classId) {
            if (seenClass.has(v.classId))
                continue;
            seenClass.add(v.classId);
            out.push(classEvent(v.classId, null));
            continue;
        }
        out.push({
            key: `visit:${v.id}`,
            source: 'floor',
            at: v.enteredAt,
            day: localDay(v.enteredAt),
            tenantId: v.tenantId,
            klass: null,
            booking: null,
            // A door log IS the gym's record that they came in. There is no register
            // to be untaken on the floor, so this never reaches `unmarked`.
            outcome: { kind: 'attended', register: false, door: true },
            visit: v,
        });
    }
    const dated = out.filter((e) => e.day !== null);
    const undated = out.filter((e) => e.day === null);
    dated.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.key.localeCompare(b.key));
    undated.sort((a, b) => a.key.localeCompare(b.key));
    return { events: dated, undated };
}
/**
 * The distinct local days this member was recorded at a gym, newest first.
 *
 * Days rather than events, because two classes on one Saturday is one day of
 * training and a screen counting "times you came" should not say two. Only
 * events that PROVE attendance count: an upcoming class is not a visit, and an
 * unmarked one is not evidence of anything (rule 1).
 */
function attendedDays(events) {
    const days = new Set();
    for (const e of events) {
        if (e.outcome.kind !== 'attended')
            continue;
        if (e.day)
            days.add(e.day);
    }
    return [...days].sort((a, b) => b.localeCompare(a));
}
/**
 * How often this member actually comes, over the last `weeks` weeks.
 *
 * `whole` is the caller's LoadStatus reduced to one question — did we get all
 * the rows. It is a parameter rather than a thing this function infers, because
 * the only place that knows is the read, and a mean over a truncated read is
 * the silent-wrong-number failure src/lib/rowCap.ts exists to stop.
 *
 * The current week is listed and NOT averaged: a Tuesday cannot be compared
 * with seven finished days, and including it drags every mean down for four
 * days out of every seven.
 */
function rhythm(days, today, weeks, whole) {
    const thisWeek = weekStart(today);
    const sorted = [...days].filter((d) => weekStart(d) !== null).sort();
    const firstDay = sorted.length ? sorted[0] : null;
    if (!thisWeek || weeks <= 0) {
        return { weeks: [], firstDay, countedWeeks: 0, perWeek: null };
    }
    const byWeek = new Map();
    for (const d of sorted) {
        const w = weekStart(d);
        if (!w)
            continue;
        if (!byWeek.has(w))
            byWeek.set(w, new Set());
        byWeek.get(w).add(d);
    }
    const out = [];
    for (let i = 0; i < weeks; i++) {
        const start = addDays(thisWeek, -7 * i);
        if (!start)
            continue;
        const end = addDays(start, 6);
        out.push({
            start,
            complete: end < today,
            // A week beginning before the member's first record is a week we have no
            // information about, not a week they did not come.
            covered: firstDay != null && start >= firstDay,
            days: byWeek.get(start)?.size ?? 0,
        });
    }
    const counted = out.filter((w) => w.complete && w.covered);
    const perWeek = whole && counted.length
        ? Math.round((counted.reduce((s, w) => s + w.days, 0) / counted.length) * 10) / 10
        : null;
    return { weeks: out, firstDay, countedWeeks: counted.length, perWeek };
}
/**
 * One bar of the rhythm strip, said in words.
 *
 * ── Why this is a function and not a `title` on the bar ───────────────────
 *
 * The strip draws four different facts and draws every one of them as a shape:
 * a filled bar is a week with days in it, a flat grey bar is a covered week
 * with none, a dashed outline is a week this app knows nothing about, and
 * reduced opacity is the current week, which is not over. The number underneath
 * is printed as `w.days || ''`, so a covered week with ZERO days and an
 * uncovered week are both blank — the two are told apart by a border style and
 * nothing else.
 *
 * That distinction is not decorative. This screen's own header refuses to
 * compute an absence, and says the strip "marks the weeks it knows nothing
 * about as exactly that". A dashed border is not "exactly that" to somebody
 * using a screen reader, in bright sun, or with any of the colour vision the
 * rest of this file's palette is contrast-tested for — and "you did not come
 * that week" is the one sentence this screen was written not to say by
 * accident.
 *
 * `weekOf` is the week's start already formatted by the caller, for the reason
 * every prose module here takes its dates that way: a bare `getDate()` is
 * "9/12", which is 9 December in London and 12 September in New York, and there
 * is no locale in a pure module (scripts/check-hand-dates.mjs).
 */
function rhythmWeekLabel(w, weekOf) {
    const when = weekOf.trim();
    const head = `Week of ${when}`;
    // Checked before the count, and that order is the whole of it: `days` is 0
    // for an uncovered week too, and reading the zero first is exactly how "we
    // have no record" becomes "you did not come".
    if (!w.covered) {
        return `${head}: nothing on record. Your gym's record of you starts later than this, so this is not a week you stayed away.`;
    }
    const n = w.days;
    const dayWord = n === 1 ? '1 day' : `${n} days`;
    if (!w.complete) {
        // The current week. Never phrased as a total: four days by Thursday is not
        // four days in a week, and the caption under the strip already says the
        // last bar is unfinished.
        return n === 0
            ? `${head}: nothing recorded yet. This week is not over.`
            : `${head}: ${dayWord} so far. This week is not over.`;
    }
    return n === 0
        ? `${head}: no days recorded.`
        : `${head}: ${dayWord} recorded.`;
}
/* ── the reads ────────────────────────────────────────────────────────────── */
const BOOKING_COLUMNS = 'id, class_id, status, attended_at, created_at';
const VISIT_COLUMNS = 'id, tenant_id, class_id, entered_at, exited_at, source';
const CLASS_COLUMNS = 'id, tenant_id, title, kind, instructor, branch, room, starts_at, duration_min';
// `gym_visits.note` is in neither list, deliberately. It is free text the DESK
// writes, in a row the member can read, and RLS cannot help — staff authenticate
// as `authenticated` too, so a column revoke would take it from the console as
// well. Part 125 made the same note about memberships.note. Not selecting it is
// the part this app controls.
const asSource = (v) => (v === 'qr' || v === 'door' || v === 'app' || v === 'manual') ? v : 'desk';
/**
 * Everything the gym has recorded about this member turning up.
 *
 * Three plain queries and no embedded select. `class_bookings` and `gym_visits`
 * BOTH carry a foreign key to `gym_classes`, so asking PostgREST to embed it
 * produces the PGRST201 ambiguity documented in src/lib/gymSessions.ts — and
 * separately, an embed that RLS refused arrives as `gym_classes: null`, which
 * is indistinguishable from no class at all. Fetching by the ids we already
 * hold keeps "the gym recorded no class" and "we were not allowed to read it"
 * apart, which is rule 3 and the same argument part 125 made about plans.
 *
 * A failed CLASS read does not fail the call: the attendance is real and worth
 * showing without its label. A failed BOOKING or VISIT read does, because the
 * alternative is an empty list that reads as "you have never been in".
 */
async function fetchMyAttendance(sb, uid) {
    if (!uid)
        return { ok: false, reason: 'Not signed in.' };
    return readAttendance(sb, uid);
}
/**
 * The same three queries, for whoever's record is being read.
 *
 * One body rather than two, because the honesty of this module is in the
 * BRANCHES — a failed class read that does not fail the call, a class id with
 * no row that lands on `classesComplete: false` — and two copies of that is two
 * places for one of those branches to be dropped. Which rows come back is
 * decided by RLS from the caller's own session, never by an argument here: the
 * member arm is `class_bookings_self_r` / `gym_visits_own_r`, the coach's is
 * `class_bookings_staff_r` / `gym_visits_staff_rw` (parts 165 and 32), and this
 * function is the same three selects under both.
 */
async function readAttendance(sb, uid) {
    try {
        const [bookingRes, visitRes] = await Promise.all([
            sb.from('class_bookings').select(BOOKING_COLUMNS)
                .eq('user_id', uid)
                .order('created_at', { ascending: false }).order('id', { ascending: false })
                .limit((0, rowCap_1.capLimit)()),
            sb.from('gym_visits').select(VISIT_COLUMNS)
                .eq('member_id', uid)
                .order('entered_at', { ascending: false }).order('id', { ascending: false })
                .limit((0, rowCap_1.capLimit)()),
        ]);
        if (bookingRes.error)
            return { ok: false, reason: bookingRes.error.message || 'The read was refused.' };
        if (visitRes.error)
            return { ok: false, reason: visitRes.error.message || 'The read was refused.' };
        const bookingPage = (0, rowCap_1.capped)(bookingRes.data ?? []);
        const visitPage = (0, rowCap_1.capped)(visitRes.data ?? []);
        const bookings = bookingPage.rows.map((r) => ({
            id: String(r.id),
            classId: String(r.class_id),
            status: r.status === 'waitlist' ? 'waitlist' : 'booked',
            attendedAt: r.attended_at ?? null,
            bookedAt: r.created_at,
        }));
        const visits = visitPage.rows.map((r) => ({
            id: String(r.id),
            tenantId: String(r.tenant_id),
            classId: r.class_id ? String(r.class_id) : null,
            enteredAt: r.entered_at,
            exitedAt: r.exited_at ?? null,
            source: asSource(r.source),
        }));
        const classIds = [...new Set([
                ...bookings.map((b) => b.classId),
                ...visits.map((v) => v.classId).filter(Boolean),
            ])];
        const classes = new Map();
        let classesComplete = true;
        if (classIds.length) {
            // CHUNKED, about the REQUEST LINE and not the row ceiling. `classIds` is
            // the union of two `capLimit()` reads, so up to two thousand uuids; at
            // ~39 bytes each inside a PostgREST `in.("…","…")` list that is a ~78KB
            // query string against the 8KB request line nginx and most CDNs enforce.
            // Refused past roughly two hundred with a **414**, which supabase-js does
            // not reject on and which arrives as `data: null`.
            //
            // Two hundred distinct classes is not a stress case: a member doing four
            // classes a week crosses it inside a year, and this read is unwindowed.
            // The consequence is a member's whole attendance history rendered as
            // untitled, undated, uninstructed rows — `classesComplete` would not even
            // have said so, because a 414 sets `error` to null.
            try {
                const rows = await (0, idLookup_1.readByIds)(classIds, 
                // `.order('id')` on a primary-key lookup is total, which is the
                // contract `readAll` requires of every page it is handed.
                (chunk, from, to) => sb.from('gym_classes').select(CLASS_COLUMNS)
                    .in('id', chunk).order('id', { ascending: true }).range(from, to), 'the classes behind this attendance history');
                for (const r of rows) {
                    classes.set(String(r.id), {
                        id: String(r.id),
                        title: typeof r.title === 'string' ? r.title : '',
                        kind: r.kind || null,
                        instructor: r.instructor || null,
                        branch: r.branch || null,
                        room: r.room || null,
                        startsAt: r.starts_at,
                        durationMin: Number.isFinite(Number(r.duration_min)) ? Number(r.duration_min) : null,
                        tenantId: r.tenant_id ?? null,
                    });
                }
                // Not an error and not a silence: a class id with no row came back is a
                // class this member is no longer allowed to read, and the screen has a
                // sentence for it.
                if (classes.size < classIds.length)
                    classesComplete = false;
            }
            catch {
                // `readByIds` throws a refused chunk rather than returning a short set,
                // which is the point of it — a history assembled from the chunks that
                // happened to work is one whose gaps are invisible. Caught here rather
                // than allowed out, because the bookings and visits themselves READ
                // fine and are worth showing; `classesComplete: false` is the sentence
                // the screen already has for "these rows are real but unlabelled".
                classesComplete = false;
            }
        }
        return { ok: true, value: {
                bookings, visits, classes,
                truncated: bookingPage.truncated || visitPage.truncated,
                classesComplete,
            } };
    }
    catch (e) {
        return { ok: false, reason: e.message || 'The read failed.' };
    }
}
/* ── the coach's side of the same record ──────────────────────────────────── */
/**
 * One client's attendance, read by their coach.
 *
 * The rules above do not change because the reader did. Rule 1 is the reason
 * this exists: the header names the person "having the retention conversation"
 * as the one an invented absence gets handed to, and that person is the coach.
 * A coach reading `unmarked` as "missed" rings a client to ask why they have
 * stopped coming, about a class they were at.
 *
 * ── What the coach's read is scoped by, and why it is not the roster ───────
 *
 * Nothing here filters by coaching relationship, because RLS already decides
 * this and the app must not appear to decide it a second time. A coach reaches
 * these rows as GYM STAFF: `class_bookings_staff_r` (part 165) admits bookings
 * on classes whose `gym_classes.tenant_id = my_tenant()`, and
 * `gym_visits_staff_rw` (part 32) admits visits with the same tenant. Both are
 * the door-log line part 165 states in full — working the door is staff work.
 *
 * The consequence is the one thing a screen over this must carry, and it is why
 * `staffScopeNote` below exists rather than being prose in a component:
 *
 *   · A coach with NO gym (`my_tenant()` null — an independent coach, which
 *     this product has plenty of) matches neither policy and gets ZERO ROWS AND
 *     NO ERROR. RLS filters; it does not refuse. That empty result is
 *     byte-identical to a client who has genuinely never been recorded.
 *   · A client who also trains at another gym has rows this coach cannot see,
 *     so even a full read is this gym's record and not the client's life.
 *
 * `{ ok: true }` with an empty list therefore does NOT mean "they have not been
 * in", and the only honest screen is one that says which of the two it is
 * looking at. It cannot work that out from the rows, so it is told.
 */
async function fetchClientAttendance(sb, clientId) {
    if (!clientId)
        return { ok: false, reason: 'No client to read.' };
    return readAttendance(sb, clientId);
}
/**
 * Whether an empty coach-side read is an answer at all — and the sentence for
 * it when it is not.
 *
 * `hasGym` is the coach's own tenant as their profile has it: true, false, or
 * NULL for "we could not find out", which is `useTenant`'s 'error' and is a
 * third state rather than a falsy second one.
 *
 * Returns null when an empty list is a real answer the screen may state, and a
 * sentence otherwise. The sentence never contains a number and never contains
 * the word "no" about the client — it is about the read, because that is the
 * only thing that is known.
 */
function staffScopeNote(hasGym) {
    if (hasGym === null) {
        return 'We could not tell which gym your account belongs to, so we cannot say whether this is '
            + 'their whole record or none of it.';
    }
    if (!hasGym) {
        return 'Your account is not attached to a gym, so this app can read neither a class register nor '
            + 'a door log for anybody. Nothing below is a record of them staying away — there is no record '
            + 'here to read.';
    }
    return null;
}
/** What a coach is looking at even on a whole read, said once. A client trains
 *  where they like, and one gym's record is one gym's record. */
exports.STAFF_RECORD_NOTE = 'This is your gym’s own record of them. Classes and visits at anywhere else are not in it.';
