// What a notification about a NOTICE, an INVOICE or a CLASS SEAT is allowed to
// say.
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
//
// ── A seat in a class is the one that expires ─────────────────────────────
//
// The third producer arrived with supabase/parts/159: a member promoted off a
// class waiting list, told by a trigger. It is here rather than in the SQL for
// the reason `classStartsIn` sets out at the bottom of this file — the wording
// has five branches, nothing in this repository can execute a plpgsql function,
// and an unexecutable rule is an unchecked one.
import { num } from './format';
import { invoiceDayLabel, invoiceNumber, money, type CoachInvoice } from './coachInvoice';

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

/**
 * The row a client gets when their coach chases an invoice.
 *
 * ── Why it is not the same row twice ──────────────────────────────────────
 *
 * `invoiceNotification` above announces a document that has just come into
 * existence. This one is about a document the client has already been told
 * about, and re-sending the first copy would read as a SECOND invoice — the
 * exact confusion the number in it exists to prevent. So the title says it is a
 * reminder and the body says it is about the one they already have.
 *
 * ── The hedges, and why each is here ──────────────────────────────────────
 *
 *   'still shows'    Repple is not told when anybody pays. A bank transfer that
 *                    landed this morning is invisible here, so the app must not
 *                    say "you have not paid" to somebody who has. What is true
 *                    is that the COACH's record still has it outstanding, and
 *                    that is what is said.
 *   the due date     printed only where the coach stated one, because a
 *                    reminder that invents a deadline is worse than no reminder.
 *   no arithmetic    no days-late count, no interest, no late fee. This app
 *                    calculates none of those and part 168 refuses to.
 *   ask them         `coach_invoices` is readable by the issuing coach alone.
 *                    There is no client screen for it, by design.
 */
export function invoiceReminderNotification(inv: CoachInvoice): Notification {
  const n = invoiceNumber(inv.seq);
  const amount = money(inv);
  const what = clip(inv.description || '', 120);
  const line = amount
    ? `Invoice ${n} for ${amount}${what ? ` — ${what}` : ''}.`
    : `Invoice ${n}${what ? ` — ${what}` : ''}. The amount could not be stated in a currency, so none is shown here.`;
  const due = String(inv.dueOn ?? '').slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(due) ? ` They stated it was due on ${invoiceDayLabel(due)}.` : '';
  return {
    title: 'A reminder from your coach',
    body: clip(
      `${line} Their record still shows this one as outstanding.${when} If you have already settled it, tell them — this app is not told when a payment reaches them. Ask them for a copy of the document.`,
      NOTICE_BODY_MAX,
    ),
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
  /**
   * The recipient list was only PARTLY READ when the push went out.
   *
   * send-push reports this as `partial` when a chunk of the list failed or ran
   * off its page ceiling: it pushed to everybody it could resolve and cannot
   * say that was everybody. It is a separate fact from `push: 'failed'` —
   * the send was accepted, and some of it happened.
   *
   * Undefined and false both mean "no reason to think anything was missed",
   * which is what an older deployment of send-push, and every non-broadcast
   * send, will hand back.
   */
  pushPartial?: boolean;
  /**
   * The list of people to address was itself capped.
   *
   * `recipients` is then a floor, not a count, and the sentence must not state
   * it as a total — the same rule `LoadStatus`'s 'partial' member states for
   * every other read in this codebase (src/ui/loadStatus.ts).
   */
  recipientsTruncated?: boolean;
  /**
   * More people were addressed than `notify_users()` considers in one call, so
   * `recorded` is a FLOOR — see NOTIFY_USERS_CAP in src/ui/pushNotifications.ts
   * and the `limit 2000` in supabase/parts/122.
   *
   * The people past that ceiling were neither written to nor counted, which is
   * why this cannot be inferred from the numbers: `recorded` looks like an
   * ordinary count and the shortfall is invisible in it. Under this flag the
   * sentence says "at least", and never compares the two figures — the
   * difference between them is not the number of people who were skipped.
   */
  recordedAtCap?: boolean;
}

/**
 * The one sentence this product has about a push whose recipient list was only
 * PARTLY READ.
 *
 * ── Why it is a constant and not four sentences ───────────────────────────
 *
 * `deliverySummary` below had the only wording for it, and four other screens
 * — app/(trainer)/classes.tsx, app/(trainer)/calendar.tsx,
 * app/(trainer)/sessions.tsx and app/(owner)/promotions.tsx — each state their
 * own count over the same flag and had nothing to say about it. Four authors
 * writing a fifth, sixth, seventh and eighth wording for "some of them may
 * have got nothing" is how `fmtRelativeDay` came to exist in five copies that
 * disagreed; the difference here is that these are sentences about whether
 * somebody was told their class is off, so disagreeing about the hedge is
 * disagreeing about how alarmed to be.
 *
 * It reads as a clause after a stated number, in every one of the five, and
 * says the thing the number cannot: the count is what went out, and what went
 * out is not known to be everybody.
 */
const PARTIAL_CAUSE = 'Not all of the recipient list could be read';
export const PUSH_PARTIAL_NOTE = `${PARTIAL_CAUSE}, so more people may be without one than this says.`;

/**
 * The same clause for a send to ONE person.
 *
 * "More people may be without one" is a sentence about a crowd, and
 * app/(trainer)/sessions.tsx answers a request from a single client. The CAUSE
 * is identical and stays identical — that is the half a reader can act on, and
 * splitting it would be the fifth wording this constant exists to prevent —
 * and only the consequence changes number.
 */
export function pushPartialNote(recipients?: number | null): string {
  return recipients === 1 ? `${PARTIAL_CAUSE}, so they may not have got one.` : PUSH_PARTIAL_NOTE;
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
  } else if (r.recordedAtCap) {
    // "At least", because `recorded` stopped being a count at the ceiling
    // inside notify_users(). Tested before `recipientsTruncated` because it is
    // the stronger statement: rows were definitely not written here, whereas a
    // capped ROSTER read only means the list of people may be short.
    // No "send it again" here, and that omission is deliberate: the ceiling is
    // a `limit` with no ORDER BY, so a second send would write to an arbitrary
    // two thousand rather than to the ones that were missed. Telling an author
    // to repeat it would be offering a remedy that does not remedy anything.
    // The notice itself is on the server and everybody can still read it there.
    parts.push(`It is posted, and at least ${num(r.recorded)} people have it in their notifications. There are more people on this notice than can be written to in one go, so some of them do not — they will see it when they open their notices.`);
  } else if (r.recipientsTruncated) {
    // `recipients` is a floor here, so it is not stated as a total and the two
    // numbers are not compared: "3 of 1001" over a capped read invites the
    // author to go and find the other 998, and there is no such number.
    // Said before the push sentence, because it is a fact about who the notice
    // was addressed to at all rather than about how it arrived.
    parts.push(`It is posted, and ${num(r.recorded)} ${r.recorded === 1 ? 'person has' : 'people have'} it in their notifications. There are more people to address than this app could read in one go, so some may not have been included.`);
  } else if (r.recipients != null && r.recipients > r.recorded) {
    // Deliberately says which number is which. notify_users() skips a
    // recipient it may not reach (a client who left the roster, a hand-added
    // person with no account) rather than failing the whole statement.
    parts.push(`It is posted, and ${num(r.recorded)} of ${num(r.recipients)} people now have it in their notifications.`);
  } else {
    parts.push(`It is posted, and ${num(r.recorded)} ${r.recorded === 1 ? 'person has' : 'people have'} it in their notifications.`);
  }

  if (r.push === 'queued' && r.pushPartial) {
    // The send was accepted and part of the recipient list could not be read,
    // so the number of handsets it reached is a floor. Said out loud rather
    // than folded into the ordinary "queued" sentence, because "it went out"
    // over a truncated list is the exact claim send-push's paging was added to
    // stop making — and a caller that could not see the flag went on making it.
    parts.push(`A push was queued as well. ${PUSH_PARTIAL_NOTE} Everyone above still has it in their notifications.`);
  } else if (r.push === 'queued') {
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

/* ── a class seat that expires ─────────────────────────────────────────────
 *
 * ── This block is MIRRORED by supabase/parts/159 · class_promotion_notify ──
 *
 * A member on a class waiting list gets promoted when somebody else cancels,
 * and until part 159 nothing told them. That notification has a deadline the
 * other six in that file do not: a seat is worth nothing once the class has
 * started, so it has to say WHEN.
 *
 * And "when" cannot be a clock time. The row is written by a database trigger
 * inside `cancel_class()`'s transaction; `gym_classes` has no time zone column,
 * `tenants` has none either, and the database's own zone is a server setting
 * rather than a fact about the person who will read the row. "Thursday, 7:00pm"
 * written there is right for whoever the server agrees with and wrong for
 * everybody else — and a member told the wrong hour for a class they are now
 * booked into is worse off than one told nothing.
 *
 * src/lib/notifyInbox.ts already refuses calendar dates in the inbox for this
 * reason, and states the rule this follows: "a duration is the same number
 * everywhere, which is also the honest thing to show somebody who travelled
 * between receiving a notification and reading it."
 *
 * So the sentence is a duration, and the exact time is on the Classes screen,
 * rendered by the member's own device from the same timestamptz.
 *
 * ── Why it lives in TypeScript when only SQL calls it ─────────────────────
 *
 * It has no runtime caller in this app and that is deliberate — the same
 * arrangement part 158 made for `subChange()` in src/lib/subscriptionScope.ts.
 * The trigger is the only thing that ever produces this sentence, no test in
 * this repository can reach a plpgsql function, and a wording rule with five
 * branches that nothing can execute is a wording rule nobody has checked. This
 * is the specification; notifyCopy.test.ts is the only place it can be proved;
 * the SQL mirrors it band for band.
 *
 * IF YOU CHANGE ONE, CHANGE BOTH. This is the original.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long until a class starts, as one sentence.
 *
 * Both arguments are epoch milliseconds. The already-started branch is not
 * defensive padding: a member cancelling as a class begins promotes somebody
 * into a seat that is no longer worth having, and saying so is better than a
 * countdown reading "in about 0 hours" or a cheerful line about a class they
 * have already missed.
 *
 * Returns the empty string for a start time that is not a number at all, so a
 * caller assembling a body around it gets a sentence with a gap rather than the
 * word "NaN" in somebody's notifications.
 */
export function classStartsIn(startsAt: number, now: number): string {
  if (!Number.isFinite(startsAt) || !Number.isFinite(now)) return '';
  const ms = startsAt - now;
  if (ms <= 0) return 'It has already started.';
  if (ms < HOUR_MS) return 'It starts in under an hour.';
  const hours = Math.round(ms / HOUR_MS);
  if (hours === 1) return 'It starts in about an hour.';
  if (hours < 24) return `It starts in about ${hours} hours.`;
  const days = Math.round(ms / DAY_MS);
  return days <= 1 ? 'It starts in about a day.' : `It starts in about ${days} days.`;
}

/* ── an answer to a coaching request ───────────────────────────────────────
 *
 * ── The silence this closes ───────────────────────────────────────────────
 *
 * app/(client)/trainers.tsx pushes the COACH the moment somebody asks to be
 * coached. supabase/parts/158 says in as many words why the other half was
 * left undone — "Not fired on UPDATE… the client's side of that answer is a
 * separate decision about wording that has not been taken" — and nothing has
 * taken it since. `coach_requests_notify_trainer` is `after insert` only, so
 * the answer writes no row and sends nothing.
 *
 * What that costs is not symmetry. src/ui/CoachRequests.tsx presses Accept and
 * writes `coaching_relationships`, `clients.trainer_id` and the request's
 * status in one go; the coach reads "Client added" and the client reads
 * nothing. They find out by opening the app and noticing their Coach screen has
 * filled in.
 *
 * DECLINE is the half that matters more, and it is the reason this is a
 * notification rather than a nicety. An accepted client eventually notices. A
 * declined one sees exactly what they saw yesterday — a request they believe is
 * still pending — and goes on waiting for somebody who has already said no. The
 * app has no other surface that will ever tell them: `coach_requests` is not
 * rendered on the client side once it leaves 'pending'.
 *
 * ── Two routes, because they are two different next steps ─────────────────
 *
 * Accepted opens Your Coach, which now has somebody in it. Declined opens the
 * directory, which is the only useful thing left to do. Sending both to one
 * screen would mean one of the two arrives somewhere that says nothing about
 * what just happened.
 */

/** Where an accepted request sends the client: the screen that just changed. */
export const COACH_ACCEPTED_ROUTE = '/(client)/my-coach';
/** Where a declined one sends them: the only useful next step. */
export const COACH_DECLINED_ROUTE = '/(client)/trainers';

/** A notification with somewhere to go. `route` is kept apart from the body
 *  because src/lib/notifyInbox.ts classifies on it and the caller passes it
 *  through `data.route` rather than printing it. */
export interface RoutedNotification extends Notification { route: string }

/**
 * What the client is told when their coaching request is answered.
 *
 * The coach's name is passed in rather than looked up, and a name that could
 * not be read becomes "The coach you asked" rather than a blank: this sentence
 * is read on a lock screen by somebody who may have asked two coaches, so the
 * subject is never dropped altogether.
 *
 * Neither branch softens. "Has declined" is what happened, and a body that
 * hedged it into "is not taking new clients right now" would be this app
 * inventing a reason on a coach's behalf — the rule src/lib/nudge.ts and
 * supabase/parts/140 spend their headers on.
 */
export function coachAnswerNotification(
  accepted: boolean,
  coachName: string | null | undefined,
): RoutedNotification {
  const who = (coachName ?? '').trim() || 'The coach you asked';
  return accepted
    ? {
      title: 'Your coaching request was accepted',
      body: clip(`${who} has taken you on. Your Coach screen has them now, and anything they set you from here arrives in your app.`, NOTICE_BODY_MAX),
      route: COACH_ACCEPTED_ROUTE,
    }
    : {
      title: 'Your coaching request was declined',
      body: clip(`${who} has declined it. Nothing else on your app has changed, and you can ask a different coach from the directory.`, NOTICE_BODY_MAX),
      route: COACH_DECLINED_ROUTE,
    };
}

/**
 * What the COACH reads after answering, saying which of the two things
 * actually happened.
 *
 * Three outcomes and three sentences, because `sendPushChecked` reports two
 * independent facts and a screen that collapsed them would be claiming a send
 * it did not witness — the defect app/(owner)/promotions.tsx was written from.
 *
 *   ok            the send-push function accepted it. "Told", never
 *                 "delivered": the push is queued with Expo and this app never
 *                 learns what became of it.
 *   recorded > 0  the push did not go out but the row did, so the client will
 *                 see it when they next open the app.
 *   recorded = 0  neither happened, and the decline branch says the consequence
 *                 out loud: as far as their app is concerned they are still
 *                 waiting.
 */
export function coachAnswerConfirmation(
  accepted: boolean,
  clientName: string,
  told: { ok: boolean; recorded: number },
): string {
  // 'That client' rather than 'They': the sentence continues "is now on your
  // roster", and a pronoun subject would make it ungrammatical on exactly the
  // branch where the name could not be read.
  const who = (clientName ?? '').trim() || 'That client';
  const lead = accepted
    ? `${who} is now on your roster.`
    : `${who}’s request is declined.`;
  if (told.ok) return `${lead} Their phone has been told.`;
  if (told.recorded > 0) {
    return `${lead} We couldn’t reach their phone, so they will see it in their notifications the next time they open the app.`;
  }
  return accepted
    ? `${lead} We couldn’t tell them at all — nothing reached their phone and nothing was written to their notifications, so they will find out by opening the app and noticing you there.`
    : `${lead} We couldn’t tell them at all — nothing reached their phone and nothing was written to their notifications, so as far as their app is concerned they are still waiting on you.`;
}

/* ── a class that was called off ───────────────────────────────────────────
 *
 * ── The silence this closes ───────────────────────────────────────────────
 *
 * supabase/parts/493 gave a called-off class an inbox row for everybody booked
 * and waitlisted, which was the whole of the fix its header describes: "an
 * owner cancels the 6am on a Sunday night… and every one of those twelve people
 * arrives at a locked room on Monday." A row is not a phone. Nothing in this
 * schema turns a `notifications` insert into a push — part 26's `messages`
 * trigger is the only server-side writer that reaches pg_net at all — so the
 * twelve people still find out when they next open the app, which for a 6am
 * class is after they have already travelled to it.
 *
 * So the push is sent from the handset that pressed the button, the way every
 * other push in this product is, and the ROW stays the trigger's.
 * src/lib/notifyInbox.ts refuses to record this one for exactly that reason:
 * two rows for one cancellation, worded differently, is the defect the chat
 * rule exists to prevent, arrived at from a different direction.
 *
 * ── No clock time, and no date ────────────────────────────────────────────
 *
 * The same rule `classStartsIn` above is written for. `gym_classes` has no zone
 * and `tenants` has none either, so "Thursday at 7pm" is right for whoever the
 * server agrees with and wrong for everybody else. The class is named, the
 * reason is passed on, and the Classes screen renders the time from the same
 * timestamptz on the member's own device.
 */

/** The title part 493's trigger writes, reused verbatim so the banner and the
 *  row a member later scrolls past are recognisably the same event. Imported by
 *  src/lib/notifyInbox.ts, which uses it to refuse the duplicate row. */
export const CLASS_OFF_TITLE = 'A class you booked is not running';

/** The plural, for somebody whose whole series went. */
export const CLASS_OFF_TITLE_MANY = 'Classes you booked are not running';

/** Where a called-off class sends the member. */
export const CLASS_OFF_ROUTE = '/(client)/classes';

/**
 * What one member is told, given how many of THEIR bookings went.
 *
 * `classes` is that member's own count and not the size of the cancellation:
 * calling off nine weeks of a series tells somebody booked on two of them that
 * two are off. A body claiming nine would be a number about somebody else's
 * diary.
 */
export function classOffNotification(
  classTitle: string | null | undefined,
  classes: number,
  reason: string | null | undefined,
): RoutedNotification {
  const name = (classTitle ?? '').trim() || 'A class';
  const said = (reason ?? '').trim();
  const why = said ? `: ${said}` : '';
  const many = Number.isFinite(classes) && classes > 1;
  return {
    title: many ? CLASS_OFF_TITLE_MANY : CLASS_OFF_TITLE,
    body: clip(
      many
        ? `${num(Math.floor(classes))} of your “${name}” classes have been called off${why}. Your bookings are kept on the record and there is nothing for you to do — your Classes screen has the rest of the timetable.`
        : `“${name}” has been called off${why}. Your booking is kept on the record and there is nothing for you to do — your Classes screen has the rest of the timetable.`,
      NOTICE_BODY_MAX,
    ),
    route: CLASS_OFF_ROUTE,
  };
}

/** One send: the people whose own count is `classes`. */
export interface ClassOffBucket { classes: number; userIds: string[] }

/**
 * Who gets which sentence, from the rosters of everything that was cancelled.
 *
 * ── Why this is not one send per class ────────────────────────────────────
 *
 * Calling off nine weeks of a Tuesday series would otherwise fire nine
 * notifications at the same person in the same second. That is the phone whose
 * notifications get turned off, and turning them off is what took the money
 * channel down with the chat channel in the first place (src/lib/coachNotify.ts).
 *
 * ── And not one send to everybody either ──────────────────────────────────
 *
 * Because the count is per person. Somebody booked on two of the nine is told
 * two. Grouping by that count is the smallest number of sends in which nobody
 * is told a figure about somebody else's diary — usually one bucket, at most as
 * many as there were occurrences.
 *
 * A (userId, classId) pair seen twice counts once: a member can hold both a
 * booking and a waiting-list row on the same class, and it is still one class
 * they are not going to.
 */
export function classOffBuckets(
  rows: readonly { userId: string; classId: string }[],
): ClassOffBucket[] {
  const seen = new Set<string>();
  const count = new Map<string, number>();
  for (const r of rows ?? []) {
    const u = (r?.userId ?? '').trim();
    const c = (r?.classId ?? '').trim();
    if (!u || !c) continue;
    const key = `${u} ${c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count.set(u, (count.get(u) ?? 0) + 1);
  }
  const byCount = new Map<number, string[]>();
  for (const [u, n] of count) {
    const list = byCount.get(n);
    if (list) list.push(u); else byCount.set(n, [u]);
  }
  return [...byCount.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([classes, userIds]) => ({ classes, userIds: userIds.sort() }));
}

/**
 * What the coach reads after calling a class or a series off.
 *
 * `people` null is a roster that could not be READ, which is not nobody — the
 * distinction `DeliveryReport.recipients` makes one screen up, and the one that
 * decides whether the coach has to go and tell twelve people themselves.
 *
 * `pushed` is how many of them the send-push function accepted, and nothing
 * here claims more than that. In particular it never says the cancellation is
 * in their notifications: that row is written by part 493's trigger inside the
 * same transaction, this app cannot see whether it landed, and a sentence
 * promising a row that a missing trigger would make imaginary is exactly the
 * kind of claim this file exists to refuse.
 *
 * ── `pushPartial`, and why it does not change the number ──────────────────
 *
 * send-push reports `partial` when it could not read the whole of the
 * `push_tokens` list for the people it was handed. `pushed` is still the right
 * number to state — it is what this app asked for and what the function
 * accepted — but the claim RIDING on it, that everybody else is the only one
 * without a banner, stops being true: the send resolved an unknown subset of
 * those handsets. So the figure stays and `PUSH_PARTIAL_NOTE` is appended to
 * it, which is the same clause `deliverySummary` says for the same fact rather
 * than a second wording for it.
 *
 * It is deliberately NOT folded into `pushed === 0`. A partly-read list is not
 * a failed send: some of the room was woken up, and telling a coach nobody was
 * would send them chasing twelve people who have already read it.
 */
export function classOffConfirmation(
  cancelled: number,
  people: number | null,
  pushed: number | null,
  pushPartial?: boolean,
): string {
  const n = Math.max(0, Math.floor(Number.isFinite(cancelled) ? cancelled : 0));
  const lead = `${num(n)} ${n === 1 ? 'class was' : 'classes were'} called off. Every booking, every check-in and every waiting list is kept.`;
  if (people == null) {
    return `${lead} We couldn’t read who had booked, so nobody has been told — tell them yourself.`;
  }
  if (people === 0) return `${lead} Nobody had booked or was waiting, so there was nobody to tell.`;
  const who = `${num(people)} ${people === 1 ? 'person had' : 'people had'} booked or ${people === 1 ? 'was' : 'were'} waiting`;
  if (pushed == null || pushed === 0) {
    return `${lead} ${who}, and we couldn’t reach any of their phones just now — tell them yourself if the class is soon.`;
  }
  if (pushed < people) {
    // "We couldn't reach the rest" names a set — the people-minus-pushed who
    // are without one — and under `partial` there is no such set: the shortfall
    // is on top of it and nobody counted it. So the confident half is replaced
    // rather than added to.
    if (pushPartial) {
      return `${lead} ${who}. A push was queued to ${num(pushed)} of them. ${PUSH_PARTIAL_NOTE} Tell them yourself if the class is soon.`;
    }
    return `${lead} ${who}. A push was queued to ${num(pushed)} of them; we couldn’t reach the rest, so tell them yourself if the class is soon.`;
  }
  if (pushPartial) {
    // "All of them" is exactly the claim `partial` withdraws, so this branch
    // does not make it. The send went out for everybody who was booked; what
    // is not known is how many handsets it resolved to.
    return `${lead} ${who}, and a push was queued for them. ${PUSH_PARTIAL_NOTE} Tell them yourself if the class is soon.`;
  }
  return `${lead} ${who}, and a push was queued to all of them. Only people on a push-enabled build with notifications turned on will get one.`;
}
