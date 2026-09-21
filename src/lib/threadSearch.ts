// Finding something somebody said, in a conversation that is months long.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// A coaching thread is where the answer to "what did they say about my knee",
// "which gym did we settle on" and "what time on Thursday" lives, and this app
// offered no way to look for any of them. TrueCoach, Trainerize, Everfit and PT
// Distinction all search message content; app/(trainer)/messages.tsx searches
// CLIENT NAMES (src/lib/threadFilter.ts) and the thread screens search nothing
// at all. A member scrolling a year of messages with their thumb is the
// alternative, and on a `capLimit()`-truncated read it is not even a complete
// alternative — which is the half of this that matters most and is the reason
// the sentence below exists.
//
// Nothing here reads anything. The messages are already in memory: `useThread`
// has them, both chat screens render them, and this decides which of them match
// and what the screen must admit about the ones it could not look at.
//
// ── THE DENOMINATOR, which is the whole of the honesty here ───────────────
//
// `useThread` reads NEWEST-FIRST at the row cap and reports `hasOlder` when the
// thread is longer than that. So a search over what is on screen is a search
// over a PREFIX of the conversation — the recent end — and "No matches" said
// over that prefix is a claim about the whole thread that this screen cannot
// support. It is the same defect shape `threadFilterLine` refuses next door and
// `outboxThreadsNote` refuses for the device queue: a count whose set was never
// asked about.
//
// So `threadSearchLine` never says "nothing" without saying what it looked at,
// and where there is more to load it says so and the screen keeps its Load
// Earlier control in reach. A member who searches for "knee", finds nothing,
// and is told the search covered the last two hundred messages will press it.
// One who is told "No matches" will believe their coach never mentioned it.
//
// ── What is deliberately NOT matched ──────────────────────────────────────
//
// AN ATTACHMENT. A photo has no words, and a message whose whole content is a
// photograph has an empty body. Matching it on the noun the preview line uses
// ("a photo") would make every image in the thread answer a search for the
// word photo, which is not what anybody typing it means.
//
// A DATE. "Thursday" matches the body if somebody wrote it and does not match a
// timestamp, because a timestamp is rendered in the reader's own locale and
// searching the rendering would make the results depend on the phone's
// language. A date filter is a different control and is not this one.
//
// Pure and framework-free; asserted under plain node in threadSearch.test.ts.
import type { LoadStatus } from '../ui/loadStatus';
import { num } from './format';

/** The least this needs of a message. Deliberately narrower than
 *  `ThreadMessage` so the coach's screen can pass its own shape later without
 *  either of them growing a dependency on the other. */
export interface SearchableMessage {
  id: string;
  body: string;
}

/**
 * The query, reduced to what is actually compared.
 *
 * Trimmed, lower-cased, and inner runs of whitespace collapsed, so "come  at 7"
 * finds "come at 7". Nothing else is normalised — accents are not stripped,
 * because stripping them makes a search for a name find a different name, and
 * this is a conversation between two people who use each other's names.
 */
export function normaliseQuery(q: string | null | undefined): string {
  return typeof q === 'string' ? q.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/** Whether a search is running at all. A query of spaces is not a search. */
export function threadSearchActive(q: string | null | undefined): boolean {
  return normaliseQuery(q) !== '';
}

/** Whether one message answers the query. Substring, case-insensitive, on the
 *  body only — see the header on attachments and dates. */
export function messageMatches(m: SearchableMessage | null | undefined, q: string): boolean {
  const needle = normaliseQuery(q);
  if (!needle) return false;
  const body = typeof m?.body === 'string' ? m.body.toLowerCase().replace(/\s+/g, ' ') : '';
  return body.includes(needle);
}

/**
 * The matching messages, in the order they were given.
 *
 * The order is the thread's own — oldest first, as both screens hold it —
 * because a run of matches read out of order is a different conversation. An
 * empty or blank query returns EVERYTHING, so a screen can render this in place
 * of its list unconditionally and the absence of a search is the absence of a
 * filter rather than an empty screen.
 */
export function searchThread<T extends SearchableMessage>(
  messages: readonly T[],
  q: string | null | undefined,
): T[] {
  const needle = normaliseQuery(q);
  if (!needle) return messages.slice();
  return messages.filter((m) => messageMatches(m, needle));
}

/**
 * The one sentence a search owes the reader, or null when it owes none.
 *
 * Four facts in one line, in the order of the harm:
 *
 *   · a read that FAILED comes first and alone. The messages on screen are
 *     whatever was cached or whatever loaded before it broke, and a match count
 *     over them is a number about the wrong set.
 *   · then the matches, with the size of what was searched beside them. Always
 *     beside them: this is the count-with-no-denominator shape, and the
 *     denominator here is not the thread, it is the part of the thread on this
 *     screen.
 *   · then whether there is more of the conversation that was NOT searched.
 *     This is the clause that stops "No matches" being read as "they never
 *     said it".
 *
 * @param searched how many messages the search actually ran over — what is in
 *        memory, not what exists.
 * @param hasOlder whether `useThread` knows there is more of this conversation
 *        on the server. Its own flag rather than `status`, because after one
 *        step back the thread is still a prefix and the status has moved on.
 */
export function threadSearchLine(o: {
  query: string;
  matched: number;
  searched: number;
  hasOlder: boolean;
  status: LoadStatus;
}): string | null {
  if (!threadSearchActive(o.query)) return null;
  if (o.status === 'error') {
    return 'This conversation could not be read, so this searches only what was already on this phone. There may be more.';
  }
  const more = o.hasOlder
    ? ' Earlier messages are on the server and were not searched. Load them to search further back.'
    : '';
  if (o.matched <= 0) {
    // Never "no matches" on its own. The set is named every time.
    return o.searched === 1
      ? `No match in the 1 message on this screen.${more}`
      : `No match in the ${num(o.searched)} messages on this screen.${more}`;
  }
  const head = o.matched === 1
    ? `1 match in the ${num(o.searched)} message${o.searched === 1 ? '' : 's'} on this screen.`
    : `${num(o.matched)} matches in the ${num(o.searched)} messages on this screen.`;
  return `${head}${more}`;
}

/**
 * What the screen reader is told when the results replace the thread.
 *
 * Separate from the line above because a screen reader announcing a filtered
 * list needs to know the list CHANGED, which a sentence drawn above it does not
 * convey — the bubbles below are the same elements they were a moment ago with
 * different content in them.
 */
export function threadSearchA11y(o: { query: string; matched: number }): string | undefined {
  if (!threadSearchActive(o.query)) return undefined;
  return o.matched === 1
    ? '1 matching message. The rest of the conversation is hidden while you are searching.'
    : `${num(o.matched)} matching messages. The rest of the conversation is hidden while you are searching.`;
}
