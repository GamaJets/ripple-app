// ── Date / time / number formatting helpers ──────────────────────────────────
//
// Every one of these used to name 'en-GB'. They now ask src/lib/locale.ts,
// which reads the handset and says so — see that file's header for why this
// product has no default locale and why the fallback is not one either.
//
// `isoDate` is deliberately NOT in that group. It writes a storage key, not a
// sentence: `YYYY-MM-DD` is what the database column holds and what every
// lookup in this app is keyed by, and a locale has no business anywhere near
// it. Localising it would be the single most destructive change available in
// this file.
import { appLocale, prefers12Hour } from './locale';
import { localDate } from './localDate';

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A day as a person reads it — "Fri 14 Aug" in the UK, "Fri, Aug 14" in the US.
 *
 * Read through `localDate` rather than `new Date(iso)`. Half the values that
 * reach here are bare `YYYY-MM-DD` strings off a Postgres `date` column, and
 * `new Date('2026-08-01')` is UTC midnight — which reads back as 31 July for
 * every member west of Greenwich. This repo has shipped that bug twice; see
 * src/lib/localDate.ts, which is the file that ends it.
 */
export function fmtDay(iso: string): string {
  const d = localDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * "Today", "Tomorrow", or the day as the reader's own locale writes it.
 *
 * The fifth, sixth, seventh and eighth copies of this were four private
 * `dayLabel` helpers — one each in bookings.tsx, classes.tsx, standing.tsx and
 * messages.tsx — all of them ending
 *
 *     return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
 *
 * with `DOW` a hardcoded English array above them. That string is wrong twice
 * over for most readers: the weekday is in a language they may not use, and
 * `9/12` is 9 December in Britain and 12 September in the United States. It was
 * interpolated into every cancellation confirm and every "not cancelled" alert
 * on those four screens, which is to say into the sentences where being wrong
 * about which day it is costs somebody a session and a fee.
 *
 * `attendance.tsx` documented removing exactly this pattern from a fifth file.
 * This is the shared version, so there is no sixth.
 *
 * `now` is a parameter so the boundary can be argued with in a test rather than
 * inferred from whichever machine and whichever hour the test runs on. The
 * comparison is on the local calendar date, not on a 24-hour difference: 23:00
 * tonight and 01:00 tomorrow are one day apart to a reader and two hours apart
 * to arithmetic.
 *
 * "Today" and "Tomorrow" stay English words because every string on those four
 * screens is an English literal and this file cannot translate the sentence
 * they sit in. The DATE is the reader's own, which is the half that was wrong.
 */
export function fmtRelativeDay(iso: string, now: Date = new Date()): string {
  const d = localDate(iso);
  if (!d) return '—';
  const sameLocalDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameLocalDay(d, now)) return 'Today';
  const tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameLocalDay(d, tm)) return 'Tomorrow';
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The twelve short month names, in the reader's own language.
 *
 * For a PICKER, which is the one place a list of month names is still the right
 * shape — a date-of-birth wheel scrolls through months and cannot be a
 * formatted string. Everywhere else the whole date goes through a formatter and
 * this should not be reached.
 *
 * Indexed the way `Date#getMonth` is: 0 is January. Built from a real date in
 * each month rather than from an array of literals, because an array of
 * literals is precisely what two screens in this app carried and neither of
 * them was in the reader's language.
 *
 * Falls back to the English abbreviations only when `Intl` cannot be asked at
 * all — a Hermes build without ICU — for the same reason `FALLBACK_LOCALE`
 * exists: something must be written, and this is what the app already wrote.
 */
/**
 * A weekday name in the reader's own language — "Tuesday", "Dienstag",
 * "martedì".
 *
 * `dow` is 0 = Sunday, the same convention `Date.getDay()` and Postgres's
 * `extract(dow)` use, which is what `DOW_NAMES` in src/lib/recurring.ts is
 * indexed by. Built from a fixed UTC date whose UTC weekday is known —
 * 2024-01-07 was a Sunday — and formatted in UTC, so the reader's own zone
 * cannot shift it by a day.
 *
 * Falls back to English on a runtime with no Intl, for the same reason
 * `fmtClock` does: a fallback should not also be a blank.
 */
const EN_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function weekdayName(dow: number): string {
  const i = ((Math.trunc(dow) % 7) + 7) % 7;
  try {
    return new Intl.DateTimeFormat(appLocale(), { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2024, 0, 7 + i)));
  } catch { return EN_DOW[i]; }
}

export function monthNamesShort(locale: string = appLocale()): string[] {
  try {
    const f = new Intl.DateTimeFormat(locale, { month: 'short' });
    // Day 15 rather than day 1: no calendar this app is shown in shifts a
    // mid-month date into a neighbouring month, and a day-1 date in a
    // non-Gregorian calendar can.
    return Array.from({ length: 12 }, (_, m) => f.format(new Date(2026, m, 15)));
  } catch {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  }
}

/** A full date with its year — "14 Aug 2026", "Aug 14, 2026" — as the reader
 *  writes it. Read through `localDate` for the same reason `fmtDay` is: a bare
 *  `YYYY-MM-DD` parsed as UTC midnight reads back as the day before, west of
 *  Greenwich, and a date of birth is exactly such a column. */
export function fmtFullDay(iso: string): string {
  const d = localDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A wall-clock time as the reader's own locale writes it. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return fmtClock(d.getHours(), d.getMinutes());
}

/**
 * An hour and a minute, in the reader's clock.
 *
 * This was `${h % 12 || 12}${...}${h < 12 ? 'am' : 'pm'}` — a 12-hour clock
 * hand-built in English, with no 24-hour form at all. Most of the world reads
 * 24, including the United Kingdom the rest of this file was written for, and
 * "7pm" is not a time to a member in Berlin or Tokyo. It is also not an
 * English/other split: en-GB is a 24-hour locale and en-AU is a 12-hour one,
 * so the question is asked of Intl rather than of a table of countries.
 *
 * One piece of house form survives inside it. A whole hour drops its minutes —
 * "7 am", never "7:00 AM" — and so does the literal that separated them, which
 * is why this walks `formatToParts` rather than trimming the finished string.
 * That only happens on a 12-hour clock: "19" on its own is not a time, so a
 * 24-hour locale keeps its "19:00".
 *
 * Everything else in the string is the locale's own, including the space
 * before the day period, which en-US writes and fr-CA does not. The day period
 * is lowercased because this app writes it lowercase and for no other reason;
 * a locale that writes it in a non-Latin script is unchanged by that.
 */
export function fmtClock(h: number, m: number): string {
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '—';
  const at = new Date(2000, 0, 1, h, m);
  try {
    const parts = new Intl.DateTimeFormat(appLocale(), { hour: 'numeric', minute: '2-digit' }).formatToParts(at);
    const twelve = parts.some((p) => p.type === 'dayPeriod');
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const dropping = twelve && m === 0
        && (p.type === 'minute' || (p.type === 'literal' && parts[i + 1]?.type === 'minute'));
      if (dropping) continue;
      out += p.type === 'dayPeriod' ? p.value.toLowerCase() : p.value;
    }
    return out.trim();
  } catch {
    // Intl is a Hermes build flag. Falling back to what this function printed
    // before it could ask — English, 12-hour — rather than to nothing.
    const hh = ((h % 24) + 24) % 24;
    if (!prefers12Hour()) return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${hh % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${hh < 12 ? 'am' : 'pm'}`;
  }
}

/* ── Chart axis dates ─────────────────────────────────────────────────────────
 * The four forms a chart writes a date in, and the only four. They take year,
 * month index and day as NUMBERS rather than a string, because every one of
 * this codebase's date bugs has been a string being parsed: `new Date('2026-08')`
 * is UTC midnight and reads back as July west of Greenwich. Taking the parts
 * means there is nothing left to parse — src/lib/chartAxis.ts does the reading,
 * strictly and locally, and these only render.
 *
 * They live here beside fmtDay rather than in the chart file because the fifth
 * hand-rolled date formatter was exactly what this change was asked to remove:
 * src/ui/kit.tsx carried its own hardcoded month-name array, src/ui/Chart.tsx
 * printed "14/8" from raw getters, and the two disagreed on screen.
 *
 * They take the reader's own locale, the same as fmtDay and num() above. That
 * was once 'en-GB' in all four, with the note "when this app finally takes the
 * reader's own locale it takes it in one place, and this is the place." It
 * does, and this is: src/lib/locale.ts resolves the tag once and every
 * formatter in the app asks it.
 */

/** Axis, day precision: "14 Aug". No year — see chartAxis.axisLabel. */
export function fmtAxisDay(y: number, m: number, day: number): string {
  return new Date(y, m, day).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short' });
}

/** Axis, month precision: "Aug 26". The year is two digits because a six-month
 *  window that crosses New Year is otherwise two identically labelled Augusts. */
export function fmtAxisMonth(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString(appLocale(), { month: 'short', year: '2-digit' });
}

/** Touch readout, day precision: "14 Aug 2026". The exact date that was asked for. */
export function fmtPointDay(y: number, m: number, day: number): string {
  return new Date(y, m, day).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Touch readout, month precision: "Aug 2026". */
export function fmtPointMonth(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' });
}

/** Signed one-decimal delta between the first and last value of a series. */
export function seriesDelta(values: number[]): number {
  if (values.length < 2) return 0;
  return +(values[values.length - 1] - values[0]).toFixed(1);
}

/**
 * Title case for a value the exercise catalogue stores in lower snake case.
 *
 * A muscle, a goal and a tag are NAMES — "Rectus Abdominis", "Hypertrophy",
 * "Requires Bench". Capitalising only the first letter produced "Rectus
 * abdominis", which reads like a sentence someone cut off.
 *
 * Shared rather than copied. It existed four times — once per screen that
 * renders a catalogue value — and three of those copies still capitalised only
 * the first letter after the fourth was fixed, which is how the client app and
 * the coach app came to disagree about the name of a muscle.
 */
export function catalogueValue(s: string | null | undefined): string {
  return String(s || '')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * A figure as a person reads it: thousands separated.
 *
 * Reported as "when you have more than 3 digits in a number add a comma."
 * Half the screens already called toLocaleString and half printed the raw
 * number, so the same day's calories appeared as 2,860 on the Meals hero and
 * 2860 four lines down. A helper rather than a habit, so the two cannot drift.
 *
 * Rounds first: a hero showing 1,499.8 kcal is not a hero, and separators on a
 * fractional number look like a bug even when the number is right. Anything
 * that is not a number renders as a dash — never as 0, and never as "NaN".
 */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString(appLocale());
}

/** The same, keeping one decimal — for weights and other measured figures
 *  where the tenth is the point (73.5 kg, 1,204.5 kg lifted). */
export function num1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(appLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
