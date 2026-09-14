// The words still on this handset, as a thread list has to admit them.
//
// ── The silence this ends ──────────────────────────────────────────────────
//
// `useThread` (src/ui/messaging.ts) is careful: a message the server did not
// take is kept in the device outbox, the bubble is marked, and the sentence
// under it says "Waiting to send — they cannot see this yet". That is true on
// the CHAT screen, which is the one screen that mounts the thread hook.
//
// app/(trainer)/messages.tsx mounts nothing of the sort. It is drawn from
// `coach_threads()`, which is the SERVER's answer and cannot know about words
// that never reached it. So a coach who replied to three people on the
// underground and came back to their inbox saw three threads whose last
// message is still the client's, in a section headed "Waiting on a Reply",
// with no mark anywhere saying the reply is on the phone in their hand. The
// two readings available to them were both wrong: that they had not answered,
// or — worse, once they remember typing it — that they had.
//
// Nothing here changes what is sent or when. The outbox flush is unchanged and
// remains the only thing that sends anything. This is the list admitting what
// the device is holding for it.
//
// ── The three states, and which of them this file can see ─────────────────
//
// `stored`  is the server's, and it is what every row of the list already is.
// `unsent`  is this: on the handset, counted, not delivered, and it goes when
//           there is signal.
// `refused` is never in here. The outbox drops a refused write rather than
//           retrying it (src/lib/offlineQueue.ts), so an item still in
//           `pending` has not been refused by anybody — and that is exactly
//           why a queued message may be described as waiting rather than as
//           failed.
//
//           That drop used to be the END of the refused message, which made
//           this file's own sentence load-bearing in a way it could not carry:
//           the mark came off the row and the row then read as delivered.
//           src/lib/refusedMessages.ts is the record that catches it, and the
//           two marks are drawn together on the same row because a coach who
//           typed twice may have had the first refused and the second still
//           waiting.
//
// ── What is deliberately NOT done ─────────────────────────────────────────
//
// THE PREVIEW LINE IS NOT REWRITTEN. A queued message is not the last thing
// said in that conversation; it is the last thing TYPED, on this phone, and
// nobody has read it. Putting it where `threadPreview` puts the server's last
// message would make the list say the coach's words landed. The mark goes
// beside the preview instead, in its own words.
//
// THE ORDER IS NOT CHANGED. `sortThreads` orders on the server's timestamps,
// which is the only key every row is known to have. Floating a thread because
// this device is holding something for it would reorder the coach's list on a
// fact only this handset knows, and the row would drop back the moment it
// flushed.
//
// Pure and framework-free; asserted under plain node in threadOutbox.test.ts.
// The state is src/ui/outbox.tsx and the narrowing is `asQueuedMessage` in
// src/ui/messaging.ts, which stays the only place that reads a stored payload.
import type { LoadStatus } from '../ui/loadStatus';
import { waitedLabel } from './awaitingReply';
import { num } from './format';

/**
 * One queued message, already narrowed.
 *
 * Deliberately not the outbox item: narrowing a stored payload is
 * `asQueuedMessage`'s job and there must not be a second opinion about what a
 * queued message looks like. This takes the result of it and decides only what
 * a list may say.
 */
export interface QueuedWord {
  /** The thread it is addressed to — `messages.client_id`. */
  clientId: string;
  /** When it was written on this phone, ISO. Not when it will be sent, which
   *  nothing knows. */
  at: string;
}

/** What one thread is holding on this device. */
export interface QueuedForThread {
  /** How many messages for this thread are on the handset. Always at least 1
   *  wherever this exists: a thread holding nothing has no entry at all. */
  count: number;
  /** The oldest one's timestamp, or null when none of them carried a readable
   *  one. Null is not "just now" — `queuedThreadNote` says the count without a
   *  time rather than inventing one. */
  oldestAt: string | null;
}

/**
 * Group the queue by thread.
 *
 * A word with no thread key belongs to no row and is counted by
 * `unaddressedQueued` instead, so it cannot vanish between the two.
 */
export function queuedByThread(words: readonly QueuedWord[]): Map<string, QueuedForThread> {
  const out = new Map<string, QueuedForThread>();
  for (const w of words) {
    const id = typeof w?.clientId === 'string' ? w.clientId.trim() : '';
    if (!id) continue;
    const at = typeof w?.at === 'string' && Number.isFinite(Date.parse(w.at)) ? w.at : null;
    const held = out.get(id);
    if (!held) {
      out.set(id, { count: 1, oldestAt: at });
      continue;
    }
    held.count += 1;
    // The oldest readable stamp wins; an unreadable one never displaces a
    // readable one, and never becomes one.
    if (at && (!held.oldestAt || Date.parse(at) < Date.parse(held.oldestAt))) held.oldestAt = at;
  }
  return out;
}

/** Queued words with no thread key on them. Not droppable in silence: they are
 *  still somebody's words on this phone, and the screen-level sentence counts
 *  them so the per-row marks are never presented as the whole of the queue. */
export function unaddressedQueued(words: readonly QueuedWord[]): number {
  return words.reduce((n, w) => n + ((typeof w?.clientId === 'string' && w.clientId.trim()) ? 0 : 1), 0);
}

/** Everything on the handset, addressed or not. The denominator for the
 *  screen-level sentence. */
export function queuedTotal(words: readonly QueuedWord[]): number {
  return words.length;
}

/**
 * The mark beside one row, or null when there is nothing on this phone for it.
 *
 * Says the count and says it is NOT delivered, in that order, because the
 * count alone reads as a badge and a badge on a messaging list means unread.
 *
 * ── AND HOW LONG IT HAS BEEN THERE ────────────────────────────────────────
 *
 * `oldestAt` was collected and never said, which made every queued reply read
 * as one typed a moment ago. They are not the same fact and a coach acts on
 * them differently: a message written ninety seconds ago on a train is the
 * queue working, and one that has been on the handset since Tuesday is a flush
 * that has been failing for four days against a client who has heard nothing.
 * This is the same defect `threadWhen` in src/lib/coachThreads.ts refuses on the
 * server's side — an undated message reads as "just now" — arriving through a
 * mark instead of through a timestamp.
 *
 * @param now the reader's clock, which must MOVE: this screen is an
 *        `href: null` tab that mounts once, so a `Date.now()` frozen at first
 *        paint would hold the age at whatever it was when Messages was first
 *        opened. The call sites pass `useNow()`.
 *
 *        Omitted, or handed a thread whose words carried no readable stamp, the
 *        age is left OFF rather than guessed. `waitedLabel` would answer "some
 *        time" for a negative or unreadable span, and a sentence that says that
 *        on every row is one nobody reads on the morning it matters.
 */
export function queuedThreadNote(q: QueuedForThread | undefined | null, now?: number): string | null {
  if (!q || q.count <= 0) return null;
  const head = q.count === 1
    ? 'One reply is waiting to send from this phone. They cannot see it yet.'
    : `${q.count} replies are waiting to send from this phone. They cannot see them yet.`;
  const held = heldForClause(q.oldestAt, now, q.count);
  return held ? `${head} ${held}` : head;
}

/** "It has been waiting 2 days." / "The oldest has been waiting 2 days." — or
 *  null, which is every case where the span is not known to be real. */
function heldForClause(oldestAt: string | null, now: number | undefined, count: number): string | null {
  if (!oldestAt || now === undefined || !Number.isFinite(now)) return null;
  const t = Date.parse(oldestAt);
  if (!Number.isFinite(t)) return null;
  const ms = now - t;
  // A stamp in the future is a clock that disagrees with itself, not an age.
  // `waitedLabel` would say "some time", which on a queue mark reads as though
  // something is wrong with the message rather than with the clock.
  if (ms < 0) return null;
  const label = waitedLabel(ms);
  return count === 1
    ? `It has been waiting ${label}.`
    : `The oldest has been waiting ${label}.`;
}

/**
 * The one sentence the screen owes about its own queue, or null.
 *
 * Three cases and they are different facts:
 *
 *   · the outbox could not be READ ('partial'). Nothing on this screen may be
 *     taken as complete, including the absence of marks — this is the "a failed
 *     read is not an empty list" rule, applied to the device rather than to the
 *     server. Said even when the count is zero, because the zero is the thing
 *     in doubt.
 *   · there is no outbox at all above this screen (`words` null). Same
 *     sentence, different cause, and the screen cannot tell them apart in a way
 *     a coach could act on.
 *   · there are queued words. Said with its denominator: how many are held and
 *     how many of them are on rows the coach can see, so a message addressed to
 *     a thread that is not in the list is not silently missing.
 *
 * A read outbox with nothing in it gets null. There is nothing to say, and a
 * line reading "nothing is waiting" on every load is one nobody reads on the
 * morning it is not true.
 */
export function outboxThreadsNote(
  words: readonly QueuedWord[] | null,
  status: LoadStatus,
  shownThreadIds: ReadonlySet<string>,
): string | null {
  if (words === null) {
    return 'This phone could not say whether it is holding any messages that have not been sent. Open a conversation to see whether your last reply went.';
  }
  if (status === 'partial' || status === 'error') {
    return 'This phone could not read everything it is holding, so any message waiting to send may not be marked below.';
  }
  const total = queuedTotal(words);
  if (total <= 0) return null;
  const grouped = queuedByThread(words);
  let onScreen = 0;
  for (const [id, q] of grouped) if (shownThreadIds.has(id)) onScreen += q.count;
  const held = total === 1 ? '1 message is' : `${num(total)} messages are`;
  if (onScreen === total) {
    return `${held} waiting to send from this phone, marked on the conversation${total === 1 ? '' : 's'} below. Nobody has been sent ${total === 1 ? 'it' : 'them'} yet.`;
  }
  return `${held} waiting to send from this phone, and ${num(onScreen)} of ${num(total)} ${onScreen === 1 ? 'is' : 'are'} on a conversation shown here. Nobody has been sent ${total === 1 ? 'it' : 'them'} yet.`;
}
