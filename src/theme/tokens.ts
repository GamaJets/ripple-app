// Design tokens — carried over from the validated prototype (dark + light).
// The brand color is per-tenant and overrides `brand` at runtime.
export const dark = {
  bg: '#0d0d0d', surface: '#1a1a19', surface2: '#232322', surface3: '#2c2c2a',
  ink: '#ffffff', ink2: '#c3c2b7', ink3: '#898781',
  grid: '#2c2c2a', ring: 'rgba(255,255,255,0.10)',
  brand: '#2dd4bf', brandInk: '#062e2a',
  s1: '#3987e5', s2: '#199e70', s3: '#c98500', s5: '#9085e9', s6: '#e66767',
  good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d03b3b',
};
export const light = {
  bg: '#f9f9f7', surface: '#fcfcfb', surface2: '#f0efec', surface3: '#e1e0d9',
  ink: '#0b0b0b', ink2: '#52514e', ink3: '#898781',
  grid: '#e1e0d9', ring: 'rgba(11,11,11,0.12)',
  brand: '#2dd4bf', brandInk: '#062e2a',
  s1: '#2a78d6', s2: '#1baf7a', s3: '#eda100', s5: '#4a3aa7', s6: '#e34948',
  good: '#0ca30c', warn: '#fab219', serious: '#ec835a', crit: '#d03b3b',
};
export type Theme = typeof dark;

/** Brand-ink (readable text on the brand color) from luminance. */
export function brandInkFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 140 ? '#111310' : '#ffffff';
}
