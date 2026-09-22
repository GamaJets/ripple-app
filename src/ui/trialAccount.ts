// The one read behind the account-wide trial. The arithmetic is
// src/lib/trialGate.ts, which is pure and tested; nothing here decides how long
// is left.
//
// ── supabase-js RESOLVES ON AN ERROR ───────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. The `.error` read
// matters more than usual here: the difference between "your trial started on
// the 3rd" and "we could not tell" is the difference between a figure and a
// guess, and the day billing is switched on it will be the difference between
// a working app and a paywall raised by a refused query.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { isMissingFunction } from '../lib/coachCurrency';
import type { LoadStatus } from './loadStatus';

export interface AccountTrial {
  /** ISO instant, or null when the account has no start date recorded. */
  startedAt: string | null;
  status: LoadStatus;
}

/**
 * When this coach's trial began, from `trainers.trial_started_at` (part 191).
 *
 * `trainers_self_rw` is `for all using (auth.uid() = id)`, so the row is
 * readable without a filter — but the filter is written anyway, because a
 * coach who is also a gym owner matches `trainers_owner_r` on every trainer in
 * their tenant and would otherwise get somebody else's row first.
 *
 * NO ROW is 'ready' with a null start, not 'error'. An account with no trainer
 * profile has no trial, and "you have not got one" and "we could not tell" are
 * different sentences — the second is the one that must never be rendered as a
 * trial that has run out.
 */
export async function fetchAccountTrial(): Promise<AccountTrial> {
  if (!USE_SUPABASE) return { startedAt: null, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { startedAt: null, status: 'error' };

    // The RPC first, and the column read only where the RPC is not there.
    //
    // `trainers_public_directory_r` is `for select to authenticated using
    // (listed = true)`, and this table is granted COLUMN BY COLUMN (part 131)
    // for exactly that reason: a column grant here is a publication to every
    // account on the platform, rival coaches included. Part 2200 granted
    // `trial_started_at` to fix a coach who could not read their own, and
    // published every listed coach's along with it. Part 2471 revokes the
    // column and `my_trial_started_at()` answers about `auth.uid()` alone.
    //
    // The fallback is what makes the two changes orderable either way round: an
    // app shipped before 2471 is applied finds no function and reads the column
    // it can still read; once 2471 is applied the RPC answers and the column
    // read is never reached. It is NOT a general error fallback — anything
    // other than a missing function is a failed read and is reported as one,
    // because "we could not tell" must never render as a trial that has run out.
    const rpc = await supabase.rpc('my_trial_started_at');
    if (!rpc.error) {
      const v = rpc.data;
      return { startedAt: typeof v === 'string' ? v : null, status: 'ready' };
    }
    if (!isMissingFunction(rpc.error)) {
      reportError('trialAccount.read', rpc.error);
      return { startedAt: null, status: 'error' };
    }

    const { data, error } = await supabase
      .from('trainers')
      .select('trial_started_at')
      .eq('id', uid)
      .limit(1);
    if (error) { reportError('trialAccount.read', error); return { startedAt: null, status: 'error' }; }
    const rows = (data ?? []) as { trial_started_at: string | null }[];
    return { startedAt: rows[0]?.trial_started_at ?? null, status: 'ready' };
  } catch (e) {
    reportError('trialAccount.read', e);
    return { startedAt: null, status: 'error' };
  }
}
