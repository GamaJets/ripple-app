// Reading and writing `notify_quiet_hours` — the window in which a coach will
// not be pushed to — and finding out whether the server applies it at all.
//
// The rules are in src/lib/quietHours.ts and are under test; this half touches
// supabase and so is deliberately not. It is the same shape as
// src/ui/coachNotify.ts next door and for the same reason: the preference lives
// on the server because nothing on this device sends the notifications it
// governs, so a write has to LAND before the screen may claim anything.
//
// ── Three reads, and the third is the one that is easy to skip ────────────
//
//   the window        the coach's row, or none.
//   the zone          this device's, from `deviceZone()`. Not stored until the
//                     coach saves; a zone written on their behalf would be this
//                     app deciding where somebody sleeps.
//   whether it works  `notify_quiet_hours_rollout`. The filter is inert until
//                     supabase/functions/send-push and notify-message have been
//                     deployed reading the view, and a switch the server does
//                     not apply is worse than no switch. Unread is its own
//                     answer here and is NOT "does not work" — see
//                     `quietAvailability`.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import { useCallback, useEffect, useState } from 'react';
import type { LoadStatus } from './loadStatus';
import { quietFromRow, type QuietHours } from '../lib/quietHours';

export interface QuietHoursRead {
  /** The stored window, or null for a coach who has set none. Null under a
   *  failed read too — which is why `status` is beside it and why no screen may
   *  read null on its own as "they have not set any". */
  quiet: QuietHours | null;
  /** Whether the server is known to apply quiet hours. Null means the rollout
   *  row could not be read, which is not the same as false. */
  enforced: boolean | null;
  status: LoadStatus;
}

const UNREAD: QuietHoursRead = { quiet: null, enforced: null, status: 'loading' };

/** The coach's window and whether this server applies it. */
export async function fetchQuietHours(): Promise<QuietHoursRead> {
  // With no server there is nothing remote to suppress and nothing to read.
  // 'ready' with `enforced: false` is the honest pair: the feature genuinely
  // does not apply, rather than having failed to be looked up.
  if (!USE_SUPABASE) return { quiet: null, enforced: false, status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { quiet: null, enforced: null, status: 'error' };

    // The rollout first, because it decides whether the window is worth
    // drawing. Read separately rather than joined: they are two questions —
    // "what did I choose" and "does this server do anything with it" — and a
    // single failed round trip must not make both unknown when only one is.
    const roll = await supabase
      .from('notify_quiet_hours_rollout').select('enforced').maybeSingle();
    // Includes 42P01 on a database that has not had part 530 applied, which is
    // the truthful "this server does not do quiet hours" and would be perverse
    // to report as a read failure. Any other error stays unknown.
    const missing = String((roll.error as { code?: string } | null)?.code ?? '') === '42P01';
    const enforced = roll.error
      ? (missing ? false : null)
      : ((roll.data as { enforced?: boolean } | null)?.enforced === true);
    if (roll.error && !missing) reportError('quietHours.rollout', roll.error);

    const { data, error } = await supabase
      .from('notify_quiet_hours')
      .select('from_hour, to_hour, tz')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) {
      // A table this database has never had is the same "no quiet hours here"
      // as above, and the window is genuinely none rather than unknown.
      if (String((error as { code?: string }).code ?? '') === '42P01') {
        return { quiet: null, enforced: false, status: 'ready' };
      }
      reportError('quietHours.read', error);
      return { quiet: null, enforced, status: 'error' };
    }
    return { quiet: quietFromRow(data as any), enforced, status: 'ready' };
  } catch (e) {
    reportError('quietHours.read', e);
    return { quiet: null, enforced: null, status: 'error' };
  }
}

/**
 * Store a window, or clear it.
 *
 * `null` clears — there is no "off" column and there must not be one. No row IS
 * the way to say "no quiet hours", and a second way to say the same thing is
 * how two callers come to read it differently (part 251 makes the same argument
 * about `enabled`).
 *
 * Returns whether the server took it, counted from the rows it handed back
 * rather than from the absence of an error: PostgREST resolves a write that
 * matched and changed nothing without complaint, and "saved" over a write that
 * did nothing is the one thing a settings screen must never say.
 */
export async function saveQuietHours(q: QuietHours | null): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return false;
    if (!q) {
      const { error } = await supabase
        .from('notify_quiet_hours').delete().eq('user_id', uid);
      if (error) { reportError('quietHours.clear', error); return false; }
      // A delete that matched nothing is a success here and only here: the
      // coach asked for no quiet hours and there are none. This is the one
      // place a zero row count is the outcome rather than the failure.
      return true;
    }
    const { data, error } = await supabase
      .from('notify_quiet_hours')
      .upsert({ user_id: uid, from_hour: q.fromHour, to_hour: q.toHour, tz: q.tz }, { onConflict: 'user_id' })
      .select('user_id');
    if (error) { reportError('quietHours.write', error); return false; }
    return !!(data && data.length);
  } catch (e) {
    reportError('quietHours.write', e);
    return false;
  }
}

/** The hook. Re-reads on a sign-in change, and on demand after a write. */
export function useQuietHours(): QuietHoursRead & { reload: () => Promise<void> } {
  const rev = useAuthRevision();
  const [read, setRead] = useState<QuietHoursRead>(UNREAD);
  const reload = useCallback(async () => { setRead(await fetchQuietHours()); }, []);
  useEffect(() => {
    let alive = true;
    setRead(UNREAD);
    void fetchQuietHours().then((r) => { if (alive) setRead(r); });
    return () => { alive = false; };
  }, [rev]);
  return { ...read, reload };
}
