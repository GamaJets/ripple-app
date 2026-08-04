// Supabase client. Reads keys from Expo public env at build time.
// Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in a .env file
// (see .env.example) — never commit real keys.
// (url-polyfill not needed on RN 0.81 / SDK 54 — URL is built in)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ── Auth helpers ─────────────────────────────────────────────────────────────
// Thin wrappers so screens don't import the Supabase client directly.
export type Role = 'owner' | 'trainer' | 'client';

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email: string, password: string, fullName: string, role: Role) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: fullName, role } },
  });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Email a password-reset link. Always resolves without leaking whether the
 * email is registered — Supabase itself stays silent on unknown addresses. */
export async function sendPasswordReset(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/** Establish a session from the recovery-link tokens (deep link back into the
 * app), so `updatePassword` below has someone to act on. */
export async function setSessionFromTokens(accessToken: string, refreshToken: string) {
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
}

/** Set a new password for the currently-recovered session. */
export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Current signed-in user's profile row (role, tenant, name), or null. */
export async function currentProfile() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('profiles').select('id, role, tenant_id, full_name, avatar').eq('id', auth.user.id).single();
  if (error) throw error;
  return data as { id: string; role: Role; tenant_id: string | null; full_name: string | null; avatar: string | null };
}

/** Subscribe to auth state changes (login/logout). Returns an unsubscribe fn. */
export function onAuthChange(cb: (signedIn: boolean) => void) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(!!session));
  return () => data.subscription.unsubscribe();
}
