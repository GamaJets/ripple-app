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

export async function createPlan(
  sb: Queryable,
  tenantId: string,
  plan: { name: string; priceCents: number; interval: PlanInterval; currency?: string },
): Promise<void> {
  const { error } = await sb.from('membership_plans').insert({
    tenant_id: tenantId,
    name: plan.name,
    price_cents: plan.priceCents,
    interval: plan.interval,
    currency: plan.currency ?? 'AED',
  });
  if (error) throw error;
}

export async function setPlanActive(sb: Queryable, planId: string, active: boolean): Promise<void> {
  // Retired rather than deleted: memberships sold on a plan keep pointing at it,
  // and a price book with holes in it cannot be audited.
  const { error } = await sb.from('membership_plans').update({ active }).eq('id', planId);
  if (error) throw error;
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

export async function setMembershipStatus(
  sb: Queryable, membershipId: string, status: MembershipStatus,
): Promise<void> {
  const { error } = await sb.from('memberships').update({ status }).eq('id', membershipId);
  if (error) throw error;
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
    currency?: string;
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
    currency: p.currency ?? 'AED',
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
  for (const m of active) {
    const plan = m.planId ? byPlan.get(m.planId) : undefined;
    if (!plan) continue;
    priced++;
    if (plan.interval === 'month') mrr += plan.priceCents;
    else if (plan.interval === 'year') mrr += Math.round(plan.priceCents / 12);
    // `once` is not recurring and contributes nothing to a monthly figure.
  }

  return {
    takenCents,
    payments: payments.length,
    mrrCents: priced ? mrr : null,
    activeMembers: active.length,
  };
}

/** Minor units to a readable amount. Returns null for null so a caller cannot
 *  accidentally render "0.00" for something unknown. */
export function money(cents: number | null | undefined, currency = 'AED'): string | null {
  if (cents == null) return null;
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

