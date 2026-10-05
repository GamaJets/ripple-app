import { revealOffset, type Span } from './revealOffset';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (a !== b) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const chip = (x: number, w: number): Span => ({ x, w });

/* ── the case that was on the screen ──────────────────────────────────────
   The Add Session sheet, iPhone 17 Pro: a 24-chip hour strip about 340pt wide
   in the viewport, the 9am chip roughly nine chips along. It opened at offset
   0 and the selection was nowhere on screen. */
{
  const ninth = chip(9 * 62, 58);
  const to = revealOffset(ninth, 340, 0);
  ok(to !== null, 'a selection off the right edge is revealed rather than left there');
  ok(to !== null && to + 340 >= ninth.x + ninth.w, 'and the chosen offset actually brings its far edge on screen');
  ok(to !== null && to <= ninth.x, 'without scrolling past its near edge');
}

/* ── it does not fight the reader's thumb ──────────────────────────────── */
{
  eq(revealOffset(chip(100, 60), 340, 0), null, 'a chip already fully visible is left alone');
  eq(revealOffset(chip(0, 60), 340, 0), null, 'including the first chip at rest');
  // Resting exactly on the edge is NOT visible enough: the padding is part of
  // the test, or a chip flush against the frame reads as cut off.
  ok(revealOffset(chip(340 - 60, 60), 340, 0) !== null,
    'a chip flush against the right frame is still brought clear of it');
}

/* ── both directions ──────────────────────────────────────────────────── */
{
  // Scrolled far right, selection is behind us on the left.
  const back = revealOffset(chip(0, 60), 340, 600);
  ok(back !== null && back < 600, 'a selection off the LEFT scrolls back towards it');
  eq(back, 0, 'and clamps at zero rather than going negative');

  const fwd = revealOffset(chip(900, 60), 340, 0);
  ok(fwd !== null && fwd > 0, 'a selection off the RIGHT scrolls forward');
}

/* ── degenerate input returns null rather than scrolling to NaN ─────────
   An onLayout that has not fired yet, a zero-width scroller during the first
   frame, a chip measured at zero. Each of these is ordinary on mount, and a
   scrollTo({x: NaN}) is a blank strip with no error to read. */
{
  eq(revealOffset(null, 340, 0), null, 'no measurement yet');
  eq(revealOffset(undefined, 340, 0), null, 'no measurement at all');
  eq(revealOffset(chip(100, 60), 0, 0), null, 'a scroller that has not been laid out');
  eq(revealOffset(chip(100, 0), 340, 0), null, 'a chip with no width');
  eq(revealOffset(chip(NaN, 60), 340, 0), null, 'an unmeasured x');
  eq(revealOffset(chip(100, 60), NaN, 0), null, 'an unmeasured viewport');
  const nanCurrent = revealOffset(chip(900, 60), 340, NaN);
  ok(nanCurrent !== null && Number.isFinite(nanCurrent), 'an unmeasured offset is read as the start, not as NaN');
}

/* ── a chip wider than the strip ───────────────────────────────────────── */
{
  const wide = revealOffset(chip(500, 400), 340, 0);
  ok(wide !== null && wide <= 500, 'a chip too wide to fit shows its START, where its label is');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('revealOffset: ok');
