// What a gym has said about itself — and the difference between a setting it
// has not made and a setting somebody guessed for it.
//
// Four things live here, and they are together because they are the same
// question asked four ways: what does this gym charge in, what does it pay a
// coach for, what colour is it, and how does a screen write any of them without
// inventing an answer.
//
// A fifth joined them: what timezone is it in. Its parsing lives in
// src/lib/gymZone.ts rather than here, because unlike a currency code or a hex
// colour a zone is not checkable with a regex — the answer is whatever the
// runtime's IANA database holds, and there is a whole file's worth of day and
// hour arithmetic that follows from it. What lives here is the same thing that
// lives here for the other four: the read, the patch, and the record of who may
// change it and what happens to what was there before.
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
import { brandColorOf } from './gymSettings';
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

/* ── the brand colour ──────────────────────────────────────────────────────── */

export type BrandColorInput =
  | { kind: 'clear' }
  | { kind: 'color'; color: string }
  | { kind: 'bad'; reason: string };

/**
 * What the owner typed → what to write to `tenants.brand_color`.
 *
 * There is NO check constraint on that column — the same finding
 * `isBrandColor` in src/lib/gymSettings.ts records — so unlike the currency,
 * nothing downstream will refuse a bad value on the way in. It is refused here
 * because the alternative is that it is not refused anywhere: the phone theme
 * parses it as hex without asking, and studio-web's own `safeHex` silently
 * keeps its default. Both of those are a gym whose buttons are the wrong colour
 * or unreadable, with nothing on screen to say why.
 *
 * Blank CLEARS, for the reason `parseTenantCurrency` gives about currency: an
 * owner who empties the field is saying they have not chosen a colour, part 118
 * dropped the default precisely so that could be said, and every surface
 * already renders the null as its own accent.
 *
 * Three- and six-digit hex only, and lower-cased, which is what `brandColorOf`
 * already decides for the READ side. One rule, asked here before the round trip
 * and again when the stored value is handed to a theme.
 */
export function parseBrandColor(input: string | null | undefined): BrandColorInput {
  const raw = String(input ?? '').trim();
  if (!raw) return { kind: 'clear' };
  const color = brandColorOf(raw);
  if (!color) {
    return {
      kind: 'bad',
      reason: 'A brand colour is a hex code — #1e88e5 or #1b5, with the hash. Not a colour name and not rgb().',
    };
  }
  return { kind: 'color', color };
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
  /**
   * The IANA zone the gym's own day is measured in, or null because it has not
   * said. Null is NOT UTC and is NOT the reader's zone — see
   * supabase/parts/710 and `NO_ZONE_NOTE` in src/lib/gymZone.ts. A screen that
   * gets null here must say whose day it is actually drawing.
   *
   * As stored, unvalidated, exactly as `payPolicy` is. A value the column holds
   * that this runtime cannot resolve is still what is stored, and a screen has
   * to be able to show the owner the string that is in there before offering to
   * replace it.
   */
  timezone: string | null;
  /**
   * Hours of notice before a class inside which the gym may charge, or null
   * because they have not said. Null is NOT "no notice period" — see
   * supabase/parts/2615, which refuses a default on this column for exactly
   * that reason, and `CLASS_POLICY_UNKNOWN_NOTE` in src/lib/classCancel.ts,
   * which is what a member is told while it is null.
   */
  classCancelHours: number | null;
  /** What a late cancellation costs, in `currency`. Null is unstated; 0 is a
   *  stated policy of no charge, and the two must not be collapsed. */
  classCancelFee: number | null;
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
    .select('name, currency, session_fee, session_pay_policy, brand_color, timezone, class_cancel_hours, class_cancel_fee')
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
      // Trimmed to null so '' and null are one answer, which is what
      // `tenants_timezone_check` already guarantees on the way in — restated
      // here for a row written before part 710 existed.
      timezone: String((r.timezone as string | null) ?? '').trim() || null,
      // Same numeric-from-PostgREST care as `sessionFee` above, and the same
      // refusal to invent: a value that will not parse becomes null, which the
      // screens read as "not stated" rather than as a zero-hour window or a
      // free cancellation.
      classCancelHours: r.class_cancel_hours == null || r.class_cancel_hours === ''
        ? null
        : Number.isFinite(Number(r.class_cancel_hours)) ? Number(r.class_cancel_hours) : null,
      classCancelFee: r.class_cancel_fee == null || r.class_cancel_fee === ''
        ? null
        : Number.isFinite(Number(r.class_cancel_fee)) ? Number(r.class_cancel_fee) : null,
    },
    error: null,
  };
}

/**
 * What may be written to a gym's row from a settings screen. Every field is
 * optional and an absent field is left alone; `null` is a deliberate clear.
 *
 * ── Why this list is shorter than the table ────────────────────────────────
 *
 * Widening it is not free. `tenants` is granted `arwdDxtm` to `authenticated`
 * at TABLE level with no per-column ACLs (part 101 §4 checked this on the live
 * database), so RLS cannot say which columns an update touches — which means
 * the only thing standing between a column and a browser form is whether some
 * TypeScript somewhere puts it in a patch. Every field below is therefore a
 * deliberate decision, recorded with who may change it and what happens to what
 * was there before, and every field NOT below is a decision too.
 *
 *   name         · the owner, and the phone (`updateTenant` in src/ui/tenant.tsx).
 *                  Replaces the old name everywhere at once — the rail, every
 *                  coach's app, the browser tab. Nothing keeps the previous one;
 *                  it is a label, not a record. NOT NULL, so it cannot be
 *                  cleared, only replaced.
 *   currency     · the owner, and the phone. Rows already written KEEP the
 *                  currency they were written in — a payment is a historical
 *                  fact — so changing it gives the gym two, and every total that
 *                  mixes them is withheld rather than added up. Clearing it is
 *                  allowed and means "we have not decided", which every money
 *                  screen already knows how to render.
 *   sessionFee   · the owner, and the phone. Not retrospective: settlements
 *                  already written hold their own figure, and this is what the
 *                  NEXT one multiplies. Clearing it withholds payroll rather
 *                  than pricing a session at nothing.
 *   payPolicy    · the owner, from this console only — the phone's
 *                  `updateTenant` has never carried it. Changes what Sessions,
 *                  Staff, Close and every coach's earnings screen count as
 *                  payable, INCLUDING for months already worked but not yet
 *                  settled. Clearing it is "the gym has not decided" and every
 *                  dependent figure is withheld rather than guessed.
 *   timezone     · the owner, from this console only. NOT retrospective and not
 *                  retroactive in the way the currency is: every timestamp in
 *                  this database is an instant, so nothing is re-denominated
 *                  and nothing is rewritten. What changes is which DAY a screen
 *                  files an instant under — so setting it, or changing it, moves
 *                  figures between days and between hours from that moment on,
 *                  in both directions and for the past as well as the future.
 *                  That is correct: the past always did happen at the gym's own
 *                  hour, and every screen that showed otherwise was showing the
 *                  reader's. Clearing it returns every date and hour on every
 *                  screen to whichever device is reading them, which is where
 *                  they were before part 710 and is a state screens must say
 *                  out loud rather than render as the gym's.
 *   brandColor   · the owner, and the phone (app/(owner)/brand.tsx). Overwrites
 *                  the previous colour on every device that owner's gym signs in
 *                  on, this console included; there is no history and nothing to
 *                  revert to. Clearing it returns each surface to its own build
 *                  accent, which is what part 118 made representable when it
 *                  dropped the teal default.
 *
 * ── and what is deliberately still not here ────────────────────────────────
 *
 *   brand        · NOT WRITABLE BY ANYONE from a client session. Part 101 §4
 *                  installs a trigger that raises on a change, precisely so an
 *                  owner cannot walk their gym into another white-label
 *                  product's app. Putting it in this patch would produce a save
 *                  that always fails, on a field nobody should be offered.
 *   plan         · what the gym is BILLED on. A form that let an owner set their
 *                  own plan is a form that lets them upgrade themselves, and the
 *                  answer belongs wherever billing is decided rather than beside
 *                  the session fee.
 *   record_retention_years
 *                · already writable, and from its own screen. /compliance owns
 *                  it, with the argument for the number beside the field. Adding
 *                  it here would put two writers of one column in one console —
 *                  the exact drift this module's header says it exists to stop.
 *   logo         · nothing reads it. It has existed since part 01 and neither
 *                  app nor console renders it, so a control for it would be a
 *                  field an owner fills in and never sees again.
 */
export interface GymProfilePatch {
  name?: string;
  currency?: string | null;
  sessionFee?: number | null;
  payPolicy?: PayPolicyCode | null;
  /** Lower-case `#rgb` or `#rrggbb`, per `parseBrandColor`. Null clears it, and
   *  a cleared colour is a gym that has not chosen one — never a default. */
  brandColor?: string | null;
  /** An IANA zone name, per `parseGymZone` in src/lib/gymZone.ts. Null clears
   *  it, and a cleared zone is a gym whose days are the reader's again — never
   *  UTC. `tenants_timezone_check` refuses anything `pg_timezone_names` does not
   *  hold, so a value that got past the client is still refused at the write. */
  timezone?: string | null;
  /** Null clears it back to "this gym has not said", which is a real thing an
   *  owner may want to do and is why these are nullable rather than defaulted.
   *  `tenants_class_cancel_hours_check` refuses a negative or an absurd one
   *  (over two weeks) at the write, so a value that got past the screen is
   *  still refused by the database. */
  classCancelHours?: number | null;
  classCancelFee?: number | null;
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
  // `tenants_normalise_settings` does NOT touch this one — it trims the name and
  // folds the case of the currency and the policy, and nothing else — so what is
  // sent here is what is stored. `parseBrandColor` is therefore the only thing
  // between an owner's typing and the column, which is why it lower-cases rather
  // than leaving that to a trigger that will not do it.
  if (patch.brandColor !== undefined) row.brand_color = patch.brandColor;
  // `tenants_timezone_check` (part 710) trims this, folds '' to null and
  // REFUSES anything pg_timezone_names does not hold. Unlike the colour, this
  // column has a guarantee behind it — so a bad value arrives as a raised
  // exception with the zone named in it rather than as a silently stored
  // string, and `parseGymZone` exists to say so before the round trip rather
  // than to be the only thing standing in the way.
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  // Neither column is normalised by a trigger, and both are checked by the
  // database — a negative or >336 hours, or a negative fee, is raised rather
  // than stored. Nothing is coerced here: `null` means the owner cleared it.
  if (patch.classCancelHours !== undefined) row.class_cancel_hours = patch.classCancelHours;
  if (patch.classCancelFee !== undefined) row.class_cancel_fee = patch.classCancelFee;
  if (Object.keys(row).length === 0) return;

  const r = await sb.from('tenants').update(row, { count: 'exact' }).eq('id', tenantId);
  assertWrote('That gym setting', r);
}
