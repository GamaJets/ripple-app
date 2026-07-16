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

/** How many users have joined with `code` (the caller's own code). */
export async function referralCount(code: string): Promise<number> {
  const c = (code || '').trim();
  if (!USE_SUPABASE || !c) return 0;
  try { const { data } = await supabase.rpc('referral_count', { p_code: c }); return typeof data === 'number' ? data : 0; } catch { return 0; }
}
