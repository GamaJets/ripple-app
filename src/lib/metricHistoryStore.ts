// Reading and writing `metric_history` (part 129) — the monthly snapshots
// behind every trend chart in the three apps.
//
// The arithmetic is in src/lib/monthlyHistory.ts and is under test; this half
// touches supabase and is not.
//
// ── Why the status matters more here than almost anywhere ──────────────────
//
// The trend chart is the ONLY record of the past that exists. Nothing
// recomputes March from source — March is a number somebody's phone wrote down
// in March and it cannot be derived again. So a failed read that came back as
// `{}` would not merely draw an empty chart, it would be indistinguishable from
// a business with no history, and the next successful write would happily save
// this month on top of an account whose other months the app had decided were
// not there.
//
// Hence: `status`. Under 'error' the hook keeps the device cache and says the
// history is unconfirmed, and — this is the half that protects the account —
// it writes NOTHING to the server for the rest of that pass. A read that failed
// is not permission to assume the server is empty.
//
// ── The unit ───────────────────────────────────────────────────────────────
//
// `value` is a bare number. What it means is defined by `metric_key`:
// 'repple.trainer.revHistory' is money in the gym's currency, which the screen
// prices at render time from `tenants.currency` and shows as a dash when the
// gym has not set one. Nothing in this file formats anything, and nothing in it
// may ever assume a currency.
// ── Whose months, and who says so ──────────────────────────────────────────
//
// Both functions TAKE the account. Neither resolves one, and that is the same
// fix as src/lib/coachPrefsStore.ts for the same reason, stated at length in
// src/lib/accountScopedWrite.ts.
//
// The hazard here is the sharper of the two, because the read and the write are
// links in one chain. `useMonthlyHistory` reads the account's months, hands them
// to `historyPass`, which decides `upload` = this month plus only the months the
// SERVER has never heard of, and then writes. With each end resolving its own
// uid, a handset that changed hands mid-pass produced a decision taken against
// one account's rows and a write filed under another's — a coach's revenue
// permanently attributed to somebody else, in the one table nothing can
// recompute. src/lib/monthlyHistory.ts walks the five steps of it.
//
// Passing the uid through makes the read, the decision and the write one
// account by construction. A session that moves mid-pass now meets RLS, which
// refuses the write rather than retargeting it.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { reportError } from './reportError';
import { accountUid, writeTargetFor, NO_ACCOUNT_TO_WRITE_AS } from './accountScopedWrite';
import { sanitiseSnapshots, isMonthKey, type Snapshots } from './monthlyHistory';
import type { LoadStatus } from '../ui/loadStatus';

/**
 * Every month recorded for this account under this metric.
 *
 * 'ready' with `{}` means the account genuinely has no history. 'error' with
 * `{}` means we do not know, and the caller must not say the first.
 *
 * Signed out, or the backend off, is 'ready' with nothing: the device store is
 * the source of truth in that case, so there is no absent server being
 * misreported. Same rule as src/ui/loadStatus.ts states.
 */
export async function fetchMetricHistory(
  uid: string | null | undefined,
  metricKey: string,
): Promise<{ snapshots: Snapshots; status: LoadStatus }> {
  if (!USE_SUPABASE) return { snapshots: {}, status: 'ready' };
  // Not an account is the signed-out answer, unchanged: it is what `getUser()`
  // produced for the same session before the uid was passed in.
  const account = accountUid(uid);
  if (!account) return { snapshots: {}, status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('metric_history')
      .select('month, value')
      .eq('user_id', account)
      .eq('metric_key', metricKey);
    if (error) {
      reportError('metricHistory.read', error);
      return { snapshots: {}, status: 'error' };
    }
    const raw: Record<string, unknown> = {};
    for (const r of (data ?? []) as { month?: unknown; value?: unknown }[]) {
      if (typeof r?.month === 'string') raw[r.month] = r.value;
    }
    // sanitiseSnapshots is what turns the `numeric` column — which PostgREST
    // hands back as a string — into a number, and drops anything that is not
    // one. Left raw, every point on the chart would be typeof 'string' and
    // would render as a gap: the history would look like it had never been
    // written.
    return { snapshots: sanitiseSnapshots(raw), status: 'ready' };
  } catch (e) {
    reportError('metricHistory.read', e);
    return { snapshots: {}, status: 'error' };
  }
}

/**
 * Record months. Existing months are refreshed, absent ones inserted.
 *
 * Only ever called with months the caller has decided are safe to send — the
 * current one, and the backfill of what the device recorded before this table
 * existed. It does not delete, and it does not touch a month it was not handed:
 * a coach signed in on two phones has one history, and neither handset may
 * prune it on the strength of not having heard of a month.
 *
 * Returns the number of rows the server confirms it wrote. Zero from a
 * non-empty request is a refusal — PostgREST does not treat writing nothing as
 * an error — so it is reported rather than read as success.
 *
 * `uid` is the account the months are filed under, and it is the CALLER's — the
 * same id the pass above read and decided with. First in the signature because
 * it is the thing that must not be forgotten. Not an account is a refusal, is
 * reported, and is never a cue to go and resolve one.
 */
export async function saveMetricHistory(
  uid: string | null | undefined,
  metricKey: string,
  snapshots: Snapshots,
): Promise<number> {
  if (!USE_SUPABASE) return 0;
  const months = Object.keys(snapshots).filter(isMonthKey);
  if (!months.length) return 0;
  const target = writeTargetFor(uid);
  if (!target.write) {
    reportError('metricHistory.write', new Error(NO_ACCOUNT_TO_WRITE_AS));
    return 0;
  }
  try {
    const rows = months
      .filter((m) => Number.isFinite(snapshots[m]))
      .map((m) => ({ user_id: target.uid, metric_key: metricKey, month: m, value: snapshots[m], recorded_at: new Date().toISOString() }));
    if (!rows.length) return 0;
    const { data, error } = await supabase
      .from('metric_history')
      .upsert(rows, { onConflict: 'user_id,metric_key,month' })
      .select('month');
    if (error) { reportError('metricHistory.write', error); return 0; }
    const written = (data ?? []).length;
    if (written === 0) {
      reportError('metricHistory.write', new Error(`upsert of ${rows.length} month(s) affected no rows`));
    }
    return written;
  } catch (e) {
    reportError('metricHistory.write', e);
    return 0;
  }
}
