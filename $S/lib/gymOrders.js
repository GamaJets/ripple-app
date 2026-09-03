"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_STALE_MS = exports.ORDER_STATUS_LABEL = void 0;
exports.orderLine = orderLine;
exports.orderTrouble = orderTrouble;
exports.paidPots = paidPots;
exports.countByStatus = countByStatus;
exports.fetchGymOrders = fetchGymOrders;
const rowCap_1 = require("./rowCap");
exports.ORDER_STATUS_LABEL = {
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
exports.PENDING_STALE_MS = 36 * 60 * 60 * 1000;
/** One order, in one line, for a list somebody scans. */
function orderLine(o) {
    if (o.kind === 'pass')
        return 'Pass';
    return o.intent === 'renew' ? 'Membership · renewal'
        : o.intent === 'upgrade' ? 'Membership · upgrade'
            : 'Membership · new';
}
function orderTrouble(rows, now = Date.now()) {
    const failed = [];
    const stuck = [];
    const paidWithNothing = [];
    for (const o of rows) {
        if (o.status === 'failed') {
            failed.push(o);
            continue;
        }
        if (o.status === 'paid' && o.membershipId == null && o.passId == null) {
            paidWithNothing.push(o);
            continue;
        }
        if (o.status === 'pending') {
            const at = Date.parse(o.createdAt);
            // An unparseable timestamp is not evidence of anything. It is left out
            // rather than counted as infinitely old, which would put a permanent
            // false alarm on the screen.
            if (Number.isFinite(at) && now - at >= exports.PENDING_STALE_MS)
                stuck.push(o);
        }
    }
    return { failed, stuck, paidWithNothing };
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
function paidPots(rows) {
    const by = new Map();
    for (const o of rows) {
        if (o.status !== 'paid')
            continue;
        const cur = (o.currency ?? '').trim();
        // A row with no currency is not money that can be added to money. It is
        // excluded from every pot and stays visible as a row in the list, which is
        // where somebody can see what is wrong with it.
        if (!cur)
            continue;
        if (!Number.isFinite(o.amountCents))
            continue;
        const pot = by.get(cur) ?? { currency: cur, cents: 0, count: 0 };
        pot.cents += o.amountCents;
        pot.count += 1;
        by.set(cur, pot);
    }
    return [...by.values()].sort((a, b) => (b.cents - a.cents) || a.currency.localeCompare(b.currency));
}
/** Every status and how many are in it, so a status this code has never heard
 *  of shows up rather than being silently left out of a total. */
function countByStatus(rows) {
    const by = new Map();
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
async function fetchGymOrders(sb, tenantId, sinceIso) {
    const rows = await (0, rowCap_1.readAll)((from, to) => {
        let q = sb.from('gym_orders')
            .select('id, member_id, kind, intent, status, amount_cents, currency, plan_id, pass_type_id, '
            + 'term_starts_on, term_ends_on, uses_total, expires_on, membership_id, pass_id, created_at, paid_at')
            .eq('tenant_id', tenantId);
        if (sinceIso)
            q = q.gte('created_at', sinceIso);
        return q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    }, 'this gym’s online orders');
    if (!rows.length)
        return [];
    const ids = [...new Set(rows.map((r) => r.member_id).filter(Boolean))];
    const names = new Map();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        // no-error-ok: an unreadable name renders as a dash; the order it labels is
        // still real, still counted and still fixable.
        const { data } = await sb.from('profiles').select('id, full_name').in('id', ids.slice(i, i + ID_CHUNK));
        for (const p of (data ?? []))
            names.set(p.id, (p.full_name || '').trim());
    }
    return rows.map((r) => ({
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
