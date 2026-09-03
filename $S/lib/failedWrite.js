"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFate = writeFate;
exports.failedWriteSentence = failedWriteSentence;
exports.failedWriteNote = failedWriteNote;
exports.mayRetryWrite = mayRetryWrite;
exports.mayAssertUnchanged = mayAssertUnchanged;
// What a write that did not come back may honestly be said to have done.
//
// ── The claim that stopped being true ──────────────────────────────────────
//
// The console words a thrown write as "was NOT closed", "Nothing was taken
// back", "the original still stands in full", "Nothing was saved — the money is
// not in the gym record". Every one of those is a statement about the DATABASE,
// made from the absence of a reply, and every one of them was correct while the
// only way a write could throw was a refusal: supabase-js RESOLVES with `error`
// set when Postgres declines a row, so a THROW meant the request never
// completed, and a request that never completed on a browser that never timed
// out meant a connection that never opened.
//
// `studio-web/lib/supabase.ts` now puts a ceiling on every request — thirty
// seconds for a call, two minutes for a transfer. That closes a worse defect
// and introduces this one: a write may now throw because WE gave up waiting,
// and a write we gave up waiting for may have reached the server, committed,
// and had only its reply lost. "Nothing was saved" is then a sentence that
// sends a member of staff to enter the same payment a second time.
//
// `retryOnTimeout` in src/lib/requestTimeout.ts already refuses to resend a
// timed-out write for exactly this reason, and says so at length. This file is
// the wording catching up with that decision.
//
// ── Three states, not two ──────────────────────────────────────────────────
//
// REFUSED       the server read the row and declined it. A CHECK, an RLS
//               policy, a duplicate key, an expired token. Nothing happened,
//               and the screen may say so flatly.
// UNREACHABLE   nothing was sent. The device knew it was offline before it
//               tried. Nothing happened, and the screen may say so flatly.
// UNANSWERED    it was sent and nothing came back. WE DO NOT KNOW. The row may
//               be in the database with only its reply lost, and the honest
//               sentence says that and then says how to find out.
//
// The ambiguity defaults to UNANSWERED and that direction is deliberate. The
// two errors are not the same size: telling somebody a payment failed when it
// landed makes them enter it twice, which is a second charge on a member and a
// reconciliation nobody will win; telling somebody we are not sure when in fact
// nothing happened costs them one look at a list. `classifyWrite` in
// src/lib/offlineQueue.ts leans the other way — towards KEEPING the row — for
// the same reason from the other side, and its `isRefusal` is the evidence test
// reused here so the two cannot disagree about what a refusal looks like.
//
// ── Why the wording lives in a module ──────────────────────────────────────
//
// Because it drifted. Fourteen console screens wrote this sentence fourteen
// times and they no longer agreed about what the silence meant — which is the
// same argument `NO_ZONE_NOTE`, `NO_PAY_POLICY_NOTE` and `CAUSAL_CAVEAT` each
// make in their own file. One wording, one place, and a test that fails when
// somebody softens it.
const offlineQueue_1 = require("./offlineQueue");
const requestTimeout_1 = require("./requestTimeout");
/**
 * Which of the three a thrown write was.
 *
 * `err` is whatever the `catch` caught. A supabase-js `PostgrestError` carries
 * `code`/`status` and lands on 'refused'; our own ceiling carries
 * `requestTimedOut` and lands on 'unanswered'; anything else lands on
 * 'unanswered' too, because "the fetch failed" is not evidence about the row.
 */
function writeFate(err, evidence = {}) {
    // Checked first. A device that was already offline did not send this, and
    // that is the one case where "nothing happened" is safe to assert about a
    // request that produced no reply.
    if (evidence.online === false)
        return 'unreachable';
    // Our own ceiling. We stopped listening; the server was never told to stop.
    if ((0, requestTimeout_1.isRequestTimeout)(err))
        return 'unanswered';
    if (err == null)
        return 'unanswered';
    const shape = {
        code: err.code ?? null,
        status: err.status ?? null,
        message: err.message ?? null,
    };
    // `rows: null` — this write threw, so it returned nothing to count. The only
    // question `classifyWrite` is being asked here is whether the error carries
    // evidence that a server read the row and said no.
    return (0, offlineQueue_1.classifyWrite)(shape, null) === 'refused' ? 'refused' : 'unanswered';
}
/** The reason, tidied: a trimmed message with one full stop and no doubling. */
function because(reason, fallback) {
    const r = String(reason ?? '').trim() || fallback;
    return /[.!?]$/.test(r) ? r : `${r}.`;
}
/** `what`, with a trailing full stop trimmed off so it can open a sentence. */
function subjectOf(what) {
    return String(what ?? '').trim().replace(/[.]+$/, '') || 'That change';
}
/** A clause, with any trailing full stop trimmed so it can be joined with "so". */
function clauseOf(unchanged) {
    return String(unchanged ?? '').trim().replace(/[.]+$/, '') || 'nothing was changed';
}
/**
 * THE THREE SENTENCES.
 *
 * Read them together, because the whole design is in the contrast:
 *
 *  · refused and unreachable both assert. They are allowed to, because in both
 *    the evidence is positive — the server answered no, or the device never
 *    sent it — and a person who is told nothing happened may confidently do it
 *    again.
 *  · unanswered asserts NOTHING about the database. It says what we did (sent
 *    it), what we got (nothing), what that means (we do not know), what may
 *    have happened (saved, with only the reply lost), and what to do instead of
 *    repeating it. It is longer than the other two on purpose: it is the only
 *    one where the reader has work to do before acting.
 */
function failedWriteSentence(fate, subject, reason) {
    const what = subjectOf(subject.what);
    const still = clauseOf(subject.unchanged);
    const check = String(subject.howToCheck ?? '').trim();
    if (fate === 'refused') {
        return `${what} was NOT saved: ${because(reason, 'the database refused the write')} `
            + `Nothing was written, so ${still}.`;
    }
    if (fate === 'unreachable') {
        return `${what} never left this device: ${because(reason, 'there was no connection')} `
            + `Nothing was sent, so ${still}.`;
    }
    return `${what} was sent and nothing came back: ${because(reason, 'the request timed out')} `
        + 'So this cannot tell you whether it went through — it may have been saved and only the '
        + `reply lost, and it may equally not exist at all. Do not enter it again until you know which. `
        + `${check}`.trimEnd();
}
/**
 * The sentence for a caught write, classified and worded in one call. This is
 * what a screen's `catch` uses.
 */
function failedWriteNote(err, subject, evidence = {}) {
    const reason = err?.message ?? null;
    return failedWriteSentence(writeFate(err, evidence), subject, reason);
}
/**
 * True when a screen may offer "try again" as a plain button.
 *
 * False for the ambiguous state, and this is the behavioural half of the fix
 * rather than a second opinion about wording. A retry control beside "we do not
 * know whether that went through" is an invitation to make the duplicate the
 * sentence just warned about — the same argument `retryOnTimeout` makes about
 * doing it automatically, applied to the button that does it by hand.
 */
function mayRetryWrite(fate) {
    return fate !== 'unanswered';
}
/**
 * The other half of the same judgement, said as its own sentence because it is
 * the one a REVIEWER checks: a `false` here means every "nothing was saved",
 * "the original still stands", "the month is still open" on the screen is a
 * claim the console cannot make. It is the same predicate as `mayRetryWrite` —
 * deliberately, because they are the same fact — and it is separate so that a
 * later change to one of them has to be an argument about which.
 */
function mayAssertUnchanged(fate) {
    return !isAmbiguous(fate);
}
/** The state with no evidence in it. */
function isAmbiguous(fate) {
    return fate === 'unanswered';
}
