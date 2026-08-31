// What an owner types into the two settings the console has been asking them
// for and never offered: the session fee, and the gym's own name.
//
// Both are `tenants` columns and both are load-bearing. `session_fee` is what
// payroll, value-per-client and every "at your session fee" line multiply by,
// and it is stored as `numeric(8,2)` — so a figure this file waves through and
// the database then rejects is a save that looked like it worked. `name` is
// what every owner on every device sees the gym called.
//
// Parsing lives here, away from the screen, for the reason parseSpend() in
// src/lib/codeReturn.ts gives: the interesting cases are the ones a person
// types by accident — a currency symbol, a comma, an extra run of zeros, a
// leading minus — and none of them are visible in a JSX file.
//
// ── Blank is not zero ──────────────────────────────────────────────────────
//
// The one distinction the whole file exists for. `tenants.session_fee` was NOT
// NULL DEFAULT 75 until part 118, which is why "the gym has not set a fee" has
// never been representable and every screen's honest fallback has been dead
// code. Now that null is reachable, an empty field must CLEAR the fee rather
// than store 0: a gym charging nothing per session is a claim, and an owner who
// deleted the number is not making it. Storing the second as the first prices
// every delivered session at nothing and reports a month's payroll as zero.

/**
 * The largest fee the column can hold: `numeric(8,2)` is eight significant
 * digits with two after the point. 1,000,000 raises 22003 at the database and
 * the write fails after the sheet has already closed, so it is refused here
 * where the owner can still see the field they typed it into.
 */
export const MAX_SESSION_FEE = 999999.99;

export type FeeInput =
  | { kind: 'clear' }
  | { kind: 'fee'; fee: number }
  | { kind: 'bad'; reason: string };

/**
 * What the owner typed → what to write to `tenants.session_fee`.
 *
 * Whole units in, whole units out. Unlike the coach's spend field this is NOT
 * converted to minor units: the column is a numeric in whole currency and
 * `payroll30For` multiplies by it directly — see the note on `gymMoney` in
 * src/ui/tenant.tsx for the AED 63 / AED 6,300 incident that came of getting
 * that boundary wrong in the other direction.
 */
export function parseSessionFee(input: string | null | undefined): FeeInput {
  const raw = String(input ?? '').trim().replace(/[,\s]/g, '');
  if (!raw) return { kind: 'clear' };
  // A currency symbol is what a person types when asked for an amount of money,
  // and refusing it teaches nothing. The gym's currency is whatever
  // `tenants.currency` says; whatever they typed in front of the digits is not
  // a second opinion on that and is simply dropped.
  const bare = raw.replace(/^[^\d.-]+/, '');
  if (/^-/.test(bare) || /-/.test(raw)) return { kind: 'bad', reason: 'A session fee cannot be negative.' };
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) {
    return { kind: 'bad', reason: 'Enter the fee as a number — 75, or 82.50. Leave it empty if you have not set one.' };
  }
  const fee = Number(bare);
  if (!Number.isFinite(fee)) return { kind: 'bad', reason: 'That is not an amount.' };
  // Zero is refused rather than cleared. It is a typed answer, so it is treated
  // as one — and the answer it gives ("every session is free") makes payroll,
  // value-per-client and the revenue hero all read a confident 0 that nobody
  // could tell from a gym that delivered nothing. Clearing is the empty field.
  if (fee === 0) return { kind: 'bad', reason: 'A fee of 0 would value every delivered session at nothing. Clear the field instead if you have not set one.' };
  if (fee > MAX_SESSION_FEE) return { kind: 'bad', reason: 'That is more than Repple will record as a session fee — check the zeros.' };
  return { kind: 'fee', fee };
}

/**
 * What is already in the fee field when the sheet opens, or '' for a gym that
 * has not set one.
 *
 * '' rather than '0', for the same reason as above: an empty field invites the
 * owner to type the fee, and a pre-filled 0 invites them to accept it.
 */
export function sessionFeeFieldValue(fee: number | null | undefined): string {
  if (fee == null || !Number.isFinite(fee)) return '';
  return Number.isInteger(fee) ? String(fee) : fee.toFixed(2);
}

export type NameInput =
  | { kind: 'name'; name: string }
  | { kind: 'bad'; reason: string };

/**
 * The gym's own name, as typed → what to write to `tenants.name`.
 *
 * `tenants.name` is NOT NULL, so blank is refused rather than treated as a
 * clear: there is no such thing as a gym with no name, and the row would be
 * rejected anyway. Interior runs of whitespace collapse — "Iron  Works" and
 * "Iron Works" being two different gyms on two owners' phones is exactly the
 * kind of divergence writing the name to the tenant is meant to end.
 *
 * The provisioning trigger's placeholder ("<Name>'s space") is refused by name.
 * It is not a gym anybody called anything; it is the string part 06 writes when
 * it has nothing to go on, and saving it back deliberately would make it look
 * chosen — which is the whole reason onboarding offers it as a placeholder and
 * never as a value.
 */
export function parseGymName(input: string | null | undefined): NameInput {
  const name = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { kind: 'bad', reason: 'A gym needs a name.' };
  if (/'s space$/.test(name)) {
    return { kind: 'bad', reason: 'That is the placeholder name Repple gave the gym when the account was made. Type what the gym is actually called.' };
  }
  if (name.length > 80) return { kind: 'bad', reason: 'That is longer than a gym name — 80 characters at most.' };
  return { kind: 'name', name };
}

/**
 * Whether a value read back from `tenants.brand_color` can be handed to the
 * theme as an accent.
 *
 * There is NO check constraint on that column — verified against the live
 * database — so it holds whatever anybody has ever written to it, and
 * `brandInkFor()` in src/theme/tokens.ts parses it as hex without asking. A
 * junk value there does not fail loudly; it produces an unreadable label colour
 * on every button in the app, for every owner of that gym, with nothing on
 * screen to say why. Checked at the boundary instead.
 *
 * Three- and six-digit forms only, because those are the two the theme's own
 * parser handles. #RRGGBBAA is refused rather than silently truncated.
 */
export function isBrandColor(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

/** The same value, normalised to lower-case hex, or null when it is not one. */
export function brandColorOf(v: string | null | undefined): string | null {
  return isBrandColor(v) ? String(v).trim().toLowerCase() : null;
}
