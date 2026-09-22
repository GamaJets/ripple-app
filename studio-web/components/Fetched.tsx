'use client';

// When this screen last read the gym, said out loud — and a way to ask again.
//
// ── The problem ───────────────────────────────────────────────────────────
//
// `grep -rn fetchedAt studio-web` returned nothing across forty-eight files.
// Thirty-three of the thirty-five console routes load inside a `useEffect(…,
// [])` and stop: two have a timer (`/door`, thirty seconds, and `/settings`)
// and every other route answers about the moment its tab was opened and does
// not say which moment that was. "14 members overdue" read at 09:00 and read at
// 15:00 are the same pixels.
//
// There is also no `next/link` and no `useRouter` anywhere in this console —
// the rail is a plain `<a href>` — so the only refresh a screen has today is a
// full document reload, which also discards every half-typed form on the page.
// That is not a refresh, it is a restart, and it is why nobody presses it.
//
// The owner's phone answered this three waves ago: fifteen of its twenty screens
// carry `<Fetched at={…} onRefresh={…}>` over `src/lib/freshness.ts`. This is
// that answer for the console, over the same module — `agePhrase`, `isStale`
// and `oldestFetch` are pure, tested and surface-neutral, and this file is the
// browser half they had no caller for.
//
// ── Why the sentence is written here and not taken from `fetchedNote` ─────
//
// `fetchedNote` says "this phone cannot reach us", which is the right sentence
// on a phone in a basement and the wrong one on a desk tablet at the front
// counter. The two surfaces share every opinion that is about TIME — how an age
// is phrased, when a figure is old enough to flag, which of several reads a
// combined stamp must be the age of — and differ only in the noun. So the
// opinions are imported and the noun is local.
//
// ── The stamp is of the last SUCCESSFUL read ──────────────────────────────
//
// Not of the last attempt. A refresh that failed leaves the stamp where it was,
// because the figures still on screen are the ones from the earlier read and
// moving the stamp would be the same lie one layer up. That is why `useFetched`
// takes a reader that returns a boolean rather than a `Promise<void>`: the
// screen is the only thing that knows whether what came back was everything it
// is showing. Count what the server confirmed, never what you sent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { agePhrase, isStale, oldestFetch, STALE_MS } from '@lib/freshness';
import { useLive, liveNote, FALLBACK_MS, type LiveStatus, type LiveSub } from '@/lib/live';

/** Re-exported so a screen combining several reads into one stamp does not have
 *  to know which module the rule lives in. One screen, one claim, and the claim
 *  has to be true of the oldest of the reads it covers. */
export { oldestFetch };

/** How often the phrase is recomputed so "just now" becomes "2 minutes ago"
 *  without anybody touching the page. Thirty seconds: fine enough that the
 *  sentence is never visibly wrong, coarse enough to be free. */
const TICK_MS = 30_000;

export interface Fetching {
  /** ms of the last read that came back whole, or null if none ever has. */
  at: number | null;
  /** A read is in flight right now. */
  busy: boolean;
  /**
   * Ask again.
   *
   * Safe to call while one is already running: the request is COALESCED, not
   * dropped. One more read runs as soon as the one in flight finishes, however
   * many times it was asked for in between.
   *
   * It used to be dropped, and that is wrong on any screen where the reader
   * closes over something a person can change — /payroll's month, /money's
   * payment window, /tax's quarter. Switching month while the previous month is
   * still in flight would be silently ignored, and the screen would sit under
   * the new heading showing the old month's total with no sign that the read
   * had not happened. A refresh that was asked for and quietly not performed is
   * precisely the staleness this component exists to make visible.
   *
   * One queued run, never a counter: ten clicks are one re-read, and the
   * screen cannot be made to chase its own tail.
   */
  refresh: () => void;
}

/**
 * Keep a screen's figures current, and know when they were last read.
 *
 * `read` returns TRUE when everything the screen shows came back. A screen with
 * four reads and one failure must return false: the stamp then stays where it
 * was and the failure banner beside it is what says which read is missing.
 *
 * Three things ask again, and a console needs all three:
 *
 *   1. `refresh()` — a control a person can press, which is the one this
 *      console has never had. A full document reload is not it: it throws away
 *      a half-typed invoice form, which is why the desk does not use it.
 *   2. Coming back to the tab. A gym runs two desks and an office on this
 *      console; the tab that has been behind a spreadsheet for an hour is
 *      exactly the one showing figures somebody else has already changed.
 *   3. `everyMs`, when a screen passes one. Opt-in, because most screens do not
 *      need a poll and a console that re-queried thirty-five screens on a timer
 *      would be a different problem. `/deletions` needs it — its clock is
 *      statutory and computed server-side — and `/orders` and `/passes` need it
 *      because the thing they report is written while somebody stands at the
 *      desk.
 *
 * A refresh never runs while one is in flight, and the timer is suspended while
 * the tab is hidden — a backgrounded tab polling a database for a page nobody
 * is looking at is a cost with no reader.
 */
export function useFetched(
  read: () => Promise<boolean>,
  opts: { everyMs?: number; enabled?: boolean } = {},
): Fetching {
  const { everyMs, enabled = true } = opts;
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // The reader is held in a ref so a screen may pass an inline closure without
  // restarting the timer on every render. The alternative is every caller
  // wrapping theirs in a `useCallback` and one of them forgetting, which is a
  // poll that fires continuously and is discovered in production.
  const readRef = useRef(read);
  readRef.current = read;
  const running = useRef(false);
  /** A refresh was asked for while one was in flight. At most one is held. */
  const queued = useRef(false);
  const alive = useRef(true);
  // Set on the way IN as well as cleared on the way out, and the way in is the
  // half that was missing.
  //
  // A cleanup-only effect is correct exactly once. React 18's StrictMode mounts
  // every component, runs its effects, runs the cleanups, and mounts it again —
  // and `next.config.mjs` sets `reactStrictMode: true`, so in development that
  // is every route in this console. The first cleanup set this false and
  // nothing ever set it back, so `alive.current` was false for the whole life
  // of the page and the `finally` below skipped BOTH of its statements on every
  // read: `setAt` never ran, so the line under the tiles said "…has not been
  // read yet" over figures that were plainly on screen, and `setBusy(false)`
  // never ran, so "Read again" said "Reading…" and stayed disabled for good.
  //
  // That is precisely the condition studio-web/lib/supabase.ts describes as the
  // reason the request timeout exists — "the one control on the page for getting
  // out of this is the one the condition takes away" — arriving from the other
  // side, without a hung socket and on every developer's machine.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // `refresh` calls itself when a run was queued, and a `useCallback` cannot
  // name itself in its own body. The ref is the same trick `readRef` uses two
  // fields up, and it keeps the dependency list of every effect below at one
  // stable identity. Declared before the callback and assigned after it, which
  // is the only order that has neither a circular initialiser nor a temporal
  // dead zone.
  const refreshRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => {
    if (!enabled) return;
    // Coalesced rather than dropped — see `Fetching.refresh`. The screen's
    // reader is re-read from the ref on every pass, so the queued run uses
    // whatever the reader closes over NOW, which is the month or window the
    // person just chose and not the one that was on screen when they chose it.
    if (running.current) { queued.current = true; return; }
    running.current = true;
    queued.current = false;
    setBusy(true);
    void (async () => {
      let whole = false;
      try {
        whole = await readRef.current();
      } catch {
        // A reader that threw did not come back whole, and that is the entire
        // meaning taken from it. The screen owns the sentence about WHY —
        // this component must never invent one.
        whole = false;
      } finally {
        running.current = false;
        if (alive.current) {
          if (whole) setAt(Date.now());
          // Still busy if another pass is about to start: the control must not
          // flicker back to "Read again" between two halves of one refresh.
          if (queued.current) refreshRef.current();
          else setBusy(false);
        }
      }
    })();
  }, [enabled]);
  refreshRef.current = refresh;

  // Back to the tab.
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, refresh]);

  // The poll, when a screen asked for one.
  useEffect(() => {
    if (!enabled || !everyMs || everyMs <= 0 || typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [enabled, everyMs, refresh]);

  return { at, busy, refresh };
}

/**
 * `useFetched`, plus a socket that asks it to read again.
 *
 * For the handful of screens where a stale figure has a consequence while
 * somebody is looking at it — the board two desks book against, the class fill
 * the desk sells places from, the one-to-ones a manager settles as coaches mark
 * them. Everything else in this console is a report over a period that has
 * already closed, and a subscription there would be a connection and a
 * re-render bought for a figure nobody expects to move.
 *
 * The whole of the live half is `refresh()`. Nothing is read off a payload —
 * `lib/live.ts` carries the argument at length, and the short version is that a
 * row arriving over a socket has been through neither the tenant filter in the
 * screen's own query nor the row caps nor the three load states, so it would
 * land on screen looking exactly as authoritative as a figure that had.
 *
 * ── Why the poll is faster when the socket is DOWN ────────────────────────
 *
 * Backwards only if live updates are read as an addition. They are not: they
 * replace a poll this console never had. A screen that is live re-reads within
 * a second of a change and needs no timer at all; a screen whose channel has
 * dropped has no other way of noticing, so it falls back to `FALLBACK_MS` —
 * and says so, because a desk tablet that quietly stopped updating looks
 * exactly like a quiet gym.
 */
export function useLiveFetched(
  read: () => Promise<boolean>,
  opts: { channel: string; subs: LiveSub[]; enabled?: boolean; everyMs?: number },
): Fetching & { live: LiveStatus } {
  const { channel, subs, enabled = true, everyMs } = opts;

  // `useLive` is declared before `useFetched` because it is the one that has to
  // run first for its status to size the poll below, and the refetch it calls
  // therefore has to be reached indirectly. Assigned during render, exactly as
  // `refreshRef` above is, and for the same reason: a `useCallback` cannot name
  // something declared after it.
  const refreshRef = useRef<() => void>(() => {});
  const live = useLive({ channel, subs, enabled, onChange: () => refreshRef.current() });

  const fetching = useFetched(read, {
    enabled,
    everyMs: live === 'live' ? everyMs : (everyMs ?? FALLBACK_MS),
  });
  refreshRef.current = fetching.refresh;

  return { ...fetching, live };
}

/**
 * The line under a screen's figures: when they were read, and a button.
 *
 * `what` names them, because a console screen shows several things and "Read 4
 * minutes ago" alone does not say read of what. It goes into the sentence, not
 * beside it.
 *
 * The whole line is a live region. A screen reader on /payroll heard the
 * document title and then silence — this at least announces when the figures
 * beneath it have been replaced, and says what they now are the age of.
 */
export function Fetched({
  at, busy = false, onRefresh, what = 'this screen', live, style,
}: {
  at: number | null;
  busy?: boolean;
  onRefresh?: () => void;
  what?: string;
  /**
   * Whether this screen is being told about changes as they happen. Omitted on
   * the screens that do not subscribe, where the honest answer is that nothing
   * was claimed — not that something failed.
   */
  live?: LiveStatus;
  style?: React.CSSProperties;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const stale = isStale(at, now);
  // The socket's own sentence, and it goes INSIDE the live region rather than
  // beside it. A person who has just been told the figures are two minutes old
  // has to be told in the same breath whether anything is still watching them;
  // announced separately it arrives as an unattached fragment, and the two are
  // one fact about how much this screen can be trusted right now.
  const liveLine = live ? liveNote(live) : null;
  const sentence = at == null
    ? (busy ? `Reading ${what}…` : `${what[0].toUpperCase()}${what.slice(1)} has not been read yet.`)
    : `${what[0].toUpperCase()}${what.slice(1)}, read ${agePhrase(Math.max(0, now - at))}.`;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
        margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink3)', ...style,
      }}
    >
      {/* Polite, never assertive. This is the one sentence on the page that
          changes on a timer, and a console that interrupted a member of staff
          every thirty seconds to say the same figure is four minutes old is a
          console people turn the screen reader off to use. */}
      <span role="status" aria-live="polite" aria-atomic="true">
        {/* The mark is a dot beside ink, never a coloured sentence: a status
            colour as 12pt text measures under 4.5:1 on this palette, and the
            same rule is why the phone's version draws a 6pt dot. */}
        {stale || live === 'dropped' ? (
          <span aria-hidden="true" style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: 3,
            background: 'var(--warn)', marginRight: 6, verticalAlign: 'middle',
          }} />
        ) : null}
        {sentence}
        {stale ? ' It may have moved since.' : ''}
        {liveLine ? ` ${liveLine}` : ''}
      </span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          style={{
            background: 'none', border: 0, padding: 0, font: 'inherit',
            color: busy ? 'var(--ink3)' : 'var(--brand)',
            cursor: busy ? 'default' : 'pointer', textDecoration: 'underline',
          }}
        >
          {busy ? 'Reading…' : 'Read again'}
        </button>
      ) : null}
    </div>
  );
}

/** The stale threshold, re-exported so a screen that wants to say something of
 *  its own about an ageing figure uses the console's one number. */
export { STALE_MS };
