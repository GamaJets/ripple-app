// Client · the order that bought the membership the member is looking at.
//
// ── What was missing ──────────────────────────────────────────────────────
//
// `gym_orders` (supabase/parts/281) is one attempt by a member to buy a
// membership term or a pass, and its own RLS comment says the member "reads
// their own, and nothing else" — `gym_orders_own_r`, `for select using
// (member_id = (select auth.uid()))`, shipped with the table. Part 800's header
// then says the table "is read by the member's own purchase history", and the
// member's own purchase history does not exist: grep the app and `gym_orders`
// appears in `app/(owner)/orders.tsx`, in the owner's export, and in the Stripe
// webhook's rules. Nowhere a member can reach.
//
// So a member who paid for a membership on their phone could open Membership,
// read the plan and the dates the payment produced, and find nothing anywhere
// saying that they bought it, when, for how much, or in which currency.
//
// ── What this is NOT, and this is the whole judgement call ────────────────
//
// It is not `memberships.note`. That column is the other half of the same
// backlog item and it is deliberately left alone. supabase/parts/125 wrote the
// reason down in the schema itself: `memberships.note` and `gym_payments.note`
// "are free-text columns the OWNER console writes, and an owner who types a
// private remark about a member into one is typing it somewhere that member can
// read… The client app therefore does not select either column, and anything
// genuinely private needs a column the member has no policy on rather than an
// assumption about this one." src/lib/attendance.ts keeps the identical rule
// for `gym_visits.note`.
//
// That is a note the desk writes ABOUT the member, for the desk. RLS admits the
// member to the row — so this is not a permission that does not exist, it is a
// permission the app declines to use, which is a different and more deliberate
// thing. Surfacing it would not leak it to anyone new; it would take a column
// gyms have been writing on the understanding that the app does not show it and
// start showing it, retroactively, to every member at every gym. Nothing in
// here selects `note`.
//
// An ORDER is the opposite kind of record: it is the member's own act, the
// member's own money, and a Stripe charge they can see on their statement.
//
// ── Two columns that stay out on the same principle ───────────────────────
//
// `failure_note` is commented in the schema as "What went wrong, for a 'failed'
// row. Never shown to the member as-is", and `refund_note` is the webhook's
// account of why it could not mirror a refund. Both are engineer-facing prose.
// The STATE they qualify is a fact the member needs and gets; the prose is not
// selected. See `orderLine`.
import { amount, type Read } from './memberRecord';
import { capLimit, capped } from './rowCap';

type Queryable = { from: (table: string) => any };

/** As on `gym_orders.kind`. */
export type OrderKind = 'membership' | 'pass';
/** As on `gym_orders.intent`. */
export type OrderIntent = 'new' | 'renew' | 'upgrade';
/** As on `gym_orders.status`. */
export type OrderStatus = 'pending' | 'paid' | 'abandoned' | 'failed';

export interface MemberOrder {
  id: string;
  kind: OrderKind;
  intent: OrderIntent;
  status: OrderStatus;
  amountCents: number;
  /**
   * ISO 4217 as the order recorded it. NOT NULL in the schema and still typed
   * nullable here, for the reason src/lib/memberRecord.ts gives about every
   * other money column in this app: this product is white-label, there is no
   * house currency to fall back to, and a blank that becomes '£' somewhere
   * downstream is worse than a blank. Null is carried to `amount`, which prints
   * the stored integer rather than guessing a scale.
   */
  currency: string | null;
  /** Bare `YYYY-MM-DD`. The term the order bought, which is not necessarily the
   *  membership's own dates — the gym may have edited those since. */
  termStartsOn: string | null;
  termEndsOn: string | null;
  /** The membership this order produced, or null when it produced none yet. */
  membershipId: string | null;
  /** timestamptz, or null when nothing has been paid. */
  paidAt: string | null;
  createdAt: string;
}

/**
 * The columns selected, and the ones that are not.
 *
 * PostgREST refuses a read that names a column the caller holds no grant on
 * with 42501, and RLS never gets a look — so this list is deliberately the same
 * one `fetchGymOrders` in src/lib/gymOrders.ts has been running against this
 * table since part 281, minus `member_id` (which is `auth.uid()` by the policy
 * that admitted the row) and minus the two note columns the header refuses.
 *
 * `refunded_cents` / `refunded_currency` / `refunded_at` (part 800) are left
 * out as well: a refund against a membership order is money, and money the gym
 * has moved is app/(client)/receipts.tsx's subject, with the currency rules
 * that screen already keeps. Two screens quoting a refund from two reads is how
 * they come to quote different figures.
 */
const ORDER_COLUMNS =
  'id, kind, intent, status, amount_cents, currency, term_starts_on, term_ends_on, '
  + 'membership_id, paid_at, created_at';

const asKind = (v: unknown): OrderKind => (v === 'pass' ? 'pass' : 'membership');
const asIntent = (v: unknown): OrderIntent =>
  (v === 'renew' || v === 'upgrade' ? v : 'new');
const asStatus = (v: unknown): OrderStatus =>
  (v === 'paid' || v === 'abandoned' || v === 'failed' ? v : 'pending');

/**
 * This member's own orders, newest first.
 *
 * `{ ok: false }` and never `[]` on a failure, for the reason `Read<T>` exists:
 * supabase-js resolves a database error with `data: null`, and `data ?? []`
 * is how "you have never bought anything" gets said to somebody who has. The
 * screen shows a different sentence for each.
 *
 * Not tenant-scoped, matching `gym_orders_own_r` itself and the argument part
 * 125 makes about `memberships_own_r`: `member_id = auth.uid()` is already the
 * tightest predicate available, and adding the current tenant would hide the
 * purchases a member made at the gym they have since left — their own money,
 * disappearing out of their own record.
 */
export async function fetchMyOrders(sb: Queryable, uid: string): Promise<Read<MemberOrder[]>> {
  if (!uid) return { ok: false, reason: 'Not signed in.' };
  try {
    const { data, error } = await sb.from('gym_orders')
      .select(ORDER_COLUMNS)
      .eq('member_id', uid)
      .order('created_at', { ascending: false })
      .limit(capLimit());
    if (error) return { ok: false, reason: error.message || 'The read was refused.' };
    // A member with a thousand orders does not exist; the probe row must still
    // never be rendered as one. See src/lib/rowCap.ts.
    const rows = capped((data as any[]) ?? []).rows;
    return {
      ok: true,
      value: rows.map((r): MemberOrder => ({
        id: String(r.id),
        kind: asKind(r.kind),
        intent: asIntent(r.intent),
        status: asStatus(r.status),
        amountCents: Number(r.amount_cents),
        currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency : null,
        termStartsOn: r.term_starts_on ?? null,
        termEndsOn: r.term_ends_on ?? null,
        membershipId: r.membership_id ?? null,
        paidAt: r.paid_at ?? null,
        createdAt: String(r.created_at),
      })),
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || 'The read failed.' };
  }
}

/**
 * The order that produced this membership, or null.
 *
 * Matched on `membership_id` and on nothing else. The tempting second rule —
 * "…or the newest membership order if none matches" — is exactly wrong: a
 * member who renewed in March and bought an upgrade in June would have June's
 * price printed under March's membership, and a member whose membership the gym
 * typed in at the desk would be shown somebody's Stripe charge as the thing
 * that bought it. An unmatched membership has no order, and `orderAbsence`
 * below is the sentence for it.
 *
 * `kind` is checked as well as the id. A pass order cannot carry a
 * `membership_id` — the schema's `gym_orders_supersedes_is_membership` and
 * `gym_orders_names_one_thing` between them see to that — so this can only fire
 * on a row that should not exist, which is the case worth refusing rather than
 * rendering.
 */
export function orderForMembership(
  orders: readonly MemberOrder[],
  membershipId: string | null,
): MemberOrder | null {
  if (!membershipId) return null;
  for (const o of orders) {
    if (o.kind === 'membership' && o.membershipId === membershipId) return o;
  }
  return null;
}

/** What the member bought, as a phrase. `intent` is the gym's word for it and
 *  the three cases genuinely differ to the reader: an upgrade supersedes the
 *  membership they used to hold, and a renewal extends the one they have. */
export function intentLabel(o: Pick<MemberOrder, 'intent'>): string {
  switch (o.intent) {
    case 'renew': return 'Renewal';
    case 'upgrade': return 'Upgrade';
    default: return 'New membership';
  }
}

/** The price, in the currency the order recorded and never in one it did not.
 *  `amount` prints the stored integer rather than inventing a decimal point
 *  when the currency is missing — see its own header. */
export const orderAmount = (o: Pick<MemberOrder, 'amountCents' | 'currency'>): string =>
  amount(o.amountCents, o.currency);

/**
 * What the record says happened to this purchase, in the second person.
 *
 * Four states and four sentences, and the two that matter are the ones nobody
 * would think to write:
 *
 *   · 'failed' is Stripe having taken the money while the entitlement could not
 *     be written. The schema calls it "a state that must exist so it can be
 *     found and fixed by hand, rather than a paid member with nothing to show
 *     for it and nothing anywhere recording that we know." The member is the
 *     one person guaranteed to notice, so they are told plainly — without
 *     `failure_note`, which is engineer-facing prose and is not selected.
 *
 *   · 'pending' is a checkout that was created and that Stripe has said nothing
 *     about. It is NOT "your payment failed" and it is not "you are paid up".
 *     Saying either would be a claim about somebody's money.
 */
export function orderStatusLine(o: Pick<MemberOrder, 'status'>): string {
  switch (o.status) {
    case 'paid':
      return 'Paid.';
    case 'pending':
      return 'Started, and your gym has not recorded a payment against it yet. If you have been charged, reception can check it against the card statement.';
    case 'abandoned':
      return 'This checkout was not completed, and nobody was charged for it.';
    case 'failed':
      return 'Your gym’s record shows this payment did not complete the way it should have. Nothing here is a charge you need to action — take it to reception and they can look it up by date.';
  }
}

/**
 * The sentence for a membership with NO order behind it.
 *
 * Not an error and not an omission. `memberships.gym_order_id` is commented in
 * the schema as "the gym_orders row that paid for this membership, or NULL for
 * one the gym recorded at the desk" — so the ordinary case for most gyms is no
 * order at all, and the screen has to say that rather than leave a blank that
 * reads as a missing receipt.
 *
 * `read` false is the other thing entirely: the orders read did not land, and
 * an absent order and an unread one are not the same fact about somebody's
 * money. This is the `Read<T>` rule at the display layer.
 */
export function orderAbsence(read: boolean): string {
  return read
    ? 'No online purchase is attached to this membership, so your gym recorded it at the desk. Payments your gym has taken are under Payments.'
    : 'We couldn’t read your purchases just now, so nothing is shown here. That is a read that failed — not a membership nobody paid for.';
}
