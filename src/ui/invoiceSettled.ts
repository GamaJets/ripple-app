// Writing the client the inbox row that says their coach recorded an invoice as
// paid. The wording is in src/lib/invoiceSettled.ts, pure and tested; this half
// touches supabase and so is deliberately not.
//
// ── No new permission, and that is the point ──────────────────────────────
//
// Nothing here needed SQL. `notify_users()` (part 122) is SECURITY DEFINER,
// granted to `authenticated`, and its `allowed` CTE already permits a coach to
// write into the inbox of a client on their own roster —
// `exists (select 1 from clients c where c.id = w.uid and c.trainer_id = v_me)`.
// It re-checks that on the server, so a stale or guessed id cannot address a
// stranger's inbox from here.
//
// The permission that does NOT exist, and is not being added, is a client read
// of `coach_invoices`: part 138 names and DROPS `coach_invoices_client_read`
// and argues the case in its header. That is why this is a notification
// carrying the fact rather than a screen showing the row — see the header of
// src/lib/invoiceSettled.ts.
//
// ── The count is the only honest answer ───────────────────────────────────
//
// `recordInbox` returns what `notify_users()` said it WROTE. An undeployed
// function, a refusal, and a client who has left this coach's roster all come
// back as zero, and all three mean the same thing to the coach: nobody was
// told. Reading the absence of an error as success here would produce the exact
// state this feature exists to end — a coach believing their client knows.
import { recordInbox } from './pushNotifications';
import { reportError } from '../lib/reportError';
import { invoiceSettledNotification, settleNoticeBlocker } from '../lib/invoiceSettled';
import type { CoachInvoice } from '../lib/coachInvoice';

/**
 * Tell the client, and say which of the three things happened.
 *
 * `true`  — an inbox row was written.
 * `false` — the attempt was made and wrote nothing.
 * `null`  — nobody was addressed, because there is nobody to address.
 *
 * Takes the invoice AS THE SERVER RETURNED IT after the settlement, never the
 * one the screen was holding beforehand: `settled_on` is what the body quotes,
 * and quoting the day the coach typed rather than the day the database stored
 * would let a refused or adjusted write reach the client as a fact. `settle_coach_invoice`
 * returns the row, so the caller always has it.
 *
 * Never throws. A settlement that landed is not undone by a notification that
 * did not, and the caller reports both halves separately.
 */
export async function tellClientSettled(invoice: CoachInvoice): Promise<boolean | null> {
  // Nobody to tell. An ordinary invoice to somebody who has never installed
  // this app, not a failure, and the screen words it as one — see
  // `settleNoticeLine`.
  if (!invoice.clientId) return null;
  // Somebody to tell and nothing yet to tell them: a row that came back without
  // `settled_on` on it. Reachable only through a caller that asked before the
  // write landed, and false rather than null because the coach has to be sent
  // to the share sheet — a notice saying an unsettled invoice was settled is
  // the worst thing that could reach the person who owes the money.
  if (settleNoticeBlocker(invoice)) return false;
  const note = invoiceSettledNotification(invoice);
  try {
    // One recipient, so `atCap` cannot be true here and is not read. The count
    // is still the only honest answer to whether this landed.
    const { recorded } = await recordInbox([invoice.clientId], note.title, note.body);
    return recorded > 0;
  } catch (e) {
    reportError('invoiceSettled.notify', e);
    return false;
  }
}
