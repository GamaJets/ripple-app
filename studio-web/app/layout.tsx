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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      {/* `Console` sets the palette and the gym's brand on the document itself.
          It renders one control and is otherwise invisible; it is a sibling of
          the page rather than a wrapper so a page's own error boundary cannot
          take the theme down with it. */}
      <body>{children}<Console /></body>
    </html>
  );
}
