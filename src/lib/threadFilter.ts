// Narrowing the coach's message list to the person, or the queue, they are
// looking for.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(trainer)/messages.tsx rendered `conversations.map(...)` under one head
// reading "Most recent first" and offered nothing else: no query field, no
// unread filter, no archive. The file's own header says it exists because "a
// coach with twenty clients had no way to see who had written to them" — and at
// forty, recency-only ordering recreates exactly that. Meanwhile the roster
// already draws "3 unread" on its rows, so the app computes the answer to "who
// is waiting on me" and had no way to show only those people.
//
// Two controls, and they compose: a search field over the names, and one chip
// that keeps the rows with something unopened in them.
//
// ── WHY 'UNREAD' AND NOT 'UNANSWERED' ──────────────────────────────────────
//
// The tempting label is "Unanswered", and it would be a claim this data cannot
// support. `unread` counts messages the coach has not OPENED; a coach who reads
// a message on a train and replies that evening has answered nothing and has an
// unread count of zero. `lastSender === 'client'` is closer to "unanswered" and
// is also wrong — the last word in a conversation is often "thanks", and a
// screen that filed every thank-you as an outstanding task would be ignored
// within a week.
//
// So the filter is named for the number the badge on the row already shows, and
// the two agree. The chip says Unread, the badge says 3, and there is one idea
// behind both.
//
// ── THE NULL, WHICH IS THE WHOLE DIFFICULTY ────────────────────────────────
//
// `CoachThread.unread` is `number | null`, and coachThreads.ts is explicit
// about why: null is "the count did not come back", NOT zero, because "zero is
// a claim that nobody is waiting, made on the one screen whose entire job is to
// say who is."
//
// A filter written the obvious way — `rows.filter(t => (t.unread ?? 0) > 0)` —
// takes that carefully preserved null and throws the row away. The coach then
// reads a short list as the complete list of people waiting on them, and the
// client whose count failed to load is the one who is actually waiting. That is
// strictly worse than no filter at all: before, the row was on screen wearing a
// dash; after, it is not on screen.
//
// So an unknown count is KEPT under the Unread filter, and `unknownUnread`
// below counts how many were kept for that reason so the screen can say it out
// loud. The rule this file follows is the one the codebase follows everywhere:
// a filter may hide what it knows does not match, and may never hide what it
// does not know about.
//
// ── What the search matches on ─────────────────────────────────────────────
//
// The client's NAME, through `matchesRosterQuery` in src/lib/rosterSearch.ts —
// the same matcher the roster and the Log a Session picker use, so "oneill"
// finds O'Neill and "jose" finds José on all three screens or on none of them.
// It deliberately does NOT search message bodies: this screen holds only the
// last line of each thread, so a body search would answer "is the word you
// typed in the most recent message" — which finds almost nothing a coach looks
// for and misses almost everything, while looking like a full-text search of
// their history.
//
// A thread whose name did not come back is matched against nothing and so is
// dropped by a non-empty query. It is not a name the coach could have typed,
// and `filterLine` says how many rows are in that position rather than letting
// them vanish silently.
//
// Pure and framework-free; asserted against under plain node in
// threadFilter.test.ts. The reads live in src/ui/coachThreads.ts.
import type { LoadStatus } from '../ui/loadStatus';
import { matchesRosterQuery } from './rosterSearch';
import type { CoachThread } from './coachThreads';

/** 'all' draws the list as it always was; 'unread' keeps the rows with
 *  something unopened — and the rows whose count is unknown. */
export type ThreadMode = 'all' | 'unread';

export interface ThreadFilter {
  mode: ThreadMode;
  /** Raw, as typed. Trimming and folding are `rosterSearch`'s business. */
  query: string;
}

/** The screen's starting state, and what Clear returns it to. */
export const NO_THREAD_FILTER: ThreadFilter = { mode: 'all', query: '' };

/** Whether anything is being narrowed. A field nobody has typed in and a chip
 *  nobody has pressed are not a filter, and the screen owes no explanation for
 *  a list it has not touched. */
export function threadFilterActive(f: ThreadFilter): boolean {
  return f.mode !== 'all' || f.query.trim().length > 0;
}

/**
 * Does this row survive the unread chip?
 *
 * Exported because it is the single decision the null turns on, and a test that
 * can name it is worth more than four tests that reach it through `filterThreads`.
 *
 *   a positive count   yes — somebody is waiting
 *   zero               no  — the count came back and nobody is waiting
 *   null               YES — we do not know, and hiding it would answer for it
 */
export function keptWhenUnread(t: CoachThread): boolean {
  return t.unread === null || t.unread > 0;
}

/**
 * The rows to draw.
 *
 * The ORDER is the caller's and is never re-ranked. `sortThreads` decides it —
 * most recent first, deliberately not unread first, for reasons its own header
 * sets out — and a filter that quietly re-sorted would move the row under the
 * coach's thumb between one render and the next.
 */
export function filterThreads(rows: readonly CoachThread[], f: ThreadFilter): CoachThread[] {
  const q = f.query.trim();
  return rows.filter((t) => {
    if (f.mode === 'unread' && !keptWhenUnread(t)) return false;
    if (!q) return true;
    // A row with no readable name cannot answer a name query. It is counted by
    // `withheldNames` below and spoken about, never dropped in silence.
    return t.name !== null && matchesRosterQuery(t.name, q);
  });
}

/** How many of these rows have a name that did not come back, and so can never
 *  match anything typed. */
export function withheldNames(rows: readonly CoachThread[]): number {
  return rows.reduce((n, t) => n + (t.name === null ? 1 : 0), 0);
}

/** How many of these rows are being kept only because their unread count could
 *  not be read. Zero under the 'all' mode, where nothing is being kept for a
 *  reason that needs explaining. */
export function unknownUnread(rows: readonly CoachThread[]): number {
  return rows.reduce((n, t) => n + (t.unread === null ? 1 : 0), 0);
}

/** How many of these rows have something unopened in them, on a count that
 *  actually came back. A row whose count is null is in neither this nor its
 *  complement — it is in `unknownUnread`, and that is the point. */
export function knownUnread(rows: readonly CoachThread[]): number {
  return rows.reduce((n, t) => n + (t.unread !== null && t.unread > 0 ? 1 : 0), 0);
}

/**
 * The label on the unread chip.
 *
 * `null` for the count means the whole read is incomplete enough that a figure
 * on the chip would be a claim — so the chip says what it does rather than how
 * many, and the sentence under the list carries the doubt.
 *
 * Note what this never says: it never prints 0. A chip reading "Unread · 0"
 * over a read that half-failed is the confident zero this screen exists to
 * refuse; where the count is knowable and zero the caller has nothing to filter
 * to and the sentence below says so in words.
 */
export function unreadChipLabel(known: number, anyUnknown: boolean): string {
  if (anyUnknown) return 'Unread';
  return known > 0 ? `Unread · ${known}` : 'Unread';
}

/**
 * The one sentence a narrowed list owes the coach, or null when there is
 * nothing to say.
 *
 * `matched` is what is on screen. `searched` is how many rows the filter
 * actually ran over — what LOADED, which under anything but 'ready' is not the
 * coach's book. `unknown` is how many of the matched rows are there only
 * because their unread count could not be read, and `withheld` how many rows a
 * name query could never have matched.
 *
 * The order of the branches is the order of the harm. A read that failed is
 * said first and alone, because every other clause would be a detail about a
 * list that is not the answer.
 */
export function threadFilterLine(o: {
  status: LoadStatus;
  filter: ThreadFilter;
  matched: number;
  searched: number;
  unknown: number;
  withheld: number;
}): string | null {
  if (!threadFilterActive(o.filter)) return null;
  const q = o.filter.query.trim();
  const parts: string[] = [];

  switch (o.status) {
    case 'error':
      // Said alone. Every other clause below is a detail about a list that is
      // not the answer, and a coach who reads three sentences takes the last
      // one for the summary.
      return q
        ? `Your conversations could not be read, so nothing was searched. Not finding “${q}” here does not mean they are not on your book.`
        : 'Your conversations could not be read, so nothing was filtered. This is not a list of who is waiting on you.';
    case 'loading':
      parts.push('Still reading your conversations, so this covers only the threads that have arrived so far.');
      break;
    case 'partial':
      // Said whether or not anything matched, for the reason rosterSearch gives:
      // a coach who finds one Sarah in a book that came back short has no way of
      // knowing there is a second one past the cap.
      parts.push(`Your book came back short, so this looked at the ${o.searched} thread${o.searched === 1 ? '' : 's'} that arrived and not at the rest of it.`);
      break;
    case 'ready':
      // The only status allowed to state an absence.
      if (o.matched === 0) parts.push(emptySentence(o.filter));
      break;
  }

  // The rows kept because nothing is known about them. Said under every status,
  // because it is the reason a row is on screen and the coach is entitled to
  // know a listed thread may hold nothing at all.
  if (o.filter.mode === 'unread' && o.unknown > 0) {
    parts.push(o.unknown === 1
      ? 'One of these is listed because its unread count could not be read, not because there is anything unopened in it.'
      : `${o.unknown} of these are listed because their unread counts could not be read, not because there is anything unopened in them.`);
  }

  // Rows a name query could never have matched. Without this they are simply
  // absent, which reads as "not on your book".
  if (q && o.withheld > 0) {
    parts.push(o.withheld === 1
      ? 'One more thread could not be searched, because that client’s name did not come back.'
      : `${o.withheld} more threads could not be searched, because those clients’ names did not come back.`);
  }

  return parts.length ? parts.join(' ') : null;
}

/**
 * What an empty filtered list says, under 'ready' and under nothing else.
 *
 * Three sentences rather than one, because "nothing here" over a name search
 * and over the unread chip are claims about different things — the first about
 * the coach's book, the second about their inbox — and a coach acts on them
 * differently.
 */
function emptySentence(f: ThreadFilter): string {
  const q = f.query.trim();
  if (q && f.mode === 'unread') return `Nobody matching “${q}” has an unopened message.`;
  if (q) return `Nobody on your book matches “${q}”.`;
  return 'Nothing is unopened. Every message your clients have sent you has been opened.';
}
