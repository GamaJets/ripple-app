// Reading and writing a coach's branding. The only module that touches
// `trainers.brand_name` and `trainers.brand_color`.
//
// Two directions, deliberately in one file:
//
//   · the COACH reads and writes their own two columns (coach app only);
//   · the CLIENT asks `my_coach_brand()` what to draw.
//
// One file because they are two ends of one wire, and the failure worth
// preventing is the two ends disagreeing about what a null means. src/lib/
// coachBrand.ts holds every rule; nothing here decides anything.
//
// It is NOT part of src/ui/coachProfile.tsx, which owns the coach's tagline,
// bio, offers and fee. That provider persists on a 600ms debounce with a
// fire-and-forget `.then(() => {}, () => {})`, which is right for a text field
// somebody is still typing into and wrong for this: a colour is a discrete
// decision, there is nothing to debounce, and a coach whose write was refused
// has to be told — see `saveMyCoachBrand` below and src/lib/wroteRows.ts.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { VARIANT } from '../lib/variant';
import { reportError } from '../lib/reportError';
import { writeFailure } from '../lib/wroteRows';
import { coachBrandColorOf, coachBrandNameOf } from '../lib/coachBrand';

/* ── the coach's own branding ─────────────────────────────────────────────── */

export interface MyCoachBrand {
  /** `trainers.brand_name`, or null when the coach trades under their own name. */
  brandName: string | null;
  /**
   * `trainers.brand_color` AS STORED — not put through `coachBrandColorOf()`.
   *
   * The coach's own editor has to show them what is in their record, including
   * a value it will refuse to apply. Blanking the field because the colour is
   * unreadable would leave a coach looking at an empty box, unable to see or
   * clear whatever their clients are (not) getting.
   */
  brandColor: string | null;
}

/**
 * The signed-in coach's own branding.
 *
 * Coach app only, and the guard is the same one src/lib/trainerProfileAccess.ts
 * argues for at length: this reads the SIGNED-IN user's `trainers` row, so on
 * the client app it would be the reader's own — which is how four client
 * screens once showed a client their own name and face under "Your coach". Here
 * the request is simply never issued.
 *
 * Throws on a failed read. The caller must distinguish "no branding" from "we
 * could not find out", and a resolved null cannot carry that difference.
 */
export async function fetchMyCoachBrand(): Promise<MyCoachBrand> {
  if (!USE_SUPABASE || VARIANT !== 'trainer') return { brandName: null, brandColor: null };
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Not signed in.');
  const { data, error } = await supabase
    .from('trainers').select('brand_name, brand_color').eq('id', uid).maybeSingle();
  if (error) throw error;
  return {
    brandName: coachBrandNameOf(data?.brand_name),
    brandColor: (data?.brand_color as string | null) ?? null,
  };
}

/**
 * Write one or both columns. Returns null when it landed, or the sentence
 * saying it did not.
 *
 * The count is the proof, never `error` alone. `trainers_self_rw` is a USING
 * clause, so a write aimed at somebody else's row — or at your own from an
 * account whose `trainers` row does not exist — matches zero rows and PostgREST
 * answers with no error at all. Proved live against this database: a second
 * coach updating the first coach's `brand_color` touched 0 rows and raised
 * nothing (supabase/parts/153's own note records the run).
 *
 * There is a second way this could have failed silently and it is the reason
 * the grant lines exist in part 153: `trainers` grants SELECT and UPDATE per
 * COLUMN, not at table level, so before those two lines every write here would
 * have been refused — and refused in exactly the same countless, errorless way.
 *
 * `undefined` leaves a column alone; `null` clears it. They are different
 * requests and the caller means different things by them.
 */
export async function saveMyCoachBrand(patch: {
  brandName?: string | null;
  brandColor?: string | null;
}): Promise<string | null> {
  if (!USE_SUPABASE || VARIANT !== 'trainer') return 'Your branding was not saved.';
  const row: Record<string, unknown> = {};
  if (patch.brandName !== undefined) row.brand_name = patch.brandName;
  if (patch.brandColor !== undefined) row.brand_color = patch.brandColor;
  if (!Object.keys(row).length) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return 'Your branding was not saved.';
    const res = await supabase.from('trainers').update(row, { count: 'exact' }).eq('id', uid);
    if (res.error) reportError('coachBrand.save', res.error);
    return writeFailure('Your branding', res);
  } catch (e) {
    reportError('coachBrand.save', e);
    return 'Your branding was not saved.';
  }
}

/* ── what a client's app should wear ──────────────────────────────────────── */

export interface ClientCoachBrand {
  /**
   * Whether this client shares their tenant with anybody else — which is what
   * belonging to a gym IS, measured rather than declared. Part 153 has the
   * reasoning and the numbers.
   *
   * Computed server-side because RLS on `profiles` is `id = auth.uid()`: a
   * client counting their own tenant's occupants reads 1, every time, and would
   * conclude they were independent while standing in a gym.
   */
  inGym: boolean;
  /** The coach's own name, as their client already sees it, or null. */
  coachName: string | null;
  /** What the coach trades as, or null when that is their own name. */
  brandName: string | null;
  /** As stored. `resolveClientBrand()` is what decides whether it applies. */
  brandColor: string | null;
}

/**
 * Ask the database what this client's app should wear.
 *
 * One RPC rather than three reads, and it takes no argument, so there is
 * nothing to probe with. It answers over the same active-coaching gate as
 * `my_coach_profile()`: when coaching ends the branding ends with it.
 *
 * Throws on failure for the reason my-coach.tsx gives about its own load — a
 * client whose read failed is not a client with no coach, and treating the two
 * the same is how somebody gets told they have no coach and goes looking for a
 * way to re-link.
 */
export async function fetchClientCoachBrand(): Promise<ClientCoachBrand> {
  if (!USE_SUPABASE) return { inGym: false, coachName: null, brandName: null, brandColor: null };
  const { data, error } = await supabase.rpc('my_coach_brand');
  if (error) throw error;
  const j = (data ?? {}) as Record<string, unknown>;
  return {
    // Anything other than a true from the server is NOT a gym membership. It is
    // also not a claim that there is no gym — the caller sees the throw above
    // for that — so `=== true` is deliberate rather than lazy.
    inGym: j.in_gym === true,
    coachName: coachBrandNameOf(j.coach_name as string | null),
    brandName: coachBrandNameOf(j.brand_name as string | null),
    brandColor: (j.brand_color as string | null) ?? null,
  };
}

/**
 * The shape `resolveClientBrand()` wants, from the shape the RPC returns.
 *
 * Trivial, and here rather than at each call site so that a screen cannot pass
 * `brandName` where `name` belongs and silently show a coach's real name to a
 * client who should be seeing their trading one.
 */
export function brandInputFor(b: ClientCoachBrand | null, gym?: { name?: string | null; color?: string | null } | null) {
  return {
    inGym: b?.inGym ?? false,
    gym: gym ?? null,
    coach: b && (b.coachName || b.brandName || b.brandColor)
      ? { name: b.coachName, brandName: b.brandName, color: b.brandColor }
      : null,
  };
}

/** Re-exported so a screen needs one import to draw a coach's colour safely. */
export { coachBrandColorOf };
