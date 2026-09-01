// ── Dynamic Type, as arithmetic ──────────────────────────────────────────────
//
// The other half of the job `src/lib/a11y.ts` does for colour. Contrast in this
// app is measured on every run; type size was not measured at all. The scale in
// `src/theme/scale.ts` pinned seven point sizes and, beside each of them, a
// LINE HEIGHT — and that second number is the defect.
//
// ── What React Native already does, and the one thing it does not ─────────
//
// `<Text allowFontScaling>` defaults to TRUE. So the app has always scaled its
// FONT SIZES with the phone's text setting, on both platforms, without a line
// of code. What React Native does not scale is `lineHeight`, which is a plain
// point value and stays exactly where it was written. Every one of the seven
// steps in scale.ts carries one:
//
//     body:  { fontSize: 15, lineHeight: 21 }
//
// A member on Larger Text at 200% gets 30pt glyphs laid out in a 21pt line. The
// text does not get bigger, it gets CLIPPED — descenders cut off, consecutive
// lines overlapping — and the bigger the reader asked for, the worse it reads.
// That is the state this file ends, and it is why the roadmap could truthfully
// say Dynamic Type is "not supported anywhere" while the font sizes were
// scaling the whole time: half of the mechanism was fighting the other half.
//
// ── The rule this file exists to hold ─────────────────────────────────────
//
//     React Native owns fontSize. We own every OTHER point measurement that
//     has to track the text — line height, the height of a box drawn around
//     one line, the diameter of a ring with a figure inside it.
//
// Multiplying fontSize here as well would scale it TWICE: once by us and again
// by the platform, so an accessibility size would land somewhere near 9×. That
// is the mistake a maintainer will reach for, which is why the rule is written
// at the top of the file rather than in a comment beside one call.
//
// ── Nothing here is capped, and that is deliberate ────────────────────────
//
// A ceiling on a person's text size is a ceiling on whether they can read the
// app at all. Where a fixed box was the problem, the box grows — see
// `atScale`, and the rings and label strips in `src/ui/kit.tsx` that now use
// it. The one place the app genuinely cannot follow all the way is the tab bar
// along the bottom, whose five names are as wide as the phone is; that is said
// on the Appearance screen rather than discovered as a row of ellipses.
//
// Nothing in here imports react-native. `PixelRatio.getFontScale()` is read in
// `src/theme/scale.ts`, which is the file that already touches the platform;
// the arithmetic is kept here so it can be argued with in a test.

/**
 * The smallest and largest text scales worth believing.
 *
 * iOS runs 0.82 at xSmall to 3.12 at AX5; Android's font scale reaches 2.0 in
 * Settings and further with a display-size change on top. The clamp is not a
 * cap on the reader — the platform still draws the glyphs at whatever size it
 * likes — it is a guard on OUR arithmetic, so a garbage reading (a zero, a
 * NaN, a negative) cannot collapse every line height in the app to nothing.
 */
export const MIN_FONT_SCALE = 0.8;
export const MAX_FONT_SCALE = 4;

/** Above this, the reader has asked for noticeably bigger text and layouts
 *  that pack things onto one line should stop trying. 1.3 is roughly iOS's
 *  xxLarge — the first step past the accessibility slider's default. */
export const LARGE_TYPE_SCALE = 1.3;

/**
 * A font scale we are willing to multiply by.
 *
 * 1 for anything unreadable, because 1 is the app exactly as it was drawn and
 * a wrong multiplier is worse than no multiplier: it would misreport line
 * heights for every reader, including the ones who never changed the setting.
 */
export function clampFontScale(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, raw));
}

/**
 * A pinned point measurement, grown to match the reader's text.
 *
 * Used for line heights, for the height of a strip that holds one line of
 * text, and for the diameter of a ring a figure is drawn inside. NOT for a
 * fontSize — see the rule at the top of this file.
 *
 * Rounded to a whole point. Fractional line heights are legal in React Native
 * and they land text on half pixels, which is exactly the blur an app is
 * trying to remove from the screen of somebody who has turned their text up.
 */
export function atScale(pt: number, scale: number): number {
  if (typeof pt !== 'number' || !Number.isFinite(pt)) return 0;
  return Math.round(pt * clampFontScale(scale));
}

/** Has the reader asked for noticeably larger text? */
export function isLargeTypeScale(scale: number): boolean {
  return clampFontScale(scale) >= LARGE_TYPE_SCALE;
}

/**
 * How many labels a strip of `widthPt` can still hold when text is at `scale`.
 *
 * The chart axis is the case: labels sit in fixed-width absolute boxes and
 * truncate to "14 A…" long before the line under them runs out of room. The
 * answer is fewer dates, not smaller ones — the existing `maxTicksForWidth`
 * already decides this from a MEASURED width, so this hands it a width divided
 * by the scale rather than teaching it a second rule.
 *
 * Never returns less than the width the caller would need for one label, which
 * is the caller's own floor to enforce; this only reports the effective width.
 */
export function effectiveWidth(widthPt: number, scale: number): number {
  if (typeof widthPt !== 'number' || !Number.isFinite(widthPt) || widthPt <= 0) return 0;
  return Math.max(1, Math.round(widthPt / clampFontScale(scale)));
}

/**
 * How many lines a label should be allowed, given the reader's text size.
 *
 * One line at ordinary sizes — the layout was drawn for one — and two once the
 * text is large enough that one line is a truncation rather than a fit. Used
 * where the alternative is an ellipsis in the middle of a short phrase.
 */
export function linesAtScale(scale: number, base = 1): number {
  return isLargeTypeScale(scale) ? base + 1 : base;
}

/**
 * What the Appearance screen says about the reader's current text size.
 *
 * Null at 1: there is nothing to report, and a screen that announces "your
 * text is normal" is noise. Above and below it the sentence names the setting
 * as the PHONE's, because it is — this app deliberately does not offer a text
 * size of its own to compete with the one the reader already set once for
 * every app they own.
 */
export function fontScaleNote(scale: number): string | null {
  const s = clampFontScale(scale);
  if (s === 1) return null;
  const pct = Math.round(s * 100);
  return s > 1
    ? `Your phone is set to ${pct}% text size and this app is following it.`
    : `Your phone is set to ${pct}% text size — smaller than standard — and this app is following it.`;
}
