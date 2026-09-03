"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.byNewest = exports.sessionKey = exports.serverId = exports.isQueued = exports.queueCacheKey = void 0;
exports.readQueue = readQueue;
exports.toQueueRows = toQueueRows;
exports.adoptIds = adoptIds;
exports.dropRefused = dropRefused;
exports.withoutStored = withoutStored;
exports.queuedSessions = queuedSessions;
const workoutRow_1 = require("./workoutRow");
const wellnessSync_1 = require("./wellnessSync");
/** Where one account's unsent workouts live on the device.
 *
 *  Per-account, and that is not tidiness. A gym's front-desk phone is signed in
 *  and out of all day; a queue shared across accounts would push one member's
 *  unsent session up under the next member's name, which is the one failure a
 *  queue can produce that is worse than losing the session. */
const queueCacheKey = (uid) => `repple.workouts:${uid}`;
exports.queueCacheKey = queueCacheKey;
/**
 * True for an entry the server has never accepted.
 *
 * An entry with NO id at all counts as queued. That is not a fallback: it is an
 * entry from a build that predates this queue, or from one with no backend, and
 * in neither case has anything stored it. Treating "no id" as "stored" is the
 * assumption that would make an unsent session invisible to the count, to the
 * cache and to the retry all at once.
 */
const isQueued = (e) => !e.id || (0, wellnessSync_1.isPending)(e.id);
exports.isQueued = isQueued;
/**
 * The primary key, when there is a real one.
 *
 * A `local:` id is this device's invention. Naming it in a `.eq('id', …)`
 * matches nothing — which PostgREST reports as a SUCCESSFUL statement that
 * changed no rows, the exact shape of failure the row counts in the provider
 * exist to catch, and the reason this returns null rather than the string.
 */
const serverId = (e) => (e.id && !(0, wellnessSync_1.isPending)(e.id) ? e.id : null);
exports.serverId = serverId;
/**
 * What identifies an entry inside a session without an id.
 *
 * One session writes every exercise under the same `performed_at` (see
 * `WorkoutEntry.id`), so the pair (timestamp, exercise) is unique within one —
 * which is what a queued entry and the row that finally comes back for it have
 * in common. Matching on the id instead is impossible in that direction: the
 * server has never seen the local one.
 */
const sessionKey = (e) => `${e.t}|${e.exercise}`;
exports.sessionKey = sessionKey;
/**
 * Newest first, with a deterministic tie-break.
 *
 * The same rule as `byNewest` in src/lib/wellnessSync.ts, on this shape's own
 * fields. A queued entry and a stored one can share a timestamp — a session
 * half-sent is exactly that — and a comparator returning 0 there leaves their
 * order to whichever sort the runtime happens to use, so the list can reorder
 * itself between renders for no visible reason.
 *
 * It also matches the server read's own `performed_at desc, id desc`, which is
 * what keeps a re-sorted list identical to the one every screen has always been
 * handed. An entry with no id sorts last within its instant, which is where an
 * unidentified row belongs.
 */
const byNewest = (a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0)
    || ((a.id ?? '') < (b.id ?? '') ? 1 : (a.id ?? '') > (b.id ?? '') ? -1 : 0);
exports.byNewest = byNewest;
/**
 * The queue, from whatever was on disk.
 *
 * Three inputs and only two of them are answers:
 *
 *   null / '' — nothing has ever been queued for this account. A real answer,
 *               and the ordinary one. `read` is true.
 *   valid JSON array — the queue. `read` is true, even when the array is empty:
 *               a queue that was written empty IS empty.
 *   anything else — unparseable, or parseable but not an array. NOT an answer.
 *               `read` is false, and the caller must latch its cache off.
 *
 * That last line is the one that matters, and it is a data-loss bug rather than
 * a display one. A caller that treats a corrupt cache as an empty queue will
 * serialise its current list — which cannot contain the entries it just failed
 * to read — straight back over the top of them on the very next write. One
 * truncated write during a crash would take every unsent session on the phone
 * with it, permanently, and nothing anywhere would report anything.
 *
 * Rows are parsed through `rowToEntry`, the same converter the database's rows
 * go through, so the cache cannot grow a third opinion about the column names.
 * Anything that comes back already carrying a SERVER id is dropped: it is in
 * the log, the queue is not a history, and re-sending it is how one session
 * becomes two.
 */
function readQueue(raw) {
    if (raw == null || raw === '')
        return { entries: [], read: true };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { entries: [], read: false };
    }
    if (!Array.isArray(parsed))
        return { entries: [], read: false };
    const entries = [];
    for (const r of parsed) {
        // A row that is not an object at all, or has no `performed_at` and no
        // `exercise`, cannot be sent and cannot be shown. Skipped one at a time
        // rather than failing the whole read, because one bad element is not
        // evidence that the other nine are unreadable — and `read` staying true is
        // what lets the good nine be rewritten without the bad one.
        if (!r || typeof r !== 'object')
            continue;
        const row = r;
        if (typeof row.performed_at !== 'string' || typeof row.exercise !== 'string')
            continue;
        const e = (0, workoutRow_1.rowToEntry)(row);
        if ((0, exports.isQueued)(e))
            entries.push(e);
    }
    return { entries, read: true };
}
/**
 * What to write back: the queued entries and nothing else.
 *
 * Not the history. The server holds that, the provider's read of it is capped
 * at a thousand rows, and a second copy here would be a large write on every
 * set logged for no gain — the thing that has to survive a relaunch is the work
 * the server has never heard of.
 *
 * Serialised through `entryToRow`, so the cache round-trips through the same
 * tested converter as the database and any column added to one side is added to
 * both. The local id is put back on top afterwards because `entryToRow`
 * deliberately drops `id` — the server assigns it — and here it is the only
 * thing distinguishing one queued entry from another.
 */
function toQueueRows(uid, list) {
    return list.filter(exports.isQueued).map((e) => ({ ...(0, workoutRow_1.entryToRow)(uid, e), id: e.id }));
}
/**
 * Give the queued entries the ids the server just assigned them.
 *
 * Only the id is taken, deliberately. The server's `performed_at` is the same
 * instant written back in the database's own rendering of it, and a session is
 * grouped, drafted and timed by that exact string everywhere above this file —
 * `setSessionMins` matches sessions on it — so adopting the server's spelling
 * of it would re-cut the session the member is looking at. The id is the one
 * field this device could not have known.
 *
 * Entries that are already stored are untouched even if a row matches their
 * key: their id is the server's answer already, and overwriting it with the id
 * of a DIFFERENT row that happens to share a timestamp and an exercise name
 * would repoint an edit at somebody else's set.
 */
function adoptIds(list, rows) {
    const byKey = new Map();
    for (const r of rows) {
        if (!r || typeof r.id !== 'string' || !r.id)
            continue;
        if (typeof r.performed_at !== 'string' || typeof r.exercise !== 'string')
            continue;
        byKey.set((0, exports.sessionKey)({ t: r.performed_at, exercise: r.exercise }), r.id);
    }
    if (!byKey.size)
        return list;
    return list.map((e) => {
        if (!(0, exports.isQueued)(e))
            return e;
        const id = byKey.get((0, exports.sessionKey)(e));
        return id ? { ...e, id } : e;
    });
}
/**
 * Take refused entries back out of the list.
 *
 * A row the server read and declined will be declined every time it is offered
 * — a CHECK constraint, an RLS policy, a duplicate key — so keeping it means
 * retrying it on every launch for the rest of the install's life and showing
 * the member "3 waiting to send" forever. src/lib/offlineQueue.ts makes that
 * argument at length; this is the half of it that touches the list.
 *
 * Matched on (timestamp, exercise) and NOT on the id. An entry that reached a
 * refusal without an id is exactly the entry an `id`-keyed drop would take
 * every other id-less row down with — and those other rows are somebody's
 * unsent sessions.
 *
 * Only queued entries can be dropped. A stored row sharing a key with a refused
 * one is a real row on the server, and removing it from the list would show a
 * member a history with a hole in it that comes back at the next launch.
 */
function dropRefused(list, refused) {
    if (!refused.length)
        return list;
    const gone = new Set(refused.map(exports.sessionKey));
    return list.filter((e) => !((0, exports.isQueued)(e) && gone.has((0, exports.sessionKey)(e))));
}
/**
 * Drop queued entries the server turns out to already hold.
 *
 * The failure this closes is at-least-once delivery, and it is not exotic: the
 * insert reaches Postgres, the rows are written, and the RESPONSE is lost on
 * the way back — a tunnel, a dropped 4G handover, the app backgrounded mid
 * request. `classifyWrite` sees no answer and correctly calls that 'unsent', so
 * the entries stay queued. Without this line the next launch then reads the
 * server's copy AND keeps the queued one, showing the session twice, and then
 * sends the queued one again — three rows for one workout, and no way for
 * anybody to tell which is real.
 *
 * Matched on (timestamp, exercise), which is the same triple `matchRow` in
 * src/ui/workoutLog.tsx already treats as identifying one row for an update or
 * a delete. This is not a new assumption about the data; it is that assumption
 * applied on the way in as well as on the way out.
 */
function withoutStored(queued, stored) {
    if (!queued.length || !stored.length)
        return [...queued];
    const held = new Set(stored.filter((e) => !(0, exports.isQueued)(e)).map(exports.sessionKey));
    return queued.filter((e) => !held.has((0, exports.sessionKey)(e)));
}
/**
 * The distinct session timestamps in a list, oldest first.
 *
 * A queue is drained one SESSION at a time, not one entry at a time: a session
 * is the unit a member thinks in, and eight round trips on the wifi that just
 * came back is eight chances for half a push day to land. Oldest first because
 * that is the order they happened in, and a queue that drains newest-first
 * leaves the oldest work waiting longest for no reason.
 */
function queuedSessions(list) {
    const seen = new Set();
    for (const e of list)
        if ((0, exports.isQueued)(e))
            seen.add(e.t);
    return [...seen].sort();
}
