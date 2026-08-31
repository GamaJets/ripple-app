// Design tokens — 10 selectable palettes. Elevated Teal is the default. Every
// palette carries the full token set so any screen renders on any palette.
// The client & trainer pick a palette in Appearance; the owner can also set a
// custom brand colour on top (white-label).
//
// Every number in here is now measured rather than judged: src/lib/a11y.test.ts
// walks all ten palettes on every `npm test` and fails the build if an ink
// stops clearing 4.5:1 on any of its four grounds, or a status colour stops
// clearing 3:1 as a mark. Adding a palette without running the numbers is no
// longer possible.
import { readableInkOn } from '../lib/a11y';

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
export const teal = {
  bg: '#0c1413', surface: '#10201d', surface2: '#14261f', surface3: '#1b3229',
  ink: '#e8f2f0', ink2: '#b6c9c4', ink3: '#809996', ring: 'rgba(255,255,255,0.09)',
  brand: '#16b8a6', brandInk: '#04211d', ...darkSem, s3: '#c9a35b',
};
export type Theme = typeof teal;

const midnight: Theme = { bg: '#0a0f1e', surface: '#111a30', surface2: '#16223c', surface3: '#1e2b47', ink: '#eaf0ff', ink2: '#b9c6e0', ink3: '#8692ab', ring: 'rgba(255,255,255,0.08)', brand: '#5b9dff', brandInk: '#04122e', ...darkSem };
const sage: Theme = { bg: '#0f1411', surface: '#16201a', surface2: '#1b281f', surface3: '#24322a', ink: '#e9f0e9', ink2: '#bcd0bc', ink3: '#899a89', ring: 'rgba(255,255,255,0.08)', brand: '#8fd694', brandInk: '#0c1f12', ...darkSem };
const noir: Theme = { bg: '#000000', surface: '#101010', surface2: '#181818', surface3: '#242424', ink: '#ffffff', ink2: '#c8c8c8', ink3: '#8b8b8b', ring: 'rgba(255,255,255,0.12)', brand: '#f2f2f2', brandInk: '#000000', ...darkSem };
const sunset: Theme = { bg: '#140e14', surface: '#1e141e', surface2: '#271a27', surface3: '#33223a', ink: '#ffffff', ink2: '#d9c7d4', ink3: '#9a8a9a', ring: 'rgba(255,255,255,0.09)', brand: '#ff8a5b', brandInk: '#2a0f1e', ...darkSem };
const clinical: Theme = { bg: '#f4f6fb', surface: '#ffffff', surface2: '#eef2f9', surface3: '#e3e9f4', ink: '#0f1830', ink2: '#3c4a63', ink3: '#5d6984', ring: 'rgba(15,24,48,0.12)', brand: '#2b68ff', brandInk: '#ffffff', ...lightSem };
const terminal: Theme = { bg: '#0a0d0a', surface: '#0f140f', surface2: '#141a14', surface3: '#1e2e1e', ink: '#d6ffd6', ink2: '#9ccf9c', ink3: '#679d67', ring: 'rgba(70,255,122,0.14)', brand: '#46ff7a', brandInk: '#052b10', ...darkSem };
const cream: Theme = { bg: '#fbf6ef', surface: '#ffffff', surface2: '#f5efe5', surface3: '#efe6d8', ink: '#2a2018', ink2: '#5a4c3c', ink3: '#736656', ring: 'rgba(42,32,24,0.12)', brand: '#ff6f5e', brandInk: '#111310', ...lightSem };
const violet: Theme = { bg: '#100e18', surface: '#191529', surface2: '#201a33', surface3: '#2a2440', ink: '#ece9f7', ink2: '#c3bce0', ink3: '#918bab', ring: 'rgba(255,255,255,0.09)', brand: '#7756ff', brandInk: '#ffffff', ...darkSem };
const swiss: Theme = { bg: '#f6f5f1', surface: '#ffffff', surface2: '#f0efe9', surface3: '#e6e4dc', ink: '#111111', ink2: '#4a4842', ink3: '#686660', ring: 'rgba(17,17,17,0.12)', brand: '#e3261c', brandInk: '#ffffff', ...lightSem };

export interface PaletteMeta { key: string; name: string; theme: Theme; light: boolean }
export const PALETTES: PaletteMeta[] = [
  { key: 'teal', name: 'Elevated Teal', theme: teal, light: false },
  { key: 'midnight', name: 'Midnight Blue', theme: midnight, light: false },
  { key: 'sage', name: 'Sage', theme: sage, light: false },
  { key: 'noir', name: 'Mono Noir', theme: noir, light: false },
  { key: 'sunset', name: 'Sunset', theme: sunset, light: false },
  { key: 'clinical', name: 'Clinical Light', theme: clinical, light: true },
  { key: 'terminal', name: 'Terminal', theme: terminal, light: false },
  { key: 'cream', name: 'Cream & Coral', theme: cream, light: true },
  { key: 'violet', name: 'Electric Violet', theme: violet, light: false },
  { key: 'swiss', name: 'Swiss Ivory', theme: swiss, light: true },
];
export const paletteByKey = (k: string): Theme => (PALETTES.find((p) => p.key === k) ?? PALETTES[0]).theme;
export const DEFAULT_PALETTE = 'teal';

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
