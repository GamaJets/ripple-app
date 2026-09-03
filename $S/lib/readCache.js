"use strict";
// The last thing this phone knew, for the screens a member opens in a basement.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// Four providers held nothing on the device at all: the class timetable, PT
// sessions, attendance and the message thread. Nor did membership, receipts or
// packages. A member standing inside the building their membership is for, in
// the basement weights room where there is no signal, could not see the class
// they had booked, the PT slot they were about to attend, or the fact that they
// are a member.
//
// Every one of those reads already does the right thing with a failure —
// src/ui/loadStatus.ts, 'error', do not claim the list is empty. What they had
// nothing to fall back ON was a copy of the last successful answer.
//
// ── The two rules this file exists to hold ────────────────────────────────
//
// 1. A CACHE THAT COULD NOT BE READ IS NOT AN EMPTY CACHE. `rows: null` and
//    `rows: []` are different answers and stay different all the way through,
//    exactly as src/lib/offlineQueue.ts · `serverRows` insists for a network
//    read. A caller that collapses them shows "no classes are scheduled" off a
//    corrupt file.
//
// 2. A CACHED LIST IS NOT A CURRENT LIST. Serving one does NOT make the status
//    'ready'. The house rule is that under 'error' a non-empty list is whatever
//    we had before the failure and is not confirmed current — that is precisely
//    what this is, and `cachedAtLine` is the sentence that says so on screen.
//    A timetable from Tuesday rendered as today's timetable, silently, is worse
//    than an empty screen: the member goes to the gym for a class that was
//    cancelled.
//
// Nothing here touches AsyncStorage. It is pure so the tests can hold both ends
// of every rule, and so that a provider keeps deciding for itself what is worth
// keeping — see how narrow each caller's slice is.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HORIZON_MS = exports.cacheKey = exports.CACHE_PREFIX = void 0;
exports.packCache = packCache;
exports.readCache = readCache;
exports.withinHorizon = withinHorizon;
exports.cachedAtLine = cachedAtLine;
/** Where one account's copy of one read lives. Scoped by BOTH, because two
 *  people share a phone and two reads share an account. */
exports.CACHE_PREFIX = 'rc:v1:';
const cacheKey = (scope, uid) => `${exports.CACHE_PREFIX}${scope}:${uid}`;
exports.cacheKey = cacheKey;
/** What to write. A version marker is deliberately absent: the key carries one
 *  (`rc:v1:`), so a shape change is a new key and the old bytes are simply
 *  never read again rather than being migrated by code nobody can test. */
function packCache(rows, at = new Date().toISOString()) {
    return JSON.stringify({ rows, at });
}
/**
 * What is on the device.
 *
 * `rows: null` means we learnt nothing — the key was never written, or the
 * bytes could not be parsed, or they were not the shape this file writes. Only
 * an array that actually parsed comes back as rows, including an empty one:
 * a read that genuinely returned nothing is a real answer worth caching, and
 * the difference between it and a failure is the whole subject of this file.
 *
 * `at` is null whenever `rows` is, and is only ever a string that was written
 * here. A caller must not print it without going through `cachedAtLine`, which
 * refuses to say anything about a stamp it cannot read.
 */
function readCache(raw) {
    if (raw == null)
        return { rows: null, at: null };
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rows))
            return { rows: null, at: null };
        const at = typeof parsed.at === 'string' ? parsed.at : null;
        return { rows: parsed.rows, at };
    }
    catch {
        return { rows: null, at: null };
    }
}
/** A week. The default horizon past which a cached answer stops being worth
 *  showing at all: a timetable, a booking list or a balance from last month is
 *  not "slightly stale", it is a different situation. Callers may pass their
 *  own — a payment history ages far more gracefully than a class list. */
exports.DEFAULT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Is this copy recent enough to put on screen?
 *
 * False for a stamp that cannot be read, which is the conservative direction:
 * without a stamp there is no way to label the list, and an unlabelled stale
 * list is the failure this file is here to prevent.
 */
function withinHorizon(at, now = Date.now(), horizonMs = exports.DEFAULT_HORIZON_MS) {
    if (!at)
        return false;
    const t = Date.parse(at);
    if (!Number.isFinite(t))
        return false;
    // A stamp in the future is a phone whose clock has been changed. Treated as
    // fresh rather than as invalid: the alternative throws away the member's only
    // copy over a timezone the app did not set.
    if (t > now)
        return true;
    return now - t <= horizonMs;
}
/**
 * How old the thing on screen is, in words.
 *
 * The label is not decoration. It is the whole of rule 2: a member looking at a
 * cached timetable has to be able to tell it apart from a live one, or they
 * will turn up to a class that was cancelled yesterday. Returns null when there
 * is no readable stamp — a sentence about an unknown age would be worse than
 * nothing, and the caller then has the choice to show the list unlabelled or
 * not at all.
 *
 * Sentence case, no value that can render as a dash, so it is safe next to any
 * heading.
 */
function cachedAtLine(at, now = Date.now()) {
    if (!at)
        return null;
    const t = Date.parse(at);
    if (!Number.isFinite(t))
        return null;
    const mins = Math.floor((now - t) / 60000);
    if (mins < 0)
        return 'Saved on this phone. Not confirmed with us just now.';
    if (mins < 2)
        return 'Saved on this phone a moment ago. Not confirmed with us just now.';
    if (mins < 60)
        return `Saved on this phone ${mins} minutes ago. Not confirmed with us just now.`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return `Saved on this phone ${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago. Not confirmed with us just now.`;
    const days = Math.floor(hrs / 24);
    return `Saved on this phone ${days} ${days === 1 ? 'day' : 'days'} ago. Not confirmed with us just now.`;
}
