// Live updates, for the screens that had none.
//
// ── What was true before this file ─────────────────────────────────────────
//
// `.channel(` appeared exactly once in the whole of src/ui: the message thread.
// Everything else in the app updated when you left the screen and came back. A
// class filling up while a member looked at the timetable, a PT session the
// coach booked five seconds ago, a notification arriving — all of them sat
// there stale, and the member's only affordance was to guess that pulling to
// refresh might change something.
//
// The worst of those is the class list, because the number on it is a decision:
// "3 places left" is what somebody chooses their evening around, and it was a
// snapshot from whenever the screen happened to load.
//
// ── Why this is a refetch and not a patch ─────────────────────────────────
//
// The tempting build applies the payload: an INSERT into `class_bookings`
// arrives, so add one to that class's `booked`. It is wrong here for a specific
// reason. The counts on that screen do not come from the rows a client can see
// — `class_counts()` is a security-definer aggregate over everybody's bookings,
// precisely because a member may not read other members' rows. So the payload a
// client receives is a NOTIFICATION THAT SOMETHING CHANGED and nothing more;
// the numbers still have to be asked for. Patching from it would produce a
// count assembled from the subset of rows this account happens to be allowed to
// see, which is a different number that looks just as authoritative.
//
// So: every subscription here means "ask again", debounced. That also makes the
// whole feature safe to lose. Realtime is optional — a project with the
// publication off, a websocket a hotel network will not open, an old build —
// and when it does not connect, the screens behave exactly as they did before.
// Nothing renders off a channel; the channel only ever triggers the same read
// the screen already does.
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export type LiveEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

/**
 * How long a burst is allowed to settle before the refetch runs.
 *
 * There is always a burst. A coach publishing next week's timetable writes
 * forty rows; a class emptying after a cancellation promotes a waitlister,
 * which is two more writes on top of the one that caused it. Firing a read per
 * row would put dozens of round trips on the wire for one visible change.
 *
 * Eight hundred milliseconds is under the threshold at which a screen feels
 * like it did not react, and long enough to fold any of those bursts into one.
 */
const SETTLE_MS = 800;

/**
 * The longest a stream of changes may hold the refetch off.
 *
 * Without this, a table changing steadily every half second would reset the
 * timer forever and the screen would never update at all — the debounce
 * starving the thing it exists to serve.
 */
const MAX_HOLD_MS = 4_000;

export interface LiveOptions {
  /** A name unique to this subscription. Two `useLive` calls sharing a name
   *  share a channel, and the second one's handler is silently added to the
   *  first one's topic — so it must include whatever the filter is keyed on
   *  (the client id, the account id) and not just the table. */
  channel: string;
  table: string;
  /** PostgREST filter string, e.g. `user_id=eq.<uuid>`. Null subscribes to
   *  every row of the table THAT THIS ACCOUNT MAY READ — realtime applies RLS,
   *  so "every row" is never more than the account's own. */
  filter?: string | null;
  event?: LiveEvent;
  /** Off by default in every state where a subscription would be pointless: no
   *  backend, no account, a screen that has not resolved what it is watching
   *  yet. Passing false tears down an existing channel, which is what makes
   *  this safe to call before the id it needs has loaded. */
  enabled?: boolean;
  /** Ask again. Called at most once per settle window, never synchronously
   *  during render. */
  onChange: () => void;
}

/**
 * Subscribe to changes on one table and re-read when they happen.
 *
 * Renders nothing, returns nothing, and cannot throw into a screen: every
 * supabase-js call in here is wrapped, because a realtime client that fails to
 * open a socket must cost the member live updates and not the screen.
 */
export function useLive({ channel, table, filter = null, event = '*', enabled = true, onChange }: LiveOptions): void {
  // The callback by reference, so a screen that rebuilds its handler on every
  // render does not tear down and re-open a websocket subscription each time.
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!USE_SUPABASE || !enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstAt = 0;
    let dead = false;

    const fire = () => {
      timer = null;
      firstAt = 0;
      if (dead) return;
      try { cb.current(); } catch { /* a failing refetch is the screen's problem, not the socket's */ }
    };

    const bump = () => {
      if (dead) return;
      const now = Date.now();
      if (!firstAt) firstAt = now;
      // Held long enough. Run now rather than pushing the window out again.
      if (now - firstAt >= MAX_HOLD_MS) { if (timer) clearTimeout(timer); fire(); return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, SETTLE_MS);
    };

    let ch: any = null;
    try {
      ch = supabase
        .channel(channel)
        .on('postgres_changes', { event, schema: 'public', table, ...(filter ? { filter } : {}) } as any, bump)
        .subscribe();
    } catch {
      // Realtime is optional. The screen keeps whatever it read on mount and
      // whatever the member's own pull-to-refresh gives them.
      ch = null;
    }

    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      if (ch) { try { supabase.removeChannel(ch); } catch { /* ignore */ } }
    };
  }, [channel, table, filter, event, enabled]);
}
