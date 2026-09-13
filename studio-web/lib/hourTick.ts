// The hour it is now, for a console tab that stays open.
//
// ── the defect this exists for ────────────────────────────────────────────
//
// The timetable's floor panel opens on the hour the gym is currently having,
// so a desk opening the board at nine is shown nine rather than the hardcoded
// six it used to be. That hour was read inside a `useMemo` keyed on the zone:
//
//   const gymNow = useMemo(() => rotaCell(Date.now(), zone), [zone]);
//
// The zone does not change when time does, so the value was fixed at the
// moment the tab was opened. A console left up from the morning rush kept
// answering "is the floor covered at nine?" into the afternoon, on a screen
// whose entire job is to say whether somebody is on the floor right now.
//
// ── why an hour and not an instant ────────────────────────────────────────
//
// This is `useMonthTick` at a different grain, and for the same reason. The
// state holds the HOUR, not the instant, and the poll sets it to the value it
// already has. React bails out of a re-render when a setter is given the same
// value, so a tab sitting open re-renders exactly never on account of this and
// exactly once when the hour turns — which is the one moment it must.
//
// An instant would re-render every tick and would make every memo downstream
// of it recompute for nothing, which is how a clock-aware screen becomes a
// screen nobody leaves open.
import { useEffect, useState } from 'react';

/** How often the hour is re-checked. A minute: an hour boundary is worth
 *  noticing within a minute, and this is one integer read off a Date. */
const CHECK_MS = 60_000;

/** The current hour as a comparable integer: whole hours since the epoch. */
function hourTick(now: number = Date.now()): number {
  return Math.floor(now / 3_600_000);
}

/**
 * The hour it is now, re-settling when the hour turns.
 *
 * Returns a tick, not an instant, so a caller cannot accidentally use it as a
 * precise time. Multiply back by 3_600_000 for an instant INSIDE the current
 * hour — which is all a caller asking "what hour is it at the gym" needs, and
 * is stable for the whole hour rather than moving under the memo that reads it.
 *
 * The gym's own hour is then `rotaCell(hourStart(useHourTick()), zone)`: this
 * hook says when, the zone says whose.
 */
export function useHourTick(): number {
  const [tick, setTick] = useState(() => hourTick());
  useEffect(() => {
    // Same value in, no re-render out — see the header.
    const check = () => setTick((t) => {
      const now = hourTick();
      return now === t ? t : now;
    });
    // Checked on the way back to the tab as well as on the timer: a tab hidden
    // behind a spreadsheet since this morning is precisely the one whose hour
    // is wrong, and a background timer in a hidden tab is throttled by the
    // browser to something no hour boundary can be trusted to survive.
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    const id = window.setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return tick;
}

/** An instant inside the hour a tick names. */
export function hourStart(tick: number): number {
  return tick * 3_600_000;
}
