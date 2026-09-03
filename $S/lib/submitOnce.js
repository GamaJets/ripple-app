"use strict";
// One tap, one write.
//
// ── The defect this closes ─────────────────────────────────────────────────
//
// app/(client)/checkin.tsx ends with `<Cta label="Send Check-in" onPress={submit} wide />`
// and `submit` is an async function that awaits two network writes before it
// says anything. `Cta` is a bare `Pressable` (src/ui/kit.tsx) with no guard of
// its own, and that screen had no `busy` state, no `disabled` and no ref. So
// between the tap and the alert — which on a gym's wifi is now up to the
// transport ceiling in src/lib/requestTimeout.ts, thirty seconds — the button
// looks exactly as it did before it was pressed, and a member who thinks the
// tap did not register presses it again.
//
// The second press is not harmless. `sendCheckIn` mints a fresh local id per
// call (src/ui/checkins.tsx), so the coach gets two check-ins for one week and
// the member gets two "Check-in sent" alerts. app/(client)/measurements.tsx is
// worse: `addEntry` inserts a new row set each time, and that provider's own
// header explains why the duplicate cannot then be seen or deleted —
// "rowsToEntries groups by taken_at and the last row of a kind wins, so the
// screen draws one entry either way and nobody can see the duplicate". A second
// entry for today also makes `latest` and `prev` the same morning, so every
// delta on the screen collapses to zero and the real change since the last
// measurement disappears.
//
// ── Why a ref and not a `busy` useState ────────────────────────────────────
//
// Because `useState` does not guard this. `if (busy) return; setBusy(true)`
// reads `busy` out of the closure the handler was created in, and that value
// does not change until React re-renders — so two taps inside one frame both
// see `false` and both proceed. Several screens in this app carry that shape
// and are protected only by the tap window being short. The flag here is a
// plain variable set BEFORE the first await, which is the only version that is
// actually a gate.
//
// ── Why there is deliberately no ceiling on it ─────────────────────────────
//
// src/lib/pullRefresh.ts puts a twenty-second ceiling on the refresh spinner
// and is right to: a pull is idempotent, so handing the gesture back early
// costs at worst a second read. A SUBMIT is not idempotent, and re-arming the
// button while the first write is still out there is the bug this file exists
// to stop — it would file the second check-in itself, on a timer, without
// anybody tapping anything.
//
// That is affordable now and was not before: src/lib/requestTimeout.ts gives
// every request an AbortController and a ceiling, and a write is never retried
// (`retryOnTimeout` allows GET and HEAD only), so a hung write now throws
// rather than hanging for ever. The job settles; the gate opens; nothing has to
// guess on its behalf.
//
// ── Why a throw is swallowed ───────────────────────────────────────────────
//
// Same reason pullRefresh gives: this runs inside a gesture handler, and an
// exception out of one takes the screen down over a failure the screen is
// designed to survive. The job is expected to report its own outcome — every
// write in this app returns what happened rather than throwing it — so a throw
// reaching here is a bug to be reported, not a sentence to be shown.
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSubmitGate = makeSubmitGate;
/**
 * A submit that cannot be entered twice.
 *
 * The second tap is DROPPED, not queued. Queuing it would file the second
 * check-in a moment later, which is the outcome being prevented — the member
 * did not mean to send two, they meant to send one and were not told the first
 * had gone.
 */
function makeSubmitGate(deps) {
    // Not React state. Set before the first await, so two taps in one frame
    // cannot both read it as false. See the header.
    let running = false;
    let turnedAway = false;
    const run = async (job) => {
        if (running) {
            turnedAway = true;
            return;
        }
        running = true;
        turnedAway = false;
        deps.setBusy(true);
        try {
            await job();
        }
        catch (e) {
            deps.onError?.(e);
        }
        finally {
            // Whichever way it went. A gate left shut by a throw is a button that
            // never works again, and the member's only way out is to kill the app.
            running = false;
            deps.setBusy(false);
        }
    };
    return { run, busy: () => running, blocked: () => turnedAway };
}
