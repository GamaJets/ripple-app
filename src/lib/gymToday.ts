// "Today", for a screen that has to ask a database for it.
//
// ── The bug this exists to remove ─────────────────────────────────────────
//
// `new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')` — the
// Overview's window for "through the door today" — is UTC midnight wearing the
// word today. It is the right instant on exactly one meridian.
//
// For a gym in Los Angeles, UTC midnight is 4pm or 5pm the PREVIOUS afternoon,
// so at nine in the morning the tile labelled "today" has been counting since
// yesterday teatime: last night's 6pm and 8pm classes are in it, every day, and
// the figure an owner reads at opening time is roughly two days of arrivals.
// East of Greenwich it fails the other way — a gym in Dubai gets four hours
// each morning where today has not started yet and the evening just gone is
// still being added to it.
//
// Neither direction announces itself. The tile shows a plausible number.
//
// ── Why this is not just `isoDate(new Date())` ────────────────────────────
//
// Because that swaps UTC's day for the READER's, and the reader is a laptop.
// The same gym read from the front desk and from a bookkeeper's machine in
// Lisbon then reports two different Tuesdays out of one database, with nothing
// on either screen saying which. `tenants.timezone` (supabase/parts/710) is
// where the gym says whose day its day is, and src/lib/gymZone.ts is the one
// place in TypeScript that turns a zone into a day.
//
// ── What happens when the gym has not said ────────────────────────────────
//
// It falls back to the reader's own calendar day AND SAYS SO. That is not a
// default timezone — nothing here ever writes, assumes or implies a zone, and
// `basis` names which calendar the window was actually cut on so the screen can
// print `NO_ZONE_NOTE` beside the figure. The alternative, refusing to state a
// count at all until somebody fills in a settings field, takes a working tile
// away to punish a gym for a blank; the alternative it replaces, UTC, is the
// only one of the three that is silently wrong for everybody.
//
// Framework-agnostic, like the rest of src/lib: `now` comes in as an argument
// so the whole thing is assertable without a clock.
import { gymDay, gymDayBounds, NO_ZONE_NOTE } from './gymZone';

/** Which calendar the day was cut on. Never a guess — the caller is told. */
export type DayBasis =
  /** `tenants.timezone` was set and usable. The window is the gym's own day. */
  | 'gym'
  /** The gym has not set a zone, so this is the machine's day and says so. */
  | 'reader';

export interface TodayWindow {
  /** The calendar day, `YYYY-MM-DD`, on whichever calendar `basis` names. */
  day: string;
  /** Inclusive start, as an ISO instant — what a `gte` filter wants. */
  fromISO: string;
  /** EXCLUSIVE end, for a `lt` filter. Half-open, so midnight belongs to one
   *  day and not to both. */
  toISO: string;
  basis: DayBasis;
  /** The zone the day was measured in when `basis` is 'gym'. Null otherwise —
   *  the reader's zone is not returned here because it is not a fact about the
   *  gym, and `readerZone()` in src/lib/gymZone.ts is where a screen may ask
   *  what its own machine thinks. */
  zone: string | null;
  /** The sentence to print beside any figure cut on this window, or null when
   *  there is nothing to disclose. One wording, from `NO_ZONE_NOTE`. */
  note: string | null;
}

/**
 * The window "today" means at this gym.
 *
 * `zone` is `tenants.timezone` as `fetchGymZone` or `fetchGymProfile` handed it
 * over — null for a gym that has not set one, and null is also what a screen
 * holds while that read is in flight or after it failed. All three arrive here
 * as the reader's day with the note attached, which is the honest answer for
 * each of them: none of the three is a gym whose day is known.
 *
 * A zone that is set but that this runtime's IANA database cannot resolve falls
 * back the same way rather than throwing. `gymDayBounds` answers null for it,
 * and a console that crashed on a settings value would be worse than one that
 * says whose clock it is drawing.
 *
 * The end is the NEXT day's midnight rather than start + 24h, because
 * `gymDayBounds` computes it that way and the two days a year the clocks move
 * are 23 and 25 hours long. A fixed day length is right for 363 days and drops
 * or double-counts an hour of arrivals on the two nobody checks.
 */
export function gymTodayWindow(
  zone: string | null | undefined,
  now: number | Date = Date.now(),
): TodayWindow {
  const at = now instanceof Date ? now : new Date(now);

  const day = gymDay(at, zone);
  if (day) {
    const bounds = gymDayBounds(day, zone);
    if (bounds) {
      return {
        day,
        fromISO: bounds.fromISO,
        toISO: bounds.toISO,
        basis: 'gym',
        zone: String(zone),
        note: null,
      };
    }
  }

  // The reader's calendar day, built from the LOCAL getters and a local
  // midnight. `new Date(y, m, d)` is midnight where this machine is, which is
  // the whole point; constructing it from a string would hand the parsing back
  // to the rules this module exists to get away from.
  const y = at.getFullYear();
  const m = at.getMonth();
  const d = at.getDate();
  const from = new Date(y, m, d, 0, 0, 0, 0);
  const to = new Date(y, m, d + 1, 0, 0, 0, 0);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${String(y).padStart(4, '0')}-${p2(m + 1)}-${p2(d)}`,
    fromISO: from.toISOString(),
    toISO: to.toISOString(),
    basis: 'reader',
    zone: null,
    note: NO_ZONE_NOTE,
  };
}

/**
 * Whether an instant falls inside a window. Half-open, matching `toISO`.
 *
 * Here rather than at the call site because a screen that has already fetched
 * a wider set — the Overview asks for one window and the Door screen for
 * thirty days — should not re-derive the comparison, and `>= from && < to`
 * written twice is how one of them ends up inclusive at both ends and counts
 * midnight in two days at once.
 */
export function inWindow(at: string | number | Date | null | undefined, w: TodayWindow): boolean {
  if (at == null) return false;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(w.fromISO) && t < Date.parse(w.toISO);
}
