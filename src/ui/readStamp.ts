// The two things `<Fetched>` wants, from the one thing every provider already
// publishes.
//
// The React half of src/lib/readStamp.ts, which holds every judgement and has a
// test. What is here is the part that cannot be tested under node: a piece of
// state that has to survive across renders and be updated from an effect.
//
// ── How a client screen adopts a read stamp ────────────────────────────────
//
//   const { classes, status, refresh } = useClasses();
//   const { at, busy } = useReadStamp(status, classes);
//   …
//   <Fetched at={at} onRefresh={refresh} busy={busy} />
//
// That is the whole of it, and no provider had to change. See the header of
// src/lib/readStamp.ts for why the stamp is derived rather than added to
// twenty-odd context values.
//
// ── What to pass as the second argument ───────────────────────────────────
//
// Whatever the provider publishes as its answer — the array, the map, the row.
// It is compared by IDENTITY and never read, so it costs nothing, and it is
// what lets a re-read that went 'ready' → 'ready' without passing through
// 'loading' still move the stamp. Passing nothing is safe and slightly worse:
// the stamp then only moves on a status transition.
//
// ── For a screen fed by several providers ─────────────────────────────────
//
// One `useReadStamp` per provider and `oldestFetch` from src/lib/freshness.ts
// over the results. That file argues the point: a screen showing three
// providers' figures under one "Read 2 minutes ago" is making a claim about all
// three, so the claim has to be true of the worst of them. Take the newest and
// a figure read an hour ago gets a confident wrong label instead of none.
import { useEffect, useState } from 'react';
import type { LoadStatus } from './loadStatus';
import { nextStamp, noStamp, stampBusy, type ReadStamp } from '../lib/readStamp';

/**
 * When this provider's read last LANDED, and whether one is in flight.
 *
 * `at` is null until the first read comes back, which `<Fetched>` renders as
 * "Reading…" rather than as an age — the one honest sentence available before
 * anything has been read.
 *
 * The update happens in an effect rather than during render, and the reducer
 * returns the object it was handed when nothing changed, so a render with no
 * news is not a state change. Both halves matter: this hook is going to be
 * called from screens that already sit inside providers whose values change
 * often, and a hook that re-rendered them back is how the coach app came to
 * spin. src/lib/dismissedSet.ts has that story.
 */
export function useReadStamp(status: LoadStatus, token: unknown = null): { at: number | null; busy: boolean } {
  const [stamp, setStamp] = useState<ReadStamp>(() => noStamp(status, token));
  useEffect(() => {
    setStamp((prev) => nextStamp(prev, status, token, Date.now()));
  }, [status, token]);
  return { at: stamp.at, busy: stampBusy(status) };
}
