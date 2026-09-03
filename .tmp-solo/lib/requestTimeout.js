"use strict";
// A ceiling on every request, and the argument for the number.
//
// ── The defect this closes ─────────────────────────────────────────────────
//
// Nothing this app sends has a timeout. `grep -rn AbortController src app`
// found the probe in src/ui/reachability.tsx and one screen-local cancel in
// app/(client)/foodlog.tsx, and nothing on the path every other request takes:
// src/lib/supabase.ts hands all of them through `observedFetch`
// (src/lib/reachability.ts), which awaits `fetch` and re-throws. React Native's
// fetch has no default timeout, so a socket nobody answers is waited on for
// ever.
//
// The conditions that produce that socket are the ones reachability.ts was
// written about and names: gym wifi behind a captive portal, a hotel network
// that has stopped forwarding, a bar of signal in a lift shaft. The radio is
// associated, the request leaves, and nothing comes back — AND NOTHING ERRORS.
// That last clause is the whole bug. `noteUnreachable` is never called, so the
// app still believes it is online: no banner, `canAssertEmpty` still true, and
// every provider waiting on that read sits in 'loading' with no way out. The
// screens all have correct 'error' copy and none of it can ever be reached.
//
// A coach reported the visible half — "I pull down to refresh and it keeps
// refreshing". src/lib/pullRefresh.ts put a 20-second ceiling on the SPINNER,
// which hands the gesture back. It does not and cannot fix the read: it does
// not own the request. This file owns the request.
//
// So the job here is narrow and it is not "add a timeout". It is: MAKE A HUNG
// REQUEST INTO A REAL TRANSPORT FAILURE, of exactly the shape reachability.ts
// already knows how to fold in, so that one hung read marks the app unreachable
// and every screen starts telling the truth.
//
// ── Why the abort has to be labelled ───────────────────────────────────────
//
// `isTransportFailure` in reachability.ts deliberately returns FALSE for an
// AbortError, and it is right to: an abort is normally US — the probe's own
// timeout, or a screen unmounting mid-read — and counting those would drop the
// app into 'offline' every time somebody navigated away from a slow screen.
//
// But the abort this file fires means the opposite thing. Nobody navigated; the
// network swallowed the request. If it were thrown as a bare AbortError the new
// timeout would be silently discarded by the very machinery it exists to feed,
// and we would have built a slightly faster way of learning nothing.
//
// Hence `requestTimeoutError` below: a real Error, carrying `requestTimedOut`,
// which `isTransportFailure` is taught to recognise BEFORE it looks at the
// abort names. Three distinct outcomes now survive all the way up to a caller,
// and they say three different things to a person:
//
//   · the server answered, with anything at all, 4xx included → it talked to
//     us, and `retryLine('online')` says so without blaming the router;
//   · we timed out           → `isRequestTimeout` is true, transport failure,
//                              `retryLine('offline')` sends them to their
//                              signal, which is where the problem is;
//   · the CALLER aborted     → neither; nothing is claimed and no state moves.
//
// A marker property rather than `instanceof` on a subclass, because this value
// crosses a bundler boundary and a Hermes boundary, and two copies of a class
// break `instanceof` in a way that is invisible until it is a support ticket.
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxAttempts = exports.DEFAULT_CEILINGS = exports.TRANSFER_CEILING_MS = exports.CALL_CEILING_MS = void 0;
exports.kindForUrl = kindForUrl;
exports.ceilingFor = ceilingFor;
exports.retryOnTimeout = retryOnTimeout;
exports.requestTimeoutError = requestTimeoutError;
exports.isRequestTimeout = isRequestTimeout;
exports.withRequestTimeout = withRequestTimeout;
exports.urlOf = urlOf;
exports.methodOf = methodOf;
/**
 * The ceiling for an ordinary call, in milliseconds.
 *
 * Thirty seconds, and the number is chosen from the two ends rather than picked
 * for feeling about right.
 *
 * THE FLOOR — what an honest but bad connection actually costs. Supabase runs
 * PostgREST with an 8-second statement timeout for the anon and authenticated
 * roles, so a query that is ever going to succeed has finished its server work
 * inside 8s; everything past that is transit. On the worst network this app is
 * used on and expected to work — a gym basement falling back to EDGE, a few
 * tens of kbps with multi-second stalls — a fresh TLS handshake is ~3 round
 * trips at up to a second each, and a hundred-row page of about 50 KB is
 * another ten-odd seconds. Call it sixteen seconds for a read that IS working
 * and IS going to arrive. Thirty is a shade under twice that.
 *
 * That margin is the point, and it is deliberately lopsided. Being too short is
 * the worse mistake here by a wide margin, because of how reachability.ts
 * folds a verdict: ONE unreachable verdict flips the whole app to 'offline'.
 * A ceiling that clips a slow-but-real read does not merely fail that read — it
 * puts an offline banner in front of somebody whose connection works, tells
 * four screens to stop asserting empty lists, and makes them distrust the
 * banner on the day it is true. So the number leans long on purpose, and
 * anything under about twenty seconds is a number this file would be arguing
 * against rather than for.
 *
 * THE CEILING ON THE CEILING — past a point the wait stops being information.
 * A minute of nothing is indistinguishable from broken to the person holding
 * the phone, and every second past their conclusion is a second the app spends
 * lying about being busy. Thirty is comfortably inside that.
 *
 * Note it sits ABOVE `MAX_SPIN_MS` (20s) in src/lib/pullRefresh.ts, and that
 * ordering is correct rather than accidental: the gesture comes back at 20s so
 * the coach can pull again, and the truth lands at 30s. Lining them up would
 * mean shortening a network ceiling to suit a spinner, which is the tail
 * wagging the dog.
 */
exports.CALL_CEILING_MS = 30000;
/**
 * The ceiling for a transfer, in milliseconds.
 *
 * Two minutes, set by the two things that actually take this long.
 *
 * A ten-megabyte exercise clip or progress photo over gym wifi at a genuine
 * megabit is eighty seconds of upload before anything is wrong. Thirty seconds
 * would fail every video every coach ever recorded away from their home
 * broadband — a real feature broken outright, in exchange for learning about a
 * dead network ninety seconds sooner on the one request that is worst placed to
 * tell us.
 *
 * And Supabase's own wall-clock limit for an edge function is 150 seconds. A
 * ceiling below that cuts off work the platform is still doing and would report
 * a dead network for a scan that was about to come back. Two minutes sits under
 * the platform's limit — so a genuinely stuck function is still ours to notice
 * — and above every transfer this app actually performs.
 *
 * The cost is stated plainly: on a dead network, a request classified
 * 'transfer' takes two minutes to say so. It is affordable precisely because it
 * is never the only request in flight — every screen that uploads has already
 * read something, and a 'call' on the same dead network has flipped the app to
 * offline and drawn the banner inside thirty seconds.
 */
exports.TRANSFER_CEILING_MS = 120000;
/**
 * Which kind of request a URL is.
 *
 * Read off the path, because that is the only thing available at the one place
 * every request passes through, and because Supabase's path layout happens to
 * carry exactly the distinction that matters.
 *
 * The storage exclusions are not pedantry. `object/sign`, `object/list`,
 * `object/info`, `object/copy` and `object/move` return a few hundred bytes of
 * JSON and never move a file; a signed-URL fetch is a 'call' wearing a storage
 * path, and giving it two minutes would make a document screen hang four times
 * longer than the list screen behind it for the same dead network.
 *
 * Anything not recognised — a third-party host, a URL that does not parse — is
 * a 'call'. The conservative default is the SHORTER ceiling, because an unknown
 * host is by definition not one of the two slow things named above.
 */
function kindForUrl(url) {
    const path = pathOf(url);
    if (path.includes('/functions/v1/'))
        return 'transfer';
    const at = path.indexOf('/storage/v1/object/');
    if (at >= 0) {
        const rest = path.slice(at + '/storage/v1/object/'.length);
        const head = rest.split('/')[0] ?? '';
        if (head === 'sign' || head === 'list' || head === 'info' || head === 'copy' || head === 'move')
            return 'call';
        return 'transfer';
    }
    return 'call';
}
/** The ceiling in force for one request. */
function ceilingFor(url, ceilings = exports.DEFAULT_CEILINGS) {
    return ceilings[kindForUrl(url)];
}
exports.DEFAULT_CEILINGS = { call: exports.CALL_CEILING_MS, transfer: exports.TRANSFER_CEILING_MS };
/**
 * May a request that timed out be sent again, on its own, without asking?
 *
 * By method, and the answer is only ever yes for GET and HEAD.
 *
 * WHY NOT FOR A WRITE. A POST that timed out is the ambiguous case: the request
 * may have reached the server, committed, and had only its REPLY lost. Sending
 * it again would take a class booking, a payment, a message, a logged set and
 * do it twice, and the person would have no way of knowing which. This codebase
 * has already decided this question once, in the other direction, and stuck to
 * it: src/lib/offlineQueue.ts separates a write the server REFUSED from a write
 * nobody answered precisely because they get opposite treatment, and an
 * attachment is deliberately not deleted on an ambiguous failure. Nothing in
 * this app carries an idempotency key, so there is nothing that would make a
 * second POST safe. PUT and DELETE are idempotent in HTTP's sense and are still
 * refused here, because PostgREST's PUT is an upsert and the thing at risk is
 * the user-visible effect rather than the row count.
 *
 * WHY YES FOR A READ. A GET has no effect to duplicate; the worst a second one
 * costs is bytes. And the failure it recovers from is real and common in the
 * exact place this work is aimed at: a captive portal that swallows the first
 * connection, a cell-to-wifi handoff that strands a socket mid-request. A fresh
 * connection frequently gets through where the stranded one never will.
 *
 * ONCE, not until it works. Thirty seconds of silence is not a dropped packet —
 * TCP has already retransmitted throughout it — so the odds fall off a cliff
 * after the first retry while the cost keeps climbing linearly. A second retry
 * would buy almost nothing and spend another half-minute of somebody's evening.
 *
 * AND IT COSTS NOTHING IN TIME-TO-TRUTH, which is what makes it affordable at
 * all. See `observedFetch`: each attempt reports its own verdict to
 * reachability as it happens, so the first timeout draws the offline banner at
 * thirty seconds whether or not a retry is still running behind it. The retry
 * extends how long that one read takes to give up. It does not extend how long
 * the app takes to stop claiming it is online.
 */
function retryOnTimeout(method) {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD';
}
/** How many times one request may be sent, including the first. */
const maxAttempts = (method) => (retryOnTimeout(method) ? 2 : 1);
exports.maxAttempts = maxAttempts;
/**
 * Build the error a timed-out request rejects with.
 *
 * The message has to survive `isTransportFailure`'s message check, which treats
 * anything matching /abort/i as ours-and-therefore-not-evidence. It does not
 * say "aborted" for that reason, and it says "timed out" because that is also
 * the honest word: from the caller's side nothing was cancelled, the server
 * just never answered.
 *
 * `name` is 'TimeoutError' to match what a platform AbortSignal.timeout()
 * produces, so anything that sniffs names rather than using `isRequestTimeout`
 * still lands somewhere sensible.
 */
function requestTimeoutError(url, method, ceilingMs) {
    const err = new Error(`No reply within ${Math.round(ceilingMs / 1000)}s for ${String(method || 'GET').toUpperCase()} ${redact(url)} — request timed out.`);
    err.name = 'TimeoutError';
    err.requestTimedOut = true;
    err.ceilingMs = ceilingMs;
    return err;
}
/** Was this thrown value our ceiling firing, rather than a refusal or a cancel? */
function isRequestTimeout(err) {
    return !!err && err.requestTimedOut === true;
}
/**
 * `fetch`, with a ceiling.
 *
 * Two independent mechanisms, and both are needed:
 *
 *   1. An AbortController on the request, so the socket is actually released
 *      rather than left holding a connection nobody is reading. This is the
 *      part that stops a phone accumulating dead sockets on a bad network.
 *
 *   2. A `Promise.race` against a rejection, so the CALLER is freed at the
 *      ceiling whatever the transport does about the abort. Not belt and
 *      braces: a runtime whose fetch ignores the signal, or has no
 *      AbortController at all, would otherwise leave the original for-ever
 *      wait in place, which is the bug. The race is the guarantee; the
 *      controller is the tidiness.
 *
 * A caller's own signal is chained rather than replaced. supabase-js passes one
 * on some auth paths and PostgREST exposes `.abortSignal()`, and dropping it
 * would quietly break every screen that cancels a read on unmount. When it
 * fires, this rejects with whatever the transport threw — an AbortError, which
 * reachability.ts correctly declines to learn from.
 *
 * The timer is cleared on every path out, success included. A per-request timer
 * left armed is a leak that scales with traffic, and on this path that is every
 * request the app makes.
 */
function withRequestTimeout(base, deps = {}) {
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((h) => { clearTimeout(h); });
    const ceilings = deps.ceilings ?? exports.DEFAULT_CEILINGS;
    return (input, init) => {
        const url = urlOf(input);
        const method = methodOf(input, init);
        const ceilingMs = ceilingFor(url, ceilings);
        const Ctl = typeof AbortController !== 'undefined' ? AbortController : null;
        const ctl = Ctl ? new Ctl() : null;
        const outer = init && init.signal ? init.signal : null;
        let done = false;
        let handle = null;
        let unchain = () => { };
        const finish = () => {
            if (done)
                return;
            done = true;
            clearTimer(handle);
            unchain();
        };
        // Chain, do not replace. An already-aborted caller signal is honoured
        // immediately so we do not open a socket the caller has given up on.
        if (ctl && outer) {
            if (outer.aborted) {
                try {
                    ctl.abort();
                }
                catch { /* a signal we cannot read is one we cannot honour */ }
            }
            else if (typeof outer.addEventListener === 'function') {
                const onOuterAbort = () => { try {
                    ctl.abort();
                }
                catch { /* as above */ } };
                outer.addEventListener('abort', onOuterAbort);
                unchain = () => {
                    try {
                        outer.removeEventListener('abort', onOuterAbort);
                    }
                    catch { /* as above */ }
                };
            }
        }
        const ceiling = new Promise((_resolve, reject) => {
            handle = setTimer(() => {
                if (done)
                    return;
                finish();
                // REJECT BEFORE ABORTING, and the order is load-bearing. `ctl.abort()`
                // rejects the in-flight fetch synchronously with an AbortError, and
                // that rejection would then win the race below — so the caller would
                // receive a bare AbortError, `isTransportFailure` would decline to
                // learn from it, and the app would sit at thirty seconds of silence
                // still believing it was online. Which is the original defect,
                // reintroduced by a line of tidying. Settle the race with OUR labelled
                // error first; the abort that follows is then landing on a promise
                // nobody is reading, which is exactly what it is for.
                reject(requestTimeoutError(url, method, ceilingMs));
                if (ctl) {
                    try {
                        ctl.abort();
                    }
                    catch { /* nothing to do about it */ }
                }
            }, ceilingMs);
        });
        const sent = ctl ? base(input, { ...(init ?? {}), signal: ctl.signal }) : base(input, init);
        // The losing side of the race still settles later — an aborted fetch
        // rejects. Unhandled, that is a red box in dev and a crash report in
        // production for a request we deliberately gave up on.
        sent.then(() => { }, () => { });
        return Promise.race([sent, ceiling]).then((res) => { finish(); return res; }, (err) => { finish(); throw err; });
    };
}
/* ── small readers ─────────────────────────────────────────────────────── */
/** The URL out of whatever `fetch` was handed: a string, a URL, or a Request. */
function urlOf(input) {
    if (typeof input === 'string')
        return input;
    if (input && typeof input.url === 'string')
        return input.url;
    try {
        return String(input ?? '');
    }
    catch {
        return '';
    }
}
/** The method, from the init or from a Request object, defaulting as fetch does. */
function methodOf(input, init) {
    const m = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    return String(m).toUpperCase();
}
/** Path only, so a query string full of ids never reaches the classifier. */
function pathOf(url) {
    const s = String(url ?? '');
    const afterScheme = s.indexOf('://');
    const from = afterScheme >= 0 ? s.indexOf('/', afterScheme + 3) : 0;
    if (from < 0)
        return '/';
    const cut = s.slice(from < 0 ? 0 : from);
    const q = cut.search(/[?#]/);
    return q >= 0 ? cut.slice(0, q) : cut;
}
/**
 * The URL as it may appear in an error message.
 *
 * Path only. A Supabase read carries its filters in the query string — member
 * ids, emails, a `select` naming columns — and an error message ends up in a
 * crash report (src/lib/crashQueue.ts). The path says which endpoint hung,
 * which is the whole diagnostic value, and none of the rest.
 */
function redact(url) {
    return pathOf(url) || '/';
}
