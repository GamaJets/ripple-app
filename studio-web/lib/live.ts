'use client';

// The console screens that are read while the thing they describe is happening.
//
// ── What was true before this file ────────────────────────────────────────
//
// `grep -rn 'channel(' studio-web` returned one line, and it was a comment:
// `app/door/page.tsx:402`, "A poll rather than a realtime channel: nothing else
// in this console". That was accurate. The phone apps have had live updates
// since `src/ui/realtime.ts` — `useLive` is on classes, sessions and
// notifications, and `src/ui/messaging.ts` on the message thread — and the
// database half has been in place for as long: `supabase/parts/10` puts
// `messages` in the `supabase_realtime` publication and `supabase/parts/220`
// adds `gym_classes`, `class_bookings`, `sessions`, `session_approvals` and
// `notifications`.
//
// The console had none of it. A gym runs this on a desk tablet at the front
// counter and on a manager's second monitor, and those tabs are open for the
// whole trading day. `components/Fetched.tsx` gave every screen a stamp and a
// "Read again", and re-reads on `visibilitychange` — which is the right answer
// for a tab somebody switches back to, and no answer at all for the tab nobody
// switches away from.
//
// ── Why this is a copy of `src/ui/realtime.ts` and not an import ──────────
//
// Because the two files cannot be the same program. `src/ui/realtime.ts`
// imports `react` and `../lib/supabase`, and BOTH resolve differently here: the
// console is React 19 under Next, the app is React 18 under Expo, and the two
// Supabase clients are separately constructed with different auth storage and
// the request-timeout wrapper in `lib/supabase.ts`. `studio-web/tsconfig.json`
// maps `@lib/*` at `src/lib/*` — pure modules, no React, no client — and
// deliberately does not map `src/ui`. So the SHAPE is ported and the argument
// below is quoted, because the argument is the part that matters.
//
// ── Why this is a refetch and never a payload patch ───────────────────────
//
// The tempting build applies what arrives: an INSERT into `class_bookings`, so
// add one to that class's `booked`. It is wrong here for three reasons, any one
// of which is enough.
//
//   1. Tenant scope. `class_bookings` has no `tenant_id` column at all — it is
//      scoped through its class, in the policies at `supabase/parts/30`. A row
//      arriving over a socket carries a `class_id` and nothing this browser can
//      check a gym against without a second read. The tenant-scoped read is
//      `fetchClasses(supabase, tenantId, …)`, whose `.eq('tenant_id', tenantId)`
//      is the thing that enforces scope, and this console has shipped a
//      cross-gym read twice — `gym_classes` readable by any signed-in account,
//      and `sessions` with no tenant column — so the filter is not allowed to
//      move out of the query and into a `.filter()` on a payload.
//   2. Row caps. `fetchClasses` chunks its booking read and `fetchPtSlots`
//      calls `assertWhole`; `src/lib/rowCap.ts` is the argument. A patched
//      figure has been through neither, so a count assembled on the client is a
//      number with no provenance rendered beside numbers that have one.
//   3. Load state. Every figure in this console is gated on a settled read —
//      loading, failed and empty are three different sentences, and
//      `components/Fetched.tsx` stamps only a read that came back WHOLE. A
//      patch lands outside all of it: a figure that changed without a read is a
//      figure with no state, under a timestamp that no longer describes it.
//
// So a payload here means one thing — SOMETHING CHANGED — and the screen's own
// reader is asked again, debounced. That also makes the feature safe to lose
// entirely. A project with the publication off, a gym wifi that will not open a
// websocket, a captive portal: the screens then behave exactly as they did
// before, because nothing renders off a channel.
//
// ── A socket that stopped is a state, not a silence ───────────────────────
//
// This is the half a phone does not need and a desk screen does. A member
// holding a phone puts it down; the tab at the front counter is looked at
// across a room, all day, by somebody who did not open it. If the websocket
// dies at 11am — a proxy idle timeout, the venue's wifi, a laptop lid — a
// screen that silently stops updating is indistinguishable from a quiet gym,
// and that is worse than never having been live. So `useLive` reports a status,
// `liveNote` turns it into a sentence the screen prints beside its stamp, and
// `FALLBACK_MS` is what the screen falls back to: a poll, while the socket is
// not carrying anything. Live updates are the optimisation; the poll is the
// floor.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Whether this screen is currently being told about changes.
 *
 *   'off'        — no subscription was asked for, or the screen has not
 *                  resolved what it is watching yet. Not a fault.
 *   'connecting' — asked for, no answer yet. The opening state.
 *   'live'       — the channel is joined and events will arrive.
 *   'dropped'    — the channel errored, timed out or closed. supabase-js will
 *                  keep trying to rejoin on its own and this returns to 'live'
 *                  if it succeeds, so it is a condition rather than an ending.
 */
export type LiveStatus = 'off' | 'connecting' | 'live' | 'dropped';

/** One table this screen wants to hear about. */
export interface LiveSub {
  table: string;
  /**
   * PostgREST filter string, e.g. `tenant_id=eq.<uuid>`.
   *
   * Narrowing, not scoping. Realtime applies row-level security to everything
   * it forwards, so the rows that reach the browser are already the ones this
   * account may SELECT; the filter is there to keep a busy neighbouring gym off
   * a socket that would only ever throw the event away. `null` where a table
   * has no tenant column — see `class_bookings` above — and that is not a
   * weakening, because the payload is never read either way.
   *
   * ── The one event a filter cannot carry ──────────────────────────────────
   *
   * A filter on a column other than the primary key silently drops DELETEs, and
   * that is a fact about Postgres rather than about Supabase. Logical decoding
   * writes only the REPLICA IDENTITY columns into the WAL record for a deleted
   * row, and every table in the `supabase_realtime` publication on this project
   * has the default identity — `pg_class.relreplident = 'd'`, checked against
   * the live database, which means the primary key and nothing else. There is
   * no `tenant_id` in the record for the broker to compare, so
   * `tenant_id=eq.<uuid>` cannot evaluate true and the event never reaches this
   * browser.
   *
   * That is not hypothetical here. `deleteClass` (src/lib/gymSchedule.ts) is
   * wired to this console's own /timetable, and `sessions` rows are hard-deleted
   * by src/lib/gymPtSchedule.ts and src/ui/sessions.tsx when a coach releases a
   * slot from their phone. A tab that had said "Updating as the gym changes" for
   * an hour would go on showing a class that no longer existed — and the desk
   * two feet away would go on selling places in it.
   *
   * So a screen that cares about deletions adds a second, UNFILTERED binding on
   * the same table with `event: 'DELETE'`. It is the same trade the header
   * above already makes for `class_bookings`, and it is cheap for the same
   * reason: the payload is never read, so an unfiltered doorbell from another
   * gym costs one debounced refetch of THIS gym's rows and tells this browser
   * nothing it did not already have. Deletions are also rare — a released slot,
   * a cancelled class — where inserts and updates are the traffic the filter
   * exists to keep off the wire.
   */
  filter?: string | null;
  /**
   * Which change to hear about. `'*'` — every one — unless a caller says
   * otherwise, which is what every filtered subscription wants.
   *
   * The one caller that says otherwise is the DELETE binding described above.
   */
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
}

/**
 * How long a burst is allowed to settle before the refetch runs.
 *
 * There is always a burst. Publishing next week's timetable writes forty rows;
 * a class emptying promotes a waitlister, which is two more writes on top of
 * the one that caused it. Firing a read per row would put dozens of round trips
 * on the wire for one visible change — and a console read is not one query, it
 * is `fetchClasses` plus its chunked bookings plus the names.
 *
 * Eight hundred milliseconds, the same number and for the same reason as
 * `src/ui/realtime.ts`: under the threshold at which a screen feels like it did
 * not react, long enough to fold a burst into one read.
 */
const SETTLE_MS = 800;

/**
 * The longest a stream of changes may hold the refetch off.
 *
 * Without this, a table changing steadily every half second would reset the
 * timer forever and the screen would never update at all — the debounce
 * starving the thing it exists to serve. A Saturday morning at the desk is
 * exactly that stream.
 */
const MAX_HOLD_MS = 4_000;

/**
 * How often a screen re-reads while its socket is NOT carrying anything.
 *
 * Ninety seconds. `/door` already polls at thirty because somebody is standing
 * at the counter waiting to be let in; nothing here is that urgent, and a
 * console that re-queried a dozen tabs every thirty seconds would be a
 * different problem. The point is that a screen whose channel died degrades to
 * the behaviour it had before this file existed rather than to nothing, and
 * says which of the two it is doing.
 */
export const FALLBACK_MS = 90_000;

/**
 * The sentence a screen prints beside its freshness stamp.
 *
 * Null when there is nothing worth saying. 'live' says so plainly — a person
 * looking across the room needs to know the figures are watching themselves,
 * and "no news" is not a claim a screen can make silently. 'connecting' says
 * nothing: it lasts a moment, and a sentence that appears and vanishes on every
 * page load is noise.
 *
 * 'dropped' is the one this function exists for. It must name the consequence
 * ("stopped"), not the mechanism ("websocket error"), and it must say what the
 * screen is doing instead — otherwise the honest sentence reads as a fault the
 * person has to do something about, and the something is reloading a tab that
 * is in fact still reading the gym every ninety seconds.
 *
 * Pure, so the wording is a value rather than a branch buried in JSX.
 */
export function liveNote(status: LiveStatus): string | null {
  switch (status) {
    case 'live': return 'Updating as the gym changes.';
    case 'dropped': return 'Live updates have stopped. This screen is re-reading on a timer instead.';
    case 'connecting': return null;
    case 'off': return null;
  }
}

/** Bumped once per subscription, so no two topics can collide. See below. */
let joins = 0;

/**
 * Subscribe to changes on some tables and ask the screen to read again.
 *
 * Renders nothing and cannot throw into a screen: every supabase-js call in
 * here is wrapped, because a realtime client that fails to open a socket must
 * cost the desk live updates and not the page.
 *
 * One channel carries every table a screen cares about rather than one channel
 * each. A console tab is a long-lived subscriber and the rail navigates by
 * `<a href>`, so each visit to `/timetable` is a fresh mount; two channels per
 * mount is two joins and two rejoins on every reconnect for one screen's worth
 * of information.
 *
 * `channel` names the screen; the topic actually joined is that name plus a
 * counter, so no two subscriptions can ever collide on one.
 *
 * That is not tidiness. `next.config.mjs` sets `reactStrictMode: true`, so in
 * development React mounts every route, runs its effects, runs the cleanups and
 * mounts it again — and `removeChannel` is asynchronous, so the second mount
 * asks to join a topic the first has asked to leave and may not have left. The
 * broker answers one of those two joins and not the other, and the screen that
 * loses sits at 'dropped' with no way back until the tab is reloaded. Making
 * the topic unique per subscription removes the collision rather than racing
 * it, and it is also what stops a tenant change from leaving two channels
 * filtered on two different gyms both feeding one screen.
 */
export function useLive({ channel, subs, enabled = true, onChange }: {
  channel: string;
  subs: LiveSub[];
  enabled?: boolean;
  onChange: () => void;
}): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('off');

  // The callback by reference, so a screen that rebuilds its handler on every
  // render does not tear down and re-open a websocket subscription each time.
  const cb = useRef(onChange);
  cb.current = onChange;

  // The subscription list by value, so a screen may pass an inline array
  // literal — which is a new identity on every render — without the effect
  // below restarting continuously. Compared as a string because that is what
  // the effect can actually depend on.
  const key = subs.map((s) => `${s.table}|${s.filter ?? ''}|${s.event ?? '*'}`).join(',');

  const subsRef = useRef(subs);
  subsRef.current = subs;

  useEffect(() => {
    if (!enabled || !key) { setStatus('off'); return; }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstAt = 0;
    let dead = false;

    setStatus('connecting');

    const fire = () => {
      timer = null;
      firstAt = 0;
      if (dead) return;
      // A failing refetch is the screen's problem and it already has a
      // vocabulary for it: `Read<T>`'s 'failed' arm, and a stamp that does not
      // move. This must not invent a second one.
      try { cb.current(); } catch { /* said by the screen, not by the socket */ }
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

    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      let built = supabase.channel(`${channel}-${++joins}`);
      for (const s of subsRef.current) {
        built = built.on(
          'postgres_changes',
          { event: s.event ?? '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
          bump,
        );
      }
      ch = built.subscribe((st) => {
        if (dead) return;
        // supabase-js re-invokes this on every rejoin attempt, so 'dropped' is
        // not terminal — a channel that recovers reports SUBSCRIBED again and
        // the sentence beside the stamp goes away by itself.
        if (st === 'SUBSCRIBED') setStatus('live');
        else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus('dropped');
      });
    } catch {
      // Realtime is optional. The screen keeps whatever it read on mount, plus
      // its fallback poll, plus the button — and says which of those it is on.
      ch = null;
      setStatus('dropped');
    }

    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      // A leaked channel on a rail somebody clicks twenty times a day is a real
      // bug on a screen that stays open all day: every abandoned topic holds a
      // binding on the one socket and every one of them keeps firing bumps into
      // an unmounted screen's closure.
      if (ch) { try { supabase.removeChannel(ch); } catch { /* nothing left to say */ } }
    };
    // `key` stands in for `subs`, whose identity a caller cannot be asked to
    // stabilise. `subsRef` supplies the values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key, enabled]);

  return status;
}
