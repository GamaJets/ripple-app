// The member's half of the queue their coach is already looking at.
//
// ── The fact the app holds and does not say ────────────────────────────────
//
// src/lib/awaitingReply.ts builds the coach's "Waiting on a Reply" section:
// every client whose own last word has stood for `WAITING_HOURS` — a full day —
// sorted longest wait first, with a line under each saying how long it has been
// and whether the coach has opened it. It is a real, shipped, tested list, and
// its whole subject is a member who is waiting.
//
// That member is told none of it. app/(client)/messages.tsx shows them a
// composer, their own bubbles, and — since the read receipt landed — "Sent
// 09:41 · Read" under each one. Nothing anywhere says how long they have been
// waiting, and nothing says the app has already noticed.
//
// The screen's own header records what was there before and why it went:
//
//     "Fabrication removed: the header claimed your coach 'usually replies
//      within a few hours'. No reply-time is measured anywhere, so the claim is
//      gone rather than replaced."
//
// That deletion was right and this does not undo it. Nothing here predicts a
// reply, estimates one, or implies one is owed. What it states is two facts the
// screen is already holding — when this member last spoke, and whether the
// coach's watermark has passed it — and one fact about the app itself, which is
// that a conversation this old is on a list at the top of the coach's messages
// screen. A member sitting in a three-day silence is not asking for a
// prediction. They are asking whether anybody knows.
//
// ── One narrator, and why the bubble is not it ────────────────────────────
//
// `deliveryLine` in src/lib/readReceipt.ts owns the sentence under a bubble and
// keeps it: "Sent 09:41", "Sent 09:41 · Read", and the two failures. This says
// something that sentence structurally cannot, because a bubble knows its own
// stamp and not the DURATION since it, and because a per-bubble line has no
// business talking about the coach's inbox. The two never overlap: this module
// never prints a time of day, never says "sent", and never says "read" of a
// single message.
//
// ── Never "they have not opened it" ────────────────────────────────────────
//
// src/ui/readReceipts.ts is explicit about what a missing watermark means:
//
//     "Null is what an unauthorised caller and a peer who has never opened the
//      thread both get, and the pessimistic reading — no receipt — is the only
//      safe one for either."
//
// So there are two answers here and not three. Either the coach's watermark has
// passed this message, which is a fact; or it has not, which is an absence of
// evidence and is said as one. `awaitingReply` has a third state — 'no',
// genuinely unopened — because the coach's row carries an unread COUNT that
// this side has no equivalent of. Borrowing its wording would turn "we cannot
// tell" into an accusation, aimed at somebody the member is paying and trusts.
//
// ── The silences ───────────────────────────────────────────────────────────
//
// Silence is the ordinary answer and most of this module is about earning it:
//
//   · the coach spoke last. There is nothing to wait for.
//   · under a day. A coach is on a gym floor with their hands on somebody, and
//     a member told at hour three that they are waiting has been handed an
//     anxiety the app invented. `WAITING_HOURS` is imported rather than
//     restated so the two sides of this cannot drift apart — the day the coach's
//     threshold moves, the member's moves with it.
//   · the message never reached the server. It is queued or refused, the bubble
//     already says so, and "you have been waiting two days" over an outbox is a
//     lie in the cruellest available direction.
//   · the thread is closed, blocked or has no coach. The screen says that.
//   · the read is still in flight, or failed. Under 'error' the messages on
//     screen are whatever was there before; a reply may have arrived and not
//     come back, and stating a silence from an unconfirmed read is exactly the
//     defect src/ui/loadStatus.ts exists for.
//
// 'partial' DOES speak. `useThread` reads `created_at desc` at the row cap, so
// a long relationship arrives with its BEGINNING missing and its end intact —
// the same shape as src/lib/builderProgression.ts's argument about the training
// log. Truncation here can hide the first year of a conversation; it cannot
// hide who spoke last.
import type { LoadStatus } from '../ui/loadStatus';
import { WAITING_HOURS, waitedLabel } from './awaitingReply';

const HOUR = 3_600_000;

/** One message of the thread, as far as this module is concerned. */
export interface ThreadWord {
  /** True when this member sent it. */
  mine: boolean;
  /** The row's `created_at`. */
  createdAt: string;
  /**
   * Whether the server has this message.
   *
   * False for anything queued, refused or still in flight. Such a message is
   * not a wait — nobody has been given the chance to answer it — and the bubble
   * carries its own sentence from `unsentNote`.
   */
  delivered: boolean;
}

export interface ReplyWaitInput {
  messages: readonly ThreadWord[];
  /** The status of the thread read. */
  status: LoadStatus;
  /** When the coach last opened this thread, from `useReadReceipt`. Null means
   *  UNKNOWN — see the header. */
  peerReadAt: string | null;
  /** Now, in milliseconds. From `useNow()`, never a `Date.now()` frozen at
   *  mount: a thread is a screen somebody leaves open. */
  now: number;
  /** Whether a message can be sent into this thread at all. False for a closed,
   *  blocked or coachless thread, all of which the screen already explains. */
  canSend: boolean;
  /** The coach, named. 'Your coach' where the name could not be read — never a
   *  dash, which as the subject of a sentence reads as a broken screen (see
   *  scripts/check-prose.mjs). */
  them: string;
}

export type ReplyWait =
  /** Nothing to say. Every case in the header. */
  | { kind: 'silent' }
  /** They have opened it and nothing has come back. */
  | { kind: 'seen'; waitedMs: number; note: string }
  /** Nothing has come back, and whether it has been opened is not known. */
  | { kind: 'sent'; waitedMs: number; note: string };

/**
 * What the coach's app does with a conversation this old.
 *
 * Stated as a fact about the software, in the present tense, because that is
 * what it is: `WAITING_TITLE` is a section at the top of app/(trainer)/
 * messages.tsx and `sortWaiting` puts the longest wait first. It is deliberately
 * not "your coach will reply" and not "your coach has seen this" — it makes no
 * claim about a person at all, which is the only kind of reassurance this app is
 * entitled to give.
 */
export const COACH_QUEUE_NOTE =
  'Their app lists a conversation that has gone a day without a reply at the top of their messages, longest wait first.';

/** The newest message the server actually has, or null. */
function newestDelivered(messages: readonly ThreadWord[]): { mine: boolean; at: number } | null {
  let best: { mine: boolean; at: number } | null = null;
  for (const m of messages) {
    if (!m || !m.delivered) continue;
    const at = Date.parse(String(m.createdAt));
    // A stamp that will not parse cannot be measured against a clock, and a
    // wait is a subtraction. Dropping it is safe in the only direction that
    // matters: it can silence this, never make it say something longer.
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.at) best = { mine: m.mine, at };
  }
  return best;
}

/**
 * Whether the coach's watermark has passed a message.
 *
 * `>=` and not `>`, exactly as `deliveryOf` has it: the watermark is written as
 * the newest message's own `created_at`, so the newest message is precisely
 * equal and would otherwise be the one message that never counts as read.
 */
function seenBy(peerReadAt: string | null, at: number): boolean {
  if (!peerReadAt) return false;
  const read = Date.parse(peerReadAt);
  return Number.isFinite(read) && read >= at;
}

/**
 * What to say above the composer, or nothing.
 *
 * Two facts and no accusation, which is the rule `waitingLine` states on the
 * coach's side and the reason that list is readable. Nothing here says the
 * coach failed to do anything: this module cannot tell a question from a
 * thank-you, and the two people in the conversation can.
 */
export function replyWait(i: ReplyWaitInput): ReplyWait {
  if (!i.canSend) return { kind: 'silent' };
  // whole-ok: 'partial' speaks; the other two do not. Everything this function
  // says rests on ONE message — `newestDelivered` picks the most recent, and
  // `capped()` returns the newest rows, so the newest message in a truncated
  // thread is the newest message full stop. The truncation drops the oldest
  // messages, and nothing here reads them: no count of the conversation, no
  // total, no "you have never heard back". A thread long enough to hit the row
  // cap is exactly the conversation where "you wrote three days ago and nothing
  // has come back" is worth saying, and `isWhole` would silence it.
  if (i.status === 'loading' || i.status === 'error') return { kind: 'silent' };

  const last = newestDelivered(i.messages);
  if (!last || !last.mine) return { kind: 'silent' };

  const waitedMs = i.now - last.at;
  // A clock behind the server's — a phone whose time is wrong, or a row written
  // a second in the future — is not a negative wait, it is no wait.
  if (!Number.isFinite(waitedMs) || waitedMs < WAITING_HOURS * HOUR) return { kind: 'silent' };

  const ago = waitedLabel(waitedMs);
  if (seenBy(i.peerReadAt, last.at)) {
    return {
      kind: 'seen',
      waitedMs,
      note: `You wrote ${ago} ago and ${i.them} has opened it. Nothing has come back yet. ${COACH_QUEUE_NOTE}`,
    };
  }
  return {
    kind: 'sent',
    waitedMs,
    // "has not opened it" is the sentence this branch exists to refuse. A
    // missing watermark is an unauthorised read and a thread nobody has opened,
    // wearing the same face.
    note: `You wrote ${ago} ago and nothing has come back yet. This app cannot tell whether ${i.them} has opened it. ${COACH_QUEUE_NOTE}`,
  };
}
