"use strict";
// A write that reports how many rows it changed, and a screen about to
// announce that it worked.
//
// ── Why this is a second module and not `wroteRows.ts` ─────────────────────
//
// src/lib/wroteRows.ts owns the same rule for the shape PostgREST hands back
// when you ask it to count: `{ error, count }`, from a mutation carrying
// `{ count: 'exact' }`. Its header is the argument, and it is the argument here
// too — an UPDATE that matches zero rows is a 204 with a null error, and RLS
// policies that FILTER rather than refuse make that the ordinary outcome for
// somebody acting on a row that is not theirs.
//
// The writes this file is for do not have that shape. They are the ones that
// need the ids back as well as the count — a series cancellation has to hand
// the caller the classes it actually cancelled so the right rooms are notified
// — so they end `.select('id')` and return a LIST. `writeFailure` cannot read
// that, and the two call sites that produce it both did the same thing with the
// number: interpolated it into a success message and never compared it to zero.
//
// ── The bug this closes, in the coach's words ─────────────────────────────
//
// app/(trainer)/classes.tsx lists every class at the gym, and its own header
// says why the count has to be checked:
//
//     "the two policies on `gym_classes` filter rather than refuse, so a coach
//      editing somebody else's class matches nothing and gets no error, and the
//      board would redraw unchanged."
//
// The single-class paths honour that: `updateClass` and `cancelClass` both end
// in `assertWrote` and throw. The SERIES paths — the ones that act on a whole
// term at once — did not. So a coach who opened Manage on a colleague's Tuesday
// class and called the series off read:
//
//     Series called off
//     0 classes were called off. Every booking, every check-in and every
//     waiting list is kept. Nobody had booked or was waiting, so there was
//     nobody to tell.
//
// under a dialog titled to say it had happened, and walked away from a term
// that is still on, still bookable, and whose members will turn up. The same
// shape printed "Series updated — 0 classes from this one onward were changed"
// over a time change nobody made.
//
// That is worse than the error it replaces, and worse in the specific way this
// codebase keeps naming: it is not a failure the coach can see. The board
// refreshes, the sheet closes, the words say the term moved.
//
// ── Why zero is a refusal and not "nothing needed doing" ──────────────────
//
// For a series edit it can only be a refusal. The class the coach opened the
// sheet on is itself a member of the series and its own `starts_at` is the
// lower bound, so `series_id = X and starts_at >= thisClass.startsAt` matches
// at least that one row for anybody permitted to change it. Zero means the
// policy filtered every row away.
//
// For a series CANCELLATION there is a second innocent reading — the writer
// adds `.neq('status', 'cancelled')`, so a term already called off matches
// nothing — and the sentence below is written to cover both without claiming
// to know which. "Not yours to change, or already off" is the honest pair, and
// either way the coach's next act is the same: go and look.
//
// ── A count that is not a count ───────────────────────────────────────────
//
// `null`, `undefined` and `NaN` are all reported, and reported DIFFERENTLY from
// zero. Zero says the server matched nothing; a missing number says nobody
// counted, which is the omission that lets a new call site quietly rejoin the
// population this module exists to empty. `wroteRows.ts` makes exactly this
// distinction for the same reason and its header states it: "Not 'zero rows' —
// 'nobody counted'."
Object.defineProperty(exports, "__esModule", { value: true });
exports.changedFailure = changedFailure;
exports.assertChanged = assertChanged;
/**
 * Why this write cannot be announced as having happened, or null when it can.
 *
 * Pure, so the sentence a coach reads is assertable without a database.
 *
 * `what` is the thing in the coach's own words — "that series", "those
 * classes" — and is interpolated as the subject of a sentence, so it reads as
 * English rather than as a field name. `alsoBecause` is the second innocent
 * reading where there is one; it is appended to the refusal rather than
 * replacing it, because a screen that guessed which of the two had happened
 * would be inventing the half it cannot see.
 */
function changedFailure(what, changed, alsoBecause) {
    if (changed == null || !Number.isFinite(changed)) {
        return `${what} was sent, but the server did not say how many rows it changed, so nothing here can say whether it worked.`;
    }
    if (changed < 0) {
        // Not reachable from a row count, and that is the point: reaching it means
        // the number came from somewhere other than the write, and a success
        // message built on it would be built on nothing.
        return `${what} came back with a row count of ${changed}, which is not a number of rows, so nothing here can say whether it worked.`;
    }
    if (changed === 0) {
        const why = (alsoBecause ?? '').trim();
        return `${what} did not change anything. The server accepted the request and matched no rows, which means ${why ? `${why}, or ` : ''}it is not yours to change.`;
    }
    return null;
}
/**
 * Throw unless the write landed on at least one row.
 *
 * Throws rather than returning, because every call site is already a try/catch
 * around a writer that signals failure by throwing — `assertWrote` keeps that
 * contract in `wroteRows.ts` and this keeps the same one, so a screen does not
 * have to branch two ways on two kinds of failed write.
 */
function assertChanged(what, changed, alsoBecause) {
    const why = changedFailure(what, changed, alsoBecause);
    if (why)
        throw new Error(why);
}
