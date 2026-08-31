// Reading and writing the gym's operating record: what it sells, who holds a
// membership, and what it has actually been paid.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymTrainers.ts for the same shape.
//
// Money is held in minor units (cents/fils) as integers everywhere. Floats do
// not belong anywhere near a ledger: 0.1 + 0.2 is a rounding error in a
// spreadsheet and a dispute in a gym.

import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

export type PlanInterval = 'month' | 'year' | 'once';
export type MembershipStatus = 'active' | 'frozen' | 'cancelled' | 'expired';
export type PaymentMethod = 'card' | 'cash' | 'transfer' | 'direct_debit' | 'other';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'overdue' | 'void' | 'written_off';

export interface MembershipPlan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: PlanInterval;
  active: boolean;
}

export interface Membership {
  id: string;
  memberId: string;
  memberName: string | null;
  planId: string | null;
  planName: string | null;
  startedOn: string;
  endsOn: string | null;
  status: MembershipStatus;
}

export interface GymPayment {
  id: string;
  memberId: string | null;
  memberName: string | null;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  takenAt: string;
  note: string | null;
}

/* ── plans ─────────────────────────────────────────────────────────────────── */

export async function fetchPlans(sb: Queryable, tenantId: string): Promise<MembershipPlan[]> {
  const { data, error } = await sb
    .from('membership_plans')
    .select('id, name, price_cents, currency, interval, active')
    .eq('tenant_id', tenantId)
    .order('active', { ascending: false })
    .order('price_cents', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, priceCents: r.price_cents,
    currency: r.currency, interval: r.interval, active: r.active,
  }));
}

/**
 * `currency` is REQUIRED, and it is required because it used to be optional.
 *
 * This wrote `plan.currency ?? 'AED'`. `membership_plans.currency` is `not null
 * default 'AED'`, so an omitted currency did not fail loudly — it landed as a
 * dirham price in a gym that has never seen a dirham, and every screen that
 * reads the price book afterwards reads that stamp as the gym's own answer.
 * A price is not a display; it is the record. There is no honest fallback for
 * the currency of money somebody is going to be charged, so the caller has to
 * have one, and a caller that does not must refuse to write rather than guess.
 */
export async function createPlan(
  sb: Queryable,
  tenantId: string,
  plan: { name: string; priceCents: number; interval: PlanInterval; currency: string },
): Promise<void> {
  const { error } = await sb.from('membership_plans').insert({
    tenant_id: tenantId,
    name: plan.name,
    price_cents: plan.priceCents,
    interval: plan.interval,
    currency: plan.currency,
  });
  if (error) throw error;
}

export async function setPlanActive(sb: Queryable, planId: string, active: boolean): Promise<void> {
  // Retired rather than deleted: memberships sold on a plan keep pointing at it,
  // and a price book with holes in it cannot be audited.
  //
  // Counted, because an UPDATE matching zero rows is not an error — see
  // src/lib/wroteRows.ts. `membership_plans_owner` is the only policy granting
  // UPDATE and it is `is_owner_of(tenant_id)`, so anybody else retires nothing
  // and, without this, is told the plan is off the price book while it is still
  // on sale.
  const r = await sb.from('membership_plans').update({ active }, { count: 'exact' }).eq('id', planId);
  if (r.error) throw r.error;
  assertWrote(active ? 'That plan' : 'Retiring that plan', r);
}

/* ── memberships ───────────────────────────────────────────────────────────── */

export async function fetchMemberships(sb: Queryable, tenantId: string): Promise<Membership[]> {
  const { data, error } = await sb
    .from('memberships')
    .select('id, member_id, plan_id, started_on, ends_on, status')
    .eq('tenant_id', tenantId)
    .order('started_on', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  // Every membership in the gym's history, not just the live ones — a gym a few
  // years old crosses a thousand rows without being large, and a truncated set
  // silently drops the oldest, which is exactly the set a revenue trend reads.
  const rows = assertWhole(data, "this gym's memberships");
  if (!rows.length) return [];

  const [names, planNames] = await Promise.all([
    namesFor(sb, rows.map((r: any) => r.member_id)),
    planNamesFor(sb, rows.map((r: any) => r.plan_id).filter(Boolean)),
  ]);

  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: names.get(r.member_id) ?? null,
    planId: r.plan_id ?? null,
    planName: r.plan_id ? planNames.get(r.plan_id) ?? null : null,
    startedOn: r.started_on,
    endsOn: r.ends_on ?? null,
    status: r.status,
  }));
}

export async function createMembership(
  sb: Queryable,
  tenantId: string,
  m: { memberId: string; planId: string | null; startedOn: string; endsOn?: string | null },
): Promise<void> {
  const { error } = await sb.from('memberships').insert({
    tenant_id: tenantId,
    member_id: m.memberId,
    plan_id: m.planId,
    started_on: m.startedOn,
    ends_on: m.endsOn ?? null,
  });
  if (error) throw error;
}

/**
 * Freeze, cancel or reactivate a membership.
 *
 * The count is checked because this is money. A PostgREST UPDATE that matches
 * zero rows returns 204 with no error, so before this the desk flow was: the
 * owner taps Freeze, the confirmation closes, the list reloads, and the
 * membership is still active — and the only signal that nothing happened is a
 * status the owner has already stopped looking at. `memberships_owner`
 * (`is_owner_of(tenant_id)`) is the only policy granting UPDATE, so an owner of
 * another gym, a trainer, or a stale id all land in exactly that silence, and a
 * membership somebody was told was frozen keeps billing them.
 */
export async function setMembershipStatus(
  sb: Queryable, membershipId: string, status: MembershipStatus,
): Promise<void> {
  const r = await sb.from('memberships').update({ status }, { count: 'exact' }).eq('id', membershipId);
  if (r.error) throw r.error;
  assertWrote('That membership', r);
}

/* ── payments ──────────────────────────────────────────────────────────────── */

export async function fetchPayments(
  sb: Queryable, tenantId: string, sinceISO?: string,
): Promise<GymPayment[]> {
  let q = sb
    .from('gym_payments')
    .select('id, member_id, amount_cents, currency, method, taken_at, note')
    .eq('tenant_id', tenantId)
    .order('taken_at', { ascending: false });
  if (sinceISO) q = q.gte('taken_at', sinceISO);
  q = q.limit(capLimit());
  const { data, error } = await q;
  if (error) throw error;
  // Payments are what the gym was paid. A truncated read here does not make the
  // figure smaller, it makes it wrong, and it is the number an owner reconciles
  // against a bank statement.
  assertWhole(data, 'this gym\u2019s payments');
  const rows = data ?? [];
  if (!rows.length) return [];

  const names = await namesFor(sb, rows.map((r: any) => r.member_id).filter(Boolean));
  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    memberName: r.member_id ? names.get(r.member_id) ?? null : null,
    amountCents: r.amount_cents,
    currency: r.currency,
    method: r.method,
    takenAt: r.taken_at,
    note: r.note ?? null,
  }));
}

/**
 * `currency` is REQUIRED, for the same reason as `createPlan` and with a worse
 * history.
 *
 * This wrote `p.currency ?? 'AED'`, and `gym_payments.currency` is `not null
 * default 'AED'`, so the omission was invisible at every layer. The Members
 * screen's payment form had its LABEL corrected to the gym's own currency
 * while this write was left alone: a GBP gym's owner read "Amount (GBP)",
 * typed 50, and 50 dirhams went into the ledger — permanently, and read back
 * as fact by the accounting and month-end screens that reconcile against a
 * bank statement. A half-corrected currency is worse than an uncorrected one,
 * because the label is what makes the owner confident.
 *
 * A caller that does not know the gym's currency must not record the payment.
 * There is nothing to fall back on: the amount was handed over in some real
 * money and no default can find out which.
 */
export async function recordPayment(
  sb: Queryable,
  tenantId: string,
  p: {
    memberId: string | null;
    amountCents: number;
    method: PaymentMethod;
    takenAt?: string;
    note?: string | null;
    recordedBy?: string | null;
    currency: string;
  },
): Promise<void> {
  const { error } = await sb.from('gym_payments').insert({
    tenant_id: tenantId,
    member_id: p.memberId,
    amount_cents: p.amountCents,
    method: p.method,
    taken_at: p.takenAt ?? new Date().toISOString(),
    note: p.note ?? null,
    recorded_by: p.recordedBy ?? null,
    currency: p.currency,
  });
  if (error) throw error;
}

/* ── derived, and honest about it ──────────────────────────────────────────── */

export interface RevenueSummary {
  /** Total taken in the window, in minor units. Null when nothing is recorded —
   *  a gym that has recorded no payments has not necessarily taken nothing. */
  takenCents: number | null;
  payments: number;
  /** Recurring value of active memberships per month, or null when no priced
   *  plan is attached to any of them. */
  mrrCents: number | null;
  activeMembers: number;

  /* ── what money each of those two sums is in ────────────────────────────
   *
   * Both totals add rows up and IGNORE what currency each row states. That was
   * invisible while every gym was in the UAE and is a wrong number the moment
   * one is not: `gym_payments.currency` and `membership_plans.currency` are
   * both `not null default 'AED'`, so any row written before those write paths
   * demanded a currency is a dirham row. A London gym that has since set GBP
   * had those dirhams added to its pounds and the result labelled GBP, on the
   * first tile of the Overview and of Plans & payments — the two figures an
   * owner reads before anything else.
   *
   * Reported rather than fixed inside the sum, because there is no fixing it
   * here: adding dirhams to pounds has no answer without a rate nobody has.
   * Null means the contributing rows do NOT agree on one currency, and a caller
   * holding a null must withhold the figure and say why — which is what
   * /revenue, /accounting and /close already do for their own totals.
   *
   * Null is also what an EMPTY set gives, and that is correct for the same
   * reason: no rows have stated anything, so the caller falls back to the gym's
   * own `tenants.currency`, which is the only thing left that anybody chose.
   */
  takenCurrency: string | null;
  mrrCurrency: string | null;
}

/**
 * The one currency a set of rows shares, or null when it shares none.
 *
 * A row stating NO currency does not agree with the others — it is silent, and
 * silence is not consent to whatever the rest of them say. Exported because
 * /revenue's `oneCurrency` is this same rule written a second time, and a rule
 * about money that exists twice will eventually be two rules.
 */
export function sharedCurrency(rows: Array<{ currency?: string | null }>): string | null {
  if (!rows.length) return null;
  // Empty string is normalised to null for the same reason money() refuses it:
  // "" and null are the same fact — nobody has said — and letting "" through as
  // a shared value would hand a caller a truthy-looking answer that prints as a
  // leading space in front of somebody's money.
  const seen = new Set(rows.map((r) => (r.currency ?? '').trim().toUpperCase() || null));
  return seen.size === 1 ? ([...seen][0] ?? null) : null;
}

export function summarise(
  payments: GymPayment[],
  memberships: Membership[],
  plans: MembershipPlan[],
): RevenueSummary {
  const takenCents = payments.length
    ? payments.reduce((a, p) => a + p.amountCents, 0)
    : null;

  const byPlan = new Map(plans.map((p) => [p.id, p]));
  const active = memberships.filter((m) => m.status === 'active');

  // Only memberships on a priced plan can contribute. If none do, the answer is
  // "not known", not zero.
  let mrr = 0;
  let priced = 0;
  // The plans that actually CONTRIBUTE, so the currency question is asked of
  // exactly the rows in the sum. A `once` plan is in the price book and not in
  // this figure, and a currency it alone disagreed on would have withheld a
  // total it never touched.
  const contributing: MembershipPlan[] = [];
  for (const m of active) {
    const plan = m.planId ? byPlan.get(m.planId) : undefined;
    if (!plan) continue;
    priced++;
    if (plan.interval === 'month') mrr += plan.priceCents;
    else if (plan.interval === 'year') mrr += Math.round(plan.priceCents / 12);
    // `once` is not recurring and contributes nothing to a monthly figure.
    else continue;
    contributing.push(plan);
  }

  return {
    takenCents,
    payments: payments.length,
    mrrCents: priced ? mrr : null,
    activeMembers: active.length,
    takenCurrency: sharedCurrency(payments),
    mrrCurrency: sharedCurrency(contributing),
  };
}

/**
 * A minor-unit amount, rendered with the currency it is an amount of.
 *
 * ── THE 'AED' DEFAULT IS GONE, AND THIS IS WHY ─────────────────────────────
 *
 * This used to read `currency = 'AED'`. A caller who forgot the second
 * argument printed a currency the gym may not use, with no error, nothing to
 * notice, and — worst of all — a result that LOOKS considered. Nobody reads
 * "AED 6,300.00" as a missing setting.
 *
 * It was not hypothetical. 33 call sites across ten console pages called this
 * bare, and TWO OF THEM WROTE THE RESULT TO DISK — `recordSettlement` stamped
 * `run.currency ?? 'AED'`, so every settlement a non-UAE gym ever made was
 * stored as dirhams and read back as fact by the accounting and month-end
 * screens. A payment form's LABEL was corrected to the gym's currency while
 * the WRITE beside it was not, so a GBP gym stored dirhams permanently. The
 * default was the root cause of both, and a comment explaining a hazard is not
 * a fix for it.
 *
 * ── WHAT REPLACES IT ──────────────────────────────────────────────────────
 *
 * Nothing. There is no fallback currency here and there must never be one.
 * `tenants.currency` is nullable ON PURPOSE: NULL means the gym has not told
 * us, and the standing rule is render a dash and ask, never assume. So an
 * absent, empty or null currency returns **null**, exactly as an absent amount
 * does — one silence, one dash, and the caller says in its note which of the
 * two silences it is. A figure whose currency is unknown is withheld; it is
 * not printed bare (a bare "6,300.00" is read in whatever money the reader is
 * thinking in) and it is not printed in a guess.
 *
 * ── THE PARAMETER IS NOW REQUIRED ─────────────────────────────────────────
 *
 * It was `currency?:` for exactly one reason: `src/lib/exportShare.ts` was the
 * last bare call in the tree and belonged to another change. That call now
 * takes `OwnerReportData.currency` and passes it, so the exemption is spent and
 * the rule is a TYPE ERROR rather than a lint. `scripts/check-currency.mjs`
 * still enforces the arity statically — it catches the same mistake in the
 * console's JS-shaped call sites and in anything that reaches this through an
 * `any` — but a forgotten currency now fails to compile first, which is where
 * a rule about a permanent record belongs.
 *
 * Passing an explicit `null` is still allowed and still means "nobody has told
 * us", which renders a dash. That is the point: the caller has to have looked.
 *
 * `gymMoney` in src/ui/tenant.tsx and `amount()` in studio-web/lib/currency.ts
 * both take a currency and are the preferred doors.
 */
export function money(cents: number | null | undefined, currency: string | null | undefined): string | null {
  if (cents == null) return null;
  // Not `currency ?? ''`: an empty-string currency is the same fact as a null
  // one — nobody has said — and printing " 6,300.00" with a leading space is
  // the bare figure this function exists to refuse.
  if (!currency) return null;
  return `${currency} ${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

async function namesFor(sb: Queryable, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  // no-error-ok: an unreadable name becomes null and renders as a dash; the row it labels is still real
  const { data } = await sb.from('profiles').select('id, full_name').in('id', unique);
  return new Map((data ?? []).map((p: any) => [p.id, (p.full_name || '').trim()]));
}

async function planNamesFor(sb: Queryable, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  // no-error-ok: an unreadable plan name becomes null and renders as a dash; the membership row is still real
  const { data } = await sb.from('membership_plans').select('id, name').in('id', unique);
  return new Map((data ?? []).map((p: any) => [p.id, p.name]));
}

