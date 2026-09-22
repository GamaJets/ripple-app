// Telling the client that their coach has recorded an invoice as settled.
//
// ── What was missing, and what could not be built instead ─────────────────
//
// A coach taps "They paid it", part 660 writes `settled_on`, and the person who
// paid is told by nothing at all. The screen said so out loud — "Nobody has been
// told" — which is honest and is not a feature.
//
// The obvious fix is a screen: let the client open the invoice and see that it
// now says settled. That CANNOT be built, and the refusal is argued rather than
// incidental. `coach_invoices` grants SELECT to `authenticated` and part 138
// names and DROPS `coach_invoices_client_read` along with three other policies;
// its header says why — a client is HANDED the document by the coach, through
// the share sheet, which is the act that decides they should have it, and a read
// of the coach's ledger would also hand them the numbers of every other document
// in it. There is no client invoice screen and there is not meant to be.
//
// So this is a NOTIFICATION CARRYING THE FACT, not a screen showing the row. It
// needs no new permission: `notify_users()` (part 122) already lets a coach
// write an inbox row for their own client and re-checks that relationship on the
// server, and src/ui/coachInvoices.ts has been using it to announce an invoice
// at ISSUE since that function landed. This is the missing second half of a path
// that already exists — an announcement at issue and silence at settlement.
//
// ── Inbox only. No push, and no route ─────────────────────────────────────
//
// Both for the reasons the issue notification gives. A settlement is paperwork
// and not urgent, and the inbox row is the durable half anyway. A route would
// send the client looking for a screen that does not exist, so the copy says to
// ask the coach instead — and says it in the same words the issue notification
// does, because a client who is told twice to do two different things is told
// nothing.
//
// ── The hedge is the whole file ───────────────────────────────────────────
//
// A settlement is the COACH'S OWN STATEMENT that money arrived. Nothing checked
// it: `settled_on` is a date they typed, against a bank Repple has never seen,
// about a payment Repple was not part of. `INVOICE_SETTLEMENT_IS_YOUR_WORD` in
// src/lib/coachInvoice.ts is the sentence printed on the reprinted document and
// this copy says the same thing in the same voice.
//
// It matters more here than anywhere else in the product, because this
// notification is read in two seconds on a lock screen and it is ABOUT THE
// READER'S OWN MONEY. "Your payment has been confirmed" would be this app
// vouching for a receipt it has not seen, to the one person who would act on it
// — and a client who reads it as a receipt stops looking for the real one.
// Every sentence below therefore attributes the claim to the coach, and the
// last one tells them to ask for the document.
//
// Pure and tested. The write is in src/ui/invoiceSettled.ts.
import { clip, NOTICE_BODY_MAX, type Notification } from './notifyCopy';
import { invoiceDayLabel, invoiceNumber, money, type CoachInvoice } from './coachInvoice';

/**
 * Whether there is anybody to tell, and the reason when there is not.
 *
 * Null means the notice can go. A sentence means it cannot, and the sentence is
 * what the COACH reads after the settlement lands — never silence, because a
 * coach who assumes their client was told will not tell them themselves, which
 * is the exact failure this whole item is about.
 *
 * Deliberately NOT a copy of `settleBlocker`. That one decides whether a
 * settlement may be RECORDED and is checked before the write; this decides
 * whether the person it is about can be reached, and is asked after. Folding
 * them together would mean a coach could not settle an invoice for somebody who
 * has never installed this app — which is most of the people most coaches bill.
 */
export function settleNoticeBlocker(inv: CoachInvoice): string | null {
  // Nobody to tell, and that is an ordinary invoice rather than a failure. A
  // coach bills people with no account here; `bill_to` is a name they typed.
  if (!inv.clientId) {
    return 'This one is not tied to an account here, so there is nobody in the app to tell. If you want them to have a copy saying it was paid, send them the document again.';
  }
  // Nothing to announce. Reachable only through a caller that asked before the
  // settlement landed, and a notice saying an unsettled invoice was settled is
  // the worst possible thing to send to the person who owes the money.
  if (!inv.settledOn) {
    return 'Nothing is recorded as settled on this one yet, so there is nothing to tell them about.';
  }
  return null;
}

/**
 * The inbox row for an invoice the coach has just recorded as settled.
 *
 * Every clause is load-bearing, and four of them are the same four the issue
 * notification carries — on purpose, so the two rows in a client's inbox read as
 * two stages of one document rather than as two documents:
 *
 *   the number      so this matches the invoice they were already told about,
 *                   and so a second invoice settled the same week is a second
 *                   thing rather than the same row read twice.
 *   the amount      through money(), which returns NULL rather than a bare
 *                   figure when the currency is missing. Repple is
 *                   white-labelled and a number with no currency beside it is
 *                   not an amount of money; where it is null no figure is
 *                   printed and the row says why, rather than showing "0".
 *   the day         the day the COACH says the money arrived, spelled out. Not
 *                   the day they wrote it down: those differ by weeks when a
 *                   quarter of payments is written up in one evening, and the
 *                   client is checking this against their own bank.
 *   the hedge       'has recorded', 'their own record', never 'confirmed' and
 *                   never 'your payment has been received'. See the header.
 *   ask them        because the client cannot read `coach_invoices` at all, by
 *                   design. A line saying "open the app to see it" would send
 *                   them looking for a screen that is not there.
 *
 * No arithmetic and no balance. Nothing here says what is left owing, because
 * this app does not know: an invoice is one document and the coach's book is
 * not a running account the client has ever seen.
 */
export function invoiceSettledNotification(inv: CoachInvoice): Notification {
  const n = invoiceNumber(inv.seq);
  const amount = money(inv);
  const what = clip(inv.description || '', 120);
  // The figure and what it was for, or an explicit statement that the figure
  // could not be put in a currency. Never a bare number, and never a dash that
  // could be read as "nothing charged".
  const line = amount
    ? `Invoice ${n} for ${amount}${what ? ` (${what})` : ''}.`
    : `Invoice ${n}${what ? ` (${what})` : ''}. The amount could not be stated in a currency, so none is shown here.`;
  // `invoiceDayLabel` answers '—' for anything that is not a bare YYYY-MM-DD,
  // and a sentence reading "paid on —" is worse than one that does not name a
  // day at all. So the day is only claimed where there is one to claim.
  const day = invoiceDayLabel(inv.settledOn);
  const when = day === '—'
    ? 'Your coach has recorded this one as paid.'
    : `Your coach has recorded this one as paid on ${day}.`;
  return {
    title: 'Your coach recorded this invoice as paid',
    body: clip(
      `${line} ${when} That is their own record of it, written after the document was issued. `
      + 'It has not been checked against a bank or a card processor and it is not a payment receipt from one. '
      + 'Nothing on the document itself has changed. Ask them for a copy if you want one showing the settlement.',
      NOTICE_BODY_MAX,
    ),
  };
}

/**
 * What the coach is told about the notice, after the settlement has landed.
 *
 * Three states, and the screen must be able to say all three — this replaces a
 * flat "Nobody has been told", which was true and is now not.
 *
 * `true`  — an inbox row was written for them.
 * `false` — the attempt was made and wrote nothing. The client is not on this
 *           coach's roster any more, or `notify_users()` was refused, or it is
 *           not deployed. All three mean the same thing to the coach: send them
 *           the document yourself.
 * `null`  — nobody was addressed, because this invoice is not tied to an
 *           account. The commonest case, and not a failure.
 *
 * The settlement itself is recorded in every one of them. A notification that
 * did not go is not a settlement that did not happen, and wording that implied
 * otherwise would have a coach settling the same invoice twice — which part
 * 660's immutable guard refuses, leaving them with a document they believe is
 * unsettled and a server that says it is.
 */
export function settleNoticeLine(notified: boolean | null, billTo: string): string {
  // Two forms of the same fallback, because one of these sentences opens with
  // the name and the other carries it in the middle. A single 'They' would read
  // "They has been told", and a single 'Your client' would put a capital in the
  // middle of the other sentence — both of which look like the app is broken in
  // a message about somebody's money.
  const name = (billTo || '').trim();
  const lead = name || 'Your client';
  const mid = name || 'your client';
  if (notified === true) {
    return `${lead} has been told, in their inbox, that you have recorded this as paid. It says the amount, the day you gave, and that it is your own record rather than a receipt from a bank.`;
  }
  if (notified === false) {
    return `The settlement is recorded, but nothing reached ${mid}. They may no longer be on your roster here. Send them the document again if you want them to have a copy saying it was paid.`;
  }
  return `This one is not tied to an account here, so nobody has been told. Send them the document again if you want them to have a copy saying it was paid.`;
}
