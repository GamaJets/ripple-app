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
import { StyleSheet, type TextStyle } from 'react-native';

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
} as const;

/**
 * Type — 7 steps. `hero` is the one big number a screen leads with (max one).
 * Numeric styles carry tabular figures so digits don't jitter as values tick.
 */
export const type = {
  hero:    { fontSize: 44, fontWeight: '600', letterSpacing: -2,   lineHeight: 46 },
  title:   { fontSize: 26, fontWeight: '600', letterSpacing: -0.6, lineHeight: 32 },
  head:    { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22 },
  body:    { fontSize: 15, fontWeight: '400', letterSpacing: 0,    lineHeight: 21 },
  label:   { fontSize: 13, fontWeight: '400', letterSpacing: 0,    lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '400', letterSpacing: 0,    lineHeight: 16 },
  micro:   { fontSize: 11, fontWeight: '500', letterSpacing: 0.9,  lineHeight: 14, textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

/** Values read as data, not prose: semibold + tabular figures. */
export const numeric = { fontVariant: ['tabular-nums'] } as const satisfies TextStyle;

/** A metric value at an arbitrary size, on the scale's terms. */
export function value(size: number): TextStyle {
  return { fontSize: size, fontWeight: '600', letterSpacing: size >= 30 ? -1.2 : -0.5, ...numeric };
}
