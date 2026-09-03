// What money a SUM is in, when the rows it was made of each carry their own.
//
// ── the defect this is the one answer to ──────────────────────────────────
//
// `summarise` in src/lib/gymRecord.ts adds `gym_payments.amount_cents` up and
// adds the price of every active membership's plan up, and it ignores what
// currency each of those rows states. It says so itself, at length, and it
// reports the answer alongside the two totals — `takenCurrency` and
// `mrrCurrency`, each null exactly when the contributing rows do NOT agree on
// one currency. Its own header ends: "a caller holding a null must withhold the
// figure and say why".
//
// Four callers hold those two figures. Two of them obeyed that and two did not:
//
//   · studio-web/app/page.tsx and studio-web/app/money/page.tsx each wrote the
//     rule out by hand, correctly, in slightly different words.
//   · app/(owner)/members.tsx rendered the gym's MONTHLY RECURRING REVENUE —
//     the one hero figure on the owner's register screen — as
//     `money(sum.mrrCents, cur)`, where `cur` is `tenants.currency`, the gym's
//     CURRENT setting, and `sum.mrrCents` is the sum of the plan prices. A gym
//     that has changed currency has plans in two of them; those were added
//     together and the result labelled with the newer code.
//   · app/(owner)/financials.tsx did the same through `wholeFromMinor`, which
//     is worse, because that screen's whole job is checking the figure against
//     one the owner typed: a wrong scale (a yen plan divided by a hundred, a
//     dinar by a hundred instead of a thousand) is reported to the owner as
//     their own figure DISAGREEING with the register, under a button that
//     writes the wrong one over the right one.
//
// The line directly below the second of those already did it properly — the
// thirty-day takings check groups on the payments' own currency before it
// totals anything. So the screen held both the rule and its breach, six lines
// apart. That is what a rule written four times looks like just before it
// becomes four rules.
//
// ── the rule, in one sentence ─────────────────────────────────────────────
//
// A total is denominated in the currency its contributing rows share. When
// nothing contributed there is nothing to disagree with, so the gym's own
// setting is the honest label. When the rows state more than one currency —
// or state none — there is no single amount and the figure is withheld.
//
// ── why the gym's currency is NOT the fallback for a real total ───────────
//
// Because `tenants.currency` is not evidence about rows that were written
// before it was set, or before it was changed. `gym_payments.currency` and
// `membership_plans.currency` are both `not null`, so every contributing row
// states something; a total whose rows disagree is a bigger number and not a
// sum, and no rate exists anywhere in this product to make it one. Falling
// back to the gym's setting there does not rescue the figure, it relabels it.
//
// Nothing here reads a database or formats anything. The two surfaces render
// this differently — a `<Kpi>` with a note on the console, a `<Hero>` on the
// phone — so the sentence they print stays theirs and only the judgement is
// shared.

/** One currency code as this product compares them, or null for "nobody said".
 *
 *  The same normalisation `normaliseCurrency` in src/lib/gymRecord.ts performs,
 *  repeated here rather than imported for one reason: that module pulls in the
 *  supabase read helpers, and this one is a rule about two numbers that a
 *  screen with no database in front of it should be able to ask. ' gbp ' and
 *  'GBP' are one currency, and '' is not a currency at all. */
function code(currency: string | null | undefined): string | null {
  return (currency ?? '').trim().toUpperCase() || null;
}

/**
 * Why a total cannot be written down, or 'ok' when it can.
 *
 * 'unstated' is the state that did not exist before this module and is the
 * whole reason it does. A screen that folds it into "this gym has not set its
 * currency" sends an owner to Ops to set a field that is already set; a screen
 * that folds it into "nothing recorded yet" tells them their register is empty
 * when it is full. Both sentences were live.
 */
export type TotalGap =
  /** There is a figure and a currency to write it in. */
  | 'ok'
  /** There is no figure. Nothing is being withheld — nothing was computed. */
  | 'no_total'
  /** There is a figure and its rows do not agree on one currency between them,
   *  so no single amount exists to print. */
  | 'unstated'
  /** There is a figure, no row stated a currency because there were no rows,
   *  and the gym has not set one either. */
  | 'no_gym_currency';

export interface TotalMoney {
  /** What to render the total in, or null when it must be withheld. */
  currency: string | null;
  gap: TotalGap;
}

/**
 * Which currency a summed figure is in, and — when there is none — which
 * silence that is.
 *
 * `total` is the sum itself, and null means the summariser had nothing to add:
 * no payments in the window, no active membership on a priced plan. `stated` is
 * what the contributing rows agree on, from `sharedCurrency`. `gym` is
 * `tenants.currency`.
 *
 * A null `total` returns the gym's own currency rather than null, which looks
 * odd until you write the caller: it is the currency a dash would have been in,
 * and it keeps a tile's label stable while the figure underneath it is missing.
 * The `gap` says 'no_total' so nothing mistakes it for a figure.
 */
export function totalMoney(
  total: number | null | undefined,
  stated: string | null | undefined,
  gym: string | null | undefined,
): TotalMoney {
  const g = code(gym);
  if (total == null) return { currency: g, gap: 'no_total' };
  const s = code(stated);
  if (s) return { currency: s, gap: 'ok' };
  // Zero is zero in every money, so there is nothing here for two currencies to
  // disagree about and no reason to withhold it. This is not a corner: a gym
  // selling nothing but one-off plans has a recurring total of exactly 0 built
  // from no recurring rows at all, and `sharedCurrency` over that empty set
  // returns null for want of anything to state rather than out of conflict.
  // Reporting it as 'unstated' would print the mixed-ledger sentence at a gym
  // with one currency and one price list.
  if (total === 0) return emptyTotalMoney(g);
  // A figure exists and its rows named no one currency. There is no honest way
  // to print it, and the gym's setting is not a stand-in: see the header.
  return { currency: null, gap: 'unstated' };
}

/**
 * The same question for a total whose contributing rows are known to state
 * nothing — a count of zero rows, where `stated` is null for want of anything
 * to state rather than for disagreement.
 *
 * `sharedCurrency([])` is null and `sharedCurrency([a, b])` with a and b
 * disagreeing is also null, and the two are opposite facts. Only the caller
 * knows which it is holding, because only the caller counted the rows. This is
 * the branch for "there were none": nothing has contradicted the gym's own
 * setting, so that is what an empty total is denominated in.
 */
export function emptyTotalMoney(gym: string | null | undefined): TotalMoney {
  const g = code(gym);
  return g ? { currency: g, gap: 'ok' } : { currency: null, gap: 'no_gym_currency' };
}

/**
 * What a screen says under the dash where a mixed-currency total would go.
 *
 * One wording in one place, for the reason `NO_CURRENCY_NOTE` in
 * studio-web/lib/currency.ts, `NO_ZONE_NOTE` in src/lib/gymZone.ts and
 * `NO_CURRENCY_CHECK_NOTE` in src/lib/wholeUnits.ts all give. It deliberately
 * does NOT say the gym has not set a currency — that is the other sentence, it
 * is about a different missing thing, and telling an owner to go and set a
 * field they set last year is how a warning stops being read.
 */
export const MIXED_CURRENCY_NOTE =
  'The rows behind this figure are not all in one currency, so there is no '
  + 'single total to write. Nothing is missing from the register; adding two '
  + 'moneys together would need a rate this app does not hold.';
