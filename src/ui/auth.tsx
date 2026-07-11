// Auth state (Phase 1). MOCK today: starts signed-out; sign-in/up set a local
// session so the whole gated flow works on-device. To go live, replace the three
// method bodies with Supabase calls (supabase.auth.signInWithPassword / signUp /
// signInWithOAuth) and hydrate the session on mount — no screen changes needed.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface AuthUser { name: string; email: string }

interface AuthValue {
  authed: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithProvider: (provider: 'apple' | 'google') => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const signIn = async (email: string, _password: string) => {
    // supabase.auth.signInWithPassword({ email, password })
    setUser({ name: email.split('@')[0] || 'Athlete', email });
  };
  const signUp = async (name: string, email: string, _password: string) => {
    // supabase.auth.signUp({ email, password }) then insert profile row
    setUser({ name: name.trim() || email.split('@')[0] || 'Athlete', email });
  };
  const signInWithProvider = async (provider: 'apple' | 'google') => {
    // supabase.auth.signInWithOAuth({ provider })
    setUser({ name: provider === 'apple' ? 'Apple User' : 'Google User', email: `demo@${provider}.com` });
  };
  const signOut = () => setUser(null);

  return <Ctx.Provider value={{ authed: !!user, user, signIn, signUp, signInWithProvider, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
