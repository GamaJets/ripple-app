// Auth state (Phase 1). Mock when USE_SUPABASE is false (any email/password
// works, on-device only). When true, real Supabase auth: sign-up creates an
// account + profile row (via the on_auth_user_created trigger), sign-in
// establishes a persisted session (AsyncStorage), and the session is rehydrated
// on launch. Screens are unchanged — they just read { authed, user }.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { USE_SUPABASE } from '../lib/config';
import { registerForPush } from './pushNotifications';
import {
  supabase,
  signIn as sbSignIn,
  signUp as sbSignUp,
  signOut as sbSignOut,
  currentProfile,
  sendPasswordReset as sbSendPasswordReset,
  exchangeRecoveryCode as sbExchangeRecoveryCode,
  setSessionFromTokens as sbSetSessionFromTokens,
  verifyRecoveryToken as sbVerifyRecoveryToken,
  updatePassword as sbUpdatePassword,
} from '../lib/supabase';
import { resetPasswordUrl } from '../lib/deepLink';
import { reportError } from '../lib/reportError';
import { phoneAuthError } from '../lib/phone';

export type Role = 'owner' | 'trainer' | 'client';
export interface AuthUser { id: string; name: string; email: string; role: Role }
export interface SignUpResult { needsConfirmation: boolean }

// One shared Supabase identity signs in to all 3 portals (Client / Trainer /
// Platform Owner) — the portal picker on `/` just routes by role, it isn't a
// separate credential store. So a single reset-password flow covers everyone.
// Built per app rather than written out, so a reset requested from Repple
// Coach comes back to Repple Coach. See src/lib/deepLink.ts.
const resetRedirectUrl = () => resetPasswordUrl();

interface AuthValue {
  authed: boolean;
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, role?: Role) => Promise<SignUpResult>;
  signInWithProvider: (provider: 'apple' | 'google') => Promise<void>;
  /**
   * Text a one-time code to an E.164 number. Resolves with what to say next.
   *
   * `ok: false` carries a reason the reader can act on — an SMS that never
   * arrives is the single most common support message any OTP flow gets, and
   * the flow must never claim to have sent one it did not.
   */
  sendPhoneCode: (e164: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Exchange a code for a session. Only `ok: true` means they are signed in. */
  verifyPhoneCode: (e164: string, code: string, name?: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  demo: boolean;
  enterDemo: () => void;
  signOut: () => void;
  /** Email a reset link. In demo mode this is a no-op (there's no real inbox). */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Establish a session from the recovery email's raw token hash — the
   * primary path (see verifyRecoveryToken's doc comment in supabase.ts). */
  beginPasswordRecoveryWithTokenHash: (tokenHash: string, email: string) => Promise<void>;
  /** Fallback: exchange the recovery-link's PKCE code for a live session. */
  beginPasswordRecoveryWithCode: (code: string) => Promise<void>;
  /** Fallback for a deep link that arrives with tokens instead of a code. */
  beginPasswordRecoveryWithTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  /** Set the new password on the just-recovered session and refresh `user`. */
  completePasswordReset: (newPassword: string) => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

const nameFromEmail = (email: string) => email.split('@')[0] || 'Athlete';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // In live mode we don't know the persisted session until we've checked storage.
  const [loading, setLoading] = useState<boolean>(USE_SUPABASE);
  const [demo, setDemo] = useState(false);

  // Build an AuthUser from the current Supabase session (+ profile row if present).
  async function refreshFromSession(): Promise<AuthUser | null> {
    const { data: auth } = await supabase.auth.getUser();
    const u = auth.user;
    if (!u) { setUser(null); return null; }
    let role: Role = (u.user_metadata?.role as Role) || 'client';
    let name = (u.user_metadata?.full_name as string) || nameFromEmail(u.email || '');
    try {
      const prof = await currentProfile();
      if (prof) { role = prof.role; name = prof.full_name || name; }
    } catch { /* profile row may not exist yet — fall back to auth metadata */ }
    const next: AuthUser = { id: u.id, name, email: u.email || '', role };
    setUser(next);
    registerForPush().catch(() => {});
    return next;
  }

  // Live: hydrate any persisted session on launch, and react to auth changes.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let active = true;
    (async () => {
      try { await refreshFromSession(); } catch (e) { reportError('auth.restoreSession', e); if (active) setUser(null); }
      finally { if (active) setLoading(false); }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      if (!session) setUser(null);
      else refreshFromSession().catch((e) => reportError('auth.onAuthStateChange', e));
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!USE_SUPABASE) { setUser({ id: 'local', name: nameFromEmail(email), email, role: 'client' }); return; }
    await sbSignIn(email, password);
    await refreshFromSession();
  };

  const signUp = async (name: string, email: string, password: string, role: Role = 'client'): Promise<SignUpResult> => {
    if (!USE_SUPABASE) {
      setUser({ id: 'local', name: name.trim() || nameFromEmail(email), email, role });
      return { needsConfirmation: false };
    }
    await sbSignUp(email, password, name.trim(), role);
    // If email confirmation is OFF, a session exists now; otherwise it does not.
    const { data } = await supabase.auth.getSession();
    if (data.session) { await refreshFromSession(); return { needsConfirmation: false }; }
    return { needsConfirmation: true };
  };

  /**
   * Phone sign-in, step one.
   *
   * `shouldCreateUser` is deliberately true: a phone number IS the account
   * here, so a first-time number signing in and a new member signing up are
   * the same gesture. That is the whole point of the change — David Lloyd asks
   * for a number and never mentions whether you already exist.
   */
  const sendPhoneCode = async (e164: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!USE_SUPABASE) return { ok: false, reason: 'Not connected to Repple, so no code was sent.' };
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: true } });
      if (error) { reportError('auth.sendPhoneCode', error); return { ok: false, reason: phoneAuthError(error.message) }; }
      return { ok: true };
    } catch (e: any) {
      reportError('auth.sendPhoneCode', e);
      return { ok: false, reason: phoneAuthError(e?.message) };
    }
  };

  /**
   * Phone sign-in, step two.
   *
   * `name` is only used the first time a number is seen — an existing member
   * verifying on a new phone must not have their profile name overwritten by
   * whatever the sign-in screen happened to have in its field.
   */
  const verifyPhoneCode = async (e164: string, code: string, name?: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!USE_SUPABASE) return { ok: false, reason: 'Not connected to Repple, so the code could not be checked.' };
    try {
      const { data, error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
      if (error) return { ok: false, reason: phoneAuthError(error.message) };
      if (!data?.session) {
        // verifyOtp resolving without a session is not success. Saying "signed
        // in" here would drop somebody into an app with no session behind it.
        reportError('auth.verifyPhoneCode', new Error('verifyOtp returned no session'));
        return { ok: false, reason: 'The code was accepted but the sign-in did not complete. Try once more.' };
      }
      const wanted = (name || '').trim();
      if (wanted) {
        // Only fills a blank. See the note above on not overwriting a name.
        try {
          // no-error-ok: an unreadable profile leaves the name unset, which is the same outcome as it already having one — the sign-in itself has already succeeded either way
          const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', data.session.user.id).maybeSingle();
          if (!((prof as any)?.full_name || '').trim()) {
            await supabase.from('profiles').update({ full_name: wanted }).eq('id', data.session.user.id);
          }
        } catch (e) { reportError('auth.verifyPhoneCode.name', e); }
      }
      await refreshFromSession();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: phoneAuthError(e?.message) };
    }
  };

  const signInWithProvider = async (provider: 'apple' | 'google') => {
    if (!USE_SUPABASE) {
      setUser({ id: 'local', name: provider === 'apple' ? 'Apple User' : 'Google User', email: `demo@${provider}.com`, role: 'client' });
      return;
    }
    // Native OAuth needs provider config in Supabase + a deep-link handler.
    // Not wired for Phase 1 — surface a clear message; email sign-in is the path.
    throw new Error('Social sign-in is not set up yet — please use email for now.');
  };

  const enterDemo = () => {
    // Guest/demo entry: no Supabase session, so every provider falls back to its
    // rich in-memory sample data. Great for trial + App Store review (no login).
    setDemo(true);
    setUser({ id: 'demo-guest', name: 'Demo User', email: 'demo@repple.app', role: 'client' });
  };

  const signOut = () => {
    if (USE_SUPABASE) sbSignOut().catch(() => {});
    setUser(null); setDemo(false);
  };

  const sendPasswordReset = async (email: string) => {
    if (!USE_SUPABASE) return; // demo mode — no real inbox to email
    await sbSendPasswordReset(email, resetRedirectUrl());
  };

  const beginPasswordRecoveryWithTokenHash = async (tokenHash: string, email: string) => {
    await sbVerifyRecoveryToken(tokenHash, email);
  };

  const beginPasswordRecoveryWithCode = async (code: string) => {
    await sbExchangeRecoveryCode(code);
  };

  const beginPasswordRecoveryWithTokens = async (accessToken: string, refreshToken: string) => {
    await sbSetSessionFromTokens(accessToken, refreshToken);
  };

  const completePasswordReset = async (newPassword: string) => {
    await sbUpdatePassword(newPassword);
    await refreshFromSession();
  };

  return (
    <Ctx.Provider value={{ authed: !!user, user, loading, demo, enterDemo, signIn, signUp, signInWithProvider, sendPhoneCode, verifyPhoneCode, signOut, sendPasswordReset, beginPasswordRecoveryWithTokenHash, beginPasswordRecoveryWithCode, beginPasswordRecoveryWithTokens, completePasswordReset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
