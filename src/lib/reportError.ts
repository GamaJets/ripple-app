// Report a non-fatal failure to Supabase `app_errors`, where the owner can read
// it (ErrorBoundary already does this for render crashes; this covers the rest).
//
// Why this exists: the app has ~170 `catch { /* ignore */ }` sites. Swallowing is
// usually the right call for the USER — a failed background sync shouldn't throw a
// modal at them — but it also meant nobody could ever see WHY something misbehaved.
// Whoop failing to connect surfaced as "check the vendor secret is set"; a coach's
// name silently reverting surfaced as nothing at all. Both were diagnosable only by
// reading source. Now the swallow still happens, but it leaves a trace.
//
// Rules: never throws, never blocks, never shown to the user.
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';

let APP_VERSION = 'unknown';
try { APP_VERSION = require('expo-constants').default?.expoConfig?.version ?? 'unknown'; } catch { /* not available */ }

// A failing call inside a useEffect can retry on every render. Cap the damage:
// the same context+message is reported at most once a minute, and a single app
// session never sends more than SESSION_CAP rows.
const WINDOW_MS = 60_000;
const SESSION_CAP = 50;
const lastSent = new Map<string, number>();
let sentThisSession = 0;

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err).slice(0, 300); } catch { return String(err); }
}

/**
 * @param context where it happened, e.g. 'clientData.hydrate' or 'whoop.connect'.
 *        Keep it stable — it is the grouping key.
 * @param err     the caught value (Error, string, anything).
 * @param extra   optional key/values appended to the message for triage.
 */
export function reportError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    if (!USE_SUPABASE) return;
    if (sentThisSession >= SESSION_CAP) return;

    const detail = describe(err);
    const key = context + '|' + detail;
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev != null && now - prev < WINDOW_MS) return;
    lastSent.set(key, now);
    sentThisSession += 1;

    let suffix = '';
    if (extra) {
      try {
        suffix = ' ' + Object.entries(extra)
          .map(([k, v]) => k + '=' + (typeof v === 'string' ? v : JSON.stringify(v)))
          .join(' ');
      } catch { /* skip extras */ }
    }

    const message = ('[' + context + '] ' + detail + suffix).slice(0, 500);
    const stack = err instanceof Error ? String(err.stack || '').slice(0, 4000) : null;

    supabase.auth.getUser().then(({ data }) => {
      supabase.from('app_errors').insert({
        user_id: data?.user?.id ?? null,
        message,
        stack,
        platform: Platform.OS,
        app_version: APP_VERSION,
      }).then(() => {}, () => {});
    }, () => {
      // Not signed in (or auth unavailable) — the insert policy allows a null
      // user_id, so the report is still worth sending.
      supabase.from('app_errors').insert({
        user_id: null, message, stack, platform: Platform.OS, app_version: APP_VERSION,
      }).then(() => {}, () => {});
    });
  } catch { /* reporting must never break the caller */ }
}
