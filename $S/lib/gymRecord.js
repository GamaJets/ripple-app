"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_KIND_LABEL = void 0;
exports.fetchPlans = fetchPlans;
exports.createPlan = createPlan;
exports.setPlanActive = setPlanActive;
exports.fetchMemberships = fetchMemberships;
exports.createMembership = createMembership;
exports.setMembershipStatus = setMembershipStatus;
exports.setMembershipDates = setMembershipDates;
exports.setMembershipPlan = setMembershipPlan;
exports.fetchPayments = fetchPayments;
exports.fetchOnlineOrders = fetchOnlineOrders;
exports.reversalBlocker = reversalBlocker;
exports.reversedAgainst = reversedAgainst;
exports.reversePayment = reversePayment;
exports.recordPayment = recordPayment;
exports.matchPayment = matchPayment;
exports.sharedCurrency = sharedCurrency;
exports.normaliseCurrency = normaliseCurrency;
exports.summarise = summarise;
exports.money = money;
const coachMoney_1 = require("./coachMoney");
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
exports.PAYMENT_KIND_LABEL = {
    payment: 'Payment',
    refund: 'Refund',
    correction: 'Correction',
};
/* ── plans ─────────────────────────────────────────────────────────────────── */
/**
 * The gym's price book.
 *
 * Capped through src/lib/rowCap.ts. A thousand plans is not a real price book,
 * so this will not truncate in practice — but the order is active-first then
 * cheapest-first, so if it ever did the rows lost would be the DEAREST live
 * plans, and /import maps a CSV's plan names against this list. A plan missing
 * from it is not reported as missing; the importer has nothing to match and
 * files the member without one. Refusing is the cheap half of that trade.
 */
async function fetchPlans(sb, tenantId) {
    const { data, error } = await sb
        .from('membership_plans')
        .select('id, name, price_cents, currency, interval, active')
        .eq('tenant_id', tenantId)
        .order('active', { ascending: false })
        .order('price_cents', { ascending: true })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, "this gym's price book").map((r) => ({
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
async function createPlan(sb, tenantId, plan) {
    const { error } = await sb.from('membership_plans').insert({
        tenant_id: tenantId,
        name: plan.name,
        price_cents: plan.priceCents,
        interval: plan.interval,
        currency: plan.currency,
    });
    if (error)
        throw error;
}
async function setPlanActive(sb, planId, active) {
    // Retired rather than deleted: memberships sold on a plan keep pointing at it,
    // and a price book with holes in it cannot be audited.
    //
    // Counted, because an UPDATE matching zero rows is not an error — see
    // src/lib/wroteRows.ts. `membership_plans_owner` is the only policy granting
    // UPDATE and it is `is_owner_of(tenant_id)`, so anybody else retires nothing
    // and, without this, is told the plan is off the price book while it is still
    // on sale.
    const r = await sb.from('membership_plans').update({ active }, { count: 'exact' }).eq('id', planId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)(active ? 'That plan' : 'Retiring that plan', r);
}
/* ── memberships ───────────────────────────────────────────────────────────── */
/**
 * Every membership in the gym's history, not just the live ones.
 *
 * ── Why this pages rather than refuses ────────────────────────────────────
 *
 * It used to be `capLimit()` plus `assertWhole`, on the reasoning that a gym a
 * few years old crosses a thousand rows without being large and a truncated set
 * silently drops the oldest — exactly the set a revenue trend reads. The
 * diagnosis was right and the remedy was half of one: the read stopped lying
 * and started refusing instead, and it refuses for FIFTEEN callers, which is
 * every membership-bearing screen in the console and three in the phone app.
 * /close, /accounting, /retention, /members, /passes, /revenue, /export and the
 * roster picker on the invoice form all go dark together on the same day, and
 * they stay dark, because nothing a gym can do makes its own history shorter.
 *
 * Windowing it instead is not available. There is no honest window: a
 * membership that started four years ago and is still live is the row a tenure
 * figure is made of, and a rolling window would drop it and report a founding
 * member as a new one.
 *
 * So the read is finished. This is the shape `readAll` exists for in the one
 * respect that matters — the screens genuinely need all of it — and
 * src/lib/gymPasses.ts already reads a tenant's whole pass book the same way.
 * What replaces the thousand-row cliff is `PAGE_CEILING`: past fifty thousand
 * memberships this still refuses, out loud, with a sentence naming the set.
 * That is a different claim from the old one. It says "this is too large to
 * total in a browser", not "this gym has 1000 memberships".
 *
 * `readAll` needs a TOTAL order — one that cannot tie — because every page is a
 * separate HTTP request. `started_on` is a DATE, so a gym that signed up
 * thirty people on the first of the month has thirty rows Postgres may return
 * in any order; `id` is the primary key and breaks it.
 */
async function fetchMemberships(sb, tenantId) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('memberships')
        .select('id, member_id, member_label, plan_id, started_on, ends_on, status')
        .eq('tenant_id', tenantId)
        .order('started_on', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), "this gym's memberships");
    if (!rows.length)
        return [];
    const [names, planNames] = await Promise.all([
        namesFor(sb, rows.map((r) => r.member_id)),
        planNamesFor(sb, rows.map((r) => r.plan_id).filter(Boolean)),
    ]);
    return rows.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        // The live name while there is one, then the label supabase/parts/172
        // snapshots at erasure. A membership survives an erasure from that part on
        // — it is the contract the invoices hang off — and a surviving contract
        // that names nobody is a row an owner cannot reconcile anything against.
        memberName: names.get(r.member_id) ?? r.member_label ?? null,
        planId: r.plan_id ?? null,
        planName: r.plan_id ? planNames.get(r.plan_id) ?? null : null,
        startedOn: r.started_on,
        endsOn: r.ends_on ?? null,
        status: r.status,
    }));
}
async function createMembership(sb, tenantId, m) {
    const { error } = await sb.from('memberships').insert({
        tenant_id: tenantId,
        member_id: m.memberId,
        plan_id: m.planId,
        started_on: m.startedOn,
        ends_on: m.endsOn ?? null,
    });
    if (error)
        throw error;
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
async function setMembershipStatus(sb, membershipId, status) {
    const r = await sb.from('memberships').update({ status }, { count: 'exact' }).eq('id', membershipId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That membership', r);
}
/**
 * Correct when a membership actually started, and when it ends.
 *
 * `createMembership` has always accepted both and the console's only caller
 * hardcoded today as the start and never offered an end. For a gym MIGRATING
 * its existing members that is not a small omission: every member arrives dated
 * the day the owner typed them in, so tenure is wrong for the whole roster on
 * day one, cohort retention measures from a date nobody joined, and the ageing
 * on /accounting has no history to age. None of it is recoverable later without
 * this write.
 *
 * `endsOn` may be set to null on purpose, which is why the field is present-or-
 * absent rather than nullable-and-always-sent: null means open-ended, which is
 * not the same as expired and is a state the schema has always had.
 */
async function setMembershipDates(sb, membershipId, dates) {
    const patch = {};
    if (dates.startedOn !== undefined)
        patch.started_on = dates.startedOn;
    if (dates.endsOn !== undefined)
        patch.ends_on = dates.endsOn;
    // An empty patch is refused rather than sent: PostgREST answers an empty
    // update with a 204 and a count of zero, which `assertWrote` would then
    // report as a refusal — a confusing error for pressing Save with nothing
    // changed. Same reasoning as `saveGymProfile` in src/lib/gymPolicy.ts.
    if (!Object.keys(patch).length)
        return;
    const r = await sb.from('memberships').update(patch, { count: 'exact' }).eq('id', membershipId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('Those membership dates', r);
}
/**
 * Move a membership onto a different plan.
 *
 * The alternative — cancel and recreate — is what the console forces today, and
 * it breaks TENURE: the member's `started_on` resets to the day they upgraded,
 * so a four-year member reads as a new one on every retention figure the
 * product computes, and the cancelled row sits in the churn count as somebody
 * who left. An upgrade from Bronze to Gold is one member, continuously, on a
 * different plan.
 *
 * What this does NOT do is pro-rate anything or raise the difference as an
 * invoice. Both are real and neither is guessable — a mid-month upgrade may be
 * billed now, at the next renewal, or not at all, and that is the gym's
 * commercial decision. The screen says so and offers to raise the invoice
 * beside it, which keeps the money an act somebody performed.
 */
async function setMembershipPlan(sb, membershipId, planId) {
    const r = await sb.from('memberships')
        .update({ plan_id: planId }, { count: 'exact' })
        .eq('id', membershipId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That plan change', r);
}
/* ── payments ──────────────────────────────────────────────────────────────── */
/**
 * What the gym was actually paid, over the window the caller asked for.
 *
 * Payments are the number an owner reconciles against a bank statement, so a
 * truncated read here does not make the figure smaller — it makes it wrong.
 * That was the case for `assertWhole` and it still holds; what has changed is
 * that refusing is no longer the only alternative to lying.
 *
 * ── Why this pages ────────────────────────────────────────────────────────
 *
 * Two of the callers are unbounded by design and cannot be windowed. /members
 * shows what each person has paid over their whole time at the gym, and
 * /export hands over the ledger; a rolling window on either would quietly
 * report a four-year member's lifetime total as one year of it, which is the
 * exact failure the cap exists to stop, arriving through the front door. Under
 * `assertWhole` both screens simply stopped working at a thousand payments —
 * roughly two hundred members billed monthly, five months in.
 *
 * So the read is finished a page at a time, with `PAGE_CEILING` as the backstop
 * the row cap used to be. Past fifty thousand payments in one window it still
 * refuses, and the refusal names the set: that is a claim about the size of the
 * read, not a claim about the gym's takings.
 *
 * `taken_at` alone is not a total order — two payments taken in the same
 * millisecond are two rows Postgres may hand back in either order — so `id`
 * breaks the tie. Every page is a separate request, and a tied order across
 * pages drops and repeats rows without saying so.
 */
async function fetchPayments(sb, tenantId, sinceISO, untilISO) {
    const rows = await (0, rowCap_1.readAll)((from, to) => {
        let q = sb
            .from('gym_payments')
            .select('id, member_id, membership_id, amount_cents, currency, method, taken_at, note, kind, reverses_payment_id, invoice_id, payer_name')
            .eq('tenant_id', tenantId)
            .order('taken_at', { ascending: false })
            .order('id', { ascending: false });
        if (sinceISO)
            q = q.gte('taken_at', sinceISO);
        // An UPPER bound as well as a lower one, and it is not optional
        // politeness. /accounting and /close both computed a start date and no
        // end date, so opening a month from a year ago read every payment from
        // that month up to today — a set that grows without bound and that the
        // month's own figures then have to filter back down. Paging removes the
        // cliff that read used to fall off; it does not make reading a year of
        // payments to total one month of them a sensible thing to do.
        if (untilISO)
            q = q.lt('taken_at', untilISO);
        return q.range(from, to);
    }, 'this gym\u2019s payments');
    if (!rows.length)
        return [];
    const names = await namesFor(sb, rows.map((r) => r.member_id).filter(Boolean));
    return rows.map((r) => ({
        id: r.id,
        memberId: r.member_id ?? null,
        // `payer_name` is the snapshot supabase/parts/172 leaves behind when an
        // account is erased. Before it, `member_id` went null and the surviving row
        // named nobody at all — cash in the books that could never be reconciled to
        // the invoice it settled. The live name wins while there is one.
        memberName: (r.member_id ? names.get(r.member_id) : undefined) ?? r.payer_name ?? null,
        amountCents: r.amount_cents,
        currency: r.currency,
        method: r.method,
        takenAt: r.taken_at,
        note: r.note ?? null,
        // Anything the column's CHECK does not permit is read back as 'payment'
        // rather than passed through. A value this module does not recognise on a
        // POSITIVE row is a payment; on a negative one the amount already says what
        // it is, and no screen decides that from the label alone.
        kind: r.kind === 'refund' || r.kind === 'correction' ? r.kind : 'payment',
        reversesPaymentId: r.reverses_payment_id ?? null,
        invoiceId: r.invoice_id ?? null,
        membershipId: r.membership_id ?? null,
    }));
}
/**
 * Online orders that ended in money moving, in a window, with whether each one
 * reached the ledger.
 *
 * Only 'paid' and 'failed'. A 'pending' order is a checkout somebody opened and
 * an 'abandoned' one is a checkout they closed; neither is money and listing
 * them would bury the two states that are.
 *
 * The ledger check is a second query rather than an embed, for the same reason
 * `namesFor` is: a join this module cannot assert without a live database, in
 * exchange for nothing. A failure there is not swallowed — a screen that showed
 * "not in the ledger" because a lookup failed would raise an exception against
 * every online sale the gym made.
 *
 * Both halves are paged. The month window bounds the orders read but does not
 * cap it — a gym running a January sale can take a thousand online orders in a
 * month without being unusual, and /accounting sums this array and lists every
 * order that never reached the ledger. Under the old cap the oldest of those
 * fell off the end and the reconciliation reported the month as clean.
 *
 * The ledger check is chunked through src/lib/idLookup.ts rather than sent as
 * one `.in()`, because it inherits its size from the read above: with the
 * orders read paging, that list is no longer bounded by a thousand, and
 * `gym_order_id` is a foreign key rather than a unique one, so a chunk can
 * legitimately answer with more rows than it had ids.
 */
async function fetchOnlineOrders(sb, tenantId, sinceISO, untilISO) {
    // `paid_at` is nullable on `gym_orders` and ties freely on a busy morning, so
    // `id` — the primary key — carries the total order `readAll` requires.
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('gym_orders')
        .select('id, member_id, kind, status, amount_cents, currency, failure_note, paid_at, refunded_cents, refunded_currency, refund_note')
        .eq('tenant_id', tenantId)
        .in('status', ['paid', 'failed'])
        .gte('paid_at', sinceISO)
        .lt('paid_at', untilISO)
        .order('paid_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), 'this gym\u2019s online orders');
    if (!rows.length)
        return [];
    const paid = await (0, idLookup_1.readByIds)(rows.map((r) => r.id), (chunk, from, to) => sb
        .from('gym_payments')
        .select('id, gym_order_id')
        .eq('tenant_id', tenantId)
        .in('gym_order_id', chunk)
        .order('id', { ascending: true })
        .range(from, to), 'the ledger entries for those online sales');
    // Not swallowed: `readByIds` throws a failed lookup rather than returning a
    // short list, and a short list here is the failure this whole comment block
    // is about — every order it could not confirm would be drawn as an exception.
    const inLedger = new Set(paid.map((p) => p.gym_order_id));
    // ── what the ledger has taken back off those sales ────────────────────────
    //
    // A third read rather than a fourth column, because a reversal is a ROW —
    // supabase/parts/180 settled that and its header argues it at length. So
    // "how much has been refunded against this sale" is a SUM over rows pointing
    // at the payment, and it is asked here rather than in Postgres for the same
    // reason `inLedger` is: an aggregate embed is a thing this module cannot
    // assert without a live database, in exchange for nothing.
    //
    // Keyed by PAYMENT id and then mapped back to the order, because
    // `reverses_payment_id` names the payment and the reversal deliberately
    // carries no `gym_order_id` of its own — part 480's unique index allows one
    // row per order, and the sale row has already taken it.
    //
    // Paged and chunked exactly as the read above is, and for the same reason:
    // `reverses_payment_id` is a foreign key rather than a unique one, so a
    // chunk can legitimately answer with more rows than it had ids.
    const paymentToOrder = new Map();
    for (const p of paid)
        if (p?.id && p?.gym_order_id)
            paymentToOrder.set(String(p.id), String(p.gym_order_id));
    const reversals = paymentToOrder.size
        ? await (0, idLookup_1.readByIds)([...paymentToOrder.keys()], (chunk, from, to) => sb
            .from('gym_payments')
            .select('id, reverses_payment_id, amount_cents')
            .eq('tenant_id', tenantId)
            .in('reverses_payment_id', chunk)
            .order('id', { ascending: true })
            .range(from, to), 'the refunds recorded against those online sales')
        : [];
    // Absolute, because a reversal is stored negative and this figure is compared
    // against Stripe's `amount_refunded`, which is positive. Adding the signed
    // value would make every comparison read as though nothing had been reversed.
    const reversedByOrder = new Map();
    for (const v of reversals) {
        const orderId = paymentToOrder.get(String(v?.reverses_payment_id ?? ''));
        if (!orderId)
            continue;
        const cents = Number(v?.amount_cents);
        if (!Number.isFinite(cents))
            continue;
        reversedByOrder.set(orderId, (reversedByOrder.get(orderId) ?? 0) + Math.abs(cents));
    }
    const names = await namesFor(sb, rows.map((r) => r.member_id).filter(Boolean));
    return rows.map((r) => ({
        id: r.id,
        memberId: r.member_id,
        memberName: (r.member_id ? names.get(r.member_id) : undefined) ?? null,
        kind: r.kind,
        status: r.status,
        amountCents: Number.isFinite(r.amount_cents) ? r.amount_cents : null,
        currency: r.currency ?? null,
        failureNote: r.failure_note ?? null,
        paidAt: r.paid_at ?? null,
        inLedger: inLedger.has(r.id),
        // NULL is preserved rather than coerced to 0. "Stripe has never mentioned a
        // refund" and "Stripe refunded nothing" are different facts, and
        // `onlineOrderProblem` raises nothing on either — but a screen that later
        // wants to say "refunded, in full, and correctly recorded" needs to be able
        // to tell them apart.
        refundedCents: Number.isFinite(r.refunded_cents) ? r.refunded_cents : null,
        refundedCurrency: r.refunded_currency ?? null,
        reversedCents: reversedByOrder.get(r.id) ?? 0,
        refundNote: r.refund_note ?? null,
    }));
}
/**
 * Why a payment cannot be reversed, or null when it can.
 *
 * The amount is in MINOR units and POSITIVE — what is being taken back, as a
 * person would say it. The sign is applied by `reversePayment`, never typed,
 * because a screen that asks somebody to enter a negative number will one day
 * be handed a positive one and file a second payment.
 *
 * The over-reversal sentence used to read `(remaining / 100).toFixed(2)`, and
 * it is the one line here that prints a figure rather than a rule. A hundred is
 * the factor for about eighty per cent of currencies and for none of the
 * twenty-one others: a gym in Tokyo owed ¥6,300 was told "63.00 is still
 * outstanding", and one in Kuwait was told ten times what was left. It goes
 * through `money()` now, which asks the currency how many places it has and
 * puts the code in front of the figure — and the currency is the payment's own,
 * which `reversePayment` also copies onto the correction, so the sentence and
 * the row it refuses are denominated the same way.
 */
function reversalBlocker(original, alreadyReversedCents, amountCents) {
    if (original.kind !== 'payment') {
        return 'That row is itself a correction. Correcting a correction leaves two rows nobody can read as a pair — reverse the original payment instead.';
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
        return 'Enter what is being taken back, as a positive amount. Repple applies the minus.';
    }
    const remaining = original.amountCents - alreadyReversedCents;
    if (remaining <= 0) {
        return 'This payment has already been reversed in full. Reversing it again would take back money the gym never had.';
    }
    if (amountCents > remaining) {
        const left = money(remaining, original.currency);
        const whole = money(original.amountCents, original.currency);
        // A payment whose currency nobody recorded still cannot be over-reversed —
        // the refusal stands, and it simply does not quote two figures in a money
        // it cannot name. A bare "6300.00" is read in whatever currency the reader
        // happens to be thinking in.
        return left && whole
            ? `That is more than is left on this payment — ${left} of ${whole} is still outstanding against it.`
            : 'That is more than is left on this payment.';
    }
    return null;
}
/** What has already been taken back off a payment, in minor units and positive. */
function reversedAgainst(paymentId, all) {
    return all
        .filter((p) => p.reversesPaymentId === paymentId)
        .reduce((a, p) => a + Math.abs(p.amountCents), 0);
}
/**
 * Take money back off the ledger, as a row rather than as a flag.
 *
 * A correction is a NEGATIVE payment pointing at what it undoes. That is a
 * deliberate design choice and supabase/parts/168 argues it at length; the short
 * version is that there are eleven places in this console that add
 * `gym_payments.amount_cents` up, a `status <> 'void'` predicate would have to
 * be added to all eleven and to every query written after today, and the one
 * that forgets is silently wrong in the direction of MORE money — the direction
 * nobody checks.
 *
 * `takenAt` defaults to NOW and not to the original's date. A refund handed over
 * in September belongs in September: back-dating it into an August somebody has
 * already filed changes a month that has been reported, and — since
 * supabase/parts/170 — the database refuses it outright if that month is closed.
 *
 * The currency is copied from the original and cannot be chosen. You cannot
 * refund pounds against a payment taken in dirhams.
 */
async function reversePayment(sb, tenantId, original, r) {
    const { error } = await sb.from('gym_payments').insert({
        tenant_id: tenantId,
        member_id: original.memberId,
        membership_id: original.membershipId,
        amount_cents: -Math.abs(r.amountCents),
        // The original's money, always. A correction denominated in anything else
        // would not net against the row it is correcting, and the two would sit in
        // the ledger as an unexplained pair in two currencies.
        currency: original.currency,
        // How the money went back, which is not necessarily how it came in — a card
        // payment refunded in cash at the desk is ordinary. Defaults to the way it
        // arrived, which is the common case and is a fact about this row rather
        // than a guess about the world.
        method: r.method ?? original.method,
        taken_at: r.takenAt ?? new Date().toISOString(),
        note: r.note,
        recorded_by: r.recordedBy ?? null,
        kind: r.kind,
        reverses_payment_id: original.id,
    });
    if (error)
        throw error;
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
async function recordPayment(sb, tenantId, p) {
    const { error } = await sb.from('gym_payments').insert({
        tenant_id: tenantId,
        member_id: p.memberId,
        membership_id: p.membershipId ?? null,
        amount_cents: p.amountCents,
        method: p.method,
        taken_at: p.takenAt ?? new Date().toISOString(),
        note: p.note ?? null,
        recorded_by: p.recordedBy ?? null,
        currency: p.currency,
    });
    if (error)
        throw error;
}
/**
 * Match a payment to the invoice it settled, or unmatch it.
 *
 * Nothing infers this and nothing may. /accounting's 45-day rule is explicitly
 * a stated guess — "the match is made on member, exact amount, currency and a
 * payment within 45 days of the invoice date" — and a guess that writes itself
 * into the ledger stops being a guess on screen while remaining one in fact.
 * The rule stays as the way the SCREEN groups unmatched rows; this is how a
 * person records that they looked and it is right.
 */
async function matchPayment(sb, paymentId, invoiceId) {
    const r = await sb.from('gym_payments')
        .update({ invoice_id: invoiceId }, { count: 'exact' })
        .eq('id', paymentId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)(invoiceId ? 'That match' : 'Unmatching that payment', r);
}
/**
 * The one currency a set of rows shares, or null when it shares none.
 *
 * A row stating NO currency does not agree with the others — it is silent, and
 * silence is not consent to whatever the rest of them say. Exported because
 * /revenue's `oneCurrency` is this same rule written a second time, and a rule
 * about money that exists twice will eventually be two rules.
 */
function sharedCurrency(rows) {
    if (!rows.length)
        return null;
    const seen = new Set(rows.map((r) => normaliseCurrency(r.currency)));
    return seen.size === 1 ? ([...seen][0] ?? null) : null;
}
/**
 * One currency code, as this product stores and compares them, or null for
 * "nobody has said".
 *
 * Empty string is normalised to null for the same reason `money()` refuses it:
 * "" and null are the same fact, and letting "" through as a stated value hands
 * a caller a truthy-looking answer that prints as a leading space in front of
 * somebody's money. Case and spacing are normalised because ' gbp ' and 'GBP'
 * are one currency, and a comparison that says otherwise withholds a total the
 * gym is entitled to.
 *
 * Exported because `sharedCurrency` is not the only place this question is
 * asked — `incomeOf` in src/lib/monthEnd.ts groups by it — and a rule about
 * money that exists twice will eventually be two rules.
 */
function normaliseCurrency(currency) {
    return (currency ?? '').trim().toUpperCase() || null;
}
function summarise(payments, memberships, plans) {
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
    const contributing = [];
    for (const m of active) {
        const plan = m.planId ? byPlan.get(m.planId) : undefined;
        if (!plan)
            continue;
        priced++;
        if (plan.interval === 'month')
            mrr += plan.priceCents;
        else if (plan.interval === 'year')
            mrr += Math.round(plan.priceCents / 12);
        // `once` is not recurring and contributes nothing to a monthly figure.
        else
            continue;
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
function money(cents, currency) {
    // Delegates rather than dividing by a hundred itself. It used to do the
    // division here, unconditionally and to two decimal places, which is wrong in
    // sixteen currencies: there are no fils in a yen, so a minor-unit amount in
    // JPY, KRW or VND *is* the whole amount and ¥6,300 printed as ¥63.00 — a
    // hundredth of the real figure, on a gym's own books, in the currencies where
    // nobody reviewing this code was likely to notice.
    //
    // `minorMoney` already held the zero-decimal list and already refused a
    // missing currency the same way. A second copy of that list here is how the
    // two come to disagree, so there is one, and it lives beside the list.
    // Everything this function used to promise still holds: a null amount or a
    // missing currency renders a dash, and an empty-string currency is the same
    // fact as a null one — nobody has said.
    return (0, coachMoney_1.minorMoney)(cents, currency);
}
/* ── helpers ───────────────────────────────────────────────────────────────── */
/**
 * Names for the ids on a set of rows.
 *
 * Chunked through src/lib/idLookup.ts rather than sent as one `.in()`, and that
 * became load-bearing the moment the reads above started paging. A single
 * `.in()` was safe only while `assertWhole` kept those reads under a thousand
 * rows and so under a thousand distinct ids; with ten thousand payments in
 * hand it would have come back with the first thousand names and no complaint,
 * and every member past that would have rendered as a dash on a screen whose
 * whole job is naming people.
 *
 * Still no-error-ok, and still for the stated reason: an unreadable name
 * becomes null and renders as a dash, while the row it labels is real and stays
 * on screen. What the chunking buys is that "no name" now means the lookup was
 * refused, rather than meaning the list of ids was too long to ask about.
 */
async function namesFor(sb, ids) {
    try {
        const rows = await (0, idLookup_1.readByIds)(ids, (chunk, from, to) => sb.from('profiles')
            .select('id, full_name')
            .in('id', chunk)
            .order('id', { ascending: true })
            .range(from, to), 'the names on those rows');
        return new Map(rows.map((p) => [p.id, (p.full_name || '').trim()]));
    }
    catch {
        return new Map();
    }
}
/** Plan names, chunked for the same reason and swallowing a failure for the
 *  same one: an unreadable plan name becomes null and renders as a dash, and
 *  the membership row it belongs to is still real. */
async function planNamesFor(sb, ids) {
    try {
        const rows = await (0, idLookup_1.readByIds)(ids, (chunk, from, to) => sb.from('membership_plans')
            .select('id, name')
            .in('id', chunk)
            .order('id', { ascending: true })
            .range(from, to), 'the names of those plans');
        return new Map(rows.map((p) => [p.id, p.name]));
    }
    catch {
        return new Map();
    }
}
