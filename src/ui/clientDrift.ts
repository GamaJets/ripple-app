// Who on the coach's book has stopped, read once and answered the same way
// everywhere.
//
// ── Why this is a hook and not a fourth copy ──────────────────────────────
//
// Two definitions of "at risk" were running side by side in the coach app.
//
//   `assessDrift` (src/lib/clientDrift.ts) reads each client's own record —
//   check-ins, workouts, sessions, visits — over a 56-day history, compares
//   their recent fortnight against their own baseline, and has a distinct
//   UNKNOWN band for a client there is nothing on record about. The Clients
//   screen ranks on it.
//
//   `atRiskClient` (src/lib/trainerMock.ts) is `adherence < 80 || staleDays >= 2
//   || noRecordOf`, where `staleDays` recovers a number by running a regex over
//   a DISPLAY STRING built for a human to read — `ago()` in src/ui/roster.tsx
//   produces "3d ago" and this parses the 3 back out of it. Its own comment
//   says clientDrift.ts "models this properly … this function remains for the
//   screens that have not moved to it yet."
//
// Those screens were `app/(trainer)/analytics.tsx` and
// `app/(trainer)/assistant.tsx` — the coach's business review, and the thing
// that writes prose about their book and sends a count of drifting clients to a
// model. So three of a coach's four decision surfaces ranked and counted on a
// two-day threshold reversed out of a caption, and the fourth ranked on
// something else entirely. A coach comparing Analytics against Clients was
// looking at two different books.
//
// `app/(trainer)/dashboard.tsx` had already moved, by carrying a hundred lines
// of read, three-state handling and actionability rules inline. Copying that
// into two more screens would have made the fix into the disease, so it is
// lifted here verbatim and all three call it.
//
// ── The three renders, and the fourth thing ───────────────────────────────
//
// `drift === null && !error` — not read yet. Claim nothing.
// `drift !== null`           — read. An EMPTY MAP IS A REAL ANSWER.
// `error !== null`           — the read failed. Say so, and never let it look
//                              like "nobody is drifting".
//
// And separately from all three: whether a verdict may be ACTED on.
// `readClientActivity` reports `notAsked` (ids with no Repple account behind
// them) and `truncated` (a read that hit PostgREST's row ceiling). A verdict
// off either is still worth ORDERING a list by — the worst case is a name too
// high up — and is not worth writing "where have you been?" to somebody on the
// strength of, because the rows that would have disproved their silence are
// exactly the ones that did not come back. `actionable` is that gate.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import {
  assessDrift, readClientActivity, summariseDrift,
  DEFAULT_WINDOWS, type Drift, type DriftSummary,
} from '../lib/clientDrift';

/** One roster row, reduced to the two fields the drift read needs off it. */
export interface DriftSubject {
  id: string;
  /** `coach_clients.created_at` or the coaching relationship, and null where
   *  genuinely unknown — NEVER guessed. Passing it is what separates a client
   *  added yesterday from one silent for eight weeks: without it both have no
   *  recent activity and both were told "nothing recorded in the last 56 days",
   *  which is a strange thing to say to somebody who joined on Tuesday. It also
   *  clamps the baseline to the period they were actually on the book, so a
   *  real fall is not diluted by weeks they did not exist for. */
  joinedAt?: string | null;
}

export interface ClientDriftRead {
  /** Per client id. Null until the read lands; an empty map IS an answer. */
  drift: Record<string, Drift> | null;
  /** The message from a failed read, or null. Not the absence of drift. */
  error: string | null;
  /** What the read could not cover. Null until it lands. */
  coverage: { notAsked: Set<string>; truncated: boolean } | null;
  /** The verdict for one client, or null while unread. */
  driftFor: (id: string) => Drift | null;
  /**
   * Whether this client's verdict may be acted on — messaged off, nudged off —
   * as opposed to merely ordered by. False while the read is in flight.
   */
  actionable: (id: string) => boolean;
  /** The band counts over the subjects passed in, or null while unread. */
  bands: DriftSummary | null;
  /**
   * Why a list built on this is not built on the training record, or null when
   * it is. Said out loud, because a short list of names is otherwise
   * indistinguishable from a book with nothing wrong in it.
   */
  note: string | null;
}

/**
 * Read the training record behind every id in `subjects`.
 *
 * Keyed on the joined ids rather than the array, so a roster provider handing
 * back a new array of the same people does not re-read. `nonce` is the screen's
 * own refresh counter — bump it and this reads again.
 */
export function useClientDrift(
  subjects: DriftSubject[],
  tenantId: string | null,
  nonce = 0,
): ClientDriftRead {
  const [drift, setDrift] = useState<Record<string, Drift> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ notAsked: Set<string>; truncated: boolean } | null>(null);

  const key = subjects.map((c) => c.id).join(',');
  // Read off `key` rather than off `subjects` so the effect below can depend on
  // a string. The join dates are looked up out of the array inside the effect,
  // which is not in the dependency list on purpose: a roster whose rows changed
  // identity but not membership must not restart the read.
  const joinedOf: Record<string, string | null> = {};
  for (const c of subjects) joinedOf[c.id] = c.joinedAt ?? null;

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    let live = true;
    setError(null);
    // Nobody to ask about is a real, empty answer — not a read in flight. A
    // screen whose roster failed must NOT reach this branch believing it: the
    // caller gates on its own roster status, exactly as the dashboard does,
    // because an empty roster under 'error' would otherwise produce a confident
    // "nobody is drifting" out of a list nobody read.
    if (!ids.length) { setDrift({}); setCoverage({ notAsked: new Set(), truncated: false }); return; }
    setDrift(null); setCoverage(null);
    (async () => {
      try {
        const act = await readClientActivity(supabase, ids, {
          days: DEFAULT_WINDOWS.historyDays,
          tenantId: tenantId ?? null,
        });
        if (!live) return;
        setCoverage({ notAsked: new Set(act.notAsked), truncated: act.truncated });
        const map: Record<string, Drift> = {};
        for (const id of ids) {
          map[id] = assessDrift({ clientId: id, events: act.byClient[id] ?? [], since: joinedOf[id] ?? null });
        }
        setDrift(map);
      } catch (e: any) {
        if (!live) return;
        reportError('useClientDrift', e);
        setDrift(null);
        setCoverage(null);
        setError(e?.message || 'Could not read the training record.');
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tenantId, nonce]);

  const driftFor = (id: string): Drift | null => (drift ? drift[id] ?? null : null);
  const actionable = (id: string): boolean =>
    !!coverage && !coverage.truncated && !coverage.notAsked.has(id);

  const bands = summariseDrift(
    drift ? subjects.map((c) => drift[c.id]).filter((d): d is Drift => !!d) : null,
  );

  const note: string | null =
    error
      ? 'Their training records could not be read, so nothing below is based on who has stopped training — only on what your roster rows already say.'
      : !coverage
        ? null
        : coverage.truncated
          ? 'More activity is on record than one request returns, so nobody’s silence can be proved from it. Nothing below is based on who has stopped training — a nudge sent on a short read reaches somebody who trained yesterday.'
          : coverage.notAsked.size
            ? `${coverage.notAsked.size} of these were added by hand and have no Repple account, so there is no training record to judge them by and none of them appears here on one.`
            : null;

  return { drift, error, coverage, driftFor, actionable, bands, note };
}
