// Payment terms on an invoice. Compile with tsc, then run under plain node.
//
// The harmful versions of this all look reasonable:
//
//   · a term preselected for the coach — a deadline printed on a document under
//     somebody's name that they did not choose;
//   · 'In a month' computing thirty days, so the words the coach says and the
//     date the client reads are two different statements;
//   · "not due" printed over an invoice that states no due date at all;
//   · a date resolved by parsing a bare `YYYY-MM-DD`, which moves the day for
//     every coach west of Greenwich;
//   · a due date before the issue date reported as a negative term instead of
//     as the mistake it is.
import {
  PAYMENT_TERMS, paymentTerm, termDueOn, termOfDue, termDays, dueTermLine,
  TERM_STARTS_THE_CHASING, NO_TERM_IS_OFFERED,
} from './invoiceTerms';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

const ISSUED = '2026-09-13';

/* ── 1. the terms themselves ─────────────────────────────────────────────
   Named by their number of days, because that is the phrase the client will
   use back at the coach and the one an argument about an invoice is had in. */

{
  eq(PAYMENT_TERMS.length, 4, 'four terms on offer');
  ok(PAYMENT_TERMS.some((t) => t.days === 14 && t.name.includes('14')), 'fourteen days is offered and says fourteen');
  ok(PAYMENT_TERMS.some((t) => t.days === 30 && t.name.includes('30')), 'and thirty days says thirty');
  // The defect the backlog item names: the old chips said 'In a month' and
  // computed thirty days, so the words and the document disagreed.
  ok(!PAYMENT_TERMS.some((t) => /month/i.test(t.name) || /month/i.test(t.label)),
    'no term calls thirty days "a month", in full or in the short form');
  // The short form is what fits in a chip a quarter of a phone wide, and it
  // still carries the number — which is the part anybody is agreeing to.
  ok(PAYMENT_TERMS.every((t) => t.days === 0 || t.label.includes(String(t.days))),
    'every short label keeps its number');
  ok(PAYMENT_TERMS.every((t) => t.label.length <= t.name.length), 'and none of them is longer than the term in full');
  ok(PAYMENT_TERMS.some((t) => t.days === 0), 'payment on receipt is a term and not the absence of one');

  eq(paymentTerm('net14')?.days, 14, 'a term looks up by id');
  eq(paymentTerm('net45'), null, 'and an id this build does not know is null rather than a guess');
  eq(paymentTerm(null), null, 'as is nothing at all');
}

/* ── 2. resolving a term to a day ────────────────────────────────────── */

{
  eq(termDueOn('on_issue', ISSUED), '2026-09-13', 'payment on receipt is the issue day itself');
  eq(termDueOn('net7', ISSUED), '2026-09-20', 'seven days');
  eq(termDueOn('net14', ISSUED), '2026-09-27', 'fourteen days');
  eq(termDueOn('net30', ISSUED), '2026-10-13', 'thirty days, across the end of the month');

  // Across a year end and a leap day, because both are done with digits rather
  // than with a parsed date and both are where an off-by-one shows up.
  eq(termDueOn('net30', '2026-12-20'), '2027-01-19', 'and across a year end');
  eq(termDueOn('net30', '2028-02-01'), '2028-03-02', 'and over a leap February');

  eq(termDueOn('net14', 'not a day'), null, 'an unreadable issue date resolves to nothing');
  eq(termDueOn('net14', ''), null, 'and so does an empty one — never an empty string in a date box');
}

/* ── 3. reading a term back off a date ───────────────────────────────── */

{
  eq(termOfDue(ISSUED, '2026-09-27'), 'net14', 'a date fourteen days out IS the fourteen day term');
  eq(termOfDue(ISSUED, ISSUED), 'on_issue', 'and the issue day itself is payment on receipt');
  eq(termOfDue(ISSUED, '2026-10-12'), null, 'twenty-nine days is not a term');
  // Deliberately not the nearest one. "Nearly thirty days" is not a term and an
  // invoice is not nearly due.
  eq(termOfDue(ISSUED, '2026-10-14'), null, 'and neither is thirty-one');
  eq(termOfDue(ISSUED, null), null, 'no date is no term');
  eq(termOfDue(ISSUED, 'Friday'), null, 'and an unreadable one is not a term either');

  eq(termDays(ISSUED, '2026-09-27'), 14, 'the day count is what the sentence is built from');
  eq(termDays(ISSUED, '2026-09-10'), -3, 'a date before the issue day counts backwards rather than being swallowed');
  eq(termDays('', '2026-09-27'), null, 'and either end being unreadable is null');
}

/* ── 4. the sentence under the box ───────────────────────────────────── */

{
  // The empty state is the one that has to be right. "Not due" would report an
  // invoice that states no term as comfortably within one.
  const none = dueTermLine(ISSUED, null);
  ok(!/not due/i.test(none), 'no due date is never reported as "not due"');
  ok(none.includes('state none'), 'it says the document will state none');
  ok(none.includes('chasing'), 'and names the way such an invoice gets onto a list at all');
  eq(dueTermLine(ISSUED, '   '), none, 'whitespace in the box is the same as an empty one');

  // The day label comes from `invoiceDayLabel`, which is locale-formatted — so
  // this asserts the SHAPE of the sentence rather than one machine's spelling
  // of a September date. A test that pinned the spelling would pass here and
  // fail on a phone set to another locale, which is a fact about the test
  // runner and not about the code.
  const fortnight = dueTermLine(ISSUED, '2026-09-27');
  ok(fortnight.startsWith('Due in 14 days, on '), 'a term is said as a number of days');
  ok(fortnight.includes('2026') && fortnight.endsWith('.'), 'and as the day it lands on');
  ok(dueTermLine(ISSUED, '2026-09-14').includes('1 day,'), 'one day is singular');
  ok(dueTermLine(ISSUED, ISSUED).includes('payment on receipt'), 'the issue day is named as payment on receipt');

  const back = dueTermLine(ISSUED, '2026-09-10');
  ok(back.includes('BEFORE'), 'a date before the issue day is named as the mistake it is');
  ok(!back.includes('-3'), 'and never reported as a negative term');

  ok(dueTermLine(ISSUED, 'Friday').includes('could not be read'), 'an unreadable date says so rather than becoming a term');
}

/* ── 5. the sentences that keep the sheet honest ─────────────────────── */

{
  // `invoiceAge` chases against `due_on` wherever there is one and falls back
  // to `chase_from` only where there is not. The sheet says so, because the
  // alternative is a coach issuing with no term and then setting a chase date
  // on each invoice by hand a week later.
  ok(TERM_STARTS_THE_CHASING.includes('overdue'), 'the sheet says a term is what starts the chasing');
  ok(TERM_STARTS_THE_CHASING.includes('no due date at all'), 'and that a separate chase date is only for invoices without one');
  ok(NO_TERM_IS_OFFERED.includes('None of these is picked for you'), 'and that nothing is chosen on the coach’s behalf');
}

if (errors.length) {
  console.error(`invoiceTerms.test.ts — ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('invoiceTerms.test.ts — all assertions passed');
