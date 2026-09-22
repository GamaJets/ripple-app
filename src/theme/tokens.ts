// Design tokens — 12 selectable palettes. Repple (the approved board's light
// scheme) is the default, with Repple Dark as its counterpart. Every
// palette carries the full token set so any screen renders on any palette.
// The client & trainer pick a palette in Appearance; the owner can also set a
// custom brand colour on top (white-label).
//
// Every number in here is now measured rather than judged: src/lib/a11y.test.ts
// walks all ten palettes on every `npm test` and fails the build if an ink
// stops clearing 4.5:1 on any of its four grounds, or a status colour stops
// clearing 3:1 as a mark. Adding a palette without running the numbers is no
// longer possible.
import { readableInkOn, contrastRatio, rgb, AA_TEXT, AA_MARK } from '../lib/a11y';

// crit was #d03b3b, and that number quietly cost the status palette its whole
// justification. The rule the app is built on — a coloured MARK beside
// ink-coloured text, never coloured text — trades 4.5:1 for the 3:1 a non-text
// mark needs, and the comment on Flag() in kit.tsx says crit "clears everywhere"
// as a mark. It did not: against surface3 it was 2.79 on sage, 2.85 on teal,
// 2.93 on midnight and 2.98 on terminal. The one dot that means "this is
// broken" was the one dot four palettes could not show you. Hue and saturation
// held, lightness walked up until the worst dark ground cleared 3:1 — 2.79 →
// 3.03, a change you have to be told about to see.
const darkSem = { grid: '#2c2c2a', s1: '#3987e5', s2: '#199e70', s3: '#c98500', s5: '#9085e9', s6: '#e66767', good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d34646' };
// The six series colours below were given light-background values; the four
// STATUS colours were not, and sat here byte-identical to darkSem. On white
// that made warn 1.68:1 and serious 2.42:1 — below even the 3:1 a non-text
// mark needs, let alone the 4.5:1 for text. Solved by holding each hue exactly
// and walking lightness down until the worst of the three light backgrounds
// (and plain white) cleared 4.5:1. crit barely moved, 4.40 → 4.52.
//
// s2 and s3 were the two the same pass missed. "Light-background values" was
// true of the hue and not of the lightness: on the three light palettes s2 sat
// at 2.21:1 and s3 at 1.70:1 — a chart line you cannot see is not a chart line.
// Walked down by the same method to 3.01:1, the floor for a graphical object
// (WCAG 1.4.11). They are marks, not text, so 3:1 is the bar they have to clear
// and 4.5 is not required of them.
const lightSem = { grid: '#e1e0d9', s1: '#2a78d6', s2: '#179468', s3: '#b07700', s5: '#4a3aa7', s6: '#e34948', good: '#0a820a', warn: '#956703', serious: '#c44717', crit: '#cf3737' };

// ── ink3, the quiet one ────────────────────────────────────────────────────
// ink3 is the third ink and the most-read colour in the app: every section
// title, every unit, every caption under a value, every "3 sessions this week"
// is drawn in it, at caption (12) or micro (11). It failed AA as text on NINE
// of the ten palettes — worst on Cream & Coral at 2.68:1, Swiss Ivory at 2.79
// and Terminal at 2.89, all against surface3. That is not "quiet"; below about
// 3:1 small text stops being legible to anyone reading in sunlight, on a
// smeared screen, or with the eyes of a person over about fifty.
//
// Fixed by the method this file already uses for lightSem: hue and saturation
// held exactly, lightness walked until the WORST of the four grounds (bg,
// surface, surface2, surface3) cleared 4.5:1. Every value below is the first
// step that clears it, so nothing moved further than it had to. ink2 stays
// between 6.7 and 9.3, so the three inks are still three distinct steps.
// Sunset was already at 4.53 and is untouched.
// src/lib/a11y.test.ts measures all ten on every run.

// ── Elevated Teal (DEFAULT) ────────────────────────────────────────────────
const tealBase = {
  bg: '#0c1413', surface: '#10201d', surface2: '#14261f', surface3: '#1b3229',
  ink: '#e8f2f0', ink2: '#b6c9c4', ink3: '#809996', ring: 'rgba(255,255,255,0.09)',
  brand: '#16b8a6', brandInk: '#04211d', ...darkSem, s3: '#c9a35b',
};
/** What a palette is TYPED as: grounds, inks, the accent, status and series. */
type Base = typeof tealBase;

// ── The data palette ───────────────────────────────────────────────────────
// Seven hues for infographics and status, as the approved mockups use them: a
// ring per macro, a plate behind a row's icon, a chip that says "Slipping".
// Each hue is THREE values, because the mockups use a hue three ways and the
// three do not have the same job:
//
//   blue      a MARK — a ring's arc, a bar, a spark line, an icon on its
//             plate. Held to 3:1 against every ground it is drawn on and
//             against its own plate (WCAG 1.4.11), like the series colours.
//   blueSoft  the PLATE — the pale fill behind an icon or a chip's words.
//   blueInk   TEXT in the hue — a chip's label on its plate, a KPI figure on a
//             card. Held to 4.5:1 against the plate and every ground.
//
// The mockups draw the label in the mark colour, and on a phone in daylight
// that is the mistake this file's header is about: orange #EA580C on its own
// #FFEDD5 plate is 3.11:1 and teal #0D9488 on #CCFBF1 is 3.32. So `…Ink` is
// the mark with hue and saturation held and lightness walked down to the first
// step that clears 4.5 on the worst ground — the method ink3 and lightSem were
// fixed by. Two MARKS moved too, by a hair and by the same method: orange
// #EA580C was 2.80:1 on surface3 and is #e0540c (3.03), teal #0D9488 was 2.94
// and is #0d9286 (3.01). Red needed nothing; its ink is its mark.
//
// One set for the light palettes and one for the dark, exactly as lightSem and
// darkSem are, and measured over every palette of that scheme in
// src/lib/a11y.test.ts. The dark set is Tailwind's 400s over its 950s: bright
// enough that mark and ink are the same value (worst case 4.85:1).
//
// scripts/check-contrast.mjs refuses `color: t.data.blue` and
// `color: t.data.blueSoft` for the reason it refuses `color: t.crit`.
const lightData = {
  blue: '#2563eb', blueSoft: '#dbeafe', blueInk: '#1759ea',
  orange: '#e0540c', orangeSoft: '#ffedd5', orangeInk: '#b04209',
  purple: '#7c3aed', purpleSoft: '#ede9fe', purpleInk: '#7a38ed',
  teal: '#0d9286', tealSoft: '#ccfbf1', tealInk: '#0a7168',
  pink: '#db2777', pinkSoft: '#fce7f3', pinkInk: '#bf2066',
  amber: '#b45309', amberSoft: '#fef3c7', amberInk: '#a54c08',
  red: '#b91c1c', redSoft: '#fee2e2', redInk: '#b91c1c',
};
export type DataPalette = typeof lightData;
const darkData: DataPalette = {
  blue: '#60a5fa', blueSoft: '#172554', blueInk: '#60a5fa',
  orange: '#fb923c', orangeSoft: '#431407', orangeInk: '#fb923c',
  purple: '#a78bfa', purpleSoft: '#2e1065', purpleInk: '#a78bfa',
  teal: '#2dd4bf', tealSoft: '#042f2e', tealInk: '#2dd4bf',
  pink: '#f472b6', pinkSoft: '#500724', pinkInk: '#f472b6',
  amber: '#fbbf24', amberSoft: '#451a03', amberInk: '#fbbf24',
  red: '#f87171', redSoft: '#450a0a', redInk: '#f87171',
};
/** The seven hue names, for anything that walks the palette. */
export const DATA_HUES = ['blue', 'orange', 'purple', 'teal', 'pink', 'amber', 'red'] as const;
export type DataHue = typeof DATA_HUES[number];

/**
 * A whole theme: a palette's own colours, plus everything DERIVED from them.
 *
 *   night, night2     the hero card's ground and the tile on it; the workout
 *                     focus mode's ground. Near-black on a light palette; one
 *                     and two steps LIGHTER than the ground on a dark one, so
 *                     a hero still reads as a hero where everything is dark.
 *   nightInk…3        white, the quiet line, and the eyebrow, on night.
 *   brandBright       the accent as it is drawn ON night: the hero's button,
 *                     its ring, the current tab's icon. With `brandDeep`, the
 *                     ink written on it.
 *   brandSoft         the accent's pale plate (a chip, an icon plate).
 *   brandText         the accent where it is TEXT — a section's "See all", a
 *                     chip's label. The accent itself where that clears 4.5:1
 *                     on the ground, the card and the plate; `ink` where it
 *                     does not, because a link nobody can read is not a link.
 *   data              the data palette above.
 */
export interface Theme extends Base {
  night: string; night2: string; nightInk: string; nightInk2: string; nightInk3: string;
  brandBright: string; brandDeep: string; brandSoft: string; brandText: string;
  data: DataPalette;
}

/** `a` laid over `b` at `share` — a plate is the accent at 14% over the card. */
function mix(a: string, b: string, share: number): string {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return b;
  return '#' + x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, '0')).join('');
}

/**
 * The four accent-derived tokens, MEASURED rather than picked.
 *
 * Shared by every palette below and by `withAccent`, so a gym's typed hex goes
 * through exactly the arithmetic the built-in green does. Two decisions:
 *
 *   · On night, the accent is used if it clears 3:1 there as a mark — it is a
 *     button's fill and a ring's arc. A navy or a charcoal brand does not, and
 *     a hero whose one button cannot be seen is worse than one whose button is
 *     white: so it falls to `nightInk` on `night`, which always clears.
 *   · As text, the accent is used if it clears 4.5:1 on the ground, the card
 *     and its own plate. Otherwise `ink`.
 */
function accentTokens(t: { brand: string; brandInk: string; bg: string; surface: string; ink: string; night: string; nightInk: string }) {
  const clears = (fg: string, bgs: string[], bar: number) => bgs.every((g) => (contrastRatio(fg, g) ?? 0) >= bar);
  const brandSoft = mix(t.brand, t.surface, 0.14);
  const onNight = clears(t.brand, [t.night], AA_MARK);
  return {
    brandSoft,
    brandText: clears(t.brand, [t.bg, t.surface, brandSoft], AA_TEXT) ? t.brand : t.ink,
    brandBright: onNight ? t.brand : t.nightInk,
    brandDeep: onNight ? t.brandInk : t.night,
  };
}

/**
 * A palette's own colours, made into a whole Theme.
 *
 * The ten palettes that are not the approved board's get their night from
 * colours they already have: a dark palette's hero is its surface3 — surface2
 * was tried and is 1.10:1 from the ground on Terminal, one more dark rectangle
 * — with tiles a tenth of the way to its ink and its own inks on top; a light
 * palette's is its ink — the darkest thing it owns, in its own hue — with ink2
 * tiles and white on top. src/lib/a11y.test.ts measures every pairing. `over` is where Repple
 * and Repple Dark name the mockups' exact values instead.
 */
function theme(base: Base, light: boolean, over: Partial<Theme> = {}): Theme {
  const night = light
    ? { night: base.ink, night2: base.ink2, nightInk: '#ffffff', nightInk2: base.surface3, nightInk3: base.surface3 }
    : { night: base.surface3, night2: mix(base.ink, base.surface3, 0.1), nightInk: base.ink, nightInk2: base.ink2, nightInk3: base.ink2 };
  const t = { ...base, ...night, data: light ? lightData : darkData, ...over };
  return { ...t, ...accentTokens(t), ...over };
}

export const teal: Theme = theme(tealBase, false);

// ── Repple (DEFAULT) — the approved mockups ────────────────────────────────
// A pale grey ground with white cards ON it, slate inks, one green. The ground
// is what makes a card a card now — sections lost their hairline edge and
// gained a shadow — so `bg` and `surface` are two colours again, and `ring` is
// only the rule between two rows inside a card.
//
// The green is green-700 rather than the mockups' brighter fill wherever the
// label on it is white: #22c55e puts white at 2.3:1 and #16a34a at 3.3, and
// #15803d is 5.0. The bright green is not gone — it is `brandBright`, drawn on
// the night hero card under `brandDeep` ink (6.5:1), which is where the
// mockups use it.
//
// ink3 is the mockups' #64748b walked down to #5d6b81. As drawn it is 4.36:1
// on the ground and 4.02 on surface3, and ink3 is the most-read colour in the
// app (see "ink3, the quiet one" above); hue and saturation held, lightness
// walked to the first step that clears 4.5 on all four grounds.
const repple: Theme = theme(
  { bg: '#f4f5f7', surface: '#ffffff', surface2: '#f1f3f6', surface3: '#e9ecf1', ink: '#0f172a', ink2: '#475569', ink3: '#5d6b81', ring: '#e8eaee', brand: '#15803d', brandInk: '#ffffff', ...lightSem },
  true,
  { night: '#0b1d19', night2: '#14302a', nightInk: '#ffffff', nightInk2: '#cbd5e1', nightInk3: '#86efac', brandBright: '#22c55e', brandDeep: '#052e16', brandSoft: '#dcfce7' },
);
// The mockups' dark mode: near-black with the same green, where the bright
// fill is readable under dark ink (8.2:1) and so is what the board draws. The
// hero is the light scheme's night2 — a green-black a clear step LIGHTER than
// the ground and the cards, so it still leads the screen.
const reppleDark: Theme = theme(
  { bg: '#0b0f0e', surface: '#141a18', surface2: '#1b2320', surface3: '#252e2a', ink: '#f1f5f3', ink2: '#b8c4bf', ink3: '#93a09b', ring: 'rgba(255,255,255,0.10)', brand: '#22c55e', brandInk: '#111310', ...darkSem },
  false,
  { night: '#14302a', night2: '#1d443b', nightInk: '#ffffff', nightInk2: '#cbd5e1', nightInk3: '#86efac' },
);

const midnight: Theme = theme({ bg: '#0a0f1e', surface: '#111a30', surface2: '#16223c', surface3: '#1e2b47', ink: '#eaf0ff', ink2: '#b9c6e0', ink3: '#8692ab', ring: 'rgba(255,255,255,0.08)', brand: '#5b9dff', brandInk: '#04122e', ...darkSem }, false);
const sage: Theme = theme({ bg: '#0f1411', surface: '#16201a', surface2: '#1b281f', surface3: '#24322a', ink: '#e9f0e9', ink2: '#bcd0bc', ink3: '#899a89', ring: 'rgba(255,255,255,0.08)', brand: '#8fd694', brandInk: '#0c1f12', ...darkSem }, false);
const noir: Theme = theme({ bg: '#000000', surface: '#101010', surface2: '#181818', surface3: '#242424', ink: '#ffffff', ink2: '#c8c8c8', ink3: '#8b8b8b', ring: 'rgba(255,255,255,0.12)', brand: '#f2f2f2', brandInk: '#000000', ...darkSem }, false);
const sunset: Theme = theme({ bg: '#140e14', surface: '#1e141e', surface2: '#271a27', surface3: '#33223a', ink: '#ffffff', ink2: '#d9c7d4', ink3: '#9a8a9a', ring: 'rgba(255,255,255,0.09)', brand: '#ff8a5b', brandInk: '#2a0f1e', ...darkSem }, false);
const clinical: Theme = theme({ bg: '#f4f6fb', surface: '#ffffff', surface2: '#eef2f9', surface3: '#e3e9f4', ink: '#0f1830', ink2: '#3c4a63', ink3: '#5d6984', ring: 'rgba(15,24,48,0.12)', brand: '#2b68ff', brandInk: '#ffffff', ...lightSem }, true);
const terminal: Theme = theme({ bg: '#0a0d0a', surface: '#0f140f', surface2: '#141a14', surface3: '#1e2e1e', ink: '#d6ffd6', ink2: '#9ccf9c', ink3: '#679d67', ring: 'rgba(70,255,122,0.14)', brand: '#46ff7a', brandInk: '#052b10', ...darkSem }, false);
const cream: Theme = theme({ bg: '#fbf6ef', surface: '#ffffff', surface2: '#f5efe5', surface3: '#efe6d8', ink: '#2a2018', ink2: '#5a4c3c', ink3: '#736656', ring: 'rgba(42,32,24,0.12)', brand: '#ff6f5e', brandInk: '#111310', ...lightSem }, true);
const violet: Theme = theme({ bg: '#100e18', surface: '#191529', surface2: '#201a33', surface3: '#2a2440', ink: '#ece9f7', ink2: '#c3bce0', ink3: '#918bab', ring: 'rgba(255,255,255,0.09)', brand: '#7756ff', brandInk: '#ffffff', ...darkSem }, false);
const swiss: Theme = theme({ bg: '#f6f5f1', surface: '#ffffff', surface2: '#f0efe9', surface3: '#e6e4dc', ink: '#111111', ink2: '#4a4842', ink3: '#686660', ring: 'rgba(17,17,17,0.12)', brand: '#e3261c', brandInk: '#ffffff', ...lightSem }, true);

export interface PaletteMeta {
  key: string; name: string; theme: Theme; light: boolean;
  /**
   * The palette this one becomes when the phone flips between light and dark.
   *
   * Seven of these ten are dark and three are light, so this is a mapping and
   * not a pairing: three darks land on `clinical`. What it must be is CLOSED —
   * every counterpart names a real palette of the OPPOSITE scheme, asserted in
   * src/lib/a11y.test.ts — because the follow reads it once in each direction
   * and a dead end would leave a member on a light phone in a dark app with no
   * way back except picking a palette by hand.
   *
   * The member's own choice is never rewritten. `AppThemeProvider` derives the
   * counterpart at render and leaves the stored key alone, so going dark and
   * back returns the palette they picked rather than whatever the mapping
   * happened to land on.
   *
   * Paired by what the palette is FOR rather than by hue arithmetic: the two
   * monospace-feeling ones face each other, the two coral ones face each other,
   * and the cool neutrals fall to Clinical Light, which is the only light
   * palette with a cool brand.
   */
  counterpart: string;
}
export const PALETTES: PaletteMeta[] = [
  { key: 'repple', name: 'Repple', theme: repple, light: true, counterpart: 'repple-dark' },
  { key: 'repple-dark', name: 'Repple Dark', theme: reppleDark, light: false, counterpart: 'repple' },
  { key: 'teal', name: 'Elevated Teal', theme: teal, light: false, counterpart: 'clinical' },
  { key: 'midnight', name: 'Midnight Blue', theme: midnight, light: false, counterpart: 'clinical' },
  { key: 'sage', name: 'Sage', theme: sage, light: false, counterpart: 'cream' },
  { key: 'noir', name: 'Mono Noir', theme: noir, light: false, counterpart: 'swiss' },
  { key: 'sunset', name: 'Sunset', theme: sunset, light: false, counterpart: 'cream' },
  { key: 'clinical', name: 'Clinical Light', theme: clinical, light: true, counterpart: 'midnight' },
  { key: 'terminal', name: 'Terminal', theme: terminal, light: false, counterpart: 'swiss' },
  { key: 'cream', name: 'Cream & Coral', theme: cream, light: true, counterpart: 'sunset' },
  { key: 'violet', name: 'Electric Violet', theme: violet, light: false, counterpart: 'clinical' },
  { key: 'swiss', name: 'Swiss Ivory', theme: swiss, light: true, counterpart: 'noir' },
];
export const paletteByKey = (k: string): Theme => (metaByKey(k)).theme;
export const metaByKey = (k: string): PaletteMeta => PALETTES.find((p) => p.key === k) ?? PALETTES[0];
export const DEFAULT_PALETTE = 'repple';

/**
 * The palette to draw when the phone is in `scheme` and the member chose `key`.
 *
 * Returns the member's own palette whenever it already matches the phone, so
 * somebody who deliberately picked Mono Noir and set their phone to dark stays
 * exactly where they were. A null scheme — the platform has not said — is not
 * a light phone, and changes nothing.
 */
export function paletteForScheme(key: string, scheme: 'light' | 'dark' | null | undefined): string {
  if (scheme !== 'light' && scheme !== 'dark') return key;
  const meta = metaByKey(key);
  const wantsLight = scheme === 'light';
  return meta.light === wantsLight ? meta.key : metaByKey(meta.counterpart).key;
}

/**
 * A palette with its two quiet inks brought up to its two loudest.
 *
 * ── Why it is a transform rather than an eleventh palette ─────────────────
 *
 * Appearance offered ten hues and nothing for legibility, which is the thing
 * most people open that screen looking for. The obvious way to add a
 * high-contrast option is to type new colours; the tokens in this file were
 * measured against every ground they are drawn on, and hand-picking eleven
 * more sets of them is how a palette ends up at 2.79:1 without anybody
 * noticing — which is what the ink3 comment above is about.
 *
 * So no colour is invented. ink3 becomes ink2 and ink2 becomes ink, both of
 * which src/lib/a11y.test.ts already measures at 4.5:1 or better on all four
 * grounds of all ten palettes. The transform therefore CANNOT drop below the
 * floor: every value in the result is a value that was already passing, and
 * a11y.test.ts asserts that over the transformed palettes too.
 *
 * What it costs is the three-step ink hierarchy — a caption now reads as
 * loudly as the value above it. That is the trade a person asking for higher
 * contrast is making on purpose, and it is why this is a setting rather than
 * the default.
 *
 * `brand`, `brandInk` and the status colours are untouched. brandInk is
 * measured against whatever the brand is by `brandInkFor`, and the status
 * colours are marks at 3:1 and are never text — raising them here would only
 * make the marks louder, which is not what the reader asked for.
 */
export function highContrast(t: Theme): Theme {
  return { ...t, ink3: t.ink2, ink2: t.ink };
}

// Backward-compat exports (some modules import these directly).
export const dark = teal;
export const light = clinical;

/**
 * Brand-ink: the text colour for the primary button, MEASURED against the
 * brand colour rather than guessed from it.
 *
 * This used to pick by perceived brightness — `r*.299 + g*.587 + b*.114 > 140`
 * — which is a different quantity from contrast and disagrees with it on about
 * a fifth of colours. The case that matters: a gym types a bright green
 * (#00ee00 and anything near it), the old rule read it as "not bright enough"
 * and chose white at 1.59:1, with black sitting unused at 11.77:1. Every Cta on
 * every screen in that tenant's app was then a label you could not read.
 *
 * The brand colour is white-label — an owner types a hex in Brand and this
 * decides what the app writes on top of it — so this is the one colour decision
 * in the file that nobody reviews. Measuring both candidates and taking the
 * better one drops the share of brand colours that yield a sub-AA button label
 * from 21.8% to the 4.0% that is genuinely unachievable with black or white.
 * For those, no ink is a good ink and the brand colour itself is the problem.
 *
 * `readableInkOn` returns '#ffffff' for anything it cannot parse, which is the
 * same fallback the old three-line version had for a short string.
 */
export function brandInkFor(hex: string): string {
  return readableInkOn(hex);
}

/**
 * A theme under a gym's own colour.
 *
 * The accent replaces `brand`, and everything DERIVED from the accent is
 * derived again from theirs — the ink on it, the fill it takes on the night
 * hero, its plate, and whether it may be text at all — by the same measured
 * arithmetic the built-in palettes went through (`accentTokens`). What a gym
 * does not get to move: the data palette, which is meaning and not brand, and
 * the night ground. The eyebrow on the hero drops from Repple's mint to the
 * quiet night ink, because a mint line over a red gym's button is two brands.
 */
export function withAccent(t: Theme, accent: string): Theme {
  const branded = { ...t, brand: accent, brandInk: brandInkFor(accent), nightInk3: t.nightInk2 };
  return { ...branded, ...accentTokens(branded) };
}
