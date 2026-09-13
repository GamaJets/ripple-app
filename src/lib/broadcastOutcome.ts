// What happened to a coach's broadcast, in the only three figures this app is
// entitled to state.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// app/(trainer)/broadcast.tsx sends and then says nothing that lasts. The
// report goes into an `Alert`, which is gone the moment a thumb lands on it,
// and what remains on screen is a list of the people who FAILED. A coach who
// sent to nineteen and had nineteen land is left with an empty screen and a
// blank message box — the same screen they would see if they had never pressed
// the button. The header of that file already records that its confirmation
// once said "Message delivered to N clients" and that the claim was removed;
// what replaced it was an alert, and an alert is not a record.
//
// ── THE WORD ───────────────────────────────────────────────────────────────
//
// "Delivered" is the word this file exists to be careful with, and the care is
// the same care src/lib/gymBroadcastLog.ts takes on the gym side: ADDRESSED and
// DELIVERED are two separate figures because they are two separate claims, and
// `delivered: null` stays null — unknown, never none.
//
// The coach side is the harder case, because here the honest answer for
// `delivered` is null EVERY TIME, and there is no future column that will fill
// it in:
//
//   ADDRESSED  the size of the segment this screen guarded and then fanned out
//              over. Known exactly, and only because `guardRecipients` refuses
//              to send at all over a roster or a segment read that came back
//              short — a count over a partial read would be the size of the
//              read wearing the word "addressed".
//
//   WRITTEN    `messages` rows the SERVER handed back. `sendCoachMessages`
//              does `.select('id').single()` per client precisely so that this
//              figure means the row exists rather than that the request did
//              not raise. This is the strongest claim the product can make and
//              it is a claim about a database, not about a person.
//
//   DELIVERED  null. Always. A `messages` insert fires the trigger from
//              supabase/parts/26, which calls the notify-message edge function,
//              which posts to send-push, which hands the payload to Expo, which
//              hands it to Apple or Google. Nothing on that chain reports back
//              into this app, and even the last hop would only say a
//              notification was accepted for delivery — not that a handset was
//              on, not that the banner was seen, and not that the person read
//              the message. A phone in a locker for a fortnight consumes a
//              successful push.
//
// So `delivered` is typed `number | null` and is null at every call site in the
// product today. It would be simpler to delete the field. It is kept because
// deleting it makes "we do not know how many arrived" UNSAYABLE, and a screen
// that cannot say that will say the figure it does have instead — which is
// exactly how "19 rows were written" becomes "19 clients were told".
//
// Pure — no react, no supabase, no clock.
import { num } from './format';

/** What became of one broadcast, as three separate claims. */
export interface SendOutcome {
  /** Everybody the segment addressed — every thread the send tried to write. */
  addressed: number;
  /** How many of those rows the server handed back. Never assumed from the
   *  absence of an error; see `sendCoachMessages`. */
  written: number;
  /**
   * How many reached a handset.
   *
   * Null is UNKNOWN and is not zero. Nothing in this product sets it to a
   * number, and the type is nullable so that the unknown has somewhere to live
   * rather than being rounded into `written`.
   */
  delivered: number | null;
}

/**
 * Build the outcome from what the send actually reported.
 *
 * A constructor rather than an object literal at the call site, so that
 * `delivered: null` is written down ONCE, here, with the argument above it. A
 * screen assembling this by hand is a screen one hopeful edit away from
 * `delivered: written`.
 */
export function sendOutcome(addressed: number, written: number): SendOutcome {
  return {
    addressed: Math.max(0, Math.trunc(addressed)),
    // Clamped to what was addressed, because a figure larger than the set it
    // is drawn from is not a fact about a send, it is an arithmetic error — and
    // the sentence that reports it should not be the first place anybody finds
    // out. The gym-side line has a branch for the impossible case; this one
    // cannot produce it.
    written: Math.max(0, Math.min(Math.trunc(written), Math.max(0, Math.trunc(addressed)))),
    delivered: null,
  };
}

const people = (n: number): string => `${num(n)} ${n === 1 ? 'client' : 'clients'}`;

/**
 * The sentences, in the order they have to be read.
 *
 * A list rather than a paragraph because each line is a different claim with a
 * different level of confidence behind it, and a reader who skims a paragraph
 * takes the first number away with them. The last line is the one that must
 * survive the skim, so it is on its own.
 */
export function outcomeLines(o: SendOutcome): string[] {
  const lines: string[] = [];

  lines.push(`Addressed to ${people(o.addressed)}.`);

  if (o.written === o.addressed) {
    lines.push(o.written === 1
      ? 'The message was written into their thread, and the server confirmed the row.'
      : `The message was written into all ${num(o.written)} threads, and the server confirmed every row.`);
  } else if (o.written === 0) {
    // "Nothing was written" is the useful half. A coach who believes a failed
    // send half-landed will not send it again, and the people it was for hear
    // nothing at all.
    lines.push(`Nothing was written. Not one of the ${num(o.addressed)} threads has the message in it.`);
  } else {
    const missed = o.addressed - o.written;
    lines.push(`${num(o.written)} of ${num(o.addressed)} threads had it written. `
      + `${num(missed)} did not, so ${missed === 1 ? 'that client has' : 'those clients have'} nothing from you.`);
  }

  // The line the whole file exists for. Said even when everything landed —
  // ESPECIALLY when everything landed, because that is the moment a coach
  // reads "all 19" and stops.
  if (o.delivered == null) {
    lines.push(o.written === 0
      ? 'Nothing was handed to a phone, because nothing was written.'
      : 'How many of those reached a phone is unknown — not none. Repple can see the row it wrote; '
        + 'it is never told whether a handset was on, whether the banner appeared, or whether anybody read it.');
  } else {
    lines.push(`${num(o.delivered)} of those are recorded as having reached a phone.`);
  }

  return lines;
}

/**
 * The heading over those lines.
 *
 * Deliberately not "Sent" on its own. The three states are a different fact
 * each, and a coach scanning for the shape of what happened reads the heading
 * and nothing else.
 */
export function outcomeTitle(o: SendOutcome): string {
  if (o.addressed === 0) return 'Nothing was sent';
  if (o.written === 0) return 'Nothing was written';
  if (o.written === o.addressed) return 'Written to every thread';
  return `Written to ${num(o.written)} of ${num(o.addressed)}`;
}

/**
 * Where the durable record of this send actually is.
 *
 * The gym console keeps `gym_broadcast_sends` because over there the recipient
 * list existed nowhere afterwards: `notify_users` took an array of ids, wrote
 * inbox rows that point at no announcement, and the list was gone. A coach
 * broadcast has the opposite shape. There is no broadcast object, on purpose —
 * every recipient got an ordinary `messages` row in their own thread, which
 * the coach can open, which the client can reply to, and which is the record.
 * A second table naming the same people would be a worse copy of something
 * already kept in the right place, and it would be the copy that could go out
 * of step.
 *
 * What is NOT kept anywhere is the GROUPING: nothing afterwards says those
 * messages were one send. This sentence says so rather than letting a coach
 * discover it when they go looking for a list of their broadcasts.
 */
export const WHERE_THE_RECORD_IS =
  'Each one is an ordinary message in that client’s own thread — open a thread and it is there, and '
  + 'they can reply to it. Nothing records them as a single broadcast, so this summary stays until '
  + 'you leave the screen and is not kept anywhere afterwards.';
