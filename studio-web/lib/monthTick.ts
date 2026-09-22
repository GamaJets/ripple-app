'use client';

// The month it is now, in a console whose tabs outlive the month.
//
// ── what this is for ──────────────────────────────────────────────────────
//
// Six screens offer a month or a quarter to choose from — /close, /accounting,
// /costs, /tax, /payroll and /coach/earnings — and every one of them built its
// list like this:
//
//     const months = useMemo(() => recentMonths(MONTHS_OFFERED), []);
//
// An empty dependency array, and the clock is `recentMonths(count, now =
// Date.now())`, one file away. Neither gate could see it: `check-frozen-day`
// looks for a clock READ on the line and there is no `Date` on it;
// `check-frozen-hook` follows exactly those defaulted parameters but skips empty
// dependency lists, because those are the other gate's rule.
//
// This console has no router. The rail is a plain `<a href>`, so a tab open at a
// front desk is one document that lives for days — and the newest month those
// pickers offered was the month the tab was OPENED in. At one minute past
// midnight on the 1st, the month that had just ended was not in the list: an
// owner could not close it, could not file its books, and could not run its
// payroll, and the only repair available was the full page reload this console
// spent a whole wave learning not to need.
//
// ── why a hook, and not the read stamp ────────────────────────────────────
//
// `useFetched`'s `at` is the console's live clock for everything a READ is about
// — is this invoice late, has this session finished, is this invitation still
// open — because those questions are about the rows, and the rows are of that
// instant. Which months EXIST is not about the rows. It is about the calendar,
// it is true whether or not anything was read, and a gym that has not touched
// this tab since Friday should still be offered September when it opens the
// picker on Monday.
//
// It also cannot be keyed on the read stamp safely on two of those six screens:
// the read there is fired by an effect keyed on the chosen period object, so
// rebuilding the period list from the read stamp is a loop — the read stamps the
// instant, the instant rebuilds the period, the period fires the read.
//
// ── why it is nearly free ─────────────────────────────────────────────────
//
// The state holds a MONTH, not an instant, and the poll sets it to the value it
// already has. React bails out of a re-render when a state setter is given the
// same value, so a screen sitting open all day re-renders exactly never on
// account of this, and exactly once at the month boundary — which is the one
// moment it must.
import { useEffect, useState } from 'react';
import { monthTick } from '@lib/pickerMonth';

/** How often the month is re-checked. A minute: a month boundary is worth
 *  noticing within a minute of it happening, and this comparison is two integer
 *  reads off a Date. */
const CHECK_MS = 60_000;

/**
 * The calendar month it is now, as the comparable number `monthTick` returns.
 *
 * Hand it to `monthTickStart` to get an instant inside that month, which is what
 * `recentMonths` and the quarter builders take. Re-renders the caller only when
 * the month actually turns over.
 */
export function useMonthTick(): number {
  const [tick, setTick] = useState(() => monthTick());
  useEffect(() => {
    // Same value in, no re-render out — see the header. This is the whole reason
    // the state is a month rather than an instant.
    const check = () => setTick((t) => {
      const now = monthTick();
      return now === t ? t : now;
    });
    // Checked on the way back to the tab as well as on the timer. A tab hidden
    // behind a spreadsheet since last month is precisely the one whose picker is
    // wrong, and a background timer in a hidden tab is throttled by the browser
    // to something no month boundary can be trusted to survive.
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
