// Referral attribution. A new user can enter a friend's code at signup; we record
// (referred_user, code) once they have a session. The referrer's screen counts how
// many joined with their code via a security-definer RPC. Best-effort + OTA-safe.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_KEY = 'repple.pendingRef';

/** Record the signed-in user as referred by `code` (idempotent per user). */
export async function recordReferral(code: string): Promise<void> {
  const c = (code || '').trim();
  if (!USE_SUPABASE || !c) return;
  try { await supabase.rpc('record_referral', { p_code: c }); } catch { /* ignore */ }
}

/** Stash a code entered during a confirm-by-email signup, to record on first sign-in. */
export async function stashPendingReferral(code: string): Promise<void> {
  const c = (code || '').trim();
  if (!c) return;
  try { await AsyncStorage.setItem(PENDING_KEY, c); } catch { /* ignore */ }
}

/** After a successful sign-in, record any code stashed at signup, then clear it. */
export async function flushPendingReferral(): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const c = await AsyncStorage.getItem(PENDING_KEY);
    if (c) { await recordReferral(c); await AsyncStorage.removeItem(PENDING_KEY); }
  } catch { /* ignore */ }
}

/**
 * How many users have joined with `code` (the caller's own code).
 *
 * NULL when it could not be read. It used to return 0 for that, which the
 * screen renders identically to "nobody has used your code" — so a failed read
 * told somebody their referrals had come to nothing. The screen's own header
 * says "nothing here is invented"; this is the one place it was.
 */
export async function referralCount(code: string): Promise<number | null> {
  const c = (code || '').trim();
  if (!USE_SUPABASE || !c) return null;
  try {
    const { data, error } = await supabase.rpc('referral_count', { p_code: c });
    if (error) return null;
    return typeof data === 'number' ? data : null;
  } catch { return null; }
}
