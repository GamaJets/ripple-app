// Correcting the DATE on a scan, and what doing it costs.
//
// ── why the date was not editable ──────────────────────────────────────────
//
// app/(client)/scans.tsx said so in as many words: "The date is deliberately
// not editable here. A scan's date is what decides whether it is the one the
// meal plan follows, and moving it is a different act from fixing a digit — one
// that can silently hand the client's targets to a different reading. Deleting
// and re-adding says out loud what changing the date would do quietly."
//
// The caution is right and the remedy was not. Deleting and re-adding does not
// say anything out loud; it destroys things. A scan carries a photograph of the
// printout and a thirteen-key `metrics` breakdown — visceral fat, BMR, fat and
// lean mass, five segmental lean figures, water, protein, minerals — and none
// of that survives a delete. Re-keying it by hand off a sheet the member may no
// longer be holding is not a recovery, so the real effect of the rule was that
// a scan entered on the wrong day stayed on the wrong day forever, dragging the
// member's charts and possibly their calorie target with it.
//
// So the date moves, and the consequence is SAID rather than avoided. That is
// what this module is for: it works out what a particular move actually does to
// the app's answers, so the screen can put it in front of the member before
// they commit to it rather than discovering it afterwards.
//
// ── dates here are strings ─────────────────────────────────────────────────
//
// `scans.taken_at` is a bare postgres DATE — 'YYYY-MM-DD', a calendar day with
// no time and no zone in it. `Date.parse` reads one of those as UTC midnight,
// which is the PREVIOUS DAY for every member west of Greenwich, and this screen
// has already shipped that bug once: a scan taken on the 1st was captioned
// "31/7" in New York. Every comparison in this file is therefore a string
// comparison over the first ten characters, which for this format sorts and
// equates exactly as the calendar does and cannot acquire a timezone.
//
// The one place a real Date is used is the wheel, below, and only to ask the
// calendar how many days a month has.

/** How many days that month has. February is why this is not a lookup table. */
export function daysInMonth(monthIndex: number, year: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** The day part of a stored value, which is all any comparison here may use. */
export const scanDay = (iso: string | null | undefined): string => String(iso ?? '').slice(0, 10);

/** Where the three wheels have to sit to be showing a stored date. */
export interface WheelPos { years: number[]; yearIndex: number; month: number; day: number }

/**
 * The wheel position for a stored scan date — or null where the value cannot be
 * read as one.
 *
 * `years` comes back WIDENED to contain the stored year, and the caller is
 * expected to adopt it: a scan dated outside the ordinary ten-year window is a
 * date the wheel would otherwise be unable to show, and a wheel that cannot
 * show the date it was opened on is a wheel that silently rewrites it. That
 * exact failure is written up in src/lib/scanYears.ts — the `yi >= 0` guard
 * that skipped the whole date and left the wheel on whatever it happened to be
 * showing, which was then saved.
 *
 * Null rather than a fallback to today. A screen handed null should leave the
 * date alone and say it cannot be edited, because defaulting an unreadable
 * stored date to the current one is the app quietly deciding when something
 * happened.
 */
export function wheelPosition(years: number[], iso: string | null | undefined): WheelPos | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scanDay(iso));
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth(month, year)) return null;
  const yi = years.indexOf(year);
  if (yi < 0) return null;
  return { years, yearIndex: yi, month, day: day - 1 };
}

/**
 * The date three wheel positions are pointing at, as a bare 'YYYY-MM-DD'.
 *
 * The day is CLAMPED to the length of the month rather than allowed to
 * overflow: a wheel sitting on the 31st when the month wheel is turned to
 * February would otherwise produce '2026-02-31', which postgres rejects and
 * `new Date` silently reads as the 3rd of March.
 */
export function isoFromWheel(year: number, monthIndex: number, dayIndex: number): string {
  const month = Math.max(0, Math.min(11, monthIndex));
  const day = Math.max(1, Math.min(daysInMonth(month, year), dayIndex + 1));
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The two fields of a scan this module needs to reason about a move. */
export interface DatedScan { id: string; takenAt: string }

/**
 * What moving one scan to a new day would actually do.
 *
 * Every field is a fact about the scans it was handed. A caller whose read of
 * the history did not land whole must not present `wasNewest`, `becomesNewest`
 * or `collidesWith` as answers — under a failed read `scans` is empty, which is
 * indistinguishable from a member who has never been measured, and the screen
 * would cheerfully tell somebody with two years of history that this is their
 * first scan. The same trap `saveScan` on that screen already guards with
 * `historyKnown`.
 */
export interface DateMove {
  /** False when the wheels came back where they started. Nothing is written. */
  changed: boolean;
  /** The id of another scan already sitting on the target day, or null. */
  collidesWith: string | null;
  /** This scan is currently the highest-dated one — the reading the meal plan,
   *  the profile weight and every "current" figure in the app follow. */
  wasNewest: boolean;
  /** It would be after the move. */
  becomesNewest: boolean;
  /** The move takes the title away from this scan and gives it to another —
   *  which is the case worth a sentence, because the member's calorie and
   *  protein targets move with it and nothing else on screen would say so. */
  handsOverNewest: boolean;
}

export function planDateMove(scans: DatedScan[], id: string, toISO: string): DateMove {
  const target = scanDay(toISO);
  const me = scans.find((s) => s.id === id) ?? null;
  const from = scanDay(me?.takenAt);
  const others = scans.filter((s) => s.id !== id);
  // Highest day wins, and ties are not broken here: two scans on one day is a
  // state this screen already tolerates (the history folds by day), so "is
  // there anything strictly later" is the only question with one answer.
  const latestOther = others.reduce((hi, s) => (scanDay(s.takenAt) > hi ? scanDay(s.takenAt) : hi), '');
  const wasNewest = me != null && (latestOther === '' || from >= latestOther);
  const becomesNewest = me != null && (latestOther === '' || target >= latestOther);
  return {
    changed: me != null && target !== from && target !== '',
    collidesWith: others.find((s) => scanDay(s.takenAt) === target)?.id ?? null,
    wasNewest,
    becomesNewest,
    handsOverNewest: wasNewest && !becomesNewest,
  };
}
