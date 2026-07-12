// In-app feedback: submit (any signed-in user) + fetch-all (owner inbox).
// Defensive — never throws to the UI; returns booleans/arrays.
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

const APP_VERSION: string = ((Constants as any)?.expoConfig?.version) ?? ((Constants as any)?.manifest?.version) ?? '';

export interface FeedbackRow {
  id: string; userId: string | null; role: string | null; rating: number | null;
  category: string | null; body: string; appVersion: string | null; createdAt: string;
}

export async function submitAppFeedback(rating: number, category: string, body: string): Promise<boolean> {
  if (!USE_SUPABASE) return true;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return false;
    let role: string | null = null; let tenant: string | null = null;
    try {
      const p = await supabase.from('profiles').select('role, tenant_id').eq('id', uid).single();
      if (p.data) { role = p.data.role ?? null; tenant = p.data.tenant_id ?? null; }
    } catch { /* optional */ }
    const { error } = await supabase.from('feedback').insert({
      user_id: uid, role, tenant_id: tenant, rating, category, body: body.trim(), app_version: APP_VERSION,
    });
    return !error;
  } catch { return false; }
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
