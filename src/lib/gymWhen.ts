// Whose clock a date on the screen is drawn on — and the one answer the whole
// console has to give the same way twice.
//
// ── What went wrong ───────────────────────────────────────────────────────
//
// The Studio console printed dates three different ways, and two of them were
// wrong for the same reader:
//
//   · `new Date(x).toLocaleDateString()` — the READER's locale and the
//     READER's zone. Around sixty call sites, including every payment date on
//     /accounting and every closed-month stamp on /close;
//   · `new Date(t).toISOString().slice(0, 16)` — nobody's locale and UTC's
//     zone, on /orders;
//   · `new Date(x).toLocaleDateString(undefined, { timeZone: zone })` on
//     /staff, which is the right one and was the only screen doing it.
//
// A gym in Dubai read from a laptop in London has four hours of every day filed
// under the wrong date. On /accounting and /close, which are printed for an
// accountant, a payment taken at 01:00 on 1 September in Dubai reads as
// 31 August in London — on the two documents where the month boundary is the
// entire point. That is not a cosmetic difference: it moves money between
// months in a document somebody signs.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// A date is written in the READER's locale and the GYM's zone.
//
// Those are two different questions and they have two different answers, which
// is why the console kept getting one of them right and the other wrong on the
// same line. The locale is a fact about the person reading — a gym in Dubai,
// one in London and one in Tokyo run this same binary and there is no house
// separator or month order that is not simply wrong for two of them, which is
// the argument `scripts/check-locale.mjs` already enforces. The zone is a fact
// about the GYM, because the day a payment fell on is a fact about the gym's
// till and does not change when a bookkeeper opens a laptop somewhere else.
//
// ── When the gym has not set one ──────────────────────────────────────────
//
// `src/lib/gymZone.ts` answers "no zone means no answer" and returns null,
// which is right for the functions that turn an instant into a DAY: bucket a
// month's takings on the reader's clock and the totals are wrong. It is the
// wrong answer for rendering an instant somebody is looking at. Refusing to
// print any date at all, on every screen, for every gym that has not filled in
// a setting, takes a working console away to make a point.
//
// So these fall back to the reader's zone and SAY SO. `atGym` on the result is
// false in that case and `NO_ZONE_NOTE` is the sentence to print beside it —
// which is what /staff was already doing, and is the difference between a
// screen that is wrong and a screen that is honest about being approximate.
//
// Framework-free like the rest of src/lib, so the console and the phone can
// both use it and neither owns it.
import { isZone, NO_ZONE_NOTE } from './gymZone';

export { NO_ZONE_NOTE };

/** A rendered date or time, and whose clock it was rendered on. */
export interface GymWhen {
  text: string;
  /** True when this was drawn on the GYM's clock. False means the gym has not
   *  set a timezone and the reader's own was used — print `NO_ZONE_NOTE`. */
  atGym: boolean;
}

/**
 * What `toLocaleString()` with no arguments produces, written out.
 *
 * `Intl.DateTimeFormat` with no component options gives a DATE and no time,
 * which is not what `toLocaleString()` gives — so a migration that swapped one
 * for the other would silently drop the time off every timestamp in the
 * console. Naming the defaults is what keeps the swap behaviour-identical
 * except for the zone, which is the only thing it is meant to change.
 */
const DATE_ONLY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_ONLY: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: 'numeric', second: 'numeric' };
const DATE_AND_TIME: Intl.DateTimeFormatOptions = { ...DATE_ONLY, ...TIME_ONLY };

/** True when this zone is one this runtime can actually draw in. The screens
 *  ask it to decide whether to print `NO_ZONE_NOTE`. */
export function drawnAtGym(zone: string | null | undefined): boolean {
  return isZone(zone);
}

/**
 * The note to print under a set of dates that are NOT the gym's own, or null
 * when they are.
 *
 * One wording in one place, for the reason `NO_ZONE_NOTE` itself is one
 * wording: sixty call sites explaining the same silence sixty ways is how they
 * came to disagree about what the silence meant.
 */
export function whoseClockNote(zone: string | null | undefined): string | null {
  return isZone(zone) ? null : NO_ZONE_NOTE;
}

function render(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  fallback: Intl.DateTimeFormatOptions,
  opts?: Intl.DateTimeFormatOptions,
): GymWhen | null {
  if (at == null || at === '') return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const zoned = isZone(zone);
  // Only the components the caller did not ask for are filled in. A caller
  // passing `{ month: 'short' }` wants a short month and the rest of the
  // default date, not a short month with the time bolted on.
  const asked = opts && Object.keys(opts).some((k) => k !== 'timeZone');
  const options: Intl.DateTimeFormatOptions = {
    ...(asked ? {} : fallback),
    ...(opts ?? {}),
    // Last, so a caller cannot pass a zone of its own and quietly defeat this
    // module. The gym's clock or the reader's; there is no third option and no
    // per-call override.
    timeZone: zoned ? (zone as string) : undefined,
  };
  try {
    // No locale literal — `undefined` is the reader's own tag, which is the
    // rule scripts/check-locale.mjs enforces and the half of the question this
    // module deliberately does not change.
    return { text: new Intl.DateTimeFormat(undefined, options).format(d), atGym: zoned };
  } catch {
    // An option combination this runtime refuses. Better to draw nothing than
    // to fall back to a format nobody chose.
    return null;
  }
}

/** A date, in the reader's locale and the gym's zone. Null for an instant that
 *  is not one — never the string "Invalid Date", which has been rendered into
 *  a table cell in this codebase before. */
export function gymWhenDate(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): GymWhen | null {
  return render(at, zone, DATE_ONLY, opts);
}

/** A date and a time, in the reader's locale and the gym's zone. */
export function gymWhenDateTime(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): GymWhen | null {
  return render(at, zone, DATE_AND_TIME, opts);
}

/** A time of day, in the reader's locale and the gym's zone. */
export function gymWhenTime(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): GymWhen | null {
  return render(at, zone, TIME_ONLY, opts);
}

/**
 * A CALENDAR DATE — `YYYY-MM-DD` — in the reader's locale and no zone at all.
 *
 * The third question, and the one that keeps getting answered with the wrong
 * tool. "Week of 6 September", "September 2026", "the 1st" are not instants:
 * they are already days, and asking which day they fall on is a question with
 * no content. Both available shortcuts get it wrong in opposite directions —
 * `new Date('2026-09-06T00:00:00')` is LOCAL midnight, so rendering it in the
 * gym's zone moves it a day for any reader far enough east or west; rendering
 * it on the reader's clock makes it depend on a laptop for no reason at all.
 *
 * So it is parsed as UTC midnight and formatted in UTC, which cancels: the
 * output is the same three numbers that went in, spelled the reader's way.
 * Null for anything that is not a calendar date, because a string that is not
 * one has no day to spell.
 */
export function calendarDateText(
  day: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string | null {
  const d = String(day ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00.000Z`);
  if (Number.isNaN(t)) return null;
  const asked = opts && Object.keys(opts).some((k) => k !== 'timeZone');
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...(asked ? {} : DATE_ONLY),
      ...(opts ?? {}),
      timeZone: 'UTC',
    }).format(new Date(t));
  } catch {
    return null;
  }
}

/* ── the text-only forms ───────────────────────────────────────────────────
 *
 * Most call sites are a table cell that has already said, once, at the top of
 * the screen, whose clock the column is on. These are for those: the same
 * answer with the `atGym` flag dropped, so a cell is one expression rather than
 * four. A screen that uses them owes the reader `whoseClockNote` somewhere on
 * the page — that is the whole bargain, and it is why the flagged forms above
 * exist at all.
 */

export function gymDateText(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string | null {
  return gymWhenDate(at, zone, opts)?.text ?? null;
}

export function gymDateTimeText(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string | null {
  return gymWhenDateTime(at, zone, opts)?.text ?? null;
}

export function gymTimeText(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string | null {
  return gymWhenTime(at, zone, opts)?.text ?? null;
}
