"use strict";
// What to do with a write that did not land.
//
// ── The gap this fills, next to wellnessSync.ts ────────────────────────────
//
// `src/lib/wellnessSync.ts` already answers "how do the device's rows and the
// server's rows become one list" — a set union keyed on id, with a pending
// subset that still has to go up. Three stores use it and it is not repeated
// here.
//
// It does not answer the two questions that come immediately after, and both
// of them have to be answered before anything is queued at all:
//
//   1. Did the write fail because the server said NO, or because nobody was
//      listening? Those are not the same event and they cannot get the same
//      treatment. A row the server refused — a CHECK constraint, an RLS policy,
//      a duplicate key — will be refused every time it is offered, so keeping
//      it in the queue means retrying it on every launch for the rest of the
//      install's life, and (worse) showing it to the client as "1 waiting to
//      send" forever. A row that never reached a server is the whole reason
//      this file exists and must be kept.
//
//      The evidence is right there and was being thrown away: supabase-js
//      RESOLVES with `error` set for a database refusal and hands back a
//      transport failure with no SQLSTATE at all. `via: 'ai'` in the food log
//      was exactly this — every insert from the description box was refused by
//      a CHECK constraint, indistinguishably from being offline.
//
//   2. Is a cached pending row still about the day it is being merged into?
//      The food log reads one client, one day. A meal logged in a basement gym
//      on Tuesday night, never sent, would come back out of the cache on
//      Wednesday morning and be merged into Wednesday's list — where it eats
//      Wednesday's remaining calories, which is the one number that screen
//      exists to show. It has to be sent under its own timestamp and it must
//      not be counted against a day it did not happen on.
//
// ── The rule none of this may break ────────────────────────────────────────
//
// A read that failed and a read that came back empty are different answers and
// stay different answers all the way through. `serverRows` below is that
// distinction written down once, because it is the argument `mergeLog` takes
// and getting it wrong there deletes a client's offline log the first time
// their signal drops. See src/ui/loadStatus.ts for the vocabulary and
// src/lib/wellnessSync.ts for what the merge does with each.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFlushing = exports.flusherCount = exports.todayKey = void 0;
exports.classifyWrite = classifyWrite;
exports.serverRows = serverRows;
exports.dayOf = dayOf;
exports.msUntilNextLocalDay = msUntilNextLocalDay;
exports.forDay = forDay;
exports.staleForDay = staleForDay;
exports.unsentCount = unsentCount;
exports.unsentNote = unsentNote;
exports.registerFlush = registerFlush;
exports.flushAll = flushAll;
exports.resetFlushers = resetFlushers;
/**
 * HTTP statuses that are a refusal in name only.
 *
 * 408 is a timeout — something between here and the database gave up, and the
 * row may or may not have been written, which is not a reason to throw it away.
 * 425 is "too early", a retry instruction in its own right. 429 is a rate
 * limit, which is the server saying "later", the one word this queue is built
 * to hear. Everything else in 400..499 is the server having read the row and
 * declined it on its merits.
 *
 * Only 4xx codes belong in here. 504 sat in this set doing nothing: a gateway
 * timeout is not below 500, so it already falls past the range check to the
 * same answer. The mutation run flagged it as inert — a constant that cannot
 * change an outcome is a line every later reader has to work that out about.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429]);
/**
 * SQLSTATEs that are a refusal of THIS row rather than of the connection.
 *
 * Class 08 (connection exception) and 57 (operator intervention — 57014 is a
 * statement timeout, 57P01 an admin shutdown) are the database being
 * unavailable, not the row being wrong. Retried.
 *
 * Everything else with a SQLSTATE means Postgres parsed the statement and
 * rejected it: 42501 is RLS, 23514 a CHECK, 23505 a unique index, 23503 a
 * foreign key. Offering the same bytes again cannot change any of those
 * answers.
 */
const RETRYABLE_SQLSTATE_CLASS = new Set(['08', '57']);
/** True when the error carries evidence that a server read the row and said no. */
function isRefusal(e) {
    const status = typeof e.status === 'number' ? e.status : null;
    if (status !== null) {
        if (RETRYABLE_STATUS.has(status))
            return false;
        if (status >= 400 && status < 500)
            return true;
        // 5xx: the server exists but did not get to an answer about this row.
        return false;
    }
    const code = typeof e.code === 'string' ? e.code.trim() : '';
    // No code and no status is a fetch that never completed. supabase-js reports
    // those with a message and nothing else — "Network request failed",
    // "TypeError: Failed to fetch" — and treating that as a refusal is how an
    // offline gym silently discards everything typed in it.
    if (!code)
        return false;
    // PostgREST's own codes (PGRST116 "no rows", PGRST301 "JWT expired") are the
    // server answering. An expired token is a real refusal of this attempt, and
    // the retry that matters there is the next launch, which signs in again —
    // exactly what an 'unsent' row gets. So JWT errors are deliberately NOT
    // refusals; everything else PostgREST says about the row is.
    if (code.startsWith('PGRST'))
        return code !== 'PGRST301' && code !== 'PGRST302';
    if (/^\d\d/.test(code))
        return !RETRYABLE_SQLSTATE_CLASS.has(code.slice(0, 2));
    // An unrecognised code shape. Not evidence of a refusal, and the safe side of
    // this line is the one that keeps the client's row.
    return false;
}
/**
 * The outcome of a write, from what supabase-js handed back.
 *
 * `rows` is the number of rows the write RETURNED, which means every caller has
 * to ask for them — `.select()` on the insert, `.select('id')` on the delete.
 * That is not ceremony. A write PostgREST narrows to zero rows under RLS does
 * not fail: it succeeds, having done nothing, with `error` null. Checking only
 * `error` reports that as stored, and the row is gone with the process.
 *
 * `rows: null` means the request did not produce an answer at all — the caller
 * caught a throw. That is the offline case and it is the only one that queues
 * by default.
 */
function classifyWrite(error, rows) {
    if (error)
        return isRefusal(error) ? 'refused' : 'unsent';
    if (rows === null)
        return 'unsent';
    // No error and no rows back: the statement ran and touched nothing. There is
    // no version of that which means "stored".
    if (rows <= 0)
        return 'refused';
    return 'stored';
}
/**
 * The `server` argument `mergeLog` wants, from a read's two halves.
 *
 * null when the read failed — NOTHING was learnt, and the device's copy is all
 * there is. An array when the read succeeded, INCLUDING when it is empty, in
 * which case the server genuinely holds nothing and its answer is authoritative
 * over any local row that carries a server id.
 *
 * One line, in one place, because the two ways of writing it inline —
 * `data ?? []` and `error ? null : data` — differ by one character and by a
 * client's whole offline log. The first is the bug scripts/check-reads.mjs was
 * written to catch, arriving through the merge instead of through the status.
 */
function serverRows(error, rows) {
    if (error)
        return null;
    return rows ?? [];
}
/**
 * The local calendar day an instant falls on, as `YYYY-MM-DD`.
 *
 * Local, not UTC. A meal eaten at 9pm in Los Angeles is that day's dinner and
 * not the next morning's, and `toISOString().slice(0, 10)` says otherwise for
 * every client west of Greenwich — the same trap src/lib/localDate.ts documents
 * for date-only columns, from the other direction.
 */
function dayOf(at, now = new Date()) {
    const t = Date.parse(at);
    const d = isFinite(t) ? new Date(t) : now;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Today, in the same format. */
const todayKey = (now = new Date()) => dayOf(now.toISOString(), now);
exports.todayKey = todayKey;
/**
 * How long until the local day rolls over, in milliseconds.
 *
 * ── Why a screen needs this ───────────────────────────────────────────────
 *
 * `todayKey()` read once into a `useMemo` with an empty dependency array is
 * fixed for the life of the MOUNT, and a phone app screen is not remounted by
 * being backgrounded. app/(trainer)/credentials.tsx judged every expiry against
 * it: a coach who opened that screen on Sunday and came back to it on Wednesday
 * was told their public liability insurance was current, two days after it ran
 * out. Everything else on that screen is scrupulous about not saying more than
 * it knows.
 *
 * LOCAL midnight, computed by rolling the date forward and zeroing the clock
 * rather than by adding 24 hours — the two are 23 or 25 hours apart across a
 * daylight-saving boundary, and a screen that woke an hour late on the last
 * Sunday in October would spend that hour stating yesterday.
 *
 * Never zero or negative: a timer scheduled at 0 fires immediately and reads
 * the same day back, which is a loop rather than a refresh.
 */
function msUntilNextLocalDay(now = new Date()) {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const ms = next.getTime() - now.getTime();
    return ms > 0 ? ms : 1;
}
/**
 * The cached entries that belong to `day`.
 *
 * For a store that reads one day at a time. Yesterday's unsent meal is still
 * real and still has to be sent, but it is not part of today's total and must
 * never be merged into today's list — see `staleForDay` for the half of this
 * that does not get dropped on the floor.
 */
function forDay(entries, day, now = new Date()) {
    return entries.filter((e) => dayOf(e.at, now) === day);
}
/**
 * The unsent entries from OTHER days — the ones that still have to go up even
 * though they are not on today's screen.
 *
 * Returned rather than discarded because dropping them is the work loss this
 * whole file exists to prevent, and keeping them in the day's list is the
 * wrong figure on the one screen where a wrong figure gets eaten. They are
 * sent, and then they are gone from the cache because the server has them.
 */
function staleForDay(entries, day, isUnsent, now = new Date()) {
    return entries.filter((e) => dayOf(e.at, now) !== day && isUnsent(e.id));
}
/**
 * How many of these have not reached the server.
 *
 * Derived from the list every time rather than kept in its own state, for the
 * reason wellness.tsx gives: a count stored alongside the thing it counts is a
 * second answer to the same question, and the two drift.
 */
function unsentCount(ids, isUnsent) {
    return ids.reduce((n, id) => n + (isUnsent(id) ? 1 : 0), 0);
}
/**
 * The sentence to put in front of somebody about `n` unsent rows.
 *
 * Here rather than in three screens because the thing being said is delicate:
 * it has to be clear that the work is NOT lost (it is on the phone, it is
 * counted, it will go) without implying it has been delivered to anyone. A
 * client whose check-in is sitting in this queue must not believe their coach
 * has read it.
 *
 * Returns null for zero, so a caller can render it or not without a second
 * condition — and so nothing draws an empty banner saying nothing is wrong.
 */
function unsentNote(n, noun, nounPlural = `${noun}s`) {
    if (n <= 0)
        return null;
    return `${n} ${n === 1 ? noun : nounPlural} saved on this phone and not sent yet — ${n === 1 ? 'it goes' : 'they go'} up next time you have signal.`;
}
const flushers = new Map();
/**
 * Register this provider's send-what-is-waiting function.
 *
 * Keyed, and the key replaces rather than accumulates. Providers register from
 * an effect, and an effect that re-runs — a new auth revision, a reload tick —
 * would otherwise leave a closure over the previous account's uid in the
 * registry, quietly sending the wrong person's queue on the next reconnect.
 *
 * Returns an unregister, which is deliberately a no-op if this key has already
 * been taken over by a later registration: unmount order is not something the
 * caller controls, and an unmount must never delete a live registration.
 */
function registerFlush(key, fn) {
    flushers.set(key, fn);
    return () => { if (flushers.get(key) === fn)
        flushers.delete(key); };
}
/** How many providers currently have something registered. For the test, and
 *  for a diagnostics screen; nothing branches on it. */
const flusherCount = () => flushers.size;
exports.flusherCount = flusherCount;
let running = null;
let askedAgain = false;
/**
 * Run every registered flush, once.
 *
 * SINGLE FLIGHT, and this is the part that has to be right. The two triggers
 * fire together all the time — coming back to the foreground is usually also
 * the moment the first request succeeds and the reconnect edge fires — and two
 * concurrent flushes of the same queue is how one workout becomes two rows.
 * A call made while one is in flight does not start a second and does not get
 * dropped either: it sets `askedAgain`, and one more pass runs when the current
 * one finishes, because the state that prompted it may have arrived after that
 * provider had already read its queue.
 *
 * Resolves with the number of flushers that were run in the final pass.
 */
function flushAll() {
    if (running) {
        askedAgain = true;
        return running;
    }
    // The latch is taken BEFORE the work starts, not after. An async function
    // body runs synchronously up to its first await, and the first await here is
    // the call to a provider's flusher — so assigning `running` from the result
    // of the IIFE would leave a window in which a flusher that reaches back into
    // flushAll starts a second pass over the same queues.
    let settle = () => { };
    const pass = new Promise((res) => { settle = res; });
    running = pass;
    void (async () => {
        let ran = 0;
        do {
            askedAgain = false;
            // A snapshot, so a provider registering mid-flush is picked up by the
            // next pass rather than being called while this list is being walked.
            const batch = [...flushers.values()];
            ran = batch.length;
            for (const fn of batch) {
                // Serial, not Promise.all. These are network writes from a device that
                // has just got its signal back, and the failure mode of firing eight
                // of them at once on returning wifi is half of them timing out and
                // going back into the queue they came from.
                try {
                    await fn();
                }
                catch { /* this provider keeps its own rows; the rest still go */ }
            }
        } while (askedAgain);
        // Cleared before the promise resolves, so a caller that chains another
        // flush onto this one gets a fresh pass rather than this same settled
        // promise handed straight back.
        if (running === pass)
            running = null;
        settle(ran);
    })();
    return pass;
}
/** True while a flush is in flight. A screen may show "sending" off this; no
 *  logic branches on it, because the answer that matters is the count of
 *  unsent rows and that is derived from the rows themselves. */
const isFlushing = () => running !== null;
exports.isFlushing = isFlushing;
/** Drop every registration. Tests only — an app that called this would go
 *  quiet until every provider happened to re-register. */
function resetFlushers() { flushers.clear(); running = null; askedAgain = false; }
