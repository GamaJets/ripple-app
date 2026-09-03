"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_FILTER = void 0;
exports.filterActive = filterActive;
exports.matchesText = matchesText;
exports.clientOptions = clientOptions;
exports.filterSessions = filterSessions;
exports.filterLine = filterLine;
exports.emptyFilterLine = emptyFilterLine;
exports.stateCounts = stateCounts;
/** Nothing narrowed. The state a screen opens in. */
exports.NO_FILTER = { clientId: null, text: '', state: null };
/** Whether anything is actually narrowing the list. Text counts only once it
 *  has a non-space character in it — a box holding a space is not a search, and
 *  telling a coach their list is filtered because of one would send them
 *  hunting for a control they have not touched. */
function filterActive(f) {
    return f.clientId !== null || f.state !== null || f.text.trim().length > 0;
}
/** Case-folded, accent-naive substring. Naive on purpose: this is a box a coach
 *  types three letters of a name into, and a smarter matcher that dropped
 *  "Ana" from a search for "ana" would be worse at the only job it has. */
function matchesText(name, text) {
    const q = text.trim().toLowerCase();
    if (!q)
        return true;
    return (name ?? '').toLowerCase().includes(q);
}
/**
 * Who appears in these rows, in name order.
 *
 * A row with NO `clientId` produces no option and can be matched by no client
 * filter. That is the honest behaviour rather than a gap: a slot with no client
 * on it is not a person, and inventing an "Unattributed" pseudo-client would
 * put a name-shaped chip in a row of real names. Such rows are still in the
 * unfiltered list, which is where they can be seen.
 */
function clientOptions(rows) {
    const byId = new Map();
    for (const r of rows) {
        const id = r.clientId;
        if (!id)
            continue;
        const name = (r.clientName ?? '').trim();
        const seen = byId.get(id);
        if (seen) {
            seen.count += 1;
            if (!seen.name && name)
                seen.name = name;
        }
        else
            byId.set(id, { name, count: 1 });
    }
    return [...byId.entries()]
        .map(([clientId, v]) => ({ clientId, name: v.name || 'Client', count: v.count }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));
}
/**
 * The rows that survive the filter.
 *
 * `stateOf` is passed in rather than computed here, because what state a
 * session is in is `pastVerdict`'s answer and there must not be a second one —
 * a module that decided for itself whether a row counted as cancelled would
 * disagree with the label printed on that very row the first time either
 * changed. Omitted, the state clause does not apply at all, which is what the
 * marking queue wants.
 */
function filterSessions(rows, f, stateOf) {
    return rows.filter((r) => {
        if (f.clientId !== null && r.clientId !== f.clientId)
            return false;
        if (!matchesText(r.clientName, f.text))
            return false;
        if (f.state !== null && stateOf && stateOf(r) !== f.state)
            return false;
        return true;
    });
}
/**
 * What is on screen, and out of how much.
 *
 * Null when nothing is narrowed, because a permanent "showing 88 of 88" under
 * an unfiltered list is furniture. `total` is the number of rows READ, and the
 * sentence says so in those words — "of the 88 read" rather than "of your 88
 * sessions", which would be a claim about a coach's whole history made from a
 * ninety-day window.
 */
function filterLine(shown, total, f, 
/** The picked client's name, where the caller knows it. Null when the pick
 *  names somebody who is not in the rows any more — which is a real state
 *  after the window moves, and "one client" is then the honest phrase. */
clientName = null) {
    if (!filterActive(f))
        return null;
    const narrowed = [];
    if (f.clientId !== null)
        narrowed.push(clientName ? `just ${clientName}` : 'one client');
    if (f.text.trim())
        narrowed.push(`a search for “${f.text.trim()}”`);
    if (f.state !== null)
        narrowed.push('one outcome');
    const by = narrowed.length === 1
        ? narrowed[0]
        : `${narrowed.slice(0, -1).join(', ')} and ${narrowed[narrowed.length - 1]}`;
    return `Showing ${shown} of the ${total} read, narrowed by ${by}.`;
}
/**
 * What to say where the filtered list would be blank.
 *
 * The sentence a screen must not print here is "you have none". Nothing has
 * been read that was not read a moment ago; the coach hid the rest themselves
 * and may well have forgotten. So this names the filter, names the size of what
 * was read, and says how to get back — and it is only ever called where the
 * unfiltered list is known to have something in it.
 */
function emptyFilterLine(total, f) {
    if (!filterActive(f)) {
        // Not reachable from a caller that checks, and written rather than left to
        // an empty string: a blank line here would be a screen saying nothing at
        // the one moment a coach is looking for an explanation.
        return 'Nothing to show.';
    }
    return `None of the ${total} sessions read matches what you have narrowed to. `
        + 'They have not gone anywhere — clear the filters to see them again.';
}
/**
 * How many of these rows are in each state, for the outcome chips.
 *
 * Every state gets a key, including the ones with nothing in them, so a chip
 * can show `0` and be visibly worth not tapping. A state missing from the map
 * would render as an absent chip, and a coach who cannot see "cancelled late"
 * has no way to learn that none of their sessions is.
 */
function stateCounts(rows, stateOf, states) {
    const out = {};
    for (const s of states)
        out[s] = 0;
    for (const r of rows) {
        const s = stateOf(r);
        if (s in out)
            out[s] += 1;
    }
    return out;
}
