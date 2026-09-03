// Who spoke last, and how long ago — the queue the coach's inbox promised and
// did not draw.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// src/lib/features.ts describes the Messages screen to the coach, in the app's
// own search catalogue, as:
//
//     'Every client conversation, and who is waiting on a reply'
//
// The first half is true. The second half is not built. app/(trainer)/
// messages.tsx renders `conversations` newest-first and offers one chip —
// Unread — and `CoachThread.lastSender`, which is fetched on every load from
// `coach_threads()` (supabase/parts/148), is spent on exactly two things: the
// `You: ` prefix in `threadPreview`, and an ink colour that mutes the coach's
// own last word. The column that answers "whose turn is it" is read every time
// the screen opens and is used to pick a shade of grey.
//
// ── Why the Unread chip is not this, and cannot be ─────────────────────────
//
// It is the opposite of this, and the difference is the whole feature.
// `unread` counts messages the coach has not OPENED, and src/ui/readReceipts.ts
// clears it the moment the end of the thread is on screen. So the single worst
// case — a coach who read a client's question on the train on Monday, meant to
// answer it that evening, and did not — has an unread count of ZERO and sits
// at whatever position in a recency list Monday earns by Thursday. The chip
// that exists cannot show it, because opening it is what removed it from the
// chip.
//
// ── Why 'Unanswered' was rejected, and what changed ───────────────────────
//
// src/lib/threadFilter.ts turned this down, in these words:
//
//     `lastSender === 'client'` is closer to "unanswered" and is also wrong —
//     the last word in a conversation is often "thanks", and a screen that
//     filed every thank-you as an outstanding task would be ignored within a
//     week.
//
// That objection is correct and it is an objection to `lastSender` ALONE. The
// missing half was already in the same row: `lastAt`. A "thanks" is a message
// nobody was waiting on an answer to and nobody notices going unanswered; what
// makes a message an outstanding task is that it has SURVIVED, and the survival
// is a subtraction from a timestamp the screen already reads to print '2d'.
//
// Two things follow from taking that objection seriously rather than working
// around it:
//
//   · The threshold is a whole day (`WAITING_HOURS`). A coach is on a gym floor
//     with their hands on somebody, and a list that files a message sent ninety
//     minutes ago as neglected is a list that is right about a message nobody
//     could have answered. A message that has survived a full day is one the
//     coach has already had every chance at.
//
//   · NOTHING HERE SAYS AN ANSWER IS OWED. `waitingLine` states two facts and
//     no judgement: they spoke last, and it has been this long. The thank-you
//     still lands in this list on day two, and when it does the sentence beside
//     it is true — which is the only defence a list like this has. The moment
//     one of these rows reads "you have not replied to this", the first
//     thank-you it lands on teaches the coach the list is wrong, and they stop
//     reading it. Same reasoning as `AGEING_IS_YOUR_OWN_RECORD` in
//     src/lib/chaseList.ts: say what the record shows, do not accuse.
//
// ── The three states of 'have you even seen it' ────────────────────────────
//
// `unread` is not the queue, but it is the best available answer to a second
// question the coach acts on differently, and it is already in the row:
//
//   unread > 0     they wrote and it is still unopened.
//   unread === 0   the coach opened it. The last word is still the client's.
//   unread === null the count did not come back — src/lib/coachThreads.ts is
//                  explicit that this is NOT zero, "because zero is a claim
//                  that nobody is waiting, made on the one screen whose entire
//                  job is to say who is."
//
// Three states, three sentences, and the null never borrows either of the other
// two.
//
// ── Ordered by the wait, which the main list may not be ───────────────────
//
// `sortThreads` is recency and `filterThreads` is documented never to re-rank,
// for a good reason: the main list is SCANNED, and a list that reorders under
// the thumb makes the next tap land on somebody else. This is a different
// object. It is a queue — short, worked from the top, and read once — and the
// longest wait is the one at the top of it by definition. It is a separate
// section rather than a re-sort of the list below precisely so that neither
// rule has to bend.
//
// Ties break on `clientId` so the order is total: two clients who wrote in the
// same minute must not swap places between two renders.
//
// Pure and framework-free — no clock, no storage, no network. `now` is the
// caller's, which is the same `Date.now()` the row timestamps are drawn from.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';
import type { CoachThread } from './coachThreads';

/**
 * How long a client's last word has to have stood before it is a queue item.
 *
 * One full day, for the reason in the header: shorter and this becomes a list
 * of messages nobody could have answered yet, which is how a queue teaches the
 * person reading it to stop opening it.
 */
export const WAITING_HOURS = 24;

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Whether the coach has opened what the client sent. Three values, because
 *  'we could not read the count' is not 'they have seen it'. */
export type Opened = 'no' | 'yes' | 'unknown';

/** One client whose word is still the last one in the thread. */
export interface Waiting {
  /** The row as it came back, so the screen draws the same component it draws
   *  everywhere else — a face, a name, a preview — rather than a second
   *  rendering of a thread that could drift from the first. */
  thread: CoachThread;
  /** How long the client's last message has stood. Always finite and always at
   *  least `WAITING_HOURS`; a row whose wait could not be measured is not here
   *  at all, it is in `unsure`. */
  waitedMs: number;
  opened: Opened;
}

export interface WaitingBook {
  /** Longest wait first. */
  rows: Waiting[];
  /**
   * Threads that could not be placed: the sender or the timestamp did not come
   * back, so neither "they are waiting" nor "they are not" can be said about
   * them. Counted rather than dropped, and said out loud by `waitingNote` —
   * a queue that quietly loses a row is one that reads as "nobody is waiting",
   * which is a claim.
   */
  unsure: number;
  /** Why this is not the whole answer, or null when it is. */
  withheld: string | null;
}

/** Milliseconds since an ISO instant, or null when it is not one. */
function stood(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return null;
  return now - t;
}

/**
 * The queue.
 *
 * `status` never changes WHICH rows are listed — the threads that came back are
 * real whatever else did not, and hiding them would be hiding the people who
 * are actually waiting. It decides only what may be SAID about the list: see
 * `withheld`, and `waitingHeading`, which withholds the count rather than
 * stating a total over part of a book.
 */
export function waitingOn(
  rows: readonly CoachThread[],
  now: number,
  status: LoadStatus,
): WaitingBook {
  const out: Waiting[] = [];
  let unsure = 0;
  const floor = WAITING_HOURS * HOUR;

  for (const t of rows) {
    // Not a candidate at all, and not an uncertainty either: the coach wrote
    // last, and nobody is waiting on the coach for that.
    if (t.lastSender === 'coach') continue;
    if (t.lastSender !== 'client') {
      // Null. Either the thread is empty — in which case the screen has already
      // put it under "Message Someone Else" and it is not in this list — or the
      // column came back as something this build does not know. Neither can be
      // read as "the coach spoke last", so it is counted.
      unsure += 1;
      continue;
    }
    const waited = stood(t.lastAt, now);
    if (waited === null) {
      // A client's message with no readable date on it. It cannot be described
      // as having waited three days, and it must not be silently discarded.
      unsure += 1;
      continue;
    }
    // A clock skew that puts the message in the future is not a wait. Same
    // handling as `threadWhen`, which prints 'now' rather than '-3m'.
    if (waited < floor) continue;
    out.push({
      thread: t,
      waitedMs: waited,
      opened: t.unread === null ? 'unknown' : t.unread > 0 ? 'no' : 'yes',
    });
  }

  out.sort((a, b) =>
    (b.waitedMs - a.waitedMs)
    || (a.thread.clientId < b.thread.clientId ? -1 : a.thread.clientId > b.thread.clientId ? 1 : 0));

  return { rows: out, unsure, withheld: withheldFor(status) };
}

/** Why the list below may not be all of it. Null under a whole read. */
function withheldFor(status: LoadStatus): string | null {
  switch (status) {
    case 'ready':
      return null;
    case 'loading':
      return 'Still reading your conversations, so this covers only the threads that have arrived so far.';
    case 'partial':
      return 'Your book came back short, so this is drawn from the threads that arrived and not from all of them. Somebody may be waiting who is not here.';
    case 'error':
      return 'Your conversations could not be read, so this is not a list of who is waiting on you — it is what we had before the read failed.';
  }
}

/**
 * The wait, in the largest whole unit that is still true.
 *
 * Whole units only. "1.5 days" is arithmetic somebody has to undo, and a
 * rounded figure in a sentence about how long a person has been ignored is the
 * one place a half is not worth the precision.
 */
export function waitedLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'some time';
  const days = Math.floor(ms / DAY);
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
  const hours = Math.floor(ms / HOUR);
  if (hours >= 1) return hours === 1 ? '1 hour' : `${hours} hours`;
  return 'under an hour';
}

/**
 * The line under one row. Two facts and no accusation — see the header.
 *
 * The subject is always the client and the verb is always something they did.
 * Nothing here says the coach failed to do anything, because the list cannot
 * tell a question from a thank-you and the coach can.
 */
export function waitingLine(w: Waiting): string {
  const ago = waitedLabel(w.waitedMs);
  switch (w.opened) {
    case 'no':
      return `They wrote ${ago} ago and it is still unopened.`;
    case 'yes':
      // The one this whole module exists for. The Unread chip cannot show it,
      // because opening the thread is what took it off the chip.
      return `They wrote ${ago} ago. You have opened it and the last word is still theirs.`;
    case 'unknown':
      return `They wrote ${ago} ago. Whether you have opened it could not be read.`;
  }
}

/** The section's title. Constant, in the Title Case its siblings on that screen
 *  are in — the count is the head's NOTE, which is where that screen already
 *  puts "3 of 12" and "Most recent first". */
export const WAITING_TITLE = 'Waiting on a Reply';

/**
 * Whether the section is drawn at all.
 *
 * False when there is nothing waiting AND nothing uncertain: a coach who has
 * answered everybody should not be shown a section congratulating them on it
 * every morning. The absence is the message — same rule as `gapsHeading` in
 * src/lib/registerGaps.ts.
 */
export function hasWaiting(book: WaitingBook): boolean {
  return book.rows.length > 0 || book.unsure > 0;
}

/**
 * The count beside the title, or null when no count may be stated.
 *
 * A NUMBER only under a whole read. Under 'partial' the rows are real and a
 * count over them is a subtotal, and "3 clients" printed over four fifths of a
 * book is the confident figure src/ui/loadStatus.ts exists to refuse. The head
 * loses its note; `waitingNote` carries the doubt in words.
 */
export function waitingCountNote(book: WaitingBook, status: LoadStatus): string | null {
  if (!isWhole(status)) return null;
  const n = book.rows.length;
  if (n === 0) return null;
  return n === 1 ? '1 client' : `${n} clients`;
}

/**
 * The sentence under the heading, or null when there is nothing to add.
 *
 * It carries `withheld` first, because a doubt about the whole list comes
 * before a detail about part of it, and then the uncertain rows — which are
 * the reason this list is not a complete answer even when the read was.
 */
export function waitingNote(book: WaitingBook): string | null {
  const parts: string[] = [];
  if (book.withheld) parts.push(book.withheld);
  if (book.unsure > 0) {
    parts.push(book.unsure === 1
      ? 'One more conversation could not say who spoke last, or when, so it is not on this list either way.'
      : `${book.unsure} more conversations could not say who spoke last, or when, so they are not on this list either way.`);
  }
  if (parts.length === 0 && book.rows.length > 0) {
    // Said once, under the list, and it is the honest description of what the
    // rows are. A coach who reads this as a list of failures will stop opening
    // it the first time a "thanks" appears on it.
    parts.push(`These are the conversations where your client spoke last and it has been at least ${WAITING_HOURS} hours. Some of them will be a thank-you — this list can tell who wrote last, not who is owed an answer.`);
  }
  return parts.length ? parts.join(' ') : null;
}
