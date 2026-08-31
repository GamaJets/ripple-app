// What money the gym counts in — and what to do when nobody has said.
//
// `money()` in src/lib/gymRecord.ts is declared `(cents, currency = 'AED')`.
// That default was defensible while every customer was in the UAE, and it is a
// wrong number the moment one is not: a bare `money(630000)` prints
// "AED 6,300.00" on a London gym's payroll screen, and a default that silently
// applies LOOKS considered. Nobody reads it as a missing setting.
//
// The database settled this already. `tenants.currency` (setup.sql, the
// tenant-currency part) is deliberately NULLABLE and its own comment says:
// "NULL means the gym has not set one — render a dash and ask, never assume."
// The phone app obeys that through `myTenantCurrency` in src/lib/subscriptions.
// This console never read the column at all.
//
// So: every figure denominated in the gym's own money goes through `amount()`
// rather than through `money()` directly. Where a row carries its OWN currency
// — a payment, an invoice, a payroll settlement all store one — that row's
// currency wins and `money(cents, row.currency)` is used unchanged; this is for
// the figures that have no currency of their own and inherit the gym's.
//
// Fixing `money()`'s default would be the real repair and it is one line, but
// src/lib belongs to the phone app and is not ours to edit from here.
import { money } from '@lib/gymRecord';

/** ISO 4217 as the gym set it, or null when the gym has not set one. The two
 *  are different facts and only one of them may be printed. */
export type TenantCurrency = string | null;

/**
 * A gym-denominated figure, or null when it cannot honestly be written.
 *
 * Null for two separate reasons — no amount, or no currency — and the caller
 * says which in the note beside the dash. Returning a bare number without its
 * currency was the other option and it is worse: "6,300.00" beside a Pay
 * button is read in whatever money the reader is thinking in.
 */
export function amount(cents: number | null | undefined, currency: TenantCurrency): string | null {
  if (cents == null || !currency) return null;
  return money(cents, currency);
}

/** The note to print under a dash that is missing only for want of a currency.
 *  One sentence, in one place, so twenty screens cannot word it twenty ways. */
export const NO_CURRENCY_NOTE = 'this gym has not set its currency';

/**
 * Which of the two silences a null `amount()` is — for a caller that has an
 * amount and wants to explain the dash.
 *
 * Returns null when the figure is fine, so it drops straight into an
 * `undefined`-taking note prop.
 */
export function currencyNote(cents: number | null | undefined, currency: TenantCurrency): string | null {
  if (cents == null) return null;
  return currency ? null : NO_CURRENCY_NOTE;
}

/**
 * Read the gym's row: its name and the money it charges in.
 *
 * Both come back null when the read failed, and `error` is what tells that
 * apart from a gym that has set neither. Every screen here was already making
 * this exact query for the name alone and dropping the currency column on the
 * floor.
 */
export async function readTenant(
  sb: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => { single: () => PromiseLike<{ data: any; error: any }> };
      };
    };
  },
  tenantId: string,
): Promise<{ name: string | null; currency: TenantCurrency; error: string | null }> {
  // supabase-js resolves on a database error rather than rejecting, so the
  // error is read off the result. Without it a refused read arrives as
  // `data: null` and the rail says "No gym linked" — a claim about the owner's
  // account, in the branch where the account demonstrably has a tenant.
  const { data, error } = await sb.from('tenants').select('name, currency').eq('id', tenantId).single();
  if (error) {
    return { name: null, currency: null, error: (error as { message?: string }).message || 'The gym record could not be read.' };
  }
  const raw = (data as { name?: string | null; currency?: string | null } | null) ?? null;
  const ccy = (raw?.currency ?? '').trim().toUpperCase();
  return { name: raw?.name ?? null, currency: ccy || null, error: null };
}
