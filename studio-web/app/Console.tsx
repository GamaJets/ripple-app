'use client';

// The two things the console has to decide before it draws anything: what
// colour it is, and whose name is on it.
//
// ── Why this is one component and not two ─────────────────────────────────
//
// Both write to `document.documentElement`, both run once on mount, and both
// are the answer to the same complaint — that this console is Repple's rather
// than the gym's. Splitting them would mean two effects racing to set the same
// element's dataset and style, in an order nothing guarantees.
//
// It renders one control (the light/dark switch) and otherwise nothing.

import { useCallback, useEffect, useState } from 'react';
import { supabase, loadMe } from '@/lib/supabase';
import { BRAND } from '@lib/brands';

type Theme = 'dark' | 'light';

/**
 * Where the reader's choice is kept.
 *
 * `localStorage`, not a cookie and not a column. It is a per-DEVICE preference
 * — the owner who works at a bright front desk and a dark office wants a
 * different answer in each place — and storing it on `tenants` would make one
 * person's eyes a fact about the gym.
 */
const THEME_KEY = 'repple-studio-theme';

/**
 * The theme to start in.
 *
 * ── Why `prefers-color-scheme` is honoured here and not in CSS ────────────
 *
 * `globals.css` carries a complete, contrast-audited light palette under
 * `:root[data-theme="light"]` — and NOTHING in this console has ever set
 * `data-theme`, so every one of those twenty declarations was dead code. The
 * obvious CSS fix is an `@media (prefers-color-scheme: light)` block, but that
 * means writing the whole palette a second time: two copies of twelve colour
 * values, which will drift, and the copy that drifts is the one nobody looks at.
 *
 * So the media query is asked in JavaScript instead and the answer is written
 * as `data-theme`. One palette, one selector, and the system preference is
 * still honoured on a device that has never been told otherwise.
 *
 * An explicit choice always wins over the system: somebody who pressed the
 * switch meant it, and a laptop that flips to dark at sunset must not undo it.
 */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // A browser with storage disabled is not an error state; it just has no
    // memory. Fall through to the system preference.
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch { /* no matchMedia: the dark default stands */ }
  return 'dark';
}

/**
 * A CSS colour the browser will actually accept.
 *
 * `tenants.brand_color` is free text an owner typed, and it is written straight
 * into `--brand` — which every accent, link, button and focus ring on this
 * console reads. A malformed value would silently blank all of them, and the
 * result is a console with invisible buttons rather than an error anybody can
 * act on. Only the two hex shapes are allowed through; anything else keeps the
 * default and the gym simply looks like Studio.
 */
function safeHex(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null;
}

/**
 * Black or white ink over `bg`, whichever is readable.
 *
 * `--brand-ink` is the text ON the brand colour — button labels, the context
 * switch, the active nav pill. Left at Studio's near-black it becomes
 * unreadable the moment a gym picks a dark brand colour, and a gym whose
 * primary buttons are unreadable will not describe the problem as a theming
 * one.
 *
 * Relative luminance per WCAG 2.x, not a naive average: the eye is roughly
 * seven times more sensitive to green than to blue, and an average puts pure
 * blue and pure yellow in the same place.
 */
function inkFor(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const chan = (i: number) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
  // 0.179 is where black and white draw level against a mid tone; above it
  // black wins, below it white does.
  return L > 0.179 ? '#101010' : '#ffffff';
}

export function Console() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Applied in an effect rather than during render: `document` does not exist
  // while Next renders this on the server, and `data-theme` on the html element
  // is not something React owns here.
  useEffect(() => {
    const t = initialTheme();
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }, []);

  const flip = useCallback(() => {
    setTheme((was) => {
      const next: Theme = was === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(THEME_KEY, next); } catch { /* nothing to remember it with */ }
      return next;
    });
  }, []);

  /**
   * The gym's own colour and the gym's own name.
   *
   * ── What was hardcoded ───────────────────────────────────────────────────
   *
   * `tenants.brand_color` and `tenants.logo` have existed since part 01 and are
   * read by nothing in this console; `globals.css` fixes `--brand` to Studio
   * amber; the browser tab says "Repple Studio" whoever is signed in. The phone
   * app already themes from the tenant. A chain buying Repple gets its own app
   * and a console with its supplier's name on it.
   *
   * ── Why the tab title is set here and not in `metadata` ─────────────────
   *
   * `metadata` is evaluated on the server, before anybody is signed in and with
   * no tenant to read. The gym's name is only knowable once the session is.
   *
   * A failed read changes nothing, deliberately. There is no error banner and
   * no fallback message: the console keeps Studio's own colour and Studio's own
   * title, which is exactly what an unbranded gym sees anyway, and a banner
   * about a cosmetic query would be noise on top of every screen.
   */
  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live || !who?.tenantId) return;
      // no-error-ok: the brand is decoration; a refused read leaves the console in Studio's own colours, which is what an unbranded gym sees
      const { data } = await supabase
        .from('tenants').select('name, brand_color').eq('id', who.tenantId).single();
      if (!live || !data) return;

      const hex = safeHex((data as any).brand_color);
      if (hex) {
        document.documentElement.style.setProperty('--brand', hex);
        document.documentElement.style.setProperty('--brand-ink', inkFor(hex));
      }
      const name = String((data as any).name ?? '').trim();
      // The gym first, the product second — the tab is read by somebody with
      // eleven tabs open, and the half they need is which gym.
      if (name) document.title = `${name} · ${BRAND.label}`;
    })();
    return () => { live = false; };
  }, []);

  // Nothing until the theme is known, so the switch never renders with the
  // wrong label for a frame.
  if (theme === null) return null;

  return (
    <button
      onClick={flip}
      className="mono no-print"
      aria-label={theme === 'light' ? 'Switch to the dark palette' : 'Switch to the daylight palette'}
      title={theme === 'light' ? 'Dark' : 'Daylight'}
      style={{
        // Fixed rather than in the rail, because the rail is
        // `components/Shell.tsx` and every page renders it — a control placed
        // there would have to be threaded through eleven call sites. Bottom
        // right is out of the way of the rail's own sign-out button.
        position: 'fixed', right: 10, bottom: 10, zIndex: 20,
        background: 'var(--surface2)', color: 'var(--ink3)',
        border: '1px solid var(--ring)', borderRadius: 0,
        padding: '5px 9px', fontSize: 9.5, letterSpacing: '0.1em',
        textTransform: 'uppercase', cursor: 'pointer',
      }}
    >
      {theme === 'light' ? 'Dark' : 'Daylight'}
    </button>
  );
}
