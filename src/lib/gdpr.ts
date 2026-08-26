// GDPR — data access (export) + right-to-erasure (deletion request). The export
// pulls the signed-in user's own rows (RLS scopes each table to them) into a JSON
// bundle. Deletion flags the profile; an operator/edge-function purges the auth
// user. Both are best-effort and OTA-safe.
//
// The flag is also readable and reversible: web/delete-account.html promises a
// request can be withdrawn until it is actioned, so this file exposes the read
// (fetchDeletionRequestedAt) and the undo (withdrawAccountDeletion) alongside
// the request. The read is the one call here that throws instead of swallowing
// — a screen that cannot tell "no request" from "could not check" would show
// somebody awaiting erasure the ordinary state.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';

const TABLES = ['profiles', 'clients', 'workouts', 'food_logs', 'measurements', 'check_ins', 'habit_logs', 'scans', 'messages', 'coach_nutrition', 'assigned_programs', 'class_bookings', 'referrals', 'feedback'];

/**
 * Everything this account holds, as JSON — and an honest statement of whether
 * that is actually everything.
 *
 * THE BUG THIS REPLACES was the worst instance of a family that has bitten this
 * codebase six times. It read each table with
 *
 *     const { data } = await supabase.from(tbl).select('*');
 *     out[tbl] = data ?? [];
 *
 * and no `.error` check. supabase-js RESOLVES on a database error, so an RLS
 * denial or a 500 arrived as `data: null`, fell through `?? []`, and was
 * written into the file as an EMPTY ARRAY. The `catch` beside it only fired if
 * the network died outright.
 *
 * So a member exported their data, opened a file that said `"workouts": []`,
 * and reasonably concluded they had none. That is not a cosmetic failure here:
 * web/delete-account.html tells people to take a copy FIRST and says plainly
 * that afterwards there is nothing left to export. The export is the last
 * record they will ever have of their own training, and it was capable of
 * quietly claiming they had never trained.
 *
 * Now every table is checked, and a table that could not be read says so in
 * the file itself rather than looking empty. The bundle carries a `complete`
 * flag and a `failed` list so the caller — and the person reading the JSON
 * years later — can tell a full record from a partial one.
 */
export interface ExportResult {
  json: string;
  /** True only when every table was read. */
  complete: boolean;
  /** Tables that could not be read, with the reason. Empty when complete. */
  failed: { table: string; reason: string }[];
}

export async function exportMyDataDetailed(): Promise<ExportResult> {
  const out: Record<string, unknown> = { app: 'Repple', exportedAt: new Date().toISOString() };
  if (!USE_SUPABASE) {
    out.note = 'Local/demo mode — no server-stored data.';
    out.complete = true;
    return { json: JSON.stringify(out, null, 2), complete: true, failed: [] };
  }

  const failed: { table: string; reason: string }[] = [];

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) failed.push({ table: 'account', reason: authErr.message });
  out.userId = auth?.user?.id ?? null;
  out.email = auth?.user?.email ?? null;

  for (const tbl of TABLES) {
    try {
      const { data, error } = await supabase.from(tbl).select('*');
      // The check that was missing. Without it a refusal becomes [].
      if (error) throw error;
      out[tbl] = data ?? [];
    } catch (e: any) {
      const reason = e?.message ? String(e.message) : 'could not be read';
      failed.push({ table: tbl, reason });
      // Never `[]`. An object cannot be mistaken for "you had none of these",
      // and it survives into the file somebody opens in a year.
      out[tbl] = { error: 'NOT EXPORTED — this table could not be read', reason };
    }
  }

  const complete = failed.length === 0;
  out.complete = complete;
  if (!complete) {
    out.warning =
      'THIS EXPORT IS INCOMPLETE. ' + failed.length + ' of ' + TABLES.length +
      ' tables could not be read and are marked with an "error" object rather than data. ' +
      'Do not treat this file as a full copy of your account, and do not delete your ' +
      'account on the strength of it. Try again, or email support@repplefitness.com.';
    out.notExported = failed;
  }
  return { json: JSON.stringify(out, null, 2), complete, failed };
}

/** Back-compatible wrapper: the JSON only. Prefer exportMyDataDetailed, which
 *  can tell the caller the file is partial — a screen that cannot say so will
 *  hand somebody an incomplete record and call it their data. */
export async function exportMyData(): Promise<string> {
  return (await exportMyDataDetailed()).json;
}

/** Flag the account for erasure. Returns true if the request was recorded. */
export async function requestAccountDeletion(): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  try { const { error } = await supabase.rpc('request_account_deletion'); return !error; } catch { return false; }
}

/**
 * When the signed-in person asked to be erased, or null if they have not.
 *
 * Throws if the read fails — deliberately unlike the two calls around it, which
 * swallow. A swallowed failure here would come back as "no pending request" and
 * show someone who has already asked to be deleted the ordinary state, which is
 * the one wrong answer this file must never give. supabase-js RESOLVES on a
 * database error rather than rejecting, so `.error` is what does the work; a
 * try/catch alone would only cover the network dying. The caller keeps its own
 * "not loaded" state and says so on screen.
 */
export async function fetchDeletionRequestedAt(): Promise<string | null> {
  if (!USE_SUPABASE) return null;
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not signed in.');
  const { data, error } = await supabase.from('profiles').select('deletion_requested_at').eq('id', uid).maybeSingle();
  if (error) throw error;
  return (data as { deletion_requested_at?: string | null } | null)?.deletion_requested_at ?? null;
}

/** Take back a pending erasure request. Returns true if the flag was cleared. */
export async function withdrawAccountDeletion(): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  try { const { error } = await supabase.rpc('withdraw_account_deletion'); return !error; } catch { return false; }
}
