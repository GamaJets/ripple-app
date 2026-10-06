// Where a value sits vertically in a sparkline, including when nothing moved.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// Every trend drawing in this app scaled its series with
//
//     const rng = (max - min) || 1
//
// and the `|| 1` is there to stop a division by zero when every reading is the
// same. It does stop it, and then it puts the line on the FLOOR: with `max ===
// min`, `(v - min) / 1` is 0 for every point, so every point lands at whichever
// end of the band 0 maps to.
//
// That makes two opposite truths the same picture. On a coach's client profile,
// 5 Oct 2026: a client who had trained no days in eight weeks drew a flat
// purple line along the bottom — and a client who had trained five days a week
// for eight weeks would have drawn the identical line in the identical place.
// On a weight trend it is worse, because weight that has not moved is the
// ORDINARY case and the floor reads as "the lowest it has ever been".
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// A flat series is drawn down the MIDDLE. It is the only position that says
// what a flat series means — this did not move — without also saying something
// about the level, which a band of one value cannot know. The reading itself is
// printed beside the drawing in every caller, so the number is never in doubt;
// it is only the shape that has to stop lying.

/**
 * The y for `v` in a band running from `top` to `bottom` (SVG coordinates, so
 * `top` is the smaller number and larger values sit higher).
 *
 * `min` and `max` are the series' own extremes. When they are equal — or when
 * anything about them is not a finite number, which is what an empty series
 * gives through `Math.min()` — the band has no range to place anything in and
 * the midpoint is the answer.
 */
export function sparkY(v: number, min: number, max: number, top: number, bottom: number): number {
  const mid = (top + bottom) / 2;
  if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max)) return mid;
  const span = max - min;
  if (!(span > 0)) return mid;
  return bottom - ((v - min) / span) * (bottom - top);
}
