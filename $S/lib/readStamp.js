"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stampBusy = exports.noStamp = exports.landed = void 0;
exports.nextStamp = nextStamp;
/** True when the server answered. Written as a function because the two
 *  statuses that pass are not the same claim and a reader should see both. */
const landed = (s) => s === 'ready' || s === 'partial';
exports.landed = landed;
/** The starting point: nothing read yet. `<Fetched>` renders that as
 *  "Reading…" rather than as an age, which is the honest sentence. */
const noStamp = (status, token = null) => ({ at: null, status, token });
exports.noStamp = noStamp;
/**
 * The stamp after one render, given the last one.
 *
 * Moves `at` to `now` when a read has just landed, and leaves it exactly where
 * it was otherwise. "Just landed" is any of three things, and the third is why
 * `token` exists:
 *
 *   1. THE STATUS CHANGED INTO A LANDED ONE. The ordinary case: 'loading' →
 *      'ready', or 'error' → 'ready' after a reconnect.
 *   2. NOTHING HAS EVER BEEN STAMPED. A provider that is 'ready' on its first
 *      render — every provider when the backend is switched off, and any read
 *      that resolves before the screen mounts — would otherwise sit at "Reading…"
 *      for ever over figures that are on screen.
 *   3. THE PAYLOAD CHANGED WHILE LANDED. Not every provider announces its
 *      re-read as 'loading' first; some go 'ready' → 'ready'. Without this the
 *      stamp would freeze at the first read and go on ageing, which is the ONE
 *      direction `src/lib/freshness.ts` says this must not err in — claiming a
 *      figure is older than it is sends somebody to refresh something that was
 *      fine. Compared by identity, because that is what a provider changes when
 *      it publishes a new answer.
 *
 * Returns the PREVIOUS OBJECT when nothing about it changed. That is not a
 * micro-optimisation: handed to a React setter, an identical object is not a
 * state change, and a hook that returned an equal-but-new object on every
 * render would be the render loop this codebase spent a night finding. See
 * src/lib/dismissedSet.ts.
 */
function nextStamp(prev, status, token, now) {
    const same = prev.status === status && Object.is(prev.token, token);
    // A failed or in-flight read changes nothing a member can see about WHEN, so
    // the stamp is carried across untouched — the whole rule, in one line.
    if (!(0, exports.landed)(status))
        return same ? prev : { at: prev.at, status, token };
    if (same && prev.at != null)
        return prev;
    return { at: now, status, token };
}
/**
 * Whether a refresh is in flight, for the Refresh control's own label.
 *
 * 'loading' and nothing else. 'error' is not busy — it is finished and it
 * failed, and a button stuck on "Refreshing…" over a failed read is a screen
 * that looks like it is still trying when it is not.
 */
const stampBusy = (status) => status === 'loading';
exports.stampBusy = stampBusy;
