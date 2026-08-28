// The same Supabase project the phone apps use, reached from the browser.
//
// There is no second permission model here. Every table already carries
// row-level policies, and the anon key grants nothing on its own — what a
// signed-in person can read is decided in the database, by the same policies
// that govern the apps. That is the whole reason the web console can be built
// against this project directly rather than through a bespoke API.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly at import rather than producing a client that 401s on every
  // call and looks like an auth bug.
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy them from the repo root .env (the EXPO_PUBLIC_ equivalents) into studio-web/.env.local.',
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export type Role = 'client' | 'trainer' | 'owner';

export interface Me {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role | null;
  tenantId: string | null;
  /**
   * True when the profile could not be READ, as opposed to not existing.
   *
   * These two collapsed into `role: null` and every screen took the same
   * branch, so an RLS hiccup told the actual gym owner "Not your console —
   * you are signed in without a role". A refused read is not a statement
   * about who somebody is.
   */
  roleUnknown: boolean;
}

/** Who is signed in, and what the database says they are. */
export async function loadMe(): Promise<Me | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, role, tenant_id')
    .eq('id', user.id)
    .single();

  // Three outcomes, not two.
  //
  // A missing profile row is not being signed out: the person has an account
  // but no profile yet, and PostgREST says so with PGRST116 from .single().
  // Any OTHER error means the read failed and we do not know what they are —
  // which must not be reported as "no role", because every screen refuses a
  // roleless visitor by name.
  if (error) {
    const noRow = (error as { code?: string }).code === 'PGRST116';
    return {
      id: user.id,
      email: user.email ?? null,
      fullName: null,
      role: null,
      tenantId: null,
      roleUnknown: !noRow,
    };
  }

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: data?.full_name ?? null,
    role: (data?.role as Role) ?? null,
    tenantId: data?.tenant_id ?? null,
    roleUnknown: false,
  };
}

