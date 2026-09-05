// Turning "Tuesdays at seven" into four concrete instants — in the zone the
// coach said seven o'clock IN.
//
// ── The two generators that disagreed ─────────────────────────────────────
//
// A coach's weekly availability is generated into bookable `sessions` rows by
// two things, and until this file they used two different clocks.
//
//   · `run_open_slot_extension` (supabase/parts/650, and the header of
//     src/lib/slotGeneration.ts) runs nightly on the server. It has no handset,
//     so it uses `trainer_availability.tz` — the zone recorded against the row —
//     and builds each instant as `(date + make_time(hour, minute)) at time zone
//     tz`. That is correct, and correct across a daylight-saving change too.
//
//   · `generateSlots` on app/(trainer)/calendar.tsx runs when the coach presses
//     the button. It called `upcomingDates`, which built `new Date(y, m, d)` and
//     `setHours(hour, minute)` — THIS HANDSET's zone, whatever zone the hours
//     were actually recorded in.
//
// Those are the same answer for a coach standing where they were when they set
// their week, and a different answer for everybody else. Two ways in, and
// neither is exotic:
//
//   · the coach travels. `deviceZone()` stamps the row's zone on INSERT only, so
//     a coach who set 07:00 hours in London and presses Generate in New York
//     opens 07:00 New York — noon in London — while the nightly job goes on
//     opening 07:00 London. The diary now holds BOTH, at two different hours,
//     and a client books whichever they see. The coach is not there for one of
//     them.
//   · the row's zone came from the gym rather than from the phone.
//     `trainer_availability_default_tz` (a trigger on the live database) fills
//     `tz` from `tenants.timezone` whenever the app sends null — which is what
//     `deviceZone()` returns on a handset whose runtime cannot name its zone. So
//     the row says Europe/Madrid and the phone builds Atlantic/Canary, for as
//     long as the row exists.
//
// A slot generated in the wrong zone is the failure src/lib/slotGeneration.ts's
// header is entirely about: "a client books it and turns up to an empty gym".
// The nightly job refuses to guess a zone for exactly this reason; the button
// was guessing one on every press.
//
// ── What this does about it ───────────────────────────────────────────────
//
// `slotInstants` takes the zone off the row and builds the same instants the
// server would: the coach's own calendar day in that zone, the wall-clock hour
// in that zone, resolved through `instantAtGym`, which solves the offset AT the
// instant being named and so is right on the two mornings a year a clock moves.
//
// A row with no usable zone falls back to this handset's own clock — which is
// exactly what the whole feature did before, so nothing gets worse — and the
// nightly job is skipping that row anyway and the coach is already being told
// so by `zonelessNote`.
//
// Pure, so all of it is assertable under `npm run test:zones`, which is the run
// that matters here: the bug is invisible when the runner's zone happens to be
// the row's zone, and five of the six zones that suite runs under are not.
import { gymDay, gymWeekday, instantAtGym, isZone } from './gymZone';
import { addCalendarDays } from './rotaClock';

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface SlotInstantsInput {
  /** 0 = Sunday, as `trainer_availability.dow` has meant since part 24 and as
   *  `extract(dow …)` answers in the nightly job. */
  dow: number;
  hour: number;
  minute: number;
  /** How many weeks forward, counting the coming occurrence. */
  weeks: number;
  /** The zone the hour is an hour IN — `trainer_availability.tz`. Null, or a
   *  zone this runtime does not know, falls back to the handset's own clock. */
  tz: string | null | undefined;
  /** Now. Passed in, never read here: a screen holding a frozen clock would
   *  otherwise generate last week's dates for ever. */
  fromMs: number;
}

/**
 * The instants this weekly slot names over the next `weeks` weeks, soonest
 * first, as ISO strings.
 *
 * An occurrence that has already passed is dropped rather than moved — the
 * first Tuesday of a run made on a Tuesday afternoon is behind the coach, and
 * the server refuses to open a slot in the past anyway (`v_ts > now()`).
 */
export function slotInstants(i: SlotInstantsInput): string[] {
  const weeks = Math.max(0, Math.floor(i.weeks));
  if (!Number.isInteger(i.dow) || i.dow < 0 || i.dow > 6) return [];
  if (!Number.isInteger(i.hour) || i.hour < 0 || i.hour > 23) return [];
  const minute = Number.isInteger(i.minute) && i.minute >= 0 && i.minute <= 59 ? i.minute : 0;
  if (!Number.isFinite(i.fromMs)) return [];

  const wall = `T${pad2(i.hour)}:${pad2(minute)}`;
  const out: string[] = [];

  if (isZone(i.tz)) {
    const zone = String(i.tz);
    // The coach's own today, not the reader's and not the server's — the same
    // sentence part 650 has in it, for the same reason: a job running at 02:00
    // UTC is still yesterday in Los Angeles.
    const today = gymDay(i.fromMs, zone);
    const wd = gymWeekday(i.fromMs, zone);
    if (today != null && wd != null) {
      const first = addCalendarDays(today, ((i.dow - wd) % 7 + 7) % 7);
      if (first != null) {
        for (let w = 0; w < weeks; w++) {
          const day = addCalendarDays(first, w * 7);
          if (day == null) continue;
          const iso = instantAtGym(`${day}${wall}`, zone);
          if (iso == null) continue;
          if (Date.parse(iso) > i.fromMs) out.push(iso);
        }
        return out;
      }
    }
    // A zone this runtime knows but cannot format an instant in is not a reason
    // to generate nothing — the coach still has a week to open. Fall through.
  }

  // No usable zone: this handset's own clock, which is what the button did for
  // every row before this file existed. `setDate` then `setHours` rather than
  // adding milliseconds, so a week containing a clock change is still a week.
  const from = new Date(i.fromMs);
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const shift = ((i.dow - base.getDay()) % 7 + 7) % 7;
  for (let w = 0; w < weeks; w++) {
    const cand = new Date(base);
    cand.setDate(base.getDate() + shift + w * 7);
    cand.setHours(i.hour, minute, 0, 0);
    const t = cand.getTime();
    if (Number.isFinite(t) && t > i.fromMs) out.push(new Date(t).toISOString());
  }
  return out;
}
