"use strict";
// When the signal comes back, the reads that failed are tried again.
//
// ── The half of recovery that was never built ──────────────────────────────
//
// src/lib/offlineQueue.ts · `flushAll` and src/ui/offlineFlush.tsx already do
// this for WRITES, and the comment at the top of that file states the problem
// it solved in exactly the terms this one needs: before it existed, a queued
// write went up "the next time the member launches the app AND lands on the
// screen that owns that queue".
//
// Nothing was ever built for the other direction. `grep -rn onReconnect src app`
// finds one subscriber — the write flush — and no read anywhere. So a member's
// phone that has just found signal sends last night's session up, silently, and
// goes on showing them the screen that says their plan could not be read.
//
// ── Why this is only now worth building ────────────────────────────────────
//
// It was not reachable before. Without src/lib/requestTimeout.ts a read on a
// dead network never failed — it hung, the provider stayed at 'loading' for
// ever, and the app went on believing it was online, so there was no offline
// edge to come back from and no 'error' to recover. The ceiling landing turned
// that hang into a real transport failure, which means every provider in
// src/ui can now genuinely reach 'error', and a member can now genuinely be
// left sitting in front of one.
//
// And they are left there. Every one of the forty-odd providers that can reach
// 'error' already exposes a `reload` or a `refresh` — that is not the gap. The
// gap is that the ONLY things that call one are a screen's pull-to-refresh
// gesture and a Refresh link, both of which need a member who knows the app is
// stuck and thinks to ask again. A member who walks out of the basement onto
// the street has no reason to think anything needs asking: the phone shows bars.
//
// ── What this file decides, and what it deliberately does not ──────────────
//
// It decides WHICH providers are asked again and WHEN, and it holds the
// single-flight rule. It does not know how any provider reads; each one hands
// in the `reload` it already had.
//
// The registry and the reasoning are here, in plain TypeScript with a test.
// The two triggers need React Native — AppState, and a subscription — and live
// in src/ui/readRefresh.tsx, the same split src/ui/offlineFlush.tsx uses.
Object.defineProperty(exports, "__esModule", { value: true });
exports.attemptsFor = exports.refresherCount = exports.PAUSE_BETWEEN_MS = exports.MAX_ATTEMPTS = exports.FOREGROUND_GAP_MS = exports.needsRefetch = void 0;
exports.mayRunNow = mayRunNow;
exports.registerRefresh = registerRefresh;
exports.noteEdge = noteEdge;
exports.resetRefreshers = resetRefreshers;
exports.attemptsAllow = attemptsAllow;
exports.refreshStale = refreshStale;
const offlineQueue_1 = require("./offlineQueue");
const reachability_1 = require("./reachability");
/**
 * Which statuses are worth asking again.
 *
 * 'error' ONLY, and each of the other three is excluded for its own reason.
 *
 *   'loading' — a read is in flight right now. Asking again would start a
 *               second one over the top of it, which is a duplicate request on
 *               the connection least able to afford one, and on providers that
 *               merge server rows with a device queue it is also a race over
 *               the same list. The read that is running will either land or
 *               fail; if it fails, the NEXT edge picks it up.
 *   'ready'   — it worked. Re-reading it costs the member bytes on a
 *               connection that has just come back and changes nothing on
 *               screen. This is the difference between recovering and
 *               refreshing, and this file is only the first.
 *   'partial' — the rows came back whole-but-truncated (src/ui/loadStatus.ts).
 *               The server answered; a second identical read returns the same
 *               prefix. Truncation is fixed by a narrower query, not a retry.
 */
const needsRefetch = (s) => s === 'error';
exports.needsRefetch = needsRefetch;
/**
 * The shortest gap between two passes raised by returning to the foreground.
 *
 * Fifteen seconds. Coming back to the foreground is a gesture a person can
 * repeat — app switcher, notification, back again — and on iOS it also fires
 * for transitions nobody performed. Without a floor, a member flicking between
 * this app and their music re-reads every failed provider each time.
 *
 * It deliberately does NOT apply to 'reconnect'. That edge is raised once per
 * offline→online transition by src/lib/reachability.ts, is already the rarest
 * event here, and is the one carrying actual news.
 */
exports.FOREGROUND_GAP_MS = 15000;
/**
 * May a pass start now?
 *
 * `lastRunAt` is 0 before anything has run, and a zero must not be read as
 * "ran at the epoch, therefore long enough ago" by accident — it happens to
 * give the right answer here, and is stated so a future edit does not have to
 * rediscover it.
 */
function mayRunNow(trigger, lastRunAt, now, gapMs = exports.FOREGROUND_GAP_MS) {
    if (trigger !== 'foreground')
        return true;
    return now - lastRunAt >= gapMs;
}
/**
 * How many times one provider may be asked again before this file stops asking.
 *
 * Three, and the ceiling exists because 'error' has two very different causes
 * that look identical from here.
 *
 *   · NO SIGNAL. Recoverable, and a retry is exactly right. It is also
 *     self-limiting: the reconnect edge only fires when the network actually
 *     came back, so the first attempt after it usually succeeds.
 *
 *   · THE SERVER SAID NO. A row-level-security refusal, a 400 from a query the
 *     client cannot form correctly, a function that is not deployed. Retrying
 *     produces the identical refusal for ever. Without a ceiling, a member
 *     whose account hits one of these has a phone that re-runs a doomed read
 *     every time they open the app, on battery, for ever.
 *
 * Nothing here can tell the two apart — the provider caught the failure and
 * only published a status. So the ceiling is what makes the guess safe, and the
 * count is per key, not global: one provider refusing must not stop the other
 * seven from recovering.
 *
 * The count is cleared by `noteEdge` on a 'reconnect' trigger, because that
 * edge is genuinely new information about the world: the read that failed
 * three times with no signal deserves its three attempts again now that there
 * is signal. It is also cleared for a key the moment that key is seen at
 * anything other than 'error' — the failure is over and the next one is a
 * fresh failure, not a continuation.
 */
exports.MAX_ATTEMPTS = 3;
/**
 * The pause between one provider's refetch and the next.
 *
 * A quarter of a second, and it is here for the reason `flushAll` gives for
 * being serial rather than `Promise.all`: this runs at the exact moment a
 * device has just regained a connection, which is the worst moment to open
 * eight sockets at once. Half of them time out and every one of those is
 * another thirty seconds (src/lib/requestTimeout.ts) before the member sees
 * anything.
 *
 * A pause rather than an await, because most providers' `reload` is
 * synchronous — it bumps a nonce that a React effect reads — so awaiting the
 * call returns immediately and staggers nothing. What is being spread is the
 * requests those effects then make.
 *
 * Nothing is waiting on this. A refresh nobody asked for is allowed to take
 * two seconds to work through eight providers; a member who taps Refresh gets
 * 'manual', which spends the same pause and is the one case where it is
 * noticeable — and eight providers is still under two seconds, against a read
 * that has already cost them thirty.
 */
exports.PAUSE_BETWEEN_MS = 250;
/* ── the registry ──────────────────────────────────────────────────────── */
const refreshers = new Map();
/** Consecutive passes in which this key was asked and stayed in 'error'. */
const attempts = new Map();
/**
 * Register this provider's read-again function.
 *
 * Keyed, and the key replaces rather than accumulates — the same rule
 * `registerFlush` states, for the same reason: providers register from an
 * effect that re-runs on a new auth revision, and an accumulating registry
 * would keep calling the previous account's reload.
 *
 * The returned unregister is a no-op if this key has already been taken over,
 * because unmount order is not the caller's to control and an unmount must
 * never delete a live registration.
 */
function registerRefresh(key, r) {
    refreshers.set(key, r);
    return () => {
        if (refreshers.get(key) === r) {
            refreshers.delete(key);
            attempts.delete(key);
        }
    };
}
/** How many providers currently have something registered. For the test. */
const refresherCount = () => refreshers.size;
exports.refresherCount = refresherCount;
/** How many times a key has been asked and stayed failed. For the test. */
const attemptsFor = (key) => attempts.get(key) ?? 0;
exports.attemptsFor = attemptsFor;
/**
 * Clear the give-up counters.
 *
 * Called for a 'reconnect' trigger, and on sign-out. Not exported as part of
 * the trigger path by accident: `refreshStale` calls it itself so a caller
 * cannot forget, and it is exported separately so a sign-out can reset without
 * running a pass.
 */
function noteEdge() {
    attempts.clear();
}
/** Everything, gone. For the tests, and for a sign-out that unmounts the tree. */
function resetRefreshers() {
    refreshers.clear();
    attempts.clear();
    running = null;
    askedAgain = false;
    lastRun = 0;
}
/** True while this key still has attempts left. 'manual' never gives up. */
function attemptsAllow(trigger, tried, max = exports.MAX_ATTEMPTS) {
    if (trigger === 'manual')
        return true;
    return tried < max;
}
const emptyPass = (declined) => ({ ran: [], skipped: [], givenUp: [], declined });
let running = null;
let askedAgain = false;
let lastRun = 0;
const realPause = (ms) => new Promise((res) => { setTimeout(res, ms); });
/**
 * Ask every provider that failed to read again, once.
 *
 * ── Writes first ─────────────────────────────────────────────────────────
 *
 * The queued writes are flushed BEFORE any read is re-run, and the order is
 * load-bearing rather than tidy. A member who logged three sets in a basement
 * has those sets on the phone and not on the server. Re-reading first hands
 * the provider the server's view — which does not contain them — and every
 * provider then has to merge its own queue back over the top. src/ui/workoutLog
 * does exactly that and is careful about it; not all of them are, and a member
 * watching their own sets blink out and back in has been shown something that
 * was never true either way. Sending first means the read that follows returns
 * the rows the member can already see.
 *
 * `flushAll` is single-flight itself and rejects nothing, so this costs nothing
 * when there is no queue and cannot fail the pass.
 *
 * ── Single flight ────────────────────────────────────────────────────────
 *
 * The same rule and the same reason as `flushAll`: the two triggers fire
 * together constantly, because coming back to the foreground is usually also
 * the moment the first request succeeds and raises the reconnect edge. A call
 * made while a pass is in flight does not start a second and is not dropped —
 * it sets `askedAgain`, and one more pass runs at the end, because a provider
 * may have failed after this pass had already read its status.
 *
 * ── Nothing is attempted while we know we cannot reach the server ─────────
 *
 * The same carve-out src/ui/offlineFlush.tsx makes: under 'offline' every
 * refetch fails, costs an attempt from the ceiling above, and leaves the
 * provider exactly where it was. 'unknown' DOES run — a cold launch has learnt
 * nothing yet, and that is the case this is most useful for.
 */
function refreshStale(trigger = 'manual', deps = {}) {
    const now = deps.now ?? Date.now;
    const canRead = deps.canRead ?? (() => (0, reachability_1.currentReach)() !== 'offline');
    const flushFirst = deps.flushFirst ?? offlineQueue_1.flushAll;
    const pause = deps.pause ?? realPause;
    const pauseMs = deps.pauseMs ?? exports.PAUSE_BETWEEN_MS;
    const max = deps.maxAttempts ?? exports.MAX_ATTEMPTS;
    if (running) {
        askedAgain = true;
        return running;
    }
    if (!mayRunNow(trigger, lastRun, now(), deps.gapMs))
        return Promise.resolve(emptyPass(true));
    if (!canRead())
        return Promise.resolve(emptyPass(true));
    // The edge clears the give-up counters BEFORE the pass reads them, so the
    // provider that used up its three attempts in a basement gets them back the
    // moment there is signal again. That is the entire value of distinguishing
    // this trigger from the other two.
    if (trigger === 'reconnect')
        noteEdge();
    // The latch is taken before the first await, for the reason `flushAll`
    // states: an async body runs synchronously only up to its first await, and
    // assigning `running` from an IIFE's result leaves a window in which a second
    // pass starts over the same providers.
    let settle = () => { };
    const pass = new Promise((res) => { settle = res; });
    running = pass;
    lastRun = now();
    void (async () => {
        const out = emptyPass(false);
        do {
            askedAgain = false;
            try {
                await flushFirst();
            }
            catch { /* a queue that will not send must not stop a read that would */ }
            // A snapshot, so a provider registering mid-pass is picked up by the next
            // one rather than being called while this list is walked.
            const batch = [...refreshers.entries()];
            let first = true;
            for (const [key, r] of batch) {
                // Still registered? A provider can unmount between the snapshot and
                // here, and calling a dead reload sets state on an unmounted tree.
                if (refreshers.get(key) !== r)
                    continue;
                let st;
                try {
                    st = r.status();
                }
                catch {
                    continue;
                }
                if (!(0, exports.needsRefetch)(st)) {
                    // Seen working. The failure that was being counted is over, so the
                    // next one starts from zero rather than inheriting this one's total.
                    attempts.delete(key);
                    if (!out.skipped.includes(key))
                        out.skipped.push(key);
                    continue;
                }
                const tried = attempts.get(key) ?? 0;
                if (!attemptsAllow(trigger, tried, max)) {
                    if (!out.givenUp.includes(key))
                        out.givenUp.push(key);
                    continue;
                }
                // Counted BEFORE the call, not after. A refetch that throws, or one
                // whose provider never publishes a status again, must still burn an
                // attempt — otherwise the ceiling is a ceiling only for the failures
                // that were polite about it.
                attempts.set(key, tried + 1);
                if (!first && pauseMs > 0)
                    await pause(pauseMs);
                first = false;
                try {
                    await r.refetch();
                }
                catch { /* this provider keeps its own state; the rest still get asked */ }
                if (!out.ran.includes(key))
                    out.ran.push(key);
            }
        } while (askedAgain);
        if (running === pass)
            running = null;
        settle(out);
    })();
    return pass;
}
