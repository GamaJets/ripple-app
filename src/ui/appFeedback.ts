// In-app feedback: submit (any signed-in user) + fetch-all (owner inbox).
// Defensive — never throws to the UI; returns booleans/arrays.
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';

const APP_VERSION: string = ((Constants as any)?.expoConfig?.version) ?? ((Constants as any)?.manifest?.version) ?? '';

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

export async function fetchAllFeedback(): Promise<FeedbackRow[]> {
  if (!USE_SUPABASE) return [];
  try {
    const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false });
    return (data ?? []).map((r: any) => ({
      id: String(r.id), userId: r.user_id, role: r.role, rating: r.rating,
      category: r.category, body: r.body, appVersion: r.app_version, createdAt: r.created_at,
    }));
  } catch { return []; }
}

export interface AppErrorRow { id: string; message: string; platform: string | null; appVersion: string | null; createdAt: string; }

// Owner-only: recent captured crashes/errors (RLS restricts to the owner).
export async function fetchAppErrors(limit = 20): Promise<AppErrorRow[]> {
  if (!USE_SUPABASE) return [];
  try {
    const { data } = await supabase.from('app_errors').select('id, message, platform, app_version, created_at').order('created_at', { ascending: false }).limit(limit);
    return (data ?? []).map((r: any) => ({ id: String(r.id), message: r.message, platform: r.platform, appVersion: r.app_version, createdAt: r.created_at }));
  } catch { return []; }
}
