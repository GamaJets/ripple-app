// Reading back what the overnight passes wrote into this coach's own inbox.
//
// The rules and every sentence are in src/lib/nightlyPasses.ts and are under
// test; this half touches supabase and so is deliberately not.
//
// ── Why `notifications` and not the job table ─────────────────────────────
//
// The question a coach has is "did those checks happen last night", and the
// table that answers it exactly is `notice_pass_runs` (part 1890): one row per
// pass, per coach, per UTC day. It has RLS on with NO policy and, since part
// 820 applied part 401's doctrine to its three neighbours, no grant to
// `authenticated` either. That is the correct posture for the scheduler's own
// bookkeeping and this file does not try to work around it: opening a table to
// a signed-in user is a schema decision, and a read that quietly relied on a
// permissive policy appearing later is how the three coach notice ledgers ended
// up with a live `grant select` sitting behind a fence.
//
// So this reads the coach's OWN rows — `notifications`, policy `notif_self`,
// `user_id = auth.uid()` — and is honest on the screen about the difference.
// See `SILENCE_IS_NOT_PROOF`: nothing here is not evidence that a pass ran.
//
// ── Why `push_by = 'server'` ──────────────────────────────────────────────
//
// Narrowing, not classification. Every pass writes its row inside a SECURITY
// DEFINER function, so the column defaults to 'server'; anything a handset
// wrote through `notify_users()` carries 'caller' and cannot be one of these.
// The classification is still `passOf()` on the title — this filter only keeps
// a coach's chat backlog out of a read that is bounded at a thousand rows.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import type { LoadStatus } from './loadStatus';
import { PASSES_WINDOW_DAYS, type PassNotice } from '../lib/nightlyPasses';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PassNoticesRead {
  rows: PassNotice[];
  status: LoadStatus;
}

/**
 * The notices the overnight passes wrote for the signed-in coach in the window.
 *
 * `{ rows, status }` and never a bare array. An empty array under a refused
 * read renders as five quiet lines, which is precisely the reading this feature
 * exists to prevent somebody taking as good news.
 */
export async function fetchPassNotices(days: number = PASSES_WINDOW_DAYS): Promise<PassNoticesRead> {
  // No server is not an empty week. There is nothing to have written these
  // rows, so the honest answer is 'error' — the screen then says the read did
  // not come back rather than drawing a calm-looking nothing.
  if (!USE_SUPABASE) return { rows: [], status: 'error' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { rows: [], status: 'error' };
    // A full timestamp, never a bare YYYY-MM-DD: these rows are written at
    // 07:12 UTC and compared against `created_at`, and a date-only bound would
    // be a string compared against a timestamp on whatever the server made of
    // it. The window runs back from now rather than from midnight for the same
    // reason — "the last week" is what the sentence on screen claims.
    const since = new Date(Date.now() - Math.max(1, days) * DAY_MS).toISOString();
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, created_at, pushed_at')
      .eq('user_id', uid)
      .eq('push_by', 'server')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(capLimit());
    if (error) {
      // Includes 42703 on a build whose database has not had part 900 applied,
      // and that is 'error' too: a screen that fell back to counting rows it
      // could not qualify would be reporting on chat notifications.
      reportError('nightlyPasses.read', error);
      return { rows: [], status: 'error' };
    }
    const page = capped<any>((data ?? []) as any[]);
    const rows: PassNotice[] = page.rows.map((r: any) => ({
      id: String(r.id),
      title: String(r.title ?? ''),
      at: String(r.created_at ?? ''),
      // NOT `?? ''`. Null is "not eligible, or not yet" — part 900's own words
      // — and an empty string would count as a falsy value that has been looked
      // at, which is a different claim from one that has not.
      pushedAt: r.pushed_at == null ? null : String(r.pushed_at),
    }));
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('nightlyPasses.read', e);
    return { rows: [], status: 'error' };
  }
}

/** The hook. Re-reads on a sign-in change and on demand. */
export function useNightlyPasses(): PassNoticesRead & { reload: () => Promise<void> } {
  const rev = useAuthRevision();
  const [read, setRead] = useState<PassNoticesRead>({ rows: [], status: 'loading' });
  const reload = useCallback(async () => {
    const r = await fetchPassNotices();
    setRead(r);
  }, []);
  useEffect(() => {
    let alive = true;
    setRead({ rows: [], status: 'loading' });
    void fetchPassNotices().then((r) => { if (alive) setRead(r); });
    return () => { alive = false; };
  }, [rev]);
  return { ...read, reload };
}
