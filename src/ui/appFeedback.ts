// In-app feedback: submit (any signed-in user) + fetch-all (owner inbox).
// Defensive — never throws to the UI; returns booleans/arrays.
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { ROW_CAP, capLimit, capped } from '../lib/rowCap';

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
 *
 * Kept returning a bare array so the two screens reading it are untouched. It is
 * `fetchAllFeedbackPage` underneath, and a screen that wants to know whether it
 * is holding the whole inbox should call that instead — see the note there.
 */
export async function fetchAllFeedback(): Promise<FeedbackRow[] | null> {
  const page = await fetchAllFeedbackPage();
  return page && page.rows;
}

/**
 * The same read, plus whether it is the whole inbox.
 *
 * This is every piece of feedback anybody has ever sent, unfiltered — one row
 * per submission across every tester and every release — so it is the read in
 * this file most certain to cross a thousand rows, and it had no limit on it at
 * all. The screens above it count the rows and average the ratings, which is
 * exactly what a truncated read must not be used for: "4.6 stars" over the most
 * recent thousand submissions is not a lower figure than the real average, it is
 * a different one, and it is the number a release decision gets made on.
 */
export async function fetchAllFeedbackPage(): Promise<{ rows: FeedbackRow[]; truncated: boolean } | null> {
  if (!USE_SUPABASE) return { rows: [], truncated: false };
  try {
    // Newest first was already the order and is the end that matters during a
    // test round; the cap decides only how far back the inbox reaches.
    const { data, error } = await supabase.from('feedback').select('*')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
    if (error) { reportError('feedback.fetchAll', error); return null; }
    if (!data) return null;
    const page = capped(data);
    return {
      rows: page.rows.map((r: any) => ({
        id: String(r.id), userId: r.user_id, role: r.role, rating: r.rating,
        category: r.category, body: r.body, appVersion: r.app_version, createdAt: r.created_at,
      })),
      truncated: page.truncated,
    };
  } catch (e) { reportError('feedback.fetchAll', e); return null; }
}

export interface AppErrorRow { id: string; message: string; platform: string | null; appVersion: string | null; createdAt: string; }

// Owner-only: recent captured crashes/errors (RLS restricts to the owner).
/** Recent captured crashes. `null` means the list could not be read — which is
 *  not the same as there having been no crashes, and reads very differently. */
export async function fetchAppErrors(limit = 20): Promise<AppErrorRow[] | null> {
  if (!USE_SUPABASE) return [];
  try {
    // Deliberately bounded rather than capped: the caller names how many recent
    // crashes it wants and the screen is headed "recent", so falling short of the
    // whole table is the point of the call and not a truncation to report.
    // ROW_CAP is a backstop on the caller, not on the data — nothing in this
    // codebase asks for more, and a screen that one day does should be paginating
    // rather than widening this.
    const { data, error } = await supabase.from('app_errors')
      .select('id, message, platform, app_version, created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(1, limit), ROW_CAP));
    if (error) { reportError('feedback.fetchAppErrors', error); return null; }
    if (!data) return null;
    return data.map((r: any) => ({ id: String(r.id), message: r.message, platform: r.platform, appVersion: r.app_version, createdAt: r.created_at }));
  } catch (e) { reportError('feedback.fetchAppErrors', e); return null; }
}
