// The React half of src/lib/readDeadline.ts, which holds every opinion and has
// a test. What is here is the one thing that cannot be tested under node: a
// timer, because a read that is never going to answer produces no event of its
// own and nothing else on the screen will redraw to notice the time passing.
//
// Read src/lib/readDeadline.ts first. In short: no request in this app carries
// a timeout, so a socket that accepts and then says nothing leaves a provider's
// `LoadStatus` at 'loading' for the life of the mount — and these screens mount
// once and are never torn down. Every screen already has the words for a read
// that failed; none of them could reach that branch, because nothing ever said
// it had.
//
// ── Why this wraps the status and not the read ────────────────────────────
//
// The obvious fix is a deadline on each request, and it is the wrong shape for
// the providers. `src/ui/clientData.tsx` reads five tables inside one function
// whose return value arms a WRITE — its own header sets out what happened the
// last time a failed read and a healthy write were allowed to interleave, which
// was the member's recorded injuries being overwritten with blanks. Cutting a
// promise short in the middle of that would leave a second attempt running
// beside the first over the same state.
//
// This does not touch the read. It changes the SENTENCE the screen is showing
// while the read is out there, from "still reading" to "we could not read
// this", once the wait is longer than any honest one. The read carries on; if
// it lands at thirty seconds the provider sets 'ready' and this steps out of
// the way in the same render, because `escalate` is a pure function of the live
// status and not a latch.
import { useEffect, useState } from 'react';
import { READ_DEADLINE_MS, escalate, stalled } from '../lib/readDeadline';
import type { LoadStatus } from './loadStatus';

/**
 * A provider's status, with an ending on the case where the server never
 * answers at all.
 *
 * Drop it over any `LoadStatus` a screen or provider publishes:
 *
 *   const status = useReadDeadline(worstStatus(serverStatus, queueStatus));
 *
 * Returns the status unchanged in every case but one: a read still 'loading'
 * past READ_DEADLINE_MS is published as 'error', which src/ui/loadStatus.ts
 * defines as "the server did not answer, or refused" — the first of those two,
 * exactly.
 */
export function useReadDeadline(status: LoadStatus, ceilingMs: number = READ_DEADLINE_MS): LoadStatus {
  // Whether the ceiling has passed for the read currently in flight. State and
  // not a ref: the returned status is derived from it and a ref would not
  // redraw, which is the whole failure being fixed — nothing else on the screen
  // is going to render at the sixty-fifth second.
  const [hitCeiling, setHit] = useState(false);

  useEffect(() => {
    // Any settled status clears it. This is what makes a late answer correct
    // itself: the provider moves to 'ready', this effect re-runs, the flag goes
    // down and the notice disappears without the member touching anything.
    if (status !== 'loading') { setHit(false); return; }
    // A fresh 'loading' — a reload, a re-auth — starts the wait again rather
    // than inheriting the verdict on the last one.
    setHit(false);
    const startedAt = Date.now();
    // The timer is the trigger; `stalled` is the JUDGEMENT, and it is asked
    // again against the wall clock rather than trusted. React re-runs effects
    // on a development double-mount and a suspended app fires its timers late
    // and in a bunch on resume, so "the timer fired" is not on its own evidence
    // that the wait was long enough. The rule about what counts as too long
    // lives in src/lib/readDeadline.ts with a test on it, in one place, rather
    // than being implied here by an argument to setTimeout.
    const id = setTimeout(() => {
      setHit(stalled(status, Date.now() - startedAt, ceilingMs));
    }, ceilingMs);
    return () => clearTimeout(id);
  }, [status, ceilingMs]);

  return escalate(status, hitCeiling);
}
