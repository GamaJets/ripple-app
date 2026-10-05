// Where a horizontal strip has to scroll to so its selected chip is visible.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// app/(trainer)/calendar.tsx already wrote it down, at the availability sheet:
// "these are horizontal scrollers that always start at their left end, so at
// the defaults the selected chip (7am, 7pm) sat off the right edge and NOTHING
// visible on the row said what was selected — a coach read a row of grey chips
// and had to scroll sideways twice to find out what they were about to save."
//
// The answer taken then was to print the value in the heading — "From ·
// 7:00am", "Time · 9:00am". That tells the reader what is selected and still
// leaves the control LOOKING unset: on an iPhone 17 Pro the Add Session sheet
// opens on a strip reading 12am, 1am, 2am… with no chip lit anywhere on it,
// over a heading that says 9:00am. Seen on the simulator, 5 Oct 2026.
//
// So the strip moves to its own selection instead. This is the arithmetic half,
// kept out of the component because it is the half that can be wrong in a way
// nobody sees: an off-by-one here scrolls to the wrong chip, and on a device
// that reads as "the picker jumps about", which is not a sentence anybody
// debugs from.
//
// ── what it will not do ───────────────────────────────────────────────────
//
// It returns null when the chip is already fully on screen. A strip that
// re-scrolls on every render fights the reader's own thumb: tapping a chip at
// the right-hand edge would yank the row, and a reader browsing the far end of
// a 24-hour strip would be dragged back the moment anything re-rendered.

/** A chip's position inside the scroller's content, in points. */
export interface Span { x: number; w: number }

/**
 * The offset to scroll to, or null to leave the strip where it is.
 *
 * `viewport` is the scroller's own visible width and `current` its present
 * offset. A chip wider than the viewport is pinned to its left edge rather
 * than centred — centring it would hide its label, which is the one part that
 * has to be readable.
 *
 * `pad` keeps a sliver of the neighbouring chip in view, so a revealed
 * selection still reads as a row that continues rather than as the end of one.
 */
export function revealOffset(
  sel: Span | null | undefined,
  viewport: number,
  current: number,
  pad = 12,
): number | null {
  if (!sel || !Number.isFinite(viewport) || viewport <= 0) return null;
  if (!Number.isFinite(sel.x) || !Number.isFinite(sel.w) || sel.w <= 0) return null;
  const at = Number.isFinite(current) ? Math.max(0, current) : 0;

  // Already fully visible, with its padding: nothing to do. The padding is
  // part of the test and not only of the target, or a chip resting exactly on
  // the edge would be judged visible and never brought clear of it.
  //
  // Clamped at zero, because the FIRST chip has no room for padding before it
  // and would otherwise be judged off-screen for ever: its padded edge is -12,
  // which is never >= an offset of 0, so a strip resting at its start would
  // "reveal" the chip it was already showing. Harmless on screen and wrong in
  // the one place this file exists to be right about.
  const leftEdge = Math.max(0, sel.x - pad);
  const rightEdge = sel.x + sel.w + pad;
  if (leftEdge >= at && rightEdge <= at + viewport) return null;

  // Too wide to fit: show its start, which is where its label begins.
  if (sel.w + pad * 2 >= viewport) return Math.max(0, leftEdge);

  // Off the left: bring it to the left edge. Off the right: to the right edge.
  // Never centred — a reader scanning a strip reads it in its own direction,
  // and a selection yanked to the middle loses the chips before it.
  const to = leftEdge < at ? leftEdge : rightEdge - viewport;
  return Math.max(0, to);
}
