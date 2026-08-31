// ── What a paying member is entitled to know about themselves ───────────────
//
// The gym's operating record (supabase/parts/29-gym-operating-record.sql) holds
// three facts a member cannot currently find anywhere in the app: which plan
// they are on, whether it is still running, and what they have actually paid.
// app/(client)/membership.tsx used to print a plan and a validity date that no
// billing system had issued; those were removed and replaced with nothing, so
// the screen went from wrong to silent. This module is what replaces them with
// the real record.
//
// Framework-agnostic, the shape src/lib/gymRecord.ts and src/lib/gymPasses.ts
// already use: the Supabase client comes in as an argument, so the rules below
// are testable without a database and the phone app is not the only thing that
// could ever call them.
//
// ── The three rules this file exists to keep ───────────────────────────────
//
// 1. A PLAN NOBODY COULD READ IS NOT "NO PLAN". `memberships.plan_id` is
//    nullable — part 29 sets it null when a plan is deleted — so a membership
//    with no plan attached is a real state, and the sentence for it is "your
//    gym has not recorded a plan". A membership whose plan row came back empty
//    because the read was refused is a DIFFERENT state, and saying the first
//    sentence there is a lie told to somebody who is being charged every month.
//
//    This was live, not hypothetical. `membership_plans_tenant_r` reads
//    `tenant_id = my_tenant() and active`, so a member on a RETIRED plan could
//    read their membership row and not the plan it points at — and over
//    PostgREST an embedded `membership_plans(...)` comes back as `null` in both
//    cases, byte-identical. Fixed at the database in part 125, and still
//    distinguished here: the plan is fetched as its own query keyed on the
//    plan_id we already hold, so "the gym recorded no plan" and "the plan did
//    not come back" cannot collapse into one another again if a future policy
//    change reopens the hole.
//
// 2. THE STATUS COLUMN IS NOT THE ANSWER, THE DATES ARE. `memberships.status`
//    is set by hand in the owner console and nothing in the schema moves it
//    when `ends_on` passes. A membership reading 'active' with an end date in
//    March is expired, and telling its holder they are current is how somebody
//    turns up to a gym that will not let them in.
//
// 3. MONEY IS NEVER SUMMED ACROSS CURRENCIES. `gym_payments` rows carry their
//    own `currency` — Repple is white-label and a member may genuinely have
//    paid one gym in AED and another in GBP — so a total is per currency or it
//    is not a total. There is no default currency in this file and no symbol
//    table; an amount whose currency did not come back says so.
import { capLimit, capped } from './rowCap';

type Queryable = { from: (table: string) => any };

export type MembershipStatus = 'active' | 'frozen' | 'cancelled' | 'expired';
export type PlanInterval = 'month' | 'year' | 'once';
export type PaymentMethod = 'card' | 'cash' | 'transfer' | 'direct_debit' | 'other';

export interface MemberPlan {
  id: string;
  name: string;
  priceCents: number;
  /** ISO 4217 as the gym recorded it. Never defaulted — see rule 3. */
  currency: string | null;
  interval: PlanInterval;
  /** Whether the gym still sells it. A retired plan is still YOUR plan. */
  active: boolean;
}

export interface MemberMembership {
  id: string;
  tenantId: string;
  startedOn: string;
  /** Null is open-ended, which is NOT the same as expired. */
  endsOn: string | null;
  /** What the owner console last wrote. Read `standingOf`, not this. */
  status: MembershipStatus;
  /** Null means the gym attached no plan to this membership. */
  planId: string | null;
  /** Null WITH a planId set means the plan row did not come back. Rule 1. */
  plan: MemberPlan | null;
}

export interface MemberPayment {
  id: string;
  amountCents: number;
  /** As recorded on the row. Null means the gym did not record one. */
  currency: string | null;
  method: PaymentMethod | null;
  /** timestamptz — an instant, not a calendar day. */
  takenAt: string;
  membershipId: string | null;
}

/**
 * A read that either landed or did not.
 *
 * `{ ok: false }` is deliberately not an empty array. supabase-js resolves on a
 * database error with `data: null`, and `data ?? []` is how "no payments yet"
 * gets said to somebody who has paid — the failure this codebase keeps finding.
 */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/* ── pure rules ───────────────────────────────────────────────────────────── */

/** A local calendar day as YYYY-MM-DD. Built from the local getters on purpose:
 *  a membership ends on a day in the reader's own life, not at a UTC instant. */
export function todayIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Whole days from `from` to `to`, both bare ISO dates. Null if either is not one.
 *
 * Done in UTC from parsed components rather than by constructing local Dates:
 * the difference between two local midnights is not 24h across a DST boundary,
 * and `npm run test:zones` runs this file in Los Angeles, Auckland and Dubai.
 */
export function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from).trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(to).trim());
  if (!a || !b) return null;
  const ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3]);
  return Math.round(ms / 86400000);
}

/** How many days out counts as "expiring soon" rather than "current". */
export const EXPIRING_SOON_DAYS = 30;

/**
 * Where a membership actually stands today.
 *
 * `kind` is what the screen branches on; every variant carries what the
 * sentence about it needs, so no caller has to reach back into the row and
 * make its own decision about a null.
 */
export type Standing =
  /** Running, with no end date on record. Open-ended is a real arrangement. */
  | { kind: 'open'; }
  /** Running, and the gym has recorded when it runs out. */
  | { kind: 'current'; endsOn: string; daysLeft: number }
  /** Running, and out within EXPIRING_SOON_DAYS. */
  | { kind: 'expiring'; endsOn: string; daysLeft: number }
  /** Past its end date. `stale` means the status column still said 'active'. */
  | { kind: 'expired'; endsOn: string | null; stale: boolean }
  | { kind: 'frozen'; endsOn: string | null }
  | { kind: 'cancelled'; endsOn: string | null }
  /** Sold, but not started yet. */
  | { kind: 'upcoming'; startsOn: string; daysUntil: number | null };

/**
 * The membership's real standing on `today`, from the dates first and the
 * status column second.
 *
 * The order matters and it is rule 2. 'cancelled' and 'frozen' are decisions
 * somebody made and no date overrides them. 'active' is not a decision, it is
 * the default every row is inserted with, and it goes stale on its own the
 * moment `ends_on` passes with no job to move it — so an 'active' row past its
 * end date is reported EXPIRED, and `stale: true` records that the database
 * still disagrees.
 *
 * A membership ending today is good today, the same rule `isExpired` in
 * gymPasses.ts keeps: a gym that turns somebody away on the last day of what
 * they bought has a complaint, not a policy.
 */
export function standingOf(
  m: Pick<MemberMembership, 'status' | 'startedOn' | 'endsOn'>,
  today: string,
): Standing {
  if (m.status === 'cancelled') return { kind: 'cancelled', endsOn: m.endsOn };
  if (m.status === 'frozen') return { kind: 'frozen', endsOn: m.endsOn };
  if (m.status === 'expired') return { kind: 'expired', endsOn: m.endsOn, stale: false };
  // status === 'active' from here.
  if (m.endsOn && m.endsOn < today) return { kind: 'expired', endsOn: m.endsOn, stale: true };
  if (m.startedOn > today) {
    return { kind: 'upcoming', startsOn: m.startedOn, daysUntil: daysBetween(today, m.startedOn) };
  }
  if (!m.endsOn) return { kind: 'open' };
  const daysLeft = daysBetween(today, m.endsOn);
  // An unparseable end date is not a licence to call the membership current.
  if (daysLeft == null) return { kind: 'open' };
  return daysLeft <= EXPIRING_SOON_DAYS
    ? { kind: 'expiring', endsOn: m.endsOn, daysLeft }
    : { kind: 'current', endsOn: m.endsOn, daysLeft };
}

/** True while the member may actually use the gym on `today`. */
export function isCurrent(s: Standing): boolean {
  return s.kind === 'open' || s.kind === 'current' || s.kind === 'expiring';
}

/** One word for the standing, for a badge. */
export function standingLabel(s: Standing): string {
  switch (s.kind) {
    case 'open': return 'Active';
    case 'current': return 'Active';
    case 'expiring': return 'Ending soon';
    case 'expired': return 'Expired';
    case 'frozen': return 'Frozen';
    case 'cancelled': return 'Cancelled';
    case 'upcoming': return 'Starts soon';
  }
}

/**
 * The plan, as three states a screen must say three different things about.
 * Rule 1. Callers branch on `kind`; there is no way to reach this information
 * by testing a single null.
 */
export type PlanState =
  | { kind: 'plan'; plan: MemberPlan }
  /** The gym attached no plan to this membership. A true, sayable fact. */
  | { kind: 'none' }
  /** A plan is attached and we could not read it. NOT the same as 'none'. */
  | { kind: 'unreadable' };

export function planStateOf(m: Pick<MemberMembership, 'planId' | 'plan'>): PlanState {
  if (!m.planId) return { kind: 'none' };
  return m.plan ? { kind: 'plan', plan: m.plan } : { kind: 'unreadable' };
}

/**
 * An amount, with the currency the row itself carries.
 *
 * ISO code and never a symbol. Repple is white-labelled into gyms whose
 * currency this codebase has not met, and src/lib/billing.ts records what
 * guessing costs: its symbol table mapped everything it did not recognise to
 * `$`, so a gym billed in dirhams read its own invoices in dollars. "AED
 * 200.00" is unambiguous in every market; "$200.00" is a different amount.
 *
 * There is no default currency. A row with none says so rather than borrowing
 * one, because a receipt is the document a member would take to a dispute.
 */
export function amount(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const v = (cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const c = (currency || '').trim().toUpperCase();
  return c ? `${c} ${v}` : `${v} (currency not recorded)`;
}

export interface CurrencyTotal {
  /** Null is the bucket for rows that recorded no currency. */
  currency: string | null;
  cents: number;
  count: number;
}

/**
 * What has been paid, per currency, and never across them.
 *
 * Rule 3. Adding 20000 AED-cents to 9900 GBP-cents produces 29900 of nothing,
 * and a member reading it as their spend at this gym would be reading a number
 * that does not exist. Rows whose currency was not recorded get their own
 * bucket rather than being folded into the biggest one.
 *
 * Sorted by currency so the order does not depend on which payment came back
 * first; the null bucket sorts last, where an oddity belongs.
 */
export function totalsByCurrency(payments: Pick<MemberPayment, 'amountCents' | 'currency'>[]): CurrencyTotal[] {
  const buckets = new Map<string, CurrencyTotal>();
  for (const p of payments) {
    if (!Number.isFinite(p.amountCents)) continue;
    const c = (p.currency || '').trim().toUpperCase() || null;
    const key = c ?? '￿';
    const b = buckets.get(key);
    if (b) { b.cents += p.amountCents; b.count += 1; }
    else buckets.set(key, { currency: c, cents: p.amountCents, count: 1 });
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

/** How the gym took the money, as a person would say it. */
export function methodLabel(m: PaymentMethod | null | undefined): string {
  switch (m) {
    case 'card': return 'Card';
    case 'cash': return 'Cash';
    case 'transfer': return 'Bank transfer';
    case 'direct_debit': return 'Direct debit';
    case 'other': return 'Other';
    default: return 'Not recorded';
  }
}

/**
 * What to say about renewal — WITHOUT inventing a date.
 *
 * The old screen printed "Valid until <today + 1 year>", a number no billing
 * system had issued, and that is the exact trap this function exists to refuse.
 * A monthly plan with no `ends_on` renews monthly and the gym has recorded no
 * date; the honest sentence says both halves. Nothing here computes a next
 * charge from an interval, because a gym that has not written the date down has
 * not told us the date.
 */
export function renewalNote(s: Standing, plan: PlanState): string {
  const every = plan.kind === 'plan'
    ? (plan.plan.interval === 'month' ? 'Renews monthly'
      : plan.plan.interval === 'year' ? 'Renews yearly'
      : 'A one-off — this does not renew')
    : null;
  switch (s.kind) {
    case 'open':
      return every
        ? (plan.kind === 'plan' && plan.plan.interval === 'once'
          ? 'A one-off — this does not renew'
          : `${every}. Your gym has not recorded an end date.`)
        : 'Open-ended — your gym has not recorded an end date.';
    case 'current':
    case 'expiring':
      return every ? `${every}. Runs to ${s.endsOn}.` : `Runs to ${s.endsOn}.`;
    case 'expired':
      return s.stale
        ? 'Your gym still has this marked active, but the end date has passed. Ask at reception before you travel to a session.'
        : 'This has ended.';
    case 'frozen':
      return 'Frozen by your gym. Ask reception when it restarts.';
    case 'cancelled':
      return 'Cancelled.';
    case 'upcoming':
      return `Starts ${s.startsOn}.`;
  }
}

/* ── the reads ────────────────────────────────────────────────────────────── */

const MEMBERSHIP_COLUMNS = 'id, tenant_id, plan_id, started_on, ends_on, status';
const PAYMENT_COLUMNS = 'id, amount_cents, currency, method, taken_at, membership_id';

// `note` is in neither list, and that is deliberate. Both tables carry a
// free-text `note` the OWNER console writes, and RLS cannot keep an owner's
// private remark about a member away from that member — owners authenticate as
// `authenticated` too, so a column-level revoke would take the column from the
// console as well. Not selecting it is the part this app controls.
// `recorded_by` is left out for the same reason: which member of staff took the
// cash is the gym's business, not the receipt's.

const asStatus = (v: unknown): MembershipStatus =>
  (v === 'frozen' || v === 'cancelled' || v === 'expired') ? v : 'active';

const asInterval = (v: unknown): PlanInterval =>
  (v === 'year' || v === 'once') ? v : 'month';

const asMethod = (v: unknown): PaymentMethod | null =>
  (v === 'card' || v === 'cash' || v === 'transfer' || v === 'direct_debit' || v === 'other') ? v : null;

/**
 * Every membership this member holds, newest first, with its plan attached.
 *
 * Two queries rather than one embedded select. PostgREST would happily return
 * `membership_plans: null` for a plan it was not allowed to read, and that is
 * indistinguishable from a membership with no plan — see rule 1. Fetching the
 * plans by the ids we already hold means a plan that does not come back leaves
 * `plan: null` beside a non-null `planId`, which `planStateOf` reports as
 * 'unreadable' and the screen says out loud.
 *
 * A failed PLAN read does not fail the whole call: the membership is real and
 * worth showing without its price. A failed MEMBERSHIP read does, because the
 * alternative is an empty list that reads as "you have no membership".
 */
export async function fetchMyMemberships(sb: Queryable, uid: string): Promise<Read<MemberMembership[]>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('memberships')
      .select(MEMBERSHIP_COLUMNS)
      .eq('member_id', uid)
      .order('started_on', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    // A member with more than a thousand memberships does not exist, but the
    // probe row must never be rendered as one — see src/lib/rowCap.ts.
    const rows = capped((data as any[]) ?? []).rows;

    const planIds = [...new Set(rows.map((r) => r.plan_id).filter(Boolean))] as string[];
    const plans = new Map<string, MemberPlan>();
    if (planIds.length) {
      const { data: planRows, error: planErr } = await sb.from('membership_plans')
        .select('id, name, price_cents, currency, interval, active')
        .in('id', planIds);
      // Reported by leaving the plan off, not by failing the membership. The
      // membership is a fact whether or not its price came back.
      if (!planErr) {
        for (const p of (planRows as any[]) ?? []) {
          plans.set(p.id, {
            id: p.id,
            name: typeof p.name === 'string' ? p.name : '',
            priceCents: Number(p.price_cents),
            currency: typeof p.currency === 'string' && p.currency.trim() ? p.currency : null,
            interval: asInterval(p.interval),
            active: p.active !== false,
          });
        }
      }
    }

    return { ok: true, value: rows.map((r): MemberMembership => ({
      id: r.id,
      tenantId: r.tenant_id,
      startedOn: r.started_on,
      endsOn: r.ends_on ?? null,
      status: asStatus(r.status),
      planId: r.plan_id ?? null,
      plan: r.plan_id ? (plans.get(r.plan_id) ?? null) : null,
    })) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

export interface PaymentsPage {
  rows: MemberPayment[];
  /** True when there are more payments than came back. A screen may LIST these
   *  and must NOT total them — a subtotal shown as a total is the whole reason
   *  src/lib/rowCap.ts exists. */
  truncated: boolean;
}

/** Every payment the gym recorded against this member, newest first. */
export async function fetchMyPayments(sb: Queryable, uid: string): Promise<Read<PaymentsPage>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('gym_payments')
      .select(PAYMENT_COLUMNS)
      .eq('member_id', uid)
      .order('taken_at', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const page = capped((data as any[]) ?? []);
    return { ok: true, value: {
      truncated: page.truncated,
      rows: page.rows.map((r): MemberPayment => ({
        id: r.id,
        amountCents: Number(r.amount_cents),
        currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
        method: asMethod(r.method),
        takenAt: r.taken_at,
        membershipId: r.membership_id ?? null,
      })),
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * The one membership a "Membership" screen should lead with.
 *
 * Not simply the newest row: a member can hold a cancelled membership sold
 * yesterday and a running one sold last year, and leading with the cancelled
 * one tells somebody who is paid up that they are not. Current beats not
 * current; among equals, the one that started most recently.
 */
export function primaryMembership(rows: MemberMembership[], today: string): MemberMembership | null {
  if (!rows.length) return null;
  const rank = (m: MemberMembership): number => {
    const s = standingOf(m, today);
    if (isCurrent(s)) return 0;
    if (s.kind === 'upcoming') return 1;
    if (s.kind === 'frozen') return 2;
    return 3;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.startedOn.localeCompare(a.startedOn))[0];
}
