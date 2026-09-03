"use strict";
// Looking rows up BY a list of ids, when the list is no longer small.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Half a dozen reads in this codebase have the same second half: fetch a set of
// rows, collect the ids off them, and go and get the names — `namesFor`,
// `planNamesFor`, the ledger check inside `fetchOnlineOrders`, the local
// `namesFor` on /accounting and /close. Every one of them is a single
// `.in('id', unique)`.
//
// That was safe only because the read above it refused past a thousand rows.
// A thousand rows can carry at most a thousand distinct ids, PostgREST answers
// a thousand-row request with a thousand rows, and the lookup could not
// truncate. The refusal was holding the lookup up.
//
// Once the read above pages (src/lib/rowCap.ts, `readAll`) that prop is gone,
// and a bare `.in()` behind it fails in BOTH the ways this codebase cares
// about, silently:
//
//  · it truncates. Ten thousand payments carry more than a thousand distinct
//    members, PostgREST returns the first thousand names and says nothing, and
//    every member past that renders as a dash. A screen showing dashes for two
//    thirds of its rows is not obviously broken — it looks like a gym that
//    never recorded the names.
//  · it 414s. A uuid costs about 39 bytes inside an `in.(…)` list, so ten
//    thousand of them is a 390KB query string. Proxies refuse those well
//    before then, and the failure arrives as an opaque HTTP error nowhere near
//    the code that caused it.
//
// So the list is CHUNKED, small enough that neither can happen, and each chunk
// is finished with `readAll` rather than assumed to fit. Chunks are small
// enough that a chunk is normally one round trip; `readAll` is there for the
// lookups whose key is not unique — `gym_payments.gym_order_id` is a foreign
// key, so one order can be answered by several payments and a chunk of 150 ids
// can legitimately return more than 150 rows.
//
// ── What it does NOT do ────────────────────────────────────────────────────
//
// It does not decide what a missing row means. Fewer rows back than ids sent is
// the ordinary case — RLS scopes `profiles` to the owner's own gym, so ids
// outside it simply do not come back — and every caller already has its own
// honest answer for that (a dash, a retained label). This only guarantees that
// a row which WAS readable is not missing because of how it was asked for.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ID_CHUNK = void 0;
exports.uniqueIds = uniqueIds;
exports.chunkIds = chunkIds;
exports.readByIds = readByIds;
const rowCap_1 = require("./rowCap");
/**
 * How many ids go into one `.in()`.
 *
 * A uuid inside a PostgREST `in.("…","…")` list costs 39 bytes with its quotes
 * and comma, so 150 is about 5.9KB of query string — comfortably inside the
 * 8KB total-request-line limit that nginx and most CDNs enforce by default,
 * with room for the table, the select list and the tenant filter beside it.
 *
 * Not larger, because the cost of being wrong is asymmetric: too small is extra
 * round trips on a screen that already waits for a paged read, and too large is
 * a 414 that only appears on the biggest gyms.
 *
 * 150 rather than a fresh number: /export, /members and /retention had each
 * arrived at it independently, and the point of moving the loop here is that
 * there is now one of it to disagree with.
 */
exports.ID_CHUNK = 150;
/** The ids, deduplicated, with the empty ones dropped, in the order first seen.
 *
 *  Order is kept rather than sorted so a caller that wants to reason about
 *  which chunk an id landed in — in a test, mostly — can. */
function uniqueIds(ids) {
    const seen = new Set();
    const out = [];
    for (const id of ids) {
        if (!id)
            continue;
        if (seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}
/** The ids split into `.in()`-sized batches. Empty in, empty out — never one
 *  empty chunk, which would send a pointless `in.()` and match nothing. */
function chunkIds(ids, size = exports.ID_CHUNK) {
    const step = Math.max(1, Math.floor(size));
    const out = [];
    for (let i = 0; i < ids.length; i += step)
        out.push(ids.slice(i, i + step));
    return out;
}
/**
 * Every row matching any of `ids`, however many ids there are.
 *
 * `page` is handed one chunk of ids and a `.range()` window, exactly as
 * `readAll` hands one out, and must apply a TOTAL order — the same contract and
 * for the same reason (see src/lib/rowCap.ts). `.order('id')` on a primary-key
 * lookup is total; ordering on the foreign key alone is not.
 *
 * `what` is a plain-English noun phrase, because a `TruncatedRead` out of here
 * can reach a gym owner's screen.
 *
 * Chunks are read in sequence rather than all at once. A gym large enough to
 * need several is a gym whose earlier reads were already several pages, and
 * forty simultaneous requests from one tab is how a browser starts queueing
 * them anyway — with the difference that a sequence stops at the first error
 * instead of raising forty.
 */
async function readByIds(ids, page, what, opts = {}) {
    const unique = uniqueIds(ids);
    if (!unique.length)
        return [];
    const out = [];
    for (const chunk of chunkIds(unique, opts.chunk ?? exports.ID_CHUNK)) {
        const rows = await (0, rowCap_1.readAll)((from, to) => page(chunk, from, to), what);
        for (const r of rows)
            out.push(r);
    }
    return out;
}
