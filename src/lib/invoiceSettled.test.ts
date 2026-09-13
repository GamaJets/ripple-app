// What a client is told when their coach records an invoice as paid. Compile
// with tsc, run under node.
//
// This notification is read in two seconds, on a lock screen, and it is about
// the reader's OWN money. Every failure aimed at here is a way of accidentally
// upgrading the coach's unverified claim into a receipt:
//
//   · "your payment has been confirmed" — this app has seen no bank and no card
//     processor, and a client who reads it as a receipt stops looking for one;
//   · a bare number with no currency, which is not an amount of money in a
//     white-labelled product, or a zero standing where a currency is missing;
//   · the day the coach WROTE IT DOWN in place of the day they say the money
//     arrived — weeks apart when a quarter is written up in one evening, and the
//     client is checking this against their own statement;
//   · "open the app to see it", which sends them to a screen that does not exist
//     because part 138 drops the client read policy on `coach_invoices`;
//   · a body longer than `notify_users()` will store, cut mid-word by a `left()`
//     with no ellipsis;
//   · silence towards the COACH when nothing was sent, which leaves them
//     believing the client was told.
import {
  invoiceSettledNotification, settleNoticeBlocker, settleNoticeLine,
} from './invoiceSettled';
import { NOTICE_BODY_MAX } from './notifyCopy';
import { invoiceNumber, type CoachInvoice } from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const has = (s: string, sub: string, msg: string) => ok(s.includes(sub), `${msg} — "${sub}" is not in ${JSON.stringify(s)}`);
const hasnt = (s: string, sub: string, msg: string) => ok(!s.toLowerCase().includes(sub.toLowerCase()), `${msg} — "${sub}" IS in ${JSON.stringify(s)}`);

const base: CoachInvoice = {
  id: 'i1',
  seq: 7,
  billTo: 'Dana Okoro',
  description: 'Ten sessions, autumn block',
  amountCents: 45000,
  currency: 'GBP',
  kind: 'requested',
  issuedOn: '2026-03-04',
  dueOn: '2026-03-18',
  settledOn: '2026-03-16',
  settledAt: '2026-04-02T19:40:00.000Z',
  settleNote: 'Bank transfer',
  voidedAt: null,
  voidReason: null,
  clientId: 'c1',
};

/* ── 1. it says the four things that identify the document ───────────────── */

{
  const n = invoiceSettledNotification(base);
  has(n.body, invoiceNumber(7), 'the number is in it, so it matches the invoice they were already told about');
  has(n.body, 'GBP 450.00', 'the amount is in it, with its currency, never as a bare figure');
  has(n.body, 'Ten sessions, autumn block', 'and what it was for');
  ok(n.title.length > 0 && n.title.length <= 120, 'the title fits what notify_users() stores');
}

/* ── 2. THE ONE THAT MATTERS: it is the coach’s word, not a receipt ──────── */

{
  const n = invoiceSettledNotification(base);
  has(n.body, 'their own record', 'the claim is attributed to the coach');
  has(n.body, 'not a payment receipt', 'and is said outright not to be a receipt');
  has(n.body, 'has not been checked', 'and says nothing checked it');

  // The phrases that would turn an unverified claim into a confirmation.
  for (const banned of [
    'confirmed', 'we have received', 'your payment has been received',
    'receipt for', 'verified', 'cleared',
  ]) {
    hasnt(n.body, banned, 'nothing in the body vouches for the payment');
    hasnt(n.title, banned, 'nor does the title');
  }

  // And it does not send them to a screen that cannot exist: part 138 names and
  // drops `coach_invoices_client_read`, so there is nothing for a client to open.
  hasnt(n.body, 'open the app', 'it does not send them to a screen that does not exist');
  hasnt(n.body, 'tap to view', 'nor imply a copy is waiting in the app');
  has(n.body, 'Ask them', 'it tells them to ask the coach, which is the only real route');
}

/* ── 3. the day is the one the coach says the money arrived ──────────────── */

{
  const n = invoiceSettledNotification(base);
  has(n.body, '2026', 'the settled day is spelled out and carries its year');
  // `settledAt` is 2 April; `settledOn` is 16 March. A client checking their own
  // bank statement is looking for the day the money moved, not the evening the
  // coach did their books.
  hasnt(n.body, 'April', 'the day the coach wrote it down is not the day it claims');

  // A settled day that is not a bare YYYY-MM-DD would render as a dash through
  // `invoiceDayLabel`, and "paid on —" is worse than not naming a day.
  const vague = invoiceSettledNotification({ ...base, settledOn: 'sometime' });
  hasnt(vague.body, 'paid on —', 'an unreadable day is never printed as a dash in a sentence');
  has(vague.body, 'recorded this one as paid', 'and the claim is still made, without a day');
}

/* ── 4. a hole is not a nought ───────────────────────────────────────────── */

{
  const noCcy = invoiceSettledNotification({ ...base, currency: null });
  has(noCcy.body, 'could not be stated in a currency', 'a missing currency is said out loud');
  ok(!/\b0\.00\b/.test(noCcy.body), 'and never rendered as nothing charged');
  hasnt(noCcy.body, '450', 'nor as a bare number with no currency beside it');

  const noAmount = invoiceSettledNotification({ ...base, amountCents: null });
  has(noAmount.body, 'could not be stated in a currency', 'an invoice with no amount states no figure either');
}

/* ── 5. it fits the row it is stored in ──────────────────────────────────── */

{
  const wordy = invoiceSettledNotification({ ...base, description: 'session '.repeat(200).trim() });
  ok(wordy.body.length <= NOTICE_BODY_MAX,
    `a long description cannot push the body past what notify_users() stores — got ${wordy.body.length}`);
  // `clip` ends in an ellipsis when it cut, so the reader can tell the row was
  // cut rather than the sentence being written badly.
  ok(wordy.body.includes('…'), 'and a cut body says it was cut');
}

/* ── 6. who can be told, and who cannot ──────────────────────────────────── */

{
  eq(settleNoticeBlocker(base), null, 'a settled invoice tied to an account can be announced');

  const noAccount = settleNoticeBlocker({ ...base, clientId: null });
  ok(!!noAccount, 'an invoice billed to somebody with no account cannot be');
  has(String(noAccount), 'send them the document again', 'and the refusal names the way out');

  const unsettled = settleNoticeBlocker({ ...base, settledOn: null });
  ok(!!unsettled, 'and nothing is announced about an invoice that is not settled');

  // Deliberately NOT a copy of settleBlocker: a voided-or-not, received-or-not
  // question is about whether a settlement may be RECORDED. This one is only
  // about whether the person it is about can be reached.
  eq(settleNoticeBlocker({ ...base, kind: 'received' }), null,
    'the reachability question does not re-litigate whether the settlement was allowed');
}

/* ── 7. the coach is told which of the three happened ────────────────────── */

{
  const sent = settleNoticeLine(true, 'Dana Okoro');
  has(sent, 'Dana Okoro', 'a landed notice names who got it');
  has(sent, 'your own record', 'and says what it told them');

  const failed = settleNoticeLine(false, 'Dana Okoro');
  has(failed, 'The settlement is recorded', 'a failed notice never reads as a failed settlement');
  has(failed, 'nothing reached', 'and says plainly that nobody was told');
  has(failed, 'Send them the document again', 'and names what to do instead');

  const nobody = settleNoticeLine(null, 'Dana Okoro');
  has(nobody, 'not tied to an account', 'and the ordinary case is explained rather than reported as an error');
  hasnt(nobody, 'failed', 'a client with no account is not a failure');

  // A blank name must not produce a sentence starting with a space or reading
  // "  has been told".
  ok(!/^\s/.test(settleNoticeLine(true, '   ')), 'a blank name does not open the sentence with a space');
  has(settleNoticeLine(true, '   '), 'Your client has been told', 'it falls back to a phrase that reads as English');
  has(settleNoticeLine(false, '   '), 'nothing reached your client', 'and the mid-sentence form is not capitalised');
}

if (errors.length) {
  console.error(`invoiceSettled: ${errors.length} failure(s)`);
  for (const e of errors) console.error(' · ' + e);
  process.exit(1);
}
console.log('invoiceSettled: all assertions passed');
