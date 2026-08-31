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
import { checkTenantBrand, stampTenantBrand, signUpWithBrand, brandSignUpMetadata } from '../lib/tenantBrand';

export type Role = 'owner' | 'trainer' | 'client';
export interface AuthUser { id: string; name: string; email: string; role: Role }
export interface SignUpResult { needsConfirmation: boolean }

/**
 * What a session turned out to be.
 *
 * `refused` carries a sentence, not a flag, because every caller of
 * refreshFromSession has a different way of showing it — the welcome screen
 * throws it into its notice card, the phone screen returns it as an OTP
 * failure, and launch has nobody to throw at. A boolean would have each of them
 * writing their own wording for a situation none of them can describe as well
 * as the guard can. Both fields null means signed out.
 */
interface SessionOutcome { user: AuthUser | null; refused: string | null }

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
  signOut: () => void;
  /**
   * Why the last session was refused, when nobody was there to be told.
   *
   * The interactive paths get the sentence thrown or returned to them and show
   * it themselves. A session rehydrated at LAUNCH has no such caller: it is
   * refused before any screen exists, and without this the person would be
   * silently dropped at the welcome screen with no account and no explanation —
   * which reads exactly like being signed out for no reason. Cleared by the
   * next successful sign-in.
   */
  brandNotice: string | null;
  /** Email a reset link. A no-op with no backend connected — there is no real
   *  inbox to send to, and pretending otherwise would have the reader waiting
   *  on mail that was never sent. */
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
  const [brandNotice, setBrandNotice] = useState<string | null>(null);
  // In live mode we don't know the persisted session until we've checked storage.
  const [loading, setLoading] = useState<boolean>(USE_SUPABASE);

  // Build an AuthUser from the current Supabase session (+ profile row if present).
  //
  // Every way into this app converges here — email, phone, a rehydrated session
  // at launch, and social once it is wired — which is why the brand guard sits
  // here rather than at four call sites that would each have to remember it.
  async function refreshFromSession(): Promise<SessionOutcome> {
    const { data: auth } = await supabase.auth.getUser();
    const u = auth.user;
    if (!u) { setUser(null); return { user: null, refused: null }; }

    // Asked BEFORE the user is published to the tree. A provider that set
    // `user` first and signed out a moment later would flash the wrong brand's
    // app on screen, and any effect that fired in that window would fetch the
    // wrong gym's data — the exact thing this is here to prevent.
    const verdict = await checkTenantBrand();
    if (verdict.kind === 'mismatch') {
      // Sign out rather than merely refuse: leaving the session alive would
      // have the next launch rehydrate it and refuse again forever, and the
      // token would still be a valid token for another brand's data.
      try { await sbSignOut(); } catch (e) { reportError('auth.brandGuard.signOut', e); }
      setUser(null);
      setBrandNotice(verdict.message);
      return { user: null, refused: verdict.message };
    }

    let role: Role = (u.user_metadata?.role as Role) || 'client';
    let name = (u.user_metadata?.full_name as string) || nameFromEmail(u.email || '');
    try {
      const prof = await currentProfile();
      if (prof) { role = prof.role; name = prof.full_name || name; }
    } catch { /* profile row may not exist yet — fall back to auth metadata */ }
    const next: AuthUser = { id: u.id, name, email: u.email || '', role };
    setUser(next);
    setBrandNotice(null);
    registerForPush().catch(() => {});
    return { user: next, refused: null };
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
    // Thrown, not returned, because that is how this function already reports
    // a bad password and the welcome screen already prints e.message.
    const { refused } = await refreshFromSession();
    if (refused) throw new Error(refused);
  };

  const signUp = async (name: string, email: string, password: string, role: Role = 'client'): Promise<SignUpResult> => {
    if (!USE_SUPABASE) {
      setUser({ id: 'local', name: name.trim() || nameFromEmail(email), email, role });
      return { needsConfirmation: false };
    }
    // signUpWithBrand is sbSignUp plus `brand` in the metadata — see
    // src/lib/tenantBrand.ts for why the value has to be there at creation and
    // cannot be attached afterwards.
    await signUpWithBrand(email, password, name.trim(), role);
    // If email confirmation is OFF, a session exists now; otherwise it does not.
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      // Belt and braces for an account whose metadata did not survive the trip
      // — a no-op when it did. Before the guard runs, because a brand-new
      // account's own tenant is the one thing it is allowed to stamp.
      await stampTenantBrand();
      const { refused } = await refreshFromSession();
      if (refused) throw new Error(refused);
      return { needsConfirmation: false };
    }
    return { needsConfirmation: true };
  };

  /**
   * Phone sign-in, step one.
   *
   * `shouldCreateUser` is deliberately true: a phone number IS the account
   * here, so a first-time number signing in and a new member signing up are
   * the same gesture. That is the whole point of the change — David Lloyd asks
   * for a number and never mentions whether you already exist.
   *
   * That is also why the brand travels on THIS call rather than on the verify:
   * `shouldCreateUser` means the auth.users row is written here, and metadata
   * that arrives after the row exists is too late for handle_new_user() to see.
   * For a number that already has an account Supabase ignores the data, which
   * is the behaviour wanted — an existing member's brand is not up for revision
   * by whichever app they happened to open.
   */
  const sendPhoneCode = async (e164: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!USE_SUPABASE) return { ok: false, reason: 'Not connected to Repple, so no code was sent.' };
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: true, data: brandSignUpMetadata() } });
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
      // A verify may be the moment an account is created (shouldCreateUser),
      // and the caller cannot tell which it was — so offer the stamp every
      // time and let the server decide. It only ever fills a blank on a
      // one-person tenant; see stampTenantBrand.
      await stampTenantBrand();
      const { refused } = await refreshFromSession();
      // Returned rather than thrown, matching this function's own contract:
      // the phone screen prints `reason` in the card it already has.
      if (refused) return { ok: false, reason: refused };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: phoneAuthError(e?.message) };
    }
  };

  const signInWithProvider = async (provider: 'apple' | 'google') => {
    if (!USE_SUPABASE) {
      setUser({ id: 'local', name: provider === 'apple' ? 'Apple User' : 'Google User', email: `local@${provider}.invalid`, role: 'client' });
      return;
    }
    // Native OAuth needs provider config in Supabase + a deep-link handler.
    // Not wired for Phase 1 — surface a clear message; email sign-in is the path.
    //
    // WHEN IT IS WIRED, the brand needs two lines and neither is optional.
    // signInWithOAuth takes no user-metadata argument — the account is created
    // by the provider callback, with nothing of ours in it — so unlike email
    // and phone this path cannot stamp the tenant at creation. After the
    // session lands: `await stampTenantBrand()` (claims the fresh one-person
    // tenant, no-op otherwise) and then `const { refused } = await
    // refreshFromSession(); if (refused) throw new Error(refused);`. The guard
    // itself needs nothing added — every session already funnels through
    // refreshFromSession, including the one onAuthStateChange picks up.
    throw new Error('Social sign-in is not set up yet — please use email for now.');
  };

  const signOut = () => {
    if (USE_SUPABASE) sbSignOut().catch(() => {});
    setUser(null);
  };

  const sendPasswordReset = async (email: string) => {
    if (!USE_SUPABASE) return; // no backend connected — no real inbox to email
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
    const { refused } = await refreshFromSession();
    // A recovery link opened in the wrong brand's app resets the password and
    // then does not sign them in. Saying so beats leaving them on a screen
    // that has just told them it worked.
    if (refused) throw new Error(refused);
  };

  return (
    <Ctx.Provider value={{ authed: !!user, user, loading, brandNotice, signIn, signUp, signInWithProvider, sendPhoneCode, verifyPhoneCode, signOut, sendPasswordReset, beginPasswordRecoveryWithTokenHash, beginPasswordRecoveryWithCode, beginPasswordRecoveryWithTokens, completePasswordReset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
