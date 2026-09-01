// What a gym has said about itself — and the difference between a setting it
// has not made and a setting somebody guessed for it.
//
// Three things live here, and they are together because they are the same
// question asked three ways: what does this gym charge in, what does it pay a
// coach for, and how does a screen write either of them without inventing an
// answer.
//
// Framework-agnostic like the rest of src/lib: the Supabase client arrives as
// an argument, so the web console and the phone app can both use this and
// neither owns it. That matters more here than usual — `tenants.currency` is
// now written from two surfaces, and two implementations of one rule is how the
// rule stops being one rule.
//
// ── Why the pay policy is stored at all ────────────────────────────────────
//
// `PAY_DELIVERED_ONLY` in src/lib/gymSessions.ts is documented as "the
// conservative default", and it was being used as the STORED VALUE by four
// screens that each held their own unsaved copy: /sessions, /staff and /close
// as `useState`, and /coach/earnings as a hardcoded constant with a note on
// screen admitting it cannot read the gym's real policy. An owner who set the
// policy on Sessions and walked to Close to settle the month settled against a
// different number from the one they had just looked at.
//
// A default that renders cleanly looks considered. That sentence is the whole
// of part 99's argument about currency and it applies here without a word
// changed, so the stored value is NULLABLE and null means the gym has not
// decided — which is a thing to say on screen, not a thing to fill in.

import { assertWrote } from './wroteRows';
import type { PayPolicy } from './gymSessions';

type Queryable = { from: (table: string) => any };

/* ── the pay policy ────────────────────────────────────────────────────────── */

/**
 * The four answers `tenants.session_pay_policy` can hold, and the null.
 *
 * Four values rather than two boolean columns, because they are always read
 * together by one function (`isPayable`) and two columns can hold three
 * quarters of an answer.
 */
export type PayPolicyCode =
  | 'delivered_only'
  | 'no_shows'
  | 'late_cancellations'
  | 'no_shows_and_late_cancellations';

export const PAY_POLICY_CODES: PayPolicyCode[] = [
  'delivered_only',
  'no_shows',
  'late_cancellations',
  'no_shows_and_late_cancellations',
];

/** What each answer means, in the words a screen shows an owner. Sentence case:
 *  these are read as statements, not as button labels. */
export const PAY_POLICY_LABEL: Record<PayPolicyCode, string> = {
  delivered_only: 'Only sessions that were delivered',
  no_shows: 'Delivered sessions and no-shows',
  late_cancellations: 'Delivered sessions and late cancellations',
  no_shows_and_late_cancellations: 'Delivered sessions, no-shows and late cancellations',
};

/**
 * The stored code → the policy `isPayable` takes.
 *
 * Returns null for null, and for anything the constraint does not permit. Not
 * `PAY_DELIVERED_ONLY`: a value this module does not recognise is a value
 * nobody here understands, and answering it with the conservative reading is
 * the exact substitution this whole file exists to stop. A caller that gets
 * null must say "not set" and refuse to total, which is what a screen would
 * have to do anyway for the gym that has genuinely not decided.
 */
export function payPolicyOf(code: string | null | undefined): PayPolicy | null {
  switch (code) {
    case 'delivered_only': return { payNoShows: false, payLateCancellations: false };
    case 'no_shows': return { payNoShows: true, payLateCancellations: false };
    case 'late_cancellations': return { payNoShows: false, payLateCancellations: true };
    case 'no_shows_and_late_cancellations': return { payNoShows: true, payLateCancellations: true };
    default: return null;
  }
}

/** The policy a control produced → the code to store. Total, so a control can
 *  never assemble a policy that has no representation in the column. */
export function payPolicyCode(p: PayPolicy): PayPolicyCode {
  if (p.payNoShows && p.payLateCancellations) return 'no_shows_and_late_cancellations';
  if (p.payNoShows) return 'no_shows';
  if (p.payLateCancellations) return 'late_cancellations';
  return 'delivered_only';
}

/** The sentence a screen prints where a policy would go, when none is set. One
 *  wording in one place, so four screens cannot word the same silence four
 *  ways — which is how they came to disagree in the first place. */
export const NO_PAY_POLICY_NOTE =
  'this gym has not said what it pays for beyond delivered sessions';

/* ── the currency ──────────────────────────────────────────────────────────── */

export type CurrencyInput =
  | { kind: 'clear' }
  | { kind: 'currency'; currency: string }
  | { kind: 'bad'; reason: string };

/**
 * What the owner typed → what to write to `tenants.currency`.
 *
 * `tenants_currency_is_iso` is `currency is null or currency ~ '^[A-Z]{3}$'`,
 * so anything else fails the write with 23514 after the sheet has closed. It is
 * refused here instead, where the field they typed it into is still on screen.
 *
 * Blank CLEARS rather than being refused, and that is deliberate: an owner who
 * empties the field is saying they no longer know, and the column is nullable
 * precisely so that can be said. Every screen already renders a null as a dash
 * with a note; none of them renders a wrong code as anything at all.
 *
 * The normalisation here is a courtesy, not the guarantee. The guarantee is
 * `tenants_normalise_settings`, the trigger the database runs on every write
 * from every client — see supabase/parts/166. Doing it in both places is the
 * point: the caller gets told before the round trip, and the stored value is
 * right whoever wrote it.
 */
export function parseTenantCurrency(input: string | null | undefined): CurrencyInput {
  const raw = String(input ?? '').trim();
  if (!raw) return { kind: 'clear' };
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return {
      kind: 'bad',
      reason: 'A currency is its three-letter ISO code — GBP, AED, EUR, USD. Not a symbol and not a name.',
    };
  }
  return { kind: 'currency', currency: code };
}

/* ── reading and writing the gym's row ─────────────────────────────────────── */

export interface GymProfile {
  name: string | null;
  /** ISO 4217 as the gym set it, or null because it has not. */
  currency: string | null;
  /** Whole currency units, as `tenants.session_fee` stores it. */
  sessionFee: number | null;
  /** The stored code, unmapped. Callers run it through `payPolicyOf`, which
   *  answers null for a value this build does not know. */
  payPolicy: string | null;
  brandColor: string | null;
}

/**
 * The gym's own row, with the error kept apart from the values.
 *
 * supabase-js RESOLVES on a database error rather than rejecting, so taking
 * only `data` turns a refused read into a row of nulls — a gym with no name, no
 * fee, no currency and no policy, every one of which a screen then states as a
 * setting the owner has not made. `error` is what tells "we could not ask" from
 * "nobody has said", and they are different sentences with different fixes.
 */
export async function fetchGymProfile(
  sb: Queryable, tenantId: string,
): Promise<{ profile: GymProfile | null; error: string | null }> {
  const { data, error } = await sb
    .from('tenants')
    .select('name, currency, session_fee, session_pay_policy, brand_color')
    .eq('id', tenantId)
    .single();
  if (error) {
    return { profile: null, error: (error as { message?: string }).message || 'The gym record could not be read.' };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  const fee = r.session_fee;
  return {
    profile: {
      name: (r.name as string | null) ?? null,
      currency: String((r.currency as string | null) ?? '').trim().toUpperCase() || null,
      // A numeric column arrives from PostgREST as a string on some paths and a
      // number on others. Parsed once, here, so no screen has to guess — and
      // NaN becomes null rather than a figure payroll would multiply by.
      sessionFee: fee == null || fee === '' ? null
        : Number.isFinite(Number(fee)) ? Number(fee) : null,
      payPolicy: (r.session_pay_policy as string | null) ?? null,
      brandColor: (r.brand_color as string | null) ?? null,
    },
    error: null,
  };
}

/** What may be written to a gym's row from a settings screen. Every field is
 *  optional and an absent field is left alone; `null` is a deliberate clear. */
export interface GymProfilePatch {
  name?: string;
  currency?: string | null;
  sessionFee?: number | null;
  payPolicy?: PayPolicyCode | null;
}

/**
 * Save what the owner changed.
 *
 * The COUNT is checked, not `error` alone — see src/lib/wroteRows.ts, and this
 * is the table where that matters most. `tenants_owner_rw` is
 * `is_owner_of(tenants.id)` and is the only policy granting UPDATE, so an
 * update run by anybody else — a trainer who reached the URL, an owner whose
 * profile row says something else, an owner of a different gym — matches ZERO
 * ROWS and returns `error: null`. Without the count the sheet says "Saved", the
 * page reloads, and the old value comes back looking like a stale cache.
 *
 * An empty patch is refused rather than sent. PostgREST answers an empty update
 * with a 204 and a count of zero, which `assertWrote` would report as a refusal
 * — a confusing error for pressing Save without changing anything.
 */
export async function saveGymProfile(
  sb: Queryable, tenantId: string, patch: GymProfilePatch,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.currency !== undefined) row.currency = patch.currency;
  if (patch.sessionFee !== undefined) row.session_fee = patch.sessionFee;
  if (patch.payPolicy !== undefined) row.session_pay_policy = patch.payPolicy;
  if (Object.keys(row).length === 0) return;

  const r = await sb.from('tenants').update(row, { count: 'exact' }).eq('id', tenantId);
  assertWrote('That gym setting', r);
}
