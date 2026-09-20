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
//   · Two families. Sora draws what a screen LEADS with — page and section
//     titles, the hero headline and every figure. Plus Jakarta Sans draws
//     everything a person reads. A third family is a redesign, not a tweak.
//   · Four weights: 400 body, 500 emphasis, 600 labels, 700 titles, figures
//     and buttons. Sora ships in 600 and 700 only, so a lighter Sora is not
//     available and is not wanted. Never 800/900.
//   · Exactly ONE hero figure per screen.
//   · Status colours (warn/crit) are reserved for status and are never used as
//     text colour; a coloured mark sits *beside* ink-coloured text instead.
//     The data palette follows the same rule with one addition: each tone has
//     an `…Ink` that IS measured as text (see tokens.ts).
//   · Elevation groups, the ground divides. A card is a white surface with a
//     soft shadow on the grey ground; a hairline is for rows INSIDE a card.
import { PixelRatio, Platform, StyleSheet, type TextStyle } from 'react-native';
import { atScale, clampFontScale } from '../lib/typeScale';

/** Space — 4pt-derived, 7 steps. */
export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;

/** Screen gutter and the gap a hairline-separated section carries. */
// 16 and 16, down from 22 and 24. The approved board sets its screens tight:
// a 16pt gutter, sections as cards with 16pt inside them, and the gap between
// two cards carried by the cards rather than by air and a hairline.
export const layout = { gutter: 16, section: sp.lg } as const;

/** Radius — five steps, down from 25+. */
// `lg` is the card and `xl` the hero card, as the approved mockups draw them:
// 18 on every white card, 24 on the night hero. `md` stays the button's 16 and
// `sm` the 10 of a segment or a small tile, so nothing that already named a
// step changes shape under it.
export const radius = { sm: 10, md: 16, lg: 18, xl: 24, pill: 999 } as const;

/** Hairline: divides. One value, used everywhere a rule is drawn. */
export const hairline = StyleSheet.hairlineWidth;

/**
 * Elevation — two steps. Cards rest at e1; sheets and modals sit at e2.
 * iOS reads the shadow*, Android reads elevation; both are set so the two
 * platforms agree.
 */
export const elevation = {
  /**
   * The three shadows of the approved mockups, as they are written there.
   *
   * `boxShadow` and not shadow* + `elevation`: a card's shadow in the mockups
   * is TWO layers — a tight 1px contact shadow and a wide 20px ambient one —
   * and the older pair of APIs can draw one layer on iOS and only a fixed
   * grey key-light on Android, so the two phones disagreed and neither matched.
   * React Native draws `boxShadow` itself on both (this app is new-architecture
   * only), so the card on an iPhone and on a Pixel is the same card. Android
   * below 9 ignores the property and the card is then told from the ground by
   * its colour alone, which the ground was chosen to allow.
   *
   * No Android `elevation` beside it on purpose: both would draw.
   *
   *   card   every Section, Card and tile
   *   float  the tab bar and anything else that hovers over content
   *   hero   the night hero card, tinted with the night colour so the shadow
   *          reads as the card's own and not as a grey smudge under green
   */
  card: { boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 6px 20px rgba(16,24,40,0.06)' },
  float: { boxShadow: '0 2px 4px rgba(16,24,40,0.06), 0 12px 32px rgba(16,24,40,0.14)' },
  hero: { boxShadow: '0 12px 28px rgba(11,29,25,0.28)' },
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

/* ── The two families ───────────────────────────────────────────────────────
 *
 * Sora and Plus Jakarta Sans, loaded once in app/_layout.tsx and embedded in
 * the binary by the expo-font plugin in app.json. The family names below are
 * the keys they are loaded under, and they are the only place the app spells
 * them.
 *
 * ── Why the two platforms are told different things ───────────────────────
 *
 * A custom font in React Native is registered one FILE at a time, and what a
 * style may then say about weight depends on who is resolving it.
 *
 * Android resolves a family name to exactly one typeface. Ask that typeface
 * for `fontWeight: '700'` and Android does not go and find the Bold file — it
 * smears the Regular one sideways (a synthetic bold), which is the blurry
 * heavy text every cross-platform app has shipped at least once. So on
 * Android, and on the web, the weight IS the family: `PlusJakartaSans_700Bold`
 * and no `fontWeight` beside it.
 *
 * iOS registers each file under the family its own name table declares —
 * "Sora", "Plus Jakarta Sans" — and resolves `fontWeight` against the faces of
 * that family natively, picking the real SemiBold for '600'. That matters here
 * for a reason that is about this codebase and not about fonts: about seven
 * hundred styles across the three apps are written
 * `{ ...ty.body, fontWeight: '600' }`. With a family-per-weight name on iOS
 * that override is silently ignored (one face in the "family", nothing to
 * choose between) and every emphasised line in the app goes Regular. With the
 * real family name they all keep working, untouched. On Android those same
 * overrides get the synthetic bold until a screen swaps them for `font()`
 * below — emphasis kept, fidelity a step down, and named in the handoff.
 *
 * ── When the fonts do not arrive ──────────────────────────────────────────
 *
 * `fallBackToSystemFace()` is called by the root layout when the load FAILS,
 * before anything has been drawn (first paint waits for the load to settle
 * either way). It strips the family from every token and puts the weight back,
 * so the app is the system face with its hierarchy intact rather than a custom
 * family name that resolves to nothing at one flat weight.
 */
export type Weight = '400' | '500' | '600' | '700';
/** `text` is Plus Jakarta Sans; `display` is Sora. */
export type Face = 'text' | 'display';

const IOS_FAMILY: Record<Face, string> = { text: 'Plus Jakarta Sans', display: 'Sora' };
const FILE_FAMILY: Record<Face, Record<Weight, string>> = {
  text: {
    '400': 'PlusJakartaSans_400Regular', '500': 'PlusJakartaSans_500Medium',
    '600': 'PlusJakartaSans_600SemiBold', '700': 'PlusJakartaSans_700Bold',
  },
  // Sora ships here in two weights. A lighter request gets the SemiBold: a
  // display face is never body copy, and a missing file would be a missing font.
  display: {
    '400': 'Sora_600SemiBold', '500': 'Sora_600SemiBold',
    '600': 'Sora_600SemiBold', '700': 'Sora_700Bold',
  },
};

let systemFace = false;
const built: { style: TextStyle; weight: Weight }[] = [];

/**
 * The family (and, where the platform resolves one, the weight) for a piece of
 * text that is not one of the `type` steps.
 *
 * This is what an ad-hoc weight should be written as from now on:
 * `{ ...ty.body, ...font('600') }` rather than `{ ...ty.body, fontWeight: '600' }`.
 * The second still works — see the block above for exactly how well, per
 * platform — and the first is right everywhere.
 */
export function font(weight: Weight = '400', face: Face = 'text'): TextStyle {
  if (systemFace) return { fontWeight: weight };
  if (Platform.OS === 'ios') {
    return { fontFamily: IOS_FAMILY[face], fontWeight: face === 'display' && weight < '600' ? '600' : weight };
  }
  return { fontFamily: FILE_FAMILY[face][weight] };
}

/** One step of the scale. Keeps the literal it was given — two callers read
 *  `ty.label.fontSize` and `ty.label.lineHeight` as numbers — and remembers the
 *  weight, so the fallback below can put it back. */
function step<T extends TextStyle>(face: Face, weight: Weight, rest: T): T & TextStyle {
  const style: T & TextStyle = { ...rest, ...font(weight, face) };
  built.push({ style, weight });
  return style;
}

/** The fonts did not load: be the system face, with the hierarchy intact.
 *  Called before first paint, which is what makes rewriting module constants
 *  safe — nothing has spread them into a rendered style yet. */
export function fallBackToSystemFace(): void {
  systemFace = true;
  for (const b of built) {
    delete b.style.fontFamily;
    b.style.fontWeight = b.weight;
  }
}

/**
 * Type — the approved mockups' scale, one step up from the one it replaces.
 * `hero` is the one big number a screen leads with (max one).
 *
 *   hero      44  Sora 700     the figure a screen leads with
 *   display   30  Sora 700     a tab root's title; the name under a greeting
 *   title     24  Sora 700     a sheet's title, a profile's name
 *   section   20  Sora 700     a card's heading (SectionHead)
 *   page      19  Sora 600     a pushed page's centred title (PageHead)
 *   button    18  Jakarta 700  the primary action's label
 *   head      17  Jakarta 700  a row's title
 *   body      16  Jakarta 400
 *   label     15  Jakarta 400  controls, segments, secondary lines
 *   caption   14  Jakarta 400  a row's caption, a note
 *   tab       14  Jakarta 700  the current tab's name
 *   micro     13  Jakarta 600  the small label over a field, a chip
 *   eyebrow   12  Jakarta 700  tracked capitals on a hero card, nowhere else
 *
 * Line heights are the reader's; see the block above. `letterSpacing` is left
 * alone on purpose: it is optical correction for a typeface at a size, and the
 * negative tracking on the Sora steps exists because a geometric display face
 * sets loose. Scaled up with the text it would close 88pt glyphs into each
 * other.
 */
export const type = {
  hero:    step('display', '700', { fontSize: 44, letterSpacing: -1.5, lineHeight: grown(48) }),
  display: step('display', '700', { fontSize: 30, letterSpacing: -0.7, lineHeight: grown(35) }),
  title:   step('display', '700', { fontSize: 24, letterSpacing: -0.4, lineHeight: grown(30) }),
  section: step('display', '700', { fontSize: 20, letterSpacing: -0.3, lineHeight: grown(26) }),
  page:    step('display', '600', { fontSize: 19, letterSpacing: -0.2, lineHeight: grown(25) }),
  button:  step('text', '700', { fontSize: 18, letterSpacing: 0,    lineHeight: grown(24) }),
  head:    step('text', '700', { fontSize: 17, letterSpacing: -0.1, lineHeight: grown(23) }),
  body:    step('text', '400', { fontSize: 16, letterSpacing: 0,    lineHeight: grown(23) }),
  label:   step('text', '400', { fontSize: 15, letterSpacing: 0,    lineHeight: grown(21) }),
  caption: step('text', '400', { fontSize: 14, letterSpacing: 0,    lineHeight: grown(19) }),
  tab:     step('text', '700', { fontSize: 14, letterSpacing: 0,    lineHeight: grown(18) }),
  // The board's small label: bold, title case, the author's own casing. It
  // was an 11pt tracked UPPERCASE — the one typographic habit the board has
  // none of, and the reason the app read as a different face when it is the
  // same system font. scripts/check-caps.mjs still leaves micro strings to
  // their authors, so a kicker typed in sentence case stays that way.
  micro:   step('text', '600', { fontSize: 13, letterSpacing: -0.1, lineHeight: grown(18) }),
  // The one tracked-capitals step, and it lives on the night hero card only:
  // "TODAY · WEEK 1 OF 12". The caller types the capitals — nothing here
  // transforms case, for the reason `micro` gives.
  eyebrow: step('text', '700', { fontSize: 12, letterSpacing: 1.4,  lineHeight: grown(16) }),
} satisfies Record<string, TextStyle>;

/** Values read as data, not prose: semibold + tabular figures. */
export const numeric = { fontVariant: ['tabular-nums'] } as const satisfies TextStyle;

/** A metric value at an arbitrary size, on the scale's terms: Sora, bold,
 *  tabular. Every figure in the app is drawn through this or `type.hero`. */
export function value(size: number): TextStyle {
  return { fontSize: size, ...font('700', 'display'), letterSpacing: size >= 30 ? -1.2 : -0.5, ...numeric };
}
