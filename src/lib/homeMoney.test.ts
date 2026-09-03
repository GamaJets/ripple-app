// What the coach's home screen may say about the money they are owed.
// Compile with tsc, run with node.
//
// Four ways to be wrong here and every one of them renders as a calm, plausible
// card:
//
//   · NO CARD over a failed read reads as "nobody owes you anything" — the same
//     pixels as a clear book, on the screen a coach glances at for four seconds.
//   · NO CARD over a truncated read is the same failure with a shorter list
//     behind it: the rows that arrived are real overdue invoices.
//   · A FIGURE that includes what is not yet due, printed beside a count that
//     does not, is the number a coach chases on.
//   · A COUNT that folds the coach's own chase dates in with dates the client
//     was actually shown is a claim about a date nobody ever sent them, made
//     under the coach's name.
//
// The currency rules are asserted rather than eyeballed for the reason
// src/lib/coachMoney.ts gives: two amounts in different currencies are not one
// amount, and an amount with no currency on it is a hole in a total rather than
// a small number.
import {
  homeMoney, homeMoneyDrawn, homeMoneyTitle, homeMoneyNote,
} from './homeMoney';
import { ageingBook, type CoachInvoice } from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-03';

let seq = 0;
function inv(p: Partial<CoachInvoice> = {}): CoachInvoice {
  seq += 1;
  return {
    id: `inv-${seq}`, seq, billTo: 'Priya Nair', description: 'Block of 10',
    amountCents: 12000, currency: 'GBP', kind: 'requested',
    issuedOn: '2026-07-01', dueOn: '2026-08-01',
    settledOn: null, voidedAt: null,
    ...p,
  } as CoachInvoice;
}

const book = (rows: CoachInvoice[], today = TODAY) => ageingBook(rows, 'ready', today);

/* ── 1. the card is drawn when there is something to do, and when the read
       could not say whether there was ────────────────────────────────────*/

{
  const clear = homeMoney(book([inv({ dueOn: '2026-12-01' })]), 'ready');
  eq(homeMoneyDrawn(clear), false,
    'a coach owed nothing late is shown no panel telling them so every morning');

  const late = homeMoney(book([inv({ dueOn: '2026-08-01' })]), 'ready');
  eq(homeMoneyDrawn(late), true, 'and one that is late draws the card');
}

{
  // The dangerous one. `fetchMyInvoices` returning nothing under 'error' is not
  // a clear book, and an absent card says it is.
  const failed = homeMoney(ageingBook([], 'error', TODAY), 'error');
  eq(homeMoneyDrawn(failed), true, 'a read that did not answer still draws a card');
  eq(failed.overdue, null, 'with no count on it');
  eq(failed.pots, null, 'and no figure');
  eq(homeMoneyTitle(failed), 'Could not check what you are owed', 'that names the failure');
  ok(homeMoneyNote(failed).includes('not the same as nobody owing you anything'),
    'and says the one thing a coach would otherwise assume');
}

{
  // A truncated read: the rows are real, the count is not the coach's book.
  const rows = [inv({ dueOn: '2026-08-01' }), inv({ dueOn: '2026-07-01' })];
  const short = homeMoney(ageingBook(rows, 'partial', TODAY), 'partial');
  eq(homeMoneyDrawn(short), true,
    'a book that came back short still draws over the overdue invoices that arrived');
  eq(short.hasOverdue, true, 'because the rows themselves are real');
  eq(short.overdue, null, 'but the number over them is a subtotal and is not stated');
  eq(short.pots, null, 'and neither is the money');
  eq(homeMoneyTitle(short), 'Some invoices are overdue', 'the heading loses its figure rather than printing one');
  ok(homeMoneyNote(short).includes('not all of it'), 'and the note carries the reason');
}

/* ── 2. the figure is about the same invoices as the count beside it ──────*/

{
  // `AgeingBook.outstanding` sums overdue AND upcoming. This must not.
  const m = homeMoney(book([
    inv({ dueOn: '2026-08-01', amountCents: 10000, currency: 'GBP' }),
    inv({ dueOn: '2026-12-01', amountCents: 99000, currency: 'GBP' }),
  ]), 'ready');
  eq(m.overdue, 1, 'one of the two is late');
  eq(m.pots?.length, 1, 'and there is one currency to state');
  eq(m.pots?.[0]?.minorUnits, 10000,
    'the figure is the late invoice alone — next month’s is not money anybody is behind on');
  eq(m.pots?.[0]?.count, 1, 'and it counts the same one invoice the heading does');
}

/* ── 3. currency, and the two holes in any total ──────────────────────────*/

{
  const m = homeMoney(book([
    inv({ dueOn: '2026-08-01', amountCents: 10000, currency: 'GBP' }),
    inv({ dueOn: '2026-08-01', amountCents: 4000, currency: 'EUR' }),
  ]), 'ready');
  eq(m.pots?.length, 2, 'two currencies are two lines');
  ok(!m.pots?.some((p) => p.minorUnits === 14000),
    'and never one — pounds and euros do not add up to anything');
}

{
  const m = homeMoney(book([
    inv({ dueOn: '2026-08-01', amountCents: 10000, currency: 'GBP' }),
    inv({ dueOn: '2026-08-01', amountCents: 5000, currency: null }),
    inv({ dueOn: '2026-08-01', amountCents: null, currency: 'GBP' }),
  ]), 'ready');
  eq(m.overdue, 3, 'all three are late');
  eq(m.pots?.[0]?.minorUnits, 10000, 'and only one of them is in the figure');
  eq(m.unlabelled, 1, 'the amount with no currency on it is counted');
  eq(m.unpriced, 1, 'so is the one with no amount at all');
  const note = homeMoneyNote(m);
  ok(note.includes('no currency'), 'and both are said, because a short total that looks whole is worse than none');
  ok(note.includes('no amount recorded'), 'the second one too — they are different holes');
}

/* ── 4. the coach's own chase date is not a date the client was shown ─────*/

{
  const m = homeMoney(book([
    inv({ dueOn: '2026-08-01' }),
    inv({ dueOn: undefined, chaseFrom: '2026-08-10' } as Partial<CoachInvoice>),
  ]), 'ready');
  eq(m.overdue, 2, 'both are being chased, and a coach chasing on their own note is still chasing');
  eq(m.pastStated, 1, 'but only one is past a date the client was ever shown');
  ok(homeMoneyNote(m).includes('chase date you set for yourself'),
    'and the card says so — a demand written on the other basis names a date nobody sent');
  const n = homeMoneyNote(m);
  ok(n.indexOf('chase date you set for yourself') < n.indexOf('The oldest is'),
    'said FIRST, before any detail, because it changes what the number in the heading means');
}

{
  const allOwn = homeMoney(book([
    inv({ dueOn: undefined, chaseFrom: '2026-08-10' } as Partial<CoachInvoice>),
  ]), 'ready');
  eq(allOwn.pastStated, 0, 'none of these was ever given a date');
  ok(homeMoneyNote(allOwn).startsWith('It is past a chase date you set for yourself'),
    'and with nothing on a stated date the sentence says so outright rather than as a fraction');
}

{
  const plain = homeMoney(book([inv({ dueOn: '2026-08-01' })]), 'ready');
  ok(!homeMoneyNote(plain).includes('chase date'),
    'and where every one is past a date the client was shown, no such clause is added');
}

/* ── 5. the oldest, and the singulars ─────────────────────────────────────*/

{
  const m = homeMoney(book([
    inv({ dueOn: '2026-09-02' }),
    inv({ dueOn: '2026-06-01' }),
  ]), 'ready');
  eq(m.worstDays, 94, 'the worst is the head of a list ageingBook already sorted longest-first');
  ok(homeMoneyNote(m).includes('The oldest is 94 days past.'), 'and it is said in the note');
}

{
  eq(homeMoneyTitle(homeMoney(book([inv({ dueOn: '2026-08-01' })]), 'ready')),
    '1 invoice is overdue', 'one invoice is singular');
  eq(homeMoneyTitle(homeMoney(book([inv({ dueOn: '2026-08-01' }), inv({ dueOn: '2026-08-01' })]), 'ready')),
    '2 invoices are overdue', 'and two are plural');
  const oneDay = homeMoney(book([inv({ dueOn: '2026-09-02' })]), 'ready');
  ok(homeMoneyNote(oneDay).includes('a day past'), 'a single day is not "1 days past"');
}

/* ── 6. an undated invoice is a hole, not an alarm ────────────────────────*/

{
  // On its own it draws nothing: a coach who never types due dates would
  // otherwise carry a permanent card about it, and a card carried permanently
  // is one nobody reads on the day it matters.
  const only = homeMoney(book([inv({ dueOn: undefined } as Partial<CoachInvoice>)]), 'ready');
  eq(only.undated, 1, 'the invoice with no due date is counted');
  eq(homeMoneyDrawn(only), false, 'and does not raise a card by itself');
}

{
  // Beside something that IS late, it has to be said — otherwise the figure
  // above reads as everything outstanding.
  const both = homeMoney(book([
    inv({ dueOn: '2026-08-01' }),
    inv({ dueOn: undefined } as Partial<CoachInvoice>),
  ]), 'ready');
  eq(homeMoneyDrawn(both), true, 'the late one draws the card');
  ok(homeMoneyNote(both).includes('on no list of what is late'),
    'and the undated one is named, so no figure here reads as complete');
}

/* ── 7. nothing at all is still a sentence, not a blank ───────────────────*/

{
  const clean = homeMoney(book([inv({ dueOn: '2026-08-01' })]), 'ready');
  eq(homeMoneyNote(clean), 'The oldest is 33 days past.',
    'a card with nothing to caveat carries the one fact a coach acts on');
  // And where the age cannot be stated the line does not go missing: a heading
  // with nothing under it reads as a card that failed to finish drawing.
  const short = homeMoney(ageingBook([inv({ dueOn: '2026-08-01' })], 'partial', TODAY), 'partial');
  ok(homeMoneyNote(short).startsWith('Money you have already earned and not been paid.'),
    'and says what the card is about instead');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'HOME MONEY FAILURES:\n' + errors.join('\n') : 'homeMoney: ok — no figure over half a book, no total across currencies, and no empty card standing in for a clear one');
if (errors.length) process.exit(1);
