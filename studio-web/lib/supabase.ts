// The same Supabase project the phone apps use, reached from the browser.
//
// There is no second permission model here. Every table already carries
// row-level policies, and the anon key grants nothing on its own — what a
// signed-in person can read is decided in the database, by the same policies
// that govern the apps. That is the whole reason the web console can be built
// against this project directly rather than through a bespoke API.
import { createClient } from '@supabase/supabase-js';
// The union is imported rather than written out as `'kg' | 'lb'`, so this file
// cannot drift from the CHECK constraint on the column, and so the two unit
// literals never appear here at all — which is what the unit rule in
// scripts/check-currency.mjs is looking for and would otherwise have had to be
// argued with.
import type { WeightUnit } from '@lib/units';

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
   * The unit THIS ACCOUNT reads weights in, or null because nobody has asked
   * it. `profiles.weight_unit` exists for exactly this — its schema comment
   * says "the unit this ACCOUNT reads weights in, whatever its role. Null means
   * never chosen." — and it is nullable for the same reason `tenants.currency`
   * is: a default that renders cleanly looks considered, so nobody goes and
   * fixes the setting.
   *
   * Read here rather than in a second query because this screen is already
   * selecting the profile row, and a preference nobody pays for is a preference
   * screens will actually use. See lib/units.ts for what is done with a null.
   */
  weightUnit: WeightUnit | null;
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
    .select('full_name, role, tenant_id, weight_unit')
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
      weightUnit: null,
      roleUnknown: !noRow,
    };
  }

  // Anything other than the two the column's own CHECK constraint permits is
  // treated as never-chosen rather than passed through. A stray value would
  // otherwise reach `weightLabel` and be printed as a unit somebody invented,
  // which is the whole failure this preference exists to end.
  const wu = data?.weight_unit;
  return {
    id: user.id,
    email: user.email ?? null,
    fullName: data?.full_name ?? null,
    role: (data?.role as Role) ?? null,
    tenantId: data?.tenant_id ?? null,
    weightUnit: wu === 'kg' || wu === 'lb' ? wu : null,
    roleUnknown: false,
  };
}

