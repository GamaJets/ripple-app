// Does the account signing in belong to the brand this app was built as?
//
// Two axes that never met. `brands.ts` is compiled in: BRAND_ID is a fact about
// this binary, decided by EXPO_PUBLIC_BRAND at build time and unchangeable
// afterwards. `tenants.brand` (supabase/parts/101-tenant-brand.sql) is the same
// question asked of the gym. Until now nothing compared them, so a Brand A
// account signing into Brand B's app got Brand A's gym, its members, its
// takings and its rota, rendered under Brand B's name with nothing anywhere
// saying that had happened.
//
// ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
//
// This is NOT a security boundary and must not be sold as one. Every brand
// shares one Supabase project and one anon key, and that key ships inside every
// bundle. Somebody who wants Brand A's rows does not need Brand B's app to get
// them — they can talk to PostgREST directly, and none of the code in this file
// is running when they do.
//
// What it does is stop the wrong app showing the wrong gym to somebody who did
// not intend it: a coach with two brands' apps installed, a member of a chain
// that switched supplier, a tester with a stale account. That is a real and
// likely failure and it is worth refusing. It is not isolation. Isolation is a
// Supabase project per brand — see the header of part 101.
//
// ── WHY EVERY UNKNOWN ANSWER LETS THEM IN ──────────────────────────────────
//
// The check fails OPEN, on purpose, in three cases: the RPC could not be
// reached, the account has no tenant, or the tenant's brand is null. The first
// is availability — this guard protects nobody from an attacker, so trading a
// signed-in gym owner's Monday morning for it would be a bad bargain, and
// before part 101 is applied the RPC does not exist at all and EVERY sign-in
// would take that path. The third is the house rule about defaults: null means
// the brand was never stated, and a value nobody stated cannot disagree with
// anything. Only an explicit, different brand is a mismatch.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { BRAND, BRAND_ID, BRANDS } from './brands';
import { reportError } from './reportError';

/**
 * The verdict on one account in one app.
 *
 * 'unknown' is deliberately separate from 'ok' even though both let the person
 * in — a caller that wants to log or count refusals must not be told the brands
 * matched when what actually happened is that nobody could find out.
 */
export type BrandVerdict =
  | { kind: 'ok' }
  | { kind: 'unknown'; why: string }
  | { kind: 'mismatch'; tenantBrandId: string; message: string };

/**
 * PostgREST's code for "no such function".
 *
 * It is the answer both RPCs below give for the entire period between this code
 * shipping and part 101 being applied, on every launch and every sign-in, for
 * every user. Reporting that would fill `app_errors` with one true fact
 * repeated thousands of times and bury the failures worth reading. It is not an
 * error condition — it is the guard correctly finding nothing to enforce.
 */
const NO_SUCH_FUNCTION = 'PGRST202';

const expected = (error: { code?: string } | null | undefined): boolean =>
  error?.code === NO_SUCH_FUNCTION;

/** A brand id as a person would say it — its label if this build knows it. */
function labelFor(id: string): string | null {
  return Object.prototype.hasOwnProperty.call(BRANDS, id) ? BRANDS[id].label : null;
}

/**
 * What to tell somebody whose account belongs somewhere else.
 *
 * Names both brands and says what to do, because "Sign-in failed" for this
 * would send a coach to reset a password that was never wrong. A brand id this
 * build has never heard of gets quoted rather than guessed at: it is a real
 * possibility (an app built after this one, an id typed by hand) and inventing
 * a friendly name for it would be inventing a fact.
 */
export function brandMismatchMessage(tenantBrandId: string): string {
  const theirs = labelFor(tenantBrandId);
  return theirs
    ? `This is the ${BRAND.label} app, but your account belongs to ${theirs}. Sign in with the ${theirs} app — ${BRAND.label} cannot open another brand's gym.`
    : `This is the ${BRAND.label} app, but your account belongs to a different brand (“${tenantBrandId}”). Sign in with that brand's own app.`;
}

/**
 * Ask the server which brand the signed-in user's gym belongs to.
 *
 * Through an RPC and not `from('tenants')` because most users cannot read that
 * table: the SELECT policies cover owners, the gym's trainers, and a coach's
 * clients — a plain member in their own personal tenant is none of the three,
 * and PostgREST hands back an empty set with no error. Reading that as "no
 * brand" would let every mismatch through while looking like it had checked.
 * `my_tenant_brand()` is SECURITY DEFINER and answers only about the caller.
 */
export async function checkTenantBrand(): Promise<BrandVerdict> {
  if (!USE_SUPABASE) return { kind: 'ok' };
  try {
    const { data, error } = await supabase.rpc('my_tenant_brand');
    if (error) {
      // Never fatal: nobody is locked out of an app that worked yesterday
      // because a read failed. See the header on why this fails open.
      if (!expected(error)) reportError('tenantBrand.check', error);
      return { kind: 'unknown', why: error.message };
    }
    const row = (data ?? null) as { brand?: string | null } | null;
    if (!row || typeof row !== 'object') return { kind: 'unknown', why: 'no answer' };
    const theirs = typeof row.brand === 'string' ? row.brand.trim() : '';
    // No tenant, or a tenant that has never been told which brand it is.
    if (!theirs) return { kind: 'ok' };
    if (theirs === BRAND_ID) return { kind: 'ok' };
    return { kind: 'mismatch', tenantBrandId: theirs, message: brandMismatchMessage(theirs) };
  } catch (e: any) {
    reportError('tenantBrand.check', e);
    return { kind: 'unknown', why: e?.message || 'unreachable' };
  }
}

/**
 * Record this app's brand on a tenant that has never been told one.
 *
 * Called only on the paths that can CREATE an account. Email and phone signups
 * already carry the brand in auth metadata, so for them this is a no-op that
 * costs one round trip; Apple and Google cannot carry metadata at all — there
 * is no such argument to signInWithOAuth — so this is the only route they have.
 *
 * Not called on ordinary sign-in, and that restraint is the point: the server
 * refuses to overwrite a stated brand, but it would happily fill in a blank,
 * and filling one in on every sign-in would mean an existing Repple member who
 * opened another brand's app once had their own workspace permanently
 * reassigned — locked out of the app they actually use, by a repair.
 */
export async function stampTenantBrand(): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const { error } = await supabase.rpc('claim_tenant_brand', { p_brand: BRAND_ID });
    // Nothing downstream depends on this succeeding — the guard treats an
    // unstamped tenant as "not stated", which is what it was before the call.
    if (error && !expected(error)) reportError('tenantBrand.claim', error);
  } catch (e) { reportError('tenantBrand.claim', e); }
}

/**
 * Create an account with this app's brand attached.
 *
 * The same call `signUp()` in src/lib/supabase.ts makes, plus one metadata key.
 * It lives here rather than there because the brand is what this module is
 * about, and because the value has to travel with `full_name` and `role`: all
 * three are read out of `raw_user_meta_data` by handle_new_user() (part 07),
 * and `brand` is then read a second time from auth.users by provision_profile()
 * (part 101) when it creates the tenant. Metadata set at any later moment is
 * too late — the tenant already exists by then.
 */
export async function signUpWithBrand(email: string, password: string, fullName: string, role: string) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: fullName, role, brand: BRAND_ID } },
  });
  if (error) throw error;
  return data.user;
}

/** The metadata every account-creating auth call attaches. One spelling. */
export const brandSignUpMetadata = (): { brand: string } => ({ brand: BRAND_ID });
