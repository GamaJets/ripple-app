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
import {
  invoiceAge,
  ageingBook,
  ageBucket,
  plusDays,
  chaseBlocker,
  chaseHistoryLine,
  invoiceBlockers,
  coachInvoiceDoc,
  BUCKET_TITLE,
  INVOICE_DUE_NOT_A_TERM,
  type CoachInvoice,
  type InvoiceDraft,
} from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const TODAY = '2026-09-01';

const inv = (over: Partial<CoachInvoice> = {}): CoachInvoice => ({
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

eq(invoiceAge(inv({ dueOn: '2026-08-25' }), TODAY).state, 'overdue', 'past its date is overdue');
eq(invoiceAge(inv({ dueOn: '2026-09-01' }), TODAY).state, 'due-today', 'the day itself is not yet late');
eq(invoiceAge(inv({ dueOn: '2026-09-08' }), TODAY).state, 'not-due', 'ahead of its date is not due');

// THE assertion this whole feature turns on. Every invoice issued before part
// 168 carries a null due date, and reporting those as "not due" would tell a
// coach their entire back catalogue was comfortably within terms nobody ever
// wrote down.
eq(invoiceAge(inv({ dueOn: null }), TODAY).state, 'undated', 'no due date is its own state, never "not due"');
eq(invoiceAge(inv({}), TODAY).state, 'undated', 'and an absent key reads the same as an explicit null');
eq(invoiceAge(inv({ dueOn: 'next friday' }), TODAY).state, 'undated', 'a date that will not parse is undated, not overdue');
// The sentence names the absence rather than reporting a position against a
// date nobody typed, and it carries NO day count — a number of days beside an
// invoice with no due date would be a figure measured from nothing.
{
  const a = invoiceAge(inv({ dueOn: null }), TODAY);
  ok(/no due date was stated/i.test(a.line), 'the sentence names the absence');
  ok(!/\d/.test(a.line), 'and puts no number in it, because there is nothing to count from');
  eq(a.daysOverdue, null, 'and states no days-late figure');
  eq(a.bucket, null, 'and belongs to no band');
}

// A coach's own claim that they were paid is what settles an invoice, because
// nothing tells this app when money actually arrives. Chasing somebody who has
// paid is the worst message this feature can produce.
eq(invoiceAge(inv({ kind: 'received', dueOn: '2026-01-01' }), TODAY).state, 'settled', 'stated received is settled however old it is');
eq(invoiceAge(inv({ voidedAt: '2026-08-02T00:00:00Z', dueOn: '2026-01-01' }), TODAY).state, 'voided', 'a voided invoice is not owed');
// Void wins over kind: a voided document is not a charge that stands whatever
// the coach said about the money before they cancelled it.
eq(invoiceAge(inv({ kind: 'received', voidedAt: '2026-08-02T00:00:00Z' }), TODAY).state, 'voided', 'and voided is read before the kind');

/* ── 2. the day count, which must not lose a day to daylight saving ─────── */

eq(invoiceAge(inv({ dueOn: '2026-08-31' }), TODAY).daysOverdue, 1, 'one day past is one day');
eq(invoiceAge(inv({ dueOn: '2026-08-25' }), TODAY).daysOverdue, 7, 'seven days is seven');

// Across the northern spring-forward (29 Mar 2026 in Europe) and the autumn
// fall-back (25 Oct 2026). A local-midnight subtraction is 23 or 25 hours
// through these, and `(b - a) / 86400000` then floors to a day fewer than it
// should — which is the wrong side of a chasing decision. The arithmetic runs
// through Date.UTC precisely so these two are exact.
eq(invoiceAge(inv({ dueOn: '2026-03-25' }), '2026-04-01').daysOverdue, 7, 'seven days across the spring change is still seven');
eq(invoiceAge(inv({ dueOn: '2026-10-22' }), '2026-10-29').daysOverdue, 7, 'and seven across the autumn change is still seven');

// Nought days late and not late are different readings, so the field that
// counts lateness is null rather than zero where nothing is late.
eq(invoiceAge(inv({ dueOn: TODAY }), TODAY).daysOverdue, null, 'due today has no days-late figure');
eq(invoiceAge(inv({ dueOn: '2026-09-30' }), TODAY).daysOverdue, null, 'nor does one that is not due');

/* ── 3. the bands ───────────────────────────────────────────────────────── */

eq(ageBucket(1), '1-7', 'a day late is the first band');
eq(ageBucket(7), '1-7', 'and the seventh day is still in it');
eq(ageBucket(8), '8-30', 'the eighth opens the second');
eq(ageBucket(30), '8-30', 'which runs to thirty');
eq(ageBucket(31), '31-60', 'then to sixty');
eq(ageBucket(61), '61+', 'and everything beyond is one band');
ok(Object.values(BUCKET_TITLE).every((s) => s.length > 0), 'every band has a heading');

/* ── 4. the book ────────────────────────────────────────────────────────── */

const rows: CoachInvoice[] = [
  inv({ id: 'a', seq: 1, dueOn: '2026-06-01' }),                                   // 92 days late
  inv({ id: 'b', seq: 2, dueOn: '2026-08-25' }),                                   // 7 days late
  inv({ id: 'c', seq: 3, dueOn: '2026-09-30' }),                                   // not due
  inv({ id: 'd', seq: 4, dueOn: null }),                                           // undated
  inv({ id: 'e', seq: 5, dueOn: '2026-06-01', kind: 'received' }),                 // settled
  inv({ id: 'f', seq: 6, dueOn: '2026-06-01', voidedAt: '2026-07-01T00:00:00Z' }), // voided
];

{
  const b = ageingBook(rows, 'ready', TODAY);
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
  const b = ageingBook(rows, 'ready', TODAY);
  ok(b.outstanding !== null, 'a whole read states a figure');
  eq(b.outstanding!.pots.length, 1, 'one currency, one pot');
  eq(b.outstanding!.pots[0].currency, 'AED', 'in the currency the invoices carry');
  // Three invoices are in it: the two overdue and the one not yet due. The
  // undated one is NOT, and that is the point of `undatedNote`.
  eq(b.outstanding!.pots[0].count, 3, 'the dated outstanding invoices are counted');
  eq(b.outstanding!.pots[0].minorUnits, 48000 * 3, 'and summed');
  eq(b.withheld, null, 'and nothing is withheld');
  ok(!!b.undatedNote, 'the undated one is named rather than quietly left out');
  ok(/no due date/i.test(b.undatedNote!), 'and the sentence says why');
}

// The whole point of LoadStatus, on the one screen where a wrong figure gets
// acted on. A total over a page of a longer book is not a smaller number.
for (const bad of ['error', 'partial', 'loading'] as const) {
  const b = ageingBook(rows, bad, TODAY);
  eq(b.outstanding, null, `no outstanding figure under '${bad}'`);
  ok(!!b.withheld, `and a reason is given under '${bad}'`);
  eq(b.undatedNote, null, `and nothing is claimed about undated invoices under '${bad}'`);
}
ok(/not a statement that nobody owes you/i.test(ageingBook([], 'error', TODAY).withheld!),
  'an empty list under error says it is not a statement that nobody owes anything');

// Two currencies are two amounts of money and are never one.
{
  const mixed = [inv({ id: 'g', seq: 9, dueOn: '2026-08-01', currency: 'GBP', amountCents: 9000 }), rows[1]];
  const b = ageingBook(mixed, 'ready', TODAY);
  eq(b.outstanding!.pots.length, 2, 'two currencies stay two pots');
  ok(b.outstanding!.pots.every((p) => p.minorUnits !== 57000), 'and are never added into one figure');
}

// An amount with no currency on it is a hole in the total, counted rather than
// dropped, so a short figure is not read as the whole of what is owed.
{
  const b = ageingBook([inv({ id: 'h', seq: 10, dueOn: '2026-08-01', currency: null })], 'ready', TODAY);
  eq(b.outstanding!.unlabelled, 1, 'an unlabelled amount is counted');
  eq(b.outstanding!.pots.length, 0, 'and is in no pot');
}

/* ── 6. chasing ─────────────────────────────────────────────────────────── */

eq(chaseBlocker(inv({ clientId: 'c1' })), null, 'an outstanding invoice tied to an account may be chased');
ok(!!chaseBlocker(inv({ clientId: 'c1', kind: 'received' })), 'one the coach said was received may not');
ok(!!chaseBlocker(inv({ clientId: 'c1', voidedAt: '2026-08-02T00:00:00Z' })), 'nor a voided one');
// A coach bills people who have never installed this app. That is an ordinary
// invoice and not a failure — but there is nobody here to notify, and the
// screen has to say so rather than offering a control that does nothing.
ok(!!chaseBlocker(inv({ clientId: null })), 'and one not tied to an account has nobody to notify');

eq(chaseHistoryLine(inv({})), null, 'a never-chased invoice says nothing about chasing');
eq(chaseHistoryLine(inv({ reminderCount: 0 })), null, 'and neither does an explicit zero');
ok(/1 time/.test(chaseHistoryLine(inv({ reminderCount: 1, remindedAt: '2026-08-20T09:00:00Z' }))!),
  'one chase is singular');
ok(/4 times/.test(chaseHistoryLine(inv({ reminderCount: 4, remindedAt: '2026-08-20T09:00:00Z' }))!),
  'four is plural, so a coach can see they have already sent four');
ok(/20 Aug 2026/.test(chaseHistoryLine(inv({ reminderCount: 2, remindedAt: '2026-08-20T09:00:00Z' }))!),
  'and the last one is dated');

/* ── 7. the shortcut arithmetic ─────────────────────────────────────────── */

eq(plusDays('2026-09-01', 0), '2026-09-01', 'nought days on is the same day');
eq(plusDays('2026-09-01', 30), '2026-10-01', 'thirty days rolls the month');
eq(plusDays('2026-12-20', 30), '2027-01-19', 'and the year');
eq(plusDays('2028-02-27', 2), '2028-02-29', 'a leap day is a real day');
// Same DST argument as the day count above, from the other direction.
eq(plusDays('2026-03-25', 7), '2026-04-01', 'seven days across the spring change lands a week later');
eq(plusDays('2026-10-22', 7), '2026-10-29', 'and so does seven across the autumn one');
eq(plusDays('not a date', 7), '', 'a broken input produces nothing rather than a plausible wrong date');

/* ── 8. what may be issued ──────────────────────────────────────────────── */

const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  billTo: 'Dana Reyes',
  description: '8 sessions',
  amountText: '480',
  currency: 'AED',
  kind: 'requested',
  issuedOn: '2026-09-01',
  ...over,
});

eq(invoiceBlockers(draft()).length, 0, 'no due date is not a blocker — it is optional and it stays optional');
eq(invoiceBlockers(draft({ dueOn: '' })).length, 0, 'nor is an empty one');
eq(invoiceBlockers(draft({ dueOn: null })).length, 0, 'nor an explicit null');
eq(invoiceBlockers(draft({ dueOn: '2026-09-30' })).length, 0, 'a date after the issue date is allowed');
eq(invoiceBlockers(draft({ dueOn: '2026-09-01' })).length, 0, 'and so is the issue date itself');

// Refused, never corrected. A document that says it fell due before it was
// written is not one anybody can act on, and silently swapping the two dates
// would print terms the coach did not type.
ok(invoiceBlockers(draft({ dueOn: '2026-08-01' })).length > 0, 'a due date before the issue date is refused');
ok(invoiceBlockers(draft({ dueOn: '30 days' })).length > 0, 'and one that is not a date is refused rather than guessed at');

/* ── 9. the document ────────────────────────────────────────────────────── */

const issuer = { status: 'ready' as const, name: 'Sam Whitfield', brand: 'Ironhaus Strength' };

{
  const d = coachInvoiceDoc({ invoice: inv({ dueOn: '2026-09-15' }), issuer });
  // On the DOCUMENT, not only on the coach's list. A date the coach chases
  // against that the person being chased has never been shown is a term nobody
  // agreed to, and the first they would hear of it is the reminder.
  ok(d.html.includes('15 Sep 2026'), 'a stated due date is printed on the document');
  ok(d.text.includes('15 Sep 2026'), 'and in the text fallback, which some builds are all a client gets');
}

{
  const d = coachInvoiceDoc({ invoice: inv({ dueOn: null }), issuer });
  // Nothing at all, rather than "none" or a dash — either of those would read
  // as a term of its own.
  ok(!/\bDue\b/.test(d.text), 'an invoice with no due date prints no due line');
}

// Said on every document, with or without a date on it. A reader with one needs
// to know what it is; a reader without one is entitled to know that this app
// adds no interest and no late fee to anything.
for (const withDate of [null, '2026-09-15']) {
  const d = coachInvoiceDoc({ invoice: inv({ dueOn: withDate }), issuer });
  ok(d.html.includes('no interest or late fee'), `the no-interest sentence is on the document (due ${String(withDate)})`);
  ok(d.text.includes(INVOICE_DUE_NOT_A_TERM), `and verbatim in the text (due ${String(withDate)})`);
}

// The whole reason `kind` was never widened to a third value. Lateness is
// derived every time it is asked, from a date and a clock; nothing stores it,
// so nothing can be stale.
ok(!/overdue/i.test(coachInvoiceDoc({ invoice: inv({ dueOn: '2026-06-01' }), issuer }).text),
  'a document never calls itself overdue — this app is not told when anybody pays');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'INVOICE AGEING FAILURES:\n' + errors.join('\n') : 'ALL INVOICE AGEING TESTS PASSED');
if (errors.length) process.exit(1);
