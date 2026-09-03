"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// "Who owes me money", and every way that answer can be wrong.
//
// Compile with tsc, then run under plain node.
//
// This is a list a self-employed person chases their own customers from, so
// each assertion below is aimed at a specific way the list could send them
// after money that is not owed, or fail to send them after money that is:
//
//   · an invoice with NO due date reported as "not due", which would put every
//     document issued before part 188 into the reassuring pile;
//   · an invoice the coach already stated was received appearing as outstanding,
//     which is a reminder sent to somebody who has paid;
//   · a voided invoice appearing anywhere at all;
//   · an outstanding TOTAL stated over a read that did not come back whole — a
//     figure over the first page of a book is not a smaller number, it is a
//     wrong one, and it is the number the coach would chase on;
//   · two currencies added together;
//   · a day count that is off by one, which happens the moment the arithmetic
//     runs through a local DST boundary rather than through UTC.
const coachInvoice_1 = require("./coachInvoice");
const format_1 = require("./format");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => { if (!Object.is(a, b))
    errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const TODAY = '2026-09-01';
const inv = (over = {}) => ({
    id: 'i1',
    seq: 7,
    billTo: 'Dana Reyes',
    description: '8 personal training sessions',
    amountCents: 48000,
    currency: 'AED',
    kind: 'requested',
    issuedOn: '2026-08-01',
    ...over,
});
/* ── 1. the six states, and the two that are not about lateness ─────────── */
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-08-25' }), TODAY).state, 'overdue', 'past its date is overdue');
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-09-01' }), TODAY).state, 'due-today', 'the day itself is not yet late');
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-09-08' }), TODAY).state, 'not-due', 'ahead of its date is not due');
// THE assertion this whole feature turns on. Every invoice issued before part
// 168 carries a null due date, and reporting those as "not due" would tell a
// coach their entire back catalogue was comfortably within terms nobody ever
// wrote down.
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: null }), TODAY).state, 'undated', 'no due date is its own state, never "not due"');
eq((0, coachInvoice_1.invoiceAge)(inv({}), TODAY).state, 'undated', 'and an absent key reads the same as an explicit null');
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: 'next friday' }), TODAY).state, 'undated', 'a date that will not parse is undated, not overdue');
// The sentence names the absence rather than reporting a position against a
// date nobody typed, and it carries NO day count — a number of days beside an
// invoice with no due date would be a figure measured from nothing.
{
    const a = (0, coachInvoice_1.invoiceAge)(inv({ dueOn: null }), TODAY);
    ok(/no due date was stated/i.test(a.line), 'the sentence names the absence');
    ok(!/\d/.test(a.line), 'and puts no number in it, because there is nothing to count from');
    eq(a.daysOverdue, null, 'and states no days-late figure');
    eq(a.bucket, null, 'and belongs to no band');
}
// A coach's own claim that they were paid is what settles an invoice, because
// nothing tells this app when money actually arrives. Chasing somebody who has
// paid is the worst message this feature can produce.
eq((0, coachInvoice_1.invoiceAge)(inv({ kind: 'received', dueOn: '2026-01-01' }), TODAY).state, 'settled', 'stated received is settled however old it is');
eq((0, coachInvoice_1.invoiceAge)(inv({ voidedAt: '2026-08-02T00:00:00Z', dueOn: '2026-01-01' }), TODAY).state, 'voided', 'a voided invoice is not owed');
// Void wins over kind: a voided document is not a charge that stands whatever
// the coach said about the money before they cancelled it.
eq((0, coachInvoice_1.invoiceAge)(inv({ kind: 'received', voidedAt: '2026-08-02T00:00:00Z' }), TODAY).state, 'voided', 'and voided is read before the kind');
/* ── 2. the day count, which must not lose a day to daylight saving ─────── */
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-08-31' }), TODAY).daysOverdue, 1, 'one day past is one day');
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-08-25' }), TODAY).daysOverdue, 7, 'seven days is seven');
// Across the northern spring-forward (29 Mar 2026 in Europe) and the autumn
// fall-back (25 Oct 2026). A local-midnight subtraction is 23 or 25 hours
// through these, and `(b - a) / 86400000` then floors to a day fewer than it
// should — which is the wrong side of a chasing decision. The arithmetic runs
// through Date.UTC precisely so these two are exact.
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-03-25' }), '2026-04-01').daysOverdue, 7, 'seven days across the spring change is still seven');
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-10-22' }), '2026-10-29').daysOverdue, 7, 'and seven across the autumn change is still seven');
// Nought days late and not late are different readings, so the field that
// counts lateness is null rather than zero where nothing is late.
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: TODAY }), TODAY).daysOverdue, null, 'due today has no days-late figure');
eq((0, coachInvoice_1.invoiceAge)(inv({ dueOn: '2026-09-30' }), TODAY).daysOverdue, null, 'nor does one that is not due');
/* ── 3. the bands ───────────────────────────────────────────────────────── */
eq((0, coachInvoice_1.ageBucket)(1), '1-7', 'a day late is the first band');
eq((0, coachInvoice_1.ageBucket)(7), '1-7', 'and the seventh day is still in it');
eq((0, coachInvoice_1.ageBucket)(8), '8-30', 'the eighth opens the second');
eq((0, coachInvoice_1.ageBucket)(30), '8-30', 'which runs to thirty');
eq((0, coachInvoice_1.ageBucket)(31), '31-60', 'then to sixty');
eq((0, coachInvoice_1.ageBucket)(61), '61+', 'and everything beyond is one band');
ok(Object.values(coachInvoice_1.BUCKET_TITLE).every((s) => s.length > 0), 'every band has a heading');
/* ── 4. the book ────────────────────────────────────────────────────────── */
const rows = [
    inv({ id: 'a', seq: 1, dueOn: '2026-06-01' }), // 92 days late
    inv({ id: 'b', seq: 2, dueOn: '2026-08-25' }), // 7 days late
    inv({ id: 'c', seq: 3, dueOn: '2026-09-30' }), // not due
    inv({ id: 'd', seq: 4, dueOn: null }), // undated
    inv({ id: 'e', seq: 5, dueOn: '2026-06-01', kind: 'received' }), // settled
    inv({ id: 'f', seq: 6, dueOn: '2026-06-01', voidedAt: '2026-07-01T00:00:00Z' }), // voided
];
{
    const b = (0, coachInvoice_1.ageingBook)(rows, 'ready', TODAY);
    eq(b.overdue.length, 2, 'two are overdue');
    eq(b.upcoming.length, 1, 'one is still to fall due');
    eq(b.undated.length, 1, 'one has no due date on it');
    // Neither a settled nor a voided invoice is on any list. A screen that
    // listed them would be asking the coach to chase money they have already
    // said they received, or a document they cancelled.
    const listed = [...b.overdue, ...b.upcoming, ...b.undated].map((a) => a.invoice.id);
    ok(!listed.includes('e'), 'a settled invoice is on no ageing list');
    ok(!listed.includes('f'), 'and neither is a voided one');
    // Longest overdue first. This is the order a person chases in, and a list
    // sorted the other way buries the one that matters at the bottom.
    eq(b.overdue[0].invoice.id, 'a', 'the oldest debt is at the top');
    eq(b.overdue[1].invoice.id, 'b', 'and the newer one below it');
    eq(b.overdue[0].age.bucket, '61+', 'ninety-two days is the last band');
    eq(b.overdue[1].age.bucket, '1-7', 'and seven days is the first');
}
/* ── 5. the outstanding figure, and every reason it is withheld ─────────── */
{
    const b = (0, coachInvoice_1.ageingBook)(rows, 'ready', TODAY);
    ok(b.outstanding !== null, 'a whole read states a figure');
    eq(b.outstanding.pots.length, 1, 'one currency, one pot');
    eq(b.outstanding.pots[0].currency, 'AED', 'in the currency the invoices carry');
    // Three invoices are in it: the two overdue and the one not yet due. The
    // undated one is NOT, and that is the point of `undatedNote`.
    eq(b.outstanding.pots[0].count, 3, 'the dated outstanding invoices are counted');
    eq(b.outstanding.pots[0].minorUnits, 48000 * 3, 'and summed');
    eq(b.withheld, null, 'and nothing is withheld');
    ok(!!b.undatedNote, 'the undated one is named rather than quietly left out');
    ok(/no due date/i.test(b.undatedNote), 'and the sentence says why');
}
// The whole point of LoadStatus, on the one screen where a wrong figure gets
// acted on. A total over a page of a longer book is not a smaller number.
for (const bad of ['error', 'partial', 'loading']) {
    const b = (0, coachInvoice_1.ageingBook)(rows, bad, TODAY);
    eq(b.outstanding, null, `no outstanding figure under '${bad}'`);
    ok(!!b.withheld, `and a reason is given under '${bad}'`);
    eq(b.undatedNote, null, `and nothing is claimed about undated invoices under '${bad}'`);
}
ok(/not a statement that nobody owes you/i.test((0, coachInvoice_1.ageingBook)([], 'error', TODAY).withheld), 'an empty list under error says it is not a statement that nobody owes anything');
// Two currencies are two amounts of money and are never one.
{
    const mixed = [inv({ id: 'g', seq: 9, dueOn: '2026-08-01', currency: 'GBP', amountCents: 9000 }), rows[1]];
    const b = (0, coachInvoice_1.ageingBook)(mixed, 'ready', TODAY);
    eq(b.outstanding.pots.length, 2, 'two currencies stay two pots');
    ok(b.outstanding.pots.every((p) => p.minorUnits !== 57000), 'and are never added into one figure');
}
// An amount with no currency on it is a hole in the total, counted rather than
// dropped, so a short figure is not read as the whole of what is owed.
{
    const b = (0, coachInvoice_1.ageingBook)([inv({ id: 'h', seq: 10, dueOn: '2026-08-01', currency: null })], 'ready', TODAY);
    eq(b.outstanding.unlabelled, 1, 'an unlabelled amount is counted');
    eq(b.outstanding.pots.length, 0, 'and is in no pot');
}
/* ── 6. chasing ─────────────────────────────────────────────────────────── */
eq((0, coachInvoice_1.chaseBlocker)(inv({ clientId: 'c1' })), null, 'an outstanding invoice tied to an account may be chased');
ok(!!(0, coachInvoice_1.chaseBlocker)(inv({ clientId: 'c1', kind: 'received' })), 'one the coach said was received may not');
ok(!!(0, coachInvoice_1.chaseBlocker)(inv({ clientId: 'c1', voidedAt: '2026-08-02T00:00:00Z' })), 'nor a voided one');
// A coach bills people who have never installed this app. That is an ordinary
// invoice and not a failure — but there is nobody here to notify, and the
// screen has to say so rather than offering a control that does nothing.
ok(!!(0, coachInvoice_1.chaseBlocker)(inv({ clientId: null })), 'and one not tied to an account has nobody to notify');
eq((0, coachInvoice_1.chaseHistoryLine)(inv({})), null, 'a never-chased invoice says nothing about chasing');
eq((0, coachInvoice_1.chaseHistoryLine)(inv({ reminderCount: 0 })), null, 'and neither does an explicit zero');
ok(/1 time/.test((0, coachInvoice_1.chaseHistoryLine)(inv({ reminderCount: 1, remindedAt: '2026-08-20T09:00:00Z' }))), 'one chase is singular');
ok(/4 times/.test((0, coachInvoice_1.chaseHistoryLine)(inv({ reminderCount: 4, remindedAt: '2026-08-20T09:00:00Z' }))), 'four is plural, so a coach can see they have already sent four');
// Derived, not pinned: the line renders the day in the reader's own language
// now, so a literal here asserted the formatter and not this module. What is
// still being claimed is that the date shown is the LAST reminder's.
ok((0, coachInvoice_1.chaseHistoryLine)(inv({ reminderCount: 2, remindedAt: '2026-08-20T09:00:00Z' })).includes((0, format_1.fmtPointDay)(2026, 7, 20)), 'and the last one is dated');
/* ── 7. the shortcut arithmetic ─────────────────────────────────────────── */
eq((0, coachInvoice_1.plusDays)('2026-09-01', 0), '2026-09-01', 'nought days on is the same day');
eq((0, coachInvoice_1.plusDays)('2026-09-01', 30), '2026-10-01', 'thirty days rolls the month');
eq((0, coachInvoice_1.plusDays)('2026-12-20', 30), '2027-01-19', 'and the year');
eq((0, coachInvoice_1.plusDays)('2028-02-27', 2), '2028-02-29', 'a leap day is a real day');
// Same DST argument as the day count above, from the other direction.
eq((0, coachInvoice_1.plusDays)('2026-03-25', 7), '2026-04-01', 'seven days across the spring change lands a week later');
eq((0, coachInvoice_1.plusDays)('2026-10-22', 7), '2026-10-29', 'and so does seven across the autumn one');
eq((0, coachInvoice_1.plusDays)('not a date', 7), '', 'a broken input produces nothing rather than a plausible wrong date');
/* ── 8. what may be issued ──────────────────────────────────────────────── */
const draft = (over = {}) => ({
    billTo: 'Dana Reyes',
    description: '8 sessions',
    amountText: '480',
    currency: 'AED',
    kind: 'requested',
    issuedOn: '2026-09-01',
    ...over,
});
eq((0, coachInvoice_1.invoiceBlockers)(draft()).length, 0, 'no due date is not a blocker — it is optional and it stays optional');
eq((0, coachInvoice_1.invoiceBlockers)(draft({ dueOn: '' })).length, 0, 'nor is an empty one');
eq((0, coachInvoice_1.invoiceBlockers)(draft({ dueOn: null })).length, 0, 'nor an explicit null');
eq((0, coachInvoice_1.invoiceBlockers)(draft({ dueOn: '2026-09-30' })).length, 0, 'a date after the issue date is allowed');
eq((0, coachInvoice_1.invoiceBlockers)(draft({ dueOn: '2026-09-01' })).length, 0, 'and so is the issue date itself');
// Refused, never corrected. A document that says it fell due before it was
// written is not one anybody can act on, and silently swapping the two dates
// would print terms the coach did not type.
ok((0, coachInvoice_1.invoiceBlockers)(draft({ dueOn: '2026-08-01' })).length > 0, 'a due date before the issue date is refused');
ok((0, coachInvoice_1.invoiceBlockers)(draft({ dueOn: '30 days' })).length > 0, 'and one that is not a date is refused rather than guessed at');
/* ── 9. the document ────────────────────────────────────────────────────── */
const issuer = { status: 'ready', name: 'Sam Whitfield', brand: 'Ironhaus Strength' };
{
    const d = (0, coachInvoice_1.coachInvoiceDoc)({ invoice: inv({ dueOn: '2026-09-15' }), issuer });
    // On the DOCUMENT, not only on the coach's list. A date the coach chases
    // against that the person being chased has never been shown is a term nobody
    // agreed to, and the first they would hear of it is the reminder.
    const due = (0, format_1.fmtPointDay)(2026, 8, 15);
    ok(d.html.includes(due), 'a stated due date is printed on the document');
    ok(d.text.includes(due), 'and in the text fallback, which some builds are all a client gets');
}
{
    const d = (0, coachInvoice_1.coachInvoiceDoc)({ invoice: inv({ dueOn: null }), issuer });
    // Nothing at all, rather than "none" or a dash — either of those would read
    // as a term of its own.
    ok(!/\bDue\b/.test(d.text), 'an invoice with no due date prints no due line');
}
// Said on every document, with or without a date on it. A reader with one needs
// to know what it is; a reader without one is entitled to know that this app
// adds no interest and no late fee to anything.
for (const withDate of [null, '2026-09-15']) {
    const d = (0, coachInvoice_1.coachInvoiceDoc)({ invoice: inv({ dueOn: withDate }), issuer });
    ok(d.html.includes('no interest or late fee'), `the no-interest sentence is on the document (due ${String(withDate)})`);
    ok(d.text.includes(coachInvoice_1.INVOICE_DUE_NOT_A_TERM), `and verbatim in the text (due ${String(withDate)})`);
}
// The whole reason `kind` was never widened to a third value. Lateness is
// derived every time it is asked, from a date and a clock; nothing stores it,
// so nothing can be stale.
ok(!/overdue/i.test((0, coachInvoice_1.coachInvoiceDoc)({ invoice: inv({ dueOn: '2026-06-01' }), issuer }).text), 'a document never calls itself overdue — this app is not told when anybody pays');
/* ── 9. THE INVOICE THE CLIENT ACTUALLY PAID ──────────────────────────────
   Until part 660 there was no way to say so. `kind` is on the document and
   immutable, correctly, so a 'requested' invoice that was paid had two exits
   and both were wrong: leave it at "61+ days overdue" for ever, in the
   outstanding figure and on part 613's nightly chase, or void it — which prints
   THIS INVOICE HAS BEEN VOIDED across a document that was paid in full and says
   it "is not a record of a charge that stands".

   The settlement is a NEW FACT and not an edit. Every assertion below is as
   much about what did NOT change as about what did. */
{
    const paid = inv({ dueOn: '2026-06-01', settledOn: '2026-08-20', settledAt: '2026-08-20T09:00:00.000Z' });
    const age = (0, coachInvoice_1.invoiceAge)(paid, TODAY);
    eq(age.state, 'settled', 'an invoice recorded as settled is settled, not 92 days overdue');
    eq(age.daysOverdue, null, 'and carries no day count');
    eq(age.bucket, null, 'and is in no chasing band');
    ok(age.line.includes('You recorded'), 'and the line says whose word it is, exactly as `kind` does');
    // The document still says what it said. This is the assertion that fails the
    // moment somebody "fixes" this by flipping `kind`.
    eq(paid.kind, 'requested', 'the kind on the row is untouched by a settlement');
    const doc = (0, coachInvoice_1.coachInvoiceDoc)({ invoice: paid, issuer });
    ok(doc.text.includes('The issuer states this amount is being requested.'), 'and the reprinted document still carries the claim it was issued with');
    ok(doc.text.includes(`the issuer states this was paid on ${(0, format_1.fmtPointDay)(2026, 7, 20)}`), 'beside the new fact, dated, as the issuer’s own statement');
    ok(!doc.text.includes('VOIDED'), 'and nothing about it is voided');
    // Off every list and out of the figure, which is the whole point.
    const book = (0, coachInvoice_1.ageingBook)([paid, inv({ id: 'i2', seq: 8, dueOn: '2026-08-01' })], 'ready', TODAY);
    eq(book.overdue.length, 1, 'a settled invoice is on no overdue list');
    eq(book.overdue[0].invoice.id, 'i2', 'only the one that is genuinely outstanding is');
    eq(book.outstanding?.pots[0]?.count, 1, 'and it is out of the outstanding figure too');
    // And it cannot be chased, which is the act the coach would otherwise perform
    // against somebody who has paid.
    ok(((0, coachInvoice_1.chaseBlocker)(paid) ?? '').includes('settled'), 'a settled invoice cannot be chased, and says why');
    ok(((0, coachInvoice_1.settleBlocker)(paid) ?? '').includes('written once'), 'nor settled twice');
    ok(!!(0, coachInvoice_1.settleBlocker)(inv({ kind: 'received' })), 'a "received" invoice has nothing to settle — it already says so');
    ok(!!(0, coachInvoice_1.settleBlocker)(inv({ voidedAt: '2026-08-02T00:00:00.000Z', voidReason: 'duplicate' })), 'nor has a voided one');
    eq((0, coachInvoice_1.settleBlocker)(inv({ dueOn: '2026-08-25' })), null, 'and an ordinary overdue one can be settled');
    // Both ends of the day are refused rather than corrected.
    ok(!!(0, coachInvoice_1.settleDayBlocker)(inv(), '2026-07-01', TODAY)?.includes('before the invoice was written'), 'money cannot have arrived before the invoice existed');
    ok(!!(0, coachInvoice_1.settleDayBlocker)(inv(), '2026-09-02', TODAY)?.includes('has not happened'), 'nor on a day that has not happened');
    ok(!!(0, coachInvoice_1.settleDayBlocker)(inv(), 'soon', TODAY), 'and a non-date is refused rather than parsed');
    eq((0, coachInvoice_1.settleDayBlocker)(inv(), '2026-08-20', TODAY), null, 'a real day between the two is accepted');
    // Nothing is claimed about a settlement that is not there. The extra
    // paragraph appears only on a document that carries one.
    ok(!(0, coachInvoice_1.coachInvoiceDoc)({ invoice: inv({ dueOn: '2026-08-25' }), issuer }).text.includes('The settlement above'), 'an unsettled document says nothing about a settlement');
}
/* ── 10. THE BACK CATALOGUE NOBODY COULD CHASE ────────────────────────────
   `due_on` arrived in part 188 and is immutable, correctly. So every invoice
   issued before it — and every one since by a coach who left the optional box
   alone — was 'undated': in no outstanding figure, on no chase list, and the
   screen said so in a sentence ending "cannot be added afterwards".

   `chaseFrom` is not a due date, and every assertion below is about keeping the
   two apart. It is the coach's own note, it reaches no document, and it is
   worded as theirs everywhere it appears. */
{
    const old = inv({ dueOn: null, issuedOn: '2026-06-01' });
    eq((0, coachInvoice_1.invoiceAge)(old, TODAY).state, 'undated', 'with no date of any kind it is still undated, never "not due"');
    ok((0, coachInvoice_1.invoiceAge)(old, TODAY).line.includes('Set a day to chase it from'), 'and the line now names the way out instead of describing a dead end');
    const planned = inv({ dueOn: null, issuedOn: '2026-06-01', chaseFrom: '2026-08-01' });
    const age = (0, coachInvoice_1.invoiceAge)(planned, TODAY);
    eq(age.state, 'overdue', 'a chase date the day has passed puts it on the overdue list at last');
    eq(age.daysOverdue, 31, 'and counts the days from that day, not from the issue date');
    eq(age.fromChaseDate, true, 'flagged as measured against the coach’s own note');
    ok(age.line.includes('you set'), 'and worded "you set", never "you stated"');
    ok(age.line.includes('No due date is on the document'), 'and says outright that the document carries none');
    // A due date always wins, so no invoice ever has two answers to "when is this
    // late". Part 660 refuses to write the second where the first exists; this is
    // the same rule read back.
    const both = inv({ dueOn: '2026-08-25', chaseFrom: '2026-07-01' });
    eq((0, coachInvoice_1.invoiceAge)(both, TODAY).daysOverdue, 7, 'where both are present the DOCUMENT’s date decides');
    eq((0, coachInvoice_1.invoiceAge)(both, TODAY).fromChaseDate, false, 'and it is not flagged as a private note');
    ok((0, coachInvoice_1.invoiceAge)(both, TODAY).line.includes('you stated'), 'and is worded as the term the client was shown');
    // It reaches no artefact. This is the assertion that fails if anybody ever
    // "helpfully" prints it on the invoice.
    const doc = (0, coachInvoice_1.coachInvoiceDoc)({ invoice: planned, issuer });
    ok(!doc.text.includes('1 Aug 2026'), 'a chase date is on no document');
    ok(!doc.html.includes('chase'), 'and the word does not appear on one either');
    // The blockers keep it off the invoices it must not be set on.
    eq((0, coachInvoice_1.chaseFromBlocker)(old), null, 'an undated requested invoice can take one');
    ok(((0, coachInvoice_1.chaseFromBlocker)(both) ?? '').includes('cannot be moved'), 'one that already carries a due date cannot, and says why');
    ok(!!(0, coachInvoice_1.chaseFromBlocker)(inv({ dueOn: null, kind: 'received' })), 'nor can one stating the money was received');
    ok(!!(0, coachInvoice_1.chaseFromBlocker)(inv({ dueOn: null, settledOn: '2026-08-20', settledAt: '2026-08-20T09:00:00.000Z' })), 'nor a settled one');
    ok(!!(0, coachInvoice_1.chaseFromDayBlocker)(old, '2026-05-01')?.includes('before the invoice was written'), 'a chase date before the invoice is refused');
    eq((0, coachInvoice_1.chaseFromDayBlocker)(old, '2027-03-01'), null, 'and there is deliberately no upper bound — waiting until March is a plan, not an error');
    // The note under the undated list names the act rather than describing a
    // permanent condition.
    const book = (0, coachInvoice_1.ageingBook)([old], 'ready', TODAY);
    eq(book.undated.length, 1, 'an invoice with no date of any kind is still on its own list');
    ok((book.undatedNote ?? '').includes('set a day to start chasing'), 'and the note tells the coach what they can do about it');
    ok(!(book.undatedNote ?? '').includes('cannot be added afterwards'), 'rather than the dead end it used to describe');
    // And once a chase date is set it counts in the figure, which is the second
    // half of what was broken: these were outside every total as well as off
    // every list.
    const after = (0, coachInvoice_1.ageingBook)([planned], 'ready', TODAY);
    eq(after.undated.length, 0, 'a planned invoice is off the undated list');
    eq(after.outstanding?.pots[0]?.count, 1, 'and inside the outstanding figure');
}
console.log(errors.length ? 'INVOICE AGEING FAILURES:\n' + errors.join('\n') : 'ALL INVOICE AGEING TESTS PASSED');
if (errors.length)
    process.exit(1);
