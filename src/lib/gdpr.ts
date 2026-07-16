// GDPR — data access (export) + right-to-erasure (deletion request). The export
// pulls the signed-in user's own rows (RLS scopes each table to them) into a JSON
// bundle. Deletion flags the profile; an operator/edge-function purges the auth
// user. Both are best-effort and OTA-safe.
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
      try { const { data } = await supabase.from(tbl).select('*'); out[tbl] = data ?? []; }
      catch { out[tbl] = 'unavailable'; }
    }
  } catch { /* ignore */ }
  return JSON.stringify(out, null, 2);
}

/** Flag the account for erasure. Returns true if the request was recorded. */
export async function requestAccountDeletion(): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  try { const { error } = await supabase.rpc('request_account_deletion'); return !error; } catch { return false; }
}
