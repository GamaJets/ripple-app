import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import './globals.css';
import { Console } from './Console';
import { BRAND } from '@lib/brands';

// The typeface was the loudest thing wrong with this console. It ran on
// ui-sans-serif / Roboto / Arial, which is not a choice — it is the absence of
// one, and it is the first thing that reads as unconsidered.
//
// Three families, each with one job. Archivo carries the interface, IBM Plex
// Mono carries every figure (the console is a book of numbers and they must
// line up), and Instrument Serif is allowed exactly one appearance per screen:
// the page title. That single serif word is what stops a hairline, zero-radius,
// all-mono console reading like a 1998 admin panel.
//
// next/font self-hosts these at build time, so no request leaves the browser to
// fetch them and there is no flash of a fallback face.
const sans = Archivo({
  subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-sans',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-mono',
});
const display = Instrument_Serif({
  subsets: ['latin'], weight: '400', display: 'swap', variable: '--font-display',
});

/**
 * The tab title, before anybody is signed in.
 *
 * Taken from `src/lib/brands.ts` rather than typed here. That table is the one
 * both `app.config.ts` and the app bundle read, and it exists precisely so a
 * chain buying Repple does not find its supplier's name in the product — the
 * console was the last surface still saying "Repple Studio" whoever was looking
 * at it, and `brands.ts` was imported nowhere in `studio-web`.
 *
 * This is only the FIRST answer. `Console` replaces it with the gym's own name
 * once the session resolves, which is the earliest moment the gym is knowable —
 * `metadata` is evaluated on the server with nobody signed in.
 */
export const metadata: Metadata = {
  title: BRAND.apps.owner.name,
  description: 'The desk where a gym is run.',
};

/**
 * The palette, decided BEFORE the first paint.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * `globals.css` carries the dark palette on bare `:root` and the daylight one
 * on `:root[data-theme="light"]`, and nothing sets `data-theme` until
 * `Console`'s mount effect runs — which is after hydration, which is after the
 * page has been painted. So a reader on the daylight palette got the dark one
 * first, full screen, and then the flip.
 *
 * On this console that is not the usual one-off flash. There is no router: the
 * rail is plain `<a href>` and every click is a fresh document load, so the
 * flash is on EVERY screen, every time, for the whole of somebody's working
 * day — and it is worst on the front desk in daylight, which is the one place
 * this palette exists for.
 *
 * ── Why it is a string and not a module ───────────────────────────────────
 *
 * Nothing that has to run before paint can be imported; it has to be in the
 * document. That makes this the second copy of the three lines in
 * `initialTheme` (app/Console.tsx), which is a real cost and worth being
 * honest about: if the two ever disagree, `Console`'s effect is the one that
 * wins, because it runs afterwards and overwrites this — so the failure mode
 * of a drift is the flash coming back, not a wrong palette sticking.
 *
 * Everything is inside a `try`. A browser with storage disabled, or no
 * `matchMedia`, falls through to the dark default and the effect corrects it
 * later — exactly today's behaviour, which is the floor this cannot drop below.
 */
const PAINT_THEME = `try{var k=localStorage.getItem('repple-studio-theme');` +
  `if(k!=='light'&&k!=='dark'){k=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}` +
  `document.documentElement.dataset.theme=k;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` because the line above writes `data-theme` on
    // this element before React hydrates it, and React would otherwise report
    // the attribute it did not render as a mismatch. It suppresses the warning
    // for this element's own attributes only — not for anything inside it.
    <html lang="en" suppressHydrationWarning
          className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      {/* First in the body so it executes before the browser paints what
          follows it. */}
      <body>
        <script dangerouslySetInnerHTML={{ __html: PAINT_THEME }} />
        {/* `Console` sets the palette and the gym's brand on the document
            itself. It renders one control and is otherwise invisible; it is a
            sibling of the page rather than a wrapper so a page's own error
            boundary cannot take the theme down with it. */}
        {children}
        <Console />
      </body>
    </html>
  );
}
