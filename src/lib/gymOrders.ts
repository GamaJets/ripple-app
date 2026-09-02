// The gym's side of what its members bought online.
//
// ── The gap this closes ───────────────────────────────────────────────────
//
// `gym_orders` (supabase/parts/281) is written by supabase/functions/
// gym-checkout and updated by the Stripe webhook. Until now the only reader in
// the whole product was `fetchMyGymOrders` in src/lib/memberBuy.ts, which is
// scoped to `member_id = auth.uid()` — the BUYER.
//
// So the gym took card money through a Stripe account it owns and had no order
// list. No way to see what sold, no way to find a member's receipt, no line to
// reconcile against the Stripe payout, and — the one that happens at a desk
// every week — no way to answer "did my payment go through?".
//
// `gym_orders_owner_r` has existed since part 281: `for select using
// (is_owner_of(tenant_id))`. Nothing about this file needs a policy change and
// nothing here asks for one. The rows were readable; nobody was reading them.
//
// ── The state this exists to surface ──────────────────────────────────────
//
// 'failed' is not a failed payment. Part 281 spells it out: it is "Stripe took
// the money and the entitlement could not be written… a state that must exist
// so it can be found and fixed by hand, rather than a paid member with nothing
// to show for it and nothing anywhere recording that we know."
//
// It was recorded and nothing looked at it. That is the sentence this file
// exists to put in front of an owner.
import type { GymOrder, OrderStatus } from './memberBuy';
import { readAll } from './rowCap';

type Queryable = { from: (table: string) => any };

/** An order as the GYM needs it: the member's row, plus who they are. The
 *  buyer's own view (`GymOrder`) never needs a name; a desk always does. */
export interface GymOrderRow extends GymOrder {
  memberId: string;
  memberName: string | null;
  /** Which of the two things was bought, by id — so a screen can group by plan
   *  or pass type without a second read per row. */
  planId: string | null;
  passTypeId: string | null;
  /** Whether the entitlement was actually written. A 'paid' order with neither
   *  is the shape of the failure the webhook records as 'failed', arriving by
   *  a different door. */
  membershipId: string | null;
  passId: string | null;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Awaiting payment',
  paid: 'Paid',
  abandoned: 'Abandoned',
  failed: 'Paid, not granted',
};

/**
 * How long a 'pending' order can sit before it is worth looking at.
 *
 * A Stripe Checkout session expires after 24 hours, at which point the webhook
 * moves the row to 'abandoned'. A row still pending well past that is one the
 * webhook never told us about — which is a different problem from a customer
 * who changed their mind, and the only signal the gym gets that its webhook is
 * not arriving.
 */
export const PENDING_STALE_MS = 36 * 60 * 60 * 1000;

/** One order, in one line, for a list somebody scans. */
export function orderLine(o: Pick<GymOrderRow, 'kind' | 'intent'>): string {
  if (o.kind === 'pass') return 'Pass';
  return o.intent === 'renew' ? 'Membership · renewal'
    : o.intent === 'upgrade' ? 'Membership · upgrade'
    : 'Membership · new';
}

/**
 * The orders an owner has to do something about.
 *
 * Two lists and never one number, because the two are different jobs. A
 * 'failed' order is a member who paid and got nothing, and somebody has to
 * grant it by hand today. A stale 'pending' is money that may or may not have
 * moved and is a question for the webhook, not for the member.
 */
export interface OrderTrouble {
  /** Paid, entitlement not written. Somebody is owed what they bought. */
  failed: GymOrderRow[];
  /** Still pending long after the Stripe session can have been alive. */
  stuck: GymOrderRow[];
  /** Marked paid with neither a membership nor a pass behind it. The same
   *  harm as `failed` recorded by a row that does not say so, which is why it
   *  is counted here rather than trusted to the status column alone. */
  paidWithNothing: GymOrderRow[];
}

export function orderTrouble(rows: readonly GymOrderRow[], now: number = Date.now()): OrderTrouble {
  const failed: GymOrderRow[] = [];
  const stuck: GymOrderRow[] = [];
  const paidWithNothing: GymOrderRow[] = [];
  for (const o of rows) {
    if (o.status === 'failed') { failed.push(o); continue; }
    if (o.status === 'paid' && o.membershipId == null && o.passId == null) { paidWithNothing.push(o); continue; }
    if (o.status === 'pending') {
      const at = Date.parse(o.createdAt);
      // An unparseable timestamp is not evidence of anything. It is left out
      // rather than counted as infinitely old, which would put a permanent
      // false alarm on the screen.
      if (Number.isFinite(at) && now - at >= PENDING_STALE_MS) stuck.push(o);
    }
  }
  return { failed, stuck, paidWithNothing };
}

/** What was taken, in one currency. */
export interface OrderPot {
  currency: string;
  cents: number;
  count: number;
}

/**
 * What the gym was PAID online, per currency.
 *
 * Per currency and never one total. A white-label gym that changed its currency
 * has both in its order book, and a figure blended across two of them is not a
 * bigger number — it is not a number. The same rule `sharedCurrency` holds for
 * the till and `minorMoney` holds for the platform's book.
 *
 * Only 'paid' rows count. A pending order is money nobody has taken, an
 * abandoned one is money nobody ever will, and a 'failed' one IS money that
 * moved — but it is counted in `orderTrouble` instead, because putting it in a
 * revenue total is how it stops being visible as a thing to fix.
 */
export function paidPots(rows: readonly GymOrderRow[]): OrderPot[] {
  const by = new Map<string, OrderPot>();
  for (const o of rows) {
    if (o.status !== 'paid') continue;
    const cur = (o.currency ?? '').trim();
    // A row with no currency is not money that can be added to money. It is
    // excluded from every pot and stays visible as a row in the list, which is
    // where somebody can see what is wrong with it.
    if (!cur) continue;
    if (!Number.isFinite(o.amountCents)) continue;
    const pot = by.get(cur) ?? { currency: cur, cents: 0, count: 0 };
    pot.cents += o.amountCents;
    pot.count += 1;
    by.set(cur, pot);
  }
  return [...by.values()].sort((a, b) => (b.cents - a.cents) || a.currency.localeCompare(b.currency));
}

/** Every status and how many are in it, so a status this code has never heard
 *  of shows up rather than being silently left out of a total. */
export function countByStatus(rows: readonly GymOrderRow[]): Array<[string, number]> {
  const by = new Map<string, number>();
  for (const o of rows) {
    const k = (o.status ?? '').trim() || 'Not stated';
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
}

/**
 * The gym's order book for a window, PAGED.
 *
 * `readAll` and not `.limit(capLimit())`. This is the shape rowCap.ts's header
 * describes — a read the caller has already bounded by a date window, where the
 * screen needs all of it and refusing would take a working screen away for no
 * gain. A gym selling online crosses a thousand orders in a year and the answer
 * to "did my payment go through" cannot be an error message.
 *
 * The order is `created_at desc, id asc`. `readAll`'s contract is a TOTAL order
 * and `created_at` alone is not one: two orders placed in the same millisecond
 * are two rows Postgres may return in either order, and a page boundary landing
 * between them drops one silently.
 *
 * The names are resolved in chunks. A thousand uuids in one `.in(...)` is a
 * forty-kilobyte query string, and an unreadable name is a null and a dash —
 * never a dropped order.
 */
const ID_CHUNK = 150;

export async function fetchGymOrders(
  sb: Queryable, tenantId: string, sinceIso?: string,
): Promise<GymOrderRow[]> {
  const rows = await readAll<any>(
    (from, to) => {
      let q = sb.from('gym_orders')
        .select('id, member_id, kind, intent, status, amount_cents, currency, plan_id, pass_type_id, '
          + 'term_starts_on, term_ends_on, uses_total, expires_on, membership_id, pass_id, created_at, paid_at')
        .eq('tenant_id', tenantId);
      if (sinceIso) q = q.gte('created_at', sinceIso);
      return q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    },
    'this gym’s online orders',
  );
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r) => r.member_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    // no-error-ok: an unreadable name renders as a dash; the order it labels is
    // still real, still counted and still fixable.
    const { data } = await sb.from('profiles').select('id, full_name').in('id', ids.slice(i, i + ID_CHUNK));
    for (const p of ((data as any[]) ?? [])) names.set(p.id, (p.full_name || '').trim());
  }

  return rows.map((r): GymOrderRow => ({
    id: String(r.id),
    memberId: String(r.member_id),
    memberName: names.get(r.member_id) || null,
    kind: r.kind === 'pass' ? 'pass' : 'membership',
    intent: r.intent === 'renew' || r.intent === 'upgrade' ? r.intent : 'new',
    status: r.status === 'paid' || r.status === 'abandoned' || r.status === 'failed' ? r.status : 'pending',
    amountCents: Number(r.amount_cents),
    currency: typeof r.currency === 'string' ? r.currency : '',
    planId: r.plan_id ?? null,
    passTypeId: r.pass_type_id ?? null,
    termStartsOn: r.term_starts_on ?? null,
    termEndsOn: r.term_ends_on ?? null,
    usesTotal: r.uses_total == null ? null : Number(r.uses_total),
    expiresOn: r.expires_on ?? null,
    membershipId: r.membership_id ?? null,
    passId: r.pass_id ?? null,
    createdAt: String(r.created_at),
    paidAt: r.paid_at ?? null,
  }));
}
