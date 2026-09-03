// What day it is, for a screen that is going to be open across one.
//
// ── The defect this closes ─────────────────────────────────────────────────
//
// `const today = useMemo(() => todayKey(), []);` — an empty dependency array,
// so the value is fixed for the life of the MOUNT and not for the life of the
// render. On a phone that is not a small window. Nothing in these apps unmounts
// a screen when the phone is pocketed: app/(trainer)/_layout.tsx registers its
// detail screens with `href: null`, which mounts them once, and backgrounding
// the app does not tear them down at all. A coach who opened
// app/(trainer)/credentials.tsx on Sunday and came back to it on Wednesday was
// still being judged against Sunday.
//
// On that screen the frozen day was the second argument to every judgement it
// makes — `sortCredentials`, `insuranceClaim`, `credentialState`, `expiryLine`
// — so a public liability policy that ran out on Monday read as current, in the
// green, on the one screen whose whole job is to tell a coach when their cover
// runs out. Whether they may legally be on a gym floor hung off a date the
// screen had quietly stopped updating.
//
// ── Why a hook and not a fresh `todayKey()` per render ─────────────────────
//
// A bare `todayKey()` in the render body is correct and does not re-render: it
// is only right at the moment something else happens to redraw. A screen sitting
// untouched at 23:59 is exactly the case that matters, and it redraws for
// nothing. So the day is state, and the two moments it can change on are the
// two this subscribes to:
//
//   · a timer set for the next LOCAL midnight, for a screen left open across
//     one. `msUntilNextLocalDay` rolls the date rather than adding 24 hours, so
//     the wait is right across a daylight-saving boundary too.
//   · AppState becoming 'active', for the far more common case — the phone was
//     in a pocket for three days and nothing was running to fire a timer.
//
// The timer is re-armed from the value that arrives, never from a fixed 24
// hours, so a device that woke late lands on the next real midnight rather than
// drifting a little further from it every day.
//
// ── What it does NOT do ────────────────────────────────────────────────────
//
// It does not re-read anything. A screen whose DATA goes stale wants
// `src/ui/refreshOnFocus.ts`; this only answers "what day is it now", which is
// the half that has no read behind it and was therefore never noticed.
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { msUntilNextLocalDay, todayKey } from '../lib/offlineQueue';

/**
 * Today as `YYYY-MM-DD`, kept current for as long as the screen is mounted.
 *
 * A drop-in for `useMemo(() => todayKey(), [])`, which is the shape this exists
 * to replace. Re-renders only when the day actually changes — the state is set
 * through a comparison, so a wake-up on the same day costs nothing.
 */
export function useToday(): string {
  const [day, setDay] = useState(() => todayKey());

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Compared before it is set. Every path below calls this, including the
    // ones that fire on the same day, and a `setDay` that always assigned would
    // re-render every screen using this on every foreground.
    const settle = () => {
      if (!live) return;
      const now = todayKey();
      setDay((prev) => (prev === now ? prev : now));
    };

    const arm = () => {
      if (timer) clearTimeout(timer);
      // Re-armed from the clock as it is NOW rather than from a constant, so a
      // device that slept through the last one lands on the next real midnight
      // instead of a little later every time.
      timer = setTimeout(() => { settle(); arm(); }, msUntilNextLocalDay());
    };
    arm();

    const onState = (s: AppStateStatus) => {
      if (s !== 'active') return;
      // The timer that should have fired while the phone was asleep may not
      // have, so the day is re-read and the next one re-armed from now.
      settle();
      arm();
    };
    const sub = AppState.addEventListener('change', onState);

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return day;
}

/**
 * The current instant, recomputed whenever it could have gone stale.
 *
 * ── What `useMemo(() => new Date(), [])` actually does ────────────────────
 *
 * Three screens carried that line under a comment saying `now` is fixed "for
 * the render". An empty dependency array fixes it for the life of the MOUNT,
 * and Analytics, Money and the Assistant are tabs — mounted for as long as the
 * app is. `monthToDate(now)` sets BOTH bounds from it, so a coach who opened
 * Analytics on the 31st and came back on the 1st was shown last month's
 * takings, deliveries and unmarked backlog under a heading saying this month —
 * and a pull-to-refresh re-read the server against the same wrong dates, which
 * made the stale figure look freshly confirmed.
 *
 * Recomputed on three moments, and each closes a different half of it:
 *
 *   · the local day rolling over, for a screen left open across midnight;
 *   · the app coming back to the foreground, for the phone that was in a pocket
 *     while that timer would have fired;
 *   · the screen being focused, because the upper bound of a month-to-date
 *     window is "now" and a coach who comes back to this tab is asking for
 *     figures up to the moment they are looking.
 *
 * Cheap: it is one `Date` and a render, on moments a screen is already reading
 * on. It is NOT a ticking clock — nothing here fires on a timer other than the
 * midnight one, so a screen using this does not re-render while it is being
 * read.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => { if (live) setNow(new Date()); };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { settle(); arm(); }, msUntilNextLocalDay());
    };
    arm();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s !== 'active') return;
      settle();
      arm();
    });
    return () => { live = false; if (timer) clearTimeout(timer); sub.remove(); };
  }, []);

  // Deliberately unconditional on focus: unlike `useToday`, which compares the
  // day before setting, the value here is the moment itself and coming back to
  // a screen is exactly when it should move.
  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));

  return now;
}
