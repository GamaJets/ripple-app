// An invoice read by the person it is addressed to, and the four ways that
// reading could be wrong.
//
// A member is told "An invoice from your gym" by a notification that states no
// amount and opens nothing. The screen that now answers it has to get four
// things right, and each of them is a sentence somebody would act on:
//
//   · a DRAFT is not a bill. The member can read it — the policy has no status
//     filter — and telling somebody they owe money their gym has not issued is
//     a demand this app made up.
//   · an invoice due TODAY is not late today.
//   · a due date is a bare 'YYYY-MM-DD' and is COMPARED, never parsed. Parsed as
//     a UTC instant it is the day before west of Greenwich, which turns a bill
//     due today into a bill that was late yesterday for every member in the
//     Americas. `npm run test:zones` runs this file in six zones for that.
//   · "you owe nothing" is said only under a read that landed whole.
//
// Compile with tsc, run with node.
import {
  invoiceStanding, invoiceStandingLabel, invoiceNote, isOwed, owedByCurrency,
  invoicesEmptyLine, owedEmptyLine, invoiceCopyText, type MemberInvoice,
} from './memberInvoices';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-13';
const inv = (over: Partial<MemberInvoice>): MemberInvoice => ({
  id: 'i1', number: 41, amountCents: 20000, currency: 'GBP',
  issuedOn: '2026-09-01', dueOn: '2026-09-30', status: 'open',
  membershipId: null, note: 'September membership',
  ...over,
});

/* ── a draft is not a bill ─────────────────────────────────────────────────── */
{
  const s = invoiceStanding(inv({ status: 'draft' }), TODAY);
  eq(s.kind, 'draft', 'a gym’s working copy is reported as one');
  ok(!isOwed(s), 'and is owed by nobody');
  ok(invoiceNote(s).includes('not being asked to pay'),
    'the member is told outright, because a draft they can read reads as a bill otherwise');
  const t = owedByCurrency([inv({ status: 'draft' })], TODAY, 'ready');
  eq(t?.pots.length, 0, 'and no draft reaches a figure headed with what they owe');
}

/* ── due today is not late today ───────────────────────────────────────────── */
{
  const s = invoiceStanding(inv({ dueOn: TODAY }), TODAY);
  eq(s.kind, 'due', 'a gym chasing somebody on the morning of the day it asked for the money has a complaint, not a policy');
  eq(s.kind === 'due' ? s.daysLeft : null, 0, 'with nought days left, which is a real answer');
}

/* ── late, and by how much ─────────────────────────────────────────────────── */
{
  const s = invoiceStanding(inv({ dueOn: '2026-09-01' }), TODAY);
  eq(s.kind, 'overdue', 'past the date the gym named');
  eq(s.kind === 'overdue' ? s.daysLate : null, 12, 'counted in whole days from the due date');
  eq(invoiceStandingLabel(s), 'Overdue', 'and labelled the way the desk labels it');
  ok(invoiceNote(s).includes('under Payments'),
    'with somewhere to go: what the gym recorded taking is the other half of this argument');
}

/* ── the date is compared as a string, in every timezone ───────────────────── */
{
  // This is the assertion `npm run test:zones` exists for. `new Date('2026-09-13')`
  // is UTC midnight, and in Los Angeles that reads back as the 12th — so an
  // invoice due today would be reported a day late to every member in the
  // Americas, by an app that had never been run there.
  eq(invoiceStanding(inv({ dueOn: '2026-09-13' }), '2026-09-13').kind, 'due',
    'due today is not overdue, wherever the phone is standing');
  eq(invoiceStanding(inv({ dueOn: '2026-09-14' }), '2026-09-13').kind, 'due', 'nor is due tomorrow');
  eq(invoiceStanding(inv({ dueOn: '2026-09-12' }), '2026-09-13').kind, 'overdue', 'yesterday is');
}

/* ── no due date is never late ─────────────────────────────────────────────── */
{
  const s = invoiceStanding(inv({ dueOn: null }), TODAY);
  eq(s.kind, 'due', 'a gym that did not say when it wanted the money cannot claim lateness');
  eq(s.kind === 'due' ? s.daysLeft : 'x', null, 'and there is no countdown to state');
  ok(isOwed(s), 'it is still owed — no date is not no bill');
  ok(invoiceNote(s).includes('has not recorded a date'), 'and the missing date is stated rather than filled in');
}

/* ── the gym’s own word, where it stored one ───────────────────────────────── */
{
  // A hand-written 'overdue' with no date on it is honoured: somebody wrote it
  // down, and this app disagreeing with a gym about the gym's own invoice is
  // not a disagreement the member can do anything with.
  const s = invoiceStanding(inv({ status: 'overdue', dueOn: null }), TODAY);
  eq(s.kind, 'overdue', 'a stored overdue with no date stands');
  ok(invoiceNote(s).includes('without recording what date'), 'and says what is missing from it');
  // But a date still decides, so an invoice paid late and moved back to 'open'
  // does not stay marked late forever.
  eq(invoiceStanding(inv({ status: 'overdue', dueOn: '2026-12-31' }), TODAY).kind, 'due',
    'a stored overdue whose date has not passed is not late');
}

/* ── settled, cancelled, written off: nothing owed on any of them ──────────── */
{
  for (const status of ['paid', 'void', 'written_off'] as const) {
    const s = invoiceStanding(inv({ status }), TODAY);
    ok(!isOwed(s), `${status} is not money still being asked for`);
  }
  eq(invoiceStandingLabel(invoiceStanding(inv({ status: 'void' }), TODAY)), 'Cancelled',
    'in the member’s words rather than the column’s');
  ok(invoiceNote(invoiceStanding(inv({ status: 'written_off' }), TODAY)).includes('not chasing'),
    'a write-off is the gym’s decision and the member is told what it means for them');
}

/* ── a status nothing in this app writes is named, never guessed ───────────── */
{
  const s = invoiceStanding(inv({ status: 'disputed' }), TODAY);
  eq(s.kind, 'unknown', 'an unrecognised status does not fall through to open');
  ok(!isOwed(s), 'and nothing is claimed about whether it is owed');
  ok(invoiceStandingLabel(s).includes('disputed'), 'the gym’s own word is quoted so the member can say it at the desk');
  eq(invoiceStandingLabel(invoiceStanding(inv({ status: null }), TODAY)), 'Not stated',
    'and a row with no status at all says that rather than inventing one');
}

/* ── what is owed, per currency, and only from a whole read ────────────────── */
{
  const rows = [
    inv({ id: 'a', amountCents: 20000, currency: 'GBP', dueOn: '2026-09-01' }),
    inv({ id: 'b', amountCents: 5000, currency: 'GBP', dueOn: '2026-09-30' }),
    inv({ id: 'c', amountCents: 90000, currency: 'AED', dueOn: '2026-09-30' }),
    inv({ id: 'd', amountCents: 70000, currency: 'GBP', status: 'paid' }),
  ];
  const t = owedByCurrency(rows, TODAY, 'ready');
  eq(t?.pots.length, 2, 'two currencies are two figures');
  eq(t?.pots.find((p) => p.currency === 'GBP')?.minorUnits, 25000,
    'the overdue one and the one still to come, and not the one already paid');
  ok(!t?.pots.some((p) => p.minorUnits === 115000), 'GBP and AED are never added together');

  eq(owedByCurrency(rows, TODAY, 'error'), null, 'a refused read states no figure at all');
  eq(owedByCurrency(rows, TODAY, 'partial'), null,
    'nor does a read that stopped at the row ceiling — a sum over part of a debt is not a smaller debt');
  eq(owedByCurrency(rows, TODAY, 'loading'), null, 'nor one still in flight');
  eq(owedByCurrency([], TODAY, 'ready')?.pots.length, 0, 'and a whole read of nothing really is nothing');
}

/* ── an amount nobody stated is a hole, not a nought ───────────────────────── */
{
  const t = owedByCurrency([inv({ amountCents: null }), inv({ id: 'z', currency: null })], TODAY, 'ready');
  eq(t?.unpriced, 1, 'an invoice with no amount is counted out of the figure');
  eq(t?.unlabelled, 1, 'and so is one with no currency — neither is added as zero');
}

/* ── the empty line never claims a gym has not billed somebody ─────────────── */
{
  ok(invoicesEmptyLine('error').includes('not because your gym has not invoiced you'),
    'the substitution this whole codebase keeps finding, refused here too');
  ok(invoicesEmptyLine('ready').includes('has not raised any invoices'), 'said as a fact only under a whole read');
  eq(invoicesEmptyLine('loading'), 'Still reading.', 'and nothing is claimed while it is in flight');
}

/* ── "nothing is outstanding" is a claim about DEBT, not about pots ────────── */
{
  // The live defect: an unpaid invoice whose amount nobody recorded produces no
  // pot, so the screen branched on `pots.length` and told a member who owes
  // money that everything was settled — directly above its own flag saying two
  // unpaid invoices were missing from the figure.
  const unpriced = [inv({ id: 'u1', amountCents: null }), inv({ id: 'u2', currency: null })];
  eq(owedByCurrency(unpriced, TODAY, 'ready')?.pots.length, 0,
    'neither can be added, which is right and is what made the sentence wrong');
  const line = owedEmptyLine(unpriced, TODAY, 'ready');
  ok(!/Nothing is outstanding/.test(line),
    'a member who owes their gym money is never told nothing is outstanding');
  ok(/no figure/.test(line), 'what is missing is the FIGURE, and the sentence says which');

  // A draft is not settled, cancelled or written off either.
  const drafted = [inv({ id: 'd1', status: 'paid' }), inv({ id: 'd2', status: 'draft' })];
  const dline = owedEmptyLine(drafted, TODAY, 'ready');
  ok(/Nothing is outstanding/.test(dline), 'nothing IS owed on a paid invoice and a working copy');
  ok(/working copy/.test(dline), 'and the working copy is named rather than called settled');

  // The sentence that was always right, kept.
  ok(owedEmptyLine([inv({ status: 'paid' })], TODAY, 'ready')
    === 'Nothing is outstanding. Every invoice your gym has raised against you is settled, cancelled or written off.',
    'a whole read with everything settled still earns the plain sentence');

  // And it may never be said about a read that did not land whole.
  eq(owedEmptyLine(unpriced, TODAY, 'error'), invoicesEmptyLine('error'),
    'a failed read keeps the failed-read sentence, whatever the rows on screen say');
  eq(owedEmptyLine(unpriced, TODAY, 'partial'), invoicesEmptyLine('partial'),
    'and so does a read that stopped at the ceiling');
  eq(owedEmptyLine([], TODAY, 'ready'), invoicesEmptyLine('ready'),
    'an empty whole read is the "your gym has not invoiced you" case and stays there');
}

/* ── the copy a member can take away keeps every rule the screen keeps ─────── */
{
  const mixed = [
    inv({ id: 'a', number: 41, amountCents: 20000, currency: 'GBP', dueOn: '2026-09-01' }),
    inv({ id: 'b', number: 42, amountCents: 90000, currency: 'AED', dueOn: '2026-09-30' }),
  ];
  const copy = invoiceCopyText(mixed, TODAY, 'ready');

  // Rule 1: every figure names its own currency, through `amount`.
  ok(copy.includes('GBP 200.00'), 'the pound invoice is written in pounds');
  ok(copy.includes('AED 900.00'), 'and the dirham one in dirhams');
  // Rule 2: and no third figure exists.
  ok(!/1,?100/.test(copy), 'GBP 200 and AED 900 are never added into a number in no currency');
  ok(copy.includes('different currencies'), 'and the copy says why there are two lines rather than one');

  // Rule 3: the date is the bare column value, unparsed and unlocalised — this
  // text travels to another device, and 09/01 is two days depending who opens it.
  ok(copy.includes('2026-09-01'), 'the due date is the ISO day the column holds');

  // Rule 4: a copy off a read that did not land whole says so ABOVE the rows. A
  // text file outlives the screen it was taken from and gets forwarded as a
  // statement, which is precisely where an unqualified prefix does its damage.
  const part = invoiceCopyText(mixed, TODAY, 'partial');
  ok(part.indexOf('not all of them') < part.indexOf('No. 41'),
    'the qualification arrives before the first figure, not in a footer');
  ok(!part.includes('across 2 unpaid invoices'),
    'and no outstanding total is stated over a prefix of somebody’s debt');
  const bad = invoiceCopyText(mixed, TODAY, 'error');
  ok(bad.includes('the read failed'), 'a copy taken over a failed read carries that fact with it');

  // Rule 5: an invoice with no amount is named and is in no figure.
  const holed = invoiceCopyText([inv({ id: 'h', amountCents: null })], TODAY, 'ready');
  ok(holed.includes('no amount'), 'the hole is stated rather than absorbed');
  ok(!/Nothing is outstanding/.test(holed), 'and the debt is not reported as settled');

  // And an empty list is still the read's own sentence, never a blank document.
  ok(invoiceCopyText([], TODAY, 'ready').includes('has not raised any invoices'),
    'a member with no invoices gets the sentence, not an empty page');
  ok(invoiceCopyText([], TODAY, 'error').includes('not because your gym has not invoiced you'),
    'and one whose read failed is never handed a copy claiming they were never billed');
}

if (errors.length) {
  console.error(`memberInvoices: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('memberInvoices ok');
