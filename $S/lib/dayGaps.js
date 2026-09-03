"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_SELLABLE_MIN = void 0;
exports.dayGaps = dayGaps;
exports.sellableGaps = sellableGaps;
exports.gapsAreKnown = gapsAreKnown;
exports.gapsUnknownNote = gapsUnknownNote;
exports.gapLengthLabel = gapLengthLabel;
exports.gapNote = gapNote;
exports.gapsHeading = gapsHeading;
/** Shorter than this is the turnaround between two clients, not a hole in the
 *  day. Thirty minutes is the shortest thing this product sells. */
exports.MIN_SELLABLE_MIN = 30;
const MIN = 60000;
function spanOf(b) {
    const s = Date.parse(b.startsAt);
    if (!Number.isFinite(s))
        return null;
    return { s, e: s + Math.max(0, b.durationMin) * MIN };
}
/** Total minutes of `[s, e)` covered by any of `spans`. Overlapping spans are
 *  counted once — two open slots offering the same 10am are one bookable hour,
 *  not two, and part 86 says so: "only one of them can ever be taken". */
function coveredMinutes(s, e, spans) {
    const clipped = spans
        .map((x) => ({ s: Math.max(s, x.s), e: Math.min(e, x.e) }))
        .filter((x) => x.e > x.s)
        .sort((a, b) => a.s - b.s);
    let total = 0;
    let cur = null;
    for (const x of clipped) {
        if (cur && x.s <= cur.e) {
            cur.e = Math.max(cur.e, x.e);
            continue;
        }
        if (cur)
            total += cur.e - cur.s;
        cur = { s: x.s, e: x.e };
    }
    if (cur)
        total += cur.e - cur.s;
    return Math.round(total / MIN);
}
/**
 * The holes in one local day, longest-first.
 *
 * Built from local wall-clock components for the reason `moveTimes` states:
 * "9am on Sunday" is a wall-clock fact and adding milliseconds to a midnight
 * gets it wrong twice a year. Everything after that is instants.
 *
 * Only the part of the day still AHEAD of now is reported. A hole at eight this
 * morning is not a thing a coach can sell at four this afternoon, and listing
 * it turns a working tool into a reproach.
 */
function dayGaps(input) {
    const min = Math.max(1, input.minMinutes ?? exports.MIN_SELLABLE_MIN);
    if (!input.work.length)
        return [];
    const busy = input.blockers.map(spanOf).filter((x) => x != null);
    const open = input.open.map(spanOf).filter((x) => x != null);
    const out = [];
    for (const w of [...input.work].sort((a, b) => a.startMin - b.startMin)) {
        const wStart = new Date(input.year, input.monthIndex, input.day, Math.floor(w.startMin / 60), w.startMin % 60, 0, 0).getTime();
        const wEnd = new Date(input.year, input.monthIndex, input.day, Math.floor(w.endMin / 60), w.endMin % 60, 0, 0).getTime();
        if (!(wEnd > wStart))
            continue;
        // Cuts inside this window, in order. Each busy span closes the run before
        // it and opens the next one after it.
        const inside = busy
            .map((b) => ({ s: Math.max(wStart, b.s), e: Math.min(wEnd, b.e) }))
            .filter((b) => b.e > b.s)
            .sort((a, b) => a.s - b.s);
        let cursor = Math.max(wStart, input.nowMs);
        const edges = [...inside, { s: wEnd, e: wEnd }];
        for (const b of edges) {
            if (b.s > cursor) {
                const s = cursor;
                const e = b.s;
                const minutes = Math.round((e - s) / MIN);
                if (minutes >= min) {
                    const openMin = coveredMinutes(s, e, open);
                    out.push({
                        startsAt: new Date(s).toISOString(),
                        startMs: s, endMs: e, minutes, openMin,
                        sellableMin: Math.max(0, minutes - openMin),
                    });
                }
            }
            cursor = Math.max(cursor, b.e);
        }
    }
    return out.sort((a, b) => b.sellableMin - a.sellableMin || a.startMs - b.startMs);
}
/** The gaps worth telling a coach about: the ones no client can take. */
function sellableGaps(gaps, minMinutes = exports.MIN_SELLABLE_MIN) {
    return gaps.filter((g) => g.sellableMin >= minMinutes);
}
/**
 * Whether the three reads behind a gap support stating one at all.
 *
 * A gap is a claim that NOTHING is in an hour, which is the one shape of claim
 * an incomplete read cannot support: the missing row is exactly the booking
 * that occupies it. So this is `isWhole` on all three, and a screen that cannot
 * satisfy it says nothing rather than something qualified — a coach who offers
 * a client an hour they are already teaching in has been actively misled, which
 * is worse than not having the feature.
 */
function gapsAreKnown(sessions, classes, avail) {
    return sessions === 'ready' && classes === 'ready' && avail === 'ready';
}
/** Why no gaps are being shown, or null when they are. One sentence per cause,
 *  because the next step differs for each and "something is missing" leaves the
 *  coach unable to tell which. */
function gapsUnknownNote(sessions, classes, avail) {
    if (gapsAreKnown(sessions, classes, avail))
        return null;
    if (sessions === 'loading' || classes === 'loading' || avail === 'loading') {
        return 'Still reading your day.';
    }
    if (sessions === 'error' || classes === 'error' || avail === 'error') {
        return 'Your day could not be read in full, so the free hours in it are not known. This is a read that '
            + 'failed, not an empty day. Pull down to try again.';
    }
    return 'Only part of your day came back, so the free hours in it are not established. An hour that looks '
        + 'free here may already have something in it. Pull down to refresh.';
}
/**
 * How to say a length of time to a coach.
 *
 * Minutes under an hour, hours and minutes above it. No locale decision is made
 * here — these are a number and a unit symbol, which is the one thing
 * src/lib/format.ts does not own.
 */
function gapLengthLabel(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60)
        return `${m}min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest === 0 ? `${h}h` : `${h}h ${rest}min`;
}
/**
 * The line under a gap.
 *
 * Two states, and the difference between them is the point of the feature. A
 * gap partly covered by an open slot is partly for sale already; a gap covered
 * by nothing is time the coach is keeping free that no client can reach. The
 * second sentence says what to do about it in the app's own vocabulary — Add a
 * Session and Weekly Availability are the two controls on this screen that
 * create bookable hours.
 */
function gapNote(g) {
    if (g.openMin <= 0) {
        return 'Nobody can book this — there is no open slot across it. Add a session or open the hour so a client can take it.';
    }
    return `${gapLengthLabel(g.openMin)} of this is already open for booking; the rest of it nobody can take.`;
}
/** The heading over the list, or null when there is nothing to head. Counts
 *  only what was actually established — the caller has already gated on
 *  `gapsAreKnown`, and this counts the list it was given. */
function gapsHeading(n) {
    if (n <= 0)
        return null;
    return n === 1 ? 'An hour nobody can book' : `${n} stretches nobody can book`;
}
