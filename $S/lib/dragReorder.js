"use strict";
/**
 * Where a dragged row lands — the arithmetic behind press-and-hold reordering.
 *
 * Asked for twice: "should be able to hold an exercise and move and drop the
 * order" and then, after arrows shipped, "you should be able to press and hold
 * an exercise and drag it in the position you want it."
 *
 * ── Why this is not react-native-reanimated ───────────────────────────────
 *
 * The usual answer is `react-native-gesture-handler` + `react-native-reanimated`
 * with a draggable list on top. Reanimated 4 — the version this SDK resolves —
 * requires the New Architecture, and this app runs on the old one. Installing
 * it does not produce a slower drag; it produces an app that does not build.
 *
 * `PanResponder` and `Animated` are in React Native core, work on the old
 * architecture, and are already in every binary in the field. So this ships
 * over the air to people who already have the app, which reanimated could not
 * have done at any speed.
 *
 * ── Measured rows, not a fixed row height ─────────────────────────────────
 *
 * The tempting simplification is one constant: `Math.round(dy / ROW_HEIGHT)`.
 * It is wrong here and visibly so. An exercise row in this builder is not a
 * fixed height — it grows with a note, with a group badge, with the sets/reps/
 * weight row wrapping on a narrow phone. Dragging past two short rows and one
 * tall one would land somewhere nobody aimed at, and the further you drag the
 * worse the error compounds.
 *
 * So the caller measures each row (`onLayout`) and passes the heights. The rule
 * below is the one a person actually applies while dragging: the row goes where
 * its MIDDLE now sits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.targetIndex = targetIndex;
exports.applyMove = applyMove;
exports.shifts = shifts;
/**
 * The index the dragged row should occupy, given every row's height, where the
 * drag started, and how far the finger has moved vertically.
 *
 * Returns `from` unchanged when the answer cannot be trusted — a heights array
 * that does not match the list, a non-finite `dy` from a gesture that was
 * interrupted. A reorder is destructive to the coach's ordering, so an
 * uncertain answer must be "leave it alone" rather than a guess.
 */
function targetIndex(heights, from, dy) {
    if (!Number.isInteger(from) || from < 0 || from >= heights.length)
        return from;
    if (!Number.isFinite(dy))
        return from;
    if (!heights.every((h) => Number.isFinite(h) && h > 0))
        return from;
    // ── The rule, and the two wrong ones it replaces ────────────────────────
    //
    // To swap with the row below, this row has to end up beneath it — a journey
    // exactly as long as THAT row is tall. It changes places when it is half way,
    // so the threshold to displace a neighbour is half the NEIGHBOUR's height,
    // not half its own and not a constant.
    //
    // The first version of this file compared against the list with the dragged
    // row removed and the others closed up. That reads plausibly and is wrong:
    // with rows of equal height the gap lands exactly where the dragged row was,
    // so ANY movement at all crossed the threshold and the list flickered under
    // a stationary thumb. The tests below caught it, which is why they state the
    // pixel either side of every threshold rather than a comfortable value in
    // the middle.
    //
    // Comparing against the untouched original midpoints is wrong the other way:
    // a 100-tall row would need 150 of travel to move one place, so the list
    // lags behind the finger.
    //
    // Distances accumulate over rows already passed, so dragging across four
    // rows of different heights needs no more travel than the rows themselves
    // occupy.
    // No guard for dy === 0 and none for a one-row list. Both were here and both
    // were dead: a zero drag clears no threshold on the first row it looks at,
    // and a one-row list has no `j` in range to look at. Mutation tests deleted
    // each without changing a result, so they are gone rather than kept as
    // reassurance.
    const step = dy > 0 ? 1 : -1;
    const distance = Math.abs(dy);
    let idx = from;
    let travelled = 0;
    for (let j = from + step; j >= 0 && j < heights.length; j += step) {
        if (distance > travelled + heights[j] / 2) {
            idx = j;
            travelled += heights[j];
        }
        else
            break;
    }
    return idx;
}
/**
 * The list with the item at `from` moved to `to`. Returns the SAME array
 * reference when nothing moves, so a caller can skip a re-render and, more
 * importantly, so an accidental one-pixel drag does not register as an edit
 * against a programme somebody is part way through writing.
 */
function applyMove(items, from, to) {
    if (from === to)
        return items;
    if (!Number.isInteger(from) || !Number.isInteger(to))
        return items;
    if (from < 0 || from >= items.length)
        return items;
    if (to < 0 || to >= items.length)
        return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}
/**
 * How far each row must SHIFT while a drag is in progress, so the gap opens
 * under the finger. Index-aligned with `heights`; the dragged row itself gets
 * 0, because it is being moved by the gesture rather than by this.
 *
 * Rows between the origin and the destination move by the dragged row's height
 * — up when it is travelling down, down when it is travelling up. Everything
 * outside that span stays exactly where it is, which is what makes the list
 * read as one row changing places rather than the whole day sliding about.
 */
function shifts(heights, from, to) {
    const out = heights.map(() => 0);
    if (from === to)
        return out;
    if (from < 0 || from >= heights.length || to < 0 || to >= heights.length)
        return out;
    const h = heights[from];
    if (!Number.isFinite(h))
        return out;
    if (to > from)
        for (let i = from + 1; i <= to; i += 1)
            out[i] = -h;
    else
        for (let i = to; i < from; i += 1)
            out[i] = h;
    return out;
}
