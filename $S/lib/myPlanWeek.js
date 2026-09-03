"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAVEAT = exports.MAX_NAMED = void 0;
exports.myPlanWeek = myPlanWeek;
exports.allLoggedNote = allLoggedNote;
/**
 * How many movements are named before the rest are counted instead.
 *
 * Five. This is a line on a plan screen, not an inventory, and a member reading
 * eleven movement names in a row is reading a telling-off. The remainder is
 * COUNTED rather than dropped — a list that simply stops is a list the reader
 * takes for the whole of it.
 */
exports.MAX_NAMED = 5;
function named(ms) {
    return { names: ms.slice(0, exports.MAX_NAMED).map((m) => m.name), more: Math.max(0, ms.length - exports.MAX_NAMED) };
}
/** Movements and the sentence for them, joined the way a reader reads them. */
function phrase(list) {
    const n = list.names.join(', ');
    return list.more > 0 ? `${n} and ${list.more} more` : n;
}
const s = (n) => (n === 1 ? '' : 's');
/**
 * What to say to the member about their own programme and their own log.
 *
 * `windowDays` is the window the caller asked `planVsActual` for and is printed
 * rather than assumed — the constant in that module is 28 and a client screen
 * comparing this week's plan will pass 7, so restating either here would
 * eventually print a window nobody used.
 */
function myPlanWeek(pva, windowDays) {
    if (pva.state === 'unreadable') {
        return {
            kind: 'unreadable',
            note: 'Your programme or your training log could not be read, so nothing here compares them. That is a read that did not land — it is not a week with nothing in it.',
        };
    }
    if (pva.state === 'no-programme') {
        return {
            kind: 'no-programme',
            note: 'No coach has written you a programme yet, so there is nothing here to measure your training against. The plan above is the one this app builds from your goal.',
        };
    }
    const all = pva.movements;
    if (!all.length) {
        return { kind: 'empty', note: 'This programme names no movements, so there is nothing to compare.' };
    }
    const loggedM = all.filter((m) => m.coverage === 'logged');
    const missingM = all.filter((m) => m.coverage === 'not-logged');
    const unknownM = all.filter((m) => m.coverage === 'unknown');
    if (unknownM.length === all.length) {
        // The log read failed, or it came back at the row cap before reaching the
        // start of the window. Both arrive here as a list of unknowns, and the
        // sentence names the READ rather than the member — because the one thing
        // they must not take from an empty comparison is that they did none of it.
        return {
            kind: 'unanswerable',
            note: `Your training could not be read back over the last ${windowDays} days, so none of these ${all.length} movement${s(all.length)} can be answered for. That is about the read, not about your week.`,
        };
    }
    const missing = named(missingM);
    const unanswered = named(unknownM);
    return {
        kind: 'ready',
        note: `You have logged ${loggedM.length} of the ${all.length} movement${s(all.length)} your programme names, in the last ${windowDays} days.`,
        logged: loggedM.length,
        total: all.length,
        missing,
        missingNote: missingM.length
            ? `Not logged in that window: ${phrase(missing)}.`
            // Said out loud, because it is the whole point of the comparison and the
            // one state a member deserves to be told about rather than left to infer
            // from an absent list.
            : null,
        unanswered,
        unansweredNote: unknownM.length
            ? `${unknownM.length} more cannot be answered for — your history did not come back far enough to cover the window: ${phrase(unanswered)}.`
            : null,
        offPlanNote: pva.offPlan.length
            ? `You also logged ${pva.offPlan.length} movement${s(pva.offPlan.length)} this programme does not name: ${pva.offPlan.slice(0, exports.MAX_NAMED).join(', ')}${pva.offPlan.length > exports.MAX_NAMED ? ` and ${pva.offPlan.length - exports.MAX_NAMED} more` : ''}. That is worth telling your coach — it is the half of your week their screen cannot explain.`
            : null,
        caveat: exports.CAVEAT,
    };
}
/**
 * The disclaimer, in the member's own voice.
 *
 * Same claim as `WINDOW_IS_NOT_A_WEEKDAY` and the same reason: a logged set is
 * an instant, this app holds no timezone for a member's history, and nothing
 * here can say a Tuesday session happened on their Tuesday. Reworded only
 * because the coach's version explains the schema to somebody who is not being
 * accused by it, and the member's needs to say what it means for them —
 * which is that nothing on this line is calling any particular day a miss.
 */
exports.CAVEAT = 'This counts movements over a window of days, never against a named weekday, and it never says a session was missed — an unlogged session and a session that did not happen look the same from here.';
/**
 * The one line the good state gets.
 *
 * Separate from `note` because a member who has logged everything should be
 * told so in a sentence rather than left to notice the absence of a list. It is
 * not congratulation and not a streak; it is the answer to the question they
 * opened the screen with.
 */
function allLoggedNote(r, windowDays) {
    if (r.kind !== 'ready')
        return null;
    if (r.missing.names.length || r.missing.more)
        return null;
    if (r.unanswered.names.length || r.unanswered.more)
        return null;
    return `Every movement your programme names has been logged in the last ${windowDays} days.`;
}
