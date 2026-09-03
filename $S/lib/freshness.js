"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_MS = void 0;
exports.agePhrase = agePhrase;
exports.isStale = isStale;
exports.fetchedNote = fetchedNote;
exports.fetchedNeedsMark = fetchedNeedsMark;
exports.oldestFetch = oldestFetch;
const gymZone_1 = require("./gymZone");
/** One minute, one hour, one day, in ms. Named so the arithmetic below reads. */
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/**
 * Past this, a figure is old enough that saying so matters more than the
 * figure. Ten minutes: short enough that a stale takings number on a desk is
 * flagged within a coffee, long enough that an owner reading a screen for two
 * minutes is not nagged about it.
 */
exports.STALE_MS = 10 * MIN;
/**
 * How long ago, in words, with no calendar in it.
 *
 * Buckets rather than a precise duration, because "read 3 minutes and 41
 * seconds ago" is a precision nobody asked for on a figure whose only question
 * is "is this current". Rounded DOWN throughout: a figure read 119 seconds ago
 * is "1 minute ago", never "2 minutes ago", because the one direction this may
 * not err in is claiming a number is older than it is — that is what sends
 * somebody to refresh a figure that was fine.
 *
 * A negative age — a clock that moved backwards between the read and the render
 * — is 'just now' rather than a negative duration. It is the only honest answer
 * available and it does not put "-3 minutes ago" on an owner's screen.
 */
function agePhrase(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < MIN)
        return 'just now';
    if (ageMs < HOUR) {
        const m = Math.floor(ageMs / MIN);
        return m === 1 ? '1 minute ago' : `${m} minutes ago`;
    }
    if (ageMs < DAY) {
        const h = Math.floor(ageMs / HOUR);
        return h === 1 ? '1 hour ago' : `${h} hours ago`;
    }
    const d = Math.floor(ageMs / DAY);
    return d === 1 ? '1 day ago' : `${d} days ago`;
}
/** Whether what is on screen is old enough to be worth marking. `null` — never
 *  read — is NOT stale: it has its own sentence, and a screen still loading
 *  must not be accused of holding an old figure. */
function isStale(at, now, ttlMs = exports.STALE_MS) {
    if (at == null)
        return false;
    return now - at >= ttlMs;
}
/**
 * The whole sentence under a screen's figures.
 *
 * Three inputs, and every combination of them has to be a true sentence:
 *
 *   · never read + offline    → the honest one nobody was writing. The screen
 *                               has nothing and cannot get anything.
 *   · never read + online     → still reading; say that, not "0".
 *   · read + offline          → THE sentence this file exists for. The figures
 *                               are real, they are from a moment in the past,
 *                               and they will not change until there is signal.
 *   · read + online/unknown   → when. On 'unknown' it must not claim either
 *                               way about the connection.
 *
 * `zone` is the gym's own IANA zone (`tenants.timezone`) and is OPTIONAL in the
 * strong sense: every caller that passes nothing gets exactly the sentence it
 * got before, and every caller that passes a zone gets the same sentence with
 * the gym's own wall clock appended. Passing the reader's zone here would be a
 * lie in the one place this file exists to stop one — see the header — so the
 * argument is documented as the GYM's and a caller with only a device zone
 * passes null.
 */
function fetchedNote(at, now, reach, zone) {
    if (at == null) {
        return reach === 'offline'
            ? 'Not read yet, and this phone cannot reach us — nothing on this screen is your gym’s.'
            : 'Reading…';
    }
    const age = agePhrase(Math.max(0, now - at));
    // Null for no zone, an unresolvable zone and an unreadable instant alike —
    // three nothings that all mean "do not put an hour on screen".
    const clock = (0, gymZone_1.gymTimeLabel)(at, zone ?? null);
    const at_ = clock ? `, at ${clock} at the gym` : '';
    if (reach === 'offline') {
        return `Offline — read ${age}${at_}. Nothing here will change until there is signal.`;
    }
    return `Read ${age}${at_}`;
}
/**
 * Whether the fetched-at line should carry a mark beside it.
 *
 * Returned as a plain flag rather than a colour, because the caller owns the
 * palette and because `src/theme/scale.ts` forbids a status colour being used
 * as TEXT colour — the mark is a 6pt dot beside ink, which is what `Flag` in
 * src/ui/kit.tsx draws.
 */
function fetchedNeedsMark(at, now, reach, ttlMs = exports.STALE_MS) {
    if (reach === 'offline')
        return true;
    return isStale(at, now, ttlMs);
}
/**
 * One stamp for a screen fed by several reads: the OLDEST of them.
 *
 * A screen that shows three providers' figures under one "Read 2 minutes ago"
 * is making a claim about all three, so the claim has to be true of the worst
 * of them. Taking the newest — which is what a single `useEffect` on whichever
 * status happened to be destructured first does — labels a figure read an hour
 * ago with the age of the one read a moment ago, which is the exact defect this
 * file exists to stop: an unlabelled figure read as current, now with a
 * confident wrong label on it instead of none.
 *
 * A source that has never come back contributes `null`, and one null makes the
 * whole thing null: `fetchedNote` then says "Reading…" rather than putting an
 * age on a screen where part of what is displayed has never been read at all.
 * Callers with a source that is genuinely optional should leave it out rather
 * than pass its null.
 *
 * No arguments at all is null for the same reason — there is nothing to be the
 * age of.
 */
function oldestFetch(...ats) {
    if (ats.length === 0)
        return null;
    let out = Infinity;
    for (const a of ats) {
        if (a == null)
            return null;
        if (a < out)
            out = a;
    }
    return out;
}
