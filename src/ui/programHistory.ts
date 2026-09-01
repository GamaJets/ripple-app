// Reading one client's earlier programmes.
//
// The table and the trigger are in
// supabase/parts/176-the-programme-that-was-there-before.sql; every sentence a
// screen may say about the rows is in src/lib/programHistory.ts, which is pure
// and tested. This file is the round trip and the honesty about it.
//
// ── One client at a time, on demand ───────────────────────────────────────
//
// Not a provider. `assigned_programs` is one row per client and is worth
// holding for the whole roster, which is why src/ui/assignedPrograms.tsx is a
// context; history is several rows per client and is read by exactly one screen
// when a coach opens one person. Loading every client's every past block at
// launch would be the largest read in the coach app in service of a section
// most coaches open occasionally.
//
// ── null rows, never an empty array, under a failure ──────────────────────
//
// The distinction the whole of this codebase turns on, and it bites hardest
// here: "no earlier programmes" is a sentence a coach ACTS on — they conclude
// the client is new to them and stop looking. `historyBoard` is handed null and
// answers 'unreadable' for it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { reportError } from '../lib/reportError';
import { isQueryableId } from '../lib/clientDrift';
import { type LoadStatus } from './loadStatus';
import type { HistoryRow } from '../lib/programHistory';
import type { Program } from '../lib/programs';

// Written out here, on one line, rather than imported from beside the logic
// that consumes them. scripts/check-schema.mjs resolves a select list that
// arrives as a named constant only within the file that names it, so a shared
// constant is a select list nothing compares against the SQL or against the
// live database — which is how `workouts.session_mins` came to be declared,
// committed, generated into setup.sql and never run.
const HISTORY_COLS = 'id, program, starts_on, assigned_at, replaced_at, reason';

export interface ProgramHistoryRead {
  rows: HistoryRow[] | null;
  status: LoadStatus;
  /** Re-reads. A coach who has just reassigned from the builder comes back to
   *  this screen expecting the block they replaced to be in the list. */
  reload: () => void;
}

export function useProgramHistory(clientId: string | null): ProgramHistoryRead {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  // The client whose answers are allowed to reach the screen. Tapping through a
  // book starts a read per tap and they do not come back in order, so without
  // this a slow answer for the first person lands under the name of the second
  // — one client's training history attributed to another, which is worse than
  // showing nothing. The same guard client-training.tsx and client-body.tsx use.
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    if (!clientId) { wanted.current = null; setRows(null); setStatus('ready'); return; }
    if (!USE_SUPABASE) {
      // No server means no history, and that is a fact about this build rather
      // than about the client — 'error', so nothing renders "no earlier
      // programmes" about somebody whose record was never asked for.
      setRows(null); setStatus('error'); return;
    }
    // A client the coach typed in by hand has no user account, so their id is
    // not a uuid and Postgres refuses the whole statement rather than skipping
    // the value. Nothing is asked for them and the screen says why.
    if (!isQueryableId(clientId)) { setRows(null); setStatus('error'); return; }

    let cancelled = false;
    wanted.current = clientId;
    setStatus('loading'); setRows(null);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('assigned_program_history')
          .select(HISTORY_COLS)
          .eq('client_id', clientId)
          // Newest first, with the id settling the ties: two blocks replaced in
          // the same transaction share an instant, and at the cap the server may
          // break that tie differently on each read — which would shuffle the
          // oldest blocks between two visits to the same screen.
          .order('replaced_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(capLimit());
        if (cancelled || wanted.current !== clientId) return;
        if (error) {
          reportError('programHistory.read', error, { clientId });
          setRows(null); setStatus('error'); return;
        }
        const page = capped((data ?? []) as any[]);
        setRows(page.rows.map((r): HistoryRow => ({
          id: String(r.id),
          program: (r.program ?? null) as Program | null,
          startsOn: typeof r.starts_on === 'string' && r.starts_on ? r.starts_on : null,
          assignedAt: r.assigned_at ?? null,
          replacedAt: r.replaced_at ?? null,
          reason: r.reason ?? 'replaced',
        })));
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch (e) {
        if (cancelled) return;
        reportError('programHistory.read', e, { clientId });
        setRows(null); setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, tick]);

  return { rows, status, reload };
}
