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
