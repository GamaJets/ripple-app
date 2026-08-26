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

export async function exportMyData(): Promise<string> {
  const out: Record<string, unknown> = { app: 'Repple', exportedAt: new Date().toISOString() };
  if (!USE_SUPABASE) { out.note = 'Local/demo mode — no server-stored data.'; return JSON.stringify(out, null, 2); }
  try {
    const { data: auth } = await supabase.auth.getUser();
    out.userId = auth?.user?.id ?? null;
    out.email = auth?.user?.email ?? null;
    for (const tbl of TABLES) {
      // The error has to be read, not caught. supabase-js resolves with
      // { data, error } instead of throwing, so the catch below never fires for
      // a rejected read — and a table that could not be read was landing in the
      // export as [], which tells someone their data is not there when the
      // truth is that nobody managed to look. That is the one distinction this
      // file exists to preserve.
      try {
        const { data, error } = await supabase.from(tbl).select('*');
        out[tbl] = error ? 'unavailable' : (data ?? []);
      } catch { out[tbl] = 'unavailable'; }
    }
  } catch { /* ignore */ }
  return JSON.stringify(out, null, 2);
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
