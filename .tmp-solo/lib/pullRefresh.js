"use strict";
// The pull-to-refresh spinner's whole life, with a ceiling on it.
//
// ── The report this closes ─────────────────────────────────────────────────
//
// "I pull down to refresh and it keeps refreshing, wheel spinning."
//
// `src/ui/pullToRefresh.tsx` cleared the spinner in the last `.then()` of a
// promise chain, after the screen's reload had settled plus a floor. Every
// branch of that chain is correct and it has a `.catch()`, so a read that FAILS
// clears it. What nothing in it handles is a read that never settles at all:
//
//   · `src/lib/supabase.ts` hands every request through `observedFetch`
//     (src/lib/reachability.ts), which awaits `fetch` and re-throws — there is
//     no AbortController anywhere in this app and no request has a timeout, so
//     React Native's fetch waits for the socket forever;
//   · the conditions that produce a socket that never answers are the ones
//     reachability.ts was written about and names: a gym wifi with a captive
//     portal, a hotel network that has stopped forwarding, a bar of 5G in a lift
//     shaft. The radio is associated, the request goes out, nothing comes back
//     and nothing errors;
//   · so the promise never settles, the last `.then()` never runs, `refreshing`
//     stays true and the wheel spins until the app is killed.
//
// And it is worse than one stuck spinner, which is why this is a hook-level fix
// rather than a screen-level one. The re-entry guard is a ref that is cleared in
// that same final `.then()`, so a single hung read leaves `busy` true for the
// life of the screen: every later pull returns immediately and does nothing.
// The gesture the app tells people to use is then permanently dead, which is
// exactly the shape of "it keeps refreshing" followed by nothing working.
//
// ── Why a ceiling and not a shorter one ────────────────────────────────────
//
// This does not cancel the read — it cannot, because it does not own the
// request, and a read that answers late is still worth having. It ends the
// SPINNER, which is a claim about the app being busy, and hands the gesture
// back. The screens underneath already say what they know: every provider in
// this app carries a `LoadStatus`, and a read still in flight is 'loading'
// there whatever this does.
//
// So the ceiling is set well past any honest read on a mobile network. It is
// not a timeout dressed up as one: nothing that is going to answer is cut off
// by it, and the only pull it changes is one that was never going to end.
//
// ── Why the generation counter ─────────────────────────────────────────────
//
// Once the ceiling can end a spin, a second pull can start while the first
// read is still out there. If that first read then settles it must not clear
// the SECOND spinner — the coach would watch a fresh pull snap away after a few
// hundred milliseconds and read it as the gesture not registering, which is the
// conclusion the whole file exists to stop somebody reaching. Each spin carries
// its number and only clears its own.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SPIN_MS = exports.MIN_SPIN_MS = void 0;
exports.makeRefresher = makeRefresher;
/**
 * How long the spinner stays up at minimum, in milliseconds.
 *
 * Most `reload` functions in this app return void: they bump a revision, or set
 * a state that an effect watches, and the read happens somewhere the caller
 * cannot await. Resolving instantly would snap the spinner away before the
 * finger has left the glass, which reads as "the gesture did not register".
 *
 * Short enough not to be a delay anybody waits on, long enough to be seen.
 */
exports.MIN_SPIN_MS = 450;
/**
 * How long the spinner may stay up at most, in milliseconds.
 *
 * Twenty seconds is far longer than any read this app makes on a working
 * connection and far shorter than forever, which is the only other number on
 * offer today. A person who has been watching a wheel for twenty seconds has
 * already decided it is broken; the point is that they can pull again.
 */
exports.MAX_SPIN_MS = 20000;
/**
 * A pull-to-refresh spinner that always ends.
 *
 * A rejected reload does NOT rethrow. The screen already has a status and
 * already says what went wrong; a pull-to-refresh that threw out of a gesture
 * handler would take the screen down over a failure it is designed to survive.
 */
function makeRefresher(deps) {
    const now = deps.now ?? (() => Date.now());
    const schedule = deps.schedule ?? ((fn, ms) => { setTimeout(fn, ms); });
    const floorMs = deps.floorMs ?? exports.MIN_SPIN_MS;
    const ceilingMs = deps.ceilingMs ?? exports.MAX_SPIN_MS;
    // Which spin is on screen. Only the spin that owns the number may end it.
    let generation = 0;
    let busy = false;
    const end = (mine) => {
        if (!busy || mine !== generation)
            return;
        busy = false;
        deps.setRefreshing(false);
    };
    const onRefresh = () => {
        // A second pull that arrives while the first read is in flight would
        // otherwise fire the read again — and on a slow connection that is exactly
        // when somebody pulls twice.
        if (busy)
            return;
        busy = true;
        generation += 1;
        const mine = generation;
        deps.setRefreshing(true);
        const started = now();
        schedule(() => end(mine), ceilingMs);
        void Promise.resolve()
            .then(() => deps.reload())
            .catch(() => { })
            .then(() => new Promise((r) => schedule(() => r(), Math.max(0, floorMs - (now() - started)))))
            .then(() => end(mine));
    };
    return { onRefresh, busy: () => busy };
}
