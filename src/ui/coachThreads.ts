// The coach's inbox, read once.
//
// ── What this replaced ─────────────────────────────────────────────────────
//
// Nothing, which was the problem. A coach could reach a conversation from a
// client's detail screen, from a leaderboard row, or from a push notification
// carrying `?clientId=…` — three routes that all begin with a client already
// chosen. There was no screen anywhere in the coach app that answered "who has
// written to me", and a coach with twenty clients therefore had no way to find
// out short of opening twenty threads.
//
// ── One read, and why it is an RPC ─────────────────────────────────────────
//
// `coach_threads()` (supabase/parts/148) returns one row per client on the
// roster: their name and face, the last message in the thread with who sent it,
// and the unread count. The alternative — a query per client — is not merely
// slower. It is N independent chances to fail, and a list in which six threads
// failed and thirty-four did not has no honest rendering: the six look exactly
// like clients who have never written. That is the failure src/ui/loadStatus.ts
// exists to name, arriving one row at a time.
//
// ── Unread comes from where it already came from ───────────────────────────
//
// The RPC joins `coach_unread_counts()` (supabase/parts/88), which is what the
// Clients tab already badges with (src/ui/roster.tsx) and what
// `mark_thread_read()` clears when a thread is opened. There is deliberately no
// second definition here: two definitions that disagree would badge the same
// client differently on the same phone at the same moment, and nobody could say
// which was right.
//
// One consequence worth stating, because it looks like a bug and is not: the
// count is per THREAD PER SIDE, not per message, so opening a thread clears the
// whole of it. A coach who opens a thread with four unread messages and reads
// one has, as far as this app is concerned, read four. That is part 88's
// design; this screen inherits it rather than inventing a second answer.
//
// ── Refreshing ─────────────────────────────────────────────────────────────
//
// `refresh()` exists because opening a thread is what marks it read, and the
// coach comes straight back here afterwards. Without it the badge they just
// cleared is still on the row, and the screen is stating something the server
// has already stopped agreeing with.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { rowToThread, splitThreads, type CoachThread, type SplitThreads } from '../lib/coachThreads';

export interface CoachThreadsValue extends SplitThreads {
  /** Whether the two lists above are the server's answer.
   *
   *  Under 'error' an empty list means the conversations COULD NOT BE READ, and
   *  the screen must not say nobody has written. Under 'partial' the rows are
   *  real but there are more clients than came back — the list may be read, and
   *  nothing computed over it may be presented as a total. */
  status: LoadStatus;
  /** How many clients came back at all, conversations and otherwise. Meaningful
   *  only under 'ready' or 'partial'; it is what lets the empty state tell "no
   *  clients" apart from "no conversations", which are different problems with
   *  different fixes. */
  roster: number;
  /** Re-read. Called on focus, because opening a thread marks it read. */
  refresh: () => Promise<void>;
}

const EMPTY: SplitThreads = { conversations: [], unstarted: [] };

export function useCoachThreads(): CoachThreadsValue {
  const authRev = useAuthRevision();
  const [lists, setLists] = useState<SplitThreads>(EMPTY);
  const [roster, setRoster] = useState(0);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const load = useCallback(async (cancelled: () => boolean = () => false) => {
    // With no backend there are no threads and there never will be. That is a
    // complete answer, not a failed read, so it settles at 'ready' with nothing
    // in it rather than spinning.
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // `capLimit()` on an RPC for the same reason as on a table read: PostgREST
      // caps a set-returning function at 1000 rows and says nothing about it.
      // The set here is the coach's roster, so a cap is unlikely — and "unlikely"
      // is exactly the assumption src/lib/rowCap.ts was written to stop anybody
      // making, because the read that quietly truncates is the one nobody
      // expected to be big.
      const { data, error } = await supabase.rpc('coach_threads').limit(capLimit());
      if (cancelled()) return;
      if (error) {
        // Reported rather than swallowed: an empty inbox under a refused read is
        // the failure this whole screen is careful about, and somebody has to be
        // able to find out why afterwards.
        reportError('coachThreads.load', error);
        setStatus('error');
        return;
      }
      const page = capped(Array.isArray(data) ? data : []);
      const rows: CoachThread[] = page.rows.map(rowToThread);
      setLists(splitThreads(rows));
      setRoster(rows.length);
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      if (cancelled()) return;
      reportError('coachThreads.load', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [authRev, load]);

  // The lists are NOT cleared before a re-read. A coach who pulls to refresh in
  // a basement with no signal keeps the conversations they had; `status` is what
  // says they are no longer confirmed current, which is the honest pair.
  const refresh = useCallback(async () => { await load(); }, [load]);

  return { ...lists, status, roster, refresh };
}
