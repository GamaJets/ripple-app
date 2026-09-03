"use strict";
// What the gym billed — the half of the money record nothing could write.
//
// `gym_invoices` has existed since supabase/parts/29. Until this file there was
// no writer for it anywhere in the repository: two reads,
// studio-web/app/accounting/page.tsx and studio-web/app/close/page.tsx, and
// nothing else. Between them those two screens carry four sections — Invoiced,
// Ageing, "What does not reconcile" and "What is still owed" — reporting on a
// lifecycle the product could not produce, in copy that reads as a factual
// claim about the gym. A gym running Repple has an invoice register that is
// empty because it is unreachable, and a month-end that says it is owed nothing.
//
// Framework-agnostic like the rest of src/lib: the Supabase client arrives as
// an argument, so the console and the phone can both use this and neither owns
// it. Money is minor units as integers everywhere — see the header of
// src/lib/gymRecord.ts for why floats do not go near a ledger.
//
// ── An invoice is not a payment, and the difference is the whole point ────
//
// /accounting is explicitly cash-basis: money in is what somebody recorded
// receiving. An invoice is the OTHER basis — what the gym is owed — and the two
// are held apart deliberately so that the gap between them is visible. That gap
// is the receivable, it is what the ageing table ages, and it is the only thing
// on either screen that can tell an owner a member has stopped paying before
// the member tells them.
//
// So nothing here marks an invoice paid as a side effect of a payment arriving.
// It is tempting and it is wrong: a payment matching an invoice by amount and
// date is a GUESS (that is exactly what /accounting's 45-day rule is, and it
// says so on screen), and a guess that writes `status = 'paid'` turns a
// heuristic into a permanent claim about somebody's account. Marking it paid is
// an act somebody performs, and `settleInvoice` is where they perform it —
// against a named payment, which is the only version of that sentence the
// record can stand behind.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTABLE_INVOICE_STATUSES = exports.INVOICE_STATUS_LABEL = exports.INVOICE_STATUSES = void 0;
exports.parseAmount = parseAmount;
exports.invoiceBlocker = invoiceBlocker;
exports.isoDay = isoDay;
exports.dueAfter = dueAfter;
exports.fetchInvoices = fetchInvoices;
exports.createInvoice = createInvoice;
exports.setInvoiceStatus = setInvoiceStatus;
exports.settleInvoice = settleInvoice;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
const coachMoney_1 = require("./coachMoney");
/** The statuses a screen may put an invoice into, in the order they happen. */
exports.INVOICE_STATUSES = ['draft', 'open', 'paid', 'overdue', 'void', 'written_off'];
/**
 * What each status means, in the words the screen shows.
 *
 * `overdue` is deliberately NOT offered as a thing an owner sets. It is a
 * FUNCTION OF THE DUE DATE and today — `isOverdue` in src/lib/monthEnd.ts
 * computes it, and both money screens render it computed. A stored 'overdue'
 * would go stale the moment the invoice is paid or the date is changed, and
 * then two parts of the same screen would disagree about the same row. It is in
 * the list above because the column's CHECK constraint permits it and rows
 * written by hand may carry it; it is not in the picker.
 */
exports.INVOICE_STATUS_LABEL = {
    draft: 'Draft — not sent',
    open: 'Open — sent and unpaid',
    paid: 'Paid',
    overdue: 'Overdue',
    void: 'Void — cancelled before payment',
    written_off: 'Written off — not going to be paid',
};
/** The statuses an owner may choose. See the note on `overdue` above. */
exports.SETTABLE_INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'written_off'];
/**
 * An amount of money, as typed, in whole units → minor units of THIS gym's
 * currency.
 *
 * The currency is an argument and there is no default, because the number of
 * minor units in a whole one is not two everywhere. This function used to end
 * `Math.round(Number(bare) * 100)` regardless, which is right for a sterling
 * gym, files a ¥5,000 Tokyo invoice as ¥500,000, and refuses a Kuwaiti gym's
 * 82.500 outright before storing 82.50 as 8.250 KWD — wrong by a factor of ten
 * in the direction the member does not notice.
 *
 * `readMinorAmount` in coachMoney.ts is the one reader for this in the product:
 * it takes the decimal places from the currency, refuses a thousands separator
 * rather than guessing which side of the Channel the typist grew up on, and
 * refuses a third decimal place rather than rounding it. Only the two refusals
 * that are about an INVOICE rather than about an amount are written here.
 */
function parseAmount(input, currency) {
    // Read before the shape check, so "−60" is refused as a negative invoice
    // rather than as an unreadable one. A minus is not a typo; it is somebody
    // meaning to reverse a bill, and the answer names the way to do that.
    if (/-/.test(String(input ?? ''))) {
        return { kind: 'bad', reason: 'An invoice cannot be for a negative amount. To take one back, void it or write it off.' };
    }
    const read = (0, coachMoney_1.readMinorAmount)(input, currency);
    if (!read.ok)
        return { kind: 'bad', reason: read.reason };
    // `gym_invoices.amount_cents` is a plain integer column, so anything past
    // 2^31−1 is rejected by the database with a 22003 after the form has closed.
    // The ceiling is in MINOR units, which is what the column holds — a
    // zero-decimal currency therefore gets a hundred times the headroom in whole
    // units, which is the arithmetic those currencies are quoted in.
    if (read.minorUnits > 2147483647) {
        return { kind: 'bad', reason: 'That is more than Repple will record on one invoice — check the zeros.' };
    }
    return { kind: 'amount', minorUnits: read.minorUnits };
}
/**
 * Why this invoice cannot be raised, or null when it can.
 *
 * Checked as the owner types, so a refusal arrives beside the field rather than
 * after the write. Every one of these would otherwise be a 23502, a 23514 or a
 * silently wrong row.
 */
function invoiceBlocker(d, currency) {
    if (!d.memberId) {
        return 'An invoice has to name who it is to. `gym_invoices.member_id` is NOT NULL, and an unnamed invoice cannot be chased, matched or aged.';
    }
    if (!currency) {
        return 'This gym has not set its currency, so there is nothing to bill in. An invoice is what somebody is asked to pay, and no default here would be right for half the gyms running Repple.';
    }
    const amt = parseAmount(d.amount, currency);
    if (amt.kind === 'bad')
        return amt.reason;
    if (!isoDay(d.issuedOn))
        return 'The issue date has to be a real date — YYYY-MM-DD.';
    // A due date is optional and its absence is a decision: an invoice with no
    // due date is never overdue, which is correct for a receipt and wrong for a
    // bill. The screen says so; this only refuses one that is unreadable.
    if (d.dueOn && !isoDay(d.dueOn))
        return 'The due date has to be a real date — YYYY-MM-DD, or empty for an invoice with no due date.';
    if (d.dueOn && d.dueOn < d.issuedOn) {
        return 'The due date is before the issue date, so this invoice would be overdue the moment it was raised.';
    }
    return null;
}
/** A plain ISO day, and one Date actually agrees with. `2026-02-31` passes a
 *  regex and is not a date; `new Date` rolls it into March and nothing says so. */
function isoDay(s) {
    const v = String(s ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
        return false;
    const d = new Date(`${v}T00:00:00Z`);
    // utc-day-ok: this states no day to anybody — it asks whether the string it
    // was handed survives a round trip, which is how `2026-02-31` is caught after
    // Date has rolled it into March. Both ends of that trip must be the same
    // calendar or the comparison is meaningless, and the string was anchored at
    // UTC midnight one line up. A local read here would fail every valid date for
    // every reader who is not on UTC.
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
/**
 * The due date a screen offers by default, `days` after the issue date.
 *
 * Pure and UTC-based, so it cannot land a day out for an owner in Auckland the
 * way `new Date(...)` arithmetic in local time does.
 */
function dueAfter(issuedOn, days) {
    const t = Date.parse(`${issuedOn}T00:00:00Z`);
    if (!Number.isFinite(t))
        return issuedOn;
    // utc-day-ok: exactly what the note above claims, and the claim is the whole
    // design. `issuedOn` is a bare day off a `date` column, it is anchored at UTC
    // midnight, days are added, and the same kind of bare day comes back — UTC
    // goes in, UTC comes out, and it cancels. "Thirty days after the 1st" has to
    // be the 31st for the owner in Auckland and the member in Denver both,
    // because it is one date printed on one invoice, and reading it back with the
    // local getters is the arithmetic this function exists to replace.
    return new Date(t + days * 86400000).toISOString().slice(0, 10);
}
/* ── reads ─────────────────────────────────────────────────────────────────── */
/**
 * Invoices issued on or before a day.
 *
 * Deliberately not scoped to a month: an invoice raised in June and still
 * unpaid in August is money owed at the August close, and a query scoped to
 * August reports that gym as owed nothing. Both money screens already make this
 * read with their own copy of it; this is the shared one, and it selects the
 * two columns supabase/parts/180 added that neither of them knew about.
 *
 * ── Why this pages rather than refusing ────────────────────────────────────
 *
 * It was `.limit(capLimit())` plus `assertWhole`. Truncating was never an
 * option and still is not — the order is `issued_on desc`, so what a prefix
 * drops is the OLDEST invoices, precisely the long-unpaid ones the ageing table
 * exists to surface, and the month would then appear to reconcile. But refusing
 * was not the other half of a real choice either: this read is bounded only at
 * the far end and no gym can make its invoice history shorter, so two hundred
 * members billed monthly crossed a thousand in five months and the Billed
 * section of /tax became a failure sentence at every filing, permanently.
 *
 * /close and /accounting had each already hit that wall and each written their
 * own paged reader over the same table rather than fix the shared one. This is
 * the shared one, so all three now finish the read, and `PAGE_CEILING` refuses
 * past fifty thousand invoices — a sentence about the size of the read rather
 * than about the money.
 *
 * `issued_on` is a DATE, so a gym that raises its whole book on the first of
 * the month has hundreds of rows tied on it. `id` is the primary key and gives
 * `readAll` the total order it requires; without it, pages of a tied ordering
 * drop and repeat rows silently, which here is an invoice missing from a
 * quarter somebody files.
 */
async function fetchInvoices(sb, tenantId, upToDay) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('gym_invoices')
        .select('id, number, member_id, membership_id, amount_cents, currency, issued_on, due_on, status, note, billed_name')
        .eq('tenant_id', tenantId)
        .lte('issued_on', upToDay)
        .order('issued_on', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), 'the invoices up to the end of this month');
    if (!rows.length)
        return [];
    const names = await namesFor(sb, rows.map((r) => r.member_id));
    return rows.map((r) => ({
        id: r.id,
        number: Number.isFinite(r.number) ? r.number : null,
        memberId: r.member_id ?? null,
        // `billed_name` is the snapshot supabase/parts/184 leaves behind when a
        // member is erased, and it is the ONLY thing that keeps a retained invoice
        // legible. The live name wins while there is one, because a member who
        // changed their name should read as their current one on an open bill.
        memberName: (r.member_id ? names.get(r.member_id) : null) ?? r.billed_name ?? null,
        membershipId: r.membership_id ?? null,
        // Not `?? 0`. An invoice with no amount is money of unknown size, and every
        // total on both money screens refuses rather than absorbing it.
        amountCents: r.amount_cents ?? null,
        // Not `?? 'AED'`. The column is NOT NULL and has had no default since
        // supabase/parts/150, so this branch does not fire against a healthy
        // database. "In practice" is what every currency bug in this repo was made
        // of, so it is written anyway: null reaches money(), which withholds.
        currency: r.currency ?? null,
        issuedOn: r.issued_on,
        dueOn: r.due_on ?? null,
        status: r.status ?? null,
        note: r.note ?? null,
    }));
}
/* ── writes ────────────────────────────────────────────────────────────────── */
/**
 * Raise an invoice.
 *
 * The NUMBER comes from the database, through `next_gym_invoice_number` — never
 * from `max(number) + 1` computed here. The client-side version is a race: two
 * invoices raised in two browser tabs read the same maximum, and the unique
 * index in supabase/parts/180 then rejects the second with 23505 after the form
 * has closed. An invoice number is what a member quotes on a bank transfer, so
 * two bills carrying one number is worse than the write failing.
 *
 * A gym whose database has not had part 168 applied gets a NULL number rather
 * than a failed write: the rpc is attempted and its failure is absorbed, the
 * invoice is raised unnumbered, and the screen says so. That trade is
 * deliberate — the invoice is the record and the number is a label on it, and
 * refusing to bill anybody because a migration is outstanding is the worse of
 * the two failures.
 */
async function createInvoice(sb, tenantId, inv) {
    const year = Number(inv.issuedOn.slice(0, 4));
    let number = null;
    if (typeof sb.rpc === 'function') {
        // no-error-ok: an unnumbered invoice is a labelling gap; refusing to bill over it is worse. The screen reports the null.
        const res = await sb.rpc('next_gym_invoice_number', { p_tenant: tenantId, p_year: year });
        const n = res?.data;
        if (typeof n === 'number' && Number.isFinite(n))
            number = n;
    }
    const { error } = await sb.from('gym_invoices').insert({
        tenant_id: tenantId,
        member_id: inv.memberId,
        membership_id: inv.membershipId ?? null,
        amount_cents: inv.amountCents,
        currency: inv.currency,
        issued_on: inv.issuedOn,
        due_on: inv.dueOn ?? null,
        status: inv.status ?? 'open',
        note: inv.note ?? null,
        number,
    });
    if (error)
        throw error;
    return { number };
}
/**
 * Move an invoice from one status to another.
 *
 * The COUNT is checked, not `error` alone. `gym_invoices_owner` is
 * `is_owner_of(tenant_id)` and is the only policy granting UPDATE, so an update
 * run by anybody else matches ZERO ROWS and returns `error: null` — and the
 * screen would say the invoice was written off while it is still open and still
 * being chased. See src/lib/wroteRows.ts.
 */
async function setInvoiceStatus(sb, invoiceId, status) {
    const r = await sb.from('gym_invoices').update({ status }, { count: 'exact' }).eq('id', invoiceId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('That invoice', r);
}
/**
 * Mark an invoice paid BY a named payment.
 *
 * Two writes and the order matters: the link first, then the status. If the
 * second fails the invoice is still open with a payment attached to it — wrong,
 * visible, and fixable by pressing the button again. The other order marks an
 * invoice paid with nothing recording what paid it, which is precisely the row
 * the "Marked paid, no payment behind it" exception list exists to find, minted
 * by the feature meant to empty that list.
 */
async function settleInvoice(sb, invoiceId, paymentId) {
    const link = await sb.from('gym_payments')
        .update({ invoice_id: invoiceId }, { count: 'exact' })
        .eq('id', paymentId);
    if (link.error)
        throw link.error;
    (0, wroteRows_1.assertWrote)('The payment against that invoice', link);
    await setInvoiceStatus(sb, invoiceId, 'paid');
}
/* ── helpers ───────────────────────────────────────────────────────────────── */
/** CHUNKED, because `fetchInvoices` above now pages. A bare `.in()` was safe
 *  only while the read above refused past a thousand rows — a thousand invoices
 *  carry at most a thousand distinct members, so the lookup could not truncate
 *  and the refusal was holding it up. See src/lib/idLookup.ts. */
async function namesFor(sb, ids) {
    const out = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        // no-error-ok: an unreadable name falls back to the retained billed_name and then to a dash; the invoice it labels is still real
        const { data } = await sb.from('profiles').select('id, full_name').in('id', chunk).limit((0, rowCap_1.capLimit)());
        for (const p of (data ?? [])) {
            const n = (p.full_name || '').trim();
            if (n)
                out.set(p.id, n);
        }
    }
    return out;
}
