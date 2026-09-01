// Supabase client. Reads keys from Expo public env at build time.
// Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in a .env file
// (see .env.example) — never commit real keys.
// (url-polyfill not needed on RN 0.81 / SDK 54 — URL is built in)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { observedFetch } from './reachability';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(url, anon, {
  // Every HTTP call this client makes, reporting whether it reached us.
  //
  // Here and not in each provider, because "is there a signal" is one fact
  // about the device and it must not be able to be true on the screen that
  // remembered to ask and false on the screen that did not. src/lib/reachability.ts
  // makes the argument for why a request to OUR host is the only instrument
  // that answers the question the callers are actually asking — a captive
  // portal is an association with no server behind it, and NetInfo calls that
  // connected.
  //
  // `observedFetch` returns the response untouched and re-throws errors
  // unchanged; supabase-js cannot tell it is there. Realtime is a WebSocket and
  // does not come through here, which is why the probe in
  // src/ui/reachability.tsx still exists.
  // The inner call is a lambda rather than a reference to `fetch` so the global
  // is resolved per request: a polyfill installed after this module evaluates
  // would otherwise be bypassed for the life of the process.
  global: { fetch: observedFetch((input, init) => fetch(input, init)) as any },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE, not implicit: recovery/magic-link redirects then carry a `code`
    // query param instead of an `#access_token=...` fragment. Fragments get
    // silently dropped when a server-side redirect crosses from https:// to
    // a custom URL scheme (repple://) on both iOS and Android, which broke
    // password reset — the app always saw a token-less deep link. Query
    // params survive that hop intact.
    flowType: 'pkce',
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

/** Establish a session from the recovery-link's PKCE `code` (the deep link
 * back into the app) — kept as a fallback path; the primary path since this
 * fix is `verifyRecoveryToken` below (see its doc comment for why). */
export async function exchangeRecoveryCode(code: string) {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

/** Fallback: establish a session directly from access/refresh tokens, for the
 * rare deep link that still arrives in the older implicit-grant shape. */
export async function setSessionFromTokens(accessToken: string, refreshToken: string) {
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
}

/** Establish a session straight from the recovery email's raw token hash —
 * the PRIMARY path as of the 2026-08-10 fix. The email link now deep-links
 * directly into the app (`repple://reset-password?token_hash=...&type=recovery`)
 * instead of routing through Supabase's `/auth/v1/verify` endpoint first. That
 * endpoint auto-redeems the one-time token on a bare GET, which meant an email
 * security scanner prefetching the link (common with Gmail-hosted mail) could
 * silently burn the token before the user ever tapped it. A `repple://` URL
 * can't be opened by an https-only bot, so the token can only be consumed by
 * this call, which only runs when a real device opens the app. */
export async function verifyRecoveryToken(tokenHash: string, email: string) {
  const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash, email });
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
