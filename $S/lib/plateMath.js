"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATES = exports.BARS = void 0;
exports.loadBar = loadBar;
/** The bars on the rack, standard first. Index-addressed by the screen so that
 *  flipping unit swaps a 20 kg bar for a 45 lb one rather than leaving a
 *  selected "20" that means nothing in pounds. */
exports.BARS = {
    kg: [20, 15],
    lb: [45, 35],
};
/** Plate denominations, heaviest first — the order a greedy fill needs and the
 *  order they are loaded onto the sleeve. */
exports.PLATES = {
    kg: [25, 20, 15, 10, 5, 2.5, 1.25],
    lb: [45, 35, 25, 10, 5, 2.5, 1.25],
};
/**
 * Above any bar that can be loaded, in either unit, and here only as a loop
 * guard: the fill below adds plates one at a time, so a target arriving as 1e9
 * — a paste, a bug upstream — would spin for a very long time before answering.
 * `readLift` in src/lib/units.ts refuses anything over 600 kg / 1300 lb long
 * before this, so nothing a person types reaches it.
 */
const MAX_TARGET = 2000;
/**
 * Hundredths, so the fill is integer arithmetic and `exact` below is an integer
 * comparison rather than a float equality.
 *
 * Honesty about what this does and does not buy: every denomination on both
 * racks today (2.5, 1.25, …) happens to be exactly representable in binary, so
 * a float fill would give the same answers, and a mutation removing this
 * rounding does NOT fail the test file. It is here because that is a property
 * of the current plate list rather than of the fill — the moment somebody adds a
 * denomination that is not a power-of-two fraction, a float `total === target`
 * starts reporting a bar that loads perfectly as "closest loadable", which is a
 * warning about a number the client asked for and got.
 */
const H = 100;
const hun = (n) => Math.round(n * H);
/**
 * Break a target load into plates for one side of the bar.
 *
 * Greedy, heaviest first, which is both the optimal fill for these
 * denominations and the order somebody loads a sleeve. Never overshoots: a
 * target the rack cannot make comes back as the closest load UNDER it with
 * `exact: false`, because a bar loaded heavier than asked is a rep the client
 * did not agree to.
 *
 * Returns null for a target that is not a usable number, and for one lighter
 * than the bar — "load 15 kg on a 20 kg bar" has no answer, and answering 0
 * would present the empty bar as if it were what was asked for.
 */
function loadBar(target, bar, unit) {
    if (target == null || !Number.isFinite(target))
        return null;
    if (!Number.isFinite(bar) || bar <= 0)
        return null;
    if (target > MAX_TARGET)
        return null;
    if (target < bar)
        return null;
    const barH = hun(bar);
    // Floor rather than round: half a hundredth of a unit cannot be split across
    // two sleeves, and rounding it up would report a load heavier than the target.
    let remH = Math.floor((hun(target) - barH) / 2);
    const plates = [];
    let sideH = 0;
    for (const p of exports.PLATES[unit]) {
        const pH = hun(p);
        while (remH >= pH) {
            plates.push(p);
            remH -= pH;
            sideH += pH;
        }
    }
    const totalH = barH + sideH * 2;
    return {
        perSide: sideH / H,
        plates,
        total: totalH / H,
        exact: totalH === hun(target),
    };
}
