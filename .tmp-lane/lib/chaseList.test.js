"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Chasing by person: the grouping, and the note that leaves the phone.
//
// ── The three that would be wrong in somebody else's inbox ────────────────
//
//   1. A CHASE DATE APPEARING IN THE NOTE. `chaseFrom` is the coach's private
//      note about their own working list. It is on no document and was never
//      shown to the client, and a note reading "12 days past 3 August" about a
//      date nobody ever gave them is the coach inventing a term. The assertion
//      is that such an invoice appears in the note with NO lateness at all.
//
//   2. TWO CURRENCIES ADDED TOGETHER. A client billed in pounds and in euros
//      does not owe the sum of the two numbers, and the note is a demand.
//
//   3. A NOTE BUILT FROM A TRUNCATED READ. "These three are still outstanding"
//      when the read stopped at three of five is a demand for the wrong money.
//
// Compile with tsc, run with node.
const chaseList_1 = require("./chaseList");
const coachInvoice_1 = require("./coachInvoice");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const TODAY = '2026-09-03';
let SEQ = 0;
const inv = (over) => ({
    id: 'i' + (++SEQ), seq: SEQ, billTo: 'Priya Nair', description: 'August coaching',
    amountCents: 12000, currency: 'GBP', kind: 'requested', issuedOn: '2026-08-01',
    ...over,
});
const bookOf = (rows, status = 'ready') => (0, coachInvoice_1.ageingBook)(rows, status, TODAY);
/* ── grouping ───────────────────────────────────────────────────────────── */
{
    const a1 = inv({ clientId: 'c1', billTo: 'Priya', dueOn: '2026-08-10' }); // 24 days late
    const a2 = inv({ clientId: 'c1', billTo: 'Priya Nair', dueOn: '2026-09-01', issuedOn: '2026-08-20' }); // 2 days
    const b1 = inv({ clientId: null, billTo: 'Marek K', dueOn: '2026-09-03' }); // due today
    const notYet = inv({ clientId: 'c9', billTo: 'Later', dueOn: '2026-12-01' });
    const noDate = inv({ clientId: 'c8', billTo: 'Undated' });
    const settled = inv({ clientId: 'c7', billTo: 'Paid', dueOn: '2026-01-01', settledOn: '2026-02-01' });
    const { groups, withheld } = (0, chaseList_1.chaseGroups)(bookOf([a1, a2, b1, notYet, noDate, settled]), 'ready');
    eq(withheld, null, 'a whole read withholds nothing');
    eq(groups.length, 2, 'one group per payer, and only payers with something outstanding');
    eq(groups[0].billTo, 'Priya Nair', 'two invoices to one account are one group, under the latest spelling of the name');
    eq(groups[0].invoices.length, 2, 'both of their invoices are in it');
    eq(groups[0].worstDays, 24, 'the group is measured by its oldest');
    eq(groups[0].invoices[0].invoice.id, a1.id, 'the longest overdue is first inside the group');
    eq(groups[1].billTo, 'Marek K', 'a payer with no account is still a group');
    eq(groups[1].clientId, null, 'somebody the coach typed into their book has no account id');
    eq(groups[0].key !== groups[1].key, true, 'the keys are distinct');
    ok(groups[0].worstDays > groups[1].worstDays, 'the person waiting longest is first');
    ok(!groups.some((g) => g.invoices.some((r) => r.invoice.id === notYet.id)), 'an invoice that is not due yet is not chased');
    ok(!groups.some((g) => g.invoices.some((r) => r.invoice.id === noDate.id)), 'an invoice with no date of any kind is on no chase list');
    ok(!groups.some((g) => g.invoices.some((r) => r.invoice.id === settled.id)), 'a settled invoice is not chased');
    eq(groups[0].pots?.length, 1, 'one currency is one pot');
    eq(groups[0].pots?.[0].minorUnits, 24000, 'the pot is the sum of that currency');
    eq(groups[0].unlabelled, 0, 'nothing is missing a currency here');
}
/* ── two spellings, two people ──────────────────────────────────────────── */
{
    // No account to join them on, so two spellings stay two groups. Guessing they
    // are the same person is how a note about somebody else's invoices ends up in
    // somebody's inbox.
    const g = (0, chaseList_1.chaseGroups)(bookOf([
        inv({ clientId: null, billTo: 'Sam Lee', dueOn: '2026-08-01' }),
        inv({ clientId: null, billTo: 'Samuel Lee', dueOn: '2026-08-01' }),
        inv({ clientId: null, billTo: '  sam lee ', dueOn: '2026-08-01' }),
    ]), 'ready').groups;
    eq(g.length, 2, 'different spellings are different people; the same name spaced differently is not');
}
/* ── the read that is not allowed to produce a note ─────────────────────── */
{
    const rows = [inv({ clientId: 'c1', billTo: 'Priya', dueOn: '2026-08-10' })];
    for (const status of ['partial', 'loading', 'error']) {
        const b = (0, chaseList_1.chaseGroups)(bookOf(rows, status), status);
        ok(!!b.withheld, `${status}: a sentence says why`);
        for (const g of b.groups) {
            eq(g.pots, null, `${status}: no amount is stated per person`);
            eq((0, chaseList_1.chaseMessage)(g, 'Sam'), null, `${status}: no note is written`);
        }
    }
    const part = String((0, chaseList_1.chaseGroups)(bookOf(rows, 'partial'), 'partial').withheld);
    const failed = String((0, chaseList_1.chaseGroups)(bookOf(rows, 'error'), 'error').withheld);
    const loading = String((0, chaseList_1.chaseGroups)(bookOf(rows, 'loading'), 'loading').withheld);
    ok(part !== failed && failed !== loading && part !== loading, 'truncated, failed and loading are three different sentences');
    // A truncated read still LISTS what came back — those invoices are real. It is
    // the figure and the note that are refused.
    eq((0, chaseList_1.chaseGroups)(bookOf(rows, 'partial'), 'partial').groups.length, 1, 'a truncated read still shows who it did read');
}
/* ── the note ───────────────────────────────────────────────────────────── */
{
    const one = inv({ seq: 4, clientId: 'c1', billTo: 'Priya', description: 'August block', dueOn: '2026-08-10' });
    const two = inv({ seq: 7, clientId: 'c1', billTo: 'Priya', description: 'Session pack', dueOn: '2026-09-01', issuedOn: '2026-08-20' });
    const g = (0, chaseList_1.chaseGroups)(bookOf([one, two]), 'ready').groups[0];
    const note = String((0, chaseList_1.chaseMessage)(g, 'Sam Okafor'));
    ok(note.startsWith('Hello Priya,'), 'the note opens with the name on the documents');
    ok(note.includes('0004') && note.includes('0007'), 'every outstanding invoice is named by its number');
    ok(note.includes('August block'), 'the description the coach wrote is on the line');
    ok(note.includes('GBP'), 'the amounts carry their currency');
    ok(/24 days ago/.test(note), 'how late it is is stated where the client was shown a date');
    ok(/Outstanding in GBP/.test(note), 'the total for that currency is stated once');
    ok(note.includes('Thanks, Sam Okafor'), 'it is signed by the coach');
    ok(/already been paid/.test(note), 'it asks rather than asserting they have not paid');
    ok(!/overdue|late|owe/i.test(note), 'nothing in it accuses anybody');
    // No name for the coach is no sign-off, never the platform's name.
    const unsigned = String((0, chaseList_1.chaseMessage)(g, null));
    ok(!/Thanks,/.test(unsigned), 'a coach whose name could not be read gets no sign-off');
    ok(unsigned.includes('0004'), 'the rest of the note is unchanged by that');
    // One invoice does not repeat its own figure as a total.
    const single = (0, chaseList_1.chaseGroups)(bookOf([one]), 'ready').groups[0];
    const solo = String((0, chaseList_1.chaseMessage)(single, 'Sam'));
    ok(!/Outstanding in/.test(solo), 'a single invoice is not totalled underneath itself');
    ok(/this one still outstanding/.test(solo), 'one invoice reads as one');
    eq((0, chaseList_1.chaseMessage)(null, 'Sam'), null, 'no group is no note');
}
/* ── the chase date that must never leave the phone ─────────────────────── */
{
    // No due date on the document; the coach set their own day to start chasing.
    // It is 34 days ago and the client has never seen it.
    const priv = inv({ seq: 9, clientId: 'c2', billTo: 'Marek', chaseFrom: '2026-07-31' });
    const g = (0, chaseList_1.chaseGroups)(bookOf([priv]), 'ready').groups[0];
    eq(g.invoices.length, 1, 'an invoice late against a chase date is still something to chase');
    eq(g.overdue, 0, 'it is not counted as past a date the client was shown');
    ok(g.worstDays > 0, 'the coach still sees how long they have been waiting');
    const note = String((0, chaseList_1.chaseMessage)(g, 'Sam'));
    ok(note.includes('0009'), 'the invoice is in the note');
    ok(!/2026|July|Jul/.test(note.replace(/issued [^\n]*/g, '')), 'the chase date itself is nowhere in the note');
    ok(!/days ago|due /.test(note), 'no lateness is claimed against a date nobody was given');
    ok(/issued /.test(note), 'the note states when it was issued instead, which is on the document');
}
/* ── two currencies are two amounts ─────────────────────────────────────── */
{
    const g = (0, chaseList_1.chaseGroups)(bookOf([
        inv({ seq: 1, clientId: 'c3', billTo: 'Ana', amountCents: 10000, currency: 'GBP', dueOn: '2026-08-01' }),
        inv({ seq: 2, clientId: 'c3', billTo: 'Ana', amountCents: 5000, currency: 'EUR', dueOn: '2026-08-01' }),
    ]), 'ready').groups[0];
    eq(g.pots?.length, 2, 'two currencies are two pots');
    const note = String((0, chaseList_1.chaseMessage)(g, null));
    ok(/Outstanding in GBP/.test(note) && /Outstanding in EUR/.test(note), 'each currency is stated on its own line');
    ok(!/15000|150\.00/.test(note), 'the two are never added together');
}
/* ── an amount with no currency on it ───────────────────────────────────── */
{
    const g = (0, chaseList_1.chaseGroups)(bookOf([
        inv({ seq: 3, clientId: 'c4', billTo: 'Bo', amountCents: 9000, currency: null, dueOn: '2026-08-01' }),
        inv({ seq: 5, clientId: 'c4', billTo: 'Bo', amountCents: 4000, currency: 'GBP', dueOn: '2026-08-01' }),
    ]), 'ready').groups[0];
    eq(g.unlabelled, 1, 'the invoice with no currency is counted, never summed');
    const note = String((0, chaseList_1.chaseMessage)(g, null));
    ok(/see the invoice for the amount/.test(note), 'a figure with no currency is left to the document');
    ok(!/9000|90\.00/.test(note), 'a bare number is never printed as money');
    ok(/Outstanding in GBP/.test(note) && !/Outstanding in\s*:/.test(note), 'only the currency that has one is totalled');
    const caveat = String((0, chaseList_1.chaseMessageCaveat)(g));
    ok(/no amount recorded/.test(caveat), 'the coach is told before they send it');
    eq((0, chaseList_1.chaseMessageCaveat)({ ...g, unlabelled: 0 }), null, 'nothing missing is nothing to say');
    ok(/^One of these/.test(String((0, chaseList_1.chaseMessageCaveat)(g))), 'one reads as one');
    ok(/^2 of these/.test(String((0, chaseList_1.chaseMessageCaveat)({ ...g, unlabelled: 2 }))), 'two reads as two');
}
/* ── nothing outstanding ────────────────────────────────────────────────── */
{
    const b = (0, chaseList_1.chaseGroups)(bookOf([]), 'ready');
    eq(b.groups.length, 0, 'nobody owes anything and there is no group');
    eq(b.withheld, null, 'and nothing is withheld about it');
    eq((0, chaseList_1.chaseGroups)(null, 'ready').groups.length, 0, 'a missing book is answered rather than thrown at');
}
if (errors.length) {
    console.error(`chaseList: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  · ${e}`);
    process.exit(1);
}
console.log('chaseList: ok');
