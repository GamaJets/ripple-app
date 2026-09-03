"use strict";
// The coach's programme, kept on the phone, for the room it is trained in.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// src/lib/readCache.ts opens by naming the member standing in the basement
// weights room with no signal, and lists the seven reads that were given a copy
// on the device for exactly that person: the timetable, PT sessions,
// attendance, the message thread, membership, receipts, packages.
//
// It does not list the thing they came to that room to do. `assigned_programs`
// — the programme their coach wrote for them — has no copy anywhere. On a cold
// launch with no signal the provider holds `{}`, `getProgram` returns null, and
// app/(client)/week.tsx reads that null through `programUnknown` and tells them
// their plan could not be read. Correct, honest, and useless: they are holding
// the phone in the room, at the time, with the bar loaded.
//
// It is also the read most obviously safe to be stale, and this is the case the
// distinction was invented for. A training block is written to run for four to
// twelve weeks. Yesterday's copy of it is not an approximation of today's — it
// is the same document. Compare a session-credit balance, which is a number
// about to be spent and is deliberately given no cache anywhere in this app.
//
// ── What is decided here ───────────────────────────────────────────────────
//
// The bytes and the labelling are src/lib/readCache.ts's, unchanged: same key
// shape, same pack, same "a cache that could not be read is not an empty
// cache". What this file adds is the three judgements that are about programmes
// specifically and that are each a way to show somebody the wrong session:
//
//   1. WHAT MAY BE WRITTEN. A truncated page must never be cached. The read is
//      `.or(client_id.eq…,coach_id.eq…)` capped at `capLimit()`, so a coach
//      with a thousand-client book gets a prefix — and a prefix cached as the
//      whole answer is a member whose programme was on the part we never read
//      being told, from the device, that they have none.
//
//   2. THAT AN EMPTY ANSWER IS AN ANSWER. A member taken off their programme
//      reads back zero rows, and that zero has to REPLACE the cache. Caching
//      only non-empty answers is how a plan a coach removed comes back from the
//      dead on the next launch in a basement, which is worse than showing
//      nothing: the member trains a block their coach has ended.
//
//   3. THAT THE CACHE NEVER BEATS A LIVE READ. It is a floor, not a source. It
//      is consulted when the read did not land and at no other time.
//
// The horizon is the fourth judgement and has its own note below.
Object.defineProperty(exports, "__esModule", { value: true });
exports.mayServeCached = exports.mayCache = exports.PROGRAM_HORIZON_MS = exports.programCacheKey = exports.PROGRAM_CACHE_SCOPE = void 0;
exports.toCachedRows = toCachedRows;
exports.packPrograms = packPrograms;
exports.readPrograms = readPrograms;
const readCache_1 = require("./readCache");
/** The read this cache is for. Scoped per account by `cacheKey`. */
exports.PROGRAM_CACHE_SCOPE = 'programs';
/** Where one account's copy lives. */
const programCacheKey = (uid) => (0, readCache_1.cacheKey)(exports.PROGRAM_CACHE_SCOPE, uid);
exports.programCacheKey = programCacheKey;
/**
 * How old a cached programme may be and still be worth drawing.
 *
 * Thirty days, against src/lib/readCache.ts's one-week default, and the longer
 * number is the argument this file most has to make.
 *
 * WHAT THE AGE ACTUALLY MEASURES. Not how old the programme is — how long it
 * has been since a read SUCCEEDED. Every successful read rewrites this, and the
 * app reads on every launch and on every recovery (src/lib/readRefresh.ts). So
 * for anybody whose phone has touched a network this month the stamp is minutes
 * old, and the horizon never comes into it. The only person it decides anything
 * for is somebody who has not been able to reach us in weeks.
 *
 * WHY THE DEFAULT IS WRONG FOR THIS ONE. The week-long default is set by what
 * it was written for — a class timetable, where a fortnight-old copy is a
 * different situation and sends somebody to a class that was cancelled. A
 * training block is not that. It is written to run for four to twelve weeks,
 * it is the same document on day thirty as on day one, and the coach who wrote
 * it expects it to be trained for its whole length. Expiring it at seven days
 * would take a member's programme away in week two of an eight-week block, and
 * hand them the generic auto-generated programme in its place — which is
 * precisely the substitution this provider's own header describes as the bug it
 * was created to stop.
 *
 * WHAT THE COST OF BEING WRONG IS. A member who has had no signal for over a
 * month, training a block their coach may have replaced. Against a member who
 * has had no signal for eight days, training nothing. The first is recoverable
 * the moment there is a bar of signal and the second is a wasted session, so
 * the number leans long.
 *
 * PAST THIRTY DAYS it stops being defensible: a coaching relationship that has
 * had no contact in a month may not be a coaching relationship, and the generic
 * programme built from the member's own profile is the better answer.
 */
exports.PROGRAM_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * The rows to cache, from the two maps the provider holds.
 *
 * Driven by `programs`, because a start date without a programme is nothing to
 * anybody: `startsOn` exists to say which week of a block is on screen, and
 * there is no block.
 *
 * Sorted by client id. The read is ordered the same way, so a device that
 * writes an unordered map produces a different file every launch for identical
 * data, which is a diff nobody can read and a write nobody needed.
 */
function toCachedRows(programs, startsOn) {
    return Object.keys(programs)
        .sort()
        .map((clientId) => ({
        clientId,
        program: programs[clientId],
        startsOn: startsOn[clientId] ?? null,
    }));
}
/** The bytes to write. Empty is a real answer and is written as one — see 2. */
function packPrograms(programs, startsOn, at) {
    return (0, readCache_1.packCache)(toCachedRows(programs, startsOn), at);
}
/**
 * May this answer be written to the device?
 *
 * Only a whole one. `truncated` is the page cap having been hit
 * (src/lib/rowCap.ts), and a prefix written as the whole answer is judgement 1
 * above. The read that produced it is still perfectly good to SHOW — it is
 * published as 'partial' and the screens gate their figures on that — it is
 * only unfit to be kept as the answer to a question asked later, when nothing
 * will remember it was a prefix.
 */
const mayCache = (truncated) => !truncated;
exports.mayCache = mayCache;
const nothing = () => ({ programs: {}, startsOn: {}, at: null, found: false });
/**
 * Read the device's copy.
 *
 * Returns `found: false` for every way of learning nothing — never written,
 * unparseable, wrong shape, out of horizon — because a caller that collapses
 * those into an empty map draws "your coach has not assigned you anything" off
 * a corrupt file. That is rule 1 of src/lib/readCache.ts, restated at the only
 * level where it can be enforced for this shape.
 *
 * A row missing its programme is dropped rather than failing the whole file: a
 * shape written by an older build should cost the member the rows it cannot
 * read, not the ones it can.
 */
function readPrograms(raw, now = Date.now(), horizonMs = exports.PROGRAM_HORIZON_MS) {
    const { rows, at } = (0, readCache_1.readCache)(raw);
    if (rows == null)
        return nothing();
    if (!(0, readCache_1.withinHorizon)(at, now, horizonMs))
        return nothing();
    const programs = {};
    const startsOn = {};
    for (const r of rows) {
        if (!r || typeof r !== 'object')
            continue;
        const id = typeof r.clientId === 'string' ? r.clientId : '';
        if (!id || !r.program || typeof r.program !== 'object')
            continue;
        programs[id] = r.program;
        if (typeof r.startsOn === 'string' && r.startsOn)
            startsOn[id] = r.startsOn;
    }
    return { programs, startsOn, at, found: true };
}
/**
 * May the device's copy be put on screen?
 *
 * Judgement 3, written as a function so the provider cannot express it any
 * other way. `live` is whether a read has landed in this session — not whether
 * the provider holds anything, because it holds optimistic writes too.
 *
 * A cached copy is drawn only where there is nothing else, and the status the
 * provider publishes is unchanged by it: under 'error' a non-empty answer is
 * "whatever we had before the failure … not confirmed current", which is what
 * src/ui/loadStatus.ts already says a non-empty 'error' means. Serving this
 * does not make anything 'ready', and a screen must not read it as though it
 * did.
 */
const mayServeCached = (live, found) => !live && found;
exports.mayServeCached = mayServeCached;
