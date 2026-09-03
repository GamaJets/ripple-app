"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERSISTED_FIELDS = exports.entryToRow = exports.rowToEntry = void 0;
const rowToEntry = (r) => ({
    id: r.id,
    t: r.performed_at,
    exercise: r.exercise,
    sets: r.sets ?? undefined,
    bw: r.bw ?? undefined,
    timed: r.timed ?? undefined,
    feel: r.feel ?? undefined,
    cardio: r.cardio ?? undefined,
    kcal: r.kcal ?? undefined,
    zones: r.zones ?? undefined,
    sessionMins: r.session_mins ?? undefined,
    loggedBy: r.logged_by ?? undefined,
    amendedAt: r.amended_at ?? undefined,
});
exports.rowToEntry = rowToEntry;
const entryToRow = (uid, e) => ({
    user_id: uid,
    performed_at: e.t,
    exercise: e.exercise,
    sets: e.sets ?? null,
    bw: e.bw ?? null,
    timed: e.timed ?? null,
    feel: e.feel ?? null,
    cardio: e.cardio ?? null,
    kcal: e.kcal ?? null,
    zones: e.zones ?? null,
    session_mins: e.sessionMins ?? null,
    // No amended_at: the trigger owns it. Writing it from here would let a client
    // decide whether their own edit left a mark, which is the point of the mark.
    logged_by: e.loggedBy ?? null,
});
exports.entryToRow = entryToRow;
/** Every field of an entry that is meant to survive a trip to the database.
 *  `id` is excluded: the server assigns it, so a new entry has none yet. */
exports.PERSISTED_FIELDS = ['t', 'exercise', 'sets', 'bw', 'timed', 'feel', 'cardio', 'kcal', 'zones', 'sessionMins', 'loggedBy'];
// `amendedAt` is deliberately absent, for the same reason `id` is: the server
// assigns it. It comes back on the way in and is never sent on the way out.
