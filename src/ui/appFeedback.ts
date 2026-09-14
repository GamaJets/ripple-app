// In-app feedback: submit (any signed-in user) + fetch-all (owner inbox).
// Defensive — never throws to the UI; returns booleans/arrays.
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { ROW_CAP, capLimit, capped } from '../lib/rowCap';
import { signedInUid } from '../lib/signedInUid';
import { feedbackWriteFate, type FeedbackFate } from '../lib/feedbackSend';

export const APP_VERSION: string = ((Constants as any)?.expoConfig?.version) ?? ((Constants as any)?.manifest?.version) ?? '';

export interface FeedbackRow {
  id: string; userId: string | null; role: string | null; rating: number | null;
  category: string | null; body: string; appVersion: string | null; createdAt: string;
}

/**
 * Send one piece of feedback, and say which of five things happened to it.
 *
 * ── why a fate rather than `{ ok, reason }` ───────────────────────────────
 *
 * The screen had to tell a refusal from a dropped connection and could not:
 * both arrived as `ok: false` with a message beside them, so the only way to
 * separate them was to read the message text, which is not a discrimination,
 * and the lane that owns the screen rightly refused to write one. The evidence
 * that separates them was here all along, in the error's SQLSTATE and status,
 * and it was being thrown away one line after it arrived. `classifyWrite`
 * reads it; src/lib/feedbackSend.ts names the three outcomes it produces and
 * holds the sentence for each.
 *
 * `reason` is gone rather than kept alongside the fate, and that is the fix to
 * the raw Postgres string reaching the alert: `new row violates row-level
 * security policy for table "feedback"` was what a member read. It still goes
 * to `reportError` on every arm below, which is where it is useful and where
 * it belongs. There is now no field on the return value for it to travel in.
 */
export async function submitAppFeedback(rating: number, category: string, body: string): Promise<FeedbackFate> {
  // On-device only: nothing is written, so nothing has been sent. This used to
  // answer `{ ok: true }` — a claimed send over no write at all, which put
  // "Your feedback went to the team" in front of somebody whose words went
  // nowhere. Dead today, because USE_SUPABASE is a hard `true` (src/lib/config),
  // and a trap the moment that constant moves, which is the only reason it is
  // worth getting right. 'undelivered' is the true answer of the five: no
  // server read it, nothing refused it, and nothing is holding it for later.
  if (!USE_SUPABASE) return 'undelivered';
  try {
    // The auth gate, on the shared discrimination rather than a sixth copy of
    // it. `getUser()` RESOLVES on a dropped connection with `{ user: null }`
    // and an error, so the `!uid` that used to stand here told an offline
    // member "You are not signed in." — over a session that was perfectly
    // valid, on the one screen they would have used to report it.
    //
    // Narrowed on `fate`, never on `!who.uid`: the non-null member of UidRead
    // is `string`, which includes '', so `!who.uid` does not narrow inside the
    // failure branch — which is precisely where `fate` is needed.
    const who = await signedInUid('feedback.submit');
    if (who.fate !== null) return who.fate;
    const uid = who.uid;
    let role: string | null = null; let tenant: string | null = null;
    try {
      const p = await supabase.from('profiles').select('role, tenant_id').eq('id', uid).single();
      if (p.data) { role = p.data.role ?? null; tenant = p.data.tenant_id ?? null; }
    } catch { /* optional */ }
    const { data, error } = await supabase.from('feedback').insert({
      user_id: uid, role, tenant_id: tenant,
      // null, never 0 — see the note on this function.
      rating: rating >= 1 && rating <= 5 ? rating : null,
      category, body: body.trim(), app_version: APP_VERSION,
    }).select('id');
    // Report WHY, still, and now the caller is told which why. The raw message
    // goes here and only here.
    if (error) reportError('feedback.submit', error);
    return feedbackWriteFate(error, data ? data.length : null);
  } catch (e: any) {
    reportError('feedback.submit', e);
    // A throw returned nothing to count, so `rows` is null rather than 0 — the
    // difference between "nobody answered" and "the statement ran and touched
    // nothing", which is the difference between 'undelivered' and 'refused'.
    return feedbackWriteFate({ code: e?.code ?? null, status: e?.status ?? null, message: e?.message ?? null }, null);
  }
}

// The bare-array wrapper that used to live here — `fetchAllFeedback`, returning
// `page && page.rows` — is gone, and its last caller is why.
//
// It existed to leave two screens untouched when the paged read was introduced,
// on the understanding that a screen wanting to know whether it held the whole
// inbox would call `fetchAllFeedbackPage` instead. Both screens count and
// average these rows, so both of them wanted exactly that, and the second one
// (app/(owner)/ops.tsx) went on quietly discarding the flag: under a capped read
// it held a thousand-row prefix and printed "All resolved" over tickets it had
// never seen. A convenience wrapper whose only effect is to drop the one fact
// its callers need is not a convenience.

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
