// In-app feedback: submit (any signed-in user) + fetch-all (owner inbox).
// Defensive — never throws to the UI; returns booleans/arrays.
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';

export const APP_VERSION: string = ((Constants as any)?.expoConfig?.version) ?? ((Constants as any)?.manifest?.version) ?? '';

export interface FeedbackRow {
  id: string; userId: string | null; role: string | null; rating: number | null;
  category: string | null; body: string; appVersion: string | null; createdAt: string;
}

export async function submitAppFeedback(rating: number, category: string, body: string): Promise<{ ok: boolean; reason?: string }> {
  if (!USE_SUPABASE) return { ok: true };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { ok: false, reason: 'You are not signed in.' };
    let role: string | null = null; let tenant: string | null = null;
    try {
      const p = await supabase.from('profiles').select('role, tenant_id').eq('id', uid).single();
      if (p.data) { role = p.data.role ?? null; tenant = p.data.tenant_id ?? null; }
    } catch { /* optional */ }
    const { error } = await supabase.from('feedback').insert({
      user_id: uid, role, tenant_id: tenant,
      // null, never 0 — see the note on this function.
      rating: rating >= 1 && rating <= 5 ? rating : null,
      category, body: body.trim(), app_version: APP_VERSION,
    });
    // Report WHY. A bare false meant every failure was described to the user
    // as a connection problem — including a rating of 0 being refused by a
    // check constraint, which no amount of reconnecting fixes.
    if (error) { reportError('feedback.submit', error); return { ok: false, reason: error.message }; }
    return { ok: true };
  } catch (e: any) { reportError('feedback.submit', e); return { ok: false, reason: e?.message }; }
}

/**
 * Every tester's feedback, newest first.
 *
 * **`null` means the inbox could not be read.** `[]` means it is genuinely
 * empty. The screen prints "No feedback yet. It shows up here as testers send
 * it from inside the app." for an empty list — a confident, specific sentence
 * that was also what a refused read produced. During a TestFlight round that is
 * the worst possible thing to be wrong about: it says the testers are silent
 * when what actually happened is that we could not hear them.
 */
export async function fetchAllFeedback(): Promise<FeedbackRow[] | null> {
  if (!USE_SUPABASE) return [];
  try {
    const { data, error } = await supabase.from('feedback').select('*').order('created_at', { ascending: false });
    if (error) { reportError('feedback.fetchAll', error); return null; }
    if (!data) return null;
    return data.map((r: any) => ({
      id: String(r.id), userId: r.user_id, role: r.role, rating: r.rating,
      category: r.category, body: r.body, appVersion: r.app_version, createdAt: r.created_at,
    }));
  } catch (e) { reportError('feedback.fetchAll', e); return null; }
}

export interface AppErrorRow { id: string; message: string; platform: string | null; appVersion: string | null; createdAt: string; }

// Owner-only: recent captured crashes/errors (RLS restricts to the owner).
/** Recent captured crashes. `null` means the list could not be read — which is
 *  not the same as there having been no crashes, and reads very differently. */
export async function fetchAppErrors(limit = 20): Promise<AppErrorRow[] | null> {
  if (!USE_SUPABASE) return [];
  try {
    const { data, error } = await supabase.from('app_errors').select('id, message, platform, app_version, created_at').order('created_at', { ascending: false }).limit(limit);
    if (error) { reportError('feedback.fetchAppErrors', error); return null; }
    if (!data) return null;
    return data.map((r: any) => ({ id: String(r.id), message: r.message, platform: r.platform, appVersion: r.app_version, createdAt: r.created_at }));
  } catch (e) { reportError('feedback.fetchAppErrors', e); return null; }
}
