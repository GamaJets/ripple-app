// What an owner typed into the two cancellation-policy fields → what to write
// to `tenants.class_cancel_hours` and `tenants.class_cancel_fee`.
//
// Parsing lives here, away from the screen, for the reason the header of
// src/lib/gymSettings.ts gives about the session fee beside it: the interesting
// cases are the ones a person types by accident — a currency symbol, a decimal
// comma, an extra run of zeros, a half-hour — and none of them are visible in a
// JSX file. app/(owner)/ops.tsx read both of these fields with a bare
// `Number()` and every one of those cases went through it.
//
// ── The two fields are not the same kind of thing ──────────────────────────
//
// That is the whole reason this file exists. `class_cancel_hours` is a COUNT
// and `class_cancel_fee` is MONEY, and reading money with the reader for a
// count is how a gym ends up holding a fee nobody set:
//
//   · `integer` rounds. "12.5" is finite and non-negative, so it passed, and
//     an owner asking for a twelve-and-a-half-hour window got thirteen with
//     nothing on screen saying so.
//   · `numeric(8,2)` rounds too. "5.555" in GBP was stored as 5.56.
//   · Sixteen currencies have no minor unit and five hold thousandths, so
//     there is no number of decimal places that is right for a fee — only the
//     currency knows. "5.5" at a gym priced in JPY is not an amount of yen.
//   · `Number('1e5')` is 100000, which is a very expensive typo.
//   · `Number('1,50')` is NaN, so the way most of the world writes an amount
//     was the one thing refused.
//
// ── Blank is not zero, and zero is not blank ───────────────────────────────
//
// Both columns are nullable and part 2615's own comments say what that means:
// "NULL means the gym has not stated a policy and the app must say so; 0 is a
// stated policy of no notice period", and for the fee, "0 is a stated policy of
// no charge". So an empty field CLEARS and a typed 0 SAVES, and they are
// different acts. This is the one place that distinction is decided, and it is
// why `parseCancelFee` deliberately does not follow `parseSessionFee`, which
// refuses a zero: a gym charging nothing for a late cancellation is making a
// real and sayable claim, where a gym valuing every delivered session at
// nothing is not.

import { readMinorAmount, majorFromMinor } from './coachMoney';

/**
 * The largest fee `class_cancel_fee numeric(8,2)` can hold.
 *
 * Beyond it Postgres raises 22003 and the write fails after the sheet has
 * already closed, so it is refused where the owner can still see the field they
 * typed it into — the same guard `MAX_SESSION_FEE` puts on the identically
 * shaped `tenants.session_fee`.
 */
export const MAX_CANCEL_FEE = 999999.99;

/** The longest notice period the column's own CHECK constraint admits. */
export const MAX_CANCEL_HOURS = 336;

/**
 * A parsed field: a value to write (null meaning "withdraw this half"), or a
 * refusal carrying the sentence the owner reads.
 *
 * The reason is always a whole sentence ending in what did NOT happen, because
 * the failure mode this replaces was a single shared "those are not numbers
 * this can save" that named neither field nor cause.
 */
export type PolicyField =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };

/**
 * Hours of notice, as typed → `tenants.class_cancel_hours`.
 *
 * A whole, non-negative number of hours, or null for an empty field. Not a
 * duration and not money: there is no currency in this signature and there
 * should never be one.
 */
export function parseCancelHours(input: string | null | undefined): PolicyField {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return {
      ok: false,
      reason: 'A notice period is a number of hours. Nothing has changed. Clear the field entirely to withdraw that half of the policy.',
    };
  }
  // The column is an `integer`, so a fraction does not survive the write. It is
  // refused rather than rounded, because rounding it stores a policy the owner
  // did not state and tells them it saved.
  if (!Number.isInteger(n)) {
    return { ok: false, reason: 'A notice period is a whole number of hours. Nothing has changed. Use 12 or 24, not 12.5.' };
  }
  if (n > MAX_CANCEL_HOURS) {
    return { ok: false, reason: 'A notice period longer than two weeks is refused. Nothing has changed.' };
  }
  return { ok: true, value: n };
}

/**
 * The late-cancellation fee, as typed → `tenants.class_cancel_fee`.
 *
 * Whole units in, whole units out — the column is a `numeric` in whole currency
 * like `tenants.session_fee`, not a `*_cents` column — but the READING goes
 * through minor units, because that is the only way the number of decimal
 * places comes from the currency rather than from a constant.
 *
 * `currency` is required and never defaulted, for the reason `parseSessionFee`
 * gives about the same parameter: a default is the same hardcoding written
 * somewhere less visible. A gym that has not set one cannot denominate a fee,
 * and `readMinorAmount` refuses with its own sentence rather than storing a
 * figure in no money — but an empty field still clears, because withdrawing a
 * fee needs no currency to withdraw it in.
 */
export function parseCancelFee(
  input: string | null | undefined,
  currency: string | null | undefined,
): PolicyField {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, value: null };
  // `false` is the chargeable flag: this is a policy a gym RECORDS, not an
  // amount handed to Stripe, so the thousandth-unit charging rule that applies
  // to a card payment does not apply to it.
  const read = readMinorAmount(raw, currency, false);
  if (!read.ok) return { ok: false, reason: `${read.reason} Nothing has changed.` };
  const value = Number(majorFromMinor(read.minorUnits, currency));
  if (!Number.isFinite(value)) return { ok: false, reason: 'That is not an amount. Nothing has changed.' };
  if (value > MAX_CANCEL_FEE) {
    return { ok: false, reason: 'That is more than Repple will record as a cancellation fee. Check the zeros. Nothing has changed.' };
  }
  return { ok: true, value };
}
