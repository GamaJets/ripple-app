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
import { chunkIds, uniqueIds } from './idLookup';
// The zero-decimal list and the one function that knows how to turn minor units
// into a printable figure. Imported rather than re-derived: a second copy of
// that list is a second thing to forget a currency in, and this file used to
// hold the forgetting — see the note on `amount` below.
import { minorMoney } from './coachMoney';
import { appLocale } from './locale';
// Type only, and it has to stay type only. `memberInvoices.ts` imports
// `daysBetween` from this file as a VALUE; a value import back the other way
// would be a require() cycle at runtime. A `import type` is erased entirely, so
// the two modules share one definition of an invoice row and neither loads the
// other.
import type { MemberInvoice } from './memberInvoices';

type Queryable = { from: (table: string) => any };

export type MembershipStatus = 'active' | 'frozen' | 'cancelled' | 'expired';
export type PlanInterval = 'month' | 'year' | 'once';
export type PaymentMethod = 'card' | 'cash' | 'transfer' | 'direct_debit' | 'other';

export interface MemberPlan {
  id: string;
  name: string;
  /**
   * Minor units, or NULL when the gym recorded no price.
   *
   * Null and not 0. `membership_plans.price_cents` is `integer not null` today,
   * so this is a defence rather than a live bug — the same position
   * src/lib/membershipOrder.ts takes about `gym_orders.amount_cents`. What it
   * defends against is one `drop not null` away: the reader was
   * `Number(p.price_cents)`, `Number(null)` is 0, and 0 is a price. A member on
   * a plan whose price column had gone null would have read "AED 0.00" — a
   * figure this gym never set, on the screen whose whole job is to be the
   * record of what they are charged. `amount()` already prints '—' for null,
   * so the honest silence was one coercion away the whole time.
   */
  priceCents: number | null;
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
  /**
   * First day of a pause, inclusive, as a bare 'YYYY-MM-DD'. Null means no
   * pause is recorded — which is NOT the same as one this build could not read.
   * src/lib/membershipFreeze.ts keeps those two apart and this screen says so.
   */
  frozenFrom: string | null;
  /** Last day of a pause, inclusive. Both dates or neither: the check
   *  constraint `memberships_freeze_range_check` (supabase/parts/2616) refuses
   *  half a range at the write, so a single date here is a row that came back
   *  wrong, and `freezeState` reports it 'unreadable' rather than 'none'. */
  frozenTo: string | null;
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
 *
 * ── THE DIVISION IS A PROPERTY OF THE CURRENCY, NOT OF MONEY ──────────────
 *
 * This function used to be `(cents / 100).toFixed(2)` with no reference to the
 * currency at all, and that is wrong in sixteen of them. There is no sen in a
 * yen: a ¥5,000 class fee is stored as 5000 minor units, so dividing by a
 * hundred showed a member "JPY 50.00" for something they paid five thousand
 * yen for — a hundredth of the real figure, on the one screen in the app whose
 * whole job is to be the record of what they were charged. The same is true of
 * KRW, VND, CLP and the rest of `ZERO_DECIMAL`.
 *
 * So the body is now `minorMoney` from src/lib/coachMoney.ts, which was already
 * carrying the zero-decimal list for the coach's side of exactly this money.
 * One list, tested in one place; a second copy here is a second thing to forget
 * a currency in.
 *
 * ── AND WITH NO CURRENCY, THE SCALE IS UNKNOWN TOO ────────────────────────
 *
 * The no-currency branch used to divide anyway and print "50.00 (currency not
 * recorded)". That parenthesis is honest about the unit and silent about the
 * far bigger problem: without knowing the currency we do not know whether the
 * stored integer is hundredths of something or whole units of it, so the
 * decimal point itself is a guess. The stored integer is printed instead. It is
 * the one number we actually hold, and it is not dressed up as an amount that
 * has been converted into anything.
 */
export function amount(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const stated = minorMoney(cents, currency);
  if (stated) return stated;
  return `${cents.toLocaleString(appLocale())} (currency not recorded)`;
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

// `frozen_from, frozen_to` are here as of supabase/parts/2616 and they are the
// member's business before they are anybody else's. `memberships_own_r` is
// `member_id = auth.uid()` and there is not one column grant on this table, so
// the member was ALREADY permitted to read them — they were simply never asked
// for, and the screen showed the bare word "Frozen" with no date it lifts.
const MEMBERSHIP_COLUMNS = 'id, tenant_id, plan_id, started_on, ends_on, status, frozen_from, frozen_to';
const PAYMENT_COLUMNS = 'id, amount_cents, currency, method, taken_at, membership_id';

// `note` is in neither list, and that is deliberate. Both tables carry a
// free-text `note` the OWNER console writes, and RLS cannot keep an owner's
// private remark about a member away from that member — owners authenticate as
// `authenticated` too, so a column-level revoke would take the column from the
// console as well. Not selecting it is the part this app controls.
// `recorded_by` is left out for the same reason: which member of staff took the
// cash is the gym's business, not the receipt's.
//
// `gym_payments.payer_name` is left out too, and for a third reason that is
// worth writing down rather than leaving to look like an oversight. It is not a
// field anybody types: supabase/parts/184 adds it so that ERASING a member does
// not unbalance the books — the erasure copies the profile's `full_name` onto
// every payment row on its way out, so the gym keeps a name against the money
// after the account is gone. On a row belonging to a member who is still here
// it is null, and on the one where it is not, it is that member's own former
// name being read back to them. There is nothing in it for the person this
// screen is for.
//
// `gym_invoices.note` IS selected, and it is the one exception. The console
// writes it through a field labelled "What it is for"
// (studio-web/app/accounting/page.tsx), so on an invoice it is not a private
// remark ABOUT the member — it is the description OF the charge, and it is the
// only description the row carries. An invoice showing an amount, a date and no
// statement of what it covers is the complaint this screen exists to answer.
// The residual risk is real and is stated here rather than hidden: a gym could
// type something private into a field its own console calls the purpose of the
// bill. `drop_reason` (part 2642) is NOT selected — that one is the gym's own
// record of why it stopped chasing money, addressed to itself.

/**
 * Minor units, or null for anything that is not a number.
 *
 * A `bigint` arrives from PostgREST as a string often enough that every money
 * reader in this codebase coerces one; what none of them may do is coerce an
 * ABSENCE, because `Number(null)` is 0 and 0 is a price somebody could have
 * paid. Same five lines and same reasoning as `minorOrNull` in
 * src/lib/membershipOrder.ts — that one is a module-private const and this file
 * may not reach into it, so the duplication is stated here rather than left to
 * look like an oversight.
 */
const minorOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

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
    // Chunked. The memberships read above is `capLimit()`, so `planIds` is
    // bounded at a thousand rather than by anything about this member, and past
    // roughly two hundred uuids the `in.("…","…")` list overruns the 8KB
    // request line. The 414 comes back as `data: null` with an error, which the
    // `if (!planErr)` below correctly declines to fail on — and then EVERY
    // membership renders 'unreadable' beside a non-null planId, which is the
    // screen saying, of a member's whole history at once, that their plan could
    // not be read. That sentence is meant for one plan RLS refused.
    for (const chunk of chunkIds(uniqueIds(planIds))) {
      const { data: planRows, error: planErr } = await sb.from('membership_plans')
        .select('id, name, price_cents, currency, interval, active')
        .in('id', chunk);
      // Reported by leaving the plan off, not by failing the membership. The
      // membership is a fact whether or not its price came back.
      if (!planErr) {
        for (const p of (planRows as any[]) ?? []) {
          plans.set(p.id, {
            id: p.id,
            name: typeof p.name === 'string' ? p.name : '',
            priceCents: minorOrNull(p.price_cents),
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
      // Passed through as the bare dates they are. Nothing here parses them
      // into a Date: `freezeState` compares 'YYYY-MM-DD' as a string precisely
      // so that a member in Auckland and a front desk in Dubai cannot disagree
      // about which day a pause started.
      frozenFrom: r.frozen_from ?? null,
      frozenTo: r.frozen_to ?? null,
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

/* ── the other three places a member's money is recorded ───────────────────
 *
 * Rule 3 again, and the reason these live here rather than being read inline by
 * the screen: `gym_payments` is ONE of four sources, the member was being shown
 * that one under a heading that says what they have paid, and src/lib/
 * memberPaid.ts is the module that adds them up and refuses to when any of the
 * four did not land. Each read below hands back its own truncation flag for
 * exactly that arithmetic.
 *
 * There is a fifth and this app may not read it. `coach_receipts` — cash and
 * bank transfers a coach was handed, for most self-employed coaches the larger
 * half of their income — carries `coach_receipts_owner_read` and no client
 * policy at all, deliberately: supabase/parts/190 argues it under the heading
 * "Why there is no client read policy". No function here reads that table and
 * `PAID_EXCLUDES_CASH` is what the screen says instead.
 */

/** One pass the member holds or has used up. */
export interface MemberPass {
  id: string;
  /** What it cost. NULL means NOBODY RECORDED A PRICE — not that it was free.
   *  The schema says so in as many words (supabase/parts/31) and
   *  `passRevenueCents` in src/lib/gymPasses.ts returns null for it rather than
   *  quietly counting a nought. */
  paidCents: number | null;
  currency: string | null;
  /** A bare 'YYYY-MM-DD'. */
  issuedOn: string;
  /** Null is a pass that does not expire, which is a choice a gym makes. */
  expiresOn: string | null;
  usesTotal: number;
  usesSpent: number;
}

/** One thing the member bought from a personal trainer through Repple. */
export interface MemberCoachSale {
  id: string;
  amountCents: number | null;
  currency: string | null;
  /** Stripe's own word for the sale. Only 'paid' is money. */
  status: string | null;
  /** Minor units already refunded, a running total. A `bigint`, so PostgREST
   *  may hand it over as a string; passed through untouched. */
  refundedCents: number | string | null;
  /** Null on a one-off; a number is a pack of that many sessions. */
  sessionsTotal: number | null;
  sessionsUsed: number;
  createdAt: string;
}

/** One renewal of a coaching subscription. */
export interface MemberCoachRenewal {
  id: string;
  amountCents: number | null;
  currency: string | null;
  refundedCents: number | string | null;
  /** When Stripe says the money moved. Null when Stripe stated none — the
   *  payment is real and belongs to no month anybody can name. */
  paidAt: string | null;
  createdAt: string;
  /** Stripe's raw word for why the invoice existed — 'subscription_cycle' and
   *  the rest. Untranslated here; the screen decides whether to say it. */
  billingReason: string | null;
}

/** A page of rows and whether there were more of them than came back. The same
 *  shape as `PaymentsPage` and for the same reason: a screen may LIST a
 *  truncated page and may never total it. */
export interface Page<T> {
  rows: T[];
  truncated: boolean;
}

const PASS_COLUMNS = 'id, paid_cents, currency, issued_on, expires_on, uses_total, uses_spent';
const SALE_COLUMNS = 'id, amount_cents, currency, status, refunded_cents, sessions_total, sessions_used, created_at';
const RENEWAL_COLUMNS = 'id, amount_cents, currency, refunded_cents, paid_at, created_at, billing_reason';
const INVOICE_COLUMNS = 'id, number, amount_cents, currency, issued_on, due_on, status, membership_id, note';

/** An integer column that may arrive as a string. `sessions_used` is an
 *  ordinary integer and `paid_cents` is too, but both reach a phone through
 *  JSON, and `Number(null)` is 0 — which is the one answer this file may never
 *  produce for money. Null in, null out. */
const intOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Every pass issued to this member, newest first.
 *
 * Scoped by `holder_id` at the database — `gym_passes_own_r` is
 * `using (holder_id = auth.uid())` — so a pass written at the desk against a
 * name with no account attached is invisible here, correctly: there is no
 * account for it to belong to. A member who bought a day pass before they had
 * an app will not find it, and that is a fact about the sale rather than about
 * this read.
 */
export async function fetchMyPasses(sb: Queryable, uid: string): Promise<Read<Page<MemberPass>>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('gym_passes')
      .select(PASS_COLUMNS)
      .eq('holder_id', uid)
      .order('issued_on', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const page = capped((data as any[]) ?? []);
    return { ok: true, value: {
      truncated: page.truncated,
      rows: page.rows.map((r): MemberPass => ({
        id: r.id,
        paidCents: intOrNull(r.paid_cents),
        currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
        issuedOn: r.issued_on,
        expiresOn: r.expires_on ?? null,
        usesTotal: intOrNull(r.uses_total) ?? 0,
        usesSpent: intOrNull(r.uses_spent) ?? 0,
      })),
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * Everything this member bought from a personal trainer through Repple.
 *
 * `client_purchases` is read by `cp_self`, `using (client_id = auth.uid())` —
 * the buyer reads their own row and writes nothing (supabase/parts/2580). The
 * amount is passed through GROSS with `refunded_cents` beside it rather than
 * netted here: what was charged and what came back are two facts, and the
 * subtraction belongs in one place (`keptCents`) where it can be shown as well
 * as done.
 *
 * ── Why this is not `fetchMyPurchases` in src/lib/connect.ts ──────────────
 *
 * That function reads the same table for the same person and is right for what
 * it does, which is feed a session BALANCE. It answers `null` for a truncated
 * read as well as for a refused one, and says why: to the caller of a balance
 * the two facts are the same fact, and every caller renders that null with one
 * written sentence. They are not the same fact here. A money total withheld
 * because a read failed and a money total withheld because there are more rows
 * than arrived send the member to two different places — one is pull-to-refresh
 * and the other is ask the gym for a statement — and `memberPaid` names which
 * to their face. Hence a second read, with named columns rather than `*`, that
 * keeps the two apart.
 */
export async function fetchMyCoachSales(sb: Queryable, uid: string): Promise<Read<Page<MemberCoachSale>>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('client_purchases')
      .select(SALE_COLUMNS)
      .eq('client_id', uid)
      .order('created_at', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const page = capped((data as any[]) ?? []);
    return { ok: true, value: {
      truncated: page.truncated,
      rows: page.rows.map((r): MemberCoachSale => ({
        id: r.id,
        amountCents: intOrNull(r.amount_cents),
        currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
        status: typeof r.status === 'string' ? r.status : null,
        refundedCents: r.refunded_cents ?? null,
        sessionsTotal: intOrNull(r.sessions_total),
        sessionsUsed: intOrNull(r.sessions_used) ?? 0,
        createdAt: r.created_at,
      })),
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * Every renewal Stripe has taken for a coaching subscription of this member's.
 *
 * `client_sub_pay_read` admits `client_id = auth.uid()` (supabase/parts/132),
 * and part 132's own comment on the index says what this function is: "the
 * coach's screen reads trainer_id = me, newest first; the client's own receipts
 * read the same shape from the other side".
 *
 * Ordered on `paid_at`, which is when the money moved, and NOT on `created_at`,
 * which is when a webhook happened to write the row. A retry three days late
 * must not reorder somebody's payment history.
 */
export async function fetchMyCoachRenewals(sb: Queryable, uid: string): Promise<Read<Page<MemberCoachRenewal>>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('client_subscription_payments')
      .select(RENEWAL_COLUMNS)
      .eq('client_id', uid)
      .order('paid_at', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const page = capped((data as any[]) ?? []);
    return { ok: true, value: {
      truncated: page.truncated,
      rows: page.rows.map((r): MemberCoachRenewal => ({
        id: r.id,
        amountCents: intOrNull(r.amount_cents),
        currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
        refundedCents: r.refunded_cents ?? null,
        paidAt: r.paid_at ?? null,
        createdAt: r.created_at,
        billingReason: typeof r.billing_reason === 'string' ? r.billing_reason : null,
      })),
    } };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * Every invoice this member's gym has raised against them, newest first.
 *
 * `gym_invoices_own_r` has admitted the member since supabase/parts/29 —
 * `using (member_id = auth.uid())` — and until now nothing read it from the
 * member's side, which is why part 146's notification has no route. Drafts come
 * back with everything else because the policy does not filter on status; what
 * is done with them is `invoiceStanding`'s business, and it is argued in the
 * header of src/lib/memberInvoices.ts.
 *
 * There is no equivalent for `coach_invoices` in this file and there must not
 * be one written from the client's side: that table is the issuing coach's and
 * nobody else's, by an argued decision in supabase/parts/138, which drops a
 * client read policy by name so one cannot be added by accident.
 */
export async function fetchMyInvoices(sb: Queryable, uid: string): Promise<Read<Page<MemberInvoice>>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('gym_invoices')
      .select(INVOICE_COLUMNS)
      .eq('member_id', uid)
      .order('issued_on', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    const page = capped((data as any[]) ?? []);
    return { ok: true, value: {
      truncated: page.truncated,
      rows: page.rows.map((r): MemberInvoice => ({
        id: r.id,
        number: intOrNull(r.number),
        amountCents: intOrNull(r.amount_cents),
        currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
        issuedOn: r.issued_on,
        dueOn: r.due_on ?? null,
        status: typeof r.status === 'string' ? r.status : null,
        membershipId: r.membership_id ?? null,
        note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
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
