"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chaseGroups = chaseGroups;
exports.chaseMessage = chaseMessage;
exports.chaseMessageCaveat = chaseMessageCaveat;
// Chasing money by PERSON, and the note a coach sends to do it.
//
// ── What the invoices screen gave a coach, and what chasing actually is ────
//
// app/(trainer)/invoices.tsx answers "who owes me money" as a list of
// DOCUMENTS, banded by how late each one is. That is the right answer to the
// question and it is the wrong shape for the act: nobody sends four messages to
// one client about four invoices. They send one message naming all four.
//
// So the coach did that grouping in their head, every time, off a list sorted
// by lateness — which interleaves people — and then typed the message by hand:
// the numbers, the amounts, the dates, one at a time, off a screen they had to
// keep scrolling back to.
//
// ── And the invoice that could not be chased at all ───────────────────────
//
// `chaseBlocker` refuses an invoice with no `clientId`, correctly: there is no
// account to notify. Its sentence ends "Send it to them the way you sent it the
// first time" — and the app offered nothing at all for that path, while being
// the app whose own header says half a working book pays "in cash, by transfer,
// or through a gym". Those are exactly the clients with no account. The in-app
// notification is not the chase; it never was. This is.
//
// ── Rules this file holds, every one of them because the artefact leaves ──
//
//   1. A CHASE DATE IS NEVER IN IT. `chaseFrom` is the coach's own note about
//      their own working list. The column's comment is explicit: it is never
//      printed on the document and was never shown to the client. So an invoice
//      whose lateness is measured from one appears in the note WITHOUT the
//      lateness — number, amount, date issued, nothing more. `invoiceAge`
//      already carries `fromChaseDate` for exactly this reason.
//
//   2. NO CURRENCY IS ADDED TO ANOTHER. A client billed in two currencies gets
//      two outstanding lines, never one sum. `sumTaken` does the arithmetic so
//      there is not a second spelling of it.
//
//   3. NOTHING IS BUILT FROM A READ THAT CAME BACK SHORT. Under 'partial' the
//      invoices listed are real but they are not all of them, and a note that
//      says "these three are outstanding" when there are five is a demand for
//      the wrong money under the coach's name. There is no message at all, and
//      a sentence says why.
//
//   4. IT IS THE COACH'S RECORD, SAID AS THE COACH'S RECORD.
//      `AGEING_IS_YOUR_OWN_RECORD` — nobody tells this app when a client pays.
//      A client who paid on Friday must not be sent a note asserting they did
//      not, so the note says what the coach's records show and asks.
//
// Pure and framework-free: no clock, no storage, no network. `today` comes from
// the device, through the caller, exactly as it does for `ageingBook`.
const coachInvoice_1 = require("./coachInvoice");
const coachMoney_1 = require("./coachMoney");
const fold = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/**
 * Group what is outstanding by who owes it.
 *
 * Built from the OVERDUE and DUE-TODAY lists only. An invoice that is not due
 * yet is not something to chase, and one carrying no date of any kind is on no
 * list and cannot be described as late — `ageingBook` keeps both apart already
 * and this does not fold them back together.
 */
function chaseGroups(book, status) {
    const rows = [
        ...(book?.overdue ?? []),
        ...(book?.upcoming ?? []).filter((r) => r.age.state === 'due-today'),
    ];
    const withheld = status === 'ready'
        ? null
        : status === 'partial'
            ? 'More invoices are on record than could be read in one request, so no amount is stated per person and no note can be written. What is listed is real; it is not all of it.'
            : status === 'loading'
                ? 'Still reading your invoices, so nothing here is grouped by who owes it yet.'
                : 'Your invoices could not be read, so nothing here is grouped by who owes it. An empty list is not a statement that nobody owes you anything.';
    const by = new Map();
    for (const r of rows) {
        const inv = r.invoice;
        const id = String(inv.clientId ?? '').trim();
        const name = String(inv.billTo ?? '').trim();
        const key = id ? 'id:' + id : 'name:' + fold(name);
        const g = by.get(key);
        if (g) {
            g.rows.push(r);
            // The most recently issued spelling wins, so a coach who corrected a name
            // on a later invoice sees the correction rather than the first attempt.
            if (String(inv.issuedOn ?? '') >= String(g.rows[0]?.invoice.issuedOn ?? ''))
                g.billTo = name || g.billTo;
        }
        else {
            by.set(key, { billTo: name, clientId: id || null, rows: [r] });
        }
    }
    const groups = [...by.entries()].map(([key, g]) => {
        const invoices = g.rows.slice().sort((a, b) => (b.age.daysOverdue ?? 0) - (a.age.daysOverdue ?? 0) || a.invoice.seq - b.invoice.seq);
        const taken = (0, coachMoney_1.sumTaken)(invoices.map(({ invoice }) => ({
            amount_cents: invoice.amountCents,
            currency: invoice.currency,
            created_at: invoice.issuedOn,
        })));
        return {
            key,
            billTo: g.billTo,
            clientId: g.clientId,
            invoices,
            // Past a date the CLIENT WAS SHOWN. An invoice late against the coach's
            // own chase note is outstanding and is not something the client has run
            // past, and this count is what a screen puts in front of the coach.
            overdue: invoices.filter((r) => r.age.state === 'overdue' && !r.age.fromChaseDate).length,
            pots: status === 'ready' ? taken.pots : null,
            unlabelled: taken.unlabelled + taken.unpriced,
            worstDays: invoices.reduce((a, r) => Math.max(a, r.age.daysOverdue ?? 0), 0),
        };
    });
    // The person who has been waiting longest, first — which is the order a coach
    // works down. Ties break on the name so the list cannot flap between renders.
    groups.sort((a, b) => b.worstDays - a.worstDays || a.billTo.localeCompare(b.billTo));
    return { groups, withheld };
}
/**
 * One line of the note: the number, the amount, and — only where the client was
 * shown a date — how late it is.
 *
 * The amount goes through `minorMoney`, which returns null rather than a bare
 * figure when the currency is missing. A number with no currency beside it is
 * not an amount of money, and this line is going to the person being asked for
 * it, so the line names the document instead and leaves the figure to it.
 */
function noteLine(row) {
    const inv = row.invoice;
    const amount = (0, coachMoney_1.minorMoney)(inv.amountCents, inv.currency);
    const head = `${(0, coachInvoice_1.invoiceNumber)(inv.seq)} — ${amount ?? 'see the invoice for the amount'}`;
    const what = String(inv.description ?? '').trim();
    const body = what ? `${head}, for ${what}` : head;
    // A chase date is the coach's own working note and was never shown to
    // anybody. It cannot appear here, in any wording, so an invoice that is only
    // "late" against one carries its issue date and nothing about lateness.
    if (row.age.state === 'overdue' && !row.age.fromChaseDate && inv.dueOn) {
        const d = row.age.daysOverdue ?? 0;
        return `${body}, due ${(0, coachInvoice_1.invoiceDayLabel)(inv.dueOn)} — ${d} ${d === 1 ? 'day' : 'days'} ago`;
    }
    if (row.age.state === 'due-today' && !row.age.fromChaseDate && inv.dueOn) {
        return `${body}, due today`;
    }
    return `${body}, issued ${(0, coachInvoice_1.invoiceDayLabel)(inv.issuedOn)}`;
}
/**
 * The note itself, ready to send however the coach already talks to them.
 *
 * Null when it must not be written: nothing outstanding, or a read that did not
 * come back whole. A caller that got a string here for a partial read would put
 * a demand for part of somebody's balance under the coach's own name.
 *
 * `from` is the coach's own name, or null when it could not be read — in which
 * case there is no sign-off rather than a sign-off from the platform. An
 * invoice with the wrong business on it is the fault src/lib/coachInvoice.ts
 * refuses, and a note is a smaller version of the same artefact.
 *
 * Nothing in it is generated about the client. Every fact in the note is one
 * the coach recorded: a number this app allocated, an amount they typed, a
 * description they wrote, a date they stated.
 */
function chaseMessage(group, from) {
    if (!group || !group.invoices.length || group.pots === null)
        return null;
    const name = String(group.billTo ?? '').trim();
    const lines = [];
    lines.push(name ? `Hello ${name},` : 'Hello,');
    lines.push('');
    lines.push(group.invoices.length === 1
        ? 'My records show this one still outstanding:'
        : `My records show these ${group.invoices.length} still outstanding:`);
    lines.push('');
    for (const row of group.invoices)
        lines.push(`· ${noteLine(row)}`);
    lines.push('');
    // One line per currency and never a sum across them. Only worth stating at
    // all when there is more than one invoice — with one, the figure is already
    // on the line above it and repeating it reads as a second charge.
    if (group.invoices.length > 1) {
        for (const pot of group.pots) {
            const total = (0, coachMoney_1.minorMoney)(pot.minorUnits, pot.currency);
            if (total)
                lines.push(`Outstanding in ${pot.currency}: ${total}`);
        }
        if (group.pots.length)
            lines.push('');
    }
    // Asks rather than asserts. Nothing tells this app when somebody pays, so a
    // note claiming they have not is a claim the coach cannot stand behind — and
    // the client who paid on Friday is exactly who reads it.
    lines.push('If any of these have already been paid, let me know and I will update my records. Otherwise, could you tell me when to expect them?');
    if (from && from.trim()) {
        lines.push('');
        lines.push(`Thanks, ${from.trim()}`);
    }
    return lines.join('\n');
}
/**
 * What the coach is told before the note goes anywhere, or null.
 *
 * Said BEFORE it is sent rather than discovered afterwards: an invoice with no
 * currency on it carries no figure in the note and is in no total, and a coach
 * who sends it without knowing that has under-asked for their own money.
 */
function chaseMessageCaveat(group) {
    const n = group?.unlabelled ?? 0;
    if (!n)
        return null;
    return n === 1
        ? 'One of these has no amount recorded against it here, so the note names the invoice and leaves the figure to the document itself. It is in no total.'
        : `${n} of these have no amount recorded against them here, so the note names the invoices and leaves the figures to the documents themselves. They are in no total.`;
}
