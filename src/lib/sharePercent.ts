// A share, written as a percentage, that never rounds a real number away.
//
// ── The sentence this exists for ──────────────────────────────────────────
//
// Seen on an iPhone, on the coach's Schedule screen, in one block:
//
//     Booked · 1 session
//     248 open slots · 0% of your slots are filled
//
// Both figures came off the same two numbers and both were computed
// correctly. `Math.round((1 / 249) * 100)` is 0. So the screen said, in the
// same breath, that a session is booked and that none of the slots are filled.
//
// A coach reading that either concludes the number is broken or concludes the
// booking has not landed, and the second one costs somebody a session. The
// arithmetic was right; what was wrong was writing an answer of zero for a
// quantity that is not zero.
//
// ── The rule ─────────────────────────────────────────────────────────────
//
// A rounded percentage may print 0% ONLY when the underlying count is zero,
// and 100% ONLY when it is everything. Anything in between that rounds to an
// endpoint is written as "under 1%" or "over 99%" — longer, and true.
//
// This is the same refusal `fig()` makes about an absent number and
// `minorMoney` makes about an amount with no currency: a figure that reads as
// a fact the data does not support is worse than a figure that reads as
// approximate.
//
// ── Why a string and not a number ────────────────────────────────────────
//
// Because the answer is sometimes not a number. A caller that wanted a number
// back would have to re-implement the endpoint rule to render it, which is
// how the rule comes to exist in three places and hold in one. Callers that
// need the ratio for a ring or a bar already have `part / whole` and should
// use it directly — a ring is a proportion drawn to scale and has no rounding
// to get wrong.

/**
 * `part` out of `whole`, as a percentage a person can read.
 *
 * Null when there is no share to state: a whole of nought is not a
 * denominator, and neither is anything unreadable. Null is never "0%" —
 * "none of your slots are filled" and "you have no slots" are different
 * sentences and a screen has to be free to say the right one.
 *
 * A `part` larger than `whole` clamps to 100%: it is not this function's job
 * to decide what a coach with more bookings than slots is looking at, and
 * "112%" in a sentence about a share is a bug report from the reader.
 */
export function sharePercent(part: number | null | undefined, whole: number | null | undefined): string | null {
  // `Number(null)` is 0, and 0 is finite — so a missing part would arrive as a
  // real nought and print "0%" about a figure nobody read. Checked before the
  // coercion, not after it.
  if (part == null || whole == null) return null;
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return null;
  if (p <= 0) return '0%';
  if (p >= w) return '100%';
  const pct = Math.round((p / w) * 100);
  // Rounded down on to zero from something that is not zero.
  if (pct <= 0) return 'under 1%';
  // Rounded up on to a hundred from something that is not everything.
  if (pct >= 100) return 'over 99%';
  return `${pct}%`;
}
