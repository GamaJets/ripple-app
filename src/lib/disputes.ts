// A chargeback, and the date on it.
//
// ── Why this is not just another status to mirror ─────────────────────────
//
// app/(trainer)/payments.tsx tells a coach on a STANDARD account, out loud,
// that a dispute is theirs to answer. That was true and it was the whole of
// what this app did about one: it told a coach that answering a dispute was
// their job while giving them no way to know one existed. There was no
// `charge.dispute.*` handler in supabase/functions/stripe-webhook and no table
// for it to write to.
//
// Every other silence the notification sweeps have found costs something by
// degrees — a quiet client, a block that ran out, a certificate expiring. A
// chargeback costs everything, on a fixed day. Stripe gives the merchant a
// window to submit evidence and then decides on whatever arrived. Nothing is
// the commonest submission and it loses by default.
//
// So the DEADLINE is the content of this feature, and the rules below are all
// about it:
//
//   · the date is the first thing said, in the title of the notification and at
//     the top of the row on the screen;
//   · a MISSING date is its own sentence and never a dash and never today's
//     date — `evidence_due_by` is legitimately null on an inquiry and on a case
//     that is already closed, and a screen that filled that gap in would send a
//     coach running at nothing;
//   · how long is left is stated in days, from the DEVICE's clock, because that
//     is the clock the person reading it is living on.
//
// ── What is deliberately not here ─────────────────────────────────────────
//
// EVIDENCE. It is submitted in the coach's own Stripe dashboard — on a direct
// charge that is the only place it can be submitted from — and mirroring
// receipts and customer correspondence into this database would be putting a
// client's messages somewhere no policy was written for.
//
// A VERDICT ON WHETHER TO FIGHT IT. That is a judgement about a client, a
// business and a sum of money, and it is not one an app makes for somebody.
//
// A MODULE AN EDGE FUNCTION IMPORTS MUST BE A LEAF. No relative imports —
// supabase/functions/stripe-webhook builds its `client_disputes` row through
// `disputeRow` below so the screen and the server cannot disagree about what a
// dispute is. See the header of src/lib/gymOrderPayment.ts for the argument;
// the short version is that Deno resolves './foo' literally and throws on the
// function's first request.

/* ── what Stripe says, and what it means ──────────────────────────────────── */

/**
 * Stripe's own dispute statuses, as of the API version the webhook pins.
 *
 * Deliberately a union of literals PLUS `string`, so a value Stripe adds
 * tomorrow still types and still stores. The database column is unconstrained
 * for the same reason: a CHECK that refused an unknown status would make the
 * webhook answer Stripe with a 500, forever, on the one case a coach most needs
 * to see. Every function below treats an unrecognised word as "live and I
 * cannot say more", which is the safe direction.
 */
export type DisputeStatus =
  | 'warning_needs_response' | 'warning_under_review' | 'warning_closed'
  | 'needs_response' | 'under_review' | 'won' | 'lost'
  | (string & {});

/** The three statuses that mean the case is over. Anything else is live —
 *  including a word this build has never seen, which must not be assumed
 *  closed. */
const FINISHED: ReadonlySet<string> = new Set(['won', 'lost', 'warning_closed']);

/** Is this one finished? `closedAt` is Stripe's own answer where it gave one;
 *  the status is the fallback for a row written before the close arrived. */
export function isClosed(status: DisputeStatus, closedAt?: string | null): boolean {
  if (closedAt) return true;
  return FINISHED.has(String(status ?? ''));
}

/**
 * Whether the coach still has something to do about this one.
 *
 * 'needs_response' and 'warning_needs_response' are the two Stripe means it by.
 * `under_review` means evidence is in and Stripe is waiting on the bank, which
 * is a case to watch rather than a case to act on — and telling somebody to act
 * on it would have them submit a second time.
 */
export function needsResponse(status: DisputeStatus): boolean {
  const s = String(status ?? '');
  return s === 'needs_response' || s === 'warning_needs_response';
}

/**
 * How a status reads on a screen.
 *
 * An unknown word is rendered AS ITSELF rather than as "Other". Stripe's
 * vocabulary grows, and a status this build has not heard of is still
 * meaningful to a coach who is about to read it in their Stripe dashboard —
 * where it will say exactly the same word.
 */
export function disputeStatusLabel(status: DisputeStatus): string {
  switch (String(status ?? '')) {
    case 'needs_response': return 'Needs a response';
    case 'warning_needs_response': return 'Early warning — needs a response';
    case 'under_review': return 'With the bank';
    case 'warning_under_review': return 'Early warning — with the bank';
    case 'won': return 'Decided in your favour';
    case 'lost': return 'Decided against you';
    case 'warning_closed': return 'Early warning, closed';
    default: return String(status ?? '').trim() || 'Unknown';
  }
}

/**
 * Stripe's reason code, in words, or the raw code when it is one this build
 * does not know.
 *
 * The list is Stripe's and it grows. A code rendered as "Other" tells the coach
 * less than the code does, and the code is what their Stripe dashboard shows
 * them beside the same case.
 */
export function disputeReasonLabel(reason: string | null | undefined): string | null {
  const r = String(reason ?? '').trim();
  if (!r) return null;
  switch (r) {
    case 'fraudulent': return 'They say they did not authorise it';
    case 'duplicate': return 'They say they were charged twice';
    case 'subscription_canceled': return 'They say they had cancelled';
    case 'product_not_received': return 'They say they did not get what they paid for';
    case 'product_unacceptable': return 'They say what they got was not what was sold';
    case 'unrecognized': return 'They did not recognise the charge';
    case 'credit_not_processed': return 'They say a refund was never made';
    case 'general': return 'No reason was given';
    default: return r.replace(/_/g, ' ');
  }
}

/* ── the deadline, which is the whole point ───────────────────────────────── */

/** One dispute, reduced to what a deadline decision turns on. */
export interface DisputeDeadline {
  /** `client_disputes.evidence_due_by`. Null is a real state — see below. */
  evidenceDueBy: string | null;
  status: DisputeStatus;
  closedAt?: string | null;
}

/**
 * How many whole days from `now` until evidence stops being accepted.
 *
 * Null when there is no deadline, when it will not parse, or when the case is
 * closed. Negative when it has passed, which is deliberately NOT clamped to
 * zero: "the date was four days ago" and "the date is today" are different
 * things to tell somebody, and only one of them is still worth hurrying for.
 *
 * Rounded UP, so a deadline nineteen hours away is "1 day" rather than "0
 * days". Understating the time left would be the kinder error if it changed
 * nothing, and it does not: a coach told "0 days" on a case with most of a day
 * left may conclude it is already lost and do nothing.
 */
export function daysToRespond(d: DisputeDeadline, now: number = Date.now()): number | null {
  if (isClosed(d.status, d.closedAt)) return null;
  const t = d.evidenceDueBy ? Date.parse(d.evidenceDueBy) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(now)) return null;
  return Math.ceil((t - now) / 86_400_000);
}

/**
 * The one line a coach has to read, or null when the case is closed.
 *
 * `when` arrives ALREADY FORMATTED, from whichever date formatter the calling
 * screen uses, for the reason `refundConfirmLine` in src/lib/refunds.ts takes a
 * formatted amount: this module is imported by an edge function and must not
 * pull in the app's locale handling, and there is exactly one date formatter
 * per surface and it is not this file.
 *
 * A NULL deadline gets a sentence of its own and never a dash. Stripe states
 * none on an inquiry and on a case it has already decided, and the honest thing
 * to say is that the date is in their dashboard — not to print today, not to
 * print "—" beside an otherwise complete row, and not to hide the case.
 */
export function deadlineLine(d: DisputeDeadline, when: string | null, now: number = Date.now()): string | null {
  if (isClosed(d.status, d.closedAt)) return null;
  if (!when) {
    return 'Stripe has not stated a date for this one. Your Stripe dashboard has it, and it is the only place evidence can be submitted.';
  }
  // The raw gap rather than `daysToRespond`, for the two nearest cases only.
  // That function rounds UP by contract — nineteen hours left is "1 day", never
  // "0", because a coach told "0 days" concludes it is already lost — and the
  // cost of that rounding is that it cannot tell an hour from a day. Here it
  // matters: "due TOMORROW" said about a deadline ninety minutes away is the
  // one wrong sentence this feature must not produce.
  const t = d.evidenceDueBy ? Date.parse(d.evidenceDueBy) : NaN;
  const ms = Number.isFinite(t) && Number.isFinite(now) ? t - now : null;
  if (ms == null) {
    return `Evidence is due by ${when}. Your Stripe dashboard is where it goes.`;
  }
  if (ms <= 0) {
    const n = Math.max(1, Math.floor(-ms / 86_400_000));
    return `The date for evidence was ${when} — about ${n} day${n === 1 ? '' : 's'} ago. Stripe decides on what was submitted by then.`;
  }
  if (ms < 86_400_000) return `Evidence is due within the DAY, by ${when}. After that Stripe decides on what has been submitted.`;
  if (ms < 2 * 86_400_000) return `Evidence is due TOMORROW, ${when}. After that Stripe decides on what has been submitted.`;
  const days = Math.ceil(ms / 86_400_000);
  return `Evidence is due by ${when} — ${days} days from now. After that Stripe decides on what has been submitted.`;
}

/**
 * How loud the row should be: 'urgent' inside three days, 'warn' while it is
 * still open, and null once it is closed or there is nothing to do.
 *
 * Three days rather than a week because that is when a coach has to stop
 * planning to deal with it and deal with it. A row with no deadline at all is
 * 'warn' and never null: a case whose date this app does not know is not a case
 * that can be relaxed about.
 */
export function disputeTone(d: DisputeDeadline, now: number = Date.now()): 'urgent' | 'warn' | null {
  if (isClosed(d.status, d.closedAt)) return null;
  if (!needsResponse(d.status)) return 'warn';
  const days = daysToRespond(d, now);
  if (days == null) return 'warn';
  return days <= 3 ? 'urgent' : 'warn';
}

/** What a lost dispute actually costs, said once beside the list. Every clause
 *  is something a coach would otherwise assume and be wrong about. */
export const DISPUTE_MONEY_IS_ALREADY_GONE =
  'The money on a disputed charge is taken back the moment the dispute opens, not when it is decided. If it goes your way it comes back; if it does not, it stays with the client, and on your own charges Stripe’s dispute fee comes out of your balance as well.';

/** Where the work actually happens, said so nobody waits for a button here that
 *  is never coming. */
export const EVIDENCE_GOES_TO_STRIPE =
  'Evidence is submitted in your own Stripe dashboard. This app is told that a case exists and when it closes; it is never told what you sent, and it cannot send anything for you.';

/** And what to send, because "submit evidence" is not an instruction anybody
 *  can act on at nine in the evening. */
export const WHAT_EVIDENCE_LOOKS_LIKE =
  'Send something even if it feels thin — an empty response loses by default. What you have is usually enough: the sessions you delivered and when, your messages with them, and anything they signed.';

/* ── the row the webhook writes ───────────────────────────────────────────── */

/** A Stripe dispute, narrowed to what this app records. Shaped as plain values
 *  rather than as `Stripe.Dispute` so this file stays a leaf and so the test
 *  can build one without the Stripe types. */
export interface StripeDisputeLike {
  id: string;
  charge: string | null;
  paymentIntent: string | null;
  amount: number | null;
  currency: string | null;
  reason: string | null;
  status: string | null;
  /** `evidence_details.due_by`, in Stripe's unix seconds. */
  evidenceDueBy: number | null;
  /** `created`, in Stripe's unix seconds. */
  created: number | null;
}

/** Who and what this dispute is against, as far as the webhook could resolve
 *  it. Every field is legitimately null: a dispute can arrive against a payment
 *  this app never recorded, which is precisely the case that matters most. */
export interface DisputeAttribution {
  trainerId: string | null;
  clientId: string | null;
  purchaseId: string | null;
  renewalId: string | null;
  stripeAccountId: string | null;
}

/** The row, exactly as `client_disputes` takes it. */
export interface DisputeRow {
  stripe_dispute_id: string;
  stripe_charge_id: string | null;
  stripe_payment_intent: string | null;
  stripe_account_id: string | null;
  trainer_id: string | null;
  client_id: string | null;
  purchase_id: string | null;
  renewal_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  reason: string | null;
  status: string;
  evidence_due_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  stripe_event_at: string;
  updated_at: string;
}

/** A unix-seconds timestamp as an ISO instant, or null. Stripe sends seconds
 *  and JavaScript wants milliseconds; a factor of a thousand on a deadline puts
 *  it in 1970. */
const atSeconds = (s: number | null | undefined): string | null => {
  if (s == null || !Number.isFinite(s) || s <= 0) return null;
  const d = new Date(s * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/**
 * The `client_disputes` row for one Stripe dispute, or null when there is not
 * enough to write.
 *
 * Null for exactly one reason — no dispute id, which is the primary key and the
 * only thing that makes a redelivery land on the row the first delivery wrote.
 * Everything else is nullable on the table on purpose: a dispute against a
 * payment this database has no record of is still a dispute, and refusing to
 * store it would lose exactly the case the coach has least other warning about.
 *
 * `eventAt` is the event's own timestamp rather than now(), because webhooks
 * are not ordered and the caller filters on it: an `updated` from 10:00:00
 * delivered after the `closed` from 10:00:01 must not reopen a case the coach
 * has already been told the result of.
 */
export function disputeRow(
  d: StripeDisputeLike,
  who: DisputeAttribution,
  eventAt: string,
): DisputeRow | null {
  const id = String(d.id ?? '').trim();
  if (!id) return null;
  const status = String(d.status ?? '').trim() || 'unknown';
  const closed = FINISHED.has(status);
  const now = new Date().toISOString();
  return {
    stripe_dispute_id: id,
    stripe_charge_id: String(d.charge ?? '').trim() || null,
    stripe_payment_intent: String(d.paymentIntent ?? '').trim() || null,
    stripe_account_id: String(who.stripeAccountId ?? '').trim() || null,
    trainer_id: who.trainerId ?? null,
    client_id: who.clientId ?? null,
    purchase_id: who.purchaseId ?? null,
    renewal_id: who.renewalId ?? null,
    // Gross, in minor units, as Stripe states it. Null stays null: an amount
    // with no unit joins no total, and there is no default currency anywhere in
    // this product.
    amount_cents: typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : null,
    currency: String(d.currency ?? '').trim() || null,
    reason: String(d.reason ?? '').trim() || null,
    status,
    evidence_due_by: atSeconds(d.evidenceDueBy),
    opened_at: atSeconds(d.created),
    // Stamped only when Stripe's own status says the case is over. A `closed_at`
    // written on a live case would silence the trigger that tells the coach the
    // result, because that trigger fires on the transition into it.
    closed_at: closed ? eventAt : null,
    stripe_event_at: eventAt,
    updated_at: now,
  };
}
