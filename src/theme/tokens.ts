// Design tokens — 10 selectable palettes. Elevated Teal is the default. Every
// palette carries the full token set so any screen renders on any palette.
// The client & trainer pick a palette in Appearance; the owner can also set a
// custom brand colour on top (white-label).

const darkSem = { grid: '#2c2c2a', s1: '#3987e5', s2: '#199e70', s3: '#c98500', s5: '#9085e9', s6: '#e66767', good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d03b3b' };
const lightSem = { grid: '#e1e0d9', s1: '#2a78d6', s2: '#1baf7a', s3: '#eda100', s5: '#4a3aa7', s6: '#e34948', good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d03b3b' };

// ── Elevated Teal (DEFAULT) ────────────────────────────────────────────────
export const teal = {
  bg: '#0c1413', surface: '#10201d', surface2: '#14261f', surface3: '#1b3229',
  ink: '#e8f2f0', ink2: '#b6c9c4', ink3: '#6f8b87', ring: 'rgba(255,255,255,0.09)',
  brand: '#16b8a6', brandInk: '#04211d', ...darkSem, s3: '#c9a35b',
};
export type Theme = typeof teal;

const midnight: Theme = { bg: '#0a0f1e', surface: '#111a30', surface2: '#16223c', surface3: '#1e2b47', ink: '#eaf0ff', ink2: '#b9c6e0', ink3: '#6b7a99', ring: 'rgba(255,255,255,0.08)', brand: '#5b9dff', brandInk: '#04122e', ...darkSem };
const sage: Theme = { bg: '#0f1411', surface: '#16201a', surface2: '#1b281f', surface3: '#24322a', ink: '#e9f0e9', ink2: '#bcd0bc', ink3: '#7d8f7d', ring: 'rgba(255,255,255,0.08)', brand: '#8fd694', brandInk: '#0c1f12', ...darkSem };
const noir: Theme = { bg: '#000000', surface: '#101010', surface2: '#181818', surface3: '#242424', ink: '#ffffff', ink2: '#c8c8c8', ink3: '#7a7a7a', ring: 'rgba(255,255,255,0.12)', brand: '#f2f2f2', brandInk: '#000000', ...darkSem };
const sunset: Theme = { bg: '#140e14', surface: '#1e141e', surface2: '#271a27', surface3: '#33223a', ink: '#ffffff', ink2: '#d9c7d4', ink3: '#9a8a9a', ring: 'rgba(255,255,255,0.09)', brand: '#ff8a5b', brandInk: '#2a0f1e', ...darkSem };
const clinical: Theme = { bg: '#f4f6fb', surface: '#ffffff', surface2: '#eef2f9', surface3: '#e3e9f4', ink: '#0f1830', ink2: '#3c4a63', ink3: '#6b7896', ring: 'rgba(15,24,48,0.12)', brand: '#2f6bff', brandInk: '#ffffff', ...lightSem };
const terminal: Theme = { bg: '#0a0d0a', surface: '#0f140f', surface2: '#141a14', surface3: '#1e2e1e', ink: '#d6ffd6', ink2: '#9ccf9c', ink3: '#4f7a4f', ring: 'rgba(70,255,122,0.14)', brand: '#46ff7a', brandInk: '#052b10', ...darkSem };
const cream: Theme = { bg: '#fbf6ef', surface: '#ffffff', surface2: '#f5efe5', surface3: '#efe6d8', ink: '#2a2018', ink2: '#5a4c3c', ink3: '#9a8b78', ring: 'rgba(42,32,24,0.12)', brand: '#ff6f5e', brandInk: '#ffffff', ...lightSem };
const violet: Theme = { bg: '#100e18', surface: '#191529', surface2: '#201a33', surface3: '#2a2440', ink: '#ece9f7', ink2: '#c3bce0', ink3: '#7a739a', ring: 'rgba(255,255,255,0.09)', brand: '#7c5cff', brandInk: '#ffffff', ...darkSem };
const swiss: Theme = { bg: '#f6f5f1', surface: '#ffffff', surface2: '#f0efe9', surface3: '#e6e4dc', ink: '#111111', ink2: '#4a4842', ink3: '#8a8880', ring: 'rgba(17,17,17,0.12)', brand: '#e5352b', brandInk: '#ffffff', ...lightSem };

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

/** Brand-ink (readable text on the brand colour) from luminance. */
export function brandInkFor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 140 ? '#111310' : '#ffffff';
}
