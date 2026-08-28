import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'Repple Studio',
  description: 'The desk where a gym is run.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
