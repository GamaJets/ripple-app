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
  updatePassword as sbUpdatePassword,
} from '../lib/supabase';

export type Role = 'owner' | 'trainer' | 'client';
export interface AuthUser { id: string; name: string; email: string; role: Role }
export interface SignUpResult { needsConfirmation: boolean }

// One shared Supabase identity signs in to all 3 portals (Client / Trainer /
// Platform Owner) — the portal picker on `/` just routes by role, it isn't a
// separate credential store. So a single reset-password flow covers everyone.
const RESET_REDIRECT_URL = 'repple://reset-password';

interface AuthValue {
  authed: boolean;
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, role?: Role) => Promise<SignUpResult>;
  signInWithProvider: (provider: 'apple' | 'google') => Promise<void>;
  demo: boolean;
  enterDemo: () => void;
  signOut: () => void;
  /** Email a reset link. In demo mode this is a no-op (there's no real inbox). */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Exchange the recovery-link's PKCE code (from the `repple://reset-password`
   * deep link) for a live session — the primary, reliable path. */
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
      try { await refreshFromSession(); } catch { if (active) setUser(null); }
      finally { if (active) setLoading(false); }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      if (!session) setUser(null);
      else refreshFromSession().catch(() => {});
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
    await sbSendPasswordReset(email, RESET_REDIRECT_URL);
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
    <Ctx.Provider value={{ authed: !!user, user, loading, demo, enterDemo, signIn, signUp, signInWithProvider, signOut, sendPasswordReset, beginPasswordRecoveryWithCode, beginPasswordRecoveryWithTokens, completePasswordReset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
