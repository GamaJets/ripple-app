// ── The scale ────────────────────────────────────────────────────────────────
// Type, space, radius and elevation, as a small fixed set. Colour lives in
// `tokens.ts` (10 palettes); this file is everything *underneath* colour.
//
// Why this exists: the app had 3,814 inline style objects, 25+ distinct
// borderRadius values, 25+ distinct fontSize values (including 8.5, 11.5, 12.5,
// 13.5), and 1,139 of its 1,230 fontWeight declarations set to '700' or '800' —
// exactly one piece of text in the whole app was lighter than 600. Nobody
// consciously notices 14px vs 15px padding; everybody feels the result. These
// scales are deliberately small enough to hold in your head.
//
// House rules
//   · Three weights only: 400 body, 500 emphasis, 600 values and titles.
//     Never 700/800/900 — that single change does most of the visual work.
//   · Exactly ONE hero figure per screen.
//   · Status colours (warn/crit) are reserved for status and are never used as
//     text colour; a coloured mark sits *beside* ink-coloured text instead.
//   · Borders divide; elevation groups. Don't use a border to fake depth.
import { PixelRatio, StyleSheet, type TextStyle } from 'react-native';
import { atScale, clampFontScale } from '../lib/typeScale';

/** Space — 4pt-derived, 7 steps. */
export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;

/** Screen gutter and the gap a hairline-separated section carries. */
export const layout = { gutter: 22, section: sp.xl } as const;

/** Radius — three steps, down from 25+. */
export const radius = { sm: 10, md: 16, pill: 999 } as const;

/** Hairline: divides. One value, used everywhere a rule is drawn. */
export const hairline = StyleSheet.hairlineWidth;

/**
 * Elevation — two steps. Cards rest at e1; sheets and modals sit at e2.
 * iOS reads the shadow*, Android reads elevation; both are set so the two
 * platforms agree.
 */
export const elevation = {
  e1: {
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  e2: {
    shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  /**
   * For a full-screen overlay drawn as an ordinary sibling rather than a
   * <Modal> — the shape src/ui/WhatsNew.tsx uses and argues for.
   *
   * It carries no shadow, only a stacking order, and it exists because iOS and
   * Android disagree about what "on top" means. iOS stacks siblings by tree
   * order, so an overlay rendered last draws last and looks correct. Android
   * stacks by ELEVATION first, and anything drawn with `e2` sits at 12 — so a
   * card or a sheet inside the screen underneath painted straight over the top
   * of an overlay that had none, and the coach was left looking at the screen
   * they had just been reading with What's New somewhere behind it.
   *
   * 24 rather than 13: it must beat `e2` and anything a screen composes on top
   * of it, and there is nothing above this in the app. `zIndex` is set with it
   * so the two platforms are told the same thing in the two vocabularies they
   * each understand, rather than one of them being left to infer it.
   */
  overlay: { elevation: 24, zIndex: 1000 },
} as const;

/* ── Dynamic Type ───────────────────────────────────────────────────────────
 *
 * `fontScale` is the reader's own text size, off the phone. See
 * src/lib/typeScale.ts for the whole argument; the short version is the one
 * rule that governs everything below:
 *
 *     React Native scales fontSize for us and does NOT scale lineHeight.
 *
 * So a member on Larger Text at 200% was being drawn 30pt glyphs inside the
 * 21pt line this file pinned beside them — clipped descenders and overlapping
 * lines, getting worse the more legibility they asked for. Every lineHeight
 * here is now multiplied by the same number the platform is multiplying the
 * font size by, and the two agree again.
 *
 * fontSize is deliberately NOT multiplied here. Doing it in both places is the
 * one mistake available in this file and it squares the scale.
 *
 * Read ONCE, at module load, rather than through a hook. Two reasons. Three
 * and a half thousand inline style objects in this app spread `ty.body` into a
 * literal, and a hook cannot reach a single one of them — a module constant
 * fixes every screen in the app without touching any of them. And the value is
 * a device setting: changing it on iOS sends the app through a full remount,
 * so the constant is re-read at the moment it changes.
 */
export const fontScale = clampFontScale((() => {
  // Guarded for the same reason `deviceRegion()` in unitPreference.ts is: this
  // runs during module evaluation, and a throw here takes out every screen
  // that imports the scale, which is all of them. A missing reading means the
  // app as it was drawn, never a blank app.
  try { return PixelRatio.getFontScale(); } catch { return 1; }
})());

/** A pinned point measurement grown to the reader's text — a line height, a
 *  strip that holds one line, the diameter of a ring with a figure in it.
 *  Never a fontSize. Bound to the live scale so callers cannot pass the wrong
 *  one; `atScale` in src/lib/typeScale.ts is the arithmetic and is tested. */
export const grown = (pt: number): number => atScale(pt, fontScale);

/**
 * Type — 7 steps. `hero` is the one big number a screen leads with (max one).
 * Numeric styles carry tabular figures so digits don't jitter as values tick.
 *
 * Line heights are the reader's; see the block above. `letterSpacing` is left
 * alone on purpose: it is optical correction for a typeface at a size, and the
 * -2 on `hero` exists because 44pt display type sets too loose. Scaled up with
 * the text it would close 88pt glyphs into each other.
 */
export const type = {
  hero:    { fontSize: 44, fontWeight: '600', letterSpacing: -2,   lineHeight: grown(46) },
  title:   { fontSize: 26, fontWeight: '600', letterSpacing: -0.6, lineHeight: grown(32) },
  head:    { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: grown(22) },
  body:    { fontSize: 15, fontWeight: '400', letterSpacing: 0,    lineHeight: grown(21) },
  label:   { fontSize: 13, fontWeight: '400', letterSpacing: 0,    lineHeight: grown(18) },
  caption: { fontSize: 12, fontWeight: '400', letterSpacing: 0,    lineHeight: grown(16) },
  micro:   { fontSize: 11, fontWeight: '500', letterSpacing: 0.9,  lineHeight: grown(14), textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

/** Values read as data, not prose: semibold + tabular figures. */
export const numeric = { fontVariant: ['tabular-nums'] } as const satisfies TextStyle;

/** A metric value at an arbitrary size, on the scale's terms. */
export function value(size: number): TextStyle {
  return { fontSize: size, fontWeight: '600', letterSpacing: size >= 30 ? -1.2 : -0.5, ...numeric };
}
