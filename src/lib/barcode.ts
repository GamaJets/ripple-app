// Code 39 barcode generator (pure). Turns a member id into bar/space segments a
// gym scanner can read. Code 39 is self-checking, needs no checksum, and covers
// 0-9 A-Z and a few symbols — ideal for membership numbers. Renderer draws the
// returned segments as a row of Views.

// Canonical Code 39 patterns: 9 elements each (bar,space,bar,…), n=narrow w=wide.
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
  'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn',
  'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
  'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  '$': 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
};

export interface BarSeg { w: number; bar: boolean }

/** Encode text as Code 39 segments. narrow width = 1 unit, wide = ratio units. */
export function code39Segments(text: string, ratio = 3): BarSeg[] {
  const clean = (text || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '');
  const chars = ('*' + clean + '*').split('');
  const segs: BarSeg[] = [];
  chars.forEach((ch, ci) => {
    const pat = PATTERNS[ch] || PATTERNS['*'];
    for (let i = 0; i < pat.length; i++) {
      segs.push({ w: pat[i] === 'w' ? ratio : 1, bar: i % 2 === 0 });
    }
    if (ci < chars.length - 1) segs.push({ w: 1, bar: false }); // inter-char gap
  });
  return segs;
}

/* ── fitting a symbol into the space a phone actually has ───────────────────
 *
 * A Code 39 symbol is a fixed number of UNITS wide, and the renderer picks how
 * many points a unit is. app/(client)/access.tsx picked it as
 *
 *     Math.max(1, Math.min(2, available / totalUnits))
 *
 * and that floor of 1 is the defect. The member number widened from four digits
 * to `PRE-` plus nine base-36 characters (src/lib/membership.ts), which at the
 * 3:1 wide-to-narrow ratio is 239 units including the start and stop guards. A
 * 320-point screen — an iPhone SE, or any phone in Display Zoom — leaves 224
 * points inside the white card, so the floor drew 239 points of barcode into
 * 224 points of space. The row is centred, so roughly seven and a half points
 * came off EACH END: the start and stop guards, which Code 39 cannot be decoded
 * without. The member sees a full, clean, plausible barcode and the scanner at
 * the turnstile reads nothing, with a queue behind them.
 *
 * The way out is not a thinner bar. Code 39 permits any wide-to-narrow ratio
 * from 2:1 to 3:1, and 2:1 spends 194 units on the same text — so on that same
 * 320-point screen the whole symbol fits AND the narrow bar comes out at 1.15
 * points, WIDER than the 1.0 the clipped version was drawing. Nothing is traded
 * away: a narrower ratio is a legal symbol, and a clipped one is not a symbol.
 *
 * Pure, and separate from the screen, because "does this fit" is arithmetic and
 * arithmetic is the part worth arguing with in a test.
 */

/** The two ratios this may draw at, widest first. Both are inside the 2:1–3:1
 *  the standard allows; 3:1 is the more tolerant of a poor scanner, so it is
 *  tried first and only given up when it does not fit. */
export const CODE39_RATIOS: readonly number[] = [3, 2];

/** The narrowest element worth drawing, in points. Below this a laser has
 *  nothing to resolve — but a symbol drawn under it is still better than one
 *  drawn over the edge of the card, so it is a preference and not a floor. */
export const CODE39_MIN_UNIT = 1;

/** The widest. A short number on a tablet should not become a wall. */
export const CODE39_MAX_UNIT = 2;

export interface Code39Fit {
  segs: BarSeg[];
  /** Points per narrow element. */
  unit: number;
  /** The wide-to-narrow ratio this was drawn at. */
  ratio: number;
  /** Total width in units, guards and inter-character gaps included. */
  units: number;
  /** What it will actually measure, in points. Never more than `available`. */
  width: number;
  /** Whether `unit` reached `CODE39_MIN_UNIT`. False is not a failure to draw —
   *  the symbol is complete either way — it is a caller's cue that the bars are
   *  thinner than a scanner likes. */
  crisp: boolean;
}

/**
 * The widest complete symbol that fits in `available` points.
 *
 * Never returns something wider than `available`. That is the whole point: a
 * symbol that overflows is silently clipped by its parent and a clipped Code 39
 * is not a Code 39.
 */
export function code39Fit(
  text: string,
  available: number,
  minUnit: number = CODE39_MIN_UNIT,
  maxUnit: number = CODE39_MAX_UNIT,
): Code39Fit {
  const room = Number.isFinite(available) && available > 0 ? available : 0;
  let last: Code39Fit | null = null;
  for (const ratio of CODE39_RATIOS) {
    const segs = code39Segments(text, ratio);
    const units = Math.max(1, segs.reduce((n, s) => n + s.w, 0));
    const unit = Math.min(maxUnit, room / units);
    const fit: Code39Fit = { segs, unit, ratio, units, width: units * unit, crisp: unit >= minUnit };
    if (fit.crisp) return fit;
    last = fit;
  }
  // Neither ratio reaches a crisp bar. The narrowest ratio is still the one
  // that fits most symbol into the space, so that is what is drawn — complete
  // and thin, rather than fat and cut in half.
  return last!;
}
