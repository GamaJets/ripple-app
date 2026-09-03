"use strict";
// A request that is never going to answer, and the sentence a person gets
// instead of a spinner.
//
// ── The condition ─────────────────────────────────────────────────────────
//
// Nothing in this product has ever had a timeout. `src/lib/pullRefresh.ts`
// records the fact at line 14 — "no AbortController anywhere in this app and no
// request has a timeout" — and states it as an obstacle to what THAT file is
// doing rather than as a defect of its own. It is a defect of its own.
//
// A front desk on gym wifi behind a captive portal is the ordinary version. The
// socket is accepted. The TLS handshake completes. The portal then holds the
// request open and answers nothing, for ever. `fetch` has no default deadline
// for that case, in a browser or in React Native, so the promise being awaited
// never settles, in either direction.
//
// What a screen does with a promise that never settles is not "shows an error
// late". It is worse and quieter: every provider and every `Read<T>` in this
// product moves off 'loading' only when a read SETTLES, so a read that does
// neither leaves the screen saying "Loading…" for the life of the mount — and
// nothing here unmounts a screen. The words for a read that did not answer are
// already written on every one of those screens, and none of them can be
// reached.
//
// ── Why a deadline rather than a retry ────────────────────────────────────
//
// Because the screens are already built for the answer. Every one of them has a
// failed arm with a banner carrying the database's own sentence, and a way to
// ask again. A deadline turns a hang into exactly the state they are written
// for; a retry loop would hide the condition for another three attempts and
// then produce the same screen anyway.
//
// ── Why the sentence differs for a write ──────────────────────────────────
//
// This is the part that must not be got wrong. Giving up on a READ changes
// nothing: the request either arrives or it does not, and the screen still
// holds what it held. Giving up on a WRITE tells you nothing about whether the
// row was written — the request may have reached the database, committed, and
// had its answer lost on the way back. "It failed" is a claim that cannot be
// made about a write nobody answered, and it is the claim that gets a payment
// taken twice.
//
// `src/lib/wroteRows.ts` makes the same distinction one layer down for a write
// that matched no rows: "was sent, but the server did not say whether it
// changed anything". This is that sentence for the case where the server did
// not say anything at all.
//
// ── Where this sits among the three ───────────────────────────────────────
//
// This module owns the CEILING and the TIMER, and nothing else. Two things are
// built on it and neither duplicates it:
//
//   · `src/lib/readDeadline.ts` is the DISPLAY half for the phone. It owns no
//     request and cannot cancel one; what it does is move a provider's
//     `LoadStatus` off 'loading' once a first read has been in flight past the
//     ceiling here, so the screens' existing error copy becomes reachable.
//   · `src/lib/requestTimeout.ts` is the TRANSPORT half. It wraps `fetch` with
//     an AbortController and a race, and classifies a request by URL so an
//     upload is not cut off at a read's ceiling. `studio-web/lib/supabase.ts`
//     puts every console request through it.
//
// The ceiling is declared once, here, for the reason `scripts/check-sql-caps.mjs`
// argues at length about a different pair of numbers: two copies of one number
// in two languages is two numbers, and the one that gets raised is never both.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadlineExceeded = exports.UPLOAD_DEADLINE_MS = exports.READ_DEADLINE_MS = void 0;
exports.deadlineMsFor = deadlineMsFor;
exports.changesThings = changesThings;
exports.secondsPhrase = secondsPhrase;
exports.deadlineNote = deadlineNote;
exports.isDeadlineExceeded = isDeadlineExceeded;
exports.withDeadline = withDeadline;
/** How long a read may go unanswered before it is given up on.
 *
 *  Generous on purpose. This is not a latency budget and it must never fire on
 *  a gym with a slow line — every figure it interrupts is one somebody wanted.
 *  It exists for the request that is never coming back, and twenty-five seconds
 *  is far longer than any read this product makes and far shorter than for
 *  ever.
 *
 *  Deliberately longer than `MAX_SPIN_MS` in src/lib/pullRefresh.ts, which is
 *  20s: on a pull the spinner ends first and hands the gesture back, and five
 *  seconds later the screen says why. The reverse order would put "we couldn't
 *  read your log" on screen underneath a wheel still claiming to be reading
 *  it. */
exports.READ_DEADLINE_MS = 25000;
/**
 * The same, for a request carrying a FILE.
 *
 * A gym document, an exercise clip or a progress photo over gym wifi at a
 * genuine megabit is a minute or more of legitimate transfer. Cutting that off
 * at twenty-five seconds would be a new defect written to fix an old one.
 */
exports.UPLOAD_DEADLINE_MS = 180000;
/** The deadline for a request, from what it is carrying. */
function deadlineMsFor(kind) {
    return kind === 'file' ? exports.UPLOAD_DEADLINE_MS : exports.READ_DEADLINE_MS;
}
/**
 * Whether this request changes anything — which decides which sentence a
 * person is told when it is given up on.
 *
 * Read off the HTTP method, because that is the one fact available at the point
 * a deadline fires. GET and HEAD are the only two guaranteed to have changed
 * nothing; everything else, INCLUDING a method this function has never heard
 * of, is treated as a write. Erring the other way would produce "nothing has
 * changed" over a payment that may well have been recorded.
 */
function changesThings(method) {
    const m = (method ?? 'GET').trim().toUpperCase();
    return m !== 'GET' && m !== 'HEAD';
}
/** A duration as the number of seconds a person would say. */
function secondsPhrase(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    return `${s} second${s === 1 ? '' : 's'}`;
}
/**
 * The tail of the sentence a screen prints when a request was given up on.
 *
 * Written to be appended to the wordings this product already has —
 * `landed()`'s "Could not read the payments: …" and `writeFailure()`'s "That
 * membership could not be saved." — so a screen needs no new branch to say
 * this. It is a `message` on an ordinary Error, and every existing failed arm
 * already prints one.
 *
 * The two wordings are not interchangeable and the difference is the whole
 * point of the function.
 */
function deadlineNote(ms, wrote) {
    const t = secondsPhrase(ms);
    return wrote
        ? `the gym did not answer within ${t}, so this stopped waiting. `
            + `It cannot say whether the change was made — read the screen again before repeating it.`
        : `the gym did not answer within ${t}, so this stopped waiting. `
            + `Nothing has changed. This is what a connection that is accepted and then answers `
            + `nothing looks like — a captive portal at the desk is the usual reason.`;
}
/** A request that was given up on. Its own class so a caller that wants to
 *  treat a deadline differently from a refusal can, and so the two are never
 *  conflated in a log. */
class DeadlineExceeded extends Error {
    constructor(ms, wrote) {
        super(deadlineNote(ms, wrote));
        this.name = 'DeadlineExceeded';
        this.ms = ms;
        this.wrote = wrote;
    }
}
exports.DeadlineExceeded = DeadlineExceeded;
/** True when this is a deadline rather than a refusal. Written as a predicate
 *  rather than an `instanceof` at each call site because an error crossing a
 *  bundle boundary can fail `instanceof` while carrying the right name. */
function isDeadlineExceeded(e) {
    return !!e && typeof e === 'object' && e.name === 'DeadlineExceeded';
}
const realTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
};
/**
 * A promise, with a deadline on it.
 *
 * `onExpire` is what actually stops the work — an `AbortController.abort()` at
 * the fetch layer. It is a separate argument rather than something this
 * function does, because this module is compiled into three surfaces and must
 * not depend on a browser type.
 *
 * The timer is cleared whichever way the promise settles. That is not
 * tidiness: the tests here run under plain `node`, and a timer left armed keeps
 * the process alive past the last assertion, so a suite that passed would hang
 * instead of exiting.
 */
function withDeadline(work, ms, wrote, onExpire, timers = realTimers) {
    return new Promise((resolve, reject) => {
        let done = false;
        const id = timers.setTimeout(() => {
            if (done)
                return;
            done = true;
            // Stop the work FIRST, then report. The other order leaves a request in
            // flight against a screen that has already moved on, which is how a read
            // given up on at 25 seconds lands at 40 and overwrites a fresher one.
            try {
                onExpire?.();
            }
            catch { /* aborting is best-effort; the report is not */ }
            reject(new DeadlineExceeded(ms, wrote));
        }, ms);
        const settle = (fn) => (v) => {
            if (done)
                return;
            done = true;
            timers.clearTimeout(id);
            fn(v);
        };
        work.then(settle(resolve), settle(reject));
    });
}
