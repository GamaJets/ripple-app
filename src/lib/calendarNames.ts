// The names down the side of a month grid, in the reader's language.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// `src/lib/format.ts` writes a DATE as the reader writes it, and everywhere a
// screen has one instant to print, that is the answer. A calendar grid does not
// have one instant to print: it needs the seven weekday names as a row and the
// twelve month names as a heading, detached from any particular date. There was
// one helper for that — `monthNamesShort` in format.ts — and everything else
// was a literal array.
//
// `app/(client)/calendar.tsx`, which is the screen a member books a session on,
// still held both of them:
//
//     const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
//     const MON = ['January', 'February', … ];
//
// `fmtRelativeDay`'s own header ends "This is the shared version, so there is no
// sixth." Book Sessions was the sixth. It is the one that matters most of the
// six: those two arrays were interpolated into the day heading, the month
// heading, the spoken label on every cell of the grid, the "Session booked" and
// "Not booked" alerts, and — through `slot` — into the push notification the
// COACH receives, so an English weekday was being written into somebody else's
// phone as well as the member's.
//
// ── Sunday first, deliberately, and only the names are the locale's ───────
//
// This app starts its week on Sunday everywhere (`src/lib/weekStart.ts`), and
// the grids that consume these are built Sunday-first in their own arithmetic.
// Localising the ORDER here would silently rotate every existing grid by a day
// and file Monday's session under Sunday's column — the same class of bug
// `localDate.ts` exists to end. So the order is fixed and documented, and what
// the locale decides is the words.
//
// ── Why the arrays are built from real dates ──────────────────────────────
//
// `Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)` is the only way
// to get a weekday name for a locale, so seven dates are needed whose weekdays
// are known. January 2023 opens on a Sunday (2023-01-01 was a Sunday), which
// gives seven consecutive days with no arithmetic to get wrong. Months use day
// 15 rather than day 1 for the reason `monthNamesShort` gives: no calendar this
// app is shown in shifts a mid-month date into a neighbouring month, and a
// day-1 date in a non-Gregorian calendar can.
//
// ── The cache ─────────────────────────────────────────────────────────────
//
// These are called from inside a render loop — the spoken label on a calendar
// cell is built per cell, forty-two times a month — and an `Intl.DateTimeFormat`
// per call is not free. The cache is keyed on the locale tag, so a handset whose
// locale changes gets new names rather than the old ones for ever, and a test
// can ask for two locales in a row and be answered honestly.
//
// Pure — no React, no clock, no storage. `appLocale()` is read as a default
// argument so every function can be given a locale outright under test.
import { appLocale } from './locale';

/** The English fallback, which is what this app already wrote. Used only when
 *  `Intl` cannot be asked at all — a Hermes build with no ICU — for the same
 *  reason `FALLBACK_LOCALE` exists: something has to be written. */
const EN_MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const EN_DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_DAYS_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** 1 January 2023 was a Sunday, so these seven are Sunday → Saturday with no
 *  arithmetic. Built once; `Intl` is not mutated by formatting. */
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i));
const MONTH_SAMPLES = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 15));

type Kind = 'monthsLong' | 'daysShort' | 'daysNarrow';

const cache = new Map<string, readonly string[]>();

function build(kind: Kind, locale: string): string[] {
  try {
    switch (kind) {
      case 'monthsLong': {
        const f = new Intl.DateTimeFormat(locale, { month: 'long' });
        return MONTH_SAMPLES.map((d) => f.format(d));
      }
      case 'daysShort': {
        const f = new Intl.DateTimeFormat(locale, { weekday: 'short' });
        return WEEK.map((d) => f.format(d));
      }
      case 'daysNarrow': {
        const f = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
        return WEEK.map((d) => f.format(d));
      }
    }
  } catch {
    return kind === 'monthsLong' ? EN_MONTHS_LONG : kind === 'daysShort' ? EN_DAYS_SHORT : EN_DAYS_NARROW;
  }
}

/**
 * The cached array for one kind and one locale.
 *
 * Frozen before it is handed out. One array is shared by every caller for the
 * life of the process, so a caller that sorted or spliced it in place would
 * rewrite the weekday row for every screen in the app and nothing would say
 * where it happened. Freezing turns that into a throw at the call site instead.
 */
function names(kind: Kind, locale: string): readonly string[] {
  const key = `${kind}|${locale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const built = Object.freeze(build(kind, locale));
  cache.set(key, built);
  return built;
}

/**
 * The twelve month names in full — "January", "Januar", "janvier" — for a
 * calendar heading that has a month but no particular day in it.
 *
 * Long rather than short because the heading over a month grid is the one place
 * in this app with room for the whole word, and `monthNamesShort` in
 * src/lib/format.ts is what a cramped one asks for. Neither is `.slice(0, 3)`
 * on the other: three characters off a localised month name is wrong in most
 * languages that are not English.
 */
export const monthNamesLong = (locale: string = appLocale()): readonly string[] => names('monthsLong', locale);

/** The seven weekday names, abbreviated, SUNDAY FIRST — "Sun", "So", "dim.".
 *  The order is this app's (src/lib/weekStart.ts); only the words are the
 *  locale's. */
export const weekdayNamesShort = (locale: string = appLocale()): readonly string[] => names('daysShort', locale);

/**
 * The seven weekday names at their narrowest, SUNDAY FIRST — the row of single
 * letters above a month grid.
 *
 * `weekday: 'narrow'` rather than the first character of the short name.
 * Slicing is wrong wherever a letter is not a character — a Japanese narrow
 * weekday is "日", not the first byte of "日曜日" — and several locales write a
 * two-character narrow form on purpose. Ambiguity is expected and is the
 * locale's own choice: English narrow weekdays are S M T W T F S, with two
 * pairs that collide, which is why the cells themselves carry a spoken label
 * naming the date rather than relying on this row.
 */
export const weekdayNamesNarrow = (locale: string = appLocale()): readonly string[] => names('daysNarrow', locale);
