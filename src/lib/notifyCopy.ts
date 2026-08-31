// What a notification about a NOTICE or an INVOICE is allowed to say.
//
// Three producers reached no inbox at all — a coach's notice, a gym's notice,
// and every invoice this product issues — and each of them is a case where the
// wording matters more than the plumbing. So the wording is here, pure and
// tested, rather than inline in three screens where it would be reworded on one
// of them and left alone on the other two.
//
// ── An announcement is somebody else's words, and stays them ───────────────
//
// The body of a notice notification is the AUTHOR'S OWN TEXT, verbatim, and
// nothing in this file writes a sentence in their voice. That rule is the same
// one src/lib/nudge.ts and supabase/parts/140 spend their headers on: this app
// composes nothing under a person's name. `messages.sender` once came from the
// caller's own request, so a client could post into their thread as 'coach' and
// their phone rendered it as words from their coach. What this file adds is a
// HEADING that says who the words came from — "A notice from your coach" — and
// the heading is the app speaking, in the app's own voice, about a row that RLS
// has already tied to that author (announcements.author_id = coach_id =
// auth.uid(), part 109). It never puts a sentence in the author's mouth.
//
// ── An invoice notification must not claim more than the invoice ───────────
//
// supabase/parts/138 is deliberate about what a coach invoice IS: a document
// the coach made, from figures they typed, with no tax calculated and NO CLAIM
// THAT MONEY MOVED — `kind` is the coach's own statement and Repple does not
// check it. A notification is read in two seconds on a lock screen, so it is
// the easiest place in the product to accidentally upgrade "your coach says you
// paid" into "you paid". The copy below therefore hedges in exactly the words
// the document itself uses (`kindLine`, INVOICE_NOT_A_RECEIPT), and says out
// loud that the client has to ask the coach for the document — because the
// client cannot read `coach_invoices` at all, by design, and a notification
// that implied a copy was waiting in the app would be sending them to look for
// something that is not there.
import { num } from './format';
import { invoiceNumber, money, type CoachInvoice } from './coachInvoice';

/* ── the caps the database will apply anyway ──────────────────────────────── */

/** `notify_users()` stores `left(v_title, 120)`. Applied here so a long gym
 *  name is cut by something that can add an ellipsis, rather than by a `left()`
 *  that stops mid-word and looks like a bug. */
export const NOTICE_TITLE_MAX = 120;

/** `notify_users()` stores `left(v_body, 500)` while `announcements.body`
 *  accepts 2000 (announcements_body_nonblank, part 109). So a long notice is
 *  ALWAYS cut on its way into an inbox row, and the only question is whether
 *  the reader can tell. Cut here, with an ellipsis, so they can — and so the
 *  archive screen is visibly the place the rest of it lives. */
export const NOTICE_BODY_MAX = 500;

/** Where a notice notification sends the reader: the archive, not the
 *  dashboard. The dashboard shows the LATEST one, which is the half of this
 *  defect that made older notices unreadable anywhere. */
export const NOTICE_ROUTE = '/(client)/notices';

/* ── clipping ─────────────────────────────────────────────────────────────── */

/**
 * `text` cut to `max` characters, ending in an ellipsis when anything was
 * dropped.
 *
 * The cut prefers the last space, so a notice does not end mid-word — but only
 * when that space is late enough to leave most of the text; a body with one
 * enormous word in it is cut hard rather than reduced to nothing.
 */
export function clip(text: string, max: number): string {
  const s = (text ?? '').trim();
  if (s.length <= max) return s;
  const hard = s.slice(0, max - 1).trimEnd();
  const sp = hard.lastIndexOf(' ');
  return `${sp > max * 0.6 ? hard.slice(0, sp).trimEnd() : hard}…`;
}

/* ── a notice ─────────────────────────────────────────────────────────────── */

export type NoticeKind = 'coach' | 'gym';

export interface Notification { title: string; body: string }

/**
 * The inbox row for one announcement.
 *
 * `gymName` is the tenant's own name where it has been read, and null where it
 * has not — in which case the heading says "your gym" rather than inventing
 * one. Null here means "we do not know what this gym calls itself", and the
 * generic heading is true; a placeholder name would not be.
 *
 * Returns null for a blank body. `notifications.body` is NOT NULL and an inbox
 * row with only a heading tells somebody nothing — the same reason
 * inboxDecision() refuses a bodiless push.
 */
export function noticeNotification(
  kind: NoticeKind,
  body: string,
  gymName?: string | null,
): Notification | null {
  const b = clip(body ?? '', NOTICE_BODY_MAX);
  if (!b) return null;
  const gym = (gymName ?? '').trim();
  const title = kind === 'coach'
    ? 'A notice from your coach'
    : gym ? clip(`A notice from ${gym}`, NOTICE_TITLE_MAX) : 'A notice from your gym';
  return { title, body: b };
}

/* ── an invoice ───────────────────────────────────────────────────────────── */

/**
 * The inbox row for an invoice a coach has just issued to a client who has an
 * account.
 *
 * Every clause here is load-bearing:
 *
 *   the number      so the client can match this to the document when the coach
 *                   sends it, and so two invoices in a week are two things
 *                   rather than one they read twice.
 *   the amount      through money(), which returns NULL rather than a bare
 *                   figure when the currency is missing — Repple is
 *                   white-labelled and a number with no currency beside it is
 *                   not an amount of money. Where it is null no figure is
 *                   printed and the row says why, rather than showing "0".
 *   the hedge       'says' / 'states', never 'has paid' or 'you paid'. `kind`
 *                   is the coach's own claim (part 138) and this app has not
 *                   checked it against a bank or a card processor.
 *   ask them        because `coach_invoices` is readable by the ISSUING COACH
 *                   ALONE. There is no client screen for it and there is not
 *                   meant to be: the coach hands the document over, and that
 *                   act is what decides the client should have it. A
 *                   notification that said "open the app to see it" would send
 *                   somebody looking for a screen that does not exist.
 *
 * No push goes with this and the copy does not pretend one did — see the call
 * site in src/ui/coachInvoices.ts for why an invoice is inbox-only.
 */
export function invoiceNotification(inv: CoachInvoice): Notification {
  const n = invoiceNumber(inv.seq);
  const amount = money(inv);
  const what = clip(inv.description || '', 120);
  // The figure and what it was for, or an explicit statement that the figure
  // could not be put in a currency. Never a bare number, and never a dash that
  // could be read as "nothing charged".
  const line = amount
    ? `Invoice ${n} for ${amount}${what ? ` — ${what}` : ''}.`
    : `Invoice ${n}${what ? ` — ${what}` : ''}. The amount could not be stated in a currency, so none is shown here.`;
  const claim = inv.kind === 'received'
    ? 'Your coach states this amount has been received. That is their own statement — it has not been checked against a bank or a card processor and it is not a payment receipt.'
    : 'Your coach states this amount is being requested. It is their own record, not a bill this app has checked, and no tax is calculated on it.';
  return {
    title: inv.kind === 'received' ? 'Your coach recorded a payment' : 'An invoice from your coach',
    body: clip(`${line} ${claim} Ask them for a copy of the document.`, NOTICE_BODY_MAX),
  };
}

/* ── what the author is told happened ─────────────────────────────────────── */

/** What became of the optional push. `'off'` is the author not asking for one,
 *  which is the default and is NOT a failure. */
export type PushOutcome = 'off' | 'queued' | 'failed';

export interface DeliveryReport {
  /** How many people the fan-out found to address. NULL means the read that
   *  finds them failed — which is NOT zero, and must never be reported as
   *  "nobody". */
  recipients: number | null;
  /** Rows `notify_users()` actually wrote. NULL means the call itself failed or
   *  was never made; 0 means it ran and wrote nothing. The two are different
   *  sentences and part 122 returns the count precisely so they can be. */
  recorded: number | null;
  push: PushOutcome;
  /** Why the push did not go out. Shown verbatim: the author can act on "not
   *  connected to the server" and cannot act on "unknown error". */
  pushError?: string | null;
}

/**
 * The sentence the author reads after posting a notice.
 *
 * The whole point is that it reports what HAPPENED rather than what was
 * intended. app/(owner)/promotions.tsx has the scar this is written from: it
 * told an owner "Sent to N members" where N was the number of member rows, over
 * a send that swallowed every failure — so an undeployed function read as N
 * delivered. Nothing below states a number that was not counted.
 *
 * "Queued" and "will see", never "delivered": a push is queued with Expo and a
 * notification is seen when somebody opens the app. Neither is a delivery this
 * app witnessed.
 */
export function deliverySummary(r: DeliveryReport): string {
  const parts: string[] = [];

  if (r.recipients === 0) {
    // Said before anything about notifications, because "0 notifications
    // recorded" and "there is nobody to notify" are different facts and only
    // one of them is worth acting on. This branch is reachable only from a read
    // that SUCCEEDED and found nobody — a failed read arrives as null.
    parts.push('It is posted, and there is nobody to notify yet — no accounts were found to address it to.');
  } else if (r.recorded == null) {
    // The notice itself is on the server either way — that write is what this
    // sentence is appended to — so the honest report is that the notifications
    // are the part that did not happen.
    parts.push('It is posted, and nobody could be notified about it just now. They will see it the next time they open their notices.');
  } else if (r.recorded === 0) {
    parts.push('It is posted. No notifications were recorded, so it will be seen when somebody opens their notices rather than arriving on its own.');
  } else if (r.recipients != null && r.recipients > r.recorded) {
    // Deliberately says which number is which. notify_users() skips a
    // recipient it may not reach (a client who left the roster, a hand-added
    // person with no account) rather than failing the whole statement.
    parts.push(`It is posted, and ${num(r.recorded)} of ${num(r.recipients)} people now have it in their notifications.`);
  } else {
    parts.push(`It is posted, and ${num(r.recorded)} ${r.recorded === 1 ? 'person has' : 'people have'} it in their notifications.`);
  }

  if (r.push === 'queued') {
    parts.push('A push was queued as well — only people on a push-enabled build with notifications turned on will get one.');
  } else if (r.push === 'failed') {
    parts.push(`The push did not go out: ${(r.pushError || '').trim() || 'the server did not say why'}.`);
  } else {
    parts.push('No push was sent, so nobody’s phone rang for it.');
  }

  return parts.join(' ');
}

/**
 * What the author is told BEFORE they push, on the control that does it.
 *
 * An author who can wake every member of a gym is a capability worth being
 * plain about, and this app cannot soften it: there is no scheduler in this
 * repository, no quiet-hours setting, and no column anywhere recording what
 * timezone anybody is in — so a control promising "it goes out in the morning"
 * would be a promise nothing could keep. The honest version is to say that it
 * happens NOW, wherever the recipient is, and let the author decide whether
 * what they wrote is worth that.
 *
 * `recipients` null means the count could not be read; the sentence then says
 * "everybody" rather than a number, because a figure nobody counted is the
 * thing this codebase's checks exist to stop.
 */
export function pushConsequence(kind: NoticeKind, recipients: number | null): string {
  const who = kind === 'coach' ? 'client' : 'member';
  const audience = recipients == null
    ? `every ${who}`
    : `${num(recipients)} ${who}${recipients === 1 ? '' : 's'}`;
  return `Sends a push to ${audience} straight away, at whatever time it is where they are. Without it the notice still reaches their notices and their notifications — quietly.`;
}
