"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStarterId = void 0;
exports.mergeLibrary = mergeLibrary;
exports.readLibrary = readLibrary;
exports.deleteRefusedLine = deleteRefusedLine;
const rowCap_1 = require("./rowCap");
/**
 * Whether this template is one of the three compiled into the bundle.
 *
 * The prefix is the whole test and it was written out by hand in four places —
 * the provider's `isStarter`, the rebuild above, the seed builder, and the
 * delete guard. One of those getting out of step is how a starter becomes
 * deletable, and a "deleted" starter is back at the next launch with no
 * explanation.
 */
const isStarterId = (id) => id.startsWith('seed_');
exports.isStarterId = isStarterId;
/**
 * The library to show, given what the server just said and what is on screen.
 *
 * Three groups, in the order a coach should meet them:
 *
 *   · templates whose write is still in flight, newest-first, because they were
 *     put at the head of the list the moment the coach tapped Save and moving
 *     them would read as the app losing track of them;
 *   · the server's own answer, which is newest-first by the read's ordering and
 *     is the only group that is CONFIRMED;
 *   · the built-in starters, which are always last and are never removed,
 *     because they cannot be deleted and are not the coach's work.
 *
 * An empty `server` is a real answer and rebuilds to the starters alone. That
 * is the whole point: the list has to be able to shrink.
 */
function mergeLibrary(server, prev, pending = new Set()) {
    const onServer = new Set(server.map((t) => t.id));
    const inFlight = prev.filter((t) => !(0, exports.isStarterId)(t.id) && pending.has(t.id) && !onServer.has(t.id));
    return [...inFlight, ...server.filter((t) => !(0, exports.isStarterId)(t.id)), ...prev.filter((t) => (0, exports.isStarterId)(t.id))];
}
/**
 * Read the coach's saved templates.
 *
 * Every path ends in a `LibraryRead`; there is no early `return` without one.
 *
 * No session is a true answer, not a failed check — `getUser()` REJECTS when
 * nobody is signed in, and treating that as an error latched this provider into
 * 'error' on the first tick, before anybody had signed in, where it stayed.
 * Signed out, the starters really are the whole library, so `rows` is `[]` and
 * not null: the list is rebuilt to the starters rather than left holding the
 * previous account's work.
 */
async function readLibrary(sb) {
    try {
        // `error` read, and not merely `data`, which is what the seventeen
        // providers this was copied from do. A getSession that FAILED hands back
        // the same session-less shape as a phone nobody has signed in on, and the
        // two mean opposite things here: one says the starters are the whole
        // library, the other says we could not find out. Treating the second as the
        // first is how a coach's library empties itself on screen.
        const { data: sess, error: sessErr } = await sb.auth.getSession();
        if (sessErr)
            return { status: 'error', rows: null, uid: null };
        if (!sess?.session)
            return { status: 'ready', rows: [], uid: null };
        const { data: auth, error: authErr } = await sb.auth.getUser();
        if (authErr)
            return { status: 'error', rows: null, uid: null };
        const id = auth?.user?.id;
        if (!id)
            return { status: 'ready', rows: [], uid: null };
        // Newest-first, because the cap decides which end is kept and a coach's most
        // recent templates are the ones they are working from. That is also the
        // order the picker should show them in.
        const { data, error } = await sb.from('program_templates')
            .select('id, name, program').eq('coach_id', id)
            .order('created_at', { ascending: false }).order('id', { ascending: false }).limit((0, rowCap_1.capLimit)());
        // `error || !data` used to return down the same path as a coach who has
        // simply not saved anything, leaving the seed starters standing in for
        // their library with nothing to mark the difference.
        if (error)
            return { status: 'error', rows: null, uid: id };
        const page = (0, rowCap_1.capped)(data);
        const rows = page.rows
            .filter((r) => r && r.program)
            .map((r) => ({ id: String(r.id), name: r.name, program: r.program }));
        return { status: page.truncated ? 'partial' : 'ready', rows, uid: id };
    }
    catch {
        return { status: 'error', rows: null, uid: null };
    }
}
/**
 * What to put in front of a coach whose delete was refused.
 *
 * One sentence, in the coach's words, naming the template — because the thing
 * they need to know first is that the row they are looking at is still theirs
 * and still there. `why` comes from `writeFailure` and already reads as a
 * sentence; the fallback covers a caller that has no reason to offer, which
 * must still not be silence.
 */
function deleteRefusedLine(name, why) {
    return `“${name}” is still in your library. ${why ?? 'The server did not say why.'}`;
}
