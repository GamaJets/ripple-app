"use strict";
// One-to-ones on the gym's own timetable.
//
// The gym had two calendars. `gym_classes` was the gym's, on the board at
// studio-web/timetable; one-to-ones were the trainer's, in `sessions`, and the
// gym only ever met them afterwards as payroll (src/lib/gymSessions.ts). So an
// owner asking "is the floor covered at six?" was reading one of the two lists
// and guessing at the other.
//
// This module does not model a second kind of appointment. A one-to-one is
// already a `sessions` row — see supabase/parts/44-gym-pt-schedule.sql for why
// extending that table beat inventing a parallel one. What is here is the
// reading of those rows as *timetable* rather than as payroll, and the merge
// that puts them on one board with the classes.
//
// Framework-agnostic like its neighbours: the Supabase client comes in as an
// argument, so the console and the phone app can both use it and neither owns
// it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPtSlots = fetchPtSlots;
exports.classEntry = classEntry;
exports.ptEntry = ptEntry;
exports.mergeTimetable = mergeTimetable;
exports.overlapping = overlapping;
exports.entriesAt = entriesAt;
exports.floorAt = floorAt;
exports.floorByHour = floorByHour;
exports.isHardClash = isHardClash;
exports.clashes = clashes;
exports.summariseBoard = summariseBoard;
exports.bookingFields = bookingFields;
exports.slotBlocker = slotBlocker;
exports.bookingRefusalNote = bookingRefusalNote;
exports.createPtSlot = createPtSlot;
exports.removePtSlot = removePtSlot;
exports.updatePtSlot = updatePtSlot;
exports.fetchTrainerOptions = fetchTrainerOptions;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
/**
 * The gym's one-to-ones in a window.
 *
 * Names come from `profiles` in a second query rather than from a PostgREST
 * embed: `trainers` and `clients` are both keyed on profiles.id and neither
 * carries full_name, so there is no name to embed. An owner may read their own
 * tenant's profiles (profiles_owner_r, 38-tenant-isolation.sql §8).
 */
async function fetchPtSlots(sb, tenantId, fromISO, toISO) {
    const { data, error } = await sb
        .from('sessions')
        .select('id, trainer_id, client_id, starts_at, duration_min, room, status, outcome, settlement_id')
        .eq('tenant_id', tenantId)
        .gte('starts_at', fromISO)
        .lte('starts_at', toISO)
        .order('starts_at', { ascending: true })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    // Capped, because PostgREST stops at 1000 rows and says nothing (see
    // src/lib/rowCap.ts). The order is ascending, so a truncated read drops the
    // END of the window — the board would simply stop partway through the week,
    // and /timetable would report "Double-booked 0" and a floor-cover strip with
    // holes in it, both of which are statements about the gym's week rather than
    // about a query that was cut off. A busy gym passes 1000 sessions in a month.
    const rows = (0, rowCap_1.assertWhole)(data, 'the one-to-ones in this window');
    if (!rows.length)
        return [];
    const ids = [...new Set(rows.flatMap((r) => [r.trainer_id, r.client_id]).filter(Boolean))];
    // A failure to read the names must not be reported as "the sessions have no
    // names" — that is the difference between not loaded and loaded-and-empty,
    // one level down. So it throws like everything else.
    // CHUNKED. The read above is `capLimit()`, so `rows` can be a thousand
    // sessions, and every session carries TWO ids — a trainer and a client — so
    // `ids` can be two thousand uuids. At about 39 bytes each inside an
    // `in.("…","…")` list that is a 78KB request line; nginx and most CDNs refuse
    // past 8KB, which is roughly two hundred. The 414 arrives as `data: null`,
    // which is indistinguishable from "none of these people has a profile", and
    // the board would render a whole week of one-to-ones with nobody's name on
    // it. 150 at a time (src/lib/idLookup.ts) cannot reach that limit.
    const names = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        const { data: profs, error: nameErr } = await sb
            .from('profiles').select('id, full_name').in('id', chunk);
        if (nameErr)
            throw nameErr;
        (profs ?? []).forEach((p) => {
            const n = (p.full_name || '').trim();
            if (n)
                names.set(p.id, n);
        });
    }
    return rows.map((r) => ({
        id: r.id,
        trainerId: r.trainer_id,
        trainerName: names.get(r.trainer_id) ?? null,
        clientId: r.client_id ?? null,
        clientName: r.client_id ? (names.get(r.client_id) ?? null) : null,
        startsAt: r.starts_at,
        durationMin: r.duration_min ?? 60,
        room: r.room ?? null,
        status: r.status,
        outcome: r.outcome ?? null,
        settlementId: r.settlement_id ?? null,
    }));
}
function endOf(startsAt, durationMin) {
    const t = Date.parse(startsAt);
    if (!Number.isFinite(t))
        return '';
    return new Date(t + durationMin * 60000).toISOString();
}
function classEntry(c) {
    return {
        key: `class:${c.id}`,
        sourceId: c.id,
        kind: 'class',
        title: c.title,
        startsAt: c.startsAt,
        endsAt: endOf(c.startsAt, c.durationMin),
        durationMin: c.durationMin,
        room: c.room ?? null,
        staffId: c.trainerId ?? null,
        staffName: c.instructor ?? null,
        booked: c.booked,
        // A class recorded with no capacity has no fill figure; 0 would read as
        // "no room left" rather than "nobody set one".
        capacity: c.capacity > 0 ? c.capacity : null,
        slotStatus: null,
        outcome: null,
        withName: null,
    };
}
function ptEntry(s) {
    // A one-to-one holds exactly one place, because `sessions` holds exactly one
    // client_id. A blocked slot holds none that anyone could take, so it reports
    // neither a numerator nor a denominator.
    const blocked = s.status === 'blocked';
    return {
        key: `pt:${s.id}`,
        sourceId: s.id,
        kind: 'one_to_one',
        title: 'One-to-one',
        startsAt: s.startsAt,
        endsAt: endOf(s.startsAt, s.durationMin),
        durationMin: s.durationMin,
        room: s.room ?? null,
        staffId: s.trainerId ?? null,
        staffName: s.trainerName ?? null,
        booked: blocked ? null : (s.status === 'booked' ? 1 : 0),
        capacity: blocked ? null : 1,
        slotStatus: s.status,
        outcome: s.outcome,
        withName: s.clientName ?? null,
    };
}
/** Classes and one-to-ones, in the order they happen. */
function mergeTimetable(classes, slots) {
    const all = [...classes.map(classEntry), ...slots.map(ptEntry)];
    return all.sort((a, b) => {
        const d = Date.parse(a.startsAt) - Date.parse(b.startsAt);
        if (d)
            return d;
        // Classes first at the same minute: they are the fixed points a gym plans
        // one-to-ones around, and a stable order keeps the board from shuffling.
        if (a.kind !== b.kind)
            return a.kind === 'class' ? -1 : 1;
        return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
    });
}
/* ── is the floor covered at six? ──────────────────────────────────────────── */
/** Whether two entries are on the floor at the same time at any point. */
function overlapping(a, b) {
    const as = Date.parse(a.startsAt), bs = Date.parse(b.startsAt);
    const ae = Date.parse(a.endsAt), be = Date.parse(b.endsAt);
    if (![as, bs, ae, be].every(Number.isFinite))
        return false;
    // Touching is not overlapping: a class ending at 18:00 and one starting at
    // 18:00 share a room quite happily.
    return as < be && bs < ae;
}
/** Everything running at one instant. Half-open: something starting exactly
 *  then is on, something ending exactly then is not. */
function entriesAt(entries, atMs) {
    return entries.filter((e) => {
        const s = Date.parse(e.startsAt), x = Date.parse(e.endsAt);
        return Number.isFinite(s) && Number.isFinite(x) && s <= atMs && atMs < x;
    });
}
function floorAt(entries, atMs) {
    const on = entriesAt(entries, atMs);
    const staff = new Set();
    let unstaffed = 0, heads = null;
    for (const e of on) {
        const who = e.staffName?.trim();
        if (who)
            staff.add(who);
        else if (e.staffId)
            staff.add(e.staffId);
        else
            unstaffed += 1;
        if (e.booked != null)
            heads = (heads ?? 0) + e.booked;
    }
    return {
        at: new Date(atMs).toISOString(),
        classes: on.filter((e) => e.kind === 'class').length,
        oneToOnes: on.filter((e) => e.kind === 'one_to_one').length,
        staff: [...staff].sort(),
        unstaffed,
        heads,
        entries: on,
    };
}
/**
 * The day hour by hour, so a gap in cover is visible as a gap.
 *
 * Takes the day's start as an epoch instant rather than a date string on
 * purpose: "6am" depends on the reader's timezone, and the caller is the one
 * who knows theirs. Every hour in the range is returned, including the empty
 * ones — a quiet 14:00 is the answer, not a row to omit.
 */
function floorByHour(entries, dayStartMs, fromHour = 6, toHour = 22) {
    const out = [];
    for (let h = fromHour; h <= toHour; h++) {
        out.push(floorAt(entries, dayStartMs + h * 3600000));
    }
    return out;
}
/** A clash the board is certain about, and counts as a double-booking. */
function isHardClash(c) {
    return c.reason !== 'room-shared';
}
const roomKey = (r) => (r ?? '').trim().toLowerCase();
/**
 * Double-bookings across both calendars — the thing that was invisible while
 * classes and one-to-ones lived in separate lists.
 *
 * TWO RULES, AND ONE DELIBERATE OMISSION:
 *
 *   * A trainer running two things at once is always a clash, and is matched
 *     on trainer id only. A class's `instructor` is free text — two gyms'
 *     worth of "Sam" would collide, and one person typed two ways would not —
 *     so a name is never treated as an identity here.
 *
 *   * A room is a hard clash when at least one side is a class. A class takes
 *     the room; anything else in it at the same time is displaced.
 *
 *   * TWO ONE-TO-ONES IN THE SAME ROOM ARE REPORTED, as 'room-shared'. This
 *     used to raise nothing at all, and the reasoning was sound as far as it
 *     went: the main floor holds several one-to-ones at once, and `sessions`
 *     records no room capacity, so calling it a double-booking would invent a
 *     limit the data does not know.
 *
 *     What that reasoning missed is that saying NOTHING also invents something.
 *     Two coaches and one spare room is the most common clash in a small gym,
 *     and the board reported "Double-booked 0" over a week where two trainers
 *     had both put a client in Studio 2 at 18:00. The owner read a clean week
 *     off a check that could not see the thing they were checking for, and
 *     found out when both clients were standing in the doorway.
 *
 *     So it is surfaced and it is kept separate. `isHardClash` is what the
 *     headline figure counts, so a gym whose trainers all write "main floor"
 *     does not get a KPI full of false alarms; the shared rooms are listed
 *     beside it with their own sentence, which is the honest position — the
 *     board can see that two things are in one room and genuinely cannot know
 *     whether that room holds two.
 */
function clashes(entries) {
    const out = [];
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const a = entries[i], b = entries[j];
            if (!overlapping(a, b))
                continue;
            if (a.staffId && a.staffId === b.staffId) {
                out.push({ reason: 'trainer', what: a.staffName ?? b.staffName ?? a.staffId, a, b });
            }
            const ra = roomKey(a.room);
            if (ra && ra === roomKey(b.room)) {
                const hard = a.kind === 'class' || b.kind === 'class';
                out.push({ reason: hard ? 'room' : 'room-shared', what: (a.room ?? b.room).trim(), a, b });
            }
        }
    }
    return out;
}
function summariseBoard(entries) {
    let booked = null;
    for (const e of entries)
        if (e.booked != null)
            booked = (booked ?? 0) + e.booked;
    return {
        entries: entries.length,
        classes: entries.filter((e) => e.kind === 'class').length,
        oneToOnes: entries.filter((e) => e.kind === 'one_to_one').length,
        openSlots: entries.filter((e) => e.kind === 'one_to_one' && e.slotStatus === 'available').length,
        booked,
        // Computed once and split, rather than calling `clashes` twice: it is
        // O(n²) over the week's board and the two figures must agree about the
        // same list.
        ...(() => {
            const all = clashes(entries);
            return {
                clashes: all.filter(isHardClash).length,
                sharedRooms: all.length - all.filter(isHardClash).length,
            };
        })(),
    };
}
/**
 * The columns that make a session booked to somebody — or open again.
 *
 * There is exactly one notion of a booked one-to-one in this product and this
 * is it, stated once so the console cannot invent a second. `book_session` in
 * 09-sessions-access.sql writes
 *
 *     client_id = auth.uid(), status = 'booked', released = false
 *
 * and `cancel_session` writes the inverse. The trainer's own calendar
 * (src/ui/sessions.tsx) writes the same three. A gym booking a member in from
 * Studio therefore writes the same three, and a slot booked at the desk is
 * indistinguishable from one the member booked themselves — which is the point:
 * payroll, the member's app, the waitlist promotion and the no-double-booking
 * constraint (86-no-double-booking.sql, `where status = 'booked'`) all key off
 * that status, and a slot that carried a client id while still saying
 * 'available' would be invisible to every one of them.
 *
 * `released` is set rather than left alone in both directions. It means "this
 * hour was given back", and a slot re-booked to somebody else while it still
 * said released would show as free capacity that is not free.
 */
function bookingFields(clientId) {
    return clientId
        ? { client_id: clientId, status: 'booked', released: false }
        : { client_id: null, status: 'available', released: true };
}
/**
 * Why this slot cannot go on the board, or null when it can.
 *
 * Pure, so the form can say it before the round trip and the test can prove it
 * without a database. It refuses rather than repairs: a duration typed as 0 is
 * an unfinished form, and defaulting it to 60 would put an hour on the gym's
 * timetable that nobody asked for.
 */
function slotBlocker(s) {
    if (!s.trainerId)
        return 'Choose which trainer is taking it.';
    if (!s.startsAt || !Number.isFinite(Date.parse(s.startsAt))) {
        return 'Give it a date and time.';
    }
    if (!Number.isFinite(s.durationMin) || s.durationMin <= 0) {
        return 'How long is it? A slot needs a length in minutes.';
    }
    if (s.durationMin > 8 * 60)
        return 'That is longer than eight hours — check the minutes.';
    // A held hour is one nobody may take; a booked one is an hour somebody has.
    // Asking for both is not a slot with a preference, it is two different
    // decisions, and picking either would put an hour on the board that the owner
    // did not describe. `ptEntry` reads a blocked slot as holding no place at all,
    // so the member booked into one would vanish from the board's own headcount.
    if (s.blocked && s.clientId) {
        return 'A held hour cannot also be booked to somebody. Book it, or hold it — not both.';
    }
    return null;
}
/**
 * The reason a booking write was refused, in words, or null when it is not one
 * of the two worth translating.
 *
 * Both rules belong to the database and both stay there. This renames them; it
 * does not re-implement them, because a copy of a rule held in one screen is a
 * rule two devices can defeat.
 *
 *  · 23P01. 86-no-double-booking.sql puts an exclusion constraint over BOOKED
 *    sessions per trainer, so booking a member into an hour their trainer is
 *    already taken for comes back as "conflicting key value violates exclusion
 *    constraint sessions_no_double_booking" — true, and unusable at a desk.
 *
 *  · 23503 on the client. `sessions.client_id` references `clients(id)`, not
 *    `profiles(id)`, so a person who holds a membership but has never been
 *    anybody's client here cannot be booked in. That is the schema's answer and
 *    it is a reasonable one; what it must not do is arrive as a foreign-key
 *    constraint name in front of somebody holding a telephone. The trainer's own
 *    foreign key produces the same code, so the message is checked before this
 *    claims to know which one it was.
 */
function bookingRefusalNote(error) {
    const e = (error ?? null);
    if (!e)
        return null;
    if (e.code === '23P01') {
        return 'That trainer already has a booked session overlapping this time. '
            + 'Two people cannot have the same hour with them — move one of the two first.';
    }
    if (e.code === '23503') {
        const where = `${e.message ?? ''} ${e.details ?? ''}`;
        if (/client/i.test(where)) {
            return 'That member has no client record at this gym yet, so a one-to-one cannot be booked '
                + 'to them. They get one when they accept a gym invitation or a coach adds them.';
        }
    }
    return null;
}
/**
 * Put a one-to-one on the gym's timetable.
 *
 * Returns the new id. `.select()` is not decoration: an insert that RLS
 * refuses can come back without an error under some PostgREST configurations,
 * and a create that reports success while writing nothing is worse than one
 * that fails. If the row does not come back, this throws.
 *
 * tenant_id is sent explicitly as well as being filled by
 * trg_sessions_fill_tenant, so the row is right even if the trigger is missing
 * from a database that has not run part 33.
 */
async function createPtSlot(sb, tenantId, s) {
    const blocker = slotBlocker(s);
    if (blocker)
        throw new Error(blocker);
    // A held hour is blocked and holds nobody; everything else is decided by
    // `bookingFields`, so a slot created with a member on it is the same row the
    // app's own booking would have written.
    const booking = bookingFields(s.clientId ?? null);
    const { data, error } = await sb.from('sessions').insert({
        tenant_id: tenantId,
        trainer_id: s.trainerId,
        starts_at: s.startsAt,
        duration_min: s.durationMin,
        room: s.room?.trim() ? s.room.trim() : null,
        ...(s.blocked
            ? { status: 'blocked' }
            : { status: booking.status, client_id: booking.client_id, released: booking.released }),
    }).select('id').single();
    // The original error is rethrown untouched unless it is the double-booking
    // one, whose own message is unreadable at a desk. Nothing else is reworded:
    // a message this file invented over a fault it did not recognise is how a
    // real reason stops reaching the person who could act on it.
    if (error) {
        const note = bookingRefusalNote(error);
        throw note ? new Error(note) : error;
    }
    const id = data?.id;
    if (!id)
        throw new Error('The slot was not written — nothing came back from the insert.');
    return id;
}
/**
 * Take a slot off the board.
 *
 * The delete is asked to return what it removed. A delete filtered away by RLS
 * reports no error and no rows, so checking `.error` alone would tell the owner
 * a session had been removed while it was still on the timetable. The database
 * also refuses outright (trg_sessions_block_delete_of_record) to delete a
 * session that has an outcome or has been paid; that arrives here as a real
 * error with the reason in it.
 */
async function removePtSlot(sb, sessionId) {
    const { data, error } = await sb.from('sessions').delete().eq('id', sessionId).select('id');
    if (error)
        throw error;
    if (!data || data.length === 0) {
        throw new Error('Nothing was removed. That slot may already be gone, or it may not be yours to remove.');
    }
}
/**
 * Move a slot, put it in a room, or book it to a member. Only the fields given
 * are touched.
 *
 * `clientId` is the after-the-fact half of the same thing `createPtSlot` does
 * up front — the member who rang up on Tuesday for Thursday's open hour, and
 * the member who rang back to cancel. Passing an id books it; passing null
 * opens it again. Both go through `bookingFields`, so the status and the
 * `released` flag move with the client id rather than being set by whichever
 * caller remembered to, and an unpassed `clientId` leaves all three alone.
 */
async function updatePtSlot(sb, sessionId, patch) {
    const row = {};
    if (patch.startsAt !== undefined)
        row.starts_at = patch.startsAt;
    if (patch.durationMin !== undefined)
        row.duration_min = patch.durationMin;
    if (patch.room !== undefined)
        row.room = patch.room?.trim() ? patch.room.trim() : null;
    if (patch.clientId !== undefined)
        Object.assign(row, bookingFields(patch.clientId));
    if (!Object.keys(row).length)
        return;
    const { data, error } = await sb.from('sessions').update(row).eq('id', sessionId).select('id');
    if (error) {
        const note = bookingRefusalNote(error);
        throw note ? new Error(note) : error;
    }
    if (!data || data.length === 0) {
        throw new Error('Nothing was changed — that slot may no longer exist, or it may not be yours to change.');
    }
}
/** The gym's trainers, for the "who is taking it" picker. Names come from
 *  profiles for the same reason they do in fetchPtSlots. */
async function fetchTrainerOptions(sb, tenantId) {
    const { data, error } = await sb
        .from('trainers').select('id').eq('tenant_id', tenantId).limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    // A gym with a thousand trainers is not a gym, so this cap will not fire on
    // real data — which is why it is here. If it ever does, the tenant filter has
    // been lost in an edit, and the failure without a guard is a coach picker
    // offering every trainer on the platform to a gym owner about to attach one
    // of them to a class. A read that refuses is recoverable; that is not.
    const ids = (0, rowCap_1.assertWhole)(data, "this gym's trainers").map((r) => r.id);
    if (!ids.length)
        return [];
    // Chunked for the same reason as fetchPtSlots above. The paragraph over the
    // `trainers` read argues that a thousand trainers is not a gym, and that is
    // true of the ROW count — it is not a bound on the request line, because
    // `capLimit()` is the only thing standing between this list and a thousand
    // uuids, and the 414 that a thousand would earn comes back as `data: null`:
    // a picker with no trainers in it, on the screen that attaches one to a
    // class.
    const names = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        const { data: profs, error: nameErr } = await sb
            .from('profiles').select('id, full_name').in('id', chunk);
        if (nameErr)
            throw nameErr;
        (profs ?? []).forEach((p) => names.set(p.id, (p.full_name || '').trim()));
    }
    return ids
        .map((id) => ({ id, name: names.get(id) || null }))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}
