// Challenges — the ones that exist on the server, with other people in them.
//
// ── What this replaced, and why ────────────────────────────────────────────
//
// This file used to be a constant. Three challenges hard-coded in the bundle,
// `field: []` on every one, a literal `endsInDays` that counted down from
// nothing, and joined-state kept in AsyncStorage — so "joining" a challenge was
// a note this phone kept about itself. Before the array was emptied it held six
// invented athletes with invented scores, and a real client was shown their
// rank against people who do not exist.
//
// Everything now comes from `my_challenges()` and `challenge_board()`
// (supabase/parts/128-a-cohort-and-a-credit.sql). Joining is a row in
// `challenge_participants`, written by the client and readable by nobody else;
// scores are computed on the server from `workouts`, so there is no number here
// that anybody can type.
//
// ── Why the score is not computed on the phone any more ────────────────────
//
// It used to be, from `useWorkoutLog()`, and that was correct while the only
// reader was the person themselves. The moment a score becomes a rank against
// other people it has to come from somewhere the athlete cannot write, or the
// first person to notice owns every board in their gym. That is also why this
// provider no longer depends on the workout log at all: the client's own score
// arrives on the same row as everyone else's, computed the same way.
//
// ── Why there is no cache ──────────────────────────────────────────────────
//
// Sibling providers cache to AsyncStorage so a gym basement with no signal
// still shows something. That is right for a message from your coach, which is
// still true tomorrow. It is wrong for a leaderboard: a stale board is a list
// of other people's positions, presented as current, with no way for the reader
// to tell. So this holds what the last read returned and says which read that
// was — an empty list under 'error' means the board could not be read, never
// that nobody is playing (src/ui/loadStatus.ts).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import {
  shapeBoard, shapeChallenges, type BoardRow, type ChallengeRow,
  type RawBoardRow, type RawChallenge,
} from '../lib/challenges';

export type { BoardRow, ChallengeRow } from '../lib/challenges';

/** What a board fetch resolves to. The status travels with the rows because an
 *  empty array on its own cannot say whether the board is empty or unread. */
export interface BoardResult {
  rows: BoardRow[];
  status: LoadStatus;
  /** The server's own words when it refused, for the one refusal a client can
   *  act on: "join the challenge to see who else is on the board". */
  message: string | null;
}

interface ChallengesValue {
  challenges: ChallengeRow[];
  /** Whether `challenges` is what the server holds. */
  status: LoadStatus;
  /** Re-run the read. Behind a "couldn't load — retry" affordance. */
  reload: () => void;
  /** Put the client on a board. Resolves true only once the row is on the
   *  server — a Join that only happened on this phone is the old bug. */
  join: (id: string) => Promise<boolean>;
  /** Take them off it. Same rule. */
  leave: (id: string) => Promise<boolean>;
  /** Fetch one board. Never throws. */
  board: (id: string) => Promise<BoardResult>;
}

const Ctx = createContext<ChallengesValue | null>(null);

export function ChallengesProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [challenges, setChallenges] = useState<ChallengeRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);
  // The list is re-read after every join and leave, and a read that lands after
  // the provider has moved on must not overwrite a newer one.
  const runRef = useRef(0);

  const read = useCallback(async () => {
    const run = ++runRef.current;
    // No backend at all: there is no absent server to misreport, and a
    // challenge is a thing that only exists on one. 'ready' with nothing in it
    // is the true answer, not an error.
    if (!USE_SUPABASE) { setChallenges([]); setStatus('ready'); return; }

    let signedIn = false;
    try {
      // getSession, not getUser: getUser REJECTS with no session, and reading
      // that as a failure is how sibling providers used to latch into 'error'
      // before anybody had signed in.
      const { data: sess } = await supabase.auth.getSession();
      signedIn = !!sess?.session?.user?.id;
    } catch { /* no local session; treated as signed out below */ }
    if (run !== runRef.current) return;
    if (!signedIn) { setChallenges([]); setStatus('ready'); return; }

    try {
      const { data, error } = await supabase.rpc('my_challenges');
      if (run !== runRef.current) return;
      // The list stays as it was and the status says it was not checked.
      // Clearing it here would tell a client their gym is running nothing.
      if (error) { setStatus('error'); return; }
      setChallenges(shapeChallenges(data as RawChallenge[] | null));
      setStatus('ready');
    } catch {
      if (run === runRef.current) setStatus('error');
    }
  }, []);

  useEffect(() => { read(); }, [read, authRev, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const join = useCallback(async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE || !id) return false;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) return false;
      // `.select('challenge_id')` so a row RLS refused cannot arrive looking
      // like a success: a zero-row write is not an error in PostgREST, and the
      // insert that was quietly refused is exactly the one this must catch.
      const { data, error } = await supabase
        .from('challenge_participants')
        .insert({ challenge_id: id, user_id: uid })
        .select('challenge_id');
      if (error || !data || data.length === 0) return false;
      reload();
      return true;
    } catch { return false; }
  }, [reload]);

  const leave = useCallback(async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE || !id) return false;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase
        .from('challenge_participants')
        .delete().eq('challenge_id', id).eq('user_id', uid)
        .select('challenge_id');
      // Same rule on the way out. A delete that matched nothing leaves the
      // client on a board they were told they had left.
      if (error || !data || data.length === 0) return false;
      reload();
      return true;
    } catch { return false; }
  }, [reload]);

  const board = useCallback(async (id: string): Promise<BoardResult> => {
    if (!USE_SUPABASE || !id) return { rows: [], status: 'error', message: null };
    try {
      const { data, error } = await supabase.rpc('challenge_board', { p_challenge: id });
      // challenge_board() raises 42501 rather than returning nothing for every
      // refusal, precisely so that this branch can tell "you are not on this
      // board" from "this board is empty". The message is the server's and is
      // shown as-is for the one case the client can do something about.
      if (error) return { rows: [], status: 'error', message: error.message || null };
      return { rows: shapeBoard(data as RawBoardRow[] | null), status: 'ready', message: null };
    } catch {
      return { rows: [], status: 'error', message: null };
    }
  }, []);

  const value = useMemo(
    () => ({ challenges, status, reload, join, leave, board }),
    [challenges, status, reload, join, leave, board],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChallenges(): ChallengesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChallenges must be used inside <ChallengesProvider>');
  return v;
}
