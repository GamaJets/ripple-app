// What a coach is told after offering a freed slot round the whole roster.
//
// ── Why this is a module and not a template literal in the screen ──────────
//
// app/(trainer)/calendar.tsx said this, in one line, and it said:
//
//     All ${ids.length} of your clients were sent a notification…
//
// `ids` is the list the screen HANDED OVER. It is not a count of anything that
// happened. `sendPushChecked` in src/ui/pushNotifications.ts writes the inbox
// row first and hands back `recorded` — the number `notify_users` itself
// returns, which is how many rows the database wrote — and that number was
// thrown away. The two differ whenever row-level security drops a recipient,
// whenever a client has left the roster between the read and the tap, and
// whenever the notice is one the inbox does not keep. `ok` stays true through
// every one of those, because the push call was accepted, so the screen said
// "all twelve" over eight and had no way of knowing.
//
// A coach who reads "all twelve" waits for a booking. A coach who reads "eight
// of twelve" messages the other four. The slot is the same slot either way; the
// difference is entirely in whether the sentence was measured or assumed.
//
// `classOffConfirmation` in src/lib/notifyCopy.ts is the same shape for the
// same reason, and lives in a tested module for the same reason: a sentence
// that reports a number is logic, and logic in a screen is logic nothing runs.
import { PUSH_PARTIAL_NOTE } from './notifyCopy';

/** The count of a fan-out, as the two halves that can disagree. */
export interface ReofferOutcome {
  /** How many people the screen asked the server to notify. */
  offered: number;
  /**
   * How many rows the server said it wrote.
   *
   * Never the same variable as `offered`, and never defaulted to it. A caller
   * that genuinely has no count from the server passes null, which is a third
   * sentence — "we could not tell" — and not a quiet zero and not a quiet all.
   */
  recorded: number | null;
  /**
   * Whether an inbox row was ever going to be written for this send.
   *
   * ── The zero that was policy, reported as a failure ───────────────────────
   *
   * This is the re-offer, and its title is 'A slot just opened'. `EXPIRING` in
   * src/lib/notifyInbox.ts matches exactly that phrase and refuses the row on
   * purpose — a race for a slot is over by the time anybody opens an inbox — so
   * `recorded` came back 0 on EVERY re-offer this product has ever sent, and
   * the `told === 0` branch below told the coach:
   *
   *     …the server recorded the notification for nobody — so none of your 12
   *     clients has it in their notifications. Message them yourself, or try
   *     again.
   *
   * over a send that had gone out perfectly. Not a floor read as a total this
   * time, but a policy read as a fault: the alarming half of the same mistake,
   * and the one that makes a coach message twelve people who have already been
   * asked.
   *
   * False means `recorded` measures nothing and must not be stated. Undefined
   * is a caller that has not been taught the difference, and keeps the old
   * meaning.
   */
  inboxKept?: boolean;
  /**
   * send-push could only PARTLY READ the handsets it was sending to, so the
   * number of clients whose phone lit up is a floor. See PUSH_PARTIAL_NOTE in
   * src/lib/notifyCopy.ts, which is the one wording this product has for it.
   */
  partial?: boolean;
}

const n = (v: number) => Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));

/**
 * The sentence for a slot that was re-offered, given what the server confirmed.
 *
 * `when` is the slot in the words the screen already uses for it ("18:00 on
 * Tue"), passed in rather than formatted here: the day and the time belong to
 * the reader's own clock and the screen has already worked them out.
 *
 * Every branch ends by telling the coach what is still true of the slot,
 * because the alert is dismissed and the slot is not.
 */
export function reofferConfirmation(out: ReofferOutcome, when: string): string {
  const offered = n(out.offered);
  const tail = 'Delivery depends on their notification settings.';
  // Said after whichever sentence is chosen below, never instead of one: a
  // partly-read handset list is a fact about how far the push got, not about
  // whether the slot is open or how many people were asked.
  const hedge = out.partial ? ` ${PUSH_PARTIAL_NOTE}` : '';

  // A kind the inbox does not keep. `recorded` is 0 by policy and there is
  // nothing to count, so the sentence reports what IS known — the send was
  // accepted for everybody on the list — and says out loud that this one is
  // not waiting in an inbox for whoever missed the banner, because that is the
  // part a coach can act on.
  if (out.inboxKept === false) {
    return `All ${offered} of your client${offered === 1 ? '' : 's'} ${offered === 1 ? 'was' : 'were'} sent a notification that ${when} is free — first to book takes it.${hedge} A freed slot is not kept in their notifications, so only whoever has their phone to hand will see it. ${tail}`;
  }

  if (out.recorded == null) {
    return `${when} is open, and the notification went out — but the server did not say how many of your ${offered} client${offered === 1 ? '' : 's'} it reached, so this is not a count.${hedge} Message anyone you particularly want in the slot.`;
  }

  const told = n(out.recorded);

  if (told === 0) {
    return `${when} is still open, and the server recorded the notification for nobody — so none of your ${offered} client${offered === 1 ? '' : 's'} has it in their notifications.${hedge} Message them yourself, or try again.`;
  }

  // Deliberately `>=` rather than `===`. A server that reports MORE rows than
  // we asked for is a server we have misunderstood, and the honest reading of
  // that is still "everybody we asked for" — never a negative remainder in a
  // sentence about how many people were missed.
  if (told >= offered) {
    return `All ${offered} of your client${offered === 1 ? '' : 's'} ${offered === 1 ? 'was' : 'were'} sent a notification that ${when} is free — first to book takes it.${hedge} ${tail}`;
  }

  const missed = offered - told;
  return `${told} of your ${offered} clients ${told === 1 ? 'was' : 'were'} sent a notification that ${when} is free.${hedge} The server did not record the other ${missed}, so message them yourself if you want the slot filled.`;
}
